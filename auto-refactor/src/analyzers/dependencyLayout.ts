/**
 * Module: Static Analysis — Import, Dependency & External Resource Layout
 * File Path: src/analyzers/dependencyLayout.ts
 * Architecture Role: Analyzer adapter implementing the Analyzer contract; inspects file layout,
 *   import grouping orders, in-function imports, and unmanaged remote URLs.
 * Dependencies & Triggers: Core types (Analyzer, AnalyzerContext, Issue), dependencyLayout
 *   intelligence module; triggered when 'dependency-layout' analyzer is enabled.
 * Responsibilities: Enforce canonical layout order (DEP-ORD-001); audit in-function imports
 *   (DEP-LAZ-001); flag unmanaged hardcoded external URLs (DEP-RES-001); detect wildcard
 *   imports (DEP-WLD-001).
 * Exit Semantics & Design Rationale: Stateless and synchronous per file; returns Issue[] and
 *   never throws.
 */

import type * as ts from 'typescript';
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

/** Pattern detecting import statements in TS/JS. */
const JS_IMPORT_RE =
    /^\s*(?:import\s+(?:type\s+)?(?:[\s\S]*?from\s+)?|const\s+.*=\s*require\()['"]([^'"]+)['"]/;

/** Pattern detecting in-function require or import. */
const IN_FN_IMPORT_RE = /\b(?:require\(['"]([^'"]+)['"]\)|import\(['"]([^'"]+)['"]\))/;

/** Pattern detecting wildcard imports. */
const WILDCARD_IMPORT_RE = /\b(?:import\s+\*\s+as|import\s+\*)/;

/** Pattern detecting remote URLs. */
const REMOTE_URL_RE = /['"](https?:\/\/[A-Za-z0-9_./?=&%-]+)['"]/g;

/**
 * Analyzer enforcing file layout, import discipline, and external resource management.
 */
export class DependencyLayoutAnalyzer implements Analyzer {
    name = 'dependency-layout' as const;

    analyze(sf: ts.SourceFile, ctx: AnalyzerContext): Issue[] {
        void sf;
        const options = (ctx.config.analyzers['dependency-layout']?.options ||
            {}) as DependencyLayoutOptions;
        const language = ctx.filePath.endsWith('.py')
            ? 'python'
            : ctx.filePath.endsWith('.rs')
              ? 'rust'
              : ctx.filePath.endsWith('.gd')
                ? 'gdscript'
                : 'typescript';

        const lines = ctx.content.split('\n');
        const imports: ImportStatementInfo[] = [];
        const resources: ExternalResourceRef[] = [];

        let inFunction = false;
        let indentLevel = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineNum = i + 1;

            if (/\b(?:function|class|def|fn)\s+[A-Za-z0-9_$]+/.test(line)) {
                inFunction = true;
                indentLevel = line.search(/\S/);
            }

            if (inFunction && line.trim() === '}' && line.search(/\S/) <= indentLevel) {
                inFunction = false;
            }

            // Top-level or in-function import check
            const topMatch = line.match(JS_IMPORT_RE);
            if (topMatch) {
                const specifier = topMatch[1];
                const category = categorizeImport(specifier, language);
                const isWildcard = WILDCARD_IMPORT_RE.test(line);

                imports.push({
                    file: ctx.filePath,
                    line: lineNum,
                    rawText: line.trim(),
                    moduleSpecifier: specifier,
                    category,
                    isInsideFunction: inFunction,
                    hasAuditExemption: false,
                    isWildcard,
                });
            } else {
                const inFnMatch = line.match(IN_FN_IMPORT_RE);
                if (inFnMatch && inFunction) {
                    const specifier = inFnMatch[1] || inFnMatch[2];
                    const category = categorizeImport(specifier, language);
                    const exemption = extractExemptionReason(line + ' ' + (lines[i - 1] || ''));

                    imports.push({
                        file: ctx.filePath,
                        line: lineNum,
                        rawText: line.trim(),
                        moduleSpecifier: specifier,
                        category,
                        isInsideFunction: true,
                        hasAuditExemption: exemption !== undefined,
                        exemptionReason: exemption,
                        isWildcard: false,
                    });
                }
            }

            // Check hardcoded URLs in business code (skip config/schema files)
            const isConfigFile =
                ctx.filePath.includes('config') ||
                ctx.filePath.includes('schema') ||
                ctx.filePath.includes('test');
            if (!isConfigFile) {
                REMOTE_URL_RE.lastIndex = 0;
                let urlMatch;
                while ((urlMatch = REMOTE_URL_RE.exec(line)) !== null) {
                    const url = urlMatch[1];
                    // Exclude standard schemas and docs
                    if (!url.includes('json-schema.org') && !url.includes('example.com')) {
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

        return analyzeDependencyLayout(imports, resources, language, options);
    }
}
