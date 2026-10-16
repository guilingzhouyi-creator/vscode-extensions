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

function makeFrontendIssue(
    file: string,
    line: number,
    rule: string,
    severity: Severity,
    message: string,
    suggestion: string,
    detail: Record<string, unknown>,
): Issue {
    return {
        id: `${ANALYZER_FRONTEND_ID}:${rule}:${file}:${line}`,
        analyzer: ANALYZER_FRONTEND_ID,
        rule,
        severity,
        message,
        location: { file, start: { line, column: 1 }, end: { line, column: 1 } },
        detail,
        suggestion,
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
                makeFrontendIssue(
                    file,
                    i + 1,
                    'UI-ENG-001',
                    SEVERITY_WARNING,
                    `${ExposureMessages.UI_A11Y_SEMANTIC.message}: <img> missing alt attribute`,
                    ExposureMessages.UI_A11Y_SEMANTIC.suggestion,
                    { violation: 'img-missing-alt', line: i + 1 },
                ),
            );
        }
        if (INTERACTIVE_DIV_SPAN_RE.test(line)) {
            const hasRole = HAS_ROLE_RE.test(line);
            const hasTab = HAS_TABINDEX_RE.test(line);
            if (!hasRole || !hasTab) {
                issues.push(
                    makeFrontendIssue(
                        file,
                        i + 1,
                        'UI-ENG-001',
                        SEVERITY_WARNING,
                        `${ExposureMessages.UI_A11Y_SEMANTIC.message}: interactive non-semantic element missing role or tabIndex`,
                        ExposureMessages.UI_A11Y_SEMANTIC.suggestion,
                        { violation: 'interactive-element-a11y', line: i + 1 },
                    ),
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
                makeFrontendIssue(
                    file,
                    i + 1,
                    'UI-ENG-002',
                    SEVERITY_WARNING,
                    `${ExposureMessages.UI_DOM_DEPTH_REFLOW.message}: CSS transition/animation on geometry property causes reflow`,
                    ExposureMessages.UI_DOM_DEPTH_REFLOW.suggestion,
                    { violation: 'css-reflow-property', line: i + 1 },
                ),
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

    if (maxDepth > 12) {
        issues.push(
            makeFrontendIssue(
                file,
                maxDepthLine,
                'UI-ENG-002',
                SEVERITY_WARNING,
                `${ExposureMessages.UI_DOM_DEPTH_REFLOW.message}: DOM hierarchy depth ${maxDepth} exceeds budget 12`,
                ExposureMessages.UI_DOM_DEPTH_REFLOW.suggestion,
                { violation: 'excessive-dom-depth', maxDepth },
            ),
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
        if (ch === 10 /* '\n' */) {
            if (hasVisibleCharOnLine) {
                count++;
                hasVisibleCharOnLine = false;
            }
        } else if (ch > 32) {
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
            if (propCount > 10) {
                issues.push(
                    makeFrontendIssue(
                        file,
                        1,
                        'UI-ENG-003',
                        SEVERITY_WARNING,
                        `${ExposureMessages.UI_COMPONENT_REUSE.message}: Component props footprint (${propCount}) exceeds 10`,
                        ExposureMessages.UI_COMPONENT_REUSE.suggestion,
                        { propCount },
                    ),
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
        if (fnName.endsWith('Hook') && !fnName.startsWith('use')) {
            issues.push(
                makeFrontendIssue(
                    file,
                    1,
                    'UI-ENG-004',
                    SEVERITY_INFO,
                    `${ExposureMessages.UI_NAMING_STATE.message}: Hook function '${fnName}' must start with 'use'`,
                    ExposureMessages.UI_NAMING_STATE.suggestion,
                    { identifier: fnName },
                ),
            );
        }
    }

    HANDLER_DECLARATION_RE.lastIndex = 0;
    while ((match = HANDLER_DECLARATION_RE.exec(content)) !== null) {
        const varName = match[1];
        if (
            varName.endsWith('Handler') &&
            !varName.startsWith('on') &&
            !varName.startsWith('handle')
        ) {
            issues.push(
                makeFrontendIssue(
                    file,
                    1,
                    'UI-ENG-004',
                    SEVERITY_INFO,
                    `${ExposureMessages.UI_NAMING_STATE.message}: Handler '${varName}' should start with 'on' or 'handle'`,
                    ExposureMessages.UI_NAMING_STATE.suggestion,
                    { identifier: varName },
                ),
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

        const windowStart = Math.max(0, i - 4);
        const windowEnd = Math.min(rawLines.length, i + 5);
        if (hasImeGuardInRange(rawLines, windowStart, windowEnd)) continue;

        issues.push(
            makeFrontendIssue(
                file,
                i + 1,
                'UI-ENG-005',
                SEVERITY_WARNING,
                `${ExposureMessages.UI_IME_COMPOSITION_GUARD.message}: Enter key handler missing isComposing guard`,
                ExposureMessages.UI_IME_COMPOSITION_GUARD.suggestion,
                { violation: 'missing-ime-guard', line: i + 1 },
            ),
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

        const windowStart = Math.max(0, i - 2);
        const windowEnd = Math.min(rawLines.length, i + 3);
        let hasTabularNums = false;
        for (let j = windowStart; j < windowEnd; j++) {
            if (TABULAR_NUMS_RE.test(rawLines[j])) {
                hasTabularNums = true;
                break;
            }
        }

        if (!hasTabularNums) {
            issues.push(
                makeFrontendIssue(
                    file,
                    i + 1,
                    'UI-ENG-006',
                    SEVERITY_WARNING,
                    `${ExposureMessages.UI_TABULAR_NUMERICS.message}: Numeric counter or timestamp display missing tabular-nums`,
                    ExposureMessages.UI_TABULAR_NUMERICS.suggestion,
                    { violation: 'missing-tabular-nums', line: i + 1 },
                ),
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

        const searchEnd = Math.min(rawLines.length, i + 8);
        for (let j = i + 1; j < searchEnd; j++) {
            const childLine = rawLines[j];
            if (CLOSING_CONTAINER_TAG_RE.test(childLine)) break;
            if (CHILD_BORDER_RE.test(childLine)) {
                issues.push(
                    makeFrontendIssue(
                        file,
                        j + 1,
                        'UI-ENG-007',
                        SEVERITY_WARNING,
                        `${ExposureMessages.UI_SINGLE_BORDER_DISCIPLINE.message}: Child control nested inside bordered container duplicates outer border`,
                        ExposureMessages.UI_SINGLE_BORDER_DISCIPLINE.suggestion,
                        { violation: 'nested-border', line: j + 1 },
                    ),
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
                    makeFrontendIssue(
                        file,
                        i + 1,
                        'UI-ENG-008',
                        SEVERITY_WARNING,
                        `${ExposureMessages.UI_CONTAINER_QUERY_ANTI_SQUASH.message}: Local component uses global viewport @media instead of @container`,
                        ExposureMessages.UI_CONTAINER_QUERY_ANTI_SQUASH.suggestion,
                        { violation: 'media-query-local-component', line: i + 1 },
                    ),
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
    const lookbackStart = Math.max(0, currentIndex - 15);
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
            makeFrontendIssue(
                file,
                i + 1,
                'UI-ENG-008',
                SEVERITY_WARNING,
                `${ExposureMessages.UI_CONTAINER_QUERY_ANTI_SQUASH.message}: CJK text container missing text-wrap: balance or overflow-wrap: break-word`,
                ExposureMessages.UI_CONTAINER_QUERY_ANTI_SQUASH.suggestion,
                { violation: 'cjk-missing-anti-squash', line: i + 1 },
            ),
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

    analyze(_sf: any, context: AnalyzerContext): Issue[] {
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
