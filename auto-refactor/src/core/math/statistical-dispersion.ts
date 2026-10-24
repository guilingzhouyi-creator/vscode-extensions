/**
 * Module: Core Math — Statistical Dispersion & Multi-Criteria Decision Analysis (MCDA)
 * File Path: src/core/math/statistical-dispersion.ts
 * Architecture Role: Mathematical formulation of non-compensatory geometric aggregation
 *   and Popoviciu variance inequality dispersion bounding for multi-stack equilibrium.
 * Dependencies & Triggers: Consumes numerical-corridor (clamp, safeDivide);
 *   zero external dependencies.
 * Responsibilities:
 *   1. Calculate weighted geometric mean (MCDA non-compensatory scoring) with positive floor.
 *   2. Compute Popoviciu variance inequality bounds (sigma_max = 50.0 for [0, 100]).
 *   3. Compute normalized dispersion penalty factor D = max(0, 1 - (sigma / 50) * gamma).
 * Exit Semantics & Design Rationale: Pure math functions; zero I/O; deterministic; non-throwing.
 */

import { safeDivide, clamp } from './numerical-corridor';

/**
 * Popoviciu's Inequality on Variances (Popoviciu, 1935):
 * For any bounded random variable X in [a, b], Var(X) <= 1/4 * (b - a)^2,
 * which implies theoretical maximum standard deviation sigma_max = (b - a) / 2.
 * For scores bounded in [0, 100], POPOVICIU_MAX_SIGMA = 50.0.
 */
export const POPOVICIU_MAX_SIGMA = 50.0;

/** Default maximum dispersion penalty ratio gamma in [0, 1]. */
export const DEFAULT_DISPERSION_PENALTY_RATIO = 0.5;

/** Default floor for geometric mean to avoid log(0) singularity. */
export const DEFAULT_GEOMETRIC_FLOOR = 15.0;

const PRECISION_ROUNDING = 100;

interface WeightedLogAccumulator {
    totalWeight: number;
    weightedLogSum: number;
}

function hasValidVectors(scores?: readonly number[], weights?: readonly number[]): boolean {
    return Boolean(scores && weights && scores.length > 0 && weights.length > 0);
}

function accumulateLogEntry(
    acc: WeightedLogAccumulator,
    score: number,
    weight: number,
    floor: number,
): void {
    if (!Number.isFinite(weight) || weight <= 0 || !Number.isFinite(score)) {
        return;
    }
    const boundedScore = Math.max(floor, score);
    acc.weightedLogSum += weight * Math.log(boundedScore);
    acc.totalWeight += weight;
}

/**
 * Computes weighted geometric mean across positive score components:
 * S = exp( sum(w_i * ln(max(floor, s_i))) / sum(w_i) )
 *
 * Properties:
 * 1. Non-compensatory: A single collapsed axis drags down the composite score,
 *    preventing high scores on other axes from masking severe localized defects.
 * 2. Positivity guarantee: Evaluated values are bounded below by floor > 0.
 *
 * @param scores - Array of dimension score values.
 * @param weights - Array of corresponding positive weights.
 * @param floor - Minimum score floor to avoid log(0) (default 15.0).
 * @returns Bounded geometric mean rounded to two decimal places.
 */
export function computeWeightedGeometricMean(
    scores: readonly number[],
    weights: readonly number[],
    floor: number = DEFAULT_GEOMETRIC_FLOOR,
): number {
    if (!hasValidVectors(scores, weights)) {
        return 0.0;
    }

    const count = Math.min(scores.length, weights.length);
    const safeFloor = Number.isFinite(floor) && floor > 0 ? floor : DEFAULT_GEOMETRIC_FLOOR;
    const acc: WeightedLogAccumulator = { totalWeight: 0.0, weightedLogSum: 0.0 };

    for (let i = 0; i < count; i++) {
        accumulateLogEntry(acc, scores[i], weights[i], safeFloor);
    }

    if (acc.totalWeight <= 0) {
        return 0.0;
    }

    // `safeDivide` rather than a bare quotient: the log accumulator can overflow to a non-finite
    // sum for extreme score vectors, and `Math.exp` would then silently yield 0 — a plausible
    // score that hides the overflow. The guard turns that case into the documented zero fallback.
    const geometricMean = Math.exp(safeDivide(acc.weightedLogSum, acc.totalWeight));
    return Math.round(geometricMean * PRECISION_ROUNDING) / PRECISION_ROUNDING;
}

/**
 * Computes Popoviciu dispersion penalty factor D in [0.0, 1.0]:
 * sigma_norm = sigma / 50.0
 * D = max(0.0, 1.0 - sigma_norm * gamma)
 *
 * @param standardDeviation - Observed standard deviation sigma across active components.
 * @param gamma - Penalty elasticity factor in [0.0, 1.0] (default 0.5).
 * @returns Discount multiplier in [0.0, 1.0].
 */
export function computePopoviciuDispersionPenalty(
    standardDeviation: number,
    gamma: number = DEFAULT_DISPERSION_PENALTY_RATIO,
): number {
    if (!Number.isFinite(standardDeviation) || standardDeviation <= 0) {
        return 1.0;
    }
    const safeGamma = Number.isFinite(gamma)
        ? clamp(gamma, 0.0, 1.0)
        : DEFAULT_DISPERSION_PENALTY_RATIO;
    const normalizedDispersion = standardDeviation / POPOVICIU_MAX_SIGMA;
    const factor = Math.max(0.0, 1.0 - normalizedDispersion * safeGamma);
    return Math.round(factor * PRECISION_ROUNDING) / PRECISION_ROUNDING;
}
