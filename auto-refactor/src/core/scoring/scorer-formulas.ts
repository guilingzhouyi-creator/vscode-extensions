/**
 * Module: Core Engine — Quality Scorer Computation Formulas & Partitioning
 * File Path: src/core/scoring/scorer-formulas.ts
 * Architecture Role: Mathematical helpers and pure functional transformations for
 *   dimension evaluation, composite score weighting, grade resolution, and scale dampening.
 * Dependencies & Triggers: Consumes scoringTypes, dimensionDeductions, and types;
 *   called by QualityScorer.
 * Responsibilities:
 *   1. Resolve active and un-evaluated dimensions per ScanConfig.
 *   2. Group rationales and audit trail entries by quality dimension.
 *   3. Compute LOC-weighted composite score and measured weight coverage.
 *   4. Apply scale-normalized log dampening for large files.
 *   5. Calculate grade cutoffs and statistical confidence.
 * Exit Semantics & Design Rationale: Pure math functions; zero I/O; deterministic.
 */

import type { FileMetric, ScanConfig } from '../types';
import type {
    QualityDimension,
    QualityGrade,
    QualityScoreRationale,
    QualityWeights,
} from './scoringTypes';
import {
    ALL_QUALITY_DIMENSIONS,
    DIMENSION_ANALYZERS,
} from './scoringTypes';

/** Maximum clean score a quality dimension starts at before deductions. */
export const DIMENSION_MAX_SCORE = 100;
/** Letter-grade cut-offs on the 0-100 composite score: A+ minimum. */
export const GRADE_A_PLUS_MIN = 95;
/** Grade A minimum threshold. */
export const GRADE_A_MIN = 85;
/** Grade B minimum threshold. */
export const GRADE_B_MIN = 75;
/** Grade C minimum threshold. */
export const GRADE_C_MIN = 65;
/** Grade D minimum threshold. */
export const GRADE_D_MIN = 50;
/** Composite rounding: one decimal place. */
export const SCORE_ROUNDING = 10;
/** Confidence floor threshold. */
export const CONFIDENCE_FLOOR = 0.6;
/** Confidence line cap upper bound. */
export const CONFIDENCE_LINE_CAP = 300;
/** Confidence line scaling factor. */
export const CONFIDENCE_LINE_SCALE = 750;
/** Fallback metric size when a file has no metric entry. */
export const DEFAULT_METRIC_LINES = 50;
/** Percentage scale used when rounding confidence to two decimals. */
export const PERCENT_SCALE = 100;

/**
 * Determine which quality dimensions were evaluated under the given scan configuration.
 *
 * @param config - Optional ScanConfig to inspect enabled analyzers.
 * @returns Partitioned dimensions and active analyzer sets.
 */
export function calculateEvaluatedDimensions(config?: ScanConfig): {
    evaluatedBy: Partial<Record<QualityDimension, string[]>>;
    notEvaluated: QualityDimension[];
    evaluatedDimensions: QualityDimension[];
} {
    const evaluatedBy: Partial<Record<QualityDimension, string[]>> = {};
    for (const dim of ALL_QUALITY_DIMENSIONS) {
        evaluatedBy[dim] = DIMENSION_ANALYZERS[dim].filter((id) => {
            if (config === undefined) return true;
            const declaration = config.analyzers?.[id];
            return declaration !== undefined && declaration.enabled !== false;
        });
    }
    const notEvaluated = ALL_QUALITY_DIMENSIONS.filter(
        (dim) => (evaluatedBy[dim] ?? []).length === 0,
    );
    const evaluatedDimensions = ALL_QUALITY_DIMENSIONS.filter((dim) => !notEvaluated.includes(dim));
    return { evaluatedBy, notEvaluated, evaluatedDimensions };
}

/**
 * Aggregate deduction entries and net penalty points by quality dimension.
 *
 * @param rationales - Recorded rationale items from deduction applier.
 * @param deductionPoints - Net deduction points accumulated per dimension.
 * @returns Audit trail map partitioned by quality dimension.
 */
export function groupDeductionsByDimension(
    rationales: QualityScoreRationale[],
    deductionPoints: Record<QualityDimension, number>,
): Record<
    QualityDimension,
    { points: number; entries: { rule: string; points: number; reason: string }[] }
> {
    const deductionsByDimension = {} as Record<
        QualityDimension,
        { points: number; entries: { rule: string; points: number; reason: string }[] }
    >;
    for (const dim of ALL_QUALITY_DIMENSIONS) {
        deductionsByDimension[dim] = { points: 0, entries: [] };
    }
    for (const entry of rationales) {
        const bucket = deductionsByDimension[entry.dimension];
        const points = -entry.delta;
        bucket.points += points;
        bucket.entries.push({ rule: entry.rule ?? 'metric', points, reason: entry.reason });
    }
    for (const dim of ALL_QUALITY_DIMENSIONS) {
        deductionsByDimension[dim].points = deductionPoints[dim];
    }
    return deductionsByDimension;
}

/**
 * Calculate the weighted composite score and measured weight coverage.
 *
 * @param rawScores - Unweighted score per dimension (0-100).
 * @param evaluatedDimensions - List of active dimensions evaluated in scan.
 * @param weights - Scoring weight configuration.
 * @returns Composite score rounded to one decimal and coverage ratio.
 */
export function computeCompositeScore(
    rawScores: Record<QualityDimension, number>,
    evaluatedDimensions: QualityDimension[],
    weights: QualityWeights,
): { compositeScore: number; coverage: number } {
    let totalWeightedScore = 0;
    let totalWeight = 0;
    let overallWeight = 0;
    for (const dim of ALL_QUALITY_DIMENSIONS) {
        overallWeight += weights[dim];
    }
    for (const dim of evaluatedDimensions) {
        const w = weights[dim];
        totalWeightedScore += rawScores[dim] * w;
        totalWeight += w;
    }
    const compositeScore =
        Math.round((totalWeightedScore / (totalWeight || 1)) * SCORE_ROUNDING) / SCORE_ROUNDING;
    const coverage =
        overallWeight === 0
            ? 1
            : Math.round((totalWeight / overallWeight) * SCORE_ROUNDING) / SCORE_ROUNDING;
    return { compositeScore, coverage };
}

/**
 * Map a numeric composite score to a letter grade.
 *
 * @param compositeScore - Computed composite score (0-100).
 * @returns Matching QualityGrade ('A+' through 'F').
 */
export function resolveQualityGrade(compositeScore: number): QualityGrade {
    if (compositeScore >= GRADE_A_PLUS_MIN) return 'A+';
    if (compositeScore >= GRADE_A_MIN) return 'A';
    if (compositeScore >= GRADE_B_MIN) return 'B';
    if (compositeScore >= GRADE_C_MIN) return 'C';
    if (compositeScore >= GRADE_D_MIN) return 'D';
    return 'F';
}

/**
 * Compute statistical confidence adjusted for measured file size and coverage.
 *
 * @param metric - Computed file metric measurements.
 * @param coverage - Dimension coverage ratio (0-1).
 * @returns Confidence score clamped between floor and 1.
 */
export function calculateConfidence(
    metric: FileMetric | null | undefined,
    coverage: number,
): number {
    const lines = metric?.nonBlankLines ?? DEFAULT_METRIC_LINES;
    const baseConfidence = Math.min(
        1.0,
        Math.max(
            CONFIDENCE_FLOOR,
            Math.round(
                (CONFIDENCE_FLOOR + Math.min(lines, CONFIDENCE_LINE_CAP) / CONFIDENCE_LINE_SCALE) *
                    PERCENT_SCALE,
            ) / PERCENT_SCALE,
        ),
    );
    return (
        Math.round(Math.max(CONFIDENCE_FLOOR, Number(baseConfidence) * coverage) * PERCENT_SCALE) /
        PERCENT_SCALE
    );
}

/**
 * Computes scores across all dimensions applying scale-normalized log dampening for large files.
 *
 * @param deductionPoints - Net penalty points per dimension.
 * @param scaleFactor - Ratio of file lines to baseline (100 LOC).
 * @returns Dimension scores mapped in [0, 100].
 */
export function applyScaleDampedScores(
    deductionPoints: Record<QualityDimension, number>,
    scaleFactor: number,
): Record<QualityDimension, number> {
    const rawScores = {} as Record<QualityDimension, number>;
    for (const dim of ALL_QUALITY_DIMENSIONS) {
        const rawPoints = deductionPoints[dim];
        if (rawPoints <= 0) {
            rawScores[dim] = DIMENSION_MAX_SCORE;
            continue;
        }
        if (scaleFactor <= 1 || dim === 'codeSecurity') {
            rawScores[dim] = Math.max(0, DIMENSION_MAX_SCORE - rawPoints);
        } else {
            const density = rawPoints / scaleFactor;
            const effectivePenalty = Math.min(
                rawPoints,
                Math.round(DIMENSION_MAX_SCORE * (1 - Math.exp(-density / 40))),
            );
            rawScores[dim] = Math.max(0, DIMENSION_MAX_SCORE - effectivePenalty);
        }
    }
    return rawScores;
}

/**
 * Accumulates LOC-weighted raw scores and rationales across all file metrics.
 *
 * @param fileQualityScores - Map of file path to individual QualityScoreBreakdown.
 * @param fileMetrics - Per-file metric records of this scan.
 * @returns Aggregated raw scores, total weight, and collected rationales.
 */
export function accumulateProjectMetrics(
    fileQualityScores: Record<string, import('./scoringTypes').QualityScoreBreakdown>,
    fileMetrics: FileMetric[],
): {
    rawScores: Record<QualityDimension, number>;
    totalWeight: number;
    allRationales: QualityScoreRationale[];
} {
    const rawScores = {} as Record<QualityDimension, number>;
    for (const dim of ALL_QUALITY_DIMENSIONS) {
        rawScores[dim] = 0;
    }
    let totalWeight = 0;
    const allRationales: QualityScoreRationale[] = [];

    for (const m of fileMetrics) {
        const fScore = fileQualityScores[m.file];
        if (!fScore) continue;

        const weight = Math.max(1, m.nonBlankLines || m.lines || 1);
        totalWeight += weight;

        for (const dim of ALL_QUALITY_DIMENSIONS) {
            const dimScore = fScore.indices[dim] ?? DIMENSION_MAX_SCORE;
            rawScores[dim] += dimScore * weight;
        }

        if (fScore.rationales) {
            allRationales.push(...fScore.rationales);
        }
    }

    return { rawScores, totalWeight, allRationales };
}
