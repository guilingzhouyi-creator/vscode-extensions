/**
 * Module: Core Engine — Histogram Diff Algorithm
 * File Path: src/core/histogramDiff.ts
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

import type { DiffOp } from './editDiff';
import { myersDiff } from './editDiff';

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

/**
 * Diff two line arrays with the histogram algorithm over caller-supplied 32-bit line hashes.
 *
 * Trims the common prefix/suffix, picks the rarest shared line nearest the midpoint as a split
 * anchor and recurses on both sides; sub-problems below FALLBACK_THRESHOLD or the recursion cap
 * fall back to Myers. The result is a total, ordered DiffOp[] covering both inputs, and inputs
 * with no shared line degrade to a delete-then-insert script in linear time. This function is
 * pure and never throws; hA/hB must be aligned index-for-index with a/b.
 *
 * @param a - Original line array; emitted `aIdx` values index into it.
 * @param b - Revised line array; emitted `bIdx` values index into it.
 * @param hA - 32-bit hash for each line of `a`, aligned with `a` by index.
 * @param hB - 32-bit hash for each line of `b`, aligned with `b` by index.
 * @returns Edit script of equal/delete/insert operations that reconstructs `b` from `a`.
 */
export function histogramDiff(
    a: string[],
    b: string[],
    hA: Uint32Array,
    hB: Uint32Array,
): DiffOp[] {
    const ops: DiffOp[] = [];

    // Build the global hash index once at the top level so every recursion reuses it.
    const bHashPositions = new Map<number, number[]>();
    for (let j = 0; j < b.length; j++) {
        const hash = hB[j];
        let list = bHashPositions.get(hash);
        if (!list) {
            list = [];
            bHashPositions.set(hash, list);
        }
        list.push(j);
    }

    function solve(span: Span, depth: number): void {
        const { startA, endA, startB, endB } = span;
        const lenA = endA - startA;
        const lenB = endB - startB;

        if (lenA === 0 && lenB === 0) return;
        if (lenA === 0) {
            for (let i = startB; i < endB; i++)
                ops.push({ type: DIFF_OP_INSERT, aIdx: startA, bIdx: i });
            return;
        }
        if (lenB === 0) {
            for (let i = startA; i < endA; i++) ops.push({ type: 'delete', aIdx: i, bIdx: startB });
            return;
        }

        // Common prefix trimming
        let p = 0;
        while (
            startA + p < endA &&
            startB + p < endB &&
            hA[startA + p] === hB[startB + p] &&
            a[startA + p] === b[startB + p]
        ) {
            ops.push({ type: DIFF_OP_EQUAL, aIdx: startA + p, bIdx: startB + p });
            p++;
        }

        // Common suffix trimming
        let s = 0;
        while (
            endA - 1 - s >= startA + p &&
            endB - 1 - s >= startB + p &&
            hA[endA - 1 - s] === hB[endB - 1 - s] &&
            a[endA - 1 - s] === b[endB - 1 - s]
        ) {
            s++;
        }

        const curStartA = startA + p;
        const curEndA = endA - s;
        const curStartB = startB + p;
        const curEndB = endB - s;
        const remA = curEndA - curStartA;
        const remB = curEndB - curStartB;

        if (remA === 0 && remB === 0) {
            for (let i = 0; i < s; i++)
                ops.push({ type: DIFF_OP_EQUAL, aIdx: curEndA + i, bIdx: curEndB + i });
            return;
        }

        if (
            remA <= FALLBACK_THRESHOLD ||
            remB <= FALLBACK_THRESHOLD ||
            depth >= MAX_RECURSION_DEPTH
        ) {
            const sliceA = a.slice(curStartA, curEndA);
            const sliceB = b.slice(curStartB, curEndB);
            const sliceHA = hA.subarray(curStartA, curEndA);
            const sliceHB = hB.subarray(curStartB, curEndB);
            const subOps = myersDiff(sliceA, sliceB, sliceHA, sliceHB);

            for (const op of subOps) {
                if (op.type === DIFF_OP_EQUAL) {
                    ops.push({
                        type: DIFF_OP_EQUAL,
                        aIdx: curStartA + op.aIdx,
                        bIdx: curStartB + op.bIdx,
                    });
                } else if (op.type === 'delete') {
                    ops.push({
                        type: 'delete',
                        aIdx: curStartA + op.aIdx,
                        bIdx: curStartB + op.bIdx,
                    });
                } else if (op.type === DIFF_OP_INSERT) {
                    ops.push({
                        type: DIFF_OP_INSERT,
                        aIdx: curStartA + op.aIdx,
                        bIdx: curStartB + op.bIdx,
                    });
                }
            }

            for (let i = 0; i < s; i++)
                ops.push({ type: DIFF_OP_EQUAL, aIdx: curEndA + i, bIdx: curEndB + i });
            return;
        }

        // Anchor search: pick low occurrence line closest to middle
        let anchorA = -1;
        let anchorB = -1;
        let minOccurrences = Number.POSITIVE_INFINITY;
        let bestDistFromMid = Number.POSITIVE_INFINITY;
        const midPointA = curStartA + Math.floor(remA / 2);

        for (let i = curStartA; i < curEndA; i++) {
            const hash = hA[i];
            const bList = bHashPositions.get(hash);
            if (!bList) continue;

            // Fast rejection: entirely outside current [curStartB, curEndB)
            const listLen = bList.length;
            if (bList[0] >= curEndB || bList[listLen - 1] < curStartB) continue;

            // Binary search lower bound if bList is non-trivial and starts before curStartB
            let startK = 0;
            if (listLen > BINARY_SEARCH_MIN_BUCKET_SIZE && bList[0] < curStartB) {
                let low = 0;
                let high = listLen - 1;
                while (low < high) {
                    const mid = (low + high) >>> 1;
                    if (bList[mid] < curStartB) {
                        low = mid + 1;
                    } else {
                        high = mid;
                    }
                }
                startK = low;
            }

            let countB = 0;
            let matchedB = -1;
            for (let k = startK; k < listLen; k++) {
                const pos = bList[k];
                if (pos >= curEndB) break;
                countB++;
                if (matchedB === -1 && a[i] === b[pos]) matchedB = pos;
            }
            if (countB === 0 || matchedB === -1) continue;

            const dist = Math.abs(i - midPointA);
            if (countB < minOccurrences || (countB === minOccurrences && dist < bestDistFromMid)) {
                minOccurrences = countB;
                bestDistFromMid = dist;
                anchorA = i;
                anchorB = matchedB;
                if (countB === 1 && dist === 0) break; // Perfect midpoint anchor
            }
        }

        if (anchorA === -1 || anchorB === -1) {
            // No common line anchor exists: all lines in A are deleted, all lines in B are
            // inserted (O(N+M) linear time)
            for (let i = curStartA; i < curEndA; i++) {
                ops.push({ type: 'delete', aIdx: i, bIdx: curStartB });
            }
            for (let j = curStartB; j < curEndB; j++) {
                ops.push({ type: DIFF_OP_INSERT, aIdx: curEndA, bIdx: j });
            }
            for (let i = 0; i < s; i++)
                ops.push({ type: DIFF_OP_EQUAL, aIdx: curEndA + i, bIdx: curEndB + i });
            return;
        }

        // Divide left
        solve({ startA: curStartA, endA: anchorA, startB: curStartB, endB: anchorB }, depth + 1);
        // Anchor
        ops.push({ type: DIFF_OP_EQUAL, aIdx: anchorA, bIdx: anchorB });
        // Divide right
        solve(
            { startA: anchorA + 1, endA: curEndA, startB: anchorB + 1, endB: curEndB },
            depth + 1,
        );

        for (let i = 0; i < s; i++)
            ops.push({ type: DIFF_OP_EQUAL, aIdx: curEndA + i, bIdx: curEndB + i });
    }

    solve({ startA: 0, endA: a.length, startB: 0, endB: b.length }, 0);
    return ops;
}
