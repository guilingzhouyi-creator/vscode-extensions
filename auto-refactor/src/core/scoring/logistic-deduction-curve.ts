/**
 * Module: Core Scoring — Logistic Marginal Deduction & Saturation Curves
 * File Path: src/core/scoring/logistic-deduction-curve.ts
 * Architecture Role: Implements non-linear logistic saturation and marginal utility
 *   dampening to eliminate catastrophic score cliff crashes while maintaining strict penalty
 *   fidelity on early infractions.
 * Dependencies & Triggers: Mathematical utility invoked by scorer-formulas and QualityScorer.
 * Responsibilities:
 *   1. Compute sub-linear diminishing penalty returns for repetitive findings (1 + sum(1/sqrt(i))).
 *   2. Implement zero-anchored logistic saturation curve: D(0) = 0, D(x) -> L as x -> inf.
 *   3. Preserve linear fidelity for low-risk early warnings (x <= linearThreshold).
 *   4. Safeguard dimension score boundaries with strict monotonicity: x1 <= x2 ==> D(x1) <= D(x2).
 * Exit Semantics & Design Rationale: Pure math functions; NaN and negative inputs clamped to 0;
 *   zero floating-point instability.
 */

/**
 * Options configuring logistic sigmoid saturation parameters for scoring deductions.
 */
export interface LogisticCurveOptions {
    /** Upper ceiling capacity limit L for single dimension deductions (default 100). */
    capacityLimit?: number;
    /** Transition midpoint x0 where saturation inflection occurs (default 40). */
    inflectionPoint?: number;
    /** Growth rate / steepness k of the logistic sigmoid curve (default 0.035). */
    steepness?: number;
    /** Linear fidelity threshold under which deductions remain 100% exact (default 15). */
    linearThreshold?: number;
}

/** Default parameters for zero-anchored logistic saturation scoring curves. */
export const DEFAULT_CURVE_OPTIONS: Required<LogisticCurveOptions> = {
    capacityLimit: 100,
    inflectionPoint: 45,
    steepness: 0.03,
    linearThreshold: 15,
};

/**
 * Zero-anchored smooth logistic saturation function.
 *
 * Mathematical formulation:
 *   D(x) = L * ( (1 / (1 + exp(-k * (x - x0)))) - (1 / (1 + exp(k * x0))) ) /
 *              ( 1 - (1 / (1 + exp(k * x0))) )
 *
 * Guarantees:
 *   1. D(0) = 0
 *   2. Monotonically non-decreasing: dD/dx >= 0 for all x >= 0
 *   3. Upper bound: lim(x -> inf) D(x) <= L
 *   4. For x <= linearThreshold, returns raw x to preserve exact small penalties.
 *
 * @param rawPoints - Linear accumulated penalty points (>= 0).
 * @param options - Custom curve tuning parameters.
 * @returns Non-linear saturated deduction points bounded in [0, capacityLimit].
 */
export function applyLogisticSaturation(rawPoints: number, options?: LogisticCurveOptions): number {
    if (isNaN(rawPoints) || rawPoints <= 0) {
        return 0;
    }

    const L = options?.capacityLimit ?? DEFAULT_CURVE_OPTIONS.capacityLimit;
    const x0 = options?.inflectionPoint ?? DEFAULT_CURVE_OPTIONS.inflectionPoint;
    const k = options?.steepness ?? DEFAULT_CURVE_OPTIONS.steepness;
    const linearThreshold = options?.linearThreshold ?? DEFAULT_CURVE_OPTIONS.linearThreshold;

    // Preserve exact linear deduction for early/minor warnings
    if (rawPoints <= linearThreshold) {
        return Math.min(L, rawPoints);
    }

    // Zero offset anchor: offset0 = 1 / (1 + exp(k * x0))
    const offset0 = 1 / (1 + Math.exp(k * x0));
    const sigmoidX = 1 / (1 + Math.exp(-k * (rawPoints - x0)));

    const normalized = (sigmoidX - offset0) / (1 - offset0);
    const saturated = L * Math.max(0, Math.min(1, normalized));

    // Guarantee that smoothed curve is at least as large as linearThreshold at junction
    const result = Math.max(linearThreshold, saturated);
    return Math.min(L, +result.toFixed(2));
}

/**
 * Marginal deduction for repeated occurrences of similar issues in the same file.
 * Formula: Deduction(n) = Base * (1 + sum_{i=2}^n (1 / sqrt(i)))
 *
 * @param occurrences - Number of occurrences of the same issue rule.
 * @param basePoints - Base penalty points for a single violation.
 * @param maxCap - Optional ceiling cap (defaults to 100).
 * @returns Damped marginal deduction points.
 */
export function calculateMarginalDeduction(
    occurrences: number,
    basePoints: number,
    maxCap: number = 100,
): number {
    if (occurrences <= 0 || basePoints <= 0) return 0;
    if (occurrences === 1) return Math.min(maxCap, basePoints);

    let harmonicSum = 1.0;
    for (let i = 2; i <= occurrences; i++) {
        harmonicSum += 1.0 / Math.sqrt(i);
    }

    const total = basePoints * harmonicSum;
    return Math.min(maxCap, Math.round(total));
}

/**
 * Aggregate a list of discrete penalty points with diminishing marginal returns.
 *
 * @param pointsList - Array of individual penalty point values.
 * @param options - Logistic saturation options.
 * @returns Net saturated penalty score.
 */
export function compressDimensionDeductions(
    pointsList: number[],
    options?: LogisticCurveOptions,
): number {
    if (!pointsList || pointsList.length === 0) return 0;

    let rawTotal = 0;
    for (const p of pointsList) {
        if (!isNaN(p) && p > 0) {
            rawTotal += p;
        }
    }

    return applyLogisticSaturation(rawTotal, options);
}
