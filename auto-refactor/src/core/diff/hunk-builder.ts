/**
 * Module: Core Engine — Review Diff Hunk Builder
 * File Path: src/core/diff/hunk-builder.ts
 * Architecture Role: Assembles diff operations into review-level hunks with context lines.
 * Dependencies & Triggers: Consumed by edit-diff.ts; produces ReviewDiffHunk instances.
 * Responsibilities: Cluster change blocks, format unified diff text, track attributed lines.
 * Exit Semantics & Design Rationale: Pure deterministic transformer assembling hunks
 *   without disk I/O.
 * Concurrency: Stateless pure functions, safe for concurrent read-only consumption.
 */

import type { ReviewDiffHunk, AttributedDiffLine } from '../praxis/contracts';
import type { DiffOp } from './myers-algorithm';
import { DIFF_OP_EQUAL, DIFF_OP_DELETE, DIFF_OP_INSERT } from './myers-algorithm';

/** Default equal context lines kept on each side of a change when building review hunks. */
export const DEFAULT_CONTEXT_LINES = 3;

/** Line type for context line. */
const LINE_TYPE_CONTEXT = 'context';

/** Fallback agent UID when attribution lacks an explicit agent UID. */
const DEFAULT_AGENT_UID = 'Agent';

/**
 * Slice one 0-based line out of content using precomputed line starts.
 *
 * @param content - Source text containing the line.
 * @param starts - Line-start offsets aligned with content.
 * @param idx - 0-based line index.
 * @returns Line text with trailing newline removed.
 */
export function getLine(content: string, starts: number[], idx: number): string {
    if (idx < 0 || idx >= starts.length) return '';
    const s = starts[idx];
    const e = idx + 1 < starts.length ? starts[idx + 1] - 1 : content.length;
    return content.slice(s, e);
}

/**
 * Find the boundary where the current cluster of changes ends.
 */
function findClusterEnd(ops: DiffOp[], startIdx: number, contextLines: number): number {
    let changeEnd = startIdx;
    while (changeEnd < ops.length) {
        if (ops[changeEnd].type !== DIFF_OP_EQUAL) {
            changeEnd++;
            continue;
        }
        let lookahead = changeEnd;
        while (lookahead < ops.length && ops[lookahead].type === DIFF_OP_EQUAL) {
            lookahead++;
        }
        if (lookahead < ops.length && lookahead - changeEnd <= contextLines * 2) {
            changeEnd = lookahead;
        } else {
            break;
        }
    }
    return changeEnd;
}

/**
 * Convert a single diff op into an attributed hunk line.
 */
function toAttributedLine(
    op: DiffOp,
    oldContent: string,
    newContent: string,
    oldStarts: number[],
    newStarts: number[],
): AttributedDiffLine {
    if (op.type === DIFF_OP_EQUAL) {
        return {
            type: LINE_TYPE_CONTEXT,
            lineNoOld: op.aIdx + 1,
            lineNoNew: op.bIdx + 1,
            content: getLine(oldContent, oldStarts, op.aIdx),
        };
    }
    if (op.type === DIFF_OP_DELETE) {
        return {
            type: DIFF_OP_DELETE,
            lineNoOld: op.aIdx + 1,
            content: getLine(oldContent, oldStarts, op.aIdx),
        };
    }
    return {
        type: DIFF_OP_INSERT,
        lineNoNew: op.bIdx + 1,
        content: getLine(newContent, newStarts, op.bIdx),
    };
}

/**
 * Build attributed line entries for a single hunk.
 */
function buildHunkLines(
    hunkOps: DiffOp[],
    oldContent: string,
    newContent: string,
    oldStarts: number[],
    newStarts: number[],
): { lines: AttributedDiffLine[]; oldCount: number; newCount: number } {
    const lines: AttributedDiffLine[] = [];
    let oldCount = 0;
    let newCount = 0;

    for (const op of hunkOps) {
        lines.push(toAttributedLine(op, oldContent, newContent, oldStarts, newStarts));
        if (op.type === DIFF_OP_EQUAL || op.type === DIFF_OP_DELETE) {
            oldCount++;
        }
        if (op.type === DIFF_OP_EQUAL || op.type === DIFF_OP_INSERT) {
            newCount++;
        }
    }

    return { lines, oldCount, newCount };
}

/**
 * Build review-level hunks with line numbers, context lines, and diff operations.
 *
 * @param oldContent - Previous file content.
 * @param newContent - Current file content.
 * @param ops - Ordered line diff operations.
 * @param oldStarts - Line-start offsets for old content.
 * @param newStarts - Line-start offsets for new content.
 * @param contextLines - Equal lines of context kept on each side of a change.
 * @returns Formatted review hunks.
 */
export function buildReviewHunksFromOps(
    oldContent: string,
    newContent: string,
    ops: DiffOp[],
    oldStarts: number[],
    newStarts: number[],
    contextLines: number = DEFAULT_CONTEXT_LINES,
): ReviewDiffHunk[] {
    const hunks: ReviewDiffHunk[] = [];
    let i = 0;

    while (i < ops.length) {
        if (ops[i].type === DIFF_OP_EQUAL) {
            i++;
            continue;
        }

        const changeStart = i;
        const ctxStart = Math.max(0, changeStart - contextLines);
        const changeEnd = findClusterEnd(ops, changeStart, contextLines);
        const ctxEnd = Math.min(ops.length, changeEnd + contextLines);
        const hunkOps = ops.slice(ctxStart, ctxEnd);

        let startOld = 1;
        let startNew = 1;
        if (hunkOps.length > 0) {
            startOld = hunkOps[0].aIdx + 1;
            startNew = hunkOps[0].bIdx + 1;
        }

        const { lines, oldCount, newCount } = buildHunkLines(
            hunkOps,
            oldContent,
            newContent,
            oldStarts,
            newStarts,
        );

        hunks.push({
            hunkId: `hunk-${hunks.length + 1}-${startOld}-${startNew}`,
            header: `@@ -${startOld},${oldCount} +${startNew},${newCount} @@`,
            oldSpan: { startLine: startOld, lineCount: oldCount },
            newSpan: { startLine: startNew, lineCount: newCount },
            lines,
        });

        i = ctxEnd;
    }

    return hunks;
}

/**
 * Render one ReviewDiffHunk as human-readable unified diff text.
 *
 * @param hunk - Hunk to render.
 * @param options - Rendering options.
 * @param options.showAttribution - Optional flag to append author attribution comments.
 * @returns Unified diff text string.
 */
export function formatUnifiedDiff(
    hunk: ReviewDiffHunk,
    options?: { showAttribution?: boolean },
): string {
    const lines: string[] = [];
    const symbol = hunk.astContext?.enclosingSymbol ? ` ${hunk.astContext.enclosingSymbol}` : '';
    lines.push(`${hunk.header}${symbol}`);

    for (const line of hunk.lines) {
        const attr =
            options?.showAttribution && line.attribution
                ? `  # [${line.attribution.agentUid || DEFAULT_AGENT_UID}]`
                : '';
        const isChanged = line.type === DIFF_OP_DELETE || line.type === DIFF_OP_INSERT;
        if (isChanged) {
            const prefix = line.type === DIFF_OP_DELETE ? '-' : '+';
            lines.push(`${prefix}${line.content}${attr}`);
        } else {
            lines.push(` ${line.content}`);
        }
    }
    return lines.join('\n');
}
