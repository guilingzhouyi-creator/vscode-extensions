/**
 * Module: Core Engine — Compact Bounded Corridor & Numerical Interval Guard
 * File Path: src/core/scoring/bounded-corridor.ts
 * Architecture Role: Mathematical invariants and compact interval clamping primitives
 *   for scores, ratios, weights, and floating-point corridor assertions.
 * Dependencies & Triggers: Zero external dependencies; consumes standard IEEE 754 primitives;
 *   called by hierarchicalScorer, patchQuality, modernization-metrics, and gate scripts.
 * Responsibilities:
 *   1. Provide strict double-sided compact interval clamping (clamp, clampRatio, clampScore).
 *   2. Guarantee finite number sanitization, immune to NaN, +Infinity, and -Infinity.
 *   3. Provide zero-division resilient safe division (safeDivide).
 *   4. Provide bounded corridor invariant evaluation and assertions (isWithinCorridor).
 * Exit Semantics & Design Rationale: Pure functional arithmetic; zero side-effects;
 *   zero heap allocations in hot paths (CPX-SPACE-001); CC <= 5; deterministic bounds.
 */

/** Default floating-point precision tolerance epsilon for corridor checks. */
export const DEFAULT_CORRIDOR_EPSILON = 1e-4;

/** Standard score precision rounding denominator (two decimal places: 0.01). */
export const SCORE_ROUNDING_FACTOR = 100;

/** Default maximum score ceiling. */
export const DEFAULT_SCORE_CEILING = 100;

/**
 * Clamps a numeric value into a closed bounded interval [min, max].
 *
 * Invariant Guarantees:
 * 1. If value is NaN, returns min (or max if min is invalid).
 * 2. If min > max, the boundaries are automatically normalized to [max, min].
 * 3. The returned value is mathematically guaranteed to satisfy min <= result <= max.
 *
 * @param value - Arbitrary numeric input.
 * @param min - Lower bound of the closed interval.
 * @param max - Upper bound of the closed interval.
 * @returns Bounded finite number strictly within [min, max].
 */
export function clamp(value: number, min: number, max: number): number {
    const safeMin = Number.isFinite(min) ? min : 0;
    const safeMax = Number.isFinite(max) ? max : safeMin;
    const lower = safeMin <= safeMax ? safeMin : safeMax;
    const upper = safeMin <= safeMax ? safeMax : safeMin;

    if (Number.isNaN(value)) {
        return lower;
    }
    if (value < lower) {
        return lower;
    }
    if (value > upper) {
        return upper;
    }
    return value;
}

/**
 * Clamps a normalized ratio into the unit interval [0.0, 1.0].
 *
 * @param ratio - Arbitrary ratio input.
 * @returns Bounded ratio strictly within [0.0, 1.0].
 */
export function clampRatio(ratio: number): number {
    return clamp(ratio, 0.0, 1.0);
}

/**
 * Clamps a quality score into a valid closed scoring band [0.0, ceiling].
 * Rounds to two decimal places (0.01 precision).
 *
 * @param score - Raw score value.
 * @param ceiling - Maximum score ceiling (defaults to 100.0).
 * @returns Bounded score strictly within [0.0, ceiling].
 */
export function clampScore(score: number, ceiling: number = DEFAULT_SCORE_CEILING): number {
    const safeCeiling = Number.isFinite(ceiling) && ceiling > 0 ? ceiling : DEFAULT_SCORE_CEILING;
    const bounded = clamp(score, 0.0, safeCeiling);
    return Math.round(bounded * SCORE_ROUNDING_FACTOR) / SCORE_ROUNDING_FACTOR;
}

/**
 * Performs division with zero-division and non-finite protection.
 *
 * @param numerator - Dividend number.
 * @param denominator - Divisor number.
 * @param fallback - Safe fallback value when division is invalid (defaults to 0).
 * @returns Division result if denominator is non-zero and finite, otherwise fallback.
 */
export function safeDivide(numerator: number, denominator: number, fallback = 0): number {
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
        return fallback;
    }
    const result = numerator / denominator;
    return Number.isFinite(result) ? result : fallback;
}

/**
 * Verifies whether a measured value lies within a bounded corridor around a target.
 *
 * Formula: |actual - target| <= tolerance
 *
 * @param actual - Measured or computed value.
 * @param target - Reference target value.
 * @param tolerance - Allowed bidirectional tolerance epsilon (defaults to 1e-4).
 * @returns True if actual is within target ± tolerance.
 */
export function isWithinCorridor(
    actual: number,
    target: number,
    tolerance: number = DEFAULT_CORRIDOR_EPSILON,
): boolean {
    if (!Number.isFinite(actual) || !Number.isFinite(target)) {
        return false;
    }
    const safeTolerance = Number.isFinite(tolerance) && tolerance >= 0 ? tolerance : 0;
    return Math.abs(actual - target) <= safeTolerance;
}

/**
 * Normalizes an arbitrary numeric input into a sanitized safe finite bound.
 *
 * @param rawValue - Untrusted or optional numeric input.
 * @param fallback - Fallback value if rawValue is undefined or non-finite.
 * @param min - Optional minimum threshold.
 * @param max - Optional maximum threshold.
 * @returns Sanitized bounded finite number.
 */
export function sanitizeBound(
    rawValue: number | undefined | null,
    fallback: number,
    min?: number,
    max?: number,
): number {
    const safeBase = typeof rawValue === 'number' && Number.isFinite(rawValue) ? rawValue : fallback;
    const lower = typeof min === 'number' && Number.isFinite(min) ? min : -Infinity;
    const upper = typeof max === 'number' && Number.isFinite(max) ? max : Infinity;
    return clamp(safeBase, lower, upper);
}

/**
 * Asserts that a measured value lies within the target tolerance corridor.
 * Throws a formatted RangeError if the actual value deviates beyond tolerance.
 *
 * @param actual - Measured or computed value.
 * @param target - Target expected value.
 * @param tolerance - Allowed tolerance epsilon (defaults to 1e-4).
 * @param message - Optional contextual assertion description.
 */
export function assertWithinCorridor(
    actual: number,
    target: number,
    tolerance: number = DEFAULT_CORRIDOR_EPSILON,
    message?: string,
): void {
    if (!isWithinCorridor(actual, target, tolerance)) {
        const desc = message ? `${message}: ` : '';
        throw new RangeError(
            `${desc}Value ${actual} deviated from target ${target} by ${Math.abs(actual - target)} (allowed tolerance: ${tolerance})`,
        );
    }
}
