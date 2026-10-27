/**
 * Module: Core Math — Vector Space & Linear Metric Operators
 * File Path: src/core/math/vector-space.ts
 * Architecture Role: Foundation linear algebra and metric space primitives for high-dimensional
 *   code density projections, vector distance calculations, and cosine similarity.
 * Dependencies & Triggers: Pure IEEE 754 arithmetic; zero external runtime dependencies.
 * Responsibilities:
 *   1. Compute inner dot product and L2 Euclidean norm over numerical vectors;
 *   2. Compute Euclidean distance and Manhattan distance between vector coordinates;
 *   3. Compute cosine similarity with zero-norm and degenerate dimension guards;
 *   4. Provide vector L2 normalization and spatial centroid calculations.
 * Exit Semantics & Design Rationale: CC <= 8; pure functions; zero heap allocations in inner loops;
 *   guarantees 100% floating-point equivalence with Rust native ops-vector.
 */

const EPSILON_NORM = 1e-12;

/**
 * Computes inner dot product between two vector slices: sum(a_i * b_i).
 *
 * @param vectorA - First numerical vector.
 * @param vectorB - Second numerical vector.
 * @returns Dot product scalar value.
 */
export function computeVectorDotProduct(
    vectorA: readonly number[],
    vectorB: readonly number[],
): number {
    const len = Math.min(vectorA.length, vectorB.length);
    let sum = 0.0;
    for (let i = 0; i < len; i++) {
        sum += vectorA[i] * vectorB[i];
    }
    return sum;
}

/**
 * Computes Euclidean norm (L2 norm) of a vector: sqrt(sum(a_i^2)).
 *
 * @param vector - Input numerical vector.
 * @returns L2 Euclidean norm.
 */
export function computeEuclideanNorm(vector: readonly number[]): number {
    return Math.sqrt(computeVectorDotProduct(vector, vector));
}

/**
 * Computes Euclidean distance between two vectors: sqrt(sum((a_i - b_i)^2)).
 *
 * @param vectorA - First vector coordinate.
 * @param vectorB - Second vector coordinate.
 * @returns Euclidean distance scalar.
 */
export function computeVectorEuclideanDistance(
    vectorA: readonly number[],
    vectorB: readonly number[],
): number {
    const len = Math.min(vectorA.length, vectorB.length);
    let diffSum = 0.0;
    for (let i = 0; i < len; i++) {
        const diff = vectorA[i] - vectorB[i];
        diffSum += diff * diff;
    }
    return Math.sqrt(diffSum);
}

/**
 * Computes Manhattan distance (L1 norm) between two vectors: sum(|a_i - b_i|).
 *
 * @param vectorA - First vector coordinate.
 * @param vectorB - Second vector coordinate.
 * @returns Manhattan distance scalar.
 */
export function computeVectorManhattanDistance(
    vectorA: readonly number[],
    vectorB: readonly number[],
): number {
    const len = Math.min(vectorA.length, vectorB.length);
    let sum = 0.0;
    for (let i = 0; i < len; i++) {
        sum += Math.abs(vectorA[i] - vectorB[i]);
    }
    return sum;
}

/**
 * Computes Cosine Similarity between two vectors: (a * b) / (||a|| * ||b||).
 * Returns 1.0 for two near-zero vectors, or 0.0 if either norm is zero.
 *
 * @param vectorA - First numerical vector.
 * @param vectorB - Second numerical vector.
 * @returns Cosine similarity bounded in [-1.0, 1.0].
 */
export function computeVectorCosineSimilarity(
    vectorA: readonly number[],
    vectorB: readonly number[],
): number {
    const normA = computeEuclideanNorm(vectorA);
    const normB = computeEuclideanNorm(vectorB);

    if (normA < EPSILON_NORM && normB < EPSILON_NORM) {
        return 1.0;
    }
    if (normA < EPSILON_NORM || normB < EPSILON_NORM) {
        return 0.0;
    }

    const dot = computeVectorDotProduct(vectorA, vectorB);
    const sim = dot / (normA * normB);
    return Math.min(1.0, Math.max(-1.0, sim));
}

/**
 * Normalizes a vector to unit length (L2 norm = 1.0).
 *
 * @param vector - Input numerical vector.
 * @returns Normalized unit vector, or zero vector if norm is near zero.
 */
export function normalizeVectorL2(vector: readonly number[]): number[] {
    const norm = computeEuclideanNorm(vector);
    if (norm < EPSILON_NORM) {
        return new Array(vector.length).fill(0.0);
    }
    const result = new Array<number>(vector.length);
    for (let i = 0; i < vector.length; i++) {
        result[i] = vector[i] / norm;
    }
    return result;
}

/**
 * Computes arithmetic centroid of an ensemble of vectors.
 *
 * @param vectors - Array of coordinate vectors.
 * @returns Centroid vector, or empty array if input is empty.
 */
export function computeVectorCentroid(vectors: readonly (readonly number[])[]): number[] {
    if (!vectors || vectors.length === 0) {
        return [];
    }
    const dim = vectors[0].length;
    if (dim === 0) {
        return [];
    }

    const centroid = new Array<number>(dim).fill(0.0);
    let count = 0;

    for (const vector of vectors) {
        if (vector.length === dim) {
            count++;
            for (let i = 0; i < dim; i++) {
                centroid[i] += vector[i];
            }
        }
    }

    if (count === 0) {
        return centroid;
    }

    for (let i = 0; i < dim; i++) {
        centroid[i] /= count;
    }

    return centroid;
}
