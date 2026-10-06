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
    DIFF_OP_EQUAL,
    DIFF_OP_DELETE,
    DIFF_OP_INSERT,
    MYERS_MAX_MID_LINES,
    myersDiff,
    myersDiffCore,
    trimPrefixSuffix,
} from './myers-algorithm';
import {
    DEFAULT_CONTEXT_LINES,
    getLine,
    buildReviewHunksFromOps,
    formatUnifiedDiff,
} from './hunk-builder';
import { nativeCore } from '../native';
import type { NativeDiffHunk } from '../native';

export { histogramDiff, myersDiff, DiffOp, getLine, formatUnifiedDiff };

/**
 * Computes line-level histogram diff hunks using the high-performance native Rust operator.
 *
 * @param oldContent - Original text content before modifications.
 * @param newContent - Updated text content after modifications.
 * @returns Array of native diff hunks describing line changes.
 */
export function fastNativeDiff(oldContent: string, newContent: string): NativeDiffHunk[] {
    return nativeCore.computeHistogramDiff(oldContent, newContent);
}

/** UTF-16 code unit of LINE FEED (`\n`), the only character that starts a new line. */
const LINE_FEED_CODE = 10;

/** Initial line-table capacity in lines; small inputs avoid an immediate reallocation. */
const MIN_LINE_CAPACITY = 16;

/** Estimated source code units per line when sizing the initial line-table capacity. */
const SOURCE_CHARS_PER_LINE_SLOT = 32;

/** 32-bit FNV-1a multiplication prime (0x01000193). */
const FNV1A_32_PRIME = 0x01000193;

/** Initial FNV-1a 32-bit hash state (offset basis), reset at each line start. */
const FNV1A_32_OFFSET_BASIS = 0x811c9dc5;

/** `typeof` tag for numeric edit-range fields; non-numeric input is rejected. */
const TYPEOF_NUMBER = 'number';

/**
 * One contiguous edit (a run of adjacent line insertions/deletions, i.e. a "replace"
 * block). Line numbers are 1-based; byte offsets are UTF-16 code-unit offsets.
 */
export interface EditRange {
    /** 1-based first affected line (the same index in old and new content). */
    startLine: number;
    /** 1-based last OLD line consumed by this edit (inclusive). */
    oldEndLine: number;
    /** 1-based last NEW line produced by this edit (inclusive). */
    newEndLine: number;
    /** Byte offset where the edit starts (identical in old and new content). */
    startByte: number;
    /** Byte offset immediately AFTER the old (deleted) span. */
    oldEndByte: number;
    /** Byte offset immediately AFTER the new (inserted) span. */
    newEndByte: number;
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
    for (let i = 0; i < content.length; i++) {
        if (content.charCodeAt(i) === LINE_FEED_CODE) starts.push(i + 1);
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
    let n = 1;
    for (let i = 0; i < content.length; i++) {
        if (content.charCodeAt(i) === LINE_FEED_CODE) n++;
    }
    return n;
}

/**
 * Split content into lines using precomputed line starts.
 *
 * @param content - Source text to split; it must correspond to `starts`.
 * @param starts - Line-start offsets from `computeLineStarts` or `computeLineStartsAndHashes`.
 * @returns One string per line start.
 */
export function linesOf(content: string, starts: number[]): string[] {
    const out: string[] = new Array(starts.length);
    for (let i = 0; i < starts.length; i++) {
        const startOffset = starts[i];
        const endOffset = i + 1 < starts.length ? starts[i + 1] - 1 : content.length;
        out[i] = content.slice(startOffset, endOffset);
    }
    return out;
}

/**
 * Precomputed line table returned by `computeLineStartsAndHashes`.
 */
export interface LineIndex {
    starts: number[];
    hashes: Uint32Array;
}

function reallocateLineBuffers(
    startsBuf: Int32Array,
    hashesBuf: Uint32Array,
    capacity: number,
): { starts: Int32Array; hashes: Uint32Array; capacity: number } {
    const nextCapacity = capacity << 1;
    const nextStarts = new Int32Array(nextCapacity);
    nextStarts.set(startsBuf);
    const nextHashes = new Uint32Array(nextCapacity);
    nextHashes.set(hashesBuf);
    return { starts: nextStarts, hashes: nextHashes, capacity: nextCapacity };
}

/**
 * Compute line starts and 32-bit FNV-1a line hashes in one pass over the source.
 *
 * @param content - Source text to index.
 * @returns `starts` and `hashes`, both indexed by 0-based line number.
 */
export function computeLineStartsAndHashes(content: string): LineIndex {
    const len = content.length;
    let capacity = Math.max(MIN_LINE_CAPACITY, Math.ceil(len / SOURCE_CHARS_PER_LINE_SLOT));
    let startsBuf: Int32Array = new Int32Array(capacity);
    let hashesBuf: Uint32Array = new Uint32Array(capacity);
    startsBuf[0] = 0;
    let lineCount = 1;

    let hash = FNV1A_32_OFFSET_BASIS;
    for (let i = 0; i < len; i++) {
        const code = content.charCodeAt(i);
        if (code === LINE_FEED_CODE) {
            if (lineCount >= capacity) {
                const resized = reallocateLineBuffers(startsBuf, hashesBuf, capacity);
                startsBuf = resized.starts;
                hashesBuf = resized.hashes;
                capacity = resized.capacity;
            }
            hashesBuf[lineCount - 1] = hash >>> 0;
            startsBuf[lineCount] = i + 1;
            lineCount++;
            hash = FNV1A_32_OFFSET_BASIS;
        } else {
            hash ^= code;
            hash = Math.imul(hash, FNV1A_32_PRIME);
        }
    }
    hashesBuf[lineCount - 1] = hash >>> 0;

    const starts: number[] = new Array(lineCount);
    for (let i = 0; i < lineCount; i++) starts[i] = startsBuf[i];
    const hashes = hashesBuf.slice(0, lineCount);

    return { starts, hashes };
}

/**
 * Hash every line in a single pass directly from content and line starts.
 *
 * @param content - Source text whose lines are hashed.
 * @param starts - Line-start offsets.
 * @returns Unsigned 32-bit FNV-1a hashes.
 */
export function hashLinesDirect(content: string, starts: number[]): Uint32Array {
    const n = starts.length;
    const hashes = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
        const startOffset = starts[i];
        const endOffset = i + 1 < n ? starts[i + 1] - 1 : content.length;
        let hash = FNV1A_32_OFFSET_BASIS;
        for (let j = startOffset; j < endOffset; j++) {
            hash ^= content.charCodeAt(j);
            hash = Math.imul(hash, FNV1A_32_PRIME);
        }
        hashes[i] = hash >>> 0;
    }
    return hashes;
}

/**
 * Compute the 32-bit FNV-1a hash of a string.
 *
 * @param str - Text to hash.
 * @returns Unsigned 32-bit hash.
 */
export function fnv1a32(str: string): number {
    let hash = FNV1A_32_OFFSET_BASIS;
    for (let i = 0; i < str.length; i++) {
        hash ^= str.charCodeAt(i);
        hash = Math.imul(hash, FNV1A_32_PRIME);
    }
    return hash >>> 0;
}

/**
 * Hash every entry of an already-split line array.
 *
 * @param lines - Lines to hash.
 * @returns One unsigned 32-bit FNV-1a hash per input line.
 */
export function hashLines(lines: string[]): Uint32Array {
    const hashes = new Uint32Array(lines.length);
    for (let i = 0; i < lines.length; i++) {
        hashes[i] = fnv1a32(lines[i]);
    }
    return hashes;
}

/**
 * Diffs two line arrays by trimming their common prefix and suffix, dynamically selecting
 * between Myers and Histogram algorithms for the middle span.
 *
 * Preconditions:
 *   - When precomputed line hash buffers (`oldLineHashes`, `newLineHashes`) are provided,
 *     they MUST be strictly equal in length to their corresponding line arrays
 *     (`oldLineHashes.length === oldLines.length` and
 *     `newLineHashes.length === newLines.length`). Mismatched lengths violate slice
 *     indexing assumptions and cause out-of-bounds access or false matching during
 *     prefix/suffix trimming.
 *
 * Degradation & Fallback Strategy:
 *   - The middle modified section is inspected against Myers complexity thresholds.
 *   - If either middle section exceeds `MYERS_MAX_MID_LINES` (1500 lines, `midN > 1500` or
 *     `midM > 1500`) or if the search grid exceeds 2,000,000 cells
 *     (`(midN + midM + 1) * (2 * (midN + midM) + 1) > 2_000_000`), the algorithm
 *     automatically degrades and falls back to `histogramDiff` to prevent quadratic
 *     O(ND) trace buffer explosion and eliminate the risk of out-of-memory (OOM) failures.
 *
 * @param oldLines - Array of lines from the original/old content.
 * @param newLines - Array of lines from the modified/new content.
 * @param oldLineHashes - Optional precomputed 32-bit FNV-1a hashes for `oldLines`.
 *   Precondition: must equal `oldLines.length`.
 * @param newLineHashes - Optional precomputed 32-bit FNV-1a hashes for `newLines`.
 *   Precondition: must equal `newLines.length`.
 * @returns Ordered edit script (`DiffOp[]`) expressing changes required to transform
 *   `oldLines` into `newLines`.
 */
export function fastDiff(
    oldLines: string[],
    newLines: string[],
    oldLineHashes?: Uint32Array,
    newLineHashes?: Uint32Array,
): DiffOp[] {
    const n = oldLines.length;
    const m = newLines.length;
    if (n === 0 && m === 0) return [];
    if (n === 0) return newLines.map((_, bIdx) => ({ type: DIFF_OP_INSERT, aIdx: 0, bIdx }));
    if (m === 0) return oldLines.map((_, aIdx) => ({ type: DIFF_OP_DELETE, aIdx, bIdx: 0 }));

    const hashA = oldLineHashes || hashLines(oldLines);
    const hashB = newLineHashes || hashLines(newLines);

    const { prefix, suffix, midA, midB, midHA, midHB } = trimPrefixSuffix(
        oldLines,
        newLines,
        hashA,
        hashB,
    );

    return myersDiffCore(prefix, suffix, n, m, midA, midB, midHA, midHB);
}

function hasInvalidCoordinates(editRange: EditRange): boolean {
    const coords = [
        editRange.startLine,
        editRange.oldEndLine,
        editRange.newEndLine,
        editRange.startByte,
        editRange.oldEndByte,
        editRange.newEndByte,
    ];
    for (let i = 0; i < coords.length; i++) {
        if (typeof coords[i] !== TYPEOF_NUMBER || !Number.isFinite(coords[i])) {
            return true;
        }
    }
    return false;
}

function validateEditLineBounds(editRange: EditRange): void {
    if (editRange.startLine < 1) {
        throw new Error('invalid edit range: startLine < 1');
    }
    if (editRange.oldEndLine < editRange.startLine || editRange.newEndLine < editRange.startLine) {
        throw new Error('invalid edit range: end line before start line');
    }
}

function validateEditByteBounds(editRange: EditRange, maxByte?: number): void {
    if (editRange.startByte < 0) {
        throw new Error('invalid edit range: negative byte offset');
    }
    if (editRange.oldEndByte < editRange.startByte || editRange.newEndByte < editRange.startByte) {
        throw new Error('invalid edit range: end byte before start byte');
    }
    if (maxByte === undefined) return;
    if (
        editRange.startByte > maxByte ||
        editRange.oldEndByte > maxByte ||
        editRange.newEndByte > maxByte
    ) {
        throw new Error('invalid edit range: byte offset out of bounds');
    }
}

function validateSingleEditRange(editRange: EditRange, maxByte?: number): void {
    if (!editRange || hasInvalidCoordinates(editRange)) {
        throw new Error('invalid edit range: non-numeric field');
    }
    validateEditLineBounds(editRange);
    validateEditByteBounds(editRange, maxByte);
}

/**
 * Validate a set of edit ranges, throwing on the first invalid range.
 *
 * @param edits - Candidate ranges validated in order.
 * @param maxByte - Optional inclusive byte bound.
 */
export function validateEditRanges(edits: EditRange[], maxByte?: number): void {
    for (const edit of edits) {
        validateSingleEditRange(edit, maxByte);
    }
}

/**
 * Count every line touched by a set of edits.
 *
 * @param edits - Validated edit ranges.
 * @returns Total deleted + inserted line count.
 */
export function changedLineCount(edits: EditRange[]): number {
    let n = 0;
    for (const edit of edits) {
        n += edit.oldEndLine - edit.startLine + 1 + (edit.newEndLine - edit.startLine + 1);
    }
    return n;
}

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
 * Count deleted and inserted lines in a contiguous changed block.
 */
function scanContiguousEdits(
    ops: DiffOp[],
    startIndex: number,
): { delCount: number; insCount: number; nextIndex: number } {
    let delCount = 0;
    let insCount = 0;
    let i = startIndex;
    while (i < ops.length && ops[i].type !== DIFF_OP_EQUAL) {
        if (ops[i].type === DIFF_OP_DELETE) delCount++;
        else insCount++;
        i++;
    }
    return { delCount, insCount, nextIndex: i };
}

/**
 * Extract contiguous edit ranges from diff operations.
 */
function extractEditRanges(
    ops: DiffOp[],
    oldStarts: number[],
    newStarts: number[],
    oldLen: number,
    newLen: number,
): EditRange[] {
    const edits: EditRange[] = [];
    let i = 0;
    while (i < ops.length) {
        if (ops[i].type === DIFF_OP_EQUAL) {
            i++;
            continue;
        }
        const startIdx = ops[i].aIdx;
        const scan = scanContiguousEdits(ops, i);
        const delCount = scan.delCount;
        const insCount = scan.insCount;
        i = scan.nextIndex;

        const startByte = startIdx < oldStarts.length ? oldStarts[startIdx] : oldLen;
        const oldEndIdx = startIdx + delCount;
        const newEndIdx = startIdx + insCount;
        const oldEndByte = oldEndIdx < oldStarts.length ? oldStarts[oldEndIdx] : oldLen;
        const newEndByte = newEndIdx < newStarts.length ? newStarts[newEndIdx] : newLen;
        edits.push({
            startLine: startIdx + 1,
            oldEndLine: startIdx + delCount,
            newEndLine: startIdx + insCount,
            startByte,
            oldEndByte,
            newEndByte,
        });
    }
    return edits;
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
    const oldLines = linesOf(oldContent, oldIndex.starts);
    const newLines = linesOf(newContent, newIndex.starts);
    const ops = fastDiff(oldLines, newLines, oldIndex.hashes, newIndex.hashes);
    const edits = extractEditRanges(
        ops,
        oldIndex.starts,
        newIndex.starts,
        oldContent.length,
        newContent.length,
    );

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
    return changedLineCount(edits) <= maxChangedLines;
}

/**
 * Build review-level hunks with line numbers, context lines, and diff operations.
 *
 * @param oldContent - Previous file content.
 * @param newContent - Current file content.
 * @param contextLines - Equal lines of context.
 * @param precomputedOps - Optional precomputed ops.
 * @param precomputedStartsOld - Optional line starts.
 * @param precomputedStartsNew - Optional line starts.
 * @returns Review hunks in ascending order.
 */
export function computeDetailedHunks(
    oldContent: string,
    newContent: string,
    contextLines: number = DEFAULT_CONTEXT_LINES,
    precomputedOps?: DiffOp[],
    precomputedStartsOld?: number[],
    precomputedStartsNew?: number[],
): ReviewDiffHunk[] {
    if (oldContent === newContent) return [];
    const oldStarts = precomputedStartsOld || computeLineStarts(oldContent);
    const newStarts = precomputedStartsNew || computeLineStarts(newContent);
    let ops = precomputedOps;
    if (!ops) {
        const oldIndex = computeLineStartsAndHashes(oldContent);
        const newIndex = computeLineStartsAndHashes(newContent);
        const oldLines = linesOf(oldContent, oldIndex.starts);
        const newLines = linesOf(newContent, newIndex.starts);
        ops = fastDiff(oldLines, newLines, oldIndex.hashes, newIndex.hashes);
    }
    return buildReviewHunksFromOps(oldContent, newContent, ops, oldStarts, newStarts, contextLines);
}
