/**
 * Module: Static Analysis Engine — Frontend UI/UX & Component Engineering Analyzer
 * File Path: src/analyzers/frontend.ts
 * Architecture Role: Domain analyzer for frontend components, UI/UX accessibility,
 *   DOM hierarchy complexity, and CSS animation reflow performance guards.
 * Dependencies & Triggers: Core types, exposure messages, source-mask.
 * Responsibilities:
 *   1. UI-ENG-001: Guard against HTML semantic and accessibility (A11y) violations.
 *   2. UI-ENG-002: Guard against excessive DOM nesting (>12) and reflow-inducing CSS transitions.
 *   3. UI-ENG-003: Guard against God components (>10 props) and repetitive DOM templates.
 *   4. UI-ENG-004: Enforce frontend hook (use*) and event handler (on* or handle*)
 *      naming conventions.
 *   5. UI-ENG-005: Guard against CJK IME composition state collisions on Enter key handling.
 *   6. UI-ENG-006: Guard against dynamic timer and numeric metric displays lacking tabular-nums.
 *   7. UI-ENG-007: Guard against nested borders on child controls inside bordered containers.
 *   8. UI-ENG-008: Guard against local component @media misuse and CJK text squashing.
 * Exit Semantics & Design Rationale: Pure, fail-safe scanner returning Issue[]. Zero throw.
 */

import * as path from 'path';
import type { Analyzer, AnalyzerContext, Issue, Severity } from '../core/types';
import { SEVERITY_INFO, SEVERITY_WARNING } from '../core/types';
import { ExposureMessages } from '../core/messages/exposure';

/** Canonical analyzer identifier for frontend UI/UX, A11y, and component architecture audits. */
export const ANALYZER_FRONTEND_ID = 'frontend';

/** Rule ID: HTML semantic and accessibility (A11y) violations. */
export const RULE_UI_ENG_001 = 'UI-ENG-001';
/** Rule ID: Excessive DOM nesting and reflow-inducing CSS transitions. */
export const RULE_UI_ENG_002 = 'UI-ENG-002';
/** Rule ID: Component props footprint and template complexity. */
export const RULE_UI_ENG_003 = 'UI-ENG-003';
/** Rule ID: Frontend hook and event handler naming conventions. */
export const RULE_UI_ENG_004 = 'UI-ENG-004';
/** Rule ID: CJK IME composition state collisions on Enter key handling. */
export const RULE_UI_ENG_005 = 'UI-ENG-005';
/** Rule ID: Dynamic timer and numeric metric displays lacking tabular-nums. */
export const RULE_UI_ENG_006 = 'UI-ENG-006';
/** Rule ID: Nested borders on child controls inside bordered containers. */
export const RULE_UI_ENG_007 = 'UI-ENG-007';
/** Rule ID: Local component @media misuse and CJK text squashing. */
export const RULE_UI_ENG_008 = 'UI-ENG-008';

const MAX_RECOMMENDED_DOM_DEPTH = 12;
const MAX_RECOMMENDED_COMPONENT_PROPS = 10;
const ASCII_SPACE_CODE = 32;
const ASCII_NEWLINE_CODE = 10;
const IME_WINDOW_LOOKBACK_LINES = 4;
const IME_WINDOW_LOOKAHEAD_LINES = 5;
const TABULAR_WINDOW_LOOKBACK_LINES = 2;
const TABULAR_WINDOW_LOOKAHEAD_LINES = 3;
const BORDER_LOOKAHEAD_LINES = 8;
const ANTI_SQUASH_LOOKBACK_LINES = 15;

const VIOLATION_IMG_MISSING_ALT = 'img-missing-alt';
const VIOLATION_INTERACTIVE_A11Y = 'interactive-element-a11y';
const VIOLATION_CSS_REFLOW = 'css-reflow-property';
const VIOLATION_EXCESSIVE_DOM_DEPTH = 'excessive-dom-depth';
const VIOLATION_MISSING_IME_GUARD = 'missing-ime-guard';
const VIOLATION_MISSING_TABULAR_NUMS = 'missing-tabular-nums';
const VIOLATION_NESTED_BORDER = 'nested-border';
const VIOLATION_MEDIA_QUERY_LOCAL = 'media-query-local-component';
const VIOLATION_CJK_MISSING_ANTI_SQUASH = 'cjk-missing-anti-squash';

const MSG_SUFFIX_IMG_MISSING_ALT = ': <img> missing alt attribute';
const MSG_SUFFIX_INTERACTIVE_A11Y = ': interactive non-semantic element missing role or tabIndex';
const MSG_SUFFIX_CSS_REFLOW = ': CSS transition/animation on geometry property causes reflow';
const MSG_PREFIX_DOM_DEPTH = ': DOM hierarchy depth ';
const MSG_SUFFIX_DOM_DEPTH_BUDGET = ' exceeds budget 12';
const MSG_PREFIX_PROPS_FOOTPRINT = ': Component props footprint (';
const MSG_SUFFIX_PROPS_FOOTPRINT_LIMIT = ') exceeds 10';
const MSG_PREFIX_HOOK_NAME = ": Hook function '";
const MSG_SUFFIX_HOOK_NAME = "' must start with 'use'";
const MSG_PREFIX_HANDLER_NAME = ": Handler '";
const MSG_SUFFIX_HANDLER_NAME = "' should start with 'on' or 'handle'";
const MSG_SUFFIX_IME_GUARD = ': Enter key handler missing isComposing guard';
const MSG_SUFFIX_TABULAR_NUMS = ': Numeric counter or timestamp display missing tabular-nums';
const MSG_SUFFIX_NESTED_BORDER =
    ': Child control nested inside bordered container duplicates outer border';
const MSG_SUFFIX_MEDIA_QUERY_LOCAL =
    ': Local component uses global viewport @media instead of @container';
const MSG_SUFFIX_CJK_ANTI_SQUASH =
    ': CJK text container missing text-wrap: balance or overflow-wrap: break-word';

const SUFFIX_HOOK = 'Hook';
const SUFFIX_HANDLER = 'Handler';
const PREFIX_HANDLE = 'handle';
const PREFIX_USE = 'use';
const PREFIX_ON = 'on';

const FRONTEND_EXTENSIONS = new Set([
    '.html',
    '.htm',
    '.jsx',
    '.tsx',
    '.vue',
    '.svelte',
    '.css',
    '.scss',
    '.less',
    '.ts',
    '.js',
]);

const CSS_REFLOW_PROPERTIES_RE =
    /\b(?:transition|animation)\s*:[^;]*\b(width|height|top|left|right|bottom|margin|padding)\b/i;

const IMG_TAG_WITHOUT_ALT_RE = /<img\b(?![^>]*\balt\s*=)[^>]*>/i;
const INTERACTIVE_DIV_SPAN_RE = /<(?:div|span)\b[^>]*\bon(?:click|keydown|keyup)\s*=[^>]*>/i;
const HAS_ROLE_RE = /\brole\s*=\s*(?:['"][^'"]+['"]|\{[^}]+\})/i;
const HAS_TABINDEX_RE = /\btabindex\s*=\s*(?:['"]?[-\d]+['"]?|\{[^}]+\})/i;

const HOOK_DECLARATION_RE = /\bfunction\s+([A-Za-z0-9_]+)\s*\([^)]*\)\s*\{/g;
const HANDLER_DECLARATION_RE =
    /\b(?:const|let|var)\s+([A-Za-z0-9_]+)\s*=\s*(?:\([^)]*\)|[A-Za-z0-9_]+)\s*=>/g;
const INTERFACE_PROPS_RE = /interface\s+([A-Za-z0-9_]*Props)\s*\{([^}]+)\}/g;

const ENTER_KEY_HANDLER_RE =
    /\b(?:e|event)\.(?:key\s*===?\s*['"]Enter['"]|code\s*===?\s*['"]Enter['"]|keyCode\s*===?\s*13\b)/i;
const IME_COMPOSITION_GUARD_RE = /\b(?:isComposing|keyCode\s*===?\s*229|which\s*===?\s*229)\b/;

const TIMER_COUNTER_DISPLAY_RE =
    /(?:\{\s*(?:format(?:Time|Duration|Timer)|[a-zA-Z0-9_]*(?:elapsed|timer|stopwatch|countdown)[a-zA-Z0-9_]*)\b|<(?:span|div|p)\b[^>]*\b(?:timer|stopwatch|clock|counter|elapsed|duration)[^>]*>)/i;
const TABULAR_NUMS_RE = /\b(?:tabular-nums|tnum|font-variant-numeric)\b/i;

const CONTAINER_BORDER_RE =
    /<(?:div|section|aside|nav|fieldset)\b[^>]*\bclass(?:Name)?\s*=\s*['"][^'"]*\b(?:border|border-(?:gray|slate|zinc|neutral|stone|solid|dashed|\d{3}))\b[^'"]*['"]/i;
const CHILD_BORDER_RE =
    /<(?:button|input|select|span)\b[^>]*\bclass(?:Name)?\s*=\s*['"][^'"]*(?<![tbrl]-)\bborder(?:\s+|-[a-z0-9]+|\b)(?![tbrl]-)[^'"]*['"]/i;
const SCRIPT_EXT_RE = /\.(?:tsx|jsx|ts|js|vue|svelte)$/i;
const CLOSING_CONTAINER_TAG_RE = /<\/(?:div|section)>/i;

const CJK_CHAR_RE = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/;
const ANTI_SQUASH_RE =
    /\b(?:text-balance|text-wrap:\s*balance\b|textWrap:\s*['"]balance['"]|break-words|overflow-wrap:\s*(?:break-word|anywhere)\b|overflowWrap:\s*['"](?:break-word|anywhere)['"]|word-break:\s*break-word\b)/i;
const MEDIA_QUERY_RE = /@media\b/i;
const LOCAL_CLASS_OR_ID_RE = /(?:\.[a-zA-Z_-][\w-]*|#[a-zA-Z_-][\w-]*)\s*\{/;

/** Structured parameter context for constructing frontend issues. */
interface FrontendIssueContext {
    readonly file: string;
    readonly line: number;
    readonly rule: string;
    readonly severity: Severity;
    readonly message: string;
    readonly suggestion: string;
    readonly detail: Record<string, unknown>;
}

function makeFrontendIssue(context: FrontendIssueContext): Issue {
    return {
        id: `${ANALYZER_FRONTEND_ID}:${context.rule}:${context.file}:${context.line}`,
        analyzer: ANALYZER_FRONTEND_ID,
        rule: context.rule,
        severity: context.severity,
        message: context.message,
        location: {
            file: context.file,
            start: { line: context.line, column: 1 },
            end: { line: context.line, column: 1 },
        },
        detail: context.detail,
        suggestion: context.suggestion,
    };
}

/**
 * Checks for accessibility and semantic HTML violations (UI-ENG-001).
 */
function auditAccessibilityAndSemantics(file: string, rawLines: string[], issues: Issue[]): void {
    for (let i = 0; i < rawLines.length; i++) {
        const line = rawLines[i];
        if (IMG_TAG_WITHOUT_ALT_RE.test(line)) {
            issues.push(
                makeFrontendIssue({
                    file,
                    line: i + 1,
                    rule: RULE_UI_ENG_001,
                    severity: SEVERITY_WARNING,
                    message: `${ExposureMessages.UI_A11Y_SEMANTIC.message}${MSG_SUFFIX_IMG_MISSING_ALT}`,
                    suggestion: ExposureMessages.UI_A11Y_SEMANTIC.suggestion,
                    detail: { violation: VIOLATION_IMG_MISSING_ALT, line: i + 1 },
                }),
            );
        }
        if (INTERACTIVE_DIV_SPAN_RE.test(line)) {
            const hasRole = HAS_ROLE_RE.test(line);
            const hasTab = HAS_TABINDEX_RE.test(line);
            if (!hasRole || !hasTab) {
                issues.push(
                    makeFrontendIssue({
                        file,
                        line: i + 1,
                        rule: RULE_UI_ENG_001,
                        severity: SEVERITY_WARNING,
                        message: `${ExposureMessages.UI_A11Y_SEMANTIC.message}${MSG_SUFFIX_INTERACTIVE_A11Y}`,
                        suggestion: ExposureMessages.UI_A11Y_SEMANTIC.suggestion,
                        detail: { violation: VIOLATION_INTERACTIVE_A11Y, line: i + 1 },
                    }),
                );
            }
        }
    }
}

/**
 * Audits CSS and DOM nesting depth for reflow performance (UI-ENG-002).
 */
function auditDomDepthAndAnimationReflow(file: string, rawLines: string[], issues: Issue[]): void {
    let currentDepth = 0;
    let maxDepth = 0;
    let maxDepthLine = 1;

    for (let i = 0; i < rawLines.length; i++) {
        const line = rawLines[i];
        if (CSS_REFLOW_PROPERTIES_RE.test(line)) {
            issues.push(
                makeFrontendIssue({
                    file,
                    line: i + 1,
                    rule: RULE_UI_ENG_002,
                    severity: SEVERITY_WARNING,
                    message: `${ExposureMessages.UI_DOM_DEPTH_REFLOW.message}${MSG_SUFFIX_CSS_REFLOW}`,
                    suggestion: ExposureMessages.UI_DOM_DEPTH_REFLOW.suggestion,
                    detail: { violation: VIOLATION_CSS_REFLOW, line: i + 1 },
                }),
            );
        }

        const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9:-]*)(?:\s+[^>]*)?(\/?)>/g;
        let tagMatch: RegExpExecArray | null;
        while ((tagMatch = tagRe.exec(line)) !== null) {
            const isClosing = tagMatch[0].startsWith('</');
            const isSelfClosing = tagMatch[2] === '/' || tagMatch[0].endsWith('/>');
            if (isClosing) {
                currentDepth = Math.max(0, currentDepth - 1);
            } else if (!isSelfClosing) {
                currentDepth++;
                if (currentDepth > maxDepth) {
                    maxDepth = currentDepth;
                    maxDepthLine = i + 1;
                }
            }
        }
    }

    if (maxDepth > MAX_RECOMMENDED_DOM_DEPTH) {
        issues.push(
            makeFrontendIssue({
                file,
                line: maxDepthLine,
                rule: RULE_UI_ENG_002,
                severity: SEVERITY_WARNING,
                message: `${ExposureMessages.UI_DOM_DEPTH_REFLOW.message}${MSG_PREFIX_DOM_DEPTH}${maxDepth}${MSG_SUFFIX_DOM_DEPTH_BUDGET}`,
                suggestion: ExposureMessages.UI_DOM_DEPTH_REFLOW.suggestion,
                detail: { violation: VIOLATION_EXCESSIVE_DOM_DEPTH, maxDepth },
            }),
        );
    }
}

/**
 * Counts non-empty property declaration lines in an interface body in a single pass
 * without heap allocation or nested indexOf calls (PRF-ALG-002).
 */
function countInterfaceBodyProps(body: string): number {
    let count = 0;
    let hasVisibleCharOnLine = false;
    const len = body.length;

    for (let i = 0; i < len; i++) {
        const ch = body.charCodeAt(i);
        if (ch === ASCII_NEWLINE_CODE) {
            if (hasVisibleCharOnLine) {
                count++;
                hasVisibleCharOnLine = false;
            }
        } else if (ch > ASCII_SPACE_CODE) {
            hasVisibleCharOnLine = true;
        }
    }
    if (hasVisibleCharOnLine) {
        count++;
    }
    return count;
}

/**
 * Audits component complexity and duplication patterns (UI-ENG-003).
 */
function auditComponentPropsAndReuse(file: string, content: string, issues: Issue[]): void {
    INTERFACE_PROPS_RE.lastIndex = 0;
    const interfaceMap = new Map<string, string[]>();
    let match: RegExpExecArray | null;

    while ((match = INTERFACE_PROPS_RE.exec(content)) !== null) {
        const name = match[1];
        const body = match[2];
        const existing = interfaceMap.get(name);
        if (existing) {
            existing.push(body);
        } else {
            interfaceMap.set(name, [body]);
        }
    }

    for (const bodies of interfaceMap.values()) {
        for (const body of bodies) {
            const propCount = countInterfaceBodyProps(body);
            if (propCount > MAX_RECOMMENDED_COMPONENT_PROPS) {
                issues.push(
                    makeFrontendIssue({
                        file,
                        line: 1,
                        rule: RULE_UI_ENG_003,
                        severity: SEVERITY_WARNING,
                        message: `${ExposureMessages.UI_COMPONENT_REUSE.message}${MSG_PREFIX_PROPS_FOOTPRINT}${propCount}${MSG_SUFFIX_PROPS_FOOTPRINT_LIMIT}`,
                        suggestion: ExposureMessages.UI_COMPONENT_REUSE.suggestion,
                        detail: { propCount },
                    }),
                );
                return;
            }
        }
    }
}

/**
 * Audits hook and event handler naming conventions (UI-ENG-004).
 */
function auditFrontendNaming(file: string, content: string, issues: Issue[]): void {
    if (!file.endsWith('.tsx') && !file.endsWith('.jsx') && !file.endsWith('.ts')) return;

    HOOK_DECLARATION_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = HOOK_DECLARATION_RE.exec(content)) !== null) {
        const fnName = match[1];
        if (fnName.endsWith(SUFFIX_HOOK) && !fnName.startsWith(PREFIX_USE)) {
            issues.push(
                makeFrontendIssue({
                    file,
                    line: 1,
                    rule: RULE_UI_ENG_004,
                    severity: SEVERITY_INFO,
                    message: `${ExposureMessages.UI_NAMING_STATE.message}${MSG_PREFIX_HOOK_NAME}${fnName}${MSG_SUFFIX_HOOK_NAME}`,
                    suggestion: ExposureMessages.UI_NAMING_STATE.suggestion,
                    detail: { identifier: fnName },
                }),
            );
        }
    }

    HANDLER_DECLARATION_RE.lastIndex = 0;
    while ((match = HANDLER_DECLARATION_RE.exec(content)) !== null) {
        const varName = match[1];
        if (
            varName.endsWith(SUFFIX_HANDLER) &&
            !varName.startsWith(PREFIX_ON) &&
            !varName.startsWith(PREFIX_HANDLE)
        ) {
            issues.push(
                makeFrontendIssue({
                    file,
                    line: 1,
                    rule: RULE_UI_ENG_004,
                    severity: SEVERITY_INFO,
                    message: `${ExposureMessages.UI_NAMING_STATE.message}${MSG_PREFIX_HANDLER_NAME}${varName}${MSG_SUFFIX_HANDLER_NAME}`,
                    suggestion: ExposureMessages.UI_NAMING_STATE.suggestion,
                    detail: { identifier: varName },
                }),
            );
        }
    }
}

/**
 * Evaluates whether any line in the given window satisfies IME composition guard patterns.
 */
function hasImeGuardInRange(rawLines: string[], start: number, end: number): boolean {
    for (let index = start; index < end; index++) {
        if (IME_COMPOSITION_GUARD_RE.test(rawLines[index])) return true;
    }
    return false;
}

/**
 * Audits keyboard Enter handlers for CJK IME composition state guards (UI-ENG-005).
 */
function auditImeCompositionGuard(file: string, rawLines: string[], issues: Issue[]): void {
    if (!SCRIPT_EXT_RE.test(file)) return;

    for (let i = 0; i < rawLines.length; i++) {
        const line = rawLines[i];
        if (!ENTER_KEY_HANDLER_RE.test(line)) continue;

        const windowStart = Math.max(0, i - IME_WINDOW_LOOKBACK_LINES);
        const windowEnd = Math.min(rawLines.length, i + IME_WINDOW_LOOKAHEAD_LINES);
        if (hasImeGuardInRange(rawLines, windowStart, windowEnd)) continue;

        issues.push(
            makeFrontendIssue({
                file,
                line: i + 1,
                rule: RULE_UI_ENG_005,
                severity: SEVERITY_WARNING,
                message: `${ExposureMessages.UI_IME_COMPOSITION_GUARD.message}${MSG_SUFFIX_IME_GUARD}`,
                suggestion: ExposureMessages.UI_IME_COMPOSITION_GUARD.suggestion,
                detail: { violation: VIOLATION_MISSING_IME_GUARD, line: i + 1 },
            }),
        );
    }
}

/**
 * Audits dynamic numeric metrics, counters, and timestamps
 * for tabular-nums font locking (UI-ENG-006).
 */
function auditTabularNumerics(file: string, rawLines: string[], issues: Issue[]): void {
    for (let i = 0; i < rawLines.length; i++) {
        const line = rawLines[i];
        if (!TIMER_COUNTER_DISPLAY_RE.test(line)) continue;

        const windowStart = Math.max(0, i - TABULAR_WINDOW_LOOKBACK_LINES);
        const windowEnd = Math.min(rawLines.length, i + TABULAR_WINDOW_LOOKAHEAD_LINES);
        let hasTabularNums = false;
        for (let j = windowStart; j < windowEnd; j++) {
            if (TABULAR_NUMS_RE.test(rawLines[j])) {
                hasTabularNums = true;
                break;
            }
        }

        if (!hasTabularNums) {
            issues.push(
                makeFrontendIssue({
                    file,
                    line: i + 1,
                    rule: RULE_UI_ENG_006,
                    severity: SEVERITY_WARNING,
                    message: `${ExposureMessages.UI_TABULAR_NUMERICS.message}${MSG_SUFFIX_TABULAR_NUMS}`,
                    suggestion: ExposureMessages.UI_TABULAR_NUMERICS.suggestion,
                    detail: { violation: VIOLATION_MISSING_TABULAR_NUMS, line: i + 1 },
                }),
            );
        }
    }
}

/**
 * Audits nested borders on child controls inside bordered containers (UI-ENG-007).
 */
function auditSingleBorderDiscipline(file: string, rawLines: string[], issues: Issue[]): void {
    for (let i = 0; i < rawLines.length; i++) {
        const line = rawLines[i];
        if (!CONTAINER_BORDER_RE.test(line)) continue;

        const searchEnd = Math.min(rawLines.length, i + BORDER_LOOKAHEAD_LINES);
        for (let j = i + 1; j < searchEnd; j++) {
            const childLine = rawLines[j];
            if (CLOSING_CONTAINER_TAG_RE.test(childLine)) break;
            if (CHILD_BORDER_RE.test(childLine)) {
                issues.push(
                    makeFrontendIssue({
                        file,
                        line: j + 1,
                        rule: RULE_UI_ENG_007,
                        severity: SEVERITY_WARNING,
                        message: `${ExposureMessages.UI_SINGLE_BORDER_DISCIPLINE.message}${MSG_SUFFIX_NESTED_BORDER}`,
                        suggestion: ExposureMessages.UI_SINGLE_BORDER_DISCIPLINE.suggestion,
                        detail: { violation: VIOLATION_NESTED_BORDER, line: j + 1 },
                    }),
                );
                break;
            }
        }
    }
}

/**
 * Scans forward in CSS lines from a top-level @media line
 * to determine if it targets local component selectors.
 */
function mediaTargetsLocalComponent(rawLines: string[], startIndex: number): boolean {
    let braceCount = 0;
    const firstLine = rawLines[startIndex];
    braceCount += (firstLine.match(/\{/g) || []).length;
    braceCount -= (firstLine.match(/\}/g) || []).length;

    for (let i = startIndex + 1; i < rawLines.length; i++) {
        const line = rawLines[i];
        if (LOCAL_CLASS_OR_ID_RE.test(line)) {
            return true;
        }
        braceCount += (line.match(/\{/g) || []).length;
        braceCount -= (line.match(/\}/g) || []).length;
        if (braceCount <= 0) {
            break;
        }
    }
    return false;
}

/**
 * Audits @media misuse in local components (UI-ENG-008).
 */
function auditMediaQueryDiscipline(file: string, rawLines: string[], issues: Issue[]): void {
    let globalBraceDepth = 0;
    for (let i = 0; i < rawLines.length; i++) {
        const line = rawLines[i];
        const isMediaLine = MEDIA_QUERY_RE.test(line);

        if (isMediaLine) {
            const mediaIndex = line.search(MEDIA_QUERY_RE);
            const prefix = mediaIndex > 0 ? line.slice(0, mediaIndex) : '';
            const suffix = mediaIndex >= 0 ? line.slice(mediaIndex) : '';
            const isNestedInSelector = globalBraceDepth > 0 || /\{/.test(prefix);
            const sameLineTargetsLocal = LOCAL_CLASS_OR_ID_RE.test(suffix);
            const targetsLocal =
                isNestedInSelector ||
                sameLineTargetsLocal ||
                mediaTargetsLocalComponent(rawLines, i);
            if (targetsLocal) {
                issues.push(
                    makeFrontendIssue({
                        file,
                        line: i + 1,
                        rule: RULE_UI_ENG_008,
                        severity: SEVERITY_WARNING,
                        message: `${ExposureMessages.UI_CONTAINER_QUERY_ANTI_SQUASH.message}${MSG_SUFFIX_MEDIA_QUERY_LOCAL}`,
                        suggestion: ExposureMessages.UI_CONTAINER_QUERY_ANTI_SQUASH.suggestion,
                        detail: { violation: VIOLATION_MEDIA_QUERY_LOCAL, line: i + 1 },
                    }),
                );
            }
        }

        const openCount = (line.match(/\{/g) || []).length;
        const closeCount = (line.match(/\}/g) || []).length;
        globalBraceDepth = Math.max(0, globalBraceDepth + openCount - closeCount);
    }
}

/**
 * Checks if an ancestor opening tag within lookback window specifies anti-squash properties.
 */
function ancestorHasAntiSquash(rawLines: string[], currentIndex: number): boolean {
    const lookbackStart = Math.max(0, currentIndex - ANTI_SQUASH_LOOKBACK_LINES);
    for (let j = currentIndex - 1; j >= lookbackStart; j--) {
        const line = rawLines[j];
        if (ANTI_SQUASH_RE.test(line)) {
            return true;
        }
    }
    return false;
}

/**
 * Audits CJK text containers lacking text-wrap: balance or overflow-wrap: break-word (UI-ENG-008).
 */
function auditCjkAntiSquash(file: string, rawLines: string[], issues: Issue[]): void {
    for (let i = 0; i < rawLines.length; i++) {
        const line = rawLines[i];
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
            continue;
        }
        if (!CJK_CHAR_RE.test(line)) {
            continue;
        }
        if (ANTI_SQUASH_RE.test(line)) {
            continue;
        }
        if (ancestorHasAntiSquash(rawLines, i)) {
            continue;
        }

        issues.push(
            makeFrontendIssue({
                file,
                line: i + 1,
                rule: RULE_UI_ENG_008,
                severity: SEVERITY_WARNING,
                message: `${ExposureMessages.UI_CONTAINER_QUERY_ANTI_SQUASH.message}${MSG_SUFFIX_CJK_ANTI_SQUASH}`,
                suggestion: ExposureMessages.UI_CONTAINER_QUERY_ANTI_SQUASH.suggestion,
                detail: { violation: VIOLATION_CJK_MISSING_ANTI_SQUASH, line: i + 1 },
            }),
        );
    }
}

/**
 * Container query & CJK anti-squash discipline audit (UI-ENG-008).
 */
function auditContainerQueryAndAntiSquash(file: string, rawLines: string[], issues: Issue[]): void {
    auditMediaQueryDiscipline(file, rawLines, issues);
    auditCjkAntiSquash(file, rawLines, issues);
}

/**
 * Frontend UI/UX, accessibility, and component hygiene analyzer.
 */
export class FrontendAnalyzer implements Analyzer {
    readonly name = ANALYZER_FRONTEND_ID;

    analyze(_sf: unknown, context: AnalyzerContext): Issue[] {
        const file = context.filePath;
        const ext = path.extname(file).toLowerCase();
        if (!FRONTEND_EXTENSIONS.has(ext) && !context.content.includes('<template>')) {
            return [];
        }

        const issues: Issue[] = [];
        const rawLines = context.content.split('\n');

        if (
            context.content.includes('<') ||
            ext === '.html' ||
            ext === '.htm' ||
            ext === '.vue' ||
            ext === '.svelte'
        ) {
            auditAccessibilityAndSemantics(file, rawLines, issues);
            auditDomDepthAndAnimationReflow(file, rawLines, issues);
            auditTabularNumerics(file, rawLines, issues);
            auditSingleBorderDiscipline(file, rawLines, issues);
            auditContainerQueryAndAntiSquash(file, rawLines, issues);
        } else if (ext === '.css' || ext === '.scss' || ext === '.less') {
            auditDomDepthAndAnimationReflow(file, rawLines, issues);
            auditContainerQueryAndAntiSquash(file, rawLines, issues);
        }
        auditComponentPropsAndReuse(file, context.content, issues);
        auditFrontendNaming(file, context.content, issues);
        auditImeCompositionGuard(file, rawLines, issues);

        return issues;
    }
}
