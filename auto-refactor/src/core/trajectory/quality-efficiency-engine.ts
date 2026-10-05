/**
 * Module: Core Trajectory — Quality Evolution & Efficiency Engine
 * File Path: src/core/trajectory/quality-efficiency-engine.ts
 * Architecture Role: Computes mathematical efficiency indices (QED, ReviewYield, RegressionDensity)
 *   and anti-gaming metrics over multi-tier ELOC and 10-dimensional quality score vectors.
 * Dependencies & Triggers: Consumes eloc-types and scoringTypes; called by composite gate,
 *   review runner, and trajectory compactor.
 * Responsibilities: Compute QED, review yield, regression density, and anti-gaming penalties
 *   across 10-dimensional quality score vectors.
 * Exit Semantics & Design Rationale: Pure mathematical calculations; zero I/O; deterministic,
 *   finite bounds, and free of division-by-zero errors.
 */

import type { ElocCounters, TechnicalDebtDelta, TrajectoryQualityMetrics } from './eloc-types';
import {
    ALL_QUALITY_DIMENSIONS,
    DEFAULT_QUALITY_WEIGHTS,
    type QualityDimension,
} from '../scoring/scoringTypes';

/**
 * Converts a 10-dimensional Quality Score Record to an ordered float array.
 *
 * @param record - Partial or complete map of dimension scores.
 * @returns Ordered array matching ALL_QUALITY_DIMENSIONS canonical ordering.
 */
export function recordToVector(record: Partial<Record<QualityDimension, number>>): number[] {
    return ALL_QUALITY_DIMENSIONS.map((dim) => {
        const val = record[dim];
        return typeof val === 'number' && Number.isFinite(val)
            ? Math.max(0, Math.min(100, val))
            : 100;
    });
}

/**
 * Converts an ordered float array back to a 10-dimensional Quality Score Record.
 *
 * @param vector - 10-element float array.
 * @returns Map matching ALL_QUALITY_DIMENSIONS.
 */
export function vectorToRecord(vector: number[]): Record<QualityDimension, number> {
    const record = {} as Record<QualityDimension, number>;
    for (let i = 0; i < ALL_QUALITY_DIMENSIONS.length; i++) {
        const dim = ALL_QUALITY_DIMENSIONS[i];
        record[dim] = vector[i] ?? 100;
    }
    return record;
}

/**
 * Computes composite score from a 10-dimensional score vector using default or custom weights.
 *
 * @param vector - 10-element score array.
 * @param weights - Optional custom weights map.
 * @returns Composite weighted score in 0.0 - 100.0.
 */
export function computeCompositeFromVector(
    vector: number[],
    weights: Partial<Record<QualityDimension, number>> = DEFAULT_QUALITY_WEIGHTS,
): number {
    let weightedSum = 0;
    let totalWeight = 0;

    for (let i = 0; i < ALL_QUALITY_DIMENSIONS.length; i++) {
        const dim = ALL_QUALITY_DIMENSIONS[i];
        const w = weights[dim] ?? DEFAULT_QUALITY_WEIGHTS[dim] ?? 0.1;
        const val = vector[i] ?? 100;
        weightedSum += val * w;
        totalWeight += w;
    }

    if (totalWeight === 0) return 100;
    return Math.round((weightedSum / totalWeight) * 100) / 100;
}

/**
 * Evaluates whether a refactoring or patch is an anti-gaming superficial churn.
 *
 * @param counters - Multi-tier ELOC counters.
 * @param debtDelta - Technical debt delta.
 * @returns Calculated penalty score (0.0 means no penalty).
 */
export function calculateAntiGamingPenalty(
    counters: ElocCounters,
    debtDelta: TechnicalDebtDelta,
): number {
    if (counters.changed >= 30 && debtDelta.netDebtCleared <= 0) {
        const semanticRatio = counters.semantic / Math.max(1, counters.changed);
        if (semanticRatio < 0.15) {
            const churnFactor = (0.15 - semanticRatio) / 0.15;
            return Math.round(churnFactor * 10 * 100) / 100;
        }
    }
    return 0;
}

/**
 * Calculates per-dimension deltas between after and before score vectors.
 */
function computeDimensionDeltas(
    scoreVector: number[],
    beforeVector?: number[],
): Partial<Record<QualityDimension, number>> {
    const baseVector = beforeVector ?? scoreVector;
    const dimensionDeltas: Partial<Record<QualityDimension, number>> = {};
    for (let i = 0; i < ALL_QUALITY_DIMENSIONS.length; i++) {
        const dim = ALL_QUALITY_DIMENSIONS[i];
        const afterVal = scoreVector[i] ?? 100;
        const beforeVal = baseVector[i] ?? afterVal;
        const delta = Math.round((afterVal - beforeVal) * 100) / 100;
        if (delta !== 0) {
            dimensionDeltas[dim] = delta;
        }
    }
    return dimensionDeltas;
}

/**
 * Computes comprehensive trajectory quality metrics from Before/After states and ELOC counters.
 *
 * @param params - Input parameters for quality trajectory evaluation.
 * @param params.beforeScore - Baseline composite score before run.
 * @param params.afterScore - Composite score after run.
 * @param params.scoreVector - 10-dimensional score vector after run.
 * @param params.beforeVector - 10-dimensional score vector before run.
 * @param params.counters - Four-tier orthogonal ELOC counters.
 * @param params.debtDelta - Technical debt additions and resolutions.
 * @returns Fully computed TrajectoryQualityMetrics record.
 */
export function computeTrajectoryQualityMetrics(params: {
    beforeScore: number;
    afterScore: number;
    scoreVector: number[];
    beforeVector?: number[];
    counters: ElocCounters;
    debtDelta?: Partial<TechnicalDebtDelta>;
    sliceDeltaQ?: number;
}): TrajectoryQualityMetrics {
    const { beforeScore, afterScore, scoreVector, beforeVector, counters } = params;

    const debtDelta: TechnicalDebtDelta = {
        addedDebtPoints: params.debtDelta?.addedDebtPoints ?? 0,
        resolvedDebtPoints: params.debtDelta?.resolvedDebtPoints ?? 0,
        netDebtCleared:
            params.debtDelta?.netDebtCleared ??
            (params.debtDelta?.resolvedDebtPoints ?? 0) - (params.debtDelta?.addedDebtPoints ?? 0),
        regressionFindingsCount: params.debtDelta?.regressionFindingsCount ?? 0,
        regressionFindingIds: params.debtDelta?.regressionFindingIds ?? [],
    };

    const unroundedDelta =
        typeof params.sliceDeltaQ === 'number' && params.sliceDeltaQ !== 0
            ? params.sliceDeltaQ
            : afterScore - beforeScore;
    const rawDeltaQ = Math.round(unroundedDelta * 10000) / 10000;

    // Mathematical Anti-Gaming Rule: If semantic ELOC is 0 but changed > 0,
    // positive rawDeltaQ is suppressed.
    let deltaQSemantic = rawDeltaQ;
    if (counters.semantic === 0 && counters.changed > 0 && rawDeltaQ > 0) {
        deltaQSemantic = 0;
    }

    // 1. QED = ΔQ_semantic / max(1, ELOC_semantic)
    const effectiveSemanticEloc = Math.max(1, counters.semantic);
    const qed = Math.round((deltaQSemantic / effectiveSemanticEloc) * 10000) / 10000;

    // 2. ReviewYield = (Debt_net + max(0, ΔQ_semantic)) / max(1, ELOC_processed / 1000)
    const processedKiloEloc = Math.max(1, counters.processed / 1000);
    const positiveDeltaQ = Math.max(0, deltaQSemantic);
    const reviewYield =
        Math.round(((debtDelta.netDebtCleared + positiveDeltaQ) / processedKiloEloc) * 100) / 100;

    // 3. RegressionDensity = RegressionFindings / max(0.001, ELOC_semantic / 1000)
    const semanticKiloEloc = Math.max(0.001, counters.semantic / 1000);
    const regressionDensity =
        Math.round((debtDelta.regressionFindingsCount / semanticKiloEloc) * 100) / 100;

    // 4. Dimension Deltas & Anti-Gaming Penalty
    const dimensionDeltas = computeDimensionDeltas(scoreVector, beforeVector);
    const gamingPenalty = calculateAntiGamingPenalty(counters, debtDelta);

    return {
        qed,
        reviewYield,
        regressionDensity,
        deltaQSemantic,
        beforeScore,
        afterScore,
        scoreVector,
        dimensionDeltas,
        debtDelta,
        gamingPenalty,
    };
}
