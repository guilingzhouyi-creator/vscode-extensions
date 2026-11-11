/**
 * Module: Core Engine — Line-Level Diff & Edit-Range Primitives
 * File Path: src/core/diff/edit-diff.ts
 * Architecture Role: TypeScript-free pure-function foundation for incremental scanning:
 *                    line indexes/hashes, Myers and adaptive diffs, edit ranges, review hunks.
 * Dependencies & Triggers: Imported by diff routing, incremental wiring, and review packaging;
 *                    depends on histogramDiff, myers-algorithm, hunk-builder and Praxis contracts.
 * Responsibilities: Compute line starts/counts/FNV-1a hashes, run adaptive fastDiff with
 *                    prefix/suffix pruning and Myers/Histogram switching, validate edit ranges,
 *                    count changed lines, compose byte-range edits, gate incremental-worthiness.
 * Exit Semantics & Design Rationale: Pure functions throw only from validateEditRanges on
 *                    malformed ranges; identical inputs return empty edits/hunks immediately;
 *                    Lines are 1-based and byte offsets are UTF-16 code units to match LSP.
 */

import type { ReviewDiffHunk } from '../praxis/contracts';
import { histogramDiff } from './histogram-diff';
import {
    DiffOp,
    DIFF_OP_EQUAL_SPAN,
    myersDiff,
    myersDiffCore,
    trimPrefixSuffix,
    DIFF_OP_DELETE,
    DIFF_OP_INSERT,
} from './myers-algorithm';
import {
    DEFAULT_CONTEXT_LINES,
    getLine,
    buildReviewHunksFromOps,
    formatUnifiedDiff,
} from './hunk-builder';
import { nativeCore } from '../native';
import type { NativeDiffHunk } from '../native';
import { FNV1A_32_PRIME, FNV1A_32_OFFSET_BASIS, fnv1a32, hashLines } from '../algorithms/hash';
import { acquireLineBuffers, expandWorkingBuffers, releaseLineBuffers } from './line-buffer-pool';
import {
    type EditRange,
    type EditRangeExtractionParams,
    extractEditRanges,
    validateEditRanges,
    validateSingleEditRange,
} from './edit-range-validator';

export {
    histogramDiff,
    myersDiff,
    DiffOp,
    DIFF_OP_EQUAL_SPAN,
    getLine,
    formatUnifiedDiff,
    fnv1a32,
    hashLines,
    type EditRange,
    type EditRangeExtractionParams,
    extractEditRanges,
    validateEditRanges,
    validateSingleEditRange,
};

/** UTF-16 code unit of LINE FEED (`\n`), the only character that starts a new line. */
const LINE_FEED_CODE = 10;

/** Initial line-table capacity in lines; small inputs avoid an immediate reallocation. */
const MIN_LINE_CAPACITY = 16;

/** Estimated source code units per line when sizing the initial line-table capacity. */
const SOURCE_CHARS_PER_LINE_SLOT = 32;

/**
 * Computes line-level histogram diff hunks using the high-performance native Rust operator.
 *
 * @param oldContent - Original text content before modifications.
 * @param newContent - Updated text content after modifications.
 * @returns Array of native diff hunks describing line changes.
 */
export function fastNativeDiff(oldContent: string, newContent: string): NativeDiffHunk[] {
    if (oldContent === newContent) return [];
    return nativeCore.computeHistogramDiff(oldContent, newContent);
}

/**
 * Compute the byte offset of every line start: index 0 is offset 0 and each later entry is
 * the index just after a `\n`.
 *
 * @param content - Source text whose line starts are indexed; only `\n` starts a new line.
 * @returns Array of UTF-16 offsets with one entry per line, index 0 always being 0.
 */
export function computeLineStarts(content: string): number[] {
    const starts: number[] = [0];
    for (let charIndex = 0; charIndex < content.length; charIndex++) {
        if (content.charCodeAt(charIndex) === LINE_FEED_CODE) {
            starts.push(charIndex + 1);
        }
    }
    return starts;
}

/**
 * Count lines as 1 + the number of `\n` characters.
 *
 * @param content - Source text to measure.
 * @returns Line count, always at least 1.
 */
export function countLines(content: string): number {
    let totalLines = 1;
    for (let charIndex = 0; charIndex < content.length; charIndex++) {
        if (content.charCodeAt(charIndex) === LINE_FEED_CODE) {
            totalLines++;
        }
    }
    return totalLines;
}

/**
 * Split content into lines using precomputed line starts.
 *
 * @param content - Source text to split; it must correspond to `starts`.
 * @param starts - Line-start offsets from `computeLineStarts` or `computeLineStartsAndHashes`.
 * @returns One string per line start.
 */
export function extractLinesOf(content: string, starts: number[]): string[] {
    const out: string[] = [];
    for (let lineIndex = 0; lineIndex < starts.length; lineIndex++) {
        const startOffset = starts[lineIndex];
        const endOffset =
            lineIndex + 1 < starts.length ? starts[lineIndex + 1] - 1 : content.length;
        out.push(content.slice(startOffset, endOffset));
    }
    return out;
}

/** Backward compatibility alias for extractLinesOf. */
export const linesOf = extractLinesOf;

/**
 * Precomputed line table returned by `computeLineStartsAndHashes`.
 */
export interface LineIndex {
    starts: number[];
    hashes: Uint32Array;
}

/**
 * Compute line starts and 32-bit FNV-1a line hashes in one pass over the source.
 *
 * @param content - Source text to index.
 * @returns `starts` and `hashes`, both indexed by 0-based line number.
 */
export function computeLineStartsAndHashes(content: string): LineIndex {
    const len = content.length;
    const initialCap = Math.max(MIN_LINE_CAPACITY, Math.ceil(len / SOURCE_CHARS_PER_LINE_SLOT));
    const buffers = acquireLineBuffers(initialCap);

    try {
        buffers.starts[0] = 0;
        let lineCount = 1;
        let hash = FNV1A_32_OFFSET_BASIS;

        for (let charIndex = 0; charIndex < len; charIndex++) {
            const code = content.charCodeAt(charIndex);
            if (code !== LINE_FEED_CODE) {
                hash ^= code;
                hash = Math.imul(hash, FNV1A_32_PRIME);
                continue;
            }
            if (lineCount >= buffers.capacity) {
                expandWorkingBuffers(buffers);
            }
            buffers.hashes[lineCount - 1] = hash >>> 0;
            buffers.starts[lineCount] = charIndex + 1;
            lineCount++;
            hash = FNV1A_32_OFFSET_BASIS;
        }
        buffers.hashes[lineCount - 1] = hash >>> 0;

        const starts: number[] = [];
        for (let lineIndex = 0; lineIndex < lineCount; lineIndex++) {
            starts.push(buffers.starts[lineIndex]);
        }
        const hashes = buffers.hashes.slice(0, lineCount);

        return { starts, hashes };
    } finally {
        releaseLineBuffers(buffers);
    }
}

/**
 * Hash every line in a single pass directly from content and line starts.
 *
 * @param content - Source text whose lines are hashed.
 * @param starts - Line-start offsets.
 * @returns Unsigned 32-bit FNV-1a hashes.
 */
export function hashLinesDirect(content: string, starts: number[]): Uint32Array {
    const lineCount = starts.length;
    const hashes = new Uint32Array(lineCount);
    for (let lineIndex = 0; lineIndex < lineCount; lineIndex++) {
        const startOffset = starts[lineIndex];
        const endOffset = lineIndex + 1 < lineCount ? starts[lineIndex + 1] - 1 : content.length;
        let hash = FNV1A_32_OFFSET_BASIS;
        for (let charIndex = startOffset; charIndex < endOffset; charIndex++) {
            hash ^= content.charCodeAt(charIndex);
            hash = Math.imul(hash, FNV1A_32_PRIME);
        }
        hashes[lineIndex] = hash >>> 0;
    }
    return hashes;
}

/**
 * Diffs two line arrays by trimming their common prefix and suffix, dynamically selecting
 * between Myers and Histogram algorithms for the middle span.
 *
 * Preconditions:
 *   - When precomputed line hash buffers (`oldLineHashes`, `newLineHashes`) are provided,
 *     they MUST be strictly equal in length to their corresponding line arrays.
 *
 * Degradation & Fallback Strategy:
 *   - Falls back to `histogramDiff` if the search grid exceeds complexity bounds.
 *
 * @param oldLines - Array of lines from the original/old content.
 * @param newLines - Array of lines from the modified/new content.
 * @param oldLineHashes - Optional precomputed 32-bit FNV-1a hashes for `oldLines`.
 * @param newLineHashes - Optional precomputed 32-bit FNV-1a hashes for `newLines`.
 * @returns Ordered edit script (`DiffOp[]`) expressing changes required to transform
 *   `oldLines` into `newLines`.
 */
export function fastDiff(
    oldLines: string[],
    newLines: string[],
    oldLineHashes?: Uint32Array,
    newLineHashes?: Uint32Array,
): DiffOp[] {
    const oldLen = oldLines.length;
    const newLen = newLines.length;
    if (oldLen === 0 && newLen === 0) return [];
    if (oldLen === 0) return newLines.map((_, bIdx) => ({ type: DIFF_OP_INSERT, aIdx: 0, bIdx }));
    if (newLen === 0) return oldLines.map((_, aIdx) => ({ type: DIFF_OP_DELETE, aIdx, bIdx: 0 }));

    const hashA = oldLineHashes || hashLines(oldLines);
    const hashB = newLineHashes || hashLines(newLines);

    const { prefix, suffix, midA, midB, midHA, midHB } = trimPrefixSuffix(
        oldLines,
        newLines,
        hashA,
        hashB,
    );

    return myersDiffCore({
        prefix,
        suffix,
        oldLineCount: oldLen,
        newLineCount: newLen,
        midA,
        midB,
        midHA,
        midHB,
    });
}

/**
 * Count every line touched by a set of edits.
 *
 * @param edits - Validated edit ranges.
 * @returns Total deleted + inserted line count.
 */
export function countChangedLines(edits: EditRange[]): number {
    let totalChanged = 0;
    for (const edit of edits) {
        totalChanged +=
            edit.oldEndLine - edit.startLine + 1 + (edit.newEndLine - edit.startLine + 1);
    }
    return totalChanged;
}

/** Backward compatibility alias for countChangedLines. */
export const changedLineCount = countChangedLines;

/**
 * Coordinated result of one line diff.
 */
export interface DetailedDiffResult {
    edits: EditRange[];
    ops: DiffOp[];
    oldIndex: LineIndex;
    newIndex: LineIndex;
}

/**
 * Compute byte-level edit ranges and line operations in one pass.
 *
 * @param oldContent - Previous file content.
 * @param newContent - Current file content.
 * @returns The edit ranges, diff operations, and both line indexes.
 */
export function computeEditRangesWithOps(
    oldContent: string,
    newContent: string,
): DetailedDiffResult {
    if (oldContent === newContent) {
        const emptyIndex: LineIndex = { starts: [0], hashes: new Uint32Array(0) };
        return { edits: [], ops: [], oldIndex: emptyIndex, newIndex: emptyIndex };
    }

    const oldIndex = computeLineStartsAndHashes(oldContent);
    const newIndex = computeLineStartsAndHashes(newContent);
    const oldLines = extractLinesOf(oldContent, oldIndex.starts);
    const newLines = extractLinesOf(newContent, newIndex.starts);
    const ops = fastDiff(oldLines, newLines, oldIndex.hashes, newIndex.hashes);
    const edits = extractEditRanges({
        ops,
        oldStarts: oldIndex.starts,
        newStarts: newIndex.starts,
        oldLen: oldContent.length,
        newLen: newContent.length,
    });

    return { edits, ops, oldIndex, newIndex };
}

/**
 * Compute byte-level edit ranges between two contents.
 *
 * @param oldContent - Previous file content.
 * @param newContent - Current file content.
 * @returns LSP-style edit ranges.
 */
export function computeEditRanges(oldContent: string, newContent: string): EditRange[] {
    return computeEditRangesWithOps(oldContent, newContent).edits;
}

/**
 * Decide whether a file is worth an incremental rescan.
 *
 * @param oldContent - Previous content.
 * @param newContent - Current content.
 * @param minLines - Minimum NEW line count required.
 * @param maxChangedLines - Maximum changed lines accepted.
 * @returns true when eligible for incremental processing.
 */
export function shouldUseIncremental(
    oldContent: string,
    newContent: string,
    minLines: number,
    maxChangedLines: number,
): boolean {
    const { edits, newIndex } = computeEditRangesWithOps(oldContent, newContent);
    if (newIndex.starts.length < minLines) return false;
    return countChangedLines(edits) <= maxChangedLines;
}

/**
 * Options configuring review-level hunk synthesis.
 */
export interface DetailedHunkOptions {
    contextLines?: number;
    precomputedOps?: DiffOp[];
    precomputedStartsOld?: number[];
    precomputedStartsNew?: number[];
}

/**
 * Build review-level hunks with line numbers, context lines, and diff operations.
 *
 * @param oldContent - Previous file content.
 * @param newContent - Current file content.
 * @param options - Configuration options or context line limit.
 * @returns Review hunks in ascending order.
 */
export function computeDetailedHunks(
    oldContent: string,
    newContent: string,
    options: DetailedHunkOptions = {},
): ReviewDiffHunk[] {
    if (oldContent === newContent) return [];
    const contextLines = options.contextLines ?? DEFAULT_CONTEXT_LINES;
    const oldStarts = options.precomputedStartsOld || computeLineStarts(oldContent);
    const newStarts = options.precomputedStartsNew || computeLineStarts(newContent);
    let ops = options.precomputedOps;
    if (!ops) {
        const oldIndex = computeLineStartsAndHashes(oldContent);
        const newIndex = computeLineStartsAndHashes(newContent);
        const oldLines = extractLinesOf(oldContent, oldIndex.starts);
        const newLines = extractLinesOf(newContent, newIndex.starts);
        ops = fastDiff(oldLines, newLines, oldIndex.hashes, newIndex.hashes);
    }
    return buildReviewHunksFromOps(oldContent, newContent, ops, oldStarts, newStarts, contextLines);
}
