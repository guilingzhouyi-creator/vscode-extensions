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
export function trimPrefixSuffix(
    a: string[],
    b: string[],
    hashA: Uint32Array,
    hashB: Uint32Array,
): TrimmedSpans {
    const n = a.length;
    const m = b.length;
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

    return {
        prefix,
        suffix,
        midA: a.slice(prefix, n - suffix),
        midB: b.slice(prefix, m - suffix),
        midHA: hashA.subarray(prefix, n - suffix),
        midHB: hashB.subarray(prefix, m - suffix),
    };
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

/**
 * Advance diagonal snake along equal lines.
 */
function advanceSnake(
    midA: string[],
    midB: string[],
    midHA: Uint32Array,
    midHB: Uint32Array,
    startX: number,
    startY: number,
    midN: number,
    midM: number,
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
 * Compute the next X position on diagonal k.
 */
function getNextDiagonalX(v: Int32Array, k: number, d: number, offset: number): number {
    if (k === -d || (k !== d && v[k - 1 + offset] < v[k + 1 + offset])) {
        return v[k + 1 + offset];
    }
    return v[k - 1 + offset] + 1;
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
 * Search one diagonal row d in the Myers forward trace.
 */
function searchDiagonalRow(v: Int32Array, d: number, offset: number, ctx: MyersContext): boolean {
    const { midA, midB, midHA, midHB, midN, midM } = ctx;
    for (let k = -d; k <= d; k += 2) {
        const initialX = getNextDiagonalX(v, k, d, offset);
        const x = advanceSnake(midA, midB, midHA, midHB, initialX, initialX - k, midN, midM);
        v[k + offset] = x;
        if (x >= midN && x - k >= midM) {
            return true;
        }
    }
    return false;
}

/**
 * Execute forward diagonal trace for Myers greedy search.
 */
function computeMyersTrace(ctx: MyersContext, max: number): MyersSearchResult {
    const offset = max;
    const rowSize = 2 * max + 1;
    const v = new Int32Array(rowSize);
    const trace = new Int32Array((max + 1) * rowSize);
    let d = 0;

    for (d = 0; d <= max; d++) {
        trace.set(v, d * rowSize);
        if (searchDiagonalRow(v, d, offset, ctx)) {
            break;
        }
    }
    return { trace, d, rowSize, offset };
}

/**
 * Push equal ops while backtracking along common diagonal.
 */
function collectEqualOps(
    midOps: DiffOp[],
    prefix: number,
    startX: number,
    startY: number,
    prevX: number,
    prevY: number,
): { x: number; y: number } {
    let x = startX;
    let y = startY;
    while (x > prevX && y > prevY) {
        midOps.push({ type: DIFF_OP_EQUAL, aIdx: prefix + x - 1, bIdx: prefix + y - 1 });
        x--;
        y--;
    }
    return { x, y };
}

/**
 * Backtrack trace to reconstruct the optimal edit script for the middle block.
 */
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

        const pos = collectEqualOps(midOps, prefix, x, y, prevX, prevY);
        x = pos.x;
        y = pos.y;

        if (di <= 0) continue;
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
 * Standard Myers O(ND) greedy diff algorithm with O(N) common prefix and suffix pruning.
 *
 * @param a - Array of lines from the OLD content.
 * @param b - Array of lines from the NEW content.
 * @param hashA - Optional precomputed hashes for a.
 * @param hashB - Optional precomputed hashes for b.
 * @returns Ordered edit script describing how a becomes b.
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

    if (prefix + suffix === n && prefix + suffix === m) {
        return Array.from({ length: n }, (_, i) => ({ type: DIFF_OP_EQUAL, aIdx: i, bIdx: i }));
    }

    const midN = midA.length;
    const midM = midB.length;
    const max = midN + midM;

    // Guard against OOM on large unpruned/disjoint matrices (>1500 lines or >2M cells).
    if (max > MYERS_MAX_MID_LINES || (max + 1) * (2 * max + 1) > 2_000_000) {
        return histogramDiff(a, b, effectiveHashA, effectiveHashB);
    }

    const search = computeMyersTrace({ midA, midB, midHA, midHB, midN, midM }, max);
    const midOps = backtrackMyersTrace(search, midN, midM, prefix);
    return assembleDiffOps(prefix, suffix, n, m, midOps);
}
