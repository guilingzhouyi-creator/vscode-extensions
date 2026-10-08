/**
 * Module: Static Analysis Engine — VS Code Extension Domain Adapter
 * File Path: src/analyzers/vscode-extension.ts
 * Architecture Role: Domain adapter mapping VS Code extension contracts to generalized patterns.
 * Dependencies & Triggers: Core types, source-mask, and patterns kernel.
 * Responsibilities:
 *   1. VSC-MEM-001: Guard against Disposable leaks via generalized lifecycle matcher.
 *   2. VSC-PERF-001: Guard against main thread blocking I/O via generalized blocking matcher.
 *   3. VSC-I18N-001: Guard against un-localized UI notifications via presentation literal matcher.
 *   4. VSC-UI-001: Guard against unbounded Webview collection lists lacking folding/threshold.
 *   5. VSC-UI-002: Guard against hardcoded colors without VS Code theme variables.
 *   6. VSC-PERF-002: Guard against CSS transitions on geometry layout properties causing reflow.
 *   7. VSC-UI-003: Guard against interactive form controls lacking accessible labels (A11y).
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

        // 4. VSC-UI-001: Webview dynamic collection rendering bounded density & folding
        const uiFoldingViolations = this.detectUnboundedCollectionRendering(raw, masked);
        for (const f of uiFoldingViolations) {
            issues.push(
                makeVscIssue(
                    file,
                    f.line,
                    'VSC-UI-001',
                    SEVERITY_WARNING,
                    'Webview collection list rendering lacks bounded density or folding controls.',
                    'Add .slice(0, threshold) or collapse/expand controls to prevent unbounded UI height.',
                    { line: f.line, text: f.text },
                ),
            );
        }

        // 5. VSC-UI-002: Webview CSS theme variable completeness & high-contrast guard
        const colorViolations = this.detectHardcodedThemeColors(raw);
        for (const c of colorViolations) {
            issues.push(
                makeVscIssue(
                    file,
                    c.line,
                    'VSC-UI-002',
                    SEVERITY_ERROR,
                    `Webview UI contains hardcoded color '${c.color}' instead of theme CSS variables.`,
                    'Replace hardcoded color with var(--vscode-*) or adaptive color scheme variable.',
                    { line: c.line, text: c.text, color: c.color },
                ),
            );
        }

        // 6. VSC-PERF-002: Webview CSS transition on geometry layout properties causing reflow
        const layoutTransitionViolations = this.detectLayoutTransitions(raw);
        for (const t of layoutTransitionViolations) {
            issues.push(
                makeVscIssue(
                    file,
                    t.line,
                    'VSC-PERF-002',
                    SEVERITY_WARNING,
                    `Webview CSS transition directly animates geometry layout property '${t.prop}' triggering expensive browser reflow.`,
                    "Replace geometry transition with GPU-accelerated 'transform' (e.g. scaleX/scaleY) or 'opacity'.",
                    { line: t.line, text: t.text, prop: t.prop },
                ),
            );
        }

        // 7. VSC-UI-003: Webview interactive form controls missing accessible labels
        //    conforming to WCAG 4.1.2 requirements.
        const a11yViolations = this.detectInaccessibleFormControls(raw);
        for (const a of a11yViolations) {
            issues.push(
                makeVscIssue(
                    file,
                    a.line,
                    'VSC-UI-003',
                    SEVERITY_WARNING,
                    `Webview interactive <${a.tag}> form control lacks accessible label binding (WCAG 4.1.2).`,
                    "Add 'aria-label', 'aria-labelledby', or associate with a '<label for=\"...\">'.",
                    { line: a.line, text: a.text, tag: a.tag },
                ),
            );
        }

        return issues;
    }

    private detectUnboundedCollectionRendering(
        rawLines: string[],
        maskedLines: string[],
    ): Array<{ line: number; text: string }> {
        const violations: Array<{ line: number; text: string }> = [];
        for (let i = 0; i < rawLines.length; i++) {
            const raw = rawLines[i];
            const masked = maskedLines[i];
            const isMapping =
                /\.(?:map)\s*\([^)]*=>\s*`[^`]*(?:<tr|<li|<div|<option)/i.test(raw) ||
                (/\.(?:map)\s*\([^)]*=>/i.test(masked) &&
                    i + 1 < rawLines.length &&
                    /`[^`]*(?:<tr|<li|<div|<option)/i.test(rawLines[i + 1]));

            if (isMapping) {
                const windowStart = Math.max(0, i - 4);
                const windowEnd = Math.min(rawLines.length, i + 5);
                const surrounding = rawLines.slice(windowStart, windowEnd).join('\n');
                const hasBounds =
                    /(?:\.slice\s*\(|isExpanded|expanded|fold|collapse|limit|maxCount|truncate|showAll|threshold)/i.test(
                        surrounding,
                    );
                if (!hasBounds) {
                    violations.push({ line: i + 1, text: raw.trim() });
                }
            }
        }
        return violations;
    }

    private detectHardcodedThemeColors(
        rawLines: string[],
    ): Array<{ line: number; text: string; color: string }> {
        const violations: Array<{ line: number; text: string; color: string }> = [];
        const colorRe =
            /(?:style\s*=\s*['"][^'"]*?(?:color|background|fill|stroke)\s*:\s*|fill\s*=\s*['"]|stroke\s*=\s*['"])(#[0-9a-fA-F]{3,6}|black|white)\b/i;
        for (let i = 0; i < rawLines.length; i++) {
            const line = rawLines[i];
            if (!/<(?:div|span|p|table|td|th|tr|svg|path|circle|rect|style)\b/i.test(line)) {
                continue;
            }
            const m = colorRe.exec(line);
            if (m) {
                const matchedColor = m[1].toLowerCase();
                const monochrome = ['#000', '#000000', '#fff', '#ffffff', 'black', 'white'];
                if (monochrome.includes(matchedColor) && !line.includes('var(--vscode-')) {
                    violations.push({ line: i + 1, text: line.trim(), color: m[1] });
                }
            }
        }
        return violations;
    }

    private detectLayoutTransitions(
        rawLines: string[],
    ): Array<{ line: number; text: string; prop: string }> {
        const violations: Array<{ line: number; text: string; prop: string }> = [];
        const re = /transition\s*:[^;]*\b(width|height|top|bottom|left|right|margin|padding)\b/i;
        for (let i = 0; i < rawLines.length; i++) {
            const line = rawLines[i];
            const m = re.exec(line);
            if (m) {
                violations.push({ line: i + 1, text: line.trim(), prop: m[1] });
            }
        }
        return violations;
    }

    private detectInaccessibleFormControls(
        rawLines: string[],
    ): Array<{ line: number; text: string; tag: string }> {
        const violations: Array<{ line: number; text: string; tag: string }> = [];
        for (let i = 0; i < rawLines.length; i++) {
            const line = rawLines[i];
            if (/<(?:input|select)\b/i.test(line)) {
                if (/type\s*=\s*['"]hidden['"]/i.test(line)) continue;
                const hasA11y =
                    /aria-label|aria-labelledby|role\s*=\s*['"]switch['"]/i.test(line) ||
                    /<label\b[^>]*\bfor\s*=/i.test(line);
                if (!hasA11y) {
                    const windowStart = Math.max(0, i - 2);
                    const windowEnd = Math.min(rawLines.length, i + 3);
                    const surrounding = rawLines.slice(windowStart, windowEnd).join('\n');
                    const windowHasA11y =
                        /aria-label|aria-labelledby|role\s*=\s*['"]switch['"]|<label\b[^>]*\bfor\s*=/i.test(
                            surrounding,
                        );
                    if (!windowHasA11y) {
                        const tag = /<([a-z]+)/i.exec(line)?.[1] ?? 'input';
                        violations.push({ line: i + 1, text: line.trim(), tag });
                    }
                }
            }
        }
        return violations;
    }
}
