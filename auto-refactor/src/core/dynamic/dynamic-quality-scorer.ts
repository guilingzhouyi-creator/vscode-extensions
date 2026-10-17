/**
 * Module: Dynamic Analysis Plane — Dynamic Quality Scorer & Hotspot Risk Evaluator
 * File Path: src/core/dynamic/dynamic-quality-scorer.ts
 * Architecture Role: Mathematical calculation engine for the Dynamic Analysis Plane (DAP);
 *   computes the 5-dimensional dynamic quality vector Q_d = f(L, T, M, C, E), calculates
 *   runtime hotspot risk D_i = B_i * F_i * R_i * V_i, and produces explainable score breakdowns.
 * Dependencies & Triggers: Consumes dynamic-types and telemetry-ingestor; consumed by
 *   feedback fusion layer.
 * Responsibilities:
 *   1. Evaluate Latency Score (L) via exponential tail SLA degradation.
 *   2. Evaluate Throughput Score (T) against operational targets.
 *   3. Evaluate Memory Stability Score (M) penalizing GC pauses and progressive leaks.
 *   4. Evaluate Concurrency Score (C) penalizing lock wait contention and deadlocks.
 *   5. Evaluate Execution Evidence Depth (E) based on coverage and verified calls.
 *   6. Compute single-hotspot dynamic risk D_i = B_i * F_i * R_i * V_i.
 * Exit Semantics & Design Rationale: Bounded [0.0, 100.0] score space; non-linear risk saturation;
 *   zero division / NaN guards.
 */

import type {
    DynamicEvidenceDTO,
    DynamicQualityVector,
    DynamicQualityAxis,
    DynamicRiskParams,
    DynamicIssueRisk,
} from './dynamic-types';
import { ALL_DYNAMIC_QUALITY_AXES, DEFAULT_DYNAMIC_WEIGHTS } from './dynamic-types';
import { SCORE_ROUNDING } from '../scoring/scorer-formulas';

const MAX_SCORE = 100.0;
const MIN_SCORE = 0.0;
const DEFAULT_PRIOR_SCORE = 100.0;
const TOTAL_OBSERVED_AXES_BASE = 5.0;
const MIN_CONFIDENCE_THRESHOLD = 0.2;
const DEFAULT_LATENCY_PERCENTILE_99_MS = 15.0;
const DEFAULT_LATENCY_BUDGET_MS = 16.67;
const OVERSHOOT_DECAY_RATE = 0.8;
const DEFAULT_THROUGHPUT_OPS = 1000;
const MEMORY_LEAK_DEDUCTION = 50.0;
const GC_PAUSE_BASELINE_MS = 100.0;
const GC_PAUSE_SCALE_FACTOR = 15.0;
const GC_PAUSE_MAX_DEDUCTION = 30.0;
const HIGH_ALLOCATION_RATE_LIMIT = 20971520; // 20 MB/s
const HIGH_ALLOCATION_RATE_DEDUCTION = 15.0;
const CALL_DEPTH_DIVISOR = 4.0;
const COVERAGE_LINE_WEIGHT = 0.6;
const COVERAGE_BRANCH_WEIGHT = 0.4;
const DEFAULT_HOTSPOT_ID = 'hotspot-dynamic';
const RISK_NORMALIZATION_DIVISOR = 250.0;
const HUNDRED_PERCENT_MULTIPLIER = 100;
const FULL_CONFIDENCE = 1.0;
const PARTIAL_CONFIDENCE = 0.6;
const MAX_HOTSPOT_DIMENSION_SCORE = 5.0;
const DEFAULT_HOTSPOT_DIMENSION_SCORE = 2.0;
const MIN_HOTSPOT_DIMENSION_SCORE = 1.0;
const MAX_NORMALIZED_RISK = 10.0;
const MIN_NORMALIZED_RISK = 0.0;
const DEFAULT_INVOCATIONS_PER_HOUR = 3600;
const MIN_FREQUENCY_FACTOR = 0.1;

/**
 * Result of evaluating observation completeness of dynamic telemetry evidence.
 */
export interface DynamicCompletenessResult {
    /** Observation completeness ratio [0.0, 1.0] */
    completeness: number;
    /** Observed telemetry axes */
    observedAxes: DynamicQualityAxis[];
    /** Recommended Bayesian confidence weighting factor [0.2, 1.0] */
    confidenceFactor: number;
}

/**
 * Evaluates the observation completeness ratio of a dynamic evidence telemetry snapshot.
 *
 * @param dto - Dynamic evidence telemetry snapshot.
 * @returns Quantified DynamicCompletenessResult.
 */
export function evaluateDynamicCompleteness(dto: DynamicEvidenceDTO): DynamicCompletenessResult {
    const observed: DynamicQualityAxis[] = [];
    if (dto.latency !== undefined) observed.push('L');
    if (dto.throughput !== undefined) observed.push('T');
    if (dto.memory !== undefined) observed.push('M');
    if (dto.concurrency !== undefined) observed.push('C');
    if (dto.execution !== undefined) observed.push('E');

    const completeness =
        Math.round((observed.length / TOTAL_OBSERVED_AXES_BASE) * HUNDRED_PERCENT_MULTIPLIER) /
        HUNDRED_PERCENT_MULTIPLIER;
    const confidenceFactor = Math.max(MIN_CONFIDENCE_THRESHOLD, completeness);

    return {
        completeness,
        observedAxes: observed,
        confidenceFactor,
    };
}

/**
 * Evaluates Latency (L) score from telemetry or defaults to prior score.
 */
function evaluateLatencyScore(dto: DynamicEvidenceDTO, priorScore: number): number {
    if (dto.latency === undefined) return priorScore;
    const lat = dto.latency;
    const latencyPercentile99Ms =
        lat.percentile99Ms ?? lat['p99Ms'] ?? DEFAULT_LATENCY_PERCENTILE_99_MS;
    const budget = lat.budgetMs ?? DEFAULT_LATENCY_BUDGET_MS;
    let scoreL = MAX_SCORE;
    if (latencyPercentile99Ms > budget) {
        const overshoot = (latencyPercentile99Ms - budget) / budget;
        scoreL = MAX_SCORE * Math.exp(-OVERSHOOT_DECAY_RATE * overshoot);
    }
    return Math.max(MIN_SCORE, Math.min(MAX_SCORE, scoreL));
}

/**
 * Evaluates Throughput (T) score from telemetry or defaults to prior score.
 */
function evaluateThroughputScore(dto: DynamicEvidenceDTO, priorScore: number): number {
    if (dto.throughput === undefined) return priorScore;
    const thr = dto.throughput;
    const ops = thr.opsPerSec ?? DEFAULT_THROUGHPUT_OPS;
    const targetOps = thr.targetOpsPerSec ?? DEFAULT_THROUGHPUT_OPS;
    return targetOps > 0
        ? Math.max(MIN_SCORE, Math.min(MAX_SCORE, (ops / targetOps) * MAX_SCORE))
        : MAX_SCORE;
}

/**
 * Evaluates Memory and GC (M) score from telemetry or defaults to prior score.
 */
function evaluateMemoryScore(dto: DynamicEvidenceDTO, priorScore: number): number {
    if (dto.memory === undefined) return priorScore;
    const mem = dto.memory;
    let scoreM = MAX_SCORE;
    if ((mem.detectedLeakBytes ?? 0) > 0) {
        scoreM -= MEMORY_LEAK_DEDUCTION;
    }
    const gcTotalPauseMs = mem.gcTotalPauseMs ?? 0;
    if (gcTotalPauseMs > GC_PAUSE_BASELINE_MS) {
        const pauseExcess = (gcTotalPauseMs - GC_PAUSE_BASELINE_MS) / GC_PAUSE_BASELINE_MS;
        scoreM -= Math.min(GC_PAUSE_MAX_DEDUCTION, pauseExcess * GC_PAUSE_SCALE_FACTOR);
    }
    if ((mem.allocationRateBytesPerSec ?? 0) > HIGH_ALLOCATION_RATE_LIMIT) {
        scoreM -= HIGH_ALLOCATION_RATE_DEDUCTION;
    }
    return Math.max(MIN_SCORE, Math.min(MAX_SCORE, scoreM));
}

/**
 * Evaluates Concurrency (C) score from telemetry or defaults to prior score.
 */
function evaluateConcurrencyScore(dto: DynamicEvidenceDTO, priorScore: number): number {
    if (dto.concurrency === undefined) return priorScore;
    const con = dto.concurrency;
    if (con.deadlockDetected) {
        return MIN_SCORE;
    }
    const contention = Math.max(0.0, Math.min(1.0, con.contentionRatio ?? 0.0));
    return Math.max(MIN_SCORE, Math.min(MAX_SCORE, MAX_SCORE * (1.0 - contention)));
}

/**
 * Evaluates Execution Evidence Depth (E) score from telemetry or defaults to prior score.
 */
function evaluateExecutionScore(dto: DynamicEvidenceDTO, priorScore: number): number {
    if (dto.execution === undefined) return priorScore;
    const exec = dto.execution;
    const lineCov = Math.max(0.0, Math.min(MAX_SCORE, exec.lineCoveragePct ?? 0.0));
    const branchCov = Math.max(0.0, Math.min(MAX_SCORE, exec.branchCoveragePct ?? lineCov));
    const calls = exec.callCount ?? 0;
    const callDepthFactor =
        calls > 0
            ? Math.min(1.0, Math.log10(calls + 1) / CALL_DEPTH_DIVISOR)
            : lineCov > 0
              ? 0.85
              : 0.2;
    return Math.max(
        MIN_SCORE,
        Math.min(
            MAX_SCORE,
            (lineCov * COVERAGE_LINE_WEIGHT + branchCov * COVERAGE_BRANCH_WEIGHT) * callDepthFactor,
        ),
    );
}

/**
 * Computes the 5-dimensional DynamicQualityVector Q_d = (L, T, M, C, E) from telemetry DTO,
 * applying Bayesian prior smoothing for unobserved telemetry axes.
 *
 * @param dto - Ingested DynamicEvidenceDTO telemetry snapshot.
 * @param priorScore - Bayesian prior score used when metrics are unobserved (default: 100.0).
 * @returns Bounded DynamicQualityVector with values scaled between 0.0 and 100.0.
 */
export function computeDynamicQualityVector(
    dto: DynamicEvidenceDTO,
    priorScore = DEFAULT_PRIOR_SCORE,
): DynamicQualityVector {
    const scoreL = evaluateLatencyScore(dto, priorScore);
    const scoreT = evaluateThroughputScore(dto, priorScore);
    const scoreM = evaluateMemoryScore(dto, priorScore);
    const scoreC = evaluateConcurrencyScore(dto, priorScore);
    const scoreE = evaluateExecutionScore(dto, priorScore);

    return {
        L: Math.round(scoreL * SCORE_ROUNDING) / SCORE_ROUNDING,
        T: Math.round(scoreT * SCORE_ROUNDING) / SCORE_ROUNDING,
        M: Math.round(scoreM * SCORE_ROUNDING) / SCORE_ROUNDING,
        C: Math.round(scoreC * SCORE_ROUNDING) / SCORE_ROUNDING,
        E: Math.round(scoreE * SCORE_ROUNDING) / SCORE_ROUNDING,
    };
}

/**
 * Computes scalar dynamic quality score from DynamicQualityVector.
 *
 * @param vector - 5-dimensional DynamicQualityVector.
 * @param weights - Optional customized axis weights.
 * @returns Weighted dynamic quality score [0.0, 100.0].
 */
export function computeDynamicQualityScore(
    vector: DynamicQualityVector,
    weights: Partial<Record<DynamicQualityAxis, number>> = {},
): number {
    const mergedWeights = { ...DEFAULT_DYNAMIC_WEIGHTS, ...weights };
    let weightSum = 0;
    let weightedScore = 0;

    for (const axis of ALL_DYNAMIC_QUALITY_AXES) {
        const axisWeight = mergedWeights[axis] ?? 0;
        weightSum += axisWeight;
        weightedScore += vector[axis] * axisWeight;
    }

    if (weightSum <= 0) return 0;
    return Math.round((weightedScore / weightSum) * SCORE_ROUNDING) / SCORE_ROUNDING;
}

/**
 * Calculates dynamic risk D_i for a specific runtime hotspot:
 * D_i = B_i * F_i * R_i * V_i
 *
 * @param hotspotIdOrParams - Identifier for the hotspot or direct risk parameters object.
 * @param maybeParams - Optional risk parameters when identifier is passed as first argument.
 * @returns Fully quantified DynamicIssueRisk.
 */
export function computeDynamicHotspotRisk(
    hotspotIdOrParams: string | DynamicRiskParams,
    maybeParams: DynamicRiskParams = {},
): DynamicIssueRisk {
    let hotspotId: string;
    let params: DynamicRiskParams;
    if (typeof hotspotIdOrParams === 'string') {
        hotspotId = hotspotIdOrParams;
        params = maybeParams;
    } else {
        params = hotspotIdOrParams ?? {};
        hotspotId = DEFAULT_HOTSPOT_ID;
    }
    const behavioralScope = Math.max(
        MIN_HOTSPOT_DIMENSION_SCORE,
        Math.min(
            MAX_HOTSPOT_DIMENSION_SCORE,
            params.behavioralScope ?? DEFAULT_HOTSPOT_DIMENSION_SCORE,
        ),
    );

    // Frequency factor F_i: log10(invocationsPerHour + 1)
    let frequencyFactor = params.frequencyFactor;
    if (frequencyFactor === undefined) {
        const invocationsPerHour = params.invocationsPerHour ?? DEFAULT_INVOCATIONS_PER_HOUR;
        frequencyFactor = Math.max(
            MIN_FREQUENCY_FACTOR,
            Math.min(MAX_NORMALIZED_RISK, Math.log10(invocationsPerHour + 1)),
        );
    } else {
        frequencyFactor = Math.max(
            MIN_FREQUENCY_FACTOR,
            Math.min(MAX_NORMALIZED_RISK, frequencyFactor),
        );
    }

    const resourceConsumption = Math.max(
        MIN_HOTSPOT_DIMENSION_SCORE,
        Math.min(
            MAX_NORMALIZED_RISK,
            params.resourceConsumption ?? DEFAULT_HOTSPOT_DIMENSION_SCORE,
        ),
    );
    const businessSensitivity = Math.max(
        MIN_HOTSPOT_DIMENSION_SCORE,
        Math.min(
            MAX_HOTSPOT_DIMENSION_SCORE,
            params.businessSensitivity ?? DEFAULT_HOTSPOT_DIMENSION_SCORE,
        ),
    );

    const rawRisk = behavioralScope * frequencyFactor * resourceConsumption * businessSensitivity;
    // Bounded normalization: 5 * 10 * 10 * 5 = 2500 max raw -> normalize to 0..10
    // scale with standard 0.01 precision
    const normalizedRisk = Math.min(
        MAX_NORMALIZED_RISK,
        Math.max(
            MIN_NORMALIZED_RISK,
            Math.round((rawRisk / RISK_NORMALIZATION_DIVISOR) * HUNDRED_PERCENT_MULTIPLIER) /
                HUNDRED_PERCENT_MULTIPLIER,
        ),
    );
    const hasEvidence =
        params.invocationsPerHour !== undefined || params.frequencyFactor !== undefined;
    const evidenceConfidence = hasEvidence ? FULL_CONFIDENCE : PARTIAL_CONFIDENCE;

    return {
        hotspotId,
        B: behavioralScope,
        F: Math.round(frequencyFactor * HUNDRED_PERCENT_MULTIPLIER) / HUNDRED_PERCENT_MULTIPLIER,
        R: resourceConsumption,
        V: businessSensitivity,
        rawRisk: Math.round(rawRisk * HUNDRED_PERCENT_MULTIPLIER) / HUNDRED_PERCENT_MULTIPLIER,
        normalizedRisk,
        evidenceConfidence,
    };
}
