/**
 * Module: Core Engine — Histogram Diff Algorithm
 * File Path: src/core/diff/histogram-diff.ts
 * Architecture Role: Git/Libgit2-grade diff core beneath editDiff; produces the DiffOp[] edit
 *                    script consumed by the line-level incremental pipeline.
 * Dependencies & Triggers: Imports DiffOp/myersDiff from ./editDiff; called by editDiff for the
 *                    primary diff and as its mid-size sub-problem strategy; re-exported via api.ts.
 * Responsibilities: Build one top-level hash index (no per-recursion Map allocations); trim common
 *                    prefix/suffix; choose the rarest line nearest the midpoint as split anchor;
 *                    recurse left/right around anchors; emit equal/delete/insert ops; slice 5000+
 *                    line files into small independent sub-problems; fall back to hash-accelerated
 *                    Myers for sub-problems under FALLBACK_THRESHOLD (32).
 * Exit Semantics & Design Rationale: Pure, non-throwing function returning a total DiffOp[] over
 *                    both inputs; recursion is capped at MAX_RECURSION_DEPTH (64) and large
 *                    remainders fall back to Myers so worst-case cost stays bounded instead of
 *                    degrading exponentially.
 */

import type { DiffOp } from './edit-diff';
import { myersDiff } from './edit-diff';

/**
 * Half-open index ranges identifying one aligned sub-problem across the two line arrays.
 *
 * [startA, endA) indexes into the original `a` array and [startB, endB) into `b`; the pair is
 * produced by prefix/suffix trimming or by an anchor split, with endA >= startA and
 * endB >= startB. Either side may be empty when an anchored sub-problem has no remaining lines.
 */
export interface Span {
    startA: number;
    endA: number; // exclusive
    startB: number;
    endB: number; // exclusive
}

const FALLBACK_THRESHOLD = 32;
const MAX_RECURSION_DEPTH = 64;

/** Smallest hash-bucket size for which a lower-bound binary search beats a linear scan. */
const BINARY_SEARCH_MIN_BUCKET_SIZE = 8;

/** DiffOp tag for a matched/unchanged line pair. */
const DIFF_OP_EQUAL = 'equal';

/** DiffOp tag for a line added in the new content. */
const DIFF_OP_INSERT = 'insert';

/** DiffOp tag for a line deleted in the new content. */
const DIFF_OP_DELETE = 'delete';

/**
 * Execution context carrying immutable arrays and operation sink for histogram diff.
 */
interface HistogramDiffContext {
    readonly sourceLines: readonly string[];
    readonly targetLines: readonly string[];
    readonly sourceHashes: Uint32Array;
    readonly targetHashes: Uint32Array;
    readonly targetHashToPositionsMap: ReadonlyMap<number, number[]>;
    readonly operations: DiffOp[];
}

interface AnchorMatch {
    anchorSourceIndex: number;
    anchorTargetIndex: number;
}

/**
 * Checks if a candidate anchor has fewer occurrences or is closer to the midpoint.
 */
function isBetterAnchorCandidate(
    countTarget: number,
    distanceFromMid: number,
    minOccurrences: number,
    bestDistFromMid: number,
): boolean {
    if (countTarget < minOccurrences) {
        return true;
    }
    return countTarget === minOccurrences && distanceFromMid < bestDistFromMid;
}

/**
 * Emits trivial diff operations when one or both sub-problem spans are empty.
 */
function handleEmptySpan(
    context: HistogramDiffContext,
    span: Span,
): boolean {
    const sourceSpanLength = span.endA - span.startA;
    const targetSpanLength = span.endB - span.startB;

    if (sourceSpanLength === 0 && targetSpanLength === 0) return true;
    if (sourceSpanLength === 0) {
        for (let targetIndex = span.startB; targetIndex < span.endB; targetIndex++) {
            context.operations.push({
                type: DIFF_OP_INSERT,
                aIdx: span.startA,
                bIdx: targetIndex,
            });
        }
        return true;
    }
    if (targetSpanLength === 0) {
        for (let sourceIndex = span.startA; sourceIndex < span.endA; sourceIndex++) {
            context.operations.push({
                type: DIFF_OP_DELETE,
                aIdx: sourceIndex,
                bIdx: span.startB,
            });
        }
        return true;
    }
    return false;
}

/**
 * Tests whether sub-problem remainder meets Myers fallback criteria.
 */
function isFallbackCondition(remA: number, remB: number, depth: number): boolean {
    return remA <= FALLBACK_THRESHOLD || remB <= FALLBACK_THRESHOLD || depth >= MAX_RECURSION_DEPTH;
}

/**
 * Appends a line index to the hash position bucket, creating the bucket on first encounter.
 */
function appendHashPosition(
    targetMap: Map<number, number[]>,
    hashValue: number,
    positionIndex: number,
): void {
    const positionList = targetMap.get(hashValue);
    if (positionList !== undefined) {
        positionList.push(positionIndex);
        return;
    }
    targetMap.set(hashValue, [positionIndex]);
}

/**
 * Builds the top-level lookup map from line hash to target position indices.
 */
function buildTargetHashPositionMap(
    targetLines: readonly string[],
    targetHashes: Uint32Array,
): Map<number, number[]> {
    const targetMap = new Map<number, number[]>();
    for (let targetIndex = 0; targetIndex < targetLines.length; targetIndex++) {
        appendHashPosition(targetMap, targetHashes[targetIndex], targetIndex);
    }
    return targetMap;
}

function findBucketStart(
    positionBucket: readonly number[],
    startTargetIndex: number,
): number {
    const listLength = positionBucket.length;
    if (listLength <= BINARY_SEARCH_MIN_BUCKET_SIZE || positionBucket[0] >= startTargetIndex) {
        return 0;
    }
    let low = 0;
    let high = listLength - 1;
    while (low < high) {
        const mid = (low + high) >>> 1;
        if (positionBucket[mid] < startTargetIndex) {
            low = mid + 1;
        } else {
            high = mid;
        }
    }
    return low;
}

interface BucketScanConfig {
    readonly positionBucket: readonly number[];
    readonly startBucketIndex: number;
    readonly endTargetIndex: number;
    readonly targetLineContent: string;
}

function countValidOccurrences(
    context: HistogramDiffContext,
    config: BucketScanConfig,
): { countTarget: number; matchedTargetIndex: number } {
    let countTarget = 0;
    let matchedTargetIndex = -1;
    const { positionBucket, startBucketIndex, endTargetIndex, targetLineContent } = config;
    const listLength = positionBucket.length;
    for (let bucketIndex = startBucketIndex; bucketIndex < listLength; bucketIndex++) {
        const positionIndex = positionBucket[bucketIndex];
        if (positionIndex >= endTargetIndex) break;
        countTarget++;
        if (matchedTargetIndex === -1 && targetLineContent === context.targetLines[positionIndex]) {
            matchedTargetIndex = positionIndex;
        }
    }
    return { countTarget, matchedTargetIndex };
}

function findBestAnchor(
    context: HistogramDiffContext,
    activeSpan: Span,
): AnchorMatch {
    let anchorSourceIndex = -1;
    let anchorTargetIndex = -1;
    let minOccurrences = Number.POSITIVE_INFINITY;
    let bestDistFromMid = Number.POSITIVE_INFINITY;
    const remainderSource = activeSpan.endA - activeSpan.startA;
    const midPointSource = activeSpan.startA + Math.floor(remainderSource / 2);

    for (let sourceIndex = activeSpan.startA; sourceIndex < activeSpan.endA; sourceIndex++) {
        const hashValue = context.sourceHashes[sourceIndex];
        const positionBucket = context.targetHashToPositionsMap.get(hashValue);
        if (!positionBucket) continue;

        const listLength = positionBucket.length;
        if (
            positionBucket[0] >= activeSpan.endB ||
            positionBucket[listLength - 1] < activeSpan.startB
        ) {
            continue;
        }

        const startBucketIndex = findBucketStart(positionBucket, activeSpan.startB);
        const { countTarget, matchedTargetIndex } = countValidOccurrences(context, {
            positionBucket,
            startBucketIndex,
            endTargetIndex: activeSpan.endB,
            targetLineContent: context.sourceLines[sourceIndex],
        });
        if (countTarget === 0 || matchedTargetIndex === -1) continue;

        const distance = Math.abs(sourceIndex - midPointSource);
        if (isBetterAnchorCandidate(countTarget, distance, minOccurrences, bestDistFromMid)) {
            minOccurrences = countTarget;
            bestDistFromMid = distance;
            anchorSourceIndex = sourceIndex;
            anchorTargetIndex = matchedTargetIndex;
            if (countTarget === 1 && distance === 0) break;
        }
    }
    return { anchorSourceIndex, anchorTargetIndex };
}

function handleMyersFallback(
    context: HistogramDiffContext,
    activeSpan: Span,
): void {
    const sliceSource = context.sourceLines.slice(activeSpan.startA, activeSpan.endA);
    const sliceTarget = context.targetLines.slice(activeSpan.startB, activeSpan.endB);
    const sliceHashesSource = context.sourceHashes.subarray(activeSpan.startA, activeSpan.endA);
    const sliceHashesTarget = context.targetHashes.subarray(activeSpan.startB, activeSpan.endB);
    const subOperations = myersDiff(
        sliceSource,
        sliceTarget,
        sliceHashesSource,
        sliceHashesTarget,
    );

    for (const operation of subOperations) {
        context.operations.push({
            type: operation.type,
            aIdx: activeSpan.startA + operation.aIdx,
            bIdx: activeSpan.startB + operation.bIdx,
        });
    }
}

function emitDisjointOperations(
    context: HistogramDiffContext,
    activeSpan: Span,
): void {
    for (let sourceIndex = activeSpan.startA; sourceIndex < activeSpan.endA; sourceIndex++) {
        context.operations.push({
            type: DIFF_OP_DELETE,
            aIdx: sourceIndex,
            bIdx: activeSpan.startB,
        });
    }
    for (let targetIndex = activeSpan.startB; targetIndex < activeSpan.endB; targetIndex++) {
        context.operations.push({
            type: DIFF_OP_INSERT,
            aIdx: activeSpan.endA,
            bIdx: targetIndex,
        });
    }
}

function appendSuffixEquals(
    context: HistogramDiffContext,
    endSourceIndex: number,
    endTargetIndex: number,
    suffixCount: number,
): void {
    for (let offset = 0; offset < suffixCount; offset++) {
        context.operations.push({
            type: DIFF_OP_EQUAL,
            aIdx: endSourceIndex + offset,
            bIdx: endTargetIndex + offset,
        });
    }
}

function trimCommonPrefix(
    context: HistogramDiffContext,
    span: Span,
): number {
    let prefixCount = 0;
    while (
        span.startA + prefixCount < span.endA &&
        span.startB + prefixCount < span.endB &&
        context.sourceHashes[span.startA + prefixCount] ===
            context.targetHashes[span.startB + prefixCount] &&
        context.sourceLines[span.startA + prefixCount] ===
            context.targetLines[span.startB + prefixCount]
    ) {
        context.operations.push({
            type: DIFF_OP_EQUAL,
            aIdx: span.startA + prefixCount,
            bIdx: span.startB + prefixCount,
        });
        prefixCount++;
    }
    return prefixCount;
}

function trimCommonSuffix(
    context: HistogramDiffContext,
    span: Span,
    prefixCount: number,
): number {
    const minSourceIndex = span.startA + prefixCount;
    const minTargetIndex = span.startB + prefixCount;
    let suffixCount = 0;
    while (
        span.endA - 1 - suffixCount >= minSourceIndex &&
        span.endB - 1 - suffixCount >= minTargetIndex &&
        context.sourceHashes[span.endA - 1 - suffixCount] ===
            context.targetHashes[span.endB - 1 - suffixCount] &&
        context.sourceLines[span.endA - 1 - suffixCount] ===
            context.targetLines[span.endB - 1 - suffixCount]
    ) {
        suffixCount++;
    }
    return suffixCount;
}

function executeDiffRecursion(
    context: HistogramDiffContext,
    span: Span,
    recursionDepth: number,
): void {
    if (handleEmptySpan(context, span)) {
        return;
    }

    const prefixCount = trimCommonPrefix(context, span);
    const suffixCount = trimCommonSuffix(context, span, prefixCount);

    const activeSpan: Span = {
        startA: span.startA + prefixCount,
        endA: span.endA - suffixCount,
        startB: span.startB + prefixCount,
        endB: span.endB - suffixCount,
    };

    const remainingSource = activeSpan.endA - activeSpan.startA;
    const remainingTarget = activeSpan.endB - activeSpan.startB;

    if (remainingSource === 0 && remainingTarget === 0) {
        appendSuffixEquals(context, activeSpan.endA, activeSpan.endB, suffixCount);
        return;
    }

    if (isFallbackCondition(remainingSource, remainingTarget, recursionDepth)) {
        handleMyersFallback(context, activeSpan);
        appendSuffixEquals(context, activeSpan.endA, activeSpan.endB, suffixCount);
        return;
    }

    const { anchorSourceIndex, anchorTargetIndex } = findBestAnchor(context, activeSpan);

    if (anchorSourceIndex === -1 || anchorTargetIndex === -1) {
        emitDisjointOperations(context, activeSpan);
        appendSuffixEquals(context, activeSpan.endA, activeSpan.endB, suffixCount);
        return;
    }

    // Divide left
    executeDiffRecursion(
        context,
        {
            startA: activeSpan.startA,
            endA: anchorSourceIndex,
            startB: activeSpan.startB,
            endB: anchorTargetIndex,
        },
        recursionDepth + 1,
    );

    // Anchor
    context.operations.push({
        type: DIFF_OP_EQUAL,
        aIdx: anchorSourceIndex,
        bIdx: anchorTargetIndex,
    });

    // Divide right
    executeDiffRecursion(
        context,
        {
            startA: anchorSourceIndex + 1,
            endA: activeSpan.endA,
            startB: anchorTargetIndex + 1,
            endB: activeSpan.endB,
        },
        recursionDepth + 1,
    );

    appendSuffixEquals(context, activeSpan.endA, activeSpan.endB, suffixCount);
}

/**
 * Compute line-level edit script using the Git/Libgit2 histogram diff algorithm.
 *
 * @param sourceLines - Original line array; emitted `aIdx` values index into it.
 * @param targetLines - Revised line array; emitted `bIdx` values index into it.
 * @param sourceHashes - 32-bit hash for each line of `sourceLines`, aligned by index.
 * @param targetHashes - 32-bit hash for each line of `targetLines`, aligned by index.
 * @returns Edit script of equal/delete/insert operations that reconstructs `targetLines` from
 *          `sourceLines`.
 */
export function computeHistogramDiff(
    sourceLines: string[],
    targetLines: string[],
    sourceHashes: Uint32Array,
    targetHashes: Uint32Array,
): DiffOp[] {
    const operations: DiffOp[] = [];
    const targetHashToPositionsMap = buildTargetHashPositionMap(targetLines, targetHashes);

    const context: HistogramDiffContext = {
        sourceLines,
        targetLines,
        sourceHashes,
        targetHashes,
        targetHashToPositionsMap,
        operations,
    };

    executeDiffRecursion(
        context,
        {
            startA: 0,
            endA: sourceLines.length,
            startB: 0,
            endB: targetLines.length,
        },
        0,
    );

    return operations;
}

/** Backward-compatible export alias for histogram diff. */
export const histogramDiff = computeHistogramDiff;
