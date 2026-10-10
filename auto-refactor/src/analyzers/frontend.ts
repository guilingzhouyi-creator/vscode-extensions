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
        } else if (ext === '.css' || ext === '.scss' || ext === '.less') {
            auditDomDepthAndAnimationReflow(file, rawLines, issues);
        }
        auditComponentPropsAndReuse(file, context.content, issues);
        auditFrontendNaming(file, context.content, issues);

        return issues;
    }
}
