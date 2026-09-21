/**
 * Module: Static Analysis — Import, Dependency & External Resource Layout
 * File Path: src/analyzers/dependency-layout.ts
 * Architecture Role: Analyzer adapter implementing the Analyzer contract; inspects file layout,
 *   import grouping orders, in-function imports, and unmanaged remote URLs.
 * Dependencies & Triggers: Core types (Analyzer, AnalyzerContext, Issue), dependencyLayout
 *   intelligence module; triggered when 'dependency-layout' analyzer is enabled.
 * Responsibilities: Enforce canonical layout order (DEP-ORD-001); audit in-function imports
 *   (DEP-LAZ-001); flag unmanaged hardcoded external URLs (DEP-RES-001); detect wildcard
 *   imports (DEP-WLD-001); flag inverted dependency references (DEP-INV-001).
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

/** Pattern detecting remote URLs. */
const REMOTE_URL_RE = /['"](https?:\/\/[A-Za-z0-9_./?=&%-]+)['"]/g;

/** Patterns for polyglot import extraction */
const PY_IMPORT_RE = /^\s*(?:from\s+([A-Za-z0-9_.]+)\s+import|import\s+([A-Za-z0-9_.]+))/;
const RUST_USE_RE = /^\s*use\s+([A-Za-z0-9_:]+)/;
const GDSCRIPT_IMPORT_RE = /(?:preload|load)\s*\(\s*['"](?:res:\/\/)?([^'"]+)['"]\s*\)/;

/**
 * Analyzer enforcing file layout, import discipline, and external resource management.
 */
export class DependencyLayoutAnalyzer implements Analyzer {
    name = 'dependency-layout' as const;

    analyze(sf: ts.SourceFile, ctx: AnalyzerContext): Issue[] {
        const options = (ctx.config.analyzers['dependency-layout']?.options ||
            {}) as DependencyLayoutOptions;
        const normPath = ctx.filePath.replace(/\\/g, '/');
        const language = inferLanguageFromPath(normPath);

        const imports: ImportStatementInfo[] = [];
        const resources: ExternalResourceRef[] = [];

        if (language === 'typescript' && sf && typeof sf.forEachChild === 'function') {
            this.analyzeTsWithAst(sf, ctx, imports, options);
        } else {
            this.analyzeWithLines(ctx, language, imports, options);
        }

        if (!isExcludedFile(normPath)) {
            this.extractRemoteResources(ctx, resources);
        }

        return analyzeDependencyLayout(imports, resources, language, options);
    }

    private handleCallImport(
        node: ts.CallExpression,
        sf: ts.SourceFile,
        ctx: AnalyzerContext,
        isInsideFunction: boolean,
        options?: DependencyLayoutOptions,
    ): ImportStatementInfo | null {
        const specifier = extractCallSpecifier(node);
        if (!specifier) return null;

        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        const rawText = node.getText(sf).trim();
        const category = categorizeImport(specifier, 'typescript');
        const surroundingText = this.getSurroundingText(ctx.content, line);
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
        sf: ts.SourceFile,
        ctx: AnalyzerContext,
        imports: ImportStatementInfo[],
        options?: DependencyLayoutOptions,
    ): void {
        let functionNestingLevel = 0;

        const visit = (node: ts.Node): void => {
            const isFn = isFunctionBoundary(node);
            if (isFn) functionNestingLevel++;

            if (ts.isImportDeclaration(node)) {
                const info = handleStaticImport(node, sf, ctx.filePath, functionNestingLevel > 0);
                if (info) imports.push(info);
            } else if (ts.isCallExpression(node)) {
                const info = this.handleCallImport(
                    node,
                    sf,
                    ctx,
                    functionNestingLevel > 0,
                    options,
                );
                if (info) imports.push(info);
            }

            ts.forEachChild(node, visit);
            if (isFn) functionNestingLevel--;
        };

        visit(sf);
    }

    private analyzeWithLines(
        ctx: AnalyzerContext,
        language: string,
        imports: ImportStatementInfo[],
        options?: DependencyLayoutOptions,
    ): void {
        const lines = ctx.content.split('\n');
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

            const parsed = this.parseLineImport(
                trimmed,
                language,
                lines,
                i,
                lineNum,
                ctx.filePath,
                inFunction,
                options,
            );
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
                /^\s*(?:def|class)\s+[A-Za-z0-9_]+/,
                currentIndent,
                inFunction,
                functionIndent,
            );
        }
        if (language === 'gdscript') {
            return checkIndentFunctionState(
                line,
                trimmed,
                /^\s*func\s+[A-Za-z0-9_]+/,
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

    private parseLineImport(
        trimmed: string,
        language: string,
        lines: string[],
        i: number,
        lineNum: number,
        filePath: string,
        inFunction: boolean,
        options?: DependencyLayoutOptions,
    ): ImportStatementInfo | null {
        const contextText = `${trimmed} ${lines[i - 1] || ''} ${lines[i + 1] || ''}`;
        if (language === 'python') {
            return parsePythonLineImport(
                trimmed,
                contextText,
                filePath,
                lineNum,
                inFunction,
                options,
            );
        }
        if (language === 'rust') {
            return parseRustLineImport(
                trimmed,
                contextText,
                filePath,
                lineNum,
                inFunction,
                options,
            );
        }
        if (language === 'gdscript') {
            return parseGdscriptLineImport(
                trimmed,
                contextText,
                filePath,
                lineNum,
                inFunction,
                options,
            );
        }
        return parseTsLineImport(trimmed, filePath, lineNum);
    }

    private extractRemoteResources(ctx: AnalyzerContext, resources: ExternalResourceRef[]): void {
        const lines = ctx.content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineNum = i + 1;
            REMOTE_URL_RE.lastIndex = 0;
            let urlMatch: RegExpExecArray | null;

            while ((urlMatch = REMOTE_URL_RE.exec(line)) !== null) {
                const url = urlMatch[1];
                if (
                    !url.includes('json-schema.org') &&
                    !url.includes('example.com') &&
                    !url.includes('localhost') &&
                    !url.includes('127.0.0.1')
                ) {
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

    private getSurroundingText(content: string, line: number): string {
        const lines = content.split('\n');
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
    sf: ts.SourceFile,
    filePath: string,
    isInsideFunction: boolean,
): ImportStatementInfo | null {
    const moduleSpecifier = ts.isStringLiteral(node.moduleSpecifier)
        ? node.moduleSpecifier.text
        : '';
    if (!moduleSpecifier) return null;

    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
    const rawText = node.getText(sf).trim();
    const category = categorizeImport(moduleSpecifier, 'typescript');
    const isWildcard =
        node.importClause?.namedBindings !== undefined &&
        ts.isNamespaceImport(node.importClause.namedBindings);

    return {
        file: filePath,
        line,
        rawText,
        moduleSpecifier,
        category,
        isInsideFunction,
        hasAuditExemption: false,
        isWildcard,
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
    if (/^\s*(?:pub\s+)?(?:async\s+)?fn\s+[A-Za-z0-9_]+/.test(line)) {
        return { inFunction: true, functionIndent: 0 };
    }
    if (inFunction && trimmed === '}') {
        return { inFunction: false, functionIndent: 0 };
    }
    return { inFunction, functionIndent: 0 };
}

function parsePythonLineImport(
    trimmed: string,
    contextText: string,
    filePath: string,
    lineNum: number,
    inFunction: boolean,
    options?: DependencyLayoutOptions,
): ImportStatementInfo | null {
    const pyMatch = trimmed.match(PY_IMPORT_RE);
    if (!pyMatch) return null;
    const mod = pyMatch[1] || pyMatch[2];
    const isWildcard = trimmed.includes('import *');
    const category = categorizeImport(mod, 'python');
    const exemption = extractExemptionReason(contextText, options?.lazyImportExemptMarkers);
    return {
        file: filePath,
        line: lineNum,
        rawText: trimmed,
        moduleSpecifier: mod,
        category,
        isInsideFunction: inFunction,
        hasAuditExemption: exemption !== undefined,
        exemptionReason: exemption,
        isWildcard,
    };
}

function parseRustLineImport(
    trimmed: string,
    contextText: string,
    filePath: string,
    lineNum: number,
    inFunction: boolean,
    options?: DependencyLayoutOptions,
): ImportStatementInfo | null {
    const rustMatch = trimmed.match(RUST_USE_RE);
    if (!rustMatch) return null;
    const mod = rustMatch[1];
    const isWildcard = trimmed.endsWith('::*;');
    const category = categorizeImport(mod, 'rust');
    const exemption = extractExemptionReason(contextText, options?.lazyImportExemptMarkers);
    return {
        file: filePath,
        line: lineNum,
        rawText: trimmed,
        moduleSpecifier: mod,
        category,
        isInsideFunction: inFunction,
        hasAuditExemption: exemption !== undefined,
        exemptionReason: exemption,
        isWildcard,
    };
}

function parseGdscriptLineImport(
    trimmed: string,
    contextText: string,
    filePath: string,
    lineNum: number,
    inFunction: boolean,
    options?: DependencyLayoutOptions,
): ImportStatementInfo | null {
    const gdMatch = trimmed.match(GDSCRIPT_IMPORT_RE);
    if (!gdMatch) return null;
    const mod = gdMatch[1];
    const category = categorizeImport(mod, 'gdscript');
    const exemption = extractExemptionReason(contextText, options?.lazyImportExemptMarkers);
    return {
        file: filePath,
        line: lineNum,
        rawText: trimmed,
        moduleSpecifier: mod,
        category,
        isInsideFunction: inFunction,
        hasAuditExemption: exemption !== undefined,
        exemptionReason: exemption,
        isWildcard: false,
    };
}

function parseTsLineImport(
    trimmed: string,
    filePath: string,
    lineNum: number,
): ImportStatementInfo | null {
    const topMatch = trimmed.match(
        /^\s*(?:import\s+(?:type\s+)?(?:[\s\S]*?from\s+)?|const\s+.*=\s*require\()['"]([^'"]+)['"]/,
    );
    if (!topMatch) return null;
    const specifier = topMatch[1];
    const category = categorizeImport(specifier, 'typescript');
    const isWildcard = /\b(?:import\s+\*\s+as|import\s+\*)/.test(trimmed);
    return {
        file: filePath,
        line: lineNum,
        rawText: trimmed,
        moduleSpecifier: specifier,
        category,
        isInsideFunction: false,
        hasAuditExemption: false,
        isWildcard,
    };
}
