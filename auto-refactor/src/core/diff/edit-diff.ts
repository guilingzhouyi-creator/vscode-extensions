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
    trimPrefixSuffix,
} from './myers-algorithm';
import {
    DEFAULT_CONTEXT_LINES,
    getLine,
    buildReviewHunksFromOps,
    formatUnifiedDiff,
} from './hunk-builder';

export { histogramDiff, myersDiff, DiffOp, getLine, formatUnifiedDiff };

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
        const s = starts[i];
        const e = i + 1 < starts.length ? starts[i + 1] - 1 : content.length;
        out[i] = content.slice(s, e);
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

/**
 * Compute line starts and 32-bit FNV-1a line hashes in one pass over the source.
 *
 * @param content - Source text to index.
 * @returns `starts` and `hashes`, both indexed by 0-based line number.
 */
export function computeLineStartsAndHashes(content: string): LineIndex {
    const len = content.length;
    let capacity = Math.max(MIN_LINE_CAPACITY, Math.ceil(len / SOURCE_CHARS_PER_LINE_SLOT));
    let startsBuf = new Int32Array(capacity);
    let hashesBuf = new Uint32Array(capacity);
    startsBuf[0] = 0;
    let lineCount = 1;

    let hash = FNV1A_32_OFFSET_BASIS;
    for (let i = 0; i < len; i++) {
        const code = content.charCodeAt(i);
        if (code === LINE_FEED_CODE) {
            if (lineCount >= capacity) {
                capacity = capacity << 1;
                const nextStarts = new Int32Array(capacity);
                nextStarts.set(startsBuf);
                startsBuf = nextStarts;
                const nextHashes = new Uint32Array(capacity);
                nextHashes.set(hashesBuf);
                hashesBuf = nextHashes;
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
        const s = starts[i];
        const e = i + 1 < n ? starts[i + 1] - 1 : content.length;
        let hash = FNV1A_32_OFFSET_BASIS;
        for (let j = s; j < e; j++) {
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
 * Diff two line arrays after trimming their common prefix and suffix.
 *
 * @param a - OLD lines.
 * @param b - NEW lines.
 * @param hA - Optional precomputed hashes for a.
 * @param hB - Optional precomputed hashes for b.
 * @returns Ordered edit script.
 */
export function fastDiff(a: string[], b: string[], hA?: Uint32Array, hB?: Uint32Array): DiffOp[] {
    const n = a.length;
    const m = b.length;
    if (n === 0 && m === 0) return [];
    if (n === 0) return b.map((_, bIdx) => ({ type: DIFF_OP_INSERT, aIdx: 0, bIdx }));
    if (m === 0) return a.map((_, aIdx) => ({ type: DIFF_OP_DELETE, aIdx, bIdx: 0 }));

    const hashA = hA || hashLines(a);
    const hashB = hB || hashLines(b);

    const { prefix, suffix, midA, midB, midHA, midHB } = trimPrefixSuffix(a, b, hashA, hashB);
    const midN = midA.length;
    const midM = midB.length;

    if (midN === 0 && midM === 0) {
        const ops: DiffOp[] = [];
        for (let i = 0; i < n; i++) ops.push({ type: DIFF_OP_EQUAL, aIdx: i, bIdx: i });
        return ops;
    }

    const midOps =
        midN > MYERS_MAX_MID_LINES || midM > MYERS_MAX_MID_LINES
            ? histogramDiff(midA, midB, midHA, midHB)
            : myersDiff(midA, midB, midHA, midHB);

    const fullOps: DiffOp[] = [];
    for (let i = 0; i < prefix; i++) fullOps.push({ type: DIFF_OP_EQUAL, aIdx: i, bIdx: i });
    for (const op of midOps) {
        fullOps.push({
            type: op.type,
            aIdx: prefix + op.aIdx,
            bIdx: prefix + op.bIdx,
        });
    }
    for (let i = 0; i < suffix; i++) {
        fullOps.push({ type: DIFF_OP_EQUAL, aIdx: n - suffix + i, bIdx: m - suffix + i });
    }

    return fullOps;
}

function hasInvalidCoordinates(e: EditRange): boolean {
    const coords = [
        e.startLine,
        e.oldEndLine,
        e.newEndLine,
        e.startByte,
        e.oldEndByte,
        e.newEndByte,
    ];
    for (let i = 0; i < coords.length; i++) {
        if (typeof coords[i] !== TYPEOF_NUMBER || !Number.isFinite(coords[i])) {
            return true;
        }
    }
    return false;
}

function validateSingleEditRange(e: EditRange, maxByte?: number): void {
    if (!e || hasInvalidCoordinates(e)) {
        throw new Error('invalid edit range: non-numeric field');
    }
    if (e.startLine < 1) throw new Error('invalid edit range: startLine < 1');
    if (e.oldEndLine < e.startLine || e.newEndLine < e.startLine) {
        throw new Error('invalid edit range: end line before start line');
    }
    if (e.startByte < 0) throw new Error('invalid edit range: negative byte offset');
    if (e.oldEndByte < e.startByte || e.newEndByte < e.startByte) {
        throw new Error('invalid edit range: end byte before start byte');
    }
    if (
        maxByte !== undefined &&
        (e.startByte > maxByte || e.oldEndByte > maxByte || e.newEndByte > maxByte)
    ) {
        throw new Error('invalid edit range: byte offset out of bounds');
    }
}

/**
 * Validate a set of edit ranges, throwing on the first invalid range.
 *
 * @param edits - Candidate ranges validated in order.
 * @param maxByte - Optional inclusive byte bound.
 */
export function validateEditRanges(edits: EditRange[], maxByte?: number): void {
    for (const e of edits) {
        validateSingleEditRange(e, maxByte);
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
    for (const e of edits) {
        n += e.oldEndLine - e.startLine + 1 + (e.newEndLine - e.startLine + 1);
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
    const a = linesOf(oldContent, oldIndex.starts);
    const b = linesOf(newContent, newIndex.starts);
    const ops = fastDiff(a, b, oldIndex.hashes, newIndex.hashes);
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
        const a = linesOf(oldContent, oldIndex.starts);
        const b = linesOf(newContent, newIndex.starts);
        ops = fastDiff(a, b, oldIndex.hashes, newIndex.hashes);
    }
    return buildReviewHunksFromOps(oldContent, newContent, ops, oldStarts, newStarts, contextLines);
}
