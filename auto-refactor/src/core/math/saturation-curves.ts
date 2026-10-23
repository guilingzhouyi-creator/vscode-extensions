/**
 * Module: Core Math — Saturation Curves, Diminishing Returns & Density Envelopes
 * File Path: src/core/math/saturation-curves.ts
 * Architecture Role: Mathematical formulation of non-linear saturation curves, harmonic
 *   diminishing marginal returns, Michaelis-Menten rational decay, and Gaussian bell envelopes.
 * Dependencies & Triggers: Zero external dependencies; consumes standard IEEE 754 primitives.
 * Responsibilities:
 *   1. Zero-anchored smooth logistic saturation curve with linear low-infraction fidelity.
 *   2. Harmonic diminishing returns for repetitive occurrences (1 + sum(1/sqrt(i))).
 *   3. Michaelis-Menten / Hill rational decay S = L * H / (H + D) with strict convexity.
 *   4. Gaussian bell density envelope exp(-(x - mu)^2 / (2 * sigma^2)).
 * Exit Semantics & Design Rationale: Pure math functions; non-negative inputs clamped defensively;
 *   zero floating-point instability; monotonic invariants mathematically guaranteed.
 */

/**
 * Options configuring logistic sigmoid saturation parameters for scoring deductions.
 */
export interface LogisticCurveOptions {
    /** Upper ceiling capacity limit L for single dimension deductions (default 100). */
    capacityLimit?: number;
    /** Transition midpoint x0 where saturation inflection occurs (default 45). */
    inflectionPoint?: number;
    /** Growth rate / steepness k of the logistic sigmoid curve (default 0.03). */
    steepness?: number;
    /** Linear fidelity threshold under which deductions remain 100% exact (default 15). */
    linearThreshold?: number;
}

/** Default upper ceiling capacity limit for single dimension deductions. */
export const DEFAULT_CAPACITY_LIMIT = 100;
/** Default transition midpoint where saturation inflection occurs. */
export const DEFAULT_INFLECTION_POINT = 45;
/** Default growth rate steepness of the logistic sigmoid curve. */
export const DEFAULT_CURVE_STEEPNESS = 0.03;
/** Default linear fidelity threshold under which deductions remain exact. */
export const DEFAULT_LINEAR_THRESHOLD = 15;

/** Default parameters for zero-anchored logistic saturation scoring curves. */
export const DEFAULT_CURVE_OPTIONS: Required<LogisticCurveOptions> = {
    capacityLimit: DEFAULT_CAPACITY_LIMIT,
    inflectionPoint: DEFAULT_INFLECTION_POINT,
    steepness: DEFAULT_CURVE_STEEPNESS,
    linearThreshold: DEFAULT_LINEAR_THRESHOLD,
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
    maxCap: number = DEFAULT_CAPACITY_LIMIT,
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

/**
 * Computes Michaelis-Menten / Hill rational decay score:
 * S = maxScore * halfSaturation / (halfSaturation + density)
 *
 * Properties:
 * 1. Strictly convex (d^2S / dD^2 > 0) and monotonically decreasing (dS / dD < 0).
 * 2. As density -> inf, S asymptotically approaches 0, preserving relative ordering.
 *
 * @param density - Observed defect or noise density (>= 0).
 * @param halfSaturation - Semi-saturation constant H where S = maxScore / 2 (default 30).
 * @param maxScore - Baseline clean score ceiling (default 100).
 * @returns Decayed score bounded in [0, maxScore].
 */
export function computeMichaelisMentenRational(
    density: number,
    halfSaturation: number = 30,
    maxScore: number = 100,
): number {
    if (!Number.isFinite(density) || density <= 0) {
        return maxScore;
    }
    const safeH = Number.isFinite(halfSaturation) && halfSaturation > 0 ? halfSaturation : 30;
    const safeMax = Number.isFinite(maxScore) && maxScore > 0 ? maxScore : 100;
    const score = safeMax * (safeH / (safeH + density));
    return Math.max(0, Math.min(safeMax, Math.round(score * 100) / 100));
}

/**
 * Evaluates a Gaussian normal distribution density envelope:
 * G(x) = exp( - (x - mu)^2 / (2 * sigma^2) )
 *
 * @param value - Measured metric value x.
 * @param targetMean - Target optimal mean mu.
 * @param standardDeviation - Tolerance standard deviation sigma.
 * @returns Envelope response strictly bounded in (0.0, 1.0].
 */
export function computeGaussianBellDensity(
    value: number,
    targetMean: number,
    standardDeviation: number,
): number {
    if (!Number.isFinite(value) || !Number.isFinite(targetMean) || !Number.isFinite(standardDeviation) || standardDeviation <= 0) {
        return 0.0;
    }
    const diff = value - targetMean;
    const exponent = -(diff * diff) / (2.0 * standardDeviation * standardDeviation);
    return Math.max(0.0, Math.min(1.0, Math.exp(exponent)));
}
