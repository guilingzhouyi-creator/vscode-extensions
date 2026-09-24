/**
 * Module: Core Rules — Evolution: Monolithic Template & View Complexity Guard
 * File Path: src/core/rules/evolution/template-complexity-rule.ts
 * Architecture Role: Implements detection for ARCH-TMP-001 (monolithic template renderers).
 * Dependencies & Triggers: Consumes AnalyzerContext and Issue; called by ArchitectureAnalyzer
 *   and Layer 3 architecture evaluators.
 * Responsibilities: Detect monolithic template/view rendering functions with excessive line spans
 *   and dense markup tokens without componentization.
 * Exit Semantics & Design Rationale: Fast, linear line-based scan with zero AST overhead.
 */

import type { AnalyzerContext, Issue } from '../../types';
import { SEVERITY_WARNING } from '../../types';

/** Canonical rule ID for monolithic template rendering complexity. */
export const ARCH_TMP_RULE_ID = 'ARCH-TMP-001';

const ANALYZER_NAME = 'architecture';
const CATEGORY_ARCH_DESIGN = 'architecture_design';
const RISK_MEDIUM = 'medium';

const MSG_TEMPLATE_REFACTOR =
    'Decompose monolithic template into orthogonal partial components driven by a structured ViewModel.';

/** Default maximum function lines for template/view renderers. */
export const DEFAULT_MAX_TEMPLATE_FUNCTION_LINES = 120;

/** Default minimum markup tags for qualifying as a template renderer. */
export const DEFAULT_MIN_TEMPLATE_TAG_COUNT = 8;

/**
 * Regex matching HTML, SVG, and template container tags.
 */
const MARKUP_TAG_RE =
    /<\/?(?:div|span|table|tr|td|th|tbody|thead|tfoot|section|article|header|footer|nav|aside|svg|path|circle|rect|line|polyline|polygon|text|g|ul|ol|li|p|h[1-6]|button|form|input|select|textarea|label|template|main)\b/gi;

/**
 * Regex identifying function headers (declaration, method, or arrow assignment).
 */
const FN_HEADER_RE =
    /(?:function\s+([a-zA-Z0-9_$]+)|(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[a-zA-Z0-9_$]+)\s*=>|(?:public|private|protected|static|async)?\s*([a-zA-Z0-9_$]+)\s*\([^)]*\)\s*(?::\s*[^{]+)?\{)/;

interface ActiveFunctionState {
    name: string;
    startLine: number;
    depth: number;
    tagCount: number;
}

function countMarkupTagsInLine(line: string): number {
    const matches = line.match(MARKUP_TAG_RE);
    return matches ? matches.length : 0;
}

function stripCommentsAndStrings(line: string): string {
    return line
        .replace(/`(?:\\[\s\S]|[^`\\])*`/g, '""')
        .replace(/"(?:\\[\s\S]|[^"\\])*"/g, '""')
        .replace(/'(?:\\[\s\S]|[^'\\])*'/g, "''")
        .split('//')[0];
}

function computeDeltaDepth(cleanLine: string): number {
    let delta = 0;
    for (const ch of cleanLine) {
        if (ch === '{') delta++;
        else if (ch === '}') delta--;
    }
    return delta;
}

function extractFunctionName(line: string): string | undefined {
    const match = FN_HEADER_RE.exec(line);
    if (!match) return undefined;
    return match[1] || match[2] || match[3] || 'anonymous';
}

function tryStartFunction(
    trimmed: string,
    rawLine: string,
    lineNum: number,
): ActiveFunctionState | null {
    if (!trimmed.includes('{')) return null;
    const fnName = extractFunctionName(trimmed);
    if (!fnName) return null;
    const clean = stripCommentsAndStrings(trimmed);
    return {
        name: fnName,
        startLine: lineNum,
        depth: computeDeltaDepth(clean),
        tagCount: countMarkupTagsInLine(rawLine),
    };
}

function evaluateFunctionEnd(
    state: ActiveFunctionState,
    lineNum: number,
    filePath: string,
    maxLines: number,
    minTags: number,
): Issue | null {
    const lineSpan = lineNum - state.startLine + 1;
    if (lineSpan >= maxLines && state.tagCount >= minTags) {
        return createTemplateIssue(filePath, state, lineNum, lineSpan);
    }
    return null;
}

function createTemplateIssue(
    filePath: string,
    state: ActiveFunctionState,
    endLine: number,
    lineSpan: number,
): Issue {
    return {
        id: `${ANALYZER_NAME}:${ARCH_TMP_RULE_ID}:${filePath}:${state.startLine}`,
        analyzer: ANALYZER_NAME,
        rule: ARCH_TMP_RULE_ID,
        severity: SEVERITY_WARNING,
        message: `Monolithic template/view renderer "${state.name}" spans ${lineSpan} lines with ${state.tagCount} markup tags without componentization.`,
        location: {
            file: filePath,
            start: { line: state.startLine, column: 1 },
            end: { line: endLine, column: 1 },
        },
        detail: {
            category: CATEGORY_ARCH_DESIGN,
            risk: RISK_MEDIUM,
            rationale:
                'Monolithic template functions combine presentation, layout, and control flow in a single huge block, making unit testing impossible and impairing maintainability.',
            fixable: false,
            lineSpan,
            tagCount: state.tagCount,
            ruleId: ARCH_TMP_RULE_ID,
        },
        suggestion: MSG_TEMPLATE_REFACTOR,
    };
}

/**
 * Audit source code for monolithic template and view functions (ARCH-TMP-001).
 *
 * @param content Source code text content.
 * @param filePath Path of file being analyzed.
 * @param ctx Optional analyzer context for threshold overrides.
 * @returns Array of emitted ARCH-TMP-001 issues.
 */
export function auditTemplateComplexity(
    content: string,
    filePath: string,
    ctx?: Partial<AnalyzerContext>,
): Issue[] {
    const maxLines =
        (ctx?.options?.maxTemplateFunctionLines as number) ?? DEFAULT_MAX_TEMPLATE_FUNCTION_LINES;
    const minTags = (ctx?.options?.minTemplateTagCount as number) ?? DEFAULT_MIN_TEMPLATE_TAG_COUNT;

    const lines = content.split('\n');
    const issues: Issue[] = [];
    let activeFn: ActiveFunctionState | null = null;

    for (let i = 0; i < lines.length; i++) {
        const lineNum = i + 1;
        const line = lines[i];
        const trimmed = line.trim();

        if (!activeFn) {
            activeFn = tryStartFunction(trimmed, line, lineNum);
            continue;
        }

        activeFn.tagCount += countMarkupTagsInLine(line);
        activeFn.depth += computeDeltaDepth(stripCommentsAndStrings(line));

        if (activeFn.depth <= 0) {
            const issue = evaluateFunctionEnd(activeFn, lineNum, filePath, maxLines, minTags);
            if (issue) issues.push(issue);
            activeFn = null;
        }
    }

    return issues;
}
