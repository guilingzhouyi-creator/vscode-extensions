/**
 * Module: Core Math — Descriptive Statistics & Moment Operators
 * File Path: src/core/math/descriptive-statistics.ts
 * Architecture Role: Foundation operators for descriptive statistical analysis, central tendency,
 *   spatial variance, and dispersion estimation across software metrics and telemetries.
 * Dependencies & Triggers: Consumes numerical-corridor (clampRange, safeDivide); zero external runtime dependencies.
 * Responsibilities:
 *   1. Calculate first and second statistical moments (mean, variance, standard deviation) in single-pass;
 *   2. Compute quantiles, median, and interquartile range (IQR) for empirical distributions;
 *   3. Enforce deterministic numerical stability with zero NaN/Infinity leakage under empty or degenerate input.
 * Exit Semantics & Design Rationale: CC <= 10; pure functions; zero loop heap allocations; non-throwing fail-safe semantics.
 */

import { clampRange, safeDivide } from './numerical-corridor';

/**
 * Summary metrics of central tendency and dispersion.
 */
export interface StatisticalMoments {
    /** Arithmetic mean of the sample */
    readonly mean: number;
    /** Population variance sigma^2 */
    readonly variance: number;
    /** Standard deviation sigma */
    readonly standardDeviation: number;
    /** Total valid sample count */
    readonly count: number;
}

const DEFAULT_PRECISION_DIGITS = 4;

function roundPrecision(val: number, digits: number = DEFAULT_PRECISION_DIGITS): number {
    if (!Number.isFinite(val)) return 0;
    const factor = Math.pow(10, digits);
    return Math.round(val * factor) / factor;
}

/**
 * Computes arithmetic mean of a sequence of numbers.
 *
 * @param values - Input sequence of numbers.
 * @returns Rounded arithmetic mean, or 0 if sequence is empty.
 */
export function computeMean(values: readonly number[]): number {
    if (!values || values.length === 0) return 0;
    let sum = 0;
    let validCount = 0;
    for (let i = 0; i < values.length; i++) {
        const val = values[i];
        if (Number.isFinite(val)) {
            sum += val;
            validCount++;
        }
    }
    if (validCount === 0) return 0;
    return roundPrecision(safeDivide(sum, validCount));
}

/**
 * Computes population variance of a sequence of numbers.
 *
 * @param values - Input sequence of numbers.
 * @param precomputedMean - Optional precomputed mean to eliminate redundant scan.
 * @returns Rounded population variance, or 0 if sequence has fewer than 2 valid values.
 */
export function computeVariance(values: readonly number[], precomputedMean?: number): number {
    if (!values || values.length === 0) return 0;
    const mean =
        precomputedMean !== undefined && Number.isFinite(precomputedMean)
            ? precomputedMean
            : computeMean(values);

    let squaredSum = 0;
    let validCount = 0;
    for (let i = 0; i < values.length; i++) {
        const val = values[i];
        if (Number.isFinite(val)) {
            const diff = val - mean;
            squaredSum += diff * diff;
            validCount++;
        }
    }
    if (validCount === 0) return 0;
    return roundPrecision(safeDivide(squaredSum, validCount));
}

/**
 * Computes population standard deviation of a sequence of numbers.
 *
 * @param values - Input sequence of numbers.
 * @param precomputedMean - Optional precomputed mean.
 * @returns Rounded population standard deviation.
 */
export function computeStandardDeviation(
    values: readonly number[],
    precomputedMean?: number,
): number {
    const variance = computeVariance(values, precomputedMean);
    return roundPrecision(Math.sqrt(variance));
}

/**
 * Computes central tendency and dispersion moments in a unified pass.
 *
 * @param values - Input sequence of numbers.
 * @returns Complete statistical moments.
 */
export function computeStatisticalMoments(values: readonly number[]): StatisticalMoments {
    if (!values || values.length === 0) {
        return Object.freeze({ mean: 0, variance: 0, standardDeviation: 0, count: 0 });
    }

    let sum = 0;
    let validCount = 0;
    for (let i = 0; i < values.length; i++) {
        const val = values[i];
        if (Number.isFinite(val)) {
            sum += val;
            validCount++;
        }
    }

    if (validCount === 0) {
        return Object.freeze({ mean: 0, variance: 0, standardDeviation: 0, count: 0 });
    }

    const mean = safeDivide(sum, validCount);
    let squaredDiffSum = 0;
    for (let i = 0; i < values.length; i++) {
        const val = values[i];
        if (Number.isFinite(val)) {
            const diff = val - mean;
            squaredDiffSum += diff * diff;
        }
    }

    const variance = safeDivide(squaredDiffSum, validCount);
    const standardDeviation = Math.sqrt(Number.isFinite(variance) ? variance : 0);

    return Object.freeze({
        mean: roundPrecision(mean),
        variance: roundPrecision(variance),
        standardDeviation: roundPrecision(standardDeviation),
        count: validCount,
    });
}

/**
 * Computes empirical quantile q in [0.0, 1.0] using linear interpolation.
 *
 * @param values - Input sequence of numbers.
 * @param quantile - Quantile target in [0.0, 1.0].
 * @returns Interpolated quantile value.
 */
export function computeQuantile(values: readonly number[], quantile: number): number {
    if (!values || values.length === 0) return 0;
    const boundedQ = clampRange(quantile, 0.0, 1.0);

    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (sorted.length === 0) return 0;
    if (sorted.length === 1) return sorted[0];

    const position = (sorted.length - 1) * boundedQ;
    const lowerIndex = Math.floor(position);
    const upperIndex = Math.ceil(position);
    const weight = position - lowerIndex;

    const interpolated = sorted[lowerIndex] + weight * (sorted[upperIndex] - sorted[lowerIndex]);
    return roundPrecision(interpolated);
}

/**
 * Computes median (50th percentile) of a sequence.
 *
 * @param values - Input sequence of numbers.
 * @returns Median value.
 */
export function computeMedian(values: readonly number[]): number {
    return computeQuantile(values, 0.5);
}

/**
 * Computes Interquartile Range (IQR = Q3 - Q1).
 *
 * @param values - Input sequence of numbers.
 * @returns Interquartile range distance.
 */
export function computeInterquartileRange(values: readonly number[]): number {
    const q1 = computeQuantile(values, 0.25);
    const q3 = computeQuantile(values, 0.75);
    return roundPrecision(Math.max(0, q3 - q1));
}
