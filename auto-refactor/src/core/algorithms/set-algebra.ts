/**
 * Module: Core Algorithms — Set Algebra & Similarity Primitives
 * File Path: src/core/algorithms/set-algebra.ts
 * Architecture Role: Foundation operators for set theory operations, intersection,
 *   difference, union, and Jaccard similarity evaluation across file and symbol sets.
 * Dependencies & Triggers: Zero external runtime dependencies.
 * Responsibilities:
 *   1. Calculate exact Jaccard similarity index |A ∩ B| / |A ∪ B| in [0.0, 1.0];
 *   2. Execute symmetric and asymmetric set algebra operations (intersection, difference, union);
 *   3. Enforce deterministic empty set boundaries (empty sets yield 1.0 identical similarity, or
 *      0.0 otherwise).
 * Exit Semantics & Design Rationale: CC <= 6; pure functions; non-throwing fail-safe semantics.
 */

const FOUR_DECIMAL_SCALE = 10_000;

/**
 * Computes Jaccard similarity coefficient |A ∩ B| / |A ∪ B| between two sets.
 *
 * @param setA - First set of elements.
 * @param setB - Second set of elements.
 * @returns Jaccard similarity in [0.0, 1.0] rounded to 4 decimal places.
 */
export function computeJaccardSimilarity<T>(setA: ReadonlySet<T>, setB: ReadonlySet<T>): number {
    if (!setA || !setB) return 0;
    if (setA.size === 0 && setB.size === 0) return 1.0;
    if (setA.size === 0 || setB.size === 0) return 0.0;

    // Iterate over the smaller set to minimize lookup operations
    const [smaller, larger] = setA.size <= setB.size ? [setA, setB] : [setB, setA];
    let intersectionCount = 0;

    for (const item of smaller) {
        if (larger.has(item)) {
            intersectionCount++;
        }
    }

    const unionCount = setA.size + setB.size - intersectionCount;
    if (unionCount === 0) return 1.0;

    const coefficient = intersectionCount / unionCount;
    return Math.round(coefficient * FOUR_DECIMAL_SCALE) / FOUR_DECIMAL_SCALE;
}

/**
 * Computes intersection of two sets (elements present in both A and B).
 *
 * @param setA - First set.
 * @param setB - Second set.
 * @returns New set containing common elements.
 */
export function computeSetIntersection<T>(setA: ReadonlySet<T>, setB: ReadonlySet<T>): Set<T> {
    const intersectionSet = new Set<T>();
    if (!setA || !setB || setA.size === 0 || setB.size === 0) return intersectionSet;

    const [smaller, larger] = setA.size <= setB.size ? [setA, setB] : [setB, setA];
    for (const item of smaller) {
        if (larger.has(item)) {
            intersectionSet.add(item);
        }
    }
    return intersectionSet;
}

/**
 * Computes union of two sets (elements present in either A or B).
 *
 * @param setA - First set.
 * @param setB - Second set.
 * @returns New set containing all unique elements.
 */
export function computeSetUnion<T>(setA: ReadonlySet<T>, setB: ReadonlySet<T>): Set<T> {
    const unionSet = new Set<T>(setA);
    if (setB) {
        for (const item of setB) {
            unionSet.add(item);
        }
    }
    return unionSet;
}

/**
 * Computes difference between two sets (elements in A but not in B).
 *
 * @param setA - Source set.
 * @param setB - Subtrahend set.
 * @returns New set with remaining elements from A.
 */
export function computeSetDifference<T>(setA: ReadonlySet<T>, setB: ReadonlySet<T>): Set<T> {
    if (!setA || setA.size === 0) return new Set<T>();
    if (!setB || setB.size === 0) {
        return new Set<T>(setA);
    }

    const differenceSet = new Set<T>();
    for (const item of setA) {
        if (!setB.has(item)) {
            differenceSet.add(item);
        }
    }
    return differenceSet;
}

/**
 * Checks whether two sets contain the exact same elements.
 *
 * @param setA - First set.
 * @param setB - Second set.
 * @returns True if both sets have identical members.
 */
export function checkSetsEqual<T>(setA: ReadonlySet<T>, setB: ReadonlySet<T>): boolean {
    if (setA === setB) return true;
    if (!setA || !setB) return false;
    if (setA.size !== setB.size) return false;

    for (const item of setA) {
        if (!setB.has(item)) return false;
    }
    return true;
}

/** Backward compatibility alias for checkSetsEqual. */
export const areSetsEqual = checkSetsEqual;
