/**
 * Module: Core Scoring — Empirical-Bayes Confidence Calibration
 * File Path: src/core/scoring/confidence-calibration.ts
 * Architecture Role: Replaces hand-typed confidence literals with a calibrated posterior so a
 *   finding's score answers "may I use this result?" rather than "how sure does this analyzer
 *   feel?". A static rule's self-reported score is a self-marked exam: the analyzer that
 *   matched the pattern is also the one asserting the match is real, and it has no mechanism
 *   to notice its own over-matching. This module separates those two roles — the analyzer
 *   proposes, this module adjudicates from observed outcomes.
 * Dependencies & Triggers: consumes the exact Beta credible interval solver from ../math;
 *   consumed by FindingConfidenceArbiter, the AAS reporter, and
 *   scripts/validate-confidence-calibration.js.
 * Responsibilities:
 *   1. Maintain a per-rule Beta(truePositives + 0.5, falsePositives + 0.5) Jeffreys posterior.
 *   2. Shrink the posterior toward the analyzer's raw score while the sample is small, so a
 *      rule with two observations cannot outvote a rule with two thousand.
 *   3. Expose the credible bounds and a reliability verdict alongside the point estimate, so a
 *      consumer can abstain instead of trusting a number that has no support.
 *   4. Score a calibration set with ECE and Brier, the two metrics that detect a confidently
 *      wrong adjudicator (ECE alone misses spread, Brier alone misses direction).
 * Exit Semantics & Design Rationale: Pure functions, zero I/O, deterministic, non-throwing;
 *   every input is clamped into the unit interval so a malformed corpus degrades to "no
 *   information" instead of NaN propagating into gate thresholds.
 */

import { computeExactBetaCredibleInterval } from '../math';

/** Jeffreys prior mass added to each outcome count; the unbiased prior for a Bernoulli rate. */
export const JEFFREYS_PRIOR = 0.5;

/**
 * Observation count at which the posterior and the raw score carry equal weight.
 *
 * Below it the posterior is dominated by the prior and is not yet evidence; shrinking toward the
 * analyzer's own score keeps an almost-unobserved rule at its historical behaviour instead of
 * snapping to 0.5 the moment one sample lands.
 */
export const CALIBRATION_SHRINKAGE_ANCHOR = 10;

/** Closed upper bound of the unit interval used for confidence scores. */
const UNIT_MAX = 1;

/** Closed lower bound of the unit interval used for confidence scores. */
const UNIT_MIN = 0;

/** Number of equal-width bins used by the expected calibration error. */
export const DEFAULT_CALIBRATION_BIN_COUNT = 10;

/**
 * Provenance of a confidence score, carried so a consumer can tell an adjudicated number from
 * a self-reported one instead of treating them as interchangeable.
 */
export type ConfidenceSource = 'calibrated' | 'verified' | 'uncalibrated';

/** Canonical token for a confidence derived from a calibrated Beta posterior. */
export const SOURCE_CALIBRATED: ConfidenceSource = 'calibrated';

/** Canonical token for a confidence backed by deterministic proof rather than a heuristic. */
export const SOURCE_VERIFIED: ConfidenceSource = 'verified';

/** Canonical token for a confidence that is only the analyzer's own self-report. */
export const SOURCE_UNCALIBRATED: ConfidenceSource = 'uncalibrated';

/** Observed outcome counts for one rule. */
export interface RuleCalibrationStats {
    /** Rule id the counts belong to. */
    readonly rule: string;
    /** Findings later confirmed to describe a real defect. */
    readonly truePositives: number;
    /** Findings later confirmed to be false positives or deliberately suppressed debt. */
    readonly falsePositives: number;
}

/** Calibrated confidence for one finding, with the evidence behind it. */
export interface CalibratedConfidence {
    /** Score the analyzer reported. */
    readonly raw: number;
    /** Score after empirical-Bayes shrinkage toward the rule's posterior mean. */
    readonly calibrated: number;
    /**
     * Mean of the Beta posterior itself, before shrinkage.
     *
     * `calibrated` is a blend of this and `raw`, weighted by sample size, so it lies between the
     * two. The credible bounds below describe this posterior, not the blended score — reading
     * the bounds as bounds on `calibrated` would be wrong whenever shrinkage is active.
     */
    readonly posteriorMean: number;
    /** Which of the three provenances produced `calibrated`. */
    readonly source: ConfidenceSource;
    /** Posterior alpha actually used. */
    readonly alpha: number;
    /** Posterior beta actually used. */
    readonly beta: number;
    /** Total observations behind the posterior. */
    readonly sampleSize: number;
    /** Lower bound of the 95% credible interval. */
    readonly lowerBound: number;
    /** Upper bound of the 95% credible interval. */
    readonly upperBound: number;
    /**
     * True when the sample is large enough for the posterior to speak for itself. Consumers that
     * must not act on an unsupported number should abstain when this is false.
     */
    readonly isReliable: boolean;
}

/** One labelled observation used to score an adjudicator. */
export interface CalibrationPoint {
    /** Score the adjudicator produced for this observation. */
    readonly confidence: number;
    /** Ground truth: 1 when the finding was real, 0 when it was not. */
    readonly outcome: number;
}

/**
 * Clamps a value into the closed unit interval.
 *
 * Positive and negative infinity clamp to their respective bounds because they carry a direction;
 * NaN has no direction, so it degrades to the lower bound rather than guessing upward. Guessing
 * upward is exactly the failure mode this module exists to remove, so an unusable input must never
 * become a confident one.
 *
 * @param value - Candidate number.
 * @returns Value inside [0, 1].
 */
export function clampUnit(value: number): number {
    if (Number.isNaN(value)) return UNIT_MIN;
    if (value < UNIT_MIN) return UNIT_MIN;
    if (value > UNIT_MAX) return UNIT_MAX;
    return value;
}

/**
 * Rounds to four decimals, the project-wide score precision.
 *
 * @param value - Candidate number.
 * @returns Value quantized to 1e-4.
 */
function quantize(value: number): number {
    return Number(value.toFixed(4));
}

/**
 * Calibrates one finding's confidence against its rule's observed outcome history.
 *
 * `calibrated = r * posteriorMean + (1 - r) * raw`, where `r = n / (n + ANCHOR)`. At zero
 * observations the result is exactly the analyzer's own score, so introducing this module is not
 * a silent global change; as evidence accumulates the posterior takes over.
 *
 * @param rawScore - Confidence the analyzer self-reported.
 * @param stats - Observed outcome counts for the rule, or undefined when unobserved.
 * @param anchor - Observation count at which posterior and raw weigh equally.
 * @returns Calibrated confidence record with credible bounds and a reliability verdict.
 */
export function calibrateRuleConfidence(
    rawScore: number,
    stats?: RuleCalibrationStats,
    anchor: number = CALIBRATION_SHRINKAGE_ANCHOR,
): CalibratedConfidence {
    const raw = clampUnit(rawScore);
    const truePositives = Math.max(0, stats?.truePositives ?? 0);
    const falsePositives = Math.max(0, stats?.falsePositives ?? 0);
    const sampleSize = truePositives + falsePositives;
    const alpha = truePositives + JEFFREYS_PRIOR;
    const beta = falsePositives + JEFFREYS_PRIOR;

    if (sampleSize === 0) {
        return {
            raw,
            calibrated: quantize(raw),
            posteriorMean: JEFFREYS_PRIOR / (JEFFREYS_PRIOR * 2),
            source: SOURCE_UNCALIBRATED,
            alpha,
            beta,
            sampleSize: 0,
            lowerBound: UNIT_MIN,
            upperBound: UNIT_MAX,
            isReliable: false,
        };
    }

    const posteriorMean = alpha / (alpha + beta);
    const safeAnchor = Math.max(1, anchor);
    const reliability = sampleSize / (sampleSize + safeAnchor);
    const calibrated = clampUnit(reliability * posteriorMean + (1 - reliability) * raw);
    const interval = computeExactBetaCredibleInterval(alpha, beta);

    return {
        raw,
        calibrated: quantize(calibrated),
        posteriorMean: quantize(posteriorMean),
        source: SOURCE_CALIBRATED,
        alpha,
        beta,
        sampleSize,
        lowerBound: quantize(interval.lowerBound / 100),
        upperBound: quantize(interval.upperBound / 100),
        isReliable: sampleSize >= safeAnchor,
    };
}

/**
 * Builds a rule-keyed statistics index from labelled observations.
 *
 * @param records - Per-rule outcome counts.
 * @returns Read-only index keyed by rule id.
 */
export function indexRuleStats(
    records: readonly RuleCalibrationStats[],
): ReadonlyMap<string, RuleCalibrationStats> {
    const index = new Map<string, RuleCalibrationStats>();
    for (const record of records) {
        if (!record.rule) continue;
        index.set(record.rule, record);
    }
    return index;
}

/**
 * Computes the expected calibration error over equal-width confidence bins.
 *
 * ECE answers "when the adjudicator says 0.9, is it right 90% of the time?". It is the metric
 * that exposes an over-confident judge, which is exactly the failure mode a self-marked exam
 * produces and which accuracy alone hides.
 *
 * @param points - Labelled observations.
 * @param binCount - Number of equal-width bins.
 * @returns ECE in [0, 1]; zero when every bin's accuracy matches its mean confidence.
 */
export function computeExpectedCalibrationError(
    points: readonly CalibrationPoint[],
    binCount: number = DEFAULT_CALIBRATION_BIN_COUNT,
): number {
    if (points.length === 0) return 0;
    const safeBins = Math.max(1, Math.floor(binCount));
    const binTotals = new Array<number>(safeBins).fill(0);
    const binConfidence = new Array<number>(safeBins).fill(0);
    const binOutcome = new Array<number>(safeBins).fill(0);

    for (const point of points) {
        const confidence = clampUnit(point.confidence);
        const outcome = point.outcome > 0.5 ? 1 : 0;
        const index = Math.min(safeBins - 1, Math.floor(confidence * safeBins));
        binTotals[index] += 1;
        binConfidence[index] += confidence;
        binOutcome[index] += outcome;
    }

    let error = 0;
    for (let i = 0; i < safeBins; i++) {
        const total = binTotals[i];
        if (total === 0) continue;
        const meanConfidence = binConfidence[i] / total;
        const accuracy = binOutcome[i] / total;
        error += (total / points.length) * Math.abs(accuracy - meanConfidence);
    }
    return quantize(error);
}

/**
 * Computes the Brier score, the mean squared error of probabilistic predictions.
 *
 * ECE is bin-averaged and therefore blind to misordering inside a bin; Brier is per-observation
 * and differs in direction, so the two together catch both a systematically optimistic judge and
 * a judge that is merely noisy.
 *
 * @param points - Labelled observations.
 * @returns Brier score in [0, 1]; zero when every prediction matched its outcome exactly.
 */
export function computeBrierScore(points: readonly CalibrationPoint[]): number {
    if (points.length === 0) return 0;
    let sum = 0;
    for (const point of points) {
        const difference = clampUnit(point.confidence) - (point.outcome > 0.5 ? 1 : 0);
        sum += difference * difference;
    }
    return quantize(sum / points.length);
}

/**
 * Computes observed accuracy for a labelled set.
 *
 * @param points - Labelled observations.
 * @returns Share of observations whose outcome was positive, in [0, 1].
 */
export function computeObservedAccuracy(points: readonly CalibrationPoint[]): number {
    if (points.length === 0) return 0;
    let positives = 0;
    for (const point of points) {
        if (point.outcome > 0.5) positives += 1;
    }
    return quantize(positives / points.length);
}

/**
 * Computes mean reported confidence for a labelled set.
 *
 * Read next to `computeObservedAccuracy`: a mean confidence well above the observed accuracy is
 * the signature of a self-marked exam, and the gap is what ECE quantifies.
 *
 * @param points - Labelled observations.
 * @returns Mean confidence in [0, 1].
 */
export function computeMeanConfidence(points: readonly CalibrationPoint[]): number {
    if (points.length === 0) return 0;
    let sum = 0;
    for (const point of points) sum += clampUnit(point.confidence);
    return quantize(sum / points.length);
}

/** Full calibration health report for one adjudicator or rule. */
export interface CalibrationHealthReport {
    /** Number of labelled observations scored. */
    readonly sampleSize: number;
    /** Expected calibration error across equal-width bins. */
    readonly expectedCalibrationError: number;
    /** Mean squared probabilistic error. */
    readonly brierScore: number;
    /** Mean reported confidence. */
    readonly meanConfidence: number;
    /** Observed positive rate. */
    readonly observedAccuracy: number;
    /** Signed optimism: mean confidence minus observed accuracy. Positive means over-confident. */
    readonly optimism: number;
}

/**
 * Summarizes calibration health for a labelled set.
 *
 * @param points - Labelled observations.
 * @param binCount - Number of equal-width ECE bins.
 * @returns Aggregated health report.
 */
export function evaluateCalibrationHealth(
    points: readonly CalibrationPoint[],
    binCount: number = DEFAULT_CALIBRATION_BIN_COUNT,
): CalibrationHealthReport {
    const meanConfidence = computeMeanConfidence(points);
    const observedAccuracy = computeObservedAccuracy(points);
    return {
        sampleSize: points.length,
        expectedCalibrationError: computeExpectedCalibrationError(points, binCount),
        brierScore: computeBrierScore(points),
        meanConfidence,
        observedAccuracy,
        optimism: quantize(meanConfidence - observedAccuracy),
    };
}
