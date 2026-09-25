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
export function evaluateDynamicCompleteness(
    dto: DynamicEvidenceDTO,
): DynamicCompletenessResult {
    const observed: DynamicQualityAxis[] = [];
    if (dto.latency !== undefined) observed.push('L');
    if (dto.throughput !== undefined) observed.push('T');
    if (dto.memory !== undefined) observed.push('M');
    if (dto.concurrency !== undefined) observed.push('C');
    if (dto.execution !== undefined) observed.push('E');

    const completeness = Math.round((observed.length / 5.0) * 100) / 100;
    const confidenceFactor = Math.max(0.2, completeness);

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
    const p99 = lat.p99Ms ?? 15.0;
    const budget = lat.budgetMs ?? 16.67;
    let scoreL = 100.0;
    if (p99 > budget) {
        const overshoot = (p99 - budget) / budget;
        scoreL = 100.0 * Math.exp(-0.8 * overshoot);
    }
    return Math.max(0.0, Math.min(100.0, scoreL));
}

/**
 * Evaluates Throughput (T) score from telemetry or defaults to prior score.
 */
function evaluateThroughputScore(dto: DynamicEvidenceDTO, priorScore: number): number {
    if (dto.throughput === undefined) return priorScore;
    const thr = dto.throughput;
    const ops = thr.opsPerSec ?? 1000;
    const targetOps = thr.targetOpsPerSec ?? 1000;
    return targetOps > 0 ? Math.max(0.0, Math.min(100.0, (ops / targetOps) * 100.0)) : 100.0;
}

/**
 * Evaluates Memory and GC (M) score from telemetry or defaults to prior score.
 */
function evaluateMemoryScore(dto: DynamicEvidenceDTO, priorScore: number): number {
    if (dto.memory === undefined) return priorScore;
    const mem = dto.memory;
    let scoreM = 100.0;
    if ((mem.detectedLeakBytes ?? 0) > 0) {
        scoreM -= 50.0;
    }
    if ((mem.gcTotalPauseMs ?? 0) > 100.0) {
        const pauseExcess = (mem.gcTotalPauseMs! - 100.0) / 100.0;
        scoreM -= Math.min(30.0, pauseExcess * 15.0);
    }
    if ((mem.allocationRateBytesPerSec ?? 0) > 20 * 1024 * 1024) {
        scoreM -= 15.0;
    }
    return Math.max(0.0, Math.min(100.0, scoreM));
}

/**
 * Evaluates Concurrency (C) score from telemetry or defaults to prior score.
 */
function evaluateConcurrencyScore(dto: DynamicEvidenceDTO, priorScore: number): number {
    if (dto.concurrency === undefined) return priorScore;
    const con = dto.concurrency;
    if (con.deadlockDetected) {
        return 0.0;
    }
    const contention = Math.max(0.0, Math.min(1.0, con.contentionRatio ?? 0.0));
    return Math.max(0.0, Math.min(100.0, 100.0 * (1.0 - contention)));
}

/**
 * Evaluates Execution Evidence Depth (E) score from telemetry or defaults to prior score.
 */
function evaluateExecutionScore(dto: DynamicEvidenceDTO, priorScore: number): number {
    if (dto.execution === undefined) return priorScore;
    const exec = dto.execution;
    const lineCov = Math.max(0.0, Math.min(100.0, exec.lineCoveragePct ?? 0.0));
    const branchCov = Math.max(0.0, Math.min(100.0, exec.branchCoveragePct ?? lineCov));
    const calls = exec.callCount ?? 0;
    const callDepthFactor =
        calls > 0 ? Math.min(1.0, Math.log10(calls + 1) / 4.0) : lineCov > 0 ? 0.85 : 0.2;
    return Math.max(0.0, Math.min(100.0, (lineCov * 0.6 + branchCov * 0.4) * callDepthFactor));
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
    priorScore = 100.0,
): DynamicQualityVector {
    const scoreL = evaluateLatencyScore(dto, priorScore);
    const scoreT = evaluateThroughputScore(dto, priorScore);
    const scoreM = evaluateMemoryScore(dto, priorScore);
    const scoreC = evaluateConcurrencyScore(dto, priorScore);
    const scoreE = evaluateExecutionScore(dto, priorScore);

    return {
        L: Math.round(scoreL * 10) / 10,
        T: Math.round(scoreT * 10) / 10,
        M: Math.round(scoreM * 10) / 10,
        C: Math.round(scoreC * 10) / 10,
        E: Math.round(scoreE * 10) / 10,
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
        const w = mergedWeights[axis] ?? 0;
        weightSum += w;
        weightedScore += vector[axis] * w;
    }

    if (weightSum <= 0) return 0;
    return Math.round((weightedScore / weightSum) * 10) / 10;
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
        hotspotId = 'hotspot-dynamic';
    }
    const B = Math.max(1.0, Math.min(5.0, params.behavioralScope ?? 2.0));

    // Frequency factor F_i: log10(invocationsPerHour + 1)
    let F = params.frequencyFactor;
    if (F === undefined) {
        const inv = params.invocationsPerHour ?? 3600;
        F = Math.max(0.1, Math.min(10.0, Math.log10(inv + 1)));
    } else {
        F = Math.max(0.1, Math.min(10.0, F));
    }

    const R = Math.max(1.0, Math.min(10.0, params.resourceConsumption ?? 2.0));
    const V = Math.max(1.0, Math.min(5.0, params.businessSensitivity ?? 2.0));

    const rawRisk = B * F * R * V;
    // Bounded normalization: 5 * 10 * 10 * 5 = 2500 max raw -> normalize to 0..10 scale
    const normalizedRisk = Math.min(10.0, Math.round((rawRisk / 250.0) * 100) / 10);
    const hasEvidence =
        params.invocationsPerHour !== undefined || params.frequencyFactor !== undefined;
    const evidenceConfidence = hasEvidence ? 1.0 : 0.6;



    return {
        hotspotId,
        B,
        F: Math.round(F * 100) / 100,
        R,
        V,
        rawRisk: Math.round(rawRisk * 100) / 100,
        normalizedRisk,
        evidenceConfidence,
    };
}
