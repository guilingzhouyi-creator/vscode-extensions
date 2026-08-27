/**
 * Git/Libgit2-grade Histogram Diff Algorithm.
 *
 * An evolution of Patience Diff designed for source code:
 * - Top-level single hash index to eliminate per-recursion Map allocations.
 * - Divides and conquers by finding "Rare / Unique Lines" (lowest occurrence count) as anchors.
 * - Uses distance-from-midpoint heuristics to pick balanced split anchors.
 * - Slices large files (e.g. 5000+ lines) into small independent sub-problems.
 * - Falls back to hash-accelerated Myers for sub-problems smaller than threshold.
 */

import { DiffOp, myersDiff } from './editDiff';

export interface Span {
  startA: number;
  endA: number; // exclusive
  startB: number;
  endB: number; // exclusive
}

const FALLBACK_THRESHOLD = 32;
const MAX_RECURSION_DEPTH = 64;

/**
 * Histogram Diff implementation using 32-bit line hashes.
 */
export function histogramDiff(
  a: string[],
  b: string[],
  hA: Uint32Array,
  hB: Uint32Array
): DiffOp[] {
  const ops: DiffOp[] = [];

  // P1-3: Build global hash index once at top level!
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
      for (let i = startB; i < endB; i++) ops.push({ type: 'insert', aIdx: startA, bIdx: i });
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
      ops.push({ type: 'equal', aIdx: startA + p, bIdx: startB + p });
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
      for (let i = 0; i < s; i++) ops.push({ type: 'equal', aIdx: curEndA + i, bIdx: curEndB + i });
      return;
    }

    if (remA <= FALLBACK_THRESHOLD || remB <= FALLBACK_THRESHOLD || depth >= MAX_RECURSION_DEPTH) {
      const sliceA = a.slice(curStartA, curEndA);
      const sliceB = b.slice(curStartB, curEndB);
      const sliceHA = hA.subarray(curStartA, curEndA);
      const sliceHB = hB.subarray(curStartB, curEndB);
      const subOps = myersDiff(sliceA, sliceB, sliceHA, sliceHB);

      for (const op of subOps) {
        if (op.type === 'equal') {
          ops.push({ type: 'equal', aIdx: curStartA + op.aIdx, bIdx: curStartB + op.bIdx });
        } else if (op.type === 'delete') {
          ops.push({ type: 'delete', aIdx: curStartA + op.aIdx, bIdx: curStartB + op.bIdx });
        } else if (op.type === 'insert') {
          ops.push({ type: 'insert', aIdx: curStartA + op.aIdx, bIdx: curStartB + op.bIdx });
        }
      }

      for (let i = 0; i < s; i++) ops.push({ type: 'equal', aIdx: curEndA + i, bIdx: curEndB + i });
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

      let countB = 0;
      let matchedB = -1;
      for (let k = 0; k < bList.length; k++) {
        const pos = bList[k];
        if (pos >= curStartB && pos < curEndB) {
          countB++;
          if (matchedB === -1 && a[i] === b[pos]) matchedB = pos;
        } else if (pos >= curEndB) break;
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
      // No common line anchor exists: all lines in A are deleted, all lines in B are inserted (O(N+M) linear time)
      for (let i = curStartA; i < curEndA; i++) {
        ops.push({ type: 'delete', aIdx: i, bIdx: curStartB });
      }
      for (let j = curStartB; j < curEndB; j++) {
        ops.push({ type: 'insert', aIdx: curEndA, bIdx: j });
      }
      for (let i = 0; i < s; i++) ops.push({ type: 'equal', aIdx: curEndA + i, bIdx: curEndB + i });
      return;
    }

    // Divide left
    solve({ startA: curStartA, endA: anchorA, startB: curStartB, endB: anchorB }, depth + 1);
    // Anchor
    ops.push({ type: 'equal', aIdx: anchorA, bIdx: anchorB });
    // Divide right
    solve({ startA: anchorA + 1, endA: curEndA, startB: anchorB + 1, endB: curEndB }, depth + 1);

    for (let i = 0; i < s; i++) ops.push({ type: 'equal', aIdx: curEndA + i, bIdx: curEndB + i });
  }

  solve({ startA: 0, endA: a.length, startB: 0, endB: b.length }, 0);
  return ops;
}
