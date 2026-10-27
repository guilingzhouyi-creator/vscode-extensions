/**
 * Module: Core Engine - Native Histogram Diff Shim
 * File Path: src/core/native/native-diff-shim.ts
 * Architecture Role: Pure JavaScript fallback implementation of histogram line diffing
 *   and unified diff hunk clustering, providing byte-parity with the compiled Rust operator.
 * Dependencies & Triggers: Consumes ./native-types, ../diff/edit-diff, ../diff/histogram-diff,
 *   and ../diff/myers-algorithm; delegated by ./native-bridge.
 * Responsibilities:
 *   1. Calculate Git-grade histogram diff between text buffers;
 *   2. Reconcile newline and terminator nuances to match native Rust split_lines byte-for-byte;
 *   3. Cluster edit operations into unified diff hunks with configurable context lines.
 * Exit Semantics & Design Rationale: Deterministic pure JS fallback guaranteeing 100%
 *   algorithmic parity when compiled Rust native bindings are unavailable.
 */

import type { NativeDiffHunk } from './native-types';
import { computeLineStartsAndHashes, linesOf, type LineIndex } from '../diff/edit-diff';
import { histogramDiff } from '../diff/histogram-diff';
import {
    DIFF_OP_EQUAL,
    DIFF_OP_DELETE,
    DIFF_OP_INSERT,
    DIFF_OP_EQUAL_SPAN,
    type DiffOp,
} from '../diff/myers-algorithm';

interface HunkBuilderState {
    oldStart: number;
    newStart: number;
    oldLinesCount: number;
    newLinesCount: number;
    lines: string[];
    firstOldAssigned: boolean;
    firstNewAssigned: boolean;
}

function applyDiffOpEqual(diffOp: DiffOp, oldLines: string[], state: HunkBuilderState): void {
    if (!state.firstOldAssigned) {
        state.oldStart = diffOp.aIdx + 1;
        state.firstOldAssigned = true;
    }
    if (!state.firstNewAssigned) {
        state.newStart = diffOp.bIdx + 1;
        state.firstNewAssigned = true;
    }
    state.oldLinesCount++;
    state.newLinesCount++;
    state.lines.push(' ' + (oldLines[diffOp.aIdx] ?? ''));
}

function applyDiffOpDelete(diffOp: DiffOp, oldLines: string[], state: HunkBuilderState): void {
    if (!state.firstOldAssigned) {
        state.oldStart = diffOp.aIdx + 1;
        state.firstOldAssigned = true;
    }
    state.oldLinesCount++;
    state.lines.push('-' + (oldLines[diffOp.aIdx] ?? ''));
}

function applyDiffOpInsert(diffOp: DiffOp, newLines: string[], state: HunkBuilderState): void {
    if (!state.firstNewAssigned) {
        state.newStart = diffOp.bIdx + 1;
        state.firstNewAssigned = true;
    }
    state.newLinesCount++;
    state.lines.push('+' + (newLines[diffOp.bIdx] ?? ''));
}

/**
 * Drop the synthetic line start that follows a trailing newline.
 *
 * `computeLineStarts` records an offset immediately after every `\n`, so content ending in a
 * newline yields a final start that denotes an empty final line. The Rust operator does not
 * emit that line, and keeping it made the shim's diff hunks one context line longer and the
 * hunk spans one line larger than the native ones for identical input. The start is removed
 * only when it genuinely points past the last character.
 *
 * @param content - Source text the offsets were computed from.
 * @param starts - Line-start offsets.
 * @returns Offsets without the trailing empty line.
 */
export function trimTrailingLineStart(content: string, starts: number[]): number[] {
    if (starts.length > 0 && starts[starts.length - 1] >= content.length) {
        return starts.slice(0, starts.length - 1);
    }
    return starts;
}

/**
 * Split content into lines the way the Rust operator does.
 *
 * `linesOf` derives the last line's end from `content.length`, so a file ending in a newline
 * yields a final line that still carries its `\n`, while every earlier line has already had
 * the terminator removed. The Rust `split_lines` strips the terminator uniformly, so the
 * trailing newline is trimmed here to keep both engines byte-identical.
 *
 * @param content - Source text to split.
 * @param starts - Line-start offsets, already trimmed of any synthetic trailing line.
 * @returns One string per line, without line terminators.
 */
export function splitLinesLikeNative(content: string, starts: number[]): string[] {
    const out = linesOf(content, starts);
    if (out.length > 0) {
        out[out.length - 1] = out[out.length - 1].replace(/\r?\n$/, '');
    }
    return out;
}

/**
 * Line hashes truncated to match a trimmed line count.
 *
 * @param index - Line index produced by `computeLineStartsAndHashes`.
 * @param lineCount - Number of lines after trailing-line trimming.
 * @returns Hash array of exactly `lineCount` entries.
 */
export function trimTrailingHash(index: LineIndex, lineCount: number): Uint32Array {
    if (index.hashes.length === lineCount) {
        return index.hashes;
    }
    return index.hashes.slice(0, lineCount);
}

/**
 * Finds preceding equal context line count before a cluster start.
 */
function findPrecedingContextCount(
    ops: DiffOp[],
    clusterStart: number,
    contextLines: number,
): number {
    let count = 0;
    let ctxIdx = clusterStart - 1;
    while (ctxIdx >= 0 && ops[ctxIdx].type === DIFF_OP_EQUAL && count < contextLines) {
        count++;
        ctxIdx--;
    }
    return count;
}

/**
 * Determines cluster end index, bridging adjacent change blocks separated by few equal lines.
 */
function findClusterEnd(ops: DiffOp[], clusterStart: number, contextLines: number): number {
    let clusterEnd = clusterStart;
    while (clusterEnd < ops.length) {
        if (ops[clusterEnd].type === DIFF_OP_DELETE || ops[clusterEnd].type === DIFF_OP_INSERT) {
            clusterEnd++;
            continue;
        }
        if (ops[clusterEnd].type === DIFF_OP_EQUAL_SPAN) {
            break;
        }
        let equalLookahead = clusterEnd;
        while (equalLookahead < ops.length && ops[equalLookahead].type === DIFF_OP_EQUAL) {
            equalLookahead++;
        }
        const canBridge =
            equalLookahead < ops.length && equalLookahead - clusterEnd <= contextLines * 2;
        if (canBridge) {
            clusterEnd = equalLookahead;
        } else {
            break;
        }
    }
    return clusterEnd;
}

/**
 * Finds trailing equal context line count after a cluster end.
 */
function findTrailingContextCount(ops: DiffOp[], clusterEnd: number, contextLines: number): number {
    let count = 0;
    let trailIdx = clusterEnd;
    while (trailIdx < ops.length && ops[trailIdx].type === DIFF_OP_EQUAL && count < contextLines) {
        count++;
        trailIdx++;
    }
    return count;
}

/**
 * Builds a single NativeDiffHunk from DiffOp operations within the specified range.
 */
function buildHunk(context: {
    readonly ops: DiffOp[];
    readonly startIdx: number;
    readonly endIdx: number;
    readonly oldLines: string[];
    readonly newLines: string[];
}): NativeDiffHunk {
    const state: HunkBuilderState = {
        oldStart: 0,
        newStart: 0,
        oldLinesCount: 0,
        newLinesCount: 0,
        lines: [],
        firstOldAssigned: false,
        firstNewAssigned: false,
    };

    for (let opIdx = context.startIdx; opIdx < context.endIdx; opIdx++) {
        const diffOp = context.ops[opIdx];
        if (diffOp.type === DIFF_OP_EQUAL) {
            applyDiffOpEqual(diffOp, context.oldLines, state);
            continue;
        }
        if (diffOp.type === DIFF_OP_DELETE) {
            applyDiffOpDelete(diffOp, context.oldLines, state);
            continue;
        }
        if (diffOp.type === DIFF_OP_INSERT) {
            applyDiffOpInsert(diffOp, context.newLines, state);
        }
    }

    return {
        oldStart: state.oldStart || 1,
        oldLines: state.oldLinesCount,
        newStart: state.newStart || 1,
        newLines: state.newLinesCount,
        lines: state.lines,
    };
}

/**
 * Clusters DiffOp operations into contiguous unified diff hunks with context lines.
 *
 * @param ops - Sequence of diff operations.
 * @param oldLines - Lines from original source text.
 * @param newLines - Lines from modified source text.
 * @param contextLines - Number of surrounding context lines.
 * @returns Array of assembled native diff hunks.
 */
export function assembleHunksShim(
    ops: DiffOp[],
    oldLines: string[],
    newLines: string[],
    contextLines: number,
): NativeDiffHunk[] {
    const hunks: NativeDiffHunk[] = [];
    let opIndex = 0;

    while (opIndex < ops.length) {
        if (ops[opIndex].type === DIFF_OP_EQUAL || ops[opIndex].type === DIFF_OP_EQUAL_SPAN) {
            opIndex++;
            continue;
        }

        const clusterStart = opIndex;
        const contextBefore = findPrecedingContextCount(ops, clusterStart, contextLines);
        const hunkOpsStart = clusterStart - contextBefore;

        const clusterEnd = findClusterEnd(ops, clusterStart, contextLines);
        const contextAfter = findTrailingContextCount(ops, clusterEnd, contextLines);
        const hunkOpsEnd = clusterEnd + contextAfter;

        hunks.push(
            buildHunk({
                ops,
                startIdx: hunkOpsStart,
                endIdx: hunkOpsEnd,
                oldLines,
                newLines,
            }),
        );

        opIndex = clusterEnd;
    }

    return hunks;
}

/**
 * Computes line-level histogram diff hunks between oldContent and newContent in pure JS.
 *
 * @param oldContent - Original text content.
 * @param newContent - Modified text content.
 * @param defaultContextLines - Surrounding unchanged lines preserved per hunk.
 * @returns Array of calculated native diff hunks.
 */
export function computeHistogramDiffShim(
    oldContent: string,
    newContent: string,
    defaultContextLines = 3,
): NativeDiffHunk[] {
    if (oldContent === newContent) {
        return [];
    }

    const oldIndex = computeLineStartsAndHashes(oldContent);
    const newIndex = computeLineStartsAndHashes(newContent);
    const oldLines = splitLinesLikeNative(
        oldContent,
        trimTrailingLineStart(oldContent, oldIndex.starts),
    );
    const newLines = splitLinesLikeNative(
        newContent,
        trimTrailingLineStart(newContent, newIndex.starts),
    );

    const oldHashes = trimTrailingHash(oldIndex, oldLines.length);
    const newHashes = trimTrailingHash(newIndex, newLines.length);

    const ops = histogramDiff(oldLines, newLines, oldHashes, newHashes);
    return assembleHunksShim(ops, oldLines, newLines, defaultContextLines);
}
