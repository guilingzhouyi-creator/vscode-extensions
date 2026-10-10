/**
 * Module: Telemetry & Statistical Modeling — Bayesian Confidence Evaluator
 * File Path: templates/bayesian-confidence-evaluator.ts
 * Architecture Role: Canonical reference implementation for Jeffreys Beta(0.5, 0.5)
 *   conjugate posterior point estimation, variance tracking, and credible interval bounding.
 * Dependencies & Triggers: Zero external dependencies; consumed by autonomy scorers
 *   and telemetry measurement engines across the workspace.
 * Responsibilities:
 *   1. Calculate conjugate posterior mean and variance with Jeffreys uninformative prior.
 *   2. Generate dual-sided 95% credible intervals with [0, 1] measure bounds.
 *   3. Enforce anti-gaming thresholds to prevent score inflation on trivial edits.
 * Exit Semantics & Design Rationale: Pure deterministic mathematics without hardcoded bias.
 */

export interface BinomialSampleObservation {
    readonly successes: number;
    readonly failures: number;
}

export interface PosteriorEstimateResult {
    readonly sampleSize: number;
    readonly posteriorMean: number;
    readonly posteriorVariance: number;
    readonly standardDeviation: number;
    readonly lowerBound95: number;
    readonly upperBound95: number;
}

export interface AntiGamingCheckParams {
    readonly changedEloc: number;
    readonly totalEloc: number;
    readonly netDebtEliminated: number;
}

export interface AntiGamingCheckResult {
    readonly isGaming: boolean;
    readonly code: string;
    readonly message: string;
}

const CRITICAL_Z_95 = 1.95996;
const JEFFREYS_ALPHA_PRIOR = 0.5;
const JEFFREYS_BETA_PRIOR = 0.5;
const TRIVIAL_SEMANTIC_THRESHOLD = 0.15;

/**
 * Computes conjugate Bayesian posterior parameters under a Jeffreys Beta prior.
 *
 * @param sample - Success and failure tallies.
 * @returns Fully bounded posterior statistical estimate.
 */
export function evaluateBetaConjugatePosterior(
    sample: BinomialSampleObservation,
): PosteriorEstimateResult {
    const s = Math.max(0, sample.successes);
    const f = Math.max(0, sample.failures);
    const n = s + f;

    const alphaStar = s + JEFFREYS_ALPHA_PRIOR;
    const betaStar = f + JEFFREYS_BETA_PRIOR;
    const totalStar = alphaStar + betaStar;

    const posteriorMean = alphaStar / totalStar;
    const posteriorVariance = (alphaStar * betaStar) / (totalStar * totalStar * (totalStar + 1));
    const standardDeviation = Math.sqrt(posteriorVariance);

    const margin = CRITICAL_Z_95 * standardDeviation;
    const lowerBound95 = Math.max(0.0, posteriorMean - margin);
    const upperBound95 = Math.min(1.0, posteriorMean + margin);

    return Object.freeze({
        sampleSize: n,
        posteriorMean: Number(posteriorMean.toFixed(4)),
        posteriorVariance: Number(posteriorVariance.toFixed(6)),
        standardDeviation: Number(standardDeviation.toFixed(4)),
        lowerBound95: Number(lowerBound95.toFixed(4)),
        upperBound95: Number(upperBound95.toFixed(4)),
    });
}

/**
 * Evaluates whether a proposed code change represents a trivial gaming pattern.
 *
 * @param params - Semantic code delta metrics.
 * @returns Decision result indicating whether gaming was detected.
 */
export function evaluateAntiGamingDefense(
    params: AntiGamingCheckParams,
): AntiGamingCheckResult {
    const total = Math.max(1, params.totalEloc);
    const changed = Math.max(0, params.changedEloc);
    const semanticRatio = changed / total;

    if (semanticRatio <= TRIVIAL_SEMANTIC_THRESHOLD && params.netDebtEliminated <= 0) {
        return Object.freeze({
            isGaming: true,
            code: 'BLOCK_GAMING_DETECTED',
            message: `Trivial edit (${(semanticRatio * 100).toFixed(1)}% <= 15%) with 0 net debt eliminated.`,
        });
    }

    return Object.freeze({
        isGaming: false,
        code: 'CLEAN',
        message: 'Valid code evolution with genuine semantic progress.',
    });
}

