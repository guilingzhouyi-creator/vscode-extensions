/**
 * Module: Static Analysis Engine — VS Code Extension Domain Adapter
 * File Path: src/analyzers/vscode-extension.ts
 * Architecture Role: Domain adapter mapping VS Code extension contracts to generalized patterns.
 * Dependencies & Triggers: Core types, source-mask, and patterns kernel.
 * Responsibilities:
 *   1. VSC-MEM-001: Guard against Disposable leaks via generalized lifecycle matcher.
 *   2. VSC-PERF-001: Guard against main thread blocking I/O via generalized blocking matcher.
 *   3. VSC-I18N-001: Guard against un-localized UI notifications via presentation literal matcher.
 * Exit Semantics & Design Rationale: Pure, fail-safe scanner returning Issue[]. Zero throw.
 */

import type { Analyzer, AnalyzerContext, Issue, Severity } from '../core/types';
import { SEVERITY_ERROR, SEVERITY_WARNING } from '../core/types';
import { ANALYZER_VSCODE_EXTENSION } from '../core/scoring/dimensionLiterals';
import { maskSourceText, type SourceMaskConfig } from '../core/policy/source-mask';
import {
    matchResourceLifecycle,
    matchBlockingCalls,
    matchPresentationLiterals,
    type ResourceLifecyclePattern,
    type BlockingCallPattern,
    type PresentationLiteralPattern,
} from '../core/patterns';

const ACCEPTED_EXTENSIONS = ['.ts', '.js'];

const TS_JS_MASK: SourceMaskConfig = {
    lineComment: '//',
    blockComment: { open: '/*', close: '*/' },
    quoteChars: '"\'`',
    multilineTemplates: true,
};

const VSC_LIFECYCLE_PATTERN: ResourceLifecyclePattern = {
    name: 'vsc-disposables',
    acquisitionPatterns: [
        /(?:vscode\.)?(?:commands\.(?:registerCommand|registerTextEditorCommand)|window\.onDidChange\w+|workspace\.onDidChange\w+|languages\.register\w+)\s*\(/,
    ],
    containerPatterns: [/(?:subscriptions|context\.subscriptions)\.push\s*\(/],
    trackingWindowLines: 6,
};

const VSC_BLOCKING_PATTERN: BlockingCallPattern = {
    name: 'vsc-blocking-fs',
    blockingCalls: [
        /\bfs\.(?:readFileSync|writeFileSync|appendFileSync|mkdirSync|rmSync|unlinkSync)\s*\(/,
    ],
};

const VSC_I18N_PATTERN: PresentationLiteralPattern = {
    name: 'vsc-notifications',
    presentationSinks: [
        /(?:vscode\.)?window\.(?:showInformationMessage|showWarningMessage|showErrorMessage|setStatusBarMessage)\s*\(\s*(['"`][^'"`]+['"`])/,
    ],
    i18nWrappers: [/(?:vscode\.l10n\.t|l10n\.t|i18n\.t|localize|t)\s*\(/],
};

function makeVscIssue(
    file: string,
    line: number,
    rule: string,
    severity: Severity,
    message: string,
    suggestion: string,
    detail: Record<string, unknown>,
): Issue {
    return {
        id: `${ANALYZER_VSCODE_EXTENSION}:${rule}:${file}:${line}`,
        analyzer: ANALYZER_VSCODE_EXTENSION,
        rule,
        severity,
        message,
        location: { file, start: { line, column: 1 }, end: { line, column: 1 } },
        detail,
        suggestion,
    };
}

function isExemptPath(file: string): boolean {
    const lower = file.toLowerCase();
    return (
        lower.startsWith('test/') ||
        lower.startsWith('tests/') ||
        lower.startsWith('fixtures/') ||
        lower.startsWith('scripts/') ||
        lower.includes('/test/') ||
        lower.includes('/tests/') ||
        lower.includes('/fixtures/') ||
        lower.includes('/scripts/') ||
        lower.includes('.test.') ||
        lower.includes('.spec.')
    );
}

/**
 * VS Code extension domain analyzer enforcing lifecycle subscriptions,
 * async I/O performance, and multi-language internationalization.
 */
export class VscodeExtensionAnalyzer implements Analyzer {
    readonly name = ANALYZER_VSCODE_EXTENSION;

    /**
     * Streaming finalization hook invoked per file.
     *
     * @param ctx - File scan context.
     * @returns Array of issues found in the file.
     */
    finalize(ctx: AnalyzerContext): Issue[] {
        return this.analyze(undefined, ctx);
    }

    /**
     * Synchronous analysis routine for VS Code extension domain rules.
     * Concurrency: Thread-safe, reentrant, zero mutable shared state.
     *
     * @param _sf - Unused AST source file parameter.
     * @param ctx - File scan context containing content and path.
     * @returns Array of discovered issues.
     */
    analyze(_sf: unknown, ctx: AnalyzerContext): Issue[] {
        const file = ctx.filePath.replace(/\\/g, '/');
        const hasValidExt = ACCEPTED_EXTENSIONS.some((ext) => file.endsWith(ext));
        if (!hasValidExt) return [];
        if (isExemptPath(file)) return [];

        const content = ctx.content || '';
        if (content.length === 0) return [];

        const { raw, masked } = maskSourceText(content, TS_JS_MASK);
        const issues: Issue[] = [];

        // 1. VSC-MEM-001 via generalized lifecycle matcher
        const lifecycleViolations = matchResourceLifecycle(masked, VSC_LIFECYCLE_PATTERN);
        for (const v of lifecycleViolations) {
            const msg =
                v.reason === 'unregistered'
                    ? 'VS Code Disposable resource created without subscription registration.'
                    : `Disposable '${v.resourceIdentifier}' is not registered into context.subscriptions.`;
            const sugg =
                v.reason === 'unregistered'
                    ? 'Wrap call in context.subscriptions.push(...) or track in a composite Disposable.'
                    : 'Push the disposable variable to context.subscriptions to prevent memory leak upon reload.';
            issues.push(
                makeVscIssue(file, v.line, 'VSC-MEM-001', SEVERITY_ERROR, msg, sugg, {
                    line: v.line,
                    text: v.rawText,
                    variable: v.resourceIdentifier,
                }),
            );
        }

        // 2. VSC-PERF-001 via generalized blocking matcher
        const blockingViolations = matchBlockingCalls(masked, VSC_BLOCKING_PATTERN);
        for (const b of blockingViolations) {
            issues.push(
                makeVscIssue(
                    file,
                    b.line,
                    'VSC-PERF-001',
                    SEVERITY_WARNING,
                    'Synchronous file I/O call on Extension Host main thread risks freezing the IDE editor UI.',
                    'Replace synchronous fs call with asynchronous fs.promises or vscode.workspace.fs.',
                    { line: b.line, call: b.callName },
                ),
            );
        }

        // 3. VSC-I18N-001 via generalized presentation literal matcher
        const i18nViolations = matchPresentationLiterals(raw, VSC_I18N_PATTERN);
        for (const lit of i18nViolations) {
            issues.push(
                makeVscIssue(
                    file,
                    lit.line,
                    'VSC-I18N-001',
                    SEVERITY_WARNING,
                    `User-facing notification contains hardcoded string literal ${lit.literalText} without localization.`,
                    'Wrap user-facing messages in vscode.l10n.t(...) or import strings from the bilingual dictionary.',
                    { line: lit.line, text: lit.literalText },
                ),
            );
        }

        return issues;
    }
}
