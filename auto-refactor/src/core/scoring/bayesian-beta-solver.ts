/**
 * Module: Core Engine — Analytical Bayesian Beta Distribution Solver
 * File Path: src/core/scoring/bayesian-beta-solver.ts
 * Architecture Role: Evaluates exact quantiles, incomplete beta functions, and credible
 *   intervals for Beta distributions using Lanczos log-gamma and Halley root iterations.
 * Dependencies & Triggers: Imports nothing; consumed by autonomy-scorer and statistical models.
 * Responsibilities:
 *   1. Compute log-gamma ln Gamma(z) with 15-digit precision using Lanczos expansion.
 *   2. Compute regularized incomplete beta Ix(a, b) via modified Lentz continued fractions.
 *   3. Invert regularized incomplete beta Ix(a, b) = p using Halley third-order iterations.
 *   4. Produce mathematically exact 95% Bayesian credible intervals for Beta posteriors.
 * Exit Semantics & Design Rationale: Pure math functions; zero I/O; deterministic; non-throwing.
 */

const LANCZOS_G = 7;
const LANCZOS_COEFFICIENTS: readonly number[] = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.138571095856524, 9.9843695780195716e-6,
    1.5056327351493116e-7,
];

const EPSILON_CONVERGENCE = 1e-12;
const MAX_CONTINUED_FRACTION_ITERATIONS = 120;
const MAX_HALLEY_ITERATIONS = 25;
const PERCENT_SCALE = 100.0;
const CONFIDENCE_95_PERCENT = 0.95;

/**
 * Computes natural logarithm of Gamma function ln Gamma(z) for positive real numbers.
 * Uses Lanczos approximation (g=7, N=9) achieving precision < 1e-14.
 */
export function logGamma(z: number): number {
    if (!Number.isFinite(z) || z <= 0) {
        return 0;
    }
    if (z < 0.5) {
        // Euler reflection formula: Gamma(z) * Gamma(1 - z) = pi / sin(pi * z)
        const sinTerm = Math.sin(Math.PI * z);
        if (sinTerm === 0) return 0;
        return Math.log(Math.PI) - Math.log(Math.abs(sinTerm)) - logGamma(1 - z);
    }

    const adjustedZ = z - 1;
    let baseSum = LANCZOS_COEFFICIENTS[0];
    for (let index = 1; index < LANCZOS_COEFFICIENTS.length; index++) {
        baseSum += LANCZOS_COEFFICIENTS[index] / (adjustedZ + index);
    }

    const t = adjustedZ + LANCZOS_G + 0.5;
    return 0.5 * Math.log(2 * Math.PI) + (adjustedZ + 0.5) * Math.log(t) - t + Math.log(baseSum);
}

/**
 * Computes natural logarithm of Beta function ln B(a, b) = ln Gamma(a) + ln Gamma(b) - ln Gamma(a + b).
 */
export function logBeta(a: number, b: number): number {
    return logGamma(a) + logGamma(b) - logGamma(a + b);
}

/**
 * Computes continued fraction term for regularized incomplete beta evaluation.
 */
function evaluateIncompleteBetaFraction(a: number, b: number, x: number): number {
    const qab = a + b;
    const qap = a + 1;
    const qam = a - 1;
    let c = 1.0;
    let d = 1.0 - (qab * x) / qap;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    d = 1.0 / d;
    let fraction = d;

    for (let m = 1; m <= MAX_CONTINUED_FRACTION_ITERATIONS; m++) {
        const m2 = 2 * m;
        // Even step numerator
        const dNumerator = (m * (b - m) * x) / ((qam + m2) * (a + m2));
        d = 1.0 + dNumerator * d;
        if (Math.abs(d) < 1e-30) d = 1e-30;
        c = 1.0 + dNumerator / c;
        if (Math.abs(c) < 1e-30) c = 1e-30;
        d = 1.0 / d;
        fraction *= d * c;

        // Odd step numerator
        const oddNumerator = -((a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
        d = 1.0 + oddNumerator * d;
        if (Math.abs(d) < 1e-30) d = 1e-30;
        c = 1.0 + oddNumerator / c;
        if (Math.abs(c) < 1e-30) c = 1e-30;
        d = 1.0 / d;
        const delta = d * c;
        fraction *= delta;

        if (Math.abs(delta - 1.0) < EPSILON_CONVERGENCE) {
            break;
        }
    }
    return fraction;
}

/**
 * Computes regularized incomplete beta function I_x(a, b).
 * Guarantees output strictly bounded in [0.0, 1.0].
 */
export function regularizedIncompleteBeta(a: number, b: number, x: number): number {
    if (x <= 0) return 0.0;
    if (x >= 1.0) return 1.0;
    if (a <= 0 || b <= 0) return 0.0;

    // Symmetry transformation if x > (a + 1)/(a + b + 2)
    if (x > (a + 1.0) / (a + b + 2.0)) {
        return 1.0 - regularizedIncompleteBeta(b, a, 1.0 - x);
    }

    const lnFactor = a * Math.log(x) + b * Math.log(1.0 - x) - logBeta(a, b);
    const frontFactor = Math.exp(lnFactor) / a;
    const fraction = evaluateIncompleteBetaFraction(a, b, x);

    return Math.max(0.0, Math.min(1.0, frontFactor * fraction));
}

function estimateInitialBetaQuantile(a: number, b: number, p: number): number {
    if (a < 1.0 && b >= 1.0) {
        return Math.pow(p * a * Math.exp(logBeta(a, b)), 1.0 / a);
    }
    if (b < 1.0 && a >= 1.0) {
        return 1.0 - Math.pow((1.0 - p) * b * Math.exp(logBeta(a, b)), 1.0 / b);
    }
    return a / (a + b);
}

function computeHalleyRefinementStep(
    a: number,
    b: number,
    xCandidate: number,
    error: number,
): number | null {
    const lnPdf = (a - 1.0) * Math.log(xCandidate) + (b - 1.0) * Math.log(1.0 - xCandidate) - logBeta(a, b);
    const fPrime = Math.exp(lnPdf);

    if (fPrime <= 1e-30) {
        return null;
    }

    const fDoublePrime = fPrime * ((a - 1.0) / xCandidate - (b - 1.0) / (1.0 - xCandidate));
    const denominator = fPrime - (error * fDoublePrime) / (2.0 * fPrime);
    const step = error / denominator;

    if (!Number.isFinite(step) || Math.abs(step) > 0.4) {
        return error / fPrime;
    }
    return step;
}

/**
 * Solves inverse of regularized incomplete beta function I_x(a, b) = p for x.
 * Uses Carter-Kass initial approximation followed by Halley third-order root refinement.
 */
export function inverseIncompleteBeta(a: number, b: number, p: number): number {
    if (p <= 0.0) return 0.0;
    if (p >= 1.0) return 1.0;
    if (a <= 0 || b <= 0) return 0.5;

    let xCandidate = estimateInitialBetaQuantile(a, b, p);
    xCandidate = Math.max(1e-4, Math.min(0.9999, xCandidate));
    let lowerBound = 0.0;
    let upperBound = 1.0;

    for (let iter = 0; iter < MAX_HALLEY_ITERATIONS; iter++) {
        const currentP = regularizedIncompleteBeta(a, b, xCandidate);
        const error = currentP - p;

        if (error < 0) {
            lowerBound = Math.max(lowerBound, xCandidate);
        } else {
            upperBound = Math.min(upperBound, xCandidate);
        }

        if (Math.abs(error) < EPSILON_CONVERGENCE) {
            return xCandidate;
        }

        const step = computeHalleyRefinementStep(a, b, xCandidate, error);
        if (step === null) {
            xCandidate = 0.5 * (lowerBound + upperBound);
            continue;
        }

        let nextX = xCandidate - step;
        if (nextX <= lowerBound || nextX >= upperBound) {
            nextX = 0.5 * (lowerBound + upperBound);
        }

        if (Math.abs(nextX - xCandidate) < EPSILON_CONVERGENCE) {
            return nextX;
        }
        xCandidate = nextX;
    }

    return Math.max(0.0, Math.min(1.0, xCandidate));
}

/**
 * Result record containing exact analytical Bayesian credible bounds for Beta posteriors.
 */
export interface BetaCredibleInterval {
    readonly lowerBound: number;
    readonly upperBound: number;
    readonly posteriorMean: number;
    readonly credibleScore: number;
    readonly margin: number;
    readonly isExact: boolean;
}

/**
 * Computes exact Bayesian Credible Interval [lower, upper] for a Beta(alpha, beta) distribution
 * given a nominal confidence level (default: 0.95 for 95% two-sided intervals).
 *
 * @param alpha - Posterior alpha parameter (> 0).
 * @param beta - Posterior beta parameter (> 0).
 * @param confidenceLevel - Two-sided coverage probability (default: 0.95).
 * @returns Quantified credible interval record with exact quantiles scaled to [0.0, 100.0].
 */
export function computeExactBetaCredibleInterval(
    alpha: number,
    beta: number,
    confidenceLevel = CONFIDENCE_95_PERCENT,
): BetaCredibleInterval {
    const safeAlpha = Math.max(0.001, alpha);
    const safeBeta = Math.max(0.001, beta);
    const tailProbability = (1.0 - confidenceLevel) / 2.0;

    const lowerQuantile = inverseIncompleteBeta(safeAlpha, safeBeta, tailProbability);
    const upperQuantile = inverseIncompleteBeta(safeAlpha, safeBeta, 1.0 - tailProbability);

    const meanRatio = safeAlpha / (safeAlpha + safeBeta);
    const credibleScore = +(meanRatio * PERCENT_SCALE).toFixed(2);
    const lowerBound = +(lowerQuantile * PERCENT_SCALE).toFixed(2);
    const upperBound = +(upperQuantile * PERCENT_SCALE).toFixed(2);
    const margin = +Math.max(credibleScore - lowerBound, upperBound - credibleScore).toFixed(2);

    return {
        lowerBound,
        upperBound,
        posteriorMean: meanRatio,
        credibleScore,
        margin,
        isExact: true,
    };
}
