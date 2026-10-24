/**
 * Module: Core Engine — Native Math, Graph & Vector Shim
 * File Path: src/core/native/native-math-shim.ts
 * Architecture Role: Pure JavaScript fallback implementation of Shannon information entropy,
 *   Welford statistical moments, Popoviciu dispersion, Warshall closure, and vector geometry.
 * Dependencies & Triggers: Consumes ../math and ../algorithms primitives; delegated by
 * ./native-bridge. Responsibilities:
 *   1. Calculate Shannon entropy over character streams with 0.0 NaN guard;
 *   2. Compute Welford first and second statistical moments with 4-decimal precision;
 *   3. Calculate Popoviciu inequality dispersion discount factor with bounded gamma;
 *   4. Count opening and closing curly braces with net delta tracking;
 *   5. Compute dense boolean matrix transitive closure via in-place Warshall relaxation;
 *   6. Provide vector space metric operations (dot product, cosine similarity, Euclidean distance).
 * Exit Semantics & Design Rationale: CC <= 6; pure functions; zero allocations in inner loops;
 *   guarantees 100% numerical and algorithmic parity with Rust native ops-math and ops-vector.
 */

import type { NativeBraceBalance, NativeStatisticalMoments } from './native-types';
import { countBracesDetailed } from '../algorithms/text-metrics';
import { computeWarshallTransitiveClosure } from '../algorithms/graph';
import { calculateShannonEntropy } from '../math/information-entropy';
import { computeStatisticalMoments } from '../math/descriptive-statistics';
import {
    POPOVICIU_MAX_SIGMA,
    DEFAULT_DISPERSION_PENALTY_RATIO,
} from '../math/statistical-dispersion';
import {
    computeVectorDotProduct,
    computeVectorCosineSimilarity,
    computeVectorEuclideanDistance,
} from '../math/vector-space';

const SCORE_ROUNDING_FACTOR = 100;

/**
 * Computes Shannon Information Entropy H(X) in bits.
 *
 * @param text - Input string to measure.
 * @returns Shannon entropy in bits rounded to 2 decimal places.
 */
export function computeShannonEntropyShim(text: string): number {
    return calculateShannonEntropy(text);
}

/**
 * Computes first and second statistical moments in a single online pass.
 *
 * @param values - Array of numerical values.
 * @returns Statistical moments (mean, variance, standardDeviation, count).
 */
export function computeStatisticalMomentsShim(values: readonly number[]): NativeStatisticalMoments {
    return computeStatisticalMoments(values);
}

/**
 * Calculates Popoviciu's inequality dispersion discount factor in [0.0, 1.0].
 *
 * @param standardDeviation - Sample standard deviation.
 * @param maxSigma - Maximum theoretical standard deviation (default 50.0).
 * @param gamma - Penalty elasticity factor (default 0.5).
 * @returns Discount multiplier in [0.0, 1.0].
 */
export function calculatePopoviciuDispersionPenaltyShim(
    standardDeviation: number,
    maxSigma?: number,
    gamma?: number,
): number {
    if (!Number.isFinite(standardDeviation) || standardDeviation <= 0) {
        return 1.0;
    }
    const effectiveSigma =
        maxSigma !== undefined && Number.isFinite(maxSigma) && maxSigma > 0
            ? maxSigma
            : POPOVICIU_MAX_SIGMA;
    const effectiveGamma =
        gamma !== undefined && Number.isFinite(gamma) ? gamma : DEFAULT_DISPERSION_PENALTY_RATIO;
    const normalizedDispersion = standardDeviation / effectiveSigma;
    const factor = Math.max(0.0, 1.0 - normalizedDispersion * effectiveGamma);
    return Math.round(factor * SCORE_ROUNDING_FACTOR) / SCORE_ROUNDING_FACTOR;
}

/**
 * Counts opening and closing curly braces in a line with detailed breakdown.
 *
 * @param line - Text line to inspect.
 * @returns NativeBraceBalance containing opens, closes, and delta.
 */
export function countBracesDetailedShim(line: string): NativeBraceBalance {
    return countBracesDetailed(line);
}

/**
 * Computes transitive closure over a dense boolean adjacency matrix using Warshall's algorithm.
 *
 * @param matrix - Row-major Uint8Array flat buffer of size * size.
 * @param size - Number of vertices in the square matrix.
 * @returns In-place mutated matrix with full reachability.
 */
export function computeWarshallTransitiveClosureShim(matrix: Uint8Array, size: number): Uint8Array {
    return computeWarshallTransitiveClosure(matrix, size);
}

/**
 * Computes inner dot product between two vector slices.
 *
 * @param a - First numerical vector.
 * @param b - Second numerical vector.
 * @returns Dot product scalar.
 */
export function computeVectorDotProductShim(a: readonly number[], b: readonly number[]): number {
    return computeVectorDotProduct(a, b);
}

/**
 * Computes cosine similarity between two vector slices.
 *
 * @param a - First numerical vector.
 * @param b - Second numerical vector.
 * @returns Cosine similarity bounded in [-1.0, 1.0].
 */
export function computeVectorCosineSimilarityShim(
    a: readonly number[],
    b: readonly number[],
): number {
    return computeVectorCosineSimilarity(a, b);
}

/**
 * Computes Euclidean distance between two vector slices.
 *
 * @param a - First numerical vector.
 * @param b - Second numerical vector.
 * @returns Euclidean distance scalar.
 */
export function computeVectorEuclideanDistanceShim(
    a: readonly number[],
    b: readonly number[],
): number {
    return computeVectorEuclideanDistance(a, b);
}

/**
 * Defensive fallback binding selector ensuring strictly bounded cyclomatic complexity.
 *
 * @param bindingFn - Optional native binding function.
 * @param fallbackFn - Fallback pure JS shim function.
 * @returns Active binding function.
 */
export function selectBinding<T>(bindingFn: T | undefined, fallbackFn: T): T {
    return typeof bindingFn === 'function' ? bindingFn : fallbackFn;
}
