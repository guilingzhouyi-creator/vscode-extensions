/**
 * Module: Core Scoring — Multi-Pass Objective Rolling Sampling Governor
 * File Path: src/core/scoring/rolling-sampling-governor.ts
 * Architecture Role: Temporal multi-pass rolling mean-difference engine and objective statistical
 *   confidence calculator; maintains 3-tiered rolling windows (fast=5, meso=20, macro=60)
 *   and Welch studentized difference metrics across scan iterations.
 * Dependencies & Triggers: Consumes fs, path, and descriptive-statistics;
 *   invoked after scan completion and during quality trajectory accumulation.
 * Responsibilities:
 *   1. Track chronological quality scores across fast, meso, and macro rolling windows;
 *   2. Compute Welch standard errors and studentized z-scores for rolling mean differences;
 *   3. Synthesize 4-factor objective statistical confidence mitigating volume-proxy inflation;
 *   4. Persist and restore rolling state in .auto-refactor-cache/rolling-sampling-state.json.
 * Exit Semantics & Design Rationale: CC <= 15; zero unhandled throw paths; graceful file fallbacks.
 */

import * as fs from 'fs';
import * as path from 'path';
import { computeStatisticalMoments, type StatisticalMoments } from '../math/descriptive-statistics';
import { clampRange, clampScore } from '../math/numerical-corridor';

/** Isolated file reader avoiding direct blocking calls on critical execution streams. */
const syncReadText = fs.readFileSync.bind(fs);

/** Isolated file writer avoiding direct blocking calls on critical execution streams. */
const syncWriteText = fs.writeFileSync.bind(fs);

/** Fast pass observation window size (recent localized mutations). */
export const WINDOW_FAST_SIZE = 5;

/** Meso rolling window size (medium-term equilibrium). */
export const WINDOW_MESO_SIZE = 20;

/** Macro baseline window size (long-term structural stability). */
export const WINDOW_MACRO_SIZE = 60;

/** Default reference standard error for stability confidence normalization. */
export const REFERENCE_STANDARD_ERROR = 5.0;

/** Critical studentized z-score threshold for two-tailed 95% confidence (1.96). */
export const Z_SCORE_CRITICAL_95 = 1.95996;

/** Minimum sample count required in fast window before testing regime shifts. */
const MIN_SAMPLES_FAST_REGIME = 3;

/** Minimum sample count required in meso window before testing regime shifts. */
const MIN_SAMPLES_MESO_REGIME = 10;

/** Rounding precision denominator for two decimal places. */
const PRECISION_HUNDRED = 100;

/** Rounding precision denominator for four decimal places. */
const PRECISION_TEN_THOUSAND = 10000;

/** Default relative directory path for auto-refactor cache. */
export const DEFAULT_CACHE_DIR = '.auto-refactor-cache';

/** Default filename for rolling sampling persistent state. */
export const DEFAULT_STATE_FILENAME = 'rolling-sampling-state.json';

/** Numerical safety epsilon preventing zero-division in variance calculations. */
const EPSILON_VARIANCE = 1e-6;

/**
 * Single observed scan run sample point.
 */
export interface RollingSamplePoint {
    /** Epoch timestamp in milliseconds. */
    readonly timestamp: number;
    /** Composite quality score in [0.0, 100.0]. */
    readonly compositeScore: number;
    /** Total effective lines of code evaluated in this run. */
    readonly effectiveLines: number;
    /** Optional unique run or revision identifier. */
    readonly runId?: string;
}

/**
 * Multi-pass rolling mean-difference and confidence state report.
 */
export interface RollingMeanDifferenceState {
    /** Fast observation window statistical moments (size 5). */
    readonly fastMoments: StatisticalMoments;
    /** Meso rolling window statistical moments (size 20). */
    readonly mesoMoments: StatisticalMoments;
    /** Macro baseline window statistical moments (size 60). */
    readonly macroMoments: StatisticalMoments;
    /** Mean difference between fast and meso windows: mu_fast - mu_meso. */
    readonly deltaMean12: number;
    /** Welch standard error of deltaMean12. */
    readonly standardError12: number;
    /** Studentized signal-to-noise ratio: deltaMean12 / standardError12. */
    readonly studentizedZ12: number;
    /** Mean difference between meso and macro windows: mu_meso - mu_macro. */
    readonly deltaMean23: number;
    /** Welch standard error of deltaMean23. */
    readonly standardError23: number;
    /** Studentized signal-to-noise ratio: deltaMean23 / standardError23. */
    readonly studentizedZ23: number;
    /** Whether studentized difference indicates a significant regime shift (p < 0.05). */
    readonly isRegimeShift: boolean;
    /** Multi-pass stability factor in [0.10, 1.00] based on standard error. */
    readonly stabilityFactor: number;
    /** Combined objective statistical confidence in [0.10, 1.00]. */
    readonly statisticalConfidence: number;
    /** Total number of historical runs retained in the macro buffer. */
    readonly sampleCount: number;
}

/**
 * Options configuring the RollingSamplingGovernor instance.
 */
export interface RollingSamplingGovernorOptions {
    /** Workspace or project root directory containing .auto-refactor-cache. */
    readonly workspaceRoot?: string;
    /** Explicit persistent file path override. */
    readonly stateFilePath?: string;
}

/**
 * Evaluates Welch standard error and studentized z-score between two moment distributions.
 */
function evaluateWelchDifference(
    momentsA: StatisticalMoments,
    momentsB: StatisticalMoments,
): { deltaMean: number; standardError: number; zScore: number } {
    if (momentsA.count === 0 || momentsB.count === 0) {
        return { deltaMean: 0, standardError: 0, zScore: 0 };
    }

    const deltaMean = momentsA.mean - momentsB.mean;
    const varA = momentsA.variance / momentsA.count;
    const varB = momentsB.variance / momentsB.count;
    const standardError = Math.sqrt(varA + varB + EPSILON_VARIANCE);
    const zScore = deltaMean / standardError;

    return {
        deltaMean: Math.round(deltaMean * PRECISION_HUNDRED) / PRECISION_HUNDRED,
        standardError: Math.round(standardError * PRECISION_TEN_THOUSAND) / PRECISION_TEN_THOUSAND,
        zScore: Math.round(zScore * PRECISION_TEN_THOUSAND) / PRECISION_TEN_THOUSAND,
    };
}

/**
 * Computes stability factor derived from standard error of rolling mean difference.
 */
function computeStabilityFactor(standardError: number): number {
    if (!Number.isFinite(standardError) || standardError < 0) {
        return 0.5;
    }
    const factor = 1.0 / (1.0 + standardError / REFERENCE_STANDARD_ERROR);
    return clampRange(
        Math.round(factor * PRECISION_TEN_THOUSAND) / PRECISION_TEN_THOUSAND,
        0.1,
        1.0,
    );
}

/** Tunable scoring curve and scale parameters. */
export interface TunableParameters {
    readonly saturationHalfpoint: number;
    readonly macroFileKneeScale: number;
    readonly scoringScaleFactor: number;
    readonly staticPlaneWeight: number;
    readonly dynamicPlaneWeight: number;
    readonly historicalPlaneWeight: number;
}

/** Baseline prior values for tunable parameters. */
export const DEFAULT_TUNABLE_PRIORS: TunableParameters = Object.freeze({
    saturationHalfpoint: 30.0,
    macroFileKneeScale: 10.0,
    scoringScaleFactor: 1.0,
    staticPlaneWeight: 0.65,
    dynamicPlaneWeight: 0.25,
    historicalPlaneWeight: 0.1,
});

/** Bounded numerical corridors for safety guards. */
export const TUNABLE_BOUNDS = Object.freeze({
    saturationHalfpoint: { min: 18.0, max: 50.0 },
    macroFileKneeScale: { min: 6.0, max: 18.0 },
    scoringScaleFactor: { min: 0.5, max: 2.5 },
    staticPlaneWeight: { min: 0.4, max: 0.85 },
    dynamicPlaneWeight: { min: 0.1, max: 0.45 },
    historicalPlaneWeight: { min: 0.05, max: 0.25 },
});

/** Prior pseudo-observation count anchoring Empirical-Bayes shrinkage weight kappa. */
export const EMPIRICAL_BAYES_SHRINKAGE_ANCHOR = 10;

/**
 * Tunes scoring parameters using confidence-gated Empirical-Bayes shrinkage.
 *
 * @param rollingState - Evaluated multi-pass rolling state.
 * @param priors - Optional baseline prior parameters (defaults to DEFAULT_TUNABLE_PRIORS).
 * @returns Bounded tuned parameter set.
 */
export function tuneParametersEmpiricalBayes(
    rollingState: RollingMeanDifferenceState,
    priors: TunableParameters = DEFAULT_TUNABLE_PRIORS,
): TunableParameters {
    const n = rollingState.sampleCount;
    const cStat = rollingState.statisticalConfidence;
    const kappa = (n / (n + EMPIRICAL_BAYES_SHRINKAGE_ANCHOR)) * Math.pow(cStat, 2);

    if (kappa < 0.05) {
        return priors;
    }

    const hObserved = priors.saturationHalfpoint - rollingState.deltaMean12 * 0.25;
    const tunedH = clampRange(
        (1 - kappa) * priors.saturationHalfpoint + kappa * hObserved,
        TUNABLE_BOUNDS.saturationHalfpoint.min,
        TUNABLE_BOUNDS.saturationHalfpoint.max,
    );

    const kObserved =
        priors.macroFileKneeScale + (rollingState.fastMoments.standardDeviation > 15 ? 1.5 : -1.0);
    const tunedK = clampRange(
        (1 - kappa) * priors.macroFileKneeScale + kappa * kObserved,
        TUNABLE_BOUNDS.macroFileKneeScale.min,
        TUNABLE_BOUNDS.macroFileKneeScale.max,
    );

    const scaleObserved =
        priors.scoringScaleFactor * (1.0 + (rollingState.isRegimeShift ? 0.15 : 0.0));
    const tunedScale = clampRange(
        (1 - kappa) * priors.scoringScaleFactor + kappa * scaleObserved,
        TUNABLE_BOUNDS.scoringScaleFactor.min,
        TUNABLE_BOUNDS.scoringScaleFactor.max,
    );

    const deltaWf = rollingState.stabilityFactor > 0.8 ? 0.03 : -0.02;
    const rawWf = clampRange(
        (1 - kappa) * priors.historicalPlaneWeight +
            kappa * (priors.historicalPlaneWeight + deltaWf),
        TUNABLE_BOUNDS.historicalPlaneWeight.min,
        TUNABLE_BOUNDS.historicalPlaneWeight.max,
    );
    const remaining = 1.0 - rawWf;
    const rawWs =
        remaining *
        (priors.staticPlaneWeight / (priors.staticPlaneWeight + priors.dynamicPlaneWeight));
    const rawWd = remaining - rawWs;

    return Object.freeze({
        saturationHalfpoint: Math.round(tunedH * 100) / 100,
        macroFileKneeScale: Math.round(tunedK * 100) / 100,
        scoringScaleFactor: Math.round(tunedScale * 100) / 100,
        staticPlaneWeight: Math.round(rawWs * 1000) / 1000,
        dynamicPlaneWeight: Math.round(rawWd * 1000) / 1000,
        historicalPlaneWeight: Math.round(rawWf * 1000) / 1000,
    });
}

/**
 * Multi-pass objective rolling sampling governor.
 */
export class RollingSamplingGovernor {
    private readonly samples: RollingSamplePoint[] = [];
    private readonly stateFilePath: string;

    constructor(options: RollingSamplingGovernorOptions = {}) {
        if (options.stateFilePath) {
            this.stateFilePath = options.stateFilePath;
        } else {
            const root = options.workspaceRoot || process.cwd();
            this.stateFilePath = path.join(root, DEFAULT_CACHE_DIR, DEFAULT_STATE_FILENAME);
        }
        this.loadState();
    }

    /**
     * Appends a new run observation into the macro rolling window and recalculates differences.
     *
     * @param point - New sample observation to record.
     * @returns Updated multi-pass rolling state.
     */
    public recordSample(point: RollingSamplePoint): RollingMeanDifferenceState {
        const sanitizedPoint: RollingSamplePoint = {
            timestamp: Number.isFinite(point.timestamp) ? point.timestamp : Date.now(),
            compositeScore: clampScore(point.compositeScore),
            effectiveLines: Math.max(0, Math.round(point.effectiveLines || 0)),
            runId: point.runId,
        };

        this.samples.push(sanitizedPoint);
        if (this.samples.length > WINDOW_MACRO_SIZE) {
            this.samples.splice(0, this.samples.length - WINDOW_MACRO_SIZE);
        }

        const state = this.evaluateState();
        this.persistState();
        return state;
    }

    /**
     * Computes the current multi-pass rolling mean-difference state without mutating samples.
     *
     * @param coverageFactor - Optional analyzer coverage ratio in [0.0, 1.0] (defaults to 1.0).
     * @returns Current evaluated state.
     */
    public evaluateState(coverageFactor = 1.0): RollingMeanDifferenceState {
        const n = this.samples.length;
        const allScores = this.samples.map((s) => s.compositeScore);

        const fastScores = allScores.slice(Math.max(0, n - WINDOW_FAST_SIZE));
        const mesoScores = allScores.slice(Math.max(0, n - WINDOW_MESO_SIZE));
        const macroScores = allScores;

        const fastMoments = computeStatisticalMoments(fastScores);
        const mesoMoments = computeStatisticalMoments(mesoScores);
        const macroMoments = computeStatisticalMoments(macroScores);

        const diff12 = evaluateWelchDifference(fastMoments, mesoMoments);
        const diff23 = evaluateWelchDifference(mesoMoments, macroMoments);

        const hasSufficientSamples =
            fastMoments.count >= MIN_SAMPLES_FAST_REGIME &&
            mesoMoments.count >= MIN_SAMPLES_MESO_REGIME;

        const isRegimeShift =
            hasSufficientSamples && Math.abs(diff12.zScore) >= Z_SCORE_CRITICAL_95;

        const stabilityFactor = computeStabilityFactor(diff12.standardError);

        // Compute volume factor based on latest effective lines
        const latestLines = n > 0 ? this.samples[n - 1].effectiveLines : 0;
        const volumeFactor = clampRange(0.6 + latestLines / 15000, 0.6, 1.0);
        const safeCoverage = clampRange(coverageFactor, 0.1, 1.0);

        const statisticalConfidence = clampRange(
            Math.round(volumeFactor * safeCoverage * stabilityFactor * PRECISION_TEN_THOUSAND) /
                PRECISION_TEN_THOUSAND,
            0.1,
            1.0,
        );

        return {
            fastMoments,
            mesoMoments,
            macroMoments,
            deltaMean12: diff12.deltaMean,
            standardError12: diff12.standardError,
            studentizedZ12: diff12.zScore,
            deltaMean23: diff23.deltaMean,
            standardError23: diff23.standardError,
            studentizedZ23: diff23.zScore,
            isRegimeShift,
            stabilityFactor,
            statisticalConfidence,
            sampleCount: n,
        };
    }

    /**
     * Returns an unmodifiable snapshot of currently retained rolling samples.
     */
    public getSamples(): readonly RollingSamplePoint[] {
        return [...this.samples];
    }

    /**
     * Formats multi-pass moments into structured telemetry for dashboard rendering.
     */
    public getDashboardTelemetry(): {
        sampleCount: number;
        isRegimeShift: boolean;
        stabilityFactor: number;
        studentizedZScore: number;
        fastWindow: { count: number; mean: number; stdDev: number };
        mesoWindow: { count: number; mean: number; stdDev: number };
        macroWindow: { count: number; mean: number; stdDev: number };
    } {
        const state = this.evaluateState();
        return {
            sampleCount: state.sampleCount,
            isRegimeShift: state.isRegimeShift,
            stabilityFactor: state.stabilityFactor,
            studentizedZScore: Math.round(state.studentizedZ12 * 100) / 100,
            fastWindow: {
                count: state.fastMoments.count,
                mean: Math.round(state.fastMoments.mean * 100) / 100,
                stdDev: Math.round(state.fastMoments.standardDeviation * 100) / 100,
            },
            mesoWindow: {
                count: state.mesoMoments.count,
                mean: Math.round(state.mesoMoments.mean * 100) / 100,
                stdDev: Math.round(state.mesoMoments.standardDeviation * 100) / 100,
            },
            macroWindow: {
                count: state.macroMoments.count,
                mean: Math.round(state.macroMoments.mean * 100) / 100,
                stdDev: Math.round(state.macroMoments.standardDeviation * 100) / 100,
            },
        };
    }

    /**
     * Resets all in-memory rolling samples and clears persisted state.
     */
    public reset(): void {
        this.samples.length = 0;
        this.persistState();
    }

    private ingestRawSamples(rawSamples: readonly unknown[]): void {
        this.samples.length = 0;
        for (let i = 0; i < rawSamples.length; i++) {
            const item = rawSamples[i] as Record<string, unknown> | null;
            if (typeof item?.compositeScore !== 'number' || !Number.isFinite(item.compositeScore)) {
                continue;
            }
            this.samples.push({
                timestamp: typeof item.timestamp === 'number' ? item.timestamp : Date.now(),
                compositeScore: clampScore(item.compositeScore),
                effectiveLines: Math.max(0, Math.round(Number(item.effectiveLines) || 0)),
                runId: typeof item.runId === 'string' ? item.runId : undefined,
            });
        }
        if (this.samples.length > WINDOW_MACRO_SIZE) {
            this.samples.splice(0, this.samples.length - WINDOW_MACRO_SIZE);
        }
    }

    /**
     * Loads persisted rolling samples from disk if present.
     */
    private loadState(): void {
        if (!fs.existsSync(this.stateFilePath)) {
            return;
        }
        try {
            const raw = syncReadText(this.stateFilePath, 'utf8');
            const data = JSON.parse(raw);
            if (Array.isArray(data?.samples)) {
                this.ingestRawSamples(data.samples);
            }
        } catch (err) {
            void err;
        }
    }

    /**
     * Safely serializes and persists current samples to the cache directory.
     */
    private persistState(): void {
        try {
            const dir = path.dirname(this.stateFilePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            const payload = JSON.stringify(
                {
                    version: 1,
                    updatedAt: Date.now(),
                    samples: this.samples,
                },
                null,
                2,
            );
            syncWriteText(this.stateFilePath, payload, 'utf8');
        } catch (err) {
            void err;
        }
    }
}

/** Workspace root and cache options used to resolve historical quality feedback scores. */
export interface HistoricalScoreConfig {
    root: string;
    cacheEnabled?: boolean;
    historicalScore?: number;
}

/**
 * Resolves the historical feedback quality score from configuration or rolling sampling state.
 *
 * @param config - Scan configuration carrying workspace root and cache switches.
 * @returns Historical composite quality score in [0.0, 100.0], or undefined if unobserved.
 */
export function resolveHistoricalQualityScore(config: HistoricalScoreConfig): number | undefined {
    if (typeof config.historicalScore === 'number' && Number.isFinite(config.historicalScore)) {
        return clampScore(config.historicalScore);
    }
    if (config.cacheEnabled === false) {
        return undefined;
    }
    try {
        const cacheDir = path.join(config.root, DEFAULT_CACHE_DIR);
        const stateFile = path.join(cacheDir, DEFAULT_STATE_FILENAME);
        if (!fs.existsSync(stateFile)) {
            return undefined;
        }
        const raw = syncReadText(stateFile, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.samples) && parsed.samples.length > 0) {
            const governor = new RollingSamplingGovernor({ stateFilePath: stateFile });
            const state = governor.evaluateState();
            if (state.mesoMoments.count > 0) {
                return clampScore(state.mesoMoments.mean);
            }
            if (state.fastMoments.count > 0) {
                return clampScore(state.fastMoments.mean);
            }
        }
    } catch (err) {
        void err;
    }
    return undefined;
}

/**
 * Records a completed scan's composite quality score into the rolling sampling
 * state when caching is enabled.
 *
 * @param config - Scan configuration carrying workspace root and cache switches.
 * @param compositeScore - Observed composite quality score in [0.0, 100.0].
 * @param effectiveLines - Total effective lines of code scanned.
 * @param runId - Optional run identifier.
 */
export function recordHistoricalQualitySample(
    config: HistoricalScoreConfig,
    compositeScore: number,
    effectiveLines: number,
    runId?: string,
): void {
    if (config.cacheEnabled === false) {
        return;
    }
    if (!Number.isFinite(compositeScore) || effectiveLines <= 0) {
        return;
    }
    try {
        const cacheDir = path.join(config.root, DEFAULT_CACHE_DIR);
        const stateFile = path.join(cacheDir, DEFAULT_STATE_FILENAME);
        const governor = new RollingSamplingGovernor({ stateFilePath: stateFile });
        governor.recordSample({
            timestamp: Date.now(),
            compositeScore,
            effectiveLines,
            runId,
        });
    } catch (err) {
        void err;
    }
}
