/**
 * Module: Core Engine — Line-Level Diff & Edit-Range Primitives
 * File Path: src/core/editDiff.ts
 * Architecture Role: TypeScript-free pure-function foundation for incremental scanning:
 *                    line indexes/hashes, Myers and adaptive diffs, edit ranges, review hunks.
 * Dependencies & Triggers: Imported by diff routing, incremental wiring, and review packaging;
 *                    depends on histogramDiff and Praxis contracts; must load without typescript.
 * Responsibilities: Compute line starts/counts/FNV-1a hashes, run adaptive fastDiff with
 *                    prefix/suffix pruning and Myers/Histogram switching, validate edit ranges,
 *                    count changed lines, compose byte-range edits, gate incremental-worthiness,
 *                    build attributed hunks, and format unified diff output.
 * Exit Semantics & Design Rationale: Pure functions throw only from validateEditRanges on
 *                    malformed ranges; identical inputs return empty edits/hunks immediately;
 *                    Myers falls back to histogramDiff beyond 1500 lines or ~2M cells to avoid
 *                    OOM. Lines are 1-based and byte offsets are UTF-16 code units to match
 *                    LSP/runtime consumers of the incremental pipeline.
 *
 * Line-level Myers diff + edit-range computation (ts-free pure functions).
 * Part of the line-level incremental infrastructure
 * (docs/03-incremental-and-diff/01-line-level-incremental.md §3.2).
 * Produces `EditRange[]` — LSP didChange-style old/new byte spans — by diffing the
 * OLD and NEW file contents at LINE granularity, then mapping each changed line run
 * to its byte offsets. This module NEVER imports `typescript` (it sits on the
 * incremental routing path, which must stay loadable without the parser).
 */

import type { ReviewDiffHunk, AttributedDiffLine } from './praxis/contracts';
import { histogramDiff } from './histogramDiff';

export { histogramDiff };

/** UTF-16 code unit of LINE FEED (`\n`), the only character that starts a new line. */
const LINE_FEED_CODE = 10;

/** Initial line-table capacity in lines; small inputs avoid an immediate reallocation. */
const MIN_LINE_CAPACITY = 16;

/** Estimated source code units per line when sizing the initial line-table capacity. */
const SOURCE_CHARS_PER_LINE_SLOT = 32;

/** 32-bit FNV-1a multiplication prime (0x01000193). */
const FNV1A_32_PRIME = 0x01000193;

/** Largest diff span in lines still handled by Myers; larger spans fall back to histogram. */
const MYERS_MAX_MID_LINES = 1500;

/** Default equal context lines kept on each side of a change when building review hunks. */
const DEFAULT_CONTEXT_LINES = 3;

/** DiffOp tag for a matched/unchanged line pair. */
const DIFF_OP_EQUAL = 'equal';

/** DiffOp and hunk-line tag for a line removed from the old content. */
const DIFF_OP_DELETE = 'delete';

/** DiffOp and hunk-line tag for a line added in the new content. */
const DIFF_OP_INSERT = 'insert';

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

/** A single diff operation. */
export interface DiffOp {
    type: typeof DIFF_OP_EQUAL | typeof DIFF_OP_DELETE | typeof DIFF_OP_INSERT;
    /** Index into the OLD line array (for 'equal'/'delete'); insertion point for 'insert'. */
    aIdx: number;
    /** Index into the NEW line array (for 'equal'/'insert'). */
    bIdx: number;
}

/**
 * Compute the byte offset of every line start: index 0 is offset 0 and each later entry is
 * the index just after a `\n`. Works unchanged for LF, CRLF, and mixed content because `\r`
 * stays inside the preceding line.
 *
 * @param content - Source text whose line starts are indexed; only `\n` starts a new line.
 * @returns Array of UTF-16 offsets with one entry per line, index 0 always being 0.
 */
export function computeLineStarts(content: string): number[] {
    const starts: number[] = [0];
    for (let i = 0; i < content.length; i++) {
        if (content.charCodeAt(i) === LINE_FEED_CODE /* \n */) starts.push(i + 1);
    }
    return starts;
}

/**
 * Count lines as 1 + the number of `\n` characters, matching
 * `content.split(/\r\n|\n/).length` for every input, including the empty string.
 *
 * @param content - Source text to measure; `\n` is the only separator counted.
 * @returns Line count, always at least 1.
 */
export function countLines(content: string): number {
    let n = 1;
    for (let i = 0; i < content.length; i++) {
        if (content.charCodeAt(i) === LINE_FEED_CODE /* \n */) n++;
    }
    return n;
}

/**
 * Split content into lines using precomputed line starts. A trailing `\n` is removed while a
 * trailing `\r` is kept, so CRLF input round-trips byte-for-byte when joined with `\n`.
 *
 * @param content - Source text to split; it must correspond to `starts`.
 * @param starts - Line-start offsets from `computeLineStarts` or `computeLineStartsAndHashes`.
 * @returns One string per line start; entries may be empty or hold a lone `\r`.
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
 * Precomputed line table returned by `computeLineStartsAndHashes`: parallel arrays where
 * `starts[i]` is the UTF-16 offset of line `i` and `hashes[i]` is its 32-bit FNV-1a hash.
 */
export interface LineIndex {
    starts: number[];
    hashes: Uint32Array;
}

/**
 * Compute line starts and 32-bit FNV-1a line hashes in one pass over the source, avoiding the
 * intermediate line array and substring allocations of a two-step build. Buffer capacity
 * starts proportional to the input length and doubles as needed; the hash excludes each `\n`.
 *
 * @param content - Source text to index; `\n` terminates a line but is not hashed.
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
 * Hash every line in a single pass directly from `content` and its line starts, avoiding the
 * per-line substring allocations that hashing a materialized line array would incur.
 *
 * @param content - Source text whose lines are hashed.
 * @param starts - Line-start offsets from `computeLineStarts`; each range excludes its `\n`.
 * @returns Unsigned 32-bit FNV-1a hashes aligned one-to-one with `starts`.
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
 * Compute the 32-bit FNV-1a hash of a string for fast line-level equality pre-filtering.
 * Equal strings always share a hash; a collision merely forces a full string comparison.
 *
 * @param str - Text to hash exactly as stored, including any inline `\r`.
 * @returns Unsigned 32-bit hash in the range 0..4294967295.
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
 * Hash every entry of an already-split line array, preserving index alignment with `lines`.
 *
 * @param lines - Lines to hash; each entry is hashed independently.
 * @returns One unsigned 32-bit FNV-1a hash per input line, in the same order.
 */
export function hashLines(lines: string[]): Uint32Array {
    const hashes = new Uint32Array(lines.length);
    for (let i = 0; i < lines.length; i++) {
        hashes[i] = fnv1a32(lines[i]);
    }
    return hashes;
}

/**
 * Diff two line arrays after trimming their common prefix and suffix, then choose between the
 * Myers and histogram strategies. Clustered edits stay linear-time and large refactorings keep
 * semantic blocks; empty inputs produce pure insert/delete scripts without hashing.
 *
 * @param a - OLD lines; their indices populate `aIdx` in the returned operations.
 * @param b - NEW lines; their indices populate `bIdx` in the returned operations.
 * @param hA - Optional precomputed hashes for `a`; computed via `hashLines` when omitted.
 * @param hB - Optional precomputed hashes for `b`; computed via `hashLines` when omitted.
 * @returns Ordered edit script covering both arrays, using `equal` for matched line pairs.
 */
export function fastDiff(a: string[], b: string[], hA?: Uint32Array, hB?: Uint32Array): DiffOp[] {
    const n = a.length;
    const m = b.length;
    if (n === 0 && m === 0) return [];
    if (n === 0) return b.map((_, bIdx) => ({ type: DIFF_OP_INSERT, aIdx: 0, bIdx }));
    if (m === 0) return a.map((_, aIdx) => ({ type: DIFF_OP_DELETE, aIdx, bIdx: 0 }));

    const hashA = hA || hashLines(a);
    const hashB = hB || hashLines(b);

    // Fast prefix / suffix check
    let prefix = 0;
    while (prefix < n && prefix < m && hashA[prefix] === hashB[prefix] && a[prefix] === b[prefix]) {
        prefix++;
    }
    let suffix = 0;
    while (
        suffix < n - prefix &&
        suffix < m - prefix &&
        hashA[n - 1 - suffix] === hashB[m - 1 - suffix] &&
        a[n - 1 - suffix] === b[m - 1 - suffix]
    ) {
        suffix++;
    }

    const midN = n - prefix - suffix;
    const midM = m - prefix - suffix;

    if (midN === 0 && midM === 0) {
        const ops: DiffOp[] = [];
        for (let i = 0; i < n; i++) ops.push({ type: DIFF_OP_EQUAL, aIdx: i, bIdx: i });
        return ops;
    }

    // Use Myers for mid <= 1500 lines (sub-millisecond in JS); switch to Histogram for
    // large spans.
    let midOps: DiffOp[];
    if (midN > MYERS_MAX_MID_LINES || midM > MYERS_MAX_MID_LINES) {
        const sliceA = a.slice(prefix, n - suffix);
        const sliceB = b.slice(prefix, m - suffix);
        const sliceHA = hashA.subarray(prefix, n - suffix);
        const sliceHB = hashB.subarray(prefix, m - suffix);
        midOps = histogramDiff(sliceA, sliceB, sliceHA, sliceHB);
    } else {
        const sliceA = a.slice(prefix, n - suffix);
        const sliceB = b.slice(prefix, m - suffix);
        const sliceHA = hashA.subarray(prefix, n - suffix);
        const sliceHB = hashB.subarray(prefix, m - suffix);
        midOps = myersDiff(sliceA, sliceB, sliceHA, sliceHB);
    }

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

/**
 * Internal search result from Myers diagonal trace.
 */
interface MyersSearchResult {
    trace: Int32Array;
    d: number;
    rowSize: number;
    offset: number;
}

function computeMyersTrace(
    midA: string[],
    midB: string[],
    midHA: Uint32Array,
    midHB: Uint32Array,
    midN: number,
    midM: number,
    max: number,
): MyersSearchResult {
    const offset = max;
    const rowSize = 2 * max + 1;
    const v = new Int32Array(rowSize);
    const trace = new Int32Array((max + 1) * rowSize);
    let d = 0;
    let found = false;

    for (d = 0; d <= max; d++) {
        trace.set(v, d * rowSize);
        for (let k = -d; k <= d; k += 2) {
            let x: number;
            if (k === -d || (k !== d && v[k - 1 + offset] < v[k + 1 + offset])) {
                x = v[k + 1 + offset];
            } else {
                x = v[k - 1 + offset] + 1;
            }
            let y = x - k;
            while (x < midN && y < midM && midHA[x] === midHB[y] && midA[x] === midB[y]) {
                x++;
                y++;
            }
            v[k + offset] = x;
            if (x >= midN && y >= midM) {
                found = true;
                break;
            }
        }
        if (found) break;
    }
    return { trace, d, rowSize, offset };
}

function backtrackMyersTrace(
    search: MyersSearchResult,
    midN: number,
    midM: number,
    prefix: number,
): DiffOp[] {
    const { trace, d, rowSize, offset } = search;
    const midOps: DiffOp[] = [];
    let x = midN;
    let y = midM;
    for (let di = d; di >= 0; di--) {
        const rowOffset = di * rowSize;
        const k = x - y;
        const insertMove =
            k === -di ||
            (k !== di && trace[rowOffset + k - 1 + offset] < trace[rowOffset + k + 1 + offset]);
        const prevK = insertMove ? k + 1 : k - 1;
        const prevX = trace[rowOffset + prevK + offset];
        const prevY = prevX - prevK;
        while (x > prevX && y > prevY) {
            midOps.push({ type: DIFF_OP_EQUAL, aIdx: prefix + x - 1, bIdx: prefix + y - 1 });
            x--;
            y--;
        }
        if (di > 0) {
            if (insertMove) {
                midOps.push({ type: DIFF_OP_INSERT, aIdx: prefix + x, bIdx: prefix + y - 1 });
                y--;
            } else {
                midOps.push({ type: DIFF_OP_DELETE, aIdx: prefix + x - 1, bIdx: prefix + y });
                x--;
            }
        }
    }
    midOps.reverse();
    return midOps;
}

function assembleDiffOps(
    prefix: number,
    suffix: number,
    n: number,
    m: number,
    midOps: DiffOp[],
): DiffOp[] {
    const fullOps: DiffOp[] = [];
    for (let i = 0; i < prefix; i++) {
        fullOps.push({ type: DIFF_OP_EQUAL, aIdx: i, bIdx: i });
    }
    for (const op of midOps) {
        fullOps.push(op);
    }
    for (let i = 0; i < suffix; i++) {
        const aIdx = n - suffix + i;
        const bIdx = m - suffix + i;
        fullOps.push({ type: DIFF_OP_EQUAL, aIdx, bIdx });
    }
    return fullOps;
}

/**
 * Standard Myers O(ND) greedy diff algorithm with O(N) common prefix and suffix pruning.
 *
 * For disjoint line changes where M*N > MYERS_MAX_MID_LINES, it degrades gracefully to
 * `histogramDiff` to prevent O(N^2) memory consumption. When both inputs are non-empty and
 * disjoint, the middle block is solved via Myers' diagonal-search algorithm and the result
 * is spliced between the equal prefix and suffix ops.
 *
 * @param a - Array of lines from the OLD content.
 * @param b - Array of lines from the NEW content.
 * @param hA - Optional precomputed hashes for `a`; computed via `hashLines` when omitted.
 * @param hB - Optional precomputed hashes for `b`; computed via `hashLines` when omitted.
 * @returns Ordered edit script describing how `a` becomes `b`; may start or end with equal ops.
 */
export function myersDiff(a: string[], b: string[], hA?: Uint32Array, hB?: Uint32Array): DiffOp[] {
    const n = a.length;
    const m = b.length;
    if (n === 0 && m === 0) return [];
    if (n === 0) {
        return b.map((_, bIdx) => ({ type: DIFF_OP_INSERT, aIdx: 0, bIdx }));
    }
    if (m === 0) {
        return a.map((_, aIdx) => ({ type: DIFF_OP_DELETE, aIdx, bIdx: 0 }));
    }

    const hashA = hA || hashLines(a);
    const hashB = hB || hashLines(b);

    // 1. Fast-path: Common prefix trimming (O(N) single-pass)
    let prefix = 0;
    while (prefix < n && prefix < m && hashA[prefix] === hashB[prefix] && a[prefix] === b[prefix]) {
        prefix++;
    }

    // 2. Fast-path: Common suffix trimming (O(N) single-pass)
    let suffix = 0;
    while (
        suffix < n - prefix &&
        suffix < m - prefix &&
        hashA[n - 1 - suffix] === hashB[m - 1 - suffix] &&
        a[n - 1 - suffix] === b[m - 1 - suffix]
    ) {
        suffix++;
    }

    if (prefix + suffix === n && prefix + suffix === m) {
        const ops: DiffOp[] = [];
        for (let i = 0; i < n; i++) {
            ops.push({ type: DIFF_OP_EQUAL, aIdx: i, bIdx: i });
        }
        return ops;
    }

    const midA = a.slice(prefix, n - suffix);
    const midB = b.slice(prefix, m - suffix);
    const midHA = hashA.subarray(prefix, n - suffix);
    const midHB = hashB.subarray(prefix, m - suffix);
    const midN = midA.length;
    const midM = midB.length;
    const max = midN + midM;

    // Guard against OOM on large unpruned/disjoint matrices (>1500 lines or >2M cells).
    if (max > MYERS_MAX_MID_LINES || (max + 1) * (2 * max + 1) > 2_000_000) {
        return histogramDiff(a, b, hashA, hashB);
    }

    const search = computeMyersTrace(midA, midB, midHA, midHB, midN, midM, max);
    const midOps = backtrackMyersTrace(search, midN, midM, prefix);
    return assembleDiffOps(prefix, suffix, n, m, midOps);
}

function isNonFiniteNumber(val: unknown): boolean {
    return typeof val !== TYPEOF_NUMBER || !Number.isFinite(val);
}

function validateSingleEditRange(e: EditRange, maxByte?: number): void {
    if (
        !e ||
        isNonFiniteNumber(e.startLine) ||
        isNonFiniteNumber(e.oldEndLine) ||
        isNonFiniteNumber(e.newEndLine) ||
        isNonFiniteNumber(e.startByte) ||
        isNonFiniteNumber(e.oldEndByte) ||
        isNonFiniteNumber(e.newEndByte)
    ) {
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
 * Validate a set of edit ranges, throwing on the first invalid range:
 *   - missing / non-numeric / non-finite fields
 *   - startLine < 1
 *   - end line/byte before start line/byte
 *   - negative byte offset
 *   - byte offset beyond `maxByte` (when provided — callers pass the content length)
 *
 * This is the single validation entry used by the UTF-8 normalization path; edit ranges are
 * advisory, so callers convert a throw into a full-rescan fallback.
 *
 * @param edits - Candidate ranges validated in order; the first invalid one aborts the call.
 * @param maxByte - Optional inclusive byte bound, normally the content length.
 * @throws Error when a field is invalid or out of the range described above.
 */
export function validateEditRanges(edits: EditRange[], maxByte?: number): void {
    for (const e of edits) {
        validateSingleEditRange(e, maxByte);
    }
}

/**
 * Count every line touched by a set of edits by summing their deleted and inserted spans.
 * The result feeds the incremental-worthiness gate, where it is compared with a change budget.
 *
 * @param edits - Validated edit ranges from `computeEditRanges`.
 * @returns Total deleted + inserted line count; 0 for an empty edit list.
 */
export function changedLineCount(edits: EditRange[]): number {
    let n = 0;
    for (const e of edits) {
        n += e.oldEndLine - e.startLine + 1 + (e.newEndLine - e.startLine + 1);
    }
    return n;
}

/**
 * Slice one 0-based line out of `content` using precomputed line starts, without allocating
 * the full line array. Out-of-range indices yield an empty string instead of throwing.
 *
 * @param content - Source text containing the line.
 * @param starts - Line-start offsets aligned with `content`.
 * @param idx - 0-based line index; a negative or too-large value returns ''.
 * @returns Line text with its trailing `\n` removed; a trailing `\r` is preserved.
 */
export function getLine(content: string, starts: number[], idx: number): string {
    if (idx < 0 || idx >= starts.length) return '';
    const s = starts[idx];
    const e = idx + 1 < starts.length ? starts[idx + 1] - 1 : content.length;
    return content.slice(s, e);
}

/**
 * Coordinated result of one line diff: the byte-level edit ranges, the raw diff operations
 * that produced them, and the old/new line indexes they were derived from.
 */
export interface DetailedDiffResult {
    edits: EditRange[];
    ops: DiffOp[];
    oldIndex: LineIndex;
    newIndex: LineIndex;
}

/**
 * Compute byte-level edit ranges and the underlying line operations in one coordinated pass,
 * reusing the old/new line indexes and hashes. Identical contents return empty edits/ops plus
 * a shared empty index without hashing either side.
 *
 * @param oldContent - Previous file content, compared line-by-line against `newContent`.
 * @param newContent - Current file content.
 * @returns The edit ranges, diff operations, and both line indexes.
 */
export function computeEditRangesWithOps(
    oldContent: string,
    newContent: string,
): DetailedDiffResult {
    // Identical contents return immediately (~0.001ms) without computing hashes.
    if (oldContent === newContent) {
        const emptyIndex: LineIndex = { starts: [0], hashes: new Uint32Array(0) };
        return { edits: [], ops: [], oldIndex: emptyIndex, newIndex: emptyIndex };
    }

    const oldIndex = computeLineStartsAndHashes(oldContent);
    const newIndex = computeLineStartsAndHashes(newContent);
    const oldStarts = oldIndex.starts;
    const newStarts = newIndex.starts;
    const a = linesOf(oldContent, oldStarts);
    const b = linesOf(newContent, newStarts);
    const ops = fastDiff(a, b, oldIndex.hashes, newIndex.hashes);

    const edits: EditRange[] = [];
    let i = 0;
    while (i < ops.length) {
        if (ops[i].type === DIFF_OP_EQUAL) {
            i++;
            continue;
        }
        const startIdx = ops[i].aIdx;
        let delCount = 0;
        let insCount = 0;
        while (i < ops.length && ops[i].type !== DIFF_OP_EQUAL) {
            if (ops[i].type === DIFF_OP_DELETE) delCount++;
            else insCount++;
            i++;
        }
        const startByte = startIdx < oldStarts.length ? oldStarts[startIdx] : oldContent.length;
        const oldEndIdx = startIdx + delCount;
        const newEndIdx = startIdx + insCount;
        const oldEndByte = oldEndIdx < oldStarts.length ? oldStarts[oldEndIdx] : oldContent.length;
        const newEndByte = newEndIdx < newStarts.length ? newStarts[newEndIdx] : newContent.length;
        edits.push({
            startLine: startIdx + 1,
            oldEndLine: startIdx + delCount,
            newEndLine: startIdx + insCount,
            startByte,
            oldEndByte,
            newEndByte,
        });
    }
    return { edits, ops, oldIndex, newIndex };
}

/**
 * Compute byte-level edit ranges between two contents by line-diffing them. Returns an empty
 * array when the contents are identical, without materializing line indexes.
 *
 * @param oldContent - Previous file content; must be a full document, not a fragment.
 * @param newContent - Current file content.
 * @returns LSP-style edit ranges with 1-based line numbers and UTF-16 byte offsets.
 */
export function computeEditRanges(oldContent: string, newContent: string): EditRange[] {
    return computeEditRangesWithOps(oldContent, newContent).edits;
}

/**
 * Decide whether a file is worth a line-level incremental rescan: the NEW content must have at
 * least `minLines` lines and the diff must touch no more than `maxChangedLines` lines.
 *
 * @param oldContent - Previous content used to compute the change.
 * @param newContent - Current content; its line count is checked against `minLines`.
 * @param minLines - Minimum NEW line count required before incremental routing is allowed.
 * @param maxChangedLines - Maximum deleted + inserted line count accepted as a small change.
 * @returns true only when the file is large enough and the change is small enough.
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
 * Build review-level hunks with line numbers, context lines, and diff operations, compatible
 * with Git diff output and Review Cell inspection. Lazy line slicing avoids materializing the
 * full line arrays; identical inputs return no hunks.
 *
 * @param oldContent - Previous file content; supply the same text used for `precomputedOps`.
 * @param newContent - Current file content.
 * @param contextLines - Equal lines of context kept on each side of a change (default 3).
 * @param precomputedOps - Optional diff operations; a fresh diff is computed when omitted.
 * @param precomputedStartsOld - Optional line starts for `oldContent`; must match if supplied.
 * @param precomputedStartsNew - Optional line starts for `newContent`; must match if supplied.
 * @returns Hunks in ascending order, each with a Git-style header and old/new line spans.
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

    const hunks: ReviewDiffHunk[] = [];
    let i = 0;

    while (i < ops.length) {
        if (ops[i].type === DIFF_OP_EQUAL) {
            i++;
            continue;
        }

        const changeStart = i;
        const ctxStart = Math.max(0, changeStart - contextLines);

        let changeEnd = changeStart;
        while (changeEnd < ops.length) {
            if (ops[changeEnd].type !== DIFF_OP_EQUAL) {
                changeEnd++;
            } else {
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
        }

        const ctxEnd = Math.min(ops.length, changeEnd + contextLines);
        const hunkOps = ops.slice(ctxStart, ctxEnd);
        const hunkLines: AttributedDiffLine[] = [];

        let oldLine = 1;
        let newLine = 1;
        if (hunkOps.length > 0) {
            oldLine = hunkOps[0].aIdx + 1;
            newLine = hunkOps[0].bIdx + 1;
        }
        const startOld = oldLine;
        const startNew = newLine;
        let oldCount = 0;
        let newCount = 0;

        for (const op of hunkOps) {
            if (op.type === DIFF_OP_EQUAL) {
                hunkLines.push({
                    type: 'context',
                    lineNoOld: op.aIdx + 1,
                    lineNoNew: op.bIdx + 1,
                    content: getLine(oldContent, oldStarts, op.aIdx),
                });
                oldCount++;
                newCount++;
            } else if (op.type === DIFF_OP_DELETE) {
                hunkLines.push({
                    type: DIFF_OP_DELETE,
                    lineNoOld: op.aIdx + 1,
                    content: getLine(oldContent, oldStarts, op.aIdx),
                });
                oldCount++;
            } else if (op.type === DIFF_OP_INSERT) {
                hunkLines.push({
                    type: DIFF_OP_INSERT,
                    lineNoNew: op.bIdx + 1,
                    content: getLine(newContent, newStarts, op.bIdx),
                });
                newCount++;
            }
        }

        hunks.push({
            hunkId: `hunk-${hunks.length + 1}-${startOld}-${startNew}`,
            header: `@@ -${startOld},${oldCount} +${startNew},${newCount} @@`,
            oldSpan: { startLine: startOld, lineCount: oldCount },
            newSpan: { startLine: startNew, lineCount: newCount },
            lines: hunkLines,
        });

        i = ctxEnd;
    }

    return hunks;
}

/**
 * Render one `ReviewDiffHunk` as human-readable unified diff text. The header gains the AST
 * enclosing symbol when available, and changed lines can carry agent attribution badges.
 *
 * @param hunk - Hunk to render; its lines are emitted in their existing order.
 * @param options - Rendering controls; omit for plain unified diff output.
 * @param options.showAttribution - When true, append `# [agentUid]` to changed lines that
 *                                  carry attribution metadata.
 * @returns Multi-line unified diff string without a trailing newline.
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
                ? `  # [${line.attribution.agentUid || 'Agent'}]`
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
