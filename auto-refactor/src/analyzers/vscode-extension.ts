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
 *   8. VSC-UI-004: Guard against dynamic border jitter in interactive states.
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

// ── File Extension & Source Masking Constants ──
const EXT_TS = '.ts';
const EXT_JS = '.js';
const ACCEPTED_EXTENSIONS: readonly string[] = Object.freeze([EXT_TS, EXT_JS] as const);

const MASK_LINE_COMMENT = '//';
const MASK_BLOCK_OPEN = '/*';
const MASK_BLOCK_CLOSE = '*/';
const MASK_QUOTE_CHARS = '"\'`';

const TS_JS_MASK: SourceMaskConfig = Object.freeze({
    lineComment: MASK_LINE_COMMENT,
    blockComment: Object.freeze({ open: MASK_BLOCK_OPEN, close: MASK_BLOCK_CLOSE }),
    quoteChars: MASK_QUOTE_CHARS,
    multilineTemplates: true,
});

// ── Pattern Configuration Constants ──
const TRACKING_WINDOW_LINES = 6;
const PATTERN_NAME_DISPOSABLES = 'vsc-disposables';
const PATTERN_NAME_BLOCKING_FS = 'vsc-blocking-fs';
const PATTERN_NAME_NOTIFICATIONS = 'vsc-notifications';

const VSC_LIFECYCLE_PATTERN: ResourceLifecyclePattern = Object.freeze({
    name: PATTERN_NAME_DISPOSABLES,
    acquisitionPatterns: [
        /(?:vscode\.)?(?:commands\.(?:registerCommand|registerTextEditorCommand)|window\.onDidChange\w+|workspace\.onDidChange\w+|languages\.register\w+)\s*\(/,
    ],
    containerPatterns: [/(?:subscriptions|context\.subscriptions)\.push\s*\(/],
    trackingWindowLines: TRACKING_WINDOW_LINES,
});

const VSC_BLOCKING_PATTERN: BlockingCallPattern = Object.freeze({
    name: PATTERN_NAME_BLOCKING_FS,
    blockingCalls: [
        /\bfs\.(?:readFileSync|writeFileSync|appendFileSync|mkdirSync|rmSync|unlinkSync)\s*\(/,
    ],
});

const VSC_I18N_PATTERN: PresentationLiteralPattern = Object.freeze({
    name: PATTERN_NAME_NOTIFICATIONS,
    presentationSinks: [
        /(?:vscode\.)?window\.(?:showInformationMessage|showWarningMessage|showErrorMessage|setStatusBarMessage)\s*\(\s*(['"`][^'"`]+['"`])/,
    ],
    i18nWrappers: [/(?:vscode\.l10n\.t|l10n\.t|i18n\.t|localize|t)\s*\(/],
});

// ── Numerical Window & Layout Limits ──
const COLLECTION_WINDOW_BEFORE = 4;
const COLLECTION_WINDOW_AFTER = 5;
const FORM_A11Y_WINDOW_BEFORE = 2;
const FORM_A11Y_WINDOW_AFTER = 3;

// ── Query Tokens & Format Constants ──
const REASON_UNREGISTERED = 'unregistered';
const THEME_CSS_VAR_PREFIX = 'var(--vscode-';
const DEFAULT_FORM_TAG = 'input';
const LINE_BREAK = '\n';

// ── Frozen Monochrome Palette Set (O(1) Search, Zero Transient Allocations) ──
const MONOCHROME_COLORS: ReadonlySet<string> = new Set([
    '#000',
    '#000000',
    '#fff',
    '#ffffff',
    'black',
    'white',
]);

// ── Regular Expression for Exempt Path Matching ──
const EXEMPT_PATH_RE = /(?:^|\/)(?:tests?|fixtures|scripts)\/|\.(?:test|spec)\./;

// ── Diagnostic Messages & Suggestions (SSOT) ──
const MSG_MEM_UNREGISTERED =
    'VS Code Disposable resource created without subscription registration.';
const SUGG_MEM_UNREGISTERED =
    'Wrap call in context.subscriptions.push(...) or track in a composite Disposable.';
const SUGG_MEM_TRACK_VARIABLE =
    'Push the disposable variable to context.subscriptions to prevent memory leak upon reload.';

const MSG_PERF_BLOCKING_FS =
    'Synchronous file I/O call on Extension Host main thread risks freezing the IDE editor UI.';
const SUGG_PERF_BLOCKING_FS =
    'Replace synchronous fs call with asynchronous fs.promises or vscode.workspace.fs.';

const SUGG_I18N_LOCALIZE =
    'Wrap user-facing messages in vscode.l10n.t(...) or import strings from the bilingual dictionary.';

const MSG_UI_UNBOUNDED_COLLECTION =
    'Webview collection list rendering lacks bounded density or folding controls.';
const SUGG_UI_UNBOUNDED_COLLECTION =
    'Add .slice(0, threshold) or collapse/expand controls to prevent unbounded UI height.';

const SUGG_UI_THEME_CSS_VARS =
    'Replace hardcoded color with var(--vscode-*) or adaptive color scheme variable.';

const SUGG_PERF_LAYOUT_TRANSITIONS =
    "Replace geometry transition with GPU-accelerated 'transform' (e.g. scaleX/scaleY) or 'opacity'.";

const SUGG_UI_A11Y_FORM_LABELS =
    "Add 'aria-label', 'aria-labelledby', or associate with a '<label for=\"...\">'.";

const MSG_UI_DYNAMIC_BORDER_JITTER =
    'Webview interactive state style changes must not dynamically modify border width triggering layout jitter.';
const SUGG_UI_DYNAMIC_BORDER_JITTER =
    'Use box-shadow: inset 0 0 0 <width> <color> or static transparent borders for hover/active states.';

/**
 * Strongly typed parameter object for constructing domain Issues.
 * Eliminates GOV-DAT-001 by encapsulating discrete parameters into a single contract.
 */
interface VscIssueParams {
    readonly file: string;
    readonly line: number;
    readonly rule: string;
    readonly severity: Severity;
    readonly message: string;
    readonly suggestion: string;
    readonly detail: Record<string, unknown>;
}

function makeVscIssue(params: VscIssueParams): Issue {
    const { file, line, rule, severity, message, suggestion, detail } = params;
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
    return EXEMPT_PATH_RE.test(file.toLowerCase());
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
            const isUnregistered = v.reason === REASON_UNREGISTERED;
            const msg = isUnregistered
                ? MSG_MEM_UNREGISTERED
                : `Disposable '${v.resourceIdentifier}' is not registered into context.subscriptions.`;
            const sugg = isUnregistered ? SUGG_MEM_UNREGISTERED : SUGG_MEM_TRACK_VARIABLE;
            issues.push(
                makeVscIssue({
                    file,
                    line: v.line,
                    rule: 'VSC-MEM-001',
                    severity: SEVERITY_ERROR,
                    message: msg,
                    suggestion: sugg,
                    detail: {
                        line: v.line,
                        text: v.rawText,
                        variable: v.resourceIdentifier,
                    },
                }),
            );
        }

        // 2. VSC-PERF-001 via generalized blocking matcher
        const blockingViolations = matchBlockingCalls(masked, VSC_BLOCKING_PATTERN);
        for (const b of blockingViolations) {
            issues.push(
                makeVscIssue({
                    file,
                    line: b.line,
                    rule: 'VSC-PERF-001',
                    severity: SEVERITY_WARNING,
                    message: MSG_PERF_BLOCKING_FS,
                    suggestion: SUGG_PERF_BLOCKING_FS,
                    detail: { line: b.line, call: b.callName },
                }),
            );
        }

        // 3. VSC-I18N-001 via generalized presentation literal matcher
        const i18nViolations = matchPresentationLiterals(raw, VSC_I18N_PATTERN);
        for (const lit of i18nViolations) {
            issues.push(
                makeVscIssue({
                    file,
                    line: lit.line,
                    rule: 'VSC-I18N-001',
                    severity: SEVERITY_WARNING,
                    message: `User-facing notification contains hardcoded string literal ${lit.literalText} without localization.`,
                    suggestion: SUGG_I18N_LOCALIZE,
                    detail: { line: lit.line, text: lit.literalText },
                }),
            );
        }

        // 4. VSC-UI-001: Webview dynamic collection rendering bounded density & folding
        const uiFoldingViolations = this.detectUnboundedCollectionRendering(raw, masked);
        for (const f of uiFoldingViolations) {
            issues.push(
                makeVscIssue({
                    file,
                    line: f.line,
                    rule: 'VSC-UI-001',
                    severity: SEVERITY_WARNING,
                    message: MSG_UI_UNBOUNDED_COLLECTION,
                    suggestion: SUGG_UI_UNBOUNDED_COLLECTION,
                    detail: { line: f.line, text: f.text },
                }),
            );
        }

        // 5. VSC-UI-002: Webview CSS theme variable completeness & high-contrast guard
        const colorViolations = this.detectHardcodedThemeColors(raw);
        for (const c of colorViolations) {
            issues.push(
                makeVscIssue({
                    file,
                    line: c.line,
                    rule: 'VSC-UI-002',
                    severity: SEVERITY_ERROR,
                    message: `Webview UI contains hardcoded color '${c.color}' instead of theme CSS variables.`,
                    suggestion: SUGG_UI_THEME_CSS_VARS,
                    detail: { line: c.line, text: c.text, color: c.color },
                }),
            );
        }

        // 6. VSC-PERF-002: Webview CSS transition on geometry layout properties causing reflow
        const layoutTransitionViolations = this.detectLayoutTransitions(raw);
        for (const t of layoutTransitionViolations) {
            issues.push(
                makeVscIssue({
                    file,
                    line: t.line,
                    rule: 'VSC-PERF-002',
                    severity: SEVERITY_WARNING,
                    message: `Webview CSS transition directly animates geometry layout property '${t.prop}' triggering expensive browser reflow.`,
                    suggestion: SUGG_PERF_LAYOUT_TRANSITIONS,
                    detail: { line: t.line, text: t.text, prop: t.prop },
                }),
            );
        }

        // 7. VSC-UI-003: Webview interactive form controls missing accessible labels
        //    conforming to WCAG 4.1.2 requirements.
        const a11yViolations = this.detectInaccessibleFormControls(raw);
        for (const a of a11yViolations) {
            issues.push(
                makeVscIssue({
                    file,
                    line: a.line,
                    rule: 'VSC-UI-003',
                    severity: SEVERITY_WARNING,
                    message: `Webview interactive <${a.tag}> form control lacks accessible label binding (WCAG 4.1.2).`,
                    suggestion: SUGG_UI_A11Y_FORM_LABELS,
                    detail: { line: a.line, text: a.text, tag: a.tag },
                }),
            );
        }

        // 8. VSC-UI-004: Webview interactive dynamic border jitter guard
        const borderJitterViolations = this.detectDynamicBorderJitter(raw);
        for (const b of borderJitterViolations) {
            issues.push(
                makeVscIssue({
                    file,
                    line: b.line,
                    rule: 'VSC-UI-004',
                    severity: SEVERITY_WARNING,
                    message: MSG_UI_DYNAMIC_BORDER_JITTER,
                    suggestion: SUGG_UI_DYNAMIC_BORDER_JITTER,
                    detail: { line: b.line, text: b.text },
                }),
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
                const windowStart = Math.max(0, i - COLLECTION_WINDOW_BEFORE);
                const windowEnd = Math.min(rawLines.length, i + COLLECTION_WINDOW_AFTER);
                const surrounding = rawLines.slice(windowStart, windowEnd).join(LINE_BREAK);
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
                if (MONOCHROME_COLORS.has(matchedColor) && !line.includes(THEME_CSS_VAR_PREFIX)) {
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
            if (!/<(?:input|select)\b/i.test(line)) continue;
            if (/type\s*=\s*['"]hidden['"]/i.test(line)) continue;

            const hasA11y =
                /aria-label|aria-labelledby|role\s*=\s*['"]switch['"]/i.test(line) ||
                /<label\b[^>]*\bfor\s*=/i.test(line);
            if (hasA11y) continue;

            const windowStart = Math.max(0, i - FORM_A11Y_WINDOW_BEFORE);
            const windowEnd = Math.min(rawLines.length, i + FORM_A11Y_WINDOW_AFTER);
            const surrounding = rawLines.slice(windowStart, windowEnd).join(LINE_BREAK);
            const windowHasA11y =
                /aria-label|aria-labelledby|role\s*=\s*['"]switch['"]|<label\b[^>]*\bfor\s*=/i.test(
                    surrounding,
                );
            if (windowHasA11y) continue;

            const tag = /<([a-z]+)/i.exec(line)?.[1] ?? DEFAULT_FORM_TAG;
            violations.push({ line: i + 1, text: line.trim(), tag });
        }
        return violations;
    }

    private detectDynamicBorderJitter(rawLines: string[]): Array<{ line: number; text: string }> {
        const violations: Array<{ line: number; text: string }> = [];
        const jitterRe =
            /:(?:hover|focus|focus-visible|active)\b[^{]*\{[^}]*?\bborder(?:-width)?\s*:\s*[1-9]\d*px/i;
        for (let i = 0; i < rawLines.length; i++) {
            const line = rawLines[i];
            if (jitterRe.test(line)) {
                violations.push({ line: i + 1, text: line.trim() });
            }
        }
        return violations;
    }
}
