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

/** A single diff operation. */
export interface DiffOp {
    type: typeof DIFF_OP_EQUAL | typeof DIFF_OP_DELETE | typeof DIFF_OP_INSERT;
    /** Index into the OLD line array (for 'equal'/'delete'); insertion point for 'insert'. */
    aIdx: number;
    /** Index into the NEW line array (for 'equal'/'insert'). */
    bIdx: number;
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
 * Trim common prefix and suffix from two hashed line arrays.
 *
 * @param a - Old lines.
 * @param b - New lines.
 * @param hashA - Hashes of old lines.
 * @param hashB - Hashes of new lines.
 * @returns Trimmed spans and middle slices.
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
    trace: Int32Array[];
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
 * Execute forward diagonal trace for Myers greedy search with inlined diagonal snake advancement.
 * Allocates dynamic row slices per iteration to scale memory with O(D^2) instead of O(max^2).
 */
function computeMyersTrace(ctx: MyersContext, max: number): MyersSearchResult {
    const { midA, midB, midHA, midHB, midN, midM } = ctx;
    const offset = max;
    const rowSize = 2 * max + 1;
    const v = new Int32Array(rowSize);
    const trace: Int32Array[] = [];
    let d = 0;

    for (d = 0; d <= max; d++) {
        trace.push(v.slice(offset - d, offset + d + 1));
        let reached = false;
        for (let k = -d; k <= d; k += 2) {
            const initialX =
                k === -d || (k !== d && v[k - 1 + offset] < v[k + 1 + offset])
                    ? v[k + 1 + offset]
                    : v[k - 1 + offset] + 1;
            let x = initialX;
            let y = x - k;
            while (x < midN && y < midM && midHA[x] === midHB[y] && midA[x] === midB[y]) {
                x++;
                y++;
            }
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
    return { trace, d };
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
    const { trace, d } = search;
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

        const row = trace[di];
        const k = x - y;
        const insertMove = k === -di || (k !== di && row[k - 1 + di] < row[k + 1 + di]);
        const prevK = insertMove ? k + 1 : k - 1;
        const prevX = row[prevK + di];
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
export function assembleDiffOps(
    prefix: number,
    suffix: number,
    n: number,
    m: number,
    midOps: DiffOp[],
): DiffOp[] {
    const total = prefix + midOps.length + suffix;
    const fullOps: DiffOp[] = new Array(total);
    let idx = 0;
    for (let i = 0; i < prefix; i++) {
        fullOps[idx++] = { type: DIFF_OP_EQUAL, aIdx: i, bIdx: i };
    }
    for (let i = 0; i < midOps.length; i++) {
        fullOps[idx++] = midOps[i];
    }
    for (let i = 0; i < suffix; i++) {
        fullOps[idx++] = { type: DIFF_OP_EQUAL, aIdx: n - suffix + i, bIdx: m - suffix + i };
    }
    return fullOps;
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

    // Guard against excessive iterations on large unpruned/disjoint matrices (>1500 lines or >2M cells).
    // Degradation cleanly preserves trimmed prefix/suffix slices.
    if (max > MYERS_MAX_MID_LINES || (max + 1) * (2 * max + 1) > 2_000_000) {
        const midOps = histogramDiff(midA, midB, midHA, midHB);
        return assembleDiffOps(prefix, suffix, n, m, midOps);
    }

    const search = computeMyersTrace({ midA, midB, midHA, midHB, midN, midM }, max);
    const midOps = backtrackMyersTrace(search, midN, midM, prefix);
    return assembleDiffOps(prefix, suffix, n, m, midOps);
}
