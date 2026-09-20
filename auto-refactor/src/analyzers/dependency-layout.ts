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
        const language = normPath.endsWith('.py')
            ? 'python'
            : normPath.endsWith('.rs')
              ? 'rust'
              : normPath.endsWith('.gd')
                ? 'gdscript'
                : 'typescript';

        const imports: ImportStatementInfo[] = [];
        const resources: ExternalResourceRef[] = [];

        if (language === 'typescript' && sf && typeof sf.forEachChild === 'function') {
            this.analyzeTsWithAst(sf, ctx, imports, options);
        } else {
            this.analyzeWithLines(ctx, language, imports, options);
        }

        // Check hardcoded unmanaged URLs in business code (skip config/schema/test files)
        const isExcludedFile =
            normPath.includes('config') ||
            normPath.includes('schema') ||
            normPath.includes('test') ||
            normPath.includes('fixtures') ||
            normPath.includes('spec');

        if (!isExcludedFile) {
            this.extractRemoteResources(ctx, resources);
        }

        return analyzeDependencyLayout(imports, resources, language, options);
    }

    private analyzeTsWithAst(
        sf: ts.SourceFile,
        ctx: AnalyzerContext,
        imports: ImportStatementInfo[],
        options?: DependencyLayoutOptions,
    ): void {
        let functionNestingLevel = 0;

        const visit = (node: ts.Node): void => {
            const isFunctionBoundary =
                ts.isFunctionDeclaration(node) ||
                ts.isFunctionExpression(node) ||
                ts.isArrowFunction(node) ||
                ts.isMethodDeclaration(node) ||
                ts.isConstructorDeclaration(node);

            if (isFunctionBoundary) {
                functionNestingLevel++;
            }

            // Top-level or nested static import declaration: import ... from '...'
            if (ts.isImportDeclaration(node)) {
                const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
                const rawText = node.getText(sf).trim();
                const moduleSpecifier = ts.isStringLiteral(node.moduleSpecifier)
                    ? node.moduleSpecifier.text
                    : '';

                if (moduleSpecifier) {
                    const category = categorizeImport(moduleSpecifier, 'typescript');
                    const isWildcard =
                        node.importClause?.namedBindings !== undefined &&
                        ts.isNamespaceImport(node.importClause.namedBindings);

                    imports.push({
                        file: ctx.filePath,
                        line,
                        rawText,
                        moduleSpecifier,
                        category,
                        isInsideFunction: functionNestingLevel > 0,
                        hasAuditExemption: false,
                        isWildcard,
                    });
                }
            }

            // In-function dynamic import or require: require('...') / import('...')
            if (ts.isCallExpression(node)) {
                let specifier: string | undefined;
                const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
                const isRequire =
                    ts.isIdentifier(node.expression) && node.expression.text === 'require';

                if (isDynamicImport || isRequire) {
                    const firstArg = node.arguments[0];
                    if (firstArg && ts.isStringLiteral(firstArg)) {
                        specifier = firstArg.text;
                    }
                }

                if (specifier) {
                    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
                    const rawText = node.getText(sf).trim();
                    const category = categorizeImport(specifier, 'typescript');
                    const surroundingText = this.getSurroundingText(ctx.content, line);
                    const exemption = extractExemptionReason(
                        surroundingText,
                        options?.lazyImportExemptMarkers,
                    );

                    imports.push({
                        file: ctx.filePath,
                        line,
                        rawText,
                        moduleSpecifier: specifier,
                        category,
                        isInsideFunction: functionNestingLevel > 0,
                        hasAuditExemption: exemption !== undefined,
                        exemptionReason: exemption,
                        isWildcard: false,
                    });
                }
            }

            ts.forEachChild(node, visit);

            if (isFunctionBoundary) {
                functionNestingLevel--;
            }
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
            if (/^\s*(?:def|class)\s+[A-Za-z0-9_]+/.test(line)) {
                return { inFunction: true, functionIndent: currentIndent };
            }
            if (inFunction && currentIndent <= functionIndent && trimmed.length > 0) {
                return { inFunction: false, functionIndent };
            }
        } else if (language === 'gdscript') {
            if (/^\s*func\s+[A-Za-z0-9_]+/.test(line)) {
                return { inFunction: true, functionIndent: currentIndent };
            }
            if (inFunction && currentIndent <= functionIndent && trimmed.length > 0) {
                return { inFunction: false, functionIndent };
            }
        } else if (language === 'rust') {
            if (/^\s*(?:pub\s+)?(?:async\s+)?fn\s+[A-Za-z0-9_]+/.test(line)) {
                return { inFunction: true, functionIndent: 0 };
            }
            if (inFunction && trimmed === '}') {
                return { inFunction: false, functionIndent: 0 };
            }
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
        if (language === 'python') {
            const pyMatch = trimmed.match(PY_IMPORT_RE);
            if (!pyMatch) return null;
            const mod = pyMatch[1] || pyMatch[2];
            const isWildcard = trimmed.includes('import *');
            const category = categorizeImport(mod, 'python');
            const exemption = extractExemptionReason(
                trimmed + ' ' + (lines[i - 1] || '') + ' ' + (lines[i + 1] || ''),
                options?.lazyImportExemptMarkers,
            );
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
        if (language === 'rust') {
            const rustMatch = trimmed.match(RUST_USE_RE);
            if (!rustMatch) return null;
            const mod = rustMatch[1];
            const isWildcard = trimmed.endsWith('::*;');
            const category = categorizeImport(mod, 'rust');
            const exemption = extractExemptionReason(
                trimmed + ' ' + (lines[i - 1] || '') + ' ' + (lines[i + 1] || ''),
                options?.lazyImportExemptMarkers,
            );
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
        if (language === 'gdscript') {
            const gdMatch = trimmed.match(GDSCRIPT_IMPORT_RE);
            if (!gdMatch) return null;
            const mod = gdMatch[1];
            const category = categorizeImport(mod, 'gdscript');
            const exemption = extractExemptionReason(
                trimmed + ' ' + (lines[i - 1] || '') + ' ' + (lines[i + 1] || ''),
                options?.lazyImportExemptMarkers,
            );
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
        const topMatch = trimmed.match(
            /^\s*(?:import\s+(?:type\s+)?(?:[\s\S]*?from\s+)?|const\s+.*=\s*require\()['"]([^'"]+)['"]/,
        );
        if (topMatch) {
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
        return null;
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
