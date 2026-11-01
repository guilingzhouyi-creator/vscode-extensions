/**
 * Module: Core Math — Descriptive Statistics & Moment Operators
 * File Path: src/core/math/descriptive-statistics.ts
 * Architecture Role: Foundation operators for descriptive statistical analysis, central tendency,
 *   spatial variance, and dispersion estimation across software metrics and telemetries.
 * Dependencies & Triggers: Consumes numerical-corridor (clampRange, safeDivide); zero external
 *   runtime dependencies.
 * Responsibilities:
 *   1. Calculate first and second statistical moments (mean, variance, standard deviation)
 *      in a single pass;
 *   2. Compute quantiles, median, and interquartile range (IQR) for empirical distributions;
 *   3. Enforce deterministic numerical stability with zero NaN/Infinity leakage under empty
 *      or degenerate input.
 * Exit Semantics & Design Rationale: CC <= 10; pure functions; zero loop heap allocations;
 *   non-throwing fail-safe semantics.
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
const BASE_TEN_SCALE = 10;

function roundPrecision(numericValue: number, digits: number = DEFAULT_PRECISION_DIGITS): number {
    if (!Number.isFinite(numericValue)) return 0;
    const factor = Math.pow(BASE_TEN_SCALE, digits);
    return Math.round(numericValue * factor) / factor;
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
        const currentValue = values[i];
        if (Number.isFinite(currentValue)) {
            sum += currentValue;
            validCount++;
        }
    }
    return validCount === 0 ? 0 : roundPrecision(safeDivide(sum, validCount));
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
    const mean = Number.isFinite(precomputedMean)
        ? (precomputedMean as number)
        : computeMean(values);

    let squaredSum = 0;
    let validCount = 0;
    for (let i = 0; i < values.length; i++) {
        const currentValue = values[i];
        if (Number.isFinite(currentValue)) {
            const deviation = currentValue - mean;
            squaredSum += deviation * deviation;
            validCount++;
        }
    }
    return validCount === 0 ? 0 : roundPrecision(safeDivide(squaredSum, validCount));
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
 * Computes central tendency and dispersion moments in a single pass via Welford's algorithm.
 *
 * @param values - Input sequence of numbers.
 * @returns Complete statistical moments.
 */
export function computeStatisticalMoments(values: readonly number[]): StatisticalMoments {
    if (!values || values.length === 0) {
        return Object.freeze({ mean: 0, variance: 0, standardDeviation: 0, count: 0 });
    }

    let validCount = 0;
    let runningMean = 0;
    let secondMomentSum = 0;

    for (let i = 0; i < values.length; i++) {
        const currentValue = values[i];
        if (Number.isFinite(currentValue)) {
            validCount++;
            const delta = currentValue - runningMean;
            runningMean += delta / validCount;
            const deltaAfter = currentValue - runningMean;
            secondMomentSum += delta * deltaAfter;
        }
    }

    if (validCount === 0) {
        return Object.freeze({ mean: 0, variance: 0, standardDeviation: 0, count: 0 });
    }

    const variance = safeDivide(secondMomentSum, validCount);
    const standardDeviation = Math.sqrt(Math.max(0, variance));

    return Object.freeze({
        mean: roundPrecision(runningMean),
        variance: roundPrecision(variance),
        standardDeviation: roundPrecision(standardDeviation),
        count: validCount,
    });
}

/**
 * Merges two precomputed statistical moment records using Chan-Golub-LeVeque
 * pairwise algorithm.
 *
 * @param firstMoments - First statistical moments record.
 * @param secondMoments - Second statistical moments record.
 * @returns Merged statistical moments.
 */
export function mergeStatisticalMoments(
    firstMoments: StatisticalMoments,
    secondMoments: StatisticalMoments,
): StatisticalMoments {
    if (!firstMoments || firstMoments.count === 0) {
        return secondMoments || Object.freeze({ mean: 0, variance: 0, standardDeviation: 0, count: 0 });
    }
    if (!secondMoments || secondMoments.count === 0) {
        return firstMoments;
    }

    const countFirst = firstMoments.count;
    const countSecond = secondMoments.count;
    const totalCount = countFirst + countSecond;

    const delta = secondMoments.mean - firstMoments.mean;
    const mergedMean = firstMoments.mean + delta * (countSecond / totalCount);

    const momentSumFirst = firstMoments.variance * countFirst;
    const momentSumSecond = secondMoments.variance * countSecond;
    const mergedMomentSum =
        momentSumFirst + momentSumSecond + delta * delta * ((countFirst * countSecond) / totalCount);

    const variance = safeDivide(mergedMomentSum, totalCount);
    const standardDeviation = Math.sqrt(Math.max(0, variance));

    return Object.freeze({
        mean: roundPrecision(mergedMean),
        variance: roundPrecision(variance),
        standardDeviation: roundPrecision(standardDeviation),
        count: totalCount,
    });
}

/**
 * Online accumulator for statistical moments maintaining unrounded second central moments.
 */
export class OnlineWelfordAccumulator {
    private sampleCount = 0;
    private runningMean = 0;
    private secondMomentSum = 0;

    /**
     * Appends an observation to the accumulator.
     */
    updateSample(sampleValue: number): void {
        if (!Number.isFinite(sampleValue)) return;
        this.sampleCount++;
        const delta = sampleValue - this.runningMean;
        this.runningMean += delta / this.sampleCount;
        const deltaAfter = sampleValue - this.runningMean;
        this.secondMomentSum += delta * deltaAfter;
    }

    /** Compatibility alias for updateSample */
    update(sampleValue: number): void {
        this.updateSample(sampleValue);
    }

    /**
     * Merges another accumulator into this one using Chan-Golub-LeVeque formula.
     */
    mergeAccumulator(otherAccumulator: OnlineWelfordAccumulator): void {
        if (!otherAccumulator || otherAccumulator.sampleCount === 0) return;
        if (this.sampleCount === 0) {
            this.sampleCount = otherAccumulator.sampleCount;
            this.runningMean = otherAccumulator.runningMean;
            this.secondMomentSum = otherAccumulator.secondMomentSum;
            return;
        }
        const countFirst = this.sampleCount;
        const countSecond = otherAccumulator.sampleCount;
        const totalCount = countFirst + countSecond;
        const delta = otherAccumulator.runningMean - this.runningMean;
        this.runningMean += delta * (countSecond / totalCount);
        this.secondMomentSum +=
            otherAccumulator.secondMomentSum + delta * delta * ((countFirst * countSecond) / totalCount);
        this.sampleCount = totalCount;
    }

    /** Compatibility alias for mergeAccumulator */
    merge(otherAccumulator: OnlineWelfordAccumulator): void {
        this.mergeAccumulator(otherAccumulator);
    }

    /**
     * Finalizes and produces frozen statistical moments.
     */
    produceMoments(): StatisticalMoments {
        if (this.sampleCount === 0) {
            return Object.freeze({ mean: 0, variance: 0, standardDeviation: 0, count: 0 });
        }
        const variance = safeDivide(this.secondMomentSum, this.sampleCount);
        const standardDeviation = Math.sqrt(Math.max(0, variance));
        return Object.freeze({
            mean: roundPrecision(this.runningMean),
            variance: roundPrecision(variance),
            standardDeviation: roundPrecision(standardDeviation),
            count: this.sampleCount,
        });
    }

    /** Compatibility alias for produceMoments */
    finish(): StatisticalMoments {
        return this.produceMoments();
    }
}

/**
 * Computes empirical quantile target in [0.0, 1.0] using linear interpolation.
 *
 * @param values - Input sequence of numbers.
 * @param targetQuantile - Quantile target in [0.0, 1.0].
 * @returns Interpolated quantile value.
 */
export function computeQuantile(values: readonly number[], targetQuantile: number): number {
    if (!values || values.length === 0) return 0;
    const boundedQuantile = clampRange(targetQuantile, 0.0, 1.0);

    const sortedValues = values.filter(Number.isFinite).sort((valA, valB) => valA - valB);
    if (sortedValues.length === 0) return 0;
    if (sortedValues.length === 1) return sortedValues[0];

    const position = (sortedValues.length - 1) * boundedQuantile;
    const lowerIndex = Math.floor(position);
    const upperIndex = Math.ceil(position);
    const weight = position - lowerIndex;

    const interpolated =
        sortedValues[lowerIndex] + weight * (sortedValues[upperIndex] - sortedValues[lowerIndex]);
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
    const firstQuartile = computeQuantile(values, 0.25);
    const thirdQuartile = computeQuantile(values, 0.75);
    return roundPrecision(Math.max(0, thirdQuartile - firstQuartile));
}
