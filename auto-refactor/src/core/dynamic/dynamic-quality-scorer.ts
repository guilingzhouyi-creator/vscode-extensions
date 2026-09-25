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
 * Computes the 5-dimensional DynamicQualityVector Q_d = (L, T, M, C, E) from telemetry DTO.
 *
 * @param dto - Ingested DynamicEvidenceDTO telemetry snapshot.
 * @returns Bounded DynamicQualityVector with values scaled between 0.0 and 100.0.
 */
export function computeDynamicQualityVector(dto: DynamicEvidenceDTO): DynamicQualityVector {
    // 1. Latency Score (L)
    const lat = dto.latency ?? {};
    const p99 = lat.p99Ms ?? 15.0;
    const budget = lat.budgetMs ?? 16.67;
    let scoreL = 100.0;
    if (p99 > budget) {
        const overshoot = (p99 - budget) / budget;
        scoreL = 100.0 * Math.exp(-0.8 * overshoot);
    }
    scoreL = Math.max(0.0, Math.min(100.0, scoreL));

    // 2. Throughput Score (T)
    const thr = dto.throughput ?? {};
    const ops = thr.opsPerSec ?? 1000;
    const targetOps = thr.targetOpsPerSec ?? 1000;
    const scoreT =
        targetOps > 0 ? Math.max(0.0, Math.min(100.0, (ops / targetOps) * 100.0)) : 100.0;

    // 3. Memory & GC Score (M)
    const mem = dto.memory ?? {};
    let scoreM = 100.0;
    if ((mem.detectedLeakBytes ?? 0) > 0) {
        // Severe progressive leak penalty
        scoreM -= 50.0;
    }
    if ((mem.gcTotalPauseMs ?? 0) > 100.0) {
        // High GC pause time penalty
        const pauseExcess = (mem.gcTotalPauseMs! - 100.0) / 100.0;
        scoreM -= Math.min(30.0, pauseExcess * 15.0);
    }
    if ((mem.allocationRateBytesPerSec ?? 0) > 20 * 1024 * 1024) {
        // Excessive transient allocation penalty (>20MB/s)
        scoreM -= 15.0;
    }
    scoreM = Math.max(0.0, Math.min(100.0, scoreM));

    // 4. Concurrency Score (C)
    const con = dto.concurrency ?? {};
    let scoreC = 100.0;
    if (con.deadlockDetected) {
        scoreC = 0.0;
    } else {
        const contention = Math.max(0.0, Math.min(1.0, con.contentionRatio ?? 0.0));
        scoreC = 100.0 * (1.0 - contention);
    }
    scoreC = Math.max(0.0, Math.min(100.0, scoreC));

    // 5. Execution Evidence Depth (E)
    const exec = dto.execution ?? {};
    const lineCov = Math.max(0.0, Math.min(100.0, exec.lineCoveragePct ?? 0.0));
    const branchCov = Math.max(0.0, Math.min(100.0, exec.branchCoveragePct ?? lineCov));
    const calls = exec.callCount ?? 0;
    const callDepthFactor = calls > 0 ? Math.min(1.0, Math.log10(calls + 1) / 4.0) : 0.2;
    const scoreE = Math.max(
        0.0,
        Math.min(100.0, (lineCov * 0.6 + branchCov * 0.4) * callDepthFactor),
    );

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
 * @param hotspotId - Identifier for the hotspot / call trace.
 * @param params - Risk parameters (B, F, R, V).
 * @returns Fully quantified DynamicIssueRisk.
 */
export function computeDynamicHotspotRisk(
    hotspotId: string,
    params: DynamicRiskParams = {},
): DynamicIssueRisk {
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
