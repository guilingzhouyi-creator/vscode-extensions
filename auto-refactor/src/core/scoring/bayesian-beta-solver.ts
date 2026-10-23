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

const LANCZOS_COEFFICIENTS = [
    0.99999999999980993,
    676.5203681218851,
    -1259.1392167224028,
    771.32342877765313,
    -176.61502916214059,
    12.507343278686905,
    -0.138571095856524,
    9.9843695780195716e-6,
    1.5056327351493116e-7,
] as const;

const EPSILON_CONVERGENCE = 1e-12;
const MAX_CONTINUED_FRACTION_ITERATIONS = 120;
const MAX_HALLEY_ITERATIONS = 25;
const PERCENT_SCALE = 100.0;
const CONFIDENCE_95_PERCENT = 0.95;

/**
 * Computes natural logarithm of Gamma function ln Gamma(z) for positive real numbers.
 * Uses Lanczos approximation (g=7, N=9) achieving precision < 1e-14.
 */
export function logGamma(inputZ: number): number {
    if (!Number.isFinite(inputZ) || inputZ <= 0) {
        return 0;
    }
    if (inputZ < 0.5) {
        // Euler reflection formula: Gamma(z) * Gamma(1 - z) = pi / sin(pi * z)
        const sinTerm = Math.sin(Math.PI * inputZ);
        if (sinTerm === 0) return 0;
        return Math.log(Math.PI) - Math.log(Math.abs(sinTerm)) - logGamma(1 - inputZ);
    }

    const adjustedZ = inputZ - 1;
    let baseSum = LANCZOS_COEFFICIENTS[0];
    for (let index = 1; index < LANCZOS_COEFFICIENTS.length; index++) {
        baseSum += LANCZOS_COEFFICIENTS[index] / (adjustedZ + index);
    }

    const tTerm = adjustedZ + LANCZOS_G + 0.5;
    return 0.5 * Math.log(2 * Math.PI) + (adjustedZ + 0.5) * Math.log(tTerm) - tTerm + Math.log(baseSum);
}

/**
 * Computes natural logarithm of Beta function ln B(a, b).
 * Identity: ln B(a, b) = ln Gamma(a) + ln Gamma(b) - ln Gamma(a + b).
 */
export function logBeta(alphaVal: number, betaVal: number): number {
    return logGamma(alphaVal) + logGamma(betaVal) - logGamma(alphaVal + betaVal);
}

/**
 * Computes continued fraction term for regularized incomplete beta evaluation.
 */
function evaluateIncompleteBetaFraction(alphaVal: number, betaVal: number, inputX: number): number {
    const qab = alphaVal + betaVal;
    const qap = alphaVal + 1;
    const qam = alphaVal - 1;
    let fractionC = 1.0;
    let fractionD = 1.0 - (qab * inputX) / qap;
    if (Math.abs(fractionD) < 1e-30) fractionD = 1e-30;
    fractionD = 1.0 / fractionD;
    let fraction = fractionD;

    for (let iterationIndex = 1; iterationIndex <= MAX_CONTINUED_FRACTION_ITERATIONS; iterationIndex++) {
        const stepM2 = 2 * iterationIndex;
        // Even step numerator
        const dNumerator = (iterationIndex * (betaVal - iterationIndex) * inputX) / ((qam + stepM2) * (alphaVal + stepM2));
        fractionD = 1.0 + dNumerator * fractionD;
        if (Math.abs(fractionD) < 1e-30) fractionD = 1e-30;
        fractionC = 1.0 + dNumerator / fractionC;
        if (Math.abs(fractionC) < 1e-30) fractionC = 1e-30;
        fractionD = 1.0 / fractionD;
        fraction *= fractionD * fractionC;

        // Odd step numerator
        const oddNumerator = -((alphaVal + iterationIndex) * (qab + iterationIndex) * inputX) / ((alphaVal + stepM2) * (qap + stepM2));
        fractionD = 1.0 + oddNumerator * fractionD;
        if (Math.abs(fractionD) < 1e-30) fractionD = 1e-30;
        fractionC = 1.0 + oddNumerator / fractionC;
        if (Math.abs(fractionC) < 1e-30) fractionC = 1e-30;
        fractionD = 1.0 / fractionD;
        const delta = fractionD * fractionC;
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
export function computeRegularizedIncompleteBeta(alphaVal: number, betaVal: number, inputX: number): number {
    if (inputX <= 0 || inputX >= 1.0) {
        return inputX <= 0 ? 0.0 : 1.0;
    }
    if (alphaVal <= 0 || betaVal <= 0) {
        return 0.0;
    }

    // Symmetry transformation if x > (a + 1)/(a + b + 2)
    if (inputX > (alphaVal + 1.0) / (alphaVal + betaVal + 2.0)) {
        return 1.0 - computeRegularizedIncompleteBeta(betaVal, alphaVal, 1.0 - inputX);
    }

    const lnFactor = alphaVal * Math.log(inputX) + betaVal * Math.log(1.0 - inputX) - logBeta(alphaVal, betaVal);
    const frontFactor = Math.exp(lnFactor) / alphaVal;
    const fraction = evaluateIncompleteBetaFraction(alphaVal, betaVal, inputX);

    return Math.max(0.0, Math.min(1.0, frontFactor * fraction));
}

/** Backward-compatible export alias for computeRegularizedIncompleteBeta. */
export const regularizedIncompleteBeta = computeRegularizedIncompleteBeta;

function estimateInitialBetaQuantile(alphaVal: number, betaVal: number, quantileP: number): number {
    if (alphaVal < 1.0 && betaVal >= 1.0) {
        return Math.pow(quantileP * alphaVal * Math.exp(logBeta(alphaVal, betaVal)), 1.0 / alphaVal);
    }
    if (betaVal < 1.0 && alphaVal >= 1.0) {
        return 1.0 - Math.pow((1.0 - quantileP) * betaVal * Math.exp(logBeta(alphaVal, betaVal)), 1.0 / betaVal);
    }
    return alphaVal / (alphaVal + betaVal);
}

function computeHalleyRefinementStep(
    alphaVal: number,
    betaVal: number,
    xCandidate: number,
    errorVal: number,
): number | null {
    const lnPdf = (alphaVal - 1.0) * Math.log(xCandidate) + (betaVal - 1.0) * Math.log(1.0 - xCandidate) - logBeta(alphaVal, betaVal);
    const fPrime = Math.exp(lnPdf);

    if (fPrime <= 1e-30) {
        return null;
    }

    const fDoublePrime = fPrime * ((alphaVal - 1.0) / xCandidate - (betaVal - 1.0) / (1.0 - xCandidate));
    const denominator = fPrime - (errorVal * fDoublePrime) / (2.0 * fPrime);
    const step = errorVal / denominator;

    const isStepUnstable = !Number.isFinite(step) || Math.abs(step) > 0.4;
    return isStepUnstable ? errorVal / fPrime : step;
}

/**
 * Solves inverse of regularized incomplete beta function I_x(a, b) = p for x.
 * Uses Carter-Kass initial approximation followed by Halley third-order root refinement.
 */
export function computeInverseIncompleteBeta(alphaVal: number, betaVal: number, quantileP: number): number {
    if (quantileP <= 0.0 || quantileP >= 1.0) {
        return quantileP <= 0.0 ? 0.0 : 1.0;
    }
    if (alphaVal <= 0 || betaVal <= 0) {
        return 0.5;
    }

    let xCandidate = estimateInitialBetaQuantile(alphaVal, betaVal, quantileP);
    xCandidate = Math.max(1e-4, Math.min(0.9999, xCandidate));
    let lowerBound = 0.0;
    let upperBound = 1.0;

    for (let iter = 0; iter < MAX_HALLEY_ITERATIONS; iter++) {
        const currentP = computeRegularizedIncompleteBeta(alphaVal, betaVal, xCandidate);
        const errorVal = currentP - quantileP;

        if (errorVal < 0) {
            lowerBound = Math.max(lowerBound, xCandidate);
        } else {
            upperBound = Math.min(upperBound, xCandidate);
        }

        if (Math.abs(errorVal) < EPSILON_CONVERGENCE) {
            return xCandidate;
        }

        const step = computeHalleyRefinementStep(alphaVal, betaVal, xCandidate, errorVal);
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

/** Backward-compatible export alias for computeInverseIncompleteBeta. */
export const inverseIncompleteBeta = computeInverseIncompleteBeta;

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

    const lowerQuantile = computeInverseIncompleteBeta(safeAlpha, safeBeta, tailProbability);
    const upperQuantile = computeInverseIncompleteBeta(safeAlpha, safeBeta, 1.0 - tailProbability);

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
