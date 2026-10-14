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

/** Maximum cells allowed in the Myers diagonal trace matrix before degrading. */
export const MYERS_MAX_TRACE_CELLS = 2_000_000;

/** Default capacity for Myers diagonal working vector vBuffer. */
export const DEFAULT_V_CAPACITY = 4096;

/** Default capacity for Myers trace buffer. */
export const DEFAULT_TRACE_CAPACITY = 65536;

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
 * Context container for common prefix/suffix comparisons across line spans.
 */
interface CommonLineSpan {
    readonly oldLines: string[];
    readonly newLines: string[];
    readonly oldHashes: Uint32Array;
    readonly newHashes: Uint32Array;
}

/**
 * Computes length of identical common prefix between two hashed line arrays.
 *
 * @param oldLines - Old lines.
 * @param newLines - New lines.
 * @param oldHashes - Hashes of old lines.
 * @param newHashes - Hashes of new lines.
 * @returns Matching prefix length in lines.
 */
function computeCommonPrefixLength(
    oldLines: string[],
    newLines: string[],
    oldHashes: Uint32Array,
    newHashes: Uint32Array,
): number {
    const minLen = Math.min(oldLines.length, newLines.length);
    let prefixIndex = 0;
    while (prefixIndex < minLen) {
        if (oldHashes[prefixIndex] !== newHashes[prefixIndex] || oldLines[prefixIndex] !== newLines[prefixIndex]) {
            break;
        }
        prefixIndex++;
    }
    return prefixIndex;
}

function computeCommonSuffixLength(
    span: CommonLineSpan,
    prefixLength: number,
): number {
    const { oldLines, newLines, oldHashes, newHashes } = span;
    const maxSuffix = Math.min(oldLines.length - prefixLength, newLines.length - prefixLength);
    let suffixIndex = 0;
    const oldLineCount = oldLines.length;
    const newLineCount = newLines.length;
    while (suffixIndex < maxSuffix) {
        const idxA = oldLineCount - 1 - suffixIndex;
        const idxB = newLineCount - 1 - suffixIndex;
        if (oldHashes[idxA] !== newHashes[idxB] || oldLines[idxA] !== newLines[idxB]) {
            break;
        }
        suffixIndex++;
    }
    return suffixIndex;
}

function extractStringMiddle(
    lines: string[],
    prefixLength: number,
    suffixLength: number,
    midLength: number,
): string[] {
    if (prefixLength === 0 && suffixLength === 0) return lines;
    return midLength === 0 ? [] : lines.slice(prefixLength, lines.length - suffixLength);
}

function extractUint32Middle(
    hashes: Uint32Array,
    prefixLength: number,
    suffixLength: number,
    midLength: number,
): Uint32Array {
    if (prefixLength === 0 && suffixLength === 0) return hashes;
    return midLength === 0 ? new Uint32Array(0) : hashes.subarray(prefixLength, hashes.length - suffixLength);
}

/**
 * Trim common prefix and suffix between two line arrays using fast uint32 hashes.
 *
 * @param oldLines - Old lines.
 * @param newLines - New lines.
 * @param oldHashes - Hashes of old lines.
 * @param newHashes - Hashes of new lines.
 * @returns Trimmed spans and middle slices.
 */
export function trimPrefixSuffix(
    oldLines: string[],
    newLines: string[],
    oldHashes: Uint32Array,
    newHashes: Uint32Array,
): TrimmedSpans {
    const prefix = computeCommonPrefixLength(oldLines, newLines, oldHashes, newHashes);
    const suffix = computeCommonSuffixLength(
        { oldLines, newLines, oldHashes, newHashes },
        prefix,
    );
    const midN = oldLines.length - prefix - suffix;
    const midM = newLines.length - prefix - suffix;

    return {
        prefix,
        suffix,
        midA: extractStringMiddle(oldLines, prefix, suffix, midN),
        midB: extractStringMiddle(newLines, prefix, suffix, midM),
        midHA: extractUint32Middle(oldHashes, prefix, suffix, midN),
        midHB: extractUint32Middle(newHashes, prefix, suffix, midM),
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
    ctx: MyersContext,
    startX: number,
    startY: number,
): number {
    const { midA, midB, midHA, midHB, midN, midM } = ctx;
    let currX = startX;
    let currY = startY;
    while (currX < midN && currY < midM && midHA[currX] === midHB[currY] && midA[currX] === midB[currY]) {
        currX++;
        currY++;
    }
    return currX;
}

/**
 * Module-level reusable scratch buffer pool for Myers greedy trace.
 * Eliminates transient typed array allocations in hot search loops (CPX-SPACE-001).
 */
export class MyersScratchPool {
    private diagonalVectorBuffer: Int32Array = new Int32Array(DEFAULT_V_CAPACITY);
    private searchTraceBuffer: Int32Array = new Int32Array(DEFAULT_TRACE_CAPACITY);

    getOrExpandDiagonalVector(minCapacity: number): Int32Array {
        if (this.diagonalVectorBuffer.length < minCapacity) {
            const nextCap = Math.max(minCapacity, this.diagonalVectorBuffer.length * 2);
            this.diagonalVectorBuffer = new Int32Array(nextCap);
        }
        this.diagonalVectorBuffer.fill(0, 0, minCapacity);
        return this.diagonalVectorBuffer;
    }

    getOrExpandTraceBuffer(minCapacity: number): Int32Array {
        if (this.searchTraceBuffer.length < minCapacity) {
            const nextCap = Math.max(minCapacity, this.searchTraceBuffer.length * 2);
            this.searchTraceBuffer = new Int32Array(nextCap);
        }
        return this.searchTraceBuffer;
    }

    resetPoolBuffers(): void {
        this.diagonalVectorBuffer = new Int32Array(DEFAULT_V_CAPACITY);
        this.searchTraceBuffer = new Int32Array(DEFAULT_TRACE_CAPACITY);
    }
}

/**
 * Shared pre-allocated scratch pool for Myers difference computation buffers.
 */
export const myersScratchPool = new MyersScratchPool();

/**
 * Execute forward diagonal trace for Myers greedy search with inlined diagonal
 * snake advancement. Employs MyersScratchPool to eliminate loop-body allocations (CPX-SPACE-001).
 */
function computeMyersTrace(ctx: MyersContext, maxDistance: number): MyersSearchResult {
    const { midN, midM } = ctx;
    const offset = maxDistance;
    const rowSize = 2 * maxDistance + 1;
    const requiredTraceCapacity = (maxDistance + 1) * (maxDistance + 1);

    const diagonalVector = myersScratchPool.getOrExpandDiagonalVector(rowSize);
    const flatTrace = myersScratchPool.getOrExpandTraceBuffer(requiredTraceCapacity);
    let diffDepth = 0;

    for (diffDepth = 0; diffDepth <= maxDistance; diffDepth++) {
        const base = diffDepth * diffDepth + diffDepth;
        for (let diagonalK = -diffDepth; diagonalK <= diffDepth; diagonalK++) {
            flatTrace[base + diagonalK] = diagonalVector[offset + diagonalK];
        }

        let reached = false;
        for (let diagonalK = -diffDepth; diagonalK <= diffDepth; diagonalK += 2) {
            const initialX =
                diagonalK === -diffDepth ||
                (diagonalK !== diffDepth &&
                    diagonalVector[diagonalK - 1 + offset] < diagonalVector[diagonalK + 1 + offset])
                    ? diagonalVector[diagonalK + 1 + offset]
                    : diagonalVector[diagonalK - 1 + offset] + 1;
            const xCoord = advanceSnake(ctx, initialX, initialX - diagonalK);
            const yCoord = xCoord - diagonalK;
            diagonalVector[diagonalK + offset] = xCoord;
            if (xCoord >= midN && yCoord >= midM) {
                reached = true;
                break;
            }
        }
        if (reached) {
            break;
        }
    }
    return { flatTrace, d: diffDepth };
}

/**
 * Internal 2D coordinate position for trace backtracking.
 */
interface RewindSnakePosition {
    readonly currX: number;
    readonly currY: number;
}

/**
 * Helper to rewind diagonal snake along matched lines during trace reconstruction,
 * eliminating duplicated while loop blocks (HYG-CLN-001).
 */
function computeRewoundEqualSnake(
    midOps: DiffOp[],
    prefixLength: number,
    startPos: RewindSnakePosition,
    targetPos: RewindSnakePosition,
): RewindSnakePosition {
    let currX = startPos.currX;
    let currY = startPos.currY;
    while (currX > targetPos.currX && currY > targetPos.currY) {
        midOps.push({
            type: DIFF_OP_EQUAL,
            aIdx: prefixLength + currX - 1,
            bIdx: prefixLength + currY - 1,
        });
        currX--;
        currY--;
    }
    return { currX, currY };
}

/**
 * Backtrack trace to reconstruct the optimal edit script for the middle block.
 * Eliminates transient object allocations by inlining diagonal snake reversal.
 */
function computeReconstructedMyersTrace(
    search: MyersSearchResult,
    midN: number,
    midM: number,
    prefixLength: number,
): DiffOp[] {
    const { flatTrace, d: diffDepth } = search;
    const midOps: DiffOp[] = [];
    let currX = midN;
    let currY = midM;

    for (let depthIndex = diffDepth; depthIndex >= 0; depthIndex--) {
        if (depthIndex === 0) {
            const zeroTarget = { currX: 0, currY: 0 };
            const finalPos = computeRewoundEqualSnake(midOps, prefixLength, { currX, currY }, zeroTarget);
            currX = finalPos.currX;
            currY = finalPos.currY;
            break;
        }

        const base = depthIndex * depthIndex + depthIndex;
        const diagonalK = currX - currY;
        const insertMove =
            diagonalK === -depthIndex ||
            (diagonalK !== depthIndex && flatTrace[base + diagonalK - 1] < flatTrace[base + diagonalK + 1]);
        const prevK = insertMove ? diagonalK + 1 : diagonalK - 1;
        const prevX = flatTrace[base + prevK];
        const prevY = prevX - prevK;

        const intermediatePos = computeRewoundEqualSnake(
            midOps,
            prefixLength,
            { currX, currY },
            { currX: prevX, currY: prevY },
        );
        currX = intermediatePos.currX;
        currY = intermediatePos.currY;

        if (insertMove) {
            midOps.push({
                type: DIFF_OP_INSERT,
                aIdx: prefixLength + currX,
                bIdx: prefixLength + currY - 1,
            });
            currY--;
        } else {
            midOps.push({
                type: DIFF_OP_DELETE,
                aIdx: prefixLength + currX - 1,
                bIdx: prefixLength + currY,
            });
            currX--;
        }
    }
    midOps.reverse();
    return midOps;
}

const backtrackMyersTrace = computeReconstructedMyersTrace;

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
    for (let lineIndex = 0; lineIndex < count; lineIndex++) {
        target.push({ type: DIFF_OP_EQUAL, aIdx: startA + lineIndex, bIdx: startB + lineIndex });
    }
}

/**
 * Emits a contiguous run of equal diff operations. Alias of emitEqualRun.
 */
export const emitEqualSpanRun = emitEqualRun;

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
function emitSuffixOps(
    target: DiffOp[],
    suffix: number,
    oldLineCount: number,
    newLineCount: number,
): void {
    const compactThreshold = CONTEXT_MARGIN * 2;
    const baseA = oldLineCount - suffix;
    const baseB = newLineCount - suffix;
    if (COMPACT_DIFF_ENABLED && suffix > compactThreshold) {
        emitEqualRun(target, baseA, baseB, CONTEXT_MARGIN);
        const spanLen = suffix - CONTEXT_MARGIN;
        target.push({
            type: DIFF_OP_EQUAL_SPAN,
            aIdx: oldLineCount - spanLen,
            bIdx: newLineCount - spanLen,
            length: spanLen,
        });
        return;
    }
    emitEqualRun(target, baseA, baseB, suffix);
}

/**
 * Configuration options for assembling diff operations from trimmed common prefix and suffix.
 */
export interface AssembleSpanConfig {
    readonly prefix: number;
    readonly suffix: number;
    readonly oldLineCount: number;
    readonly newLineCount: number;
}

/**
 * Assemble prefix, middle operations, and suffix into unified edit script.
 *
 * @param configOrPrefix - Length of matching common prefix lines or AssembleSpanConfig.
 * @param suffixOrMidOps - Length of matching common suffix lines or middle DiffOp array.
 * @param oldLineCount - Total lines in old content.
 * @param newLineCount - Total lines in new content.
 * @param midOpsParam - Diff operations for the middle modified section.
 * @returns Complete list of diff operations for the full file.
 */
export function assembleDiffOps(
    config: AssembleSpanConfig,
    midOps: DiffOp[],
): DiffOp[] {
    const { prefix, suffix, oldLineCount, newLineCount } = config;
    const ops: DiffOp[] = [];
    emitPrefixOps(ops, prefix);
    for (let opIndex = 0; opIndex < midOps.length; opIndex++) {
        ops.push(midOps[opIndex]);
    }
    emitSuffixOps(ops, suffix, oldLineCount, newLineCount);
    return ops;
}

const FNV1A_32_PRIME = 0x01000193;
const FNV1A_32_OFFSET_BASIS = 0x811c9dc5;

function computeFnv1a32Hash(str: string): number {
    let hash = FNV1A_32_OFFSET_BASIS;
    for (let charIndex = 0; charIndex < str.length; charIndex++) {
        hash = Math.imul(hash ^ str.charCodeAt(charIndex), FNV1A_32_PRIME) >>> 0;
    }
    return hash;
}

const fnv1a = computeFnv1a32Hash;

function computeLineHashes(lines: string[]): Uint32Array {
    const hashes = new Uint32Array(lines.length);
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        hashes[lineIndex] = computeFnv1a32Hash(lines[lineIndex]);
    }
    return hashes;
}

/**
 * Return trivial diff ops when one or both input line arrays are empty.
 */
function evaluateTrivialDiff(oldLines: string[], newLines: string[]): DiffOp[] | null {
    const isOldEmpty = oldLines.length === 0;
    const isNewEmpty = newLines.length === 0;
    if (isOldEmpty && isNewEmpty) return [];
    if (isOldEmpty) {
        return newLines.map((_, bIdx) => ({ type: DIFF_OP_INSERT, aIdx: 0, bIdx }));
    }
    if (isNewEmpty) {
        return oldLines.map((_, aIdx) => ({ type: DIFF_OP_DELETE, aIdx, bIdx: 0 }));
    }
    return null;
}

const checkTrivialDiff = evaluateTrivialDiff;

/**
 * Computes an optimal line-level edit script using the standard Myers O(ND) greedy
 * diff algorithm combined with O(N) common prefix and suffix pruning.
 *
 * Preconditions:
 *   - When precomputed line hash buffers (`hashA`, `hashB`) are provided, they MUST
 *     be strictly equal in length to their corresponding line arrays
 *     (`hashA.length === oldLines.length` and `hashB.length === newLines.length`).
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
 *     exceeds 2,000,000 cells (`(max + 1) * (2 * max + 1) > MYERS_MAX_TRACE_CELLS`), the
 *     algorithm automatically degrades and falls back to `histogramDiff`
 *     to prevent out-of-memory (OOM) failures and latency spikes on disjoint content.
 *
 * @param oldLines - Array of lines from the original/old content.
 * @param newLines - Array of lines from the modified/new content.
 * @param hashA - Optional precomputed 32-bit FNV-1a hashes for lines in `oldLines`.
 *   Precondition: must equal `oldLines.length`.
 * @param hashB - Optional precomputed 32-bit FNV-1a hashes for lines in `newLines`.
 *   Precondition: must equal `newLines.length`.
 * @returns Ordered edit script (`DiffOp[]`) describing minimal edits to transform `oldLines` into `newLines`.
 */
export function computeMyersDiff(
    oldLines: string[],
    newLines: string[],
    hashA?: Uint32Array,
    hashB?: Uint32Array,
): DiffOp[] {
    const trivial = evaluateTrivialDiff(oldLines, newLines);
    if (trivial !== null) return trivial;

    const oldLineCount = oldLines.length;
    const newLineCount = newLines.length;
    const effectiveHashA = hashA ?? computeLineHashes(oldLines);
    const effectiveHashB = hashB ?? computeLineHashes(newLines);
    const trimmed = trimPrefixSuffix(oldLines, newLines, effectiveHashA, effectiveHashB);
    const { prefix, suffix, midA, midB, midHA, midHB } = trimmed;

    return executeMyersDiffCore({ prefix, suffix, oldLineCount, newLineCount, midA, midB, midHA, midHB });
}

/**
 * Computes an optimal line-level edit script using standard Myers diff algorithm.
 * Backward-compatible alias of computeMyersDiff.
 */
export const myersDiff = computeMyersDiff;

/**
 * Structured parameter object for Myers core diff algorithm execution.
 */
export interface MyersDiffPlan {
    readonly prefix: number;
    readonly suffix: number;
    readonly oldLineCount: number;
    readonly newLineCount: number;
    readonly midA: string[];
    readonly midB: string[];
    readonly midHA: Uint32Array;
    readonly midHB: Uint32Array;
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
 * @param plan - Structured Myers diff parameters including trimmed slices and line counts.
 * @returns Complete sequence of DiffOp operations reconstructing b from a.
 */
export function executeMyersDiffCore(plan: MyersDiffPlan): DiffOp[] {
    const { prefix, suffix, oldLineCount, newLineCount, midA, midB, midHA, midHB } = plan;
    if (prefix + suffix === oldLineCount && prefix + suffix === newLineCount) {
        const fullOps: DiffOp[] = [];
        for (let lineIndex = 0; lineIndex < oldLineCount; lineIndex++) {
            fullOps.push({ type: DIFF_OP_EQUAL, aIdx: lineIndex, bIdx: lineIndex });
        }
        return fullOps;
    }

    const midN = midA.length;
    const midM = midB.length;
    const maxDistance = midN + midM;
    const spanConfig: AssembleSpanConfig = { prefix, suffix, oldLineCount, newLineCount };

    // Guard against excessive iterations on large unpruned matrices (>1500 lines or >2M cells).
    // Degradation cleanly preserves trimmed prefix/suffix slices.
    if (maxDistance > MYERS_MAX_MID_LINES || (maxDistance + 1) * (2 * maxDistance + 1) > MYERS_MAX_TRACE_CELLS) {
        const midOps = histogramDiff(midA, midB, midHA, midHB);
        return assembleDiffOps(spanConfig, midOps);
    }

    const search = computeMyersTrace({ midA, midB, midHA, midHB, midN, midM }, maxDistance);
    const midOps = computeReconstructedMyersTrace(search, midN, midM, prefix);
    return assembleDiffOps(spanConfig, midOps);
}

/**
 * Core engine for Myers line diff operating on pre-trimmed middle slices.
 * Backward-compatible alias of executeMyersDiffCore.
 */
export const myersDiffCore = executeMyersDiffCore;
