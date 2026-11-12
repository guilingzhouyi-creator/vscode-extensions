/**
 * Module: Static Analysis — Import, Dependency & External Resource Layout
 * File Path: src/analyzers/dependency-layout.ts
 * Architecture Role: Analyzer adapter implementing the Analyzer contract; inspects file layout,
 *   import grouping orders, in-function imports, and unmanaged remote URLs.
 * Dependencies & Triggers: Core types (Analyzer, AnalyzerContext, Issue), dependencyLayout
 *   intelligence module; triggered when 'dependency-layout' analyzer is enabled.
 * Responsibilities: Enforce canonical layout order (DEP-ORD-001); audit in-function imports
 *   (DEP-LAZ-001); flag unmanaged hardcoded external URLs (DEP-RES-001); detect wildcard
 *   imports (DEP-WLD-001); flag inverted dependency references (DEP-INV-001); detect dev-only
 *   dependency leakage in production code (DEP-DEV-001), deprecated libraries (DEP-OBS-001),
 *   and unpinned/wildcard dependency versions (DEP-PIN-001).
 * Exit Semantics & Design Rationale: Stateless and synchronous per file; returns Issue[] and
 *   never throws.
 */

import * as ts from 'typescript';
import type { Analyzer, AnalyzerContext, Issue } from '../core/types';
import type {
    DependencyLayoutOptions,
    ExternalResourceRef,
    ImportStatementInfo,
} from '../core/intelligence/dependencyLayout';
import {
    analyzeDependencyLayout,
    categorizeImport,
    extractExemptionReason,
} from '../core/intelligence/dependencyLayout';
import {
    findNearestManifestInventory,
    loadProjectManifestDependencies,
} from '../core/intelligence/dependency-provenance';
import { REGEX, createRemoteUrlScanner } from '../core/constants';

function isPolyglotImportLine(trimmed: string, language: string): boolean {
    if (language === 'python') return REGEX.SYNTAX.PYTHON_FROM_IMPORT.test(trimmed);
    if (language === 'rust') return REGEX.SYNTAX.RUST_USE_IMPORT.test(trimmed);
    if (language === 'gdscript') return REGEX.SYNTAX.GDSCRIPT_LOAD_IMPORT.test(trimmed);
    if (language === 'go') return /^package\s+|^import\b/.test(trimmed);
    return REGEX.SYNTAX.TS_IMPORT_LINE.test(trimmed);
}

/**
 * Check whether a leading polyglot line is a mandatory file header prologue rather than
 * operational logic, so subsequent top-of-file imports are not misclassified as misplaced.
 *
 * @param trimmed - Trimmed source line.
 * @param language - Normalized language identifier.
 * @returns True when the line is a language header prologue preceding imports.
 */
function isPolyglotHeaderPrologue(trimmed: string, language: string): boolean {
    if (language === 'gdscript') {
        return REGEX.GDSCRIPT.HEADER_PROLOGUE.test(trimmed);
    }
    if (language === 'rust') {
        return trimmed.startsWith('#![') || trimmed.startsWith('//!');
    }
    return false;
}

function buildEnrichedOptions(
    normPath: string,
    filePath: string,
    options: DependencyLayoutOptions,
    configRoot?: string,
): DependencyLayoutOptions {
    if (isExcludedFile(normPath)) {
        return {
            ...options,
            rootDir: undefined,
            manifestDependencies: undefined,
            manifestInventory: undefined,
            flagLicenseCompliance: false,
            flagDevOnlyDependencies: false,
            flagDeprecatedDependencies: false,
            flagUnpinnedDependencies: false,
        };
    }

    const rootDir = configRoot || process.cwd();
    const manifestInventory =
        options.manifestInventory || findNearestManifestInventory(filePath, rootDir);
    const manifestDeps =
        options.manifestDependencies ||
        manifestInventory?.allDependencies ||
        loadProjectManifestDependencies(rootDir);

    return {
        ...options,
        rootDir: options.rootDir || rootDir,
        manifestDependencies: manifestDeps,
        manifestInventory,
    };
}

/**
 * Detect a statement whose initializer is a `require(...)` call.
 *
 * CommonJS files express imports as `const path = require('path')`. Such a statement is an import
 * for layout purposes, so it must not define the import horizon; otherwise every following `import`
 * is reported as being declared after operational code.
 *
 * @param stmt - Top-level statement under test.
 * @returns True when the statement is a require-based import binding.
 */
function isRequireImportStatement(stmt: ts.Statement): boolean {
    if (!ts.isVariableStatement(stmt)) return false;
    return stmt.declarationList.declarations.some((decl) => {
        const init = decl.initializer;
        if (!init) return false;
        if (ts.isCallExpression(init)) return init.expression.getText().endsWith('require');
        return false;
    });
}

/**
 * Decide whether a top-level statement terminates the dependency block.
 *
 * The horizon exists to separate the dependency declarations from the file's contract types,
 * constants, and business logic. A directive prologue (`'use strict'`), a side-effect call that
 * must run before later `require()` calls resolve, a bootstrap `try` block enabling the compile
 * cache, and a re-export all belong to the dependency bootstrapping phase rather than to the
 * file's declarations, so none of them can end the block. Counting them made the rule report every
 * `const fs = require('fs')` in the repository's scripts as a misplaced import.
 *
 * @param stmt - Top-level statement under test.
 * @returns True when the statement starts the declaration region of the file.
 */
function establishesImportHorizon(stmt: ts.Statement): boolean {
    if (ts.isImportDeclaration(stmt)) return false;
    if (ts.isImportEqualsDeclaration(stmt)) return false;
    if (ts.isEmptyStatement(stmt)) return false;
    if (isRequireImportStatement(stmt)) return false;
    if (ts.isExportDeclaration(stmt)) return false;
    if (ts.isTryStatement(stmt)) return false;
    if (ts.isExpressionStatement(stmt)) return !isBootstrapExpression(stmt.expression);
    return true;
}

/**
 * Recognise a top-level expression that belongs to module bootstrap rather than to declarations.
 *
 * @param expr - Expression of a top-level expression statement.
 * @returns True for directive prologues and `require(...)`-anchored calls.
 */
function isBootstrapExpression(expr: ts.Expression): boolean {
    if (ts.isStringLiteral(expr)) return true;
    return expressionMentionsRequire(expr);
}

/**
 * Test whether an expression is, or is rooted at, a `require(...)` call.
 *
 * @param expr - Expression to inspect.
 * @returns True when the expression depends on a CommonJS `require` call.
 */
function expressionMentionsRequire(expr: ts.Expression): boolean {
    let current: ts.Expression = expr;
    for (;;) {
        if (ts.isPropertyAccessExpression(current)) {
            current = current.expression;
            continue;
        }
        if (ts.isCallExpression(current)) {
            if (ts.isIdentifier(current.expression) && current.expression.text === 'require') {
                return true;
            }
            current = current.expression;
            continue;
        }
        return ts.isIdentifier(current) && current.text === 'require';
    }
}

function findFirstTsDeclarationLine(sourceFile: ts.SourceFile): number | undefined {
    for (const stmt of sourceFile.statements) {
        if (establishesImportHorizon(stmt)) {
            return sourceFile.getLineAndCharacterOfPosition(stmt.getStart(sourceFile)).line + 1;
        }
    }
    return undefined;
}

function findFirstPolyglotDeclarationLine(
    lines: readonly string[],
    language: string,
): number | undefined {
    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (
            !trimmed ||
            trimmed.startsWith('#') ||
            trimmed.startsWith('//') ||
            trimmed.startsWith('/*') ||
            trimmed.startsWith('*')
        ) {
            continue;
        }
        if (
            !isPolyglotImportLine(trimmed, language) &&
            !isPolyglotHeaderPrologue(trimmed, language)
        ) {
            return i + 1;
        }
    }
    return undefined;
}

function resolveSourceFile(
    sourceFile: ts.SourceFile | undefined,
    ctx: AnalyzerContext,
    language: string,
): ts.SourceFile | undefined {
    if (language !== 'typescript') {
        return sourceFile;
    }
    const cachedCtx = ctx as { sourceFile?: ts.SourceFile; _cachedSourceFile?: ts.SourceFile };
    const existing = sourceFile || cachedCtx._cachedSourceFile || cachedCtx.sourceFile;
    if (existing || !ctx.content) {
        if (existing) {
            cachedCtx._cachedSourceFile = existing;
        }
        return existing;
    }
    try {
        const sf = ts.createSourceFile(ctx.filePath, ctx.content, ts.ScriptTarget.Latest, true);
        cachedCtx._cachedSourceFile = sf;
        return sf;
    } catch {
        return undefined;
    }
}

/**
 * Analyzer enforcing file layout, import discipline, and external resource management.
 */
export class DependencyLayoutAnalyzer implements Analyzer {
    name = 'dependency-layout' as const;

    /** Cached split lines of current file under analysis to eliminate repeated full-file splits. */
    private fileLines: readonly string[] = [];

    public resetState(): void {
        this.fileLines = [];
    }

    analyze(sourceFile: ts.SourceFile, ctx: AnalyzerContext): Issue[] {
        const options = (ctx.config.analyzers['dependency-layout']?.options ||
            {}) as DependencyLayoutOptions;
        const normPath = ctx.filePath.replace(/\\/g, '/');
        const language = inferLanguageFromPath(normPath);

        this.fileLines = ctx.lines ?? (ctx.content ? ctx.content.split('\n') : []);

        const imports: ImportStatementInfo[] = [];
        const resources: ExternalResourceRef[] = [];

        const effectiveSf = resolveSourceFile(sourceFile, ctx, language);

        const firstDeclarationLine = this.resolveFirstDeclarationLine(
            language,
            effectiveSf,
            this.fileLines,
        );
        if (
            language === 'typescript' &&
            effectiveSf &&
            typeof effectiveSf.forEachChild === 'function'
        ) {
            this.analyzeTsWithAst(effectiveSf, ctx, imports, options);
        } else {
            this.analyzeWithLines(ctx, language, imports, options);
        }

        if (!isExcludedFile(normPath)) {
            this.extractRemoteResources(ctx, resources);
        }

        const enrichedOptions = buildEnrichedOptions(
            normPath,
            ctx.filePath,
            { ...options, firstDeclarationLine },
            ctx.config?.root,
        );

        return analyzeDependencyLayout(imports, resources, language, enrichedOptions);
    }

    /**
     * Streaming lifecycle finalization hook; allows single-pass scanning without SourceFile AST.
     */
    finalize(ctx: AnalyzerContext): Issue[] {
        return this.analyze(undefined as unknown as ts.SourceFile, ctx);
    }

    private resolveFirstDeclarationLine(
        language: string,
        sourceFile: ts.SourceFile | undefined,
        lines: readonly string[],
    ): number | undefined {
        if (
            language === 'typescript' &&
            sourceFile &&
            typeof sourceFile.forEachChild === 'function'
        ) {
            return findFirstTsDeclarationLine(sourceFile);
        }
        return findFirstPolyglotDeclarationLine(lines, language);
    }

    private handleCallImport(
        node: ts.CallExpression,
        sourceFile: ts.SourceFile,
        ctx: AnalyzerContext,
        isInsideFunction: boolean,
        options?: DependencyLayoutOptions,
    ): ImportStatementInfo | null {
        const specifier = extractCallSpecifier(node);
        if (!specifier) return null;

        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
        const rawText = node.getText(sourceFile).trim();
        const category = categorizeImport(specifier, 'typescript');
        const surroundingText = this.getSurroundingText(this.fileLines, line);
        const exemption = extractExemptionReason(surroundingText, options?.lazyImportExemptMarkers);

        return {
            file: ctx.filePath,
            line,
            rawText,
            moduleSpecifier: specifier,
            category,
            isInsideFunction,
            hasAuditExemption: exemption !== undefined,
            exemptionReason: exemption,
            isWildcard: false,
        };
    }

    private analyzeTsWithAst(
        sourceFile: ts.SourceFile,
        ctx: AnalyzerContext,
        imports: ImportStatementInfo[],
        options?: DependencyLayoutOptions,
    ): void {
        let functionNestingLevel = 0;

        const visit = (node: ts.Node): void => {
            const isFn = isFunctionBoundary(node);
            if (isFn) functionNestingLevel++;

            if (ts.isImportDeclaration(node)) {
                const info = handleStaticImport(
                    node,
                    sourceFile,
                    ctx.filePath,
                    functionNestingLevel > 0,
                );
                if (info) imports.push(info);
            } else if (ts.isCallExpression(node)) {
                const info = this.handleCallImport(
                    node,
                    sourceFile,
                    ctx,
                    functionNestingLevel > 0,
                    options,
                );
                if (info) imports.push(info);
            }

            ts.forEachChild(node, visit);
            if (isFn) functionNestingLevel--;
        };

        visit(sourceFile);
    }

    private analyzeWithLines(
        ctx: AnalyzerContext,
        language: string,
        imports: ImportStatementInfo[],
        options?: DependencyLayoutOptions,
    ): void {
        const lines =
            this.fileLines.length > 0 ? this.fileLines : ctx.content ? ctx.content.split('\n') : [];
        let inFunction = false;
        let functionIndent = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            const lineNum = i + 1;
            const currentIndent = line.search(/\S/);

            const state = this.checkFunctionState(
                line,
                trimmed,
                language,
                currentIndent,
                inFunction,
                functionIndent,
            );
            inFunction = state.inFunction;
            functionIndent = state.functionIndent;

            const parsed = parseLineImportBySpec({
                trimmed,
                language,
                lines,
                lineIndex: i,
                lineNum,
                filePath: ctx.filePath,
                inFunction,
                options,
            });
            if (parsed) {
                imports.push(parsed);
            }
        }
    }

    private checkFunctionState(
        line: string,
        trimmed: string,
        language: string,
        currentIndent: number,
        inFunction: boolean,
        functionIndent: number,
    ): { inFunction: boolean; functionIndent: number } {
        if (language === 'python') {
            return checkIndentFunctionState(
                line,
                trimmed,
                REGEX.SYNTAX.PYTHON_DECL_HEADER,
                currentIndent,
                inFunction,
                functionIndent,
            );
        }
        if (language === 'gdscript') {
            return checkIndentFunctionState(
                line,
                trimmed,
                REGEX.SYNTAX.GDSCRIPT_FUNC_DECL_HEADER,
                currentIndent,
                inFunction,
                functionIndent,
            );
        }
        if (language === 'rust') {
            return checkRustFunctionState(line, trimmed, inFunction);
        }
        return { inFunction, functionIndent };
    }

    private hasRemoteSchemeMarker(line: string): boolean {
        return line.includes('://');
    }

    private extractRemoteResources(ctx: AnalyzerContext, resources: ExternalResourceRef[]): void {
        const lines =
            this.fileLines.length > 0 ? this.fileLines : ctx.content ? ctx.content.split('\n') : [];
        const urlScanner = createRemoteUrlScanner();
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (!this.hasRemoteSchemeMarker(line)) continue;
            const lineNum = i + 1;
            urlScanner.lastIndex = 0;
            let urlMatch: RegExpExecArray | null;

            while ((urlMatch = urlScanner.exec(line)) !== null) {
                const url = urlMatch[1];
                if (!REGEX.LITERAL.EXEMPTED_REMOTE_URL.test(url)) {
                    resources.push({
                        file: ctx.filePath,
                        line: lineNum,
                        urlOrPath: url,
                        symbol: 'inline-url',
                        isManagedInRegistry: false,
                    });
                }
            }
        }
    }

    private getSurroundingText(contentOrLines: string | readonly string[], line: number): string {
        const lines =
            typeof contentOrLines === 'string'
                ? contentOrLines.length > 0
                    ? contentOrLines.split('\n')
                    : this.fileLines
                : contentOrLines;
        const prev = lines[line - 2] || '';
        const current = lines[line - 1] || '';
        const next = lines[line] || '';
        return `${prev}\n${current}\n${next}`;
    }
}

function inferLanguageFromPath(normPath: string): 'python' | 'rust' | 'gdscript' | 'typescript' {
    if (normPath.endsWith('.py')) return 'python';
    if (normPath.endsWith('.rs')) return 'rust';
    if (normPath.endsWith('.gd')) return 'gdscript';
    return 'typescript';
}

function isExcludedFile(normPath: string): boolean {
    return (
        normPath.includes('config') ||
        normPath.includes('schema') ||
        normPath.includes('test') ||
        normPath.includes('fixtures') ||
        normPath.includes('spec')
    );
}

function isFunctionBoundary(node: ts.Node): boolean {
    return (
        ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isConstructorDeclaration(node)
    );
}

function handleStaticImport(
    node: ts.ImportDeclaration,
    sourceFile: ts.SourceFile,
    filePath: string,
    isInsideFunction: boolean,
): ImportStatementInfo | null {
    const moduleSpecifier = ts.isStringLiteral(node.moduleSpecifier)
        ? node.moduleSpecifier.text
        : '';
    if (!moduleSpecifier) return null;

    const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
    const rawText = node.getText(sourceFile).trim();
    const category = categorizeImport(moduleSpecifier, 'typescript');
    const isWildcard =
        node.importClause?.namedBindings !== undefined &&
        ts.isNamespaceImport(node.importClause.namedBindings);
    const isTypeOnly = node.importClause?.isTypeOnly ?? false;

    return {
        file: filePath,
        line,
        rawText,
        moduleSpecifier,
        category,
        isInsideFunction,
        hasAuditExemption: false,
        isWildcard,
        isTypeOnly,
    };
}

function extractCallSpecifier(node: ts.CallExpression): string | undefined {
    const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
    const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
    if (!isDynamicImport && !isRequire) return undefined;

    const firstArg = node.arguments[0];
    return firstArg && ts.isStringLiteral(firstArg) ? firstArg.text : undefined;
}

function checkIndentFunctionState(
    line: string,
    trimmed: string,
    declRe: RegExp,
    currentIndent: number,
    inFunction: boolean,
    functionIndent: number,
): { inFunction: boolean; functionIndent: number } {
    if (declRe.test(line)) {
        return { inFunction: true, functionIndent: currentIndent };
    }
    if (inFunction && currentIndent <= functionIndent && trimmed.length > 0) {
        return { inFunction: false, functionIndent };
    }
    return { inFunction, functionIndent };
}

function checkRustFunctionState(
    line: string,
    trimmed: string,
    inFunction: boolean,
): { inFunction: boolean; functionIndent: number } {
    if (REGEX.SYNTAX.RUST_FN_DECL_HEADER.test(line)) {
        return { inFunction: true, functionIndent: 0 };
    }
    if (inFunction && trimmed === '}') {
        return { inFunction: false, functionIndent: 0 };
    }
    return { inFunction, functionIndent: 0 };
}

interface LanguageImportSpec {
    readonly pattern: RegExp;
    readonly extractSpecifier: (match: RegExpMatchArray) => string;
    readonly isWildcard: (trimmed: string) => boolean;
    readonly isTypeOnly?: (trimmed: string) => boolean;
    readonly supportsFunctionAndExemption: boolean;
}

const LANGUAGE_IMPORT_SPECS: Readonly<Record<string, LanguageImportSpec>> = Object.freeze({
    python: {
        pattern: REGEX.SYNTAX.PYTHON_FROM_IMPORT,
        extractSpecifier: (match) => match[1] || match[2],
        isWildcard: (trimmed) => trimmed.includes('import *'),
        supportsFunctionAndExemption: true,
    },
    rust: {
        pattern: REGEX.SYNTAX.RUST_USE_IMPORT,
        extractSpecifier: (match) => match[1],
        isWildcard: (trimmed) => trimmed.endsWith('::*;'),
        supportsFunctionAndExemption: true,
    },
    gdscript: {
        pattern: REGEX.SYNTAX.GDSCRIPT_LOAD_IMPORT,
        extractSpecifier: (match) => match[1],
        isWildcard: () => false,
        supportsFunctionAndExemption: true,
    },
    typescript: {
        pattern: REGEX.SYNTAX.TS_IMPORT_LINE,
        extractSpecifier: (match) => match[1],
        isWildcard: (trimmed) => REGEX.SYNTAX.TS_WILDCARD_IMPORT.test(trimmed),
        isTypeOnly: (trimmed) => /^\s*import\s+type\b/.test(trimmed),
        supportsFunctionAndExemption: false,
    },
});

interface LineImportParseInput {
    readonly trimmed: string;
    readonly language: string;
    readonly lines: readonly string[];
    readonly lineIndex: number;
    readonly lineNum: number;
    readonly filePath: string;
    readonly inFunction: boolean;
    readonly options?: DependencyLayoutOptions;
}

function parseLineImportBySpec(input: LineImportParseInput): ImportStatementInfo | null {
    const spec = LANGUAGE_IMPORT_SPECS[input.language] ?? LANGUAGE_IMPORT_SPECS.typescript;
    const match = input.trimmed.match(spec.pattern);
    if (!match) return null;

    const moduleSpecifier = spec.extractSpecifier(match);
    const categoryLang = (
        input.language in LANGUAGE_IMPORT_SPECS ? input.language : 'typescript'
    ) as 'python' | 'rust' | 'gdscript' | 'typescript';
    const category = categorizeImport(moduleSpecifier, categoryLang);
    const isWildcard = spec.isWildcard(input.trimmed);

    if (!spec.supportsFunctionAndExemption) {
        return {
            file: input.filePath,
            line: input.lineNum,
            rawText: input.trimmed,
            moduleSpecifier,
            category,
            isInsideFunction: false,
            hasAuditExemption: false,
            isWildcard,
            isTypeOnly: spec.isTypeOnly ? spec.isTypeOnly(input.trimmed) : undefined,
        };
    }

    const contextText = `${input.trimmed} ${input.lines[input.lineIndex - 1] || ''} ${input.lines[input.lineIndex + 1] || ''}`;
    const exemption = extractExemptionReason(contextText, input.options?.lazyImportExemptMarkers);
    return {
        file: input.filePath,
        line: input.lineNum,
        rawText: input.trimmed,
        moduleSpecifier,
        category,
        isInsideFunction: input.inFunction,
        hasAuditExemption: exemption !== undefined,
        exemptionReason: exemption,
        isWildcard,
    };
}
