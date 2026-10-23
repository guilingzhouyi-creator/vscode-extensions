/**
 * Module: Core Math — Multi-Factor Power-Law Resonance & Non-Linear Fusion
 * File Path: src/core/math/power-resonance.ts
 * Architecture Role: Mathematical calculation of non-linear multi-plane resonance
 *   functions R = S^alpha * D^beta * H^gamma with bounded ceiling clamping.
 * Dependencies & Triggers: Zero external dependencies; consumes standard IEEE 754 math.
 * Responsibilities:
 *   1. Evaluate exponential power-law interaction between static, dynamic, and historical factors.
 *   2. Support amplification and dampening scale modifiers.
 *   3. Enforce non-negative bounds and upper ceiling saturation.
 * Exit Semantics & Design Rationale: Pure math functions; zero I/O; deterministic; non-throwing.
 */

const DEFAULT_CEILING = 100.0;
const PRECISION_ROUNDING = 100;

/**
 * Exponent tuning coefficients for multi-plane power-law resonance:
 * R = S^alpha * D^beta * H^gamma
 */
export interface PowerResonanceCoefficients {
    readonly alpha: number;
    readonly beta: number;
    readonly gamma: number;
}

/**
 * Computes non-linear power-law resonance across three factors:
 * Result = (S^alpha * D^beta * H^gamma) * modifier
 *
 * @param s - Base factor S (e.g. static risk >= 0).
 * @param d - Multiplier factor D (e.g. dynamic evidence >= 0).
 * @param h - Multiplier factor H (e.g. historical factor >= 0).
 * @param coeffs - Exponents alpha, beta, gamma.
 * @param modifier - Optional post-exponential scale modifier (e.g. dampening or amplification).
 * @param ceiling - Maximum ceiling bound (default 100.0).
 * @returns Bounded resonance score rounded to 2 decimal places.
 */
export function computePowerResonance(
    s: number,
    d: number,
    h: number,
    coeffs: PowerResonanceCoefficients,
    modifier: number = 1.0,
    ceiling: number = DEFAULT_CEILING,
): number {
    const safeS = Number.isFinite(s) && s > 0 ? s : 0.0;
    const safeD = Number.isFinite(d) && d > 0 ? d : 0.0;
    const safeH = Number.isFinite(h) && h > 0 ? h : 0.0;
    const safeMod = Number.isFinite(modifier) && modifier > 0 ? modifier : 1.0;
    const safeCeiling = Number.isFinite(ceiling) && ceiling > 0 ? ceiling : DEFAULT_CEILING;

    const termS = Math.pow(safeS, coeffs.alpha);
    const termD = Math.pow(safeD, coeffs.beta);
    const termH = Math.pow(safeH, coeffs.gamma);

    const raw = termS * termD * termH * safeMod;
    const bounded = Math.min(safeCeiling, Math.max(0.0, raw));
    return Math.round(bounded * PRECISION_ROUNDING) / PRECISION_ROUNDING;
}
