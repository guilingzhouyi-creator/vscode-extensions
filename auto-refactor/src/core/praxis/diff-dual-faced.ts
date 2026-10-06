/**
 * Module: Core Engine — Praxis Dual-Faced Diff Transformation Engine
 * File Path: src/core/praxis/diff-dual-faced.ts
 * Architecture Role: Implements the Dual-Faced Diff transformation (Agent Face & Human/UI Face)
 *   specified in Agent-Native System Blueprint §2.1. Bridges machine-actionable AST/LSP slices
 *   for autonomous agents and rich bilingual visual hierarchy for Praxis UI.
 * Dependencies & Triggers: Consumes ReviewDiffHunk from ./contracts; consumes Issue from ../types;
 *   consumes topological types from ./diff-topology-types.
 * Responsibilities:
 *   1. Serialize hunk code slices for deterministic agent patching;
 *   2. Resolve hunk risk severity, visual highlight, and decision badge;
 *   3. Build Agent Face and Human/UI Face structures with symmetrical fidelity;
 *   4. Transform collection of ReviewDiffHunks into DualFacedDiffHunks.
 * Exit Semantics & Design Rationale: Pure deterministic calculation with bounded traversal;
 *   zero transient heap allocations inside loops.
 */

import type { Issue } from '../types';
import type { ReviewDiffHunk } from './contracts';
import type {
    DiffAgentFace,
    DiffAgentLineOffset,
    DiffDecisionBadge,
    DiffHumanFace,
    DiffReviewAction,
    DiffRiskSeverity,
    DiffVisualHighlight,
    DualFacedDiffHunk,
} from './diff-topology-types';

/**
 * Serializes lines of a hunk into unified code slice text.
 *
 * @param hunk - Review diff hunk.
 * @returns Unified code slice string representation.
 */
export function serializeHunkCodeSlice(hunk: ReviewDiffHunk): string {
    const lines: string[] = [];
    for (const line of hunk.lines) {
        if (line.type === 'delete') {
            lines.push(`-${line.content}`);
        } else if (line.type === 'insert') {
            lines.push(`+${line.content}`);
        } else {
            lines.push(` ${line.content}`);
        }
    }
    return lines.join('\n');
}

/**
 * Resolves risk severity for a single hunk based on overlapping issues and verdict.
 *
 * @param hunk - Review diff hunk.
 * @param issues - Optional diagnostic findings.
 * @returns Evaluated risk severity.
 */
export function resolveHunkRisk(hunk: ReviewDiffHunk, issues?: Issue[]): DiffRiskSeverity {
    if (hunk.reviewVerdict?.status === 'major_rework_needed') {
        return 'block';
    }
    if (hunk.reviewVerdict?.status === 'minor_fix_needed') {
        return 'warn';
    }
    if (!issues || issues.length === 0) {
        return 'pass';
    }

    const startLine = hunk.newSpan.startLine;
    const endLine = startLine + Math.max(0, hunk.newSpan.lineCount - 1);

    let hasWarning = false;
    for (const issue of issues) {
        const line = issue.location.start.line;
        if (line >= startLine && line <= endLine) {
            if (issue.severity === 'error') {
                return 'block';
            }
            if (issue.severity === 'warning') {
                hasWarning = true;
            }
        }
    }

    return hasWarning ? 'warn' : 'pass';
}

/**
 * Resolves visual highlight category for a hunk.
 *
 * @param hunk - Review diff hunk.
 * @param hasConflict - Whether git conflict markers exist.
 * @param hasBlockingIssue - Whether a blocking issue overlaps this hunk.
 * @returns Visual highlight category.
 */
export function resolveVisualHighlight(
    hunk: ReviewDiffHunk,
    hasConflict: boolean,
    hasBlockingIssue: boolean,
): DiffVisualHighlight {
    if (hasConflict) {
        return 'conflict';
    }
    if (hasBlockingIssue) {
        return 'critical';
    }

    let hasInsert = false;
    let hasDelete = false;
    for (const line of hunk.lines) {
        if (line.type === 'insert') {
            hasInsert = true;
        } else if (line.type === 'delete') {
            hasDelete = true;
        }
    }

    if (hasInsert && !hasDelete) {
        return 'added';
    }
    if (hasDelete && !hasInsert) {
        return 'deleted';
    }
    return 'modified';
}

/**
 * Maps risk severity to recommended reviewer action.
 *
 * @param risk - Evaluated risk severity.
 * @returns Recommended review action.
 */
export function resolveReviewAction(risk: DiffRiskSeverity): DiffReviewAction {
    if (risk === 'block') {
        return 'escalate_l3a';
    }
    if (risk === 'warn') {
        return 'auto_fix';
    }
    return 'accept';
}

/**
 * Maps risk severity to visual status badge.
 *
 * @param risk - Evaluated risk severity.
 * @returns Visual status badge descriptor.
 */
export function resolveDecisionBadge(risk: DiffRiskSeverity): DiffDecisionBadge {
    if (risk === 'block') {
        return { text: '[BLOCK]', color: 'red' };
    }
    if (risk === 'warn') {
        return { text: '[WARN]', color: 'yellow' };
    }
    if (risk === 'info') {
        return { text: '[INFO]', color: 'blue' };
    }
    return { text: '[PASS]', color: 'green' };
}

/**
 * Builds the Agent Face for a hunk.
 *
 * @param filePath - Target file path.
 * @param hunk - Review diff hunk.
 * @returns Symmetrical DiffAgentFace structure.
 */
export function buildAgentFace(filePath: string, hunk: ReviewDiffHunk): DiffAgentFace {
    const lineOffsets: DiffAgentLineOffset[] = [];
    for (const line of hunk.lines) {
        lineOffsets.push({
            lineNoOld: line.lineNoOld,
            lineNoNew: line.lineNoNew,
            type: line.type,
        });
    }

    const symbol = hunk.astContext?.enclosingSymbol;
    const startLine = hunk.newSpan.startLine;
    const endLine = startLine + Math.max(0, hunk.newSpan.lineCount - 1);
    const directive = symbol
        ? `PATCH [${startLine}..${endLine}] IN ${symbol}`
        : `PATCH [${startLine}..${endLine}] AT MODULE_SCOPE`;

    return {
        filePath,
        oldSpan: hunk.oldSpan,
        newSpan: hunk.newSpan,
        enclosingSymbol: symbol,
        symbolKind: hunk.astContext?.symbolKind,
        scopeRange: hunk.astContext?.scopeRange,
        codeSlice: serializeHunkCodeSlice(hunk),
        patchDirective: directive,
        deterministicHunkId:
            hunk.hunkId || `hunk:${filePath}:${startLine}:${hunk.oldSpan.startLine}`,
        exactLineOffsets: lineOffsets,
    };
}

/**
 * Builds the Human/UI Face for a hunk.
 *
 * @param hunk - Review diff hunk.
 * @param issues - Optional diagnostic findings.
 * @param hasConflict - Optional flag indicating merge conflicts.
 * @returns Symmetrical DiffHumanFace structure.
 */
export function buildHumanFace(
    hunk: ReviewDiffHunk,
    issues?: Issue[],
    hasConflict?: boolean,
): DiffHumanFace {
    const symbol = hunk.astContext?.enclosingSymbol;
    const startLine = hunk.newSpan.startLine;
    const endLine = startLine + Math.max(0, hunk.newSpan.lineCount - 1);
    const severity = resolveHunkRisk(hunk, issues);
    const highlight = resolveVisualHighlight(hunk, Boolean(hasConflict), severity === 'block');
    const action = resolveReviewAction(severity);
    const badge = resolveDecisionBadge(severity);

    const title = symbol
        ? `Modify ${symbol} (Lines ${startLine}-${endLine})`
        : `Modify block (Lines ${startLine}-${endLine})`;

    const i18nZh = symbol
        ? `修改符号 ${symbol} (第 ${startLine}-${endLine} 行)`
        : `修改代码块 (第 ${startLine}-${endLine} 行)`;

    const i18nEn = symbol
        ? `Modify symbol ${symbol} (lines ${startLine}-${endLine})`
        : `Modify code block (lines ${startLine}-${endLine})`;

    return {
        hunkId: hunk.hunkId,
        title,
        i18nKey: `diff.hunk.${hunk.hunkId}`,
        i18nMessage: {
            'zh-CN': i18nZh,
            en: i18nEn,
        },
        foldingLevel: symbol ? 1 : 2,
        visualHighlight: highlight,
        riskSeverity: severity,
        suggestedReviewAction: action,
        decisionBadge: badge,
        rationale: `Evaluated risk severity [${severity}] with recommended review action [${action}].`,
    };
}

/**
 * Converts review hunks into dual-faced hunks.
 *
 * @param filePath - Target file path.
 * @param hunks - Review diff hunks.
 * @param issues - Optional diagnostic findings.
 * @param hasConflict - Optional flag indicating merge conflicts.
 * @returns Array of DualFacedDiffHunk structures.
 */
export function buildDualFacedHunks(
    filePath: string,
    hunks: ReviewDiffHunk[],
    issues?: Issue[],
    hasConflict?: boolean,
): DualFacedDiffHunk[] {
    const result: DualFacedDiffHunk[] = [];
    for (const hunk of hunks) {
        result.push({
            hunkId: hunk.hunkId,
            agentFace: buildAgentFace(filePath, hunk),
            humanFace: buildHumanFace(hunk, issues, hasConflict),
            rawHunk: hunk,
        });
    }
    return result;
}
