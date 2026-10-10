/**
 * Module: Core Engine — Myers Line-Level Diff Algorithm
 * File Path: src/core/diff/myers-algorithm.ts
 * Architecture Role: Pure computational kernel for Myers diagonal search and backtrack trace.
 * Dependencies & Triggers: Consumed by fastDiff in edit-diff.ts; falls back to histogram-diff.
 * Responsibilities: Compute optimal line edit scripts using O(ND) greedy diagonal search.
 * Exit Semantics & Design Rationale: Minimal edit script generator falling back to
 *   histogram for large midspans.
 * Concurrency: Thread-safe, stateless pure functions with typed buffer allocations.
 */

import { histogramDiff } from './histogram-diff';

/** Largest diff span in lines still handled by Myers; larger spans fall back to histogram. */
export const MYERS_MAX_MID_LINES = 1500;

/** DiffOp tag for a matched/unchanged line pair. */
export const DIFF_OP_EQUAL = 'equal';

/** DiffOp and hunk-line tag for a line removed from the old content. */
export const DIFF_OP_DELETE = 'delete';

/** DiffOp and hunk-line tag for a line added in the new content. */
export const DIFF_OP_INSERT = 'insert';

/** DiffOp tag for a compressed run of equal lines (eliminates transient heap allocation). */
export const DIFF_OP_EQUAL_SPAN = 'equal_span';

/** A single diff operation or compressed equal span. */
export interface DiffOp {
    type:
        | typeof DIFF_OP_EQUAL
        | typeof DIFF_OP_DELETE
        | typeof DIFF_OP_INSERT
        | typeof DIFF_OP_EQUAL_SPAN;
    /**
     * Index into OLD line array (for 'equal'/'delete'); insertion point for 'insert';
     * start index for 'equal_span'.
     */
    aIdx: number;
    /** Index into the NEW line array (for 'equal'/'insert'); start index for 'equal_span'. */
    bIdx: number;
    /** Optional span length for 'equal_span'. When omitted, length defaults to 1. */
    length?: number;
}

/**
 * Result of trimming common prefix and suffix from two line arrays.
 */
export interface TrimmedSpans {
    prefix: number;
    suffix: number;
    midA: string[];
    midB: string[];
    midHA: Uint32Array;
    midHB: Uint32Array;
}

/**
 * Computes length of identical common prefix between two hashed line arrays.
 *
 * @param a - Old lines.
 * @param b - New lines.
 * @param hashA - Hashes of old lines.
 * @param hashB - Hashes of new lines.
 * @returns Matching prefix length in lines.
 */
function computeCommonPrefixLength(
    a: string[],
    b: string[],
    hashA: Uint32Array,
    hashB: Uint32Array,
): number {
    const minLen = Math.min(a.length, b.length);
    let prefix = 0;
    while (prefix < minLen) {
        if (hashA[prefix] !== hashB[prefix] || a[prefix] !== b[prefix]) {
            break;
        }
        prefix++;
    }
    return prefix;
}

function computeCommonSuffixLength(
    a: string[],
    b: string[],
    hashA: Uint32Array,
    hashB: Uint32Array,
    prefix: number,
): number {
    const maxSuffix = Math.min(a.length - prefix, b.length - prefix);
    let suffix = 0;
    const n = a.length;
    const m = b.length;
    while (suffix < maxSuffix) {
        const idxA = n - 1 - suffix;
        const idxB = m - 1 - suffix;
        if (hashA[idxA] !== hashB[idxB] || a[idxA] !== b[idxB]) {
            break;
        }
        suffix++;
    }
    return suffix;
}

function sliceStringMiddle(
    arr: string[],
    prefix: number,
    suffix: number,
    midLen: number,
): string[] {
    if (prefix === 0 && suffix === 0) return arr;
    if (midLen === 0) return [];
    return arr.slice(prefix, arr.length - suffix);
}

function sliceUint32Middle(
    arr: Uint32Array,
    prefix: number,
    suffix: number,
    midLen: number,
): Uint32Array {
    if (prefix === 0 && suffix === 0) return arr;
    if (midLen === 0) return new Uint32Array(0);
    return arr.subarray(prefix, arr.length - suffix);
}

/**
 * Trim common prefix and suffix between two line arrays using fast uint32 hashes.
 *
 * @param a - Old lines.
 * @param b - New lines.
 * @param hashA - Hashes of old lines.
 * @param hashB - Hashes of new lines.
 * @returns Trimmed spans and middle slices.
 */
export function trimPrefixSuffix(
    a: string[],
    b: string[],
    hashA: Uint32Array,
    hashB: Uint32Array,
): TrimmedSpans {
    const prefix = computeCommonPrefixLength(a, b, hashA, hashB);
    const suffix = computeCommonSuffixLength(a, b, hashA, hashB, prefix);
    const midN = a.length - prefix - suffix;
    const midM = b.length - prefix - suffix;

    return {
        prefix,
        suffix,
        midA: sliceStringMiddle(a, prefix, suffix, midN),
        midB: sliceStringMiddle(b, prefix, suffix, midM),
        midHA: sliceUint32Middle(hashA, prefix, suffix, midN),
        midHB: sliceUint32Middle(hashB, prefix, suffix, midM),
    };
}

/**
 * Internal search result from Myers diagonal trace.
 */
interface MyersSearchResult {
    flatTrace: Int32Array;
    d: number;
}

/**
 * Sliced arrays and metrics for the Myers mid-section search.
 */
interface MyersContext {
    midA: string[];
    midB: string[];
    midHA: Uint32Array;
    midHB: Uint32Array;
    midN: number;
    midM: number;
}

/**
 * Advance diagonal snake along matched lines.
 */
function advanceSnake(
    midA: string[],
    midB: string[],
    midHA: Uint32Array,
    midHB: Uint32Array,
    midN: number,
    midM: number,
    startX: number,
    startY: number,
): number {
    let x = startX;
    let y = startY;
    while (x < midN && y < midM && midHA[x] === midHB[y] && midA[x] === midB[y]) {
        x++;
        y++;
    }
    return x;
}

/**
 * Module-level reusable scratch buffer pool for Myers greedy trace.
 * Eliminates transient typed array allocations in hot search loops (CPX-SPACE-001).
 */
export class MyersScratchPool {
    private vBuffer: Int32Array = new Int32Array(4096);
    private traceBuffer: Int32Array = new Int32Array(65536);

    /**
     * Acquire or expand the working diagonal vector v with size rowSize (2 * max + 1).
     * Automatically zeroes out the active region [0, minCapacity).
     */
    acquireV(minCapacity: number): Int32Array {
        if (this.vBuffer.length < minCapacity) {
            const nextCap = Math.max(minCapacity, this.vBuffer.length * 2);
            this.vBuffer = new Int32Array(nextCap);
        }
        this.vBuffer.fill(0, 0, minCapacity);
        return this.vBuffer;
    }

    /**
     * Acquire or expand the contiguous flatTrace buffer with capacity (max + 1)^2.
     */
    acquireTrace(minCapacity: number): Int32Array {
        if (this.traceBuffer.length < minCapacity) {
            const nextCap = Math.max(minCapacity, this.traceBuffer.length * 2);
            this.traceBuffer = new Int32Array(nextCap);
        }
        return this.traceBuffer;
    }

    /**
     * Reset the pool buffers to default sizes.
     */
    reset(): void {
        this.vBuffer = new Int32Array(4096);
        this.traceBuffer = new Int32Array(65536);
    }
}

export const myersScratchPool = new MyersScratchPool();

/**
 * Execute forward diagonal trace for Myers greedy search with inlined diagonal
 * snake advancement. Employs MyersScratchPool to eliminate loop-body allocations (CPX-SPACE-001).
 */
function computeMyersTrace(ctx: MyersContext, max: number): MyersSearchResult {
    const { midA, midB, midHA, midHB, midN, midM } = ctx;
    const offset = max;
    const rowSize = 2 * max + 1;
    const requiredTraceCapacity = (max + 1) * (max + 1);

    const v = myersScratchPool.acquireV(rowSize);
    const flatTrace = myersScratchPool.acquireTrace(requiredTraceCapacity);
    let d = 0;

    for (d = 0; d <= max; d++) {
        const base = d * d + d;
        for (let k = -d; k <= d; k++) {
            flatTrace[base + k] = v[offset + k];
        }

        let reached = false;
        for (let k = -d; k <= d; k += 2) {
            const initialX =
                k === -d || (k !== d && v[k - 1 + offset] < v[k + 1 + offset])
                    ? v[k + 1 + offset]
                    : v[k - 1 + offset] + 1;
            const x = advanceSnake(midA, midB, midHA, midHB, midN, midM, initialX, initialX - k);
            const y = x - k;
            v[k + offset] = x;
            if (x >= midN && y >= midM) {
                reached = true;
                break;
            }
        }
        if (reached) {
            break;
        }
    }
    return { flatTrace, d };
}

/**
 * Backtrack trace to reconstruct the optimal edit script for the middle block.
 * Eliminates transient object allocations by inlining diagonal snake reversal.
 */
function backtrackMyersTrace(
    search: MyersSearchResult,
    midN: number,
    midM: number,
    prefix: number,
): DiffOp[] {
    const { flatTrace, d } = search;
    const midOps: DiffOp[] = [];
    let x = midN;
    let y = midM;

    for (let di = d; di >= 0; di--) {
        if (di === 0) {
            while (x > 0 && y > 0) {
                midOps.push({ type: DIFF_OP_EQUAL, aIdx: prefix + x - 1, bIdx: prefix + y - 1 });
                x--;
                y--;
            }
            break;
        }

        const base = di * di + di;
        const k = x - y;
        const insertMove =
            k === -di || (k !== di && flatTrace[base + k - 1] < flatTrace[base + k + 1]);
        const prevK = insertMove ? k + 1 : k - 1;
        const prevX = flatTrace[base + prevK];
        const prevY = prevX - prevK;

        while (x > prevX && y > prevY) {
            midOps.push({ type: DIFF_OP_EQUAL, aIdx: prefix + x - 1, bIdx: prefix + y - 1 });
            x--;
            y--;
        }

        if (insertMove) {
            midOps.push({ type: DIFF_OP_INSERT, aIdx: prefix + x, bIdx: prefix + y - 1 });
            y--;
        } else {
            midOps.push({ type: DIFF_OP_DELETE, aIdx: prefix + x - 1, bIdx: prefix + y });
            x--;
        }
    }
    midOps.reverse();
    return midOps;
}

/**
 * Assemble prefix, middle operations, and suffix into unified edit script.
 *
 * @param prefix - Length of matching common prefix lines.
 * @param suffix - Length of matching common suffix lines.
 * @param n - Total lines in old content.
 * @param m - Total lines in new content.
 * @param midOps - Diff operations for the middle modified section.
 * @returns Complete list of diff operations for the full file.
 */
const COMPACT_DIFF_ENABLED = process.env.AR_COMPACT_DIFF !== '0';
const CONTEXT_MARGIN = 3;

/**
 * Emits a contiguous run of equal diff operations.
 *
 * @param target - Destination diff operation accumulator array.
 * @param startA - Starting line index in source A.
 * @param startB - Starting line index in source B.
 * @param count - Number of consecutive equal lines to append.
 */
export function emitEqualRun(
    target: DiffOp[],
    startA: number,
    startB: number,
    count: number,
): void {
    for (let i = 0; i < count; i++) {
        target.push({ type: DIFF_OP_EQUAL, aIdx: startA + i, bIdx: startB + i });
    }
}

/**
 * Emits prefix diff operations with optional span compaction.
 */
function emitPrefixOps(target: DiffOp[], prefix: number): void {
    const compactThreshold = CONTEXT_MARGIN * 2;
    if (COMPACT_DIFF_ENABLED && prefix > compactThreshold) {
        const spanLen = prefix - CONTEXT_MARGIN;
        target.push({ type: DIFF_OP_EQUAL_SPAN, aIdx: 0, bIdx: 0, length: spanLen });
        emitEqualRun(target, spanLen, spanLen, CONTEXT_MARGIN);
        return;
    }
    emitEqualRun(target, 0, 0, prefix);
}

/**
 * Emits suffix diff operations with optional span compaction.
 */
function emitSuffixOps(target: DiffOp[], suffix: number, n: number, m: number): void {
    const compactThreshold = CONTEXT_MARGIN * 2;
    const baseA = n - suffix;
    const baseB = m - suffix;
    if (COMPACT_DIFF_ENABLED && suffix > compactThreshold) {
        emitEqualRun(target, baseA, baseB, CONTEXT_MARGIN);
        const spanLen = suffix - CONTEXT_MARGIN;
        target.push({
            type: DIFF_OP_EQUAL_SPAN,
            aIdx: n - spanLen,
            bIdx: m - spanLen,
            length: spanLen,
        });
        return;
    }
    emitEqualRun(target, baseA, baseB, suffix);
}

/**
 * Assemble prefix, middle operations, and suffix into unified edit script.
 *
 * @param prefix - Length of matching common prefix lines.
 * @param suffix - Length of matching common suffix lines.
 * @param n - Total lines in old content.
 * @param m - Total lines in new content.
 * @param midOps - Diff operations for the middle modified section.
 * @returns Complete list of diff operations for the full file.
 */
export function assembleDiffOps(
    prefix: number,
    suffix: number,
    n: number,
    m: number,
    midOps: DiffOp[],
): DiffOp[] {
    const ops: DiffOp[] = [];
    emitPrefixOps(ops, prefix);
    for (let i = 0; i < midOps.length; i++) {
        ops.push(midOps[i]);
    }
    emitSuffixOps(ops, suffix, n, m);
    return ops;
}

const FNV1A_32_PRIME = 0x01000193;
const FNV1A_32_OFFSET_BASIS = 0x811c9dc5;

function fnv1a(str: string): number {
    let hash = FNV1A_32_OFFSET_BASIS;
    for (let i = 0; i < str.length; i++) {
        hash = Math.imul(hash ^ str.charCodeAt(i), FNV1A_32_PRIME) >>> 0;
    }
    return hash;
}

function computeLineHashes(lines: string[]): Uint32Array {
    const hashes = new Uint32Array(lines.length);
    for (let i = 0; i < lines.length; i++) {
        hashes[i] = fnv1a(lines[i]);
    }
    return hashes;
}

/**
 * Return trivial diff ops when one or both input line arrays are empty.
 */
function checkTrivialDiff(a: string[], b: string[]): DiffOp[] | null {
    if (a.length === 0 && b.length === 0) return [];
    if (a.length === 0) {
        return b.map((_, bIdx) => ({ type: DIFF_OP_INSERT, aIdx: 0, bIdx }));
    }
    if (b.length === 0) {
        return a.map((_, aIdx) => ({ type: DIFF_OP_DELETE, aIdx, bIdx: 0 }));
    }
    return null;
}

/**
 * Computes an optimal line-level edit script using the standard Myers O(ND) greedy
 * diff algorithm combined with O(N) common prefix and suffix pruning.
 *
 * Preconditions:
 *   - When precomputed line hash buffers (`hashA`, `hashB`) are provided, they MUST
 *     be strictly equal in length to their corresponding line arrays
 *     (`hashA.length === a.length` and `hashB.length === b.length`).
 *     Providing mismatched hash buffers violates buffer alignment and causes
 *     out-of-bounds indexing or erroneous line identity matches during prefix/suffix
 *     stripping and snake advancement.
 *
 * Degradation & Fallback Strategy:
 *   - Myers diagonal search allocates an internal trace buffer proportional to
 *     `(max + 1) * (2 * max + 1)`, which exhibits quadratic worst-case memory
 *     consumption on large or disjoint differences.
 *   - If the trimmed middle section exceeds `MYERS_MAX_MID_LINES` (1500 lines total
 *     across middle spans: `max = midN + midM > 1500`) or if the diagonal trace matrix
 *     exceeds 2,000,000 cells (`(max + 1) * (2 * max + 1) > 2_000_000`), the
 *     algorithm automatically degrades and falls back to `histogramDiff`
 *     to prevent out-of-memory (OOM) failures and latency spikes on disjoint content.
 *
 * @param a - Array of lines from the original/old content.
 * @param b - Array of lines from the modified/new content.
 * @param hashA - Optional precomputed 32-bit FNV-1a hashes for lines in `a`.
 *   Precondition: must equal `a.length`.
 * @param hashB - Optional precomputed 32-bit FNV-1a hashes for lines in `b`.
 *   Precondition: must equal `b.length`.
 * @returns Ordered edit script (`DiffOp[]`) describing minimal edits to transform `a` into `b`.
 */
export function myersDiff(
    a: string[],
    b: string[],
    hashA?: Uint32Array,
    hashB?: Uint32Array,
): DiffOp[] {
    const trivial = checkTrivialDiff(a, b);
    if (trivial !== null) return trivial;

    const n = a.length;
    const m = b.length;
    const effectiveHashA = hashA ?? computeLineHashes(a);
    const effectiveHashB = hashB ?? computeLineHashes(b);
    const trimmed = trimPrefixSuffix(a, b, effectiveHashA, effectiveHashB);
    const { prefix, suffix, midA, midB, midHA, midHB } = trimmed;

    return myersDiffCore(prefix, suffix, n, m, midA, midB, midHA, midHB);
}

/**
 * Core engine for Myers line diff operating on pre-trimmed middle slices.
 * Directly reuses precomputed hashes and prefixes without duplicate scanning,
 * and maintains pruning benefits if degrading to histogram diff.
 *
 * Algorithm Invariants & Degradation Bounds:
 *   - Invariant: `prefix` and `suffix` must strictly bound valid indices in `midHA` / `midHB`.
 *   - Degradation Threshold: When middle section length `max = midN + midM > MYERS_MAX_MID_LINES`
 *     (1,500 lines) or trace matrix size `(max + 1) * (2 * max + 1) > 2,000,000`, execution
 *     automatically degrades and falls back to `histogramDiff` to guarantee O(ND) bounds and
 *     eliminate OOM risks.
 *
 * @param prefix - Length of identical common prefix.
 * @param suffix - Length of identical common suffix.
 * @param n - Original length of line array a.
 * @param m - Original length of line array b.
 * @param midA - Middle slice of line array a without prefix and suffix.
 * @param midB - Middle slice of line array b without prefix and suffix.
 * @param midHA - Hashes corresponding to midA lines.
 * @param midHB - Hashes corresponding to midB lines.
 * @returns Complete sequence of DiffOp operations reconstructing b from a.
 */
export function myersDiffCore(
    prefix: number,
    suffix: number,
    n: number,
    m: number,
    midA: string[],
    midB: string[],
    midHA: Uint32Array,
    midHB: Uint32Array,
): DiffOp[] {
    if (prefix + suffix === n && prefix + suffix === m) {
        const fullOps: DiffOp[] = new Array(n);
        for (let i = 0; i < n; i++) {
            fullOps[i] = { type: DIFF_OP_EQUAL, aIdx: i, bIdx: i };
        }
        return fullOps;
    }

    const midN = midA.length;
    const midM = midB.length;
    const max = midN + midM;

    // Guard against excessive iterations on large unpruned matrices (>1500 lines or >2M cells).
    // Degradation cleanly preserves trimmed prefix/suffix slices.
    if (max > MYERS_MAX_MID_LINES || (max + 1) * (2 * max + 1) > 2_000_000) {
        const midOps = histogramDiff(midA, midB, midHA, midHB);
        return assembleDiffOps(prefix, suffix, n, m, midOps);
    }

    const search = computeMyersTrace({ midA, midB, midHA, midHB, midN, midM }, max);
    const midOps = backtrackMyersTrace(search, midN, midM, prefix);
    return assembleDiffOps(prefix, suffix, n, m, midOps);
}
