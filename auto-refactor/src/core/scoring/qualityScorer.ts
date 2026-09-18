/**
 * Module: Core Engine — Transparent Multi-Dimensional Quality Scoring
 * File Path: src/core/scoring/qualityScorer.ts
 * Architecture Role: In-memory scoring layer that converts analyzer Issue[] output and
 *   FileMetric data into an auditable QualityScoreBreakdown for reports and memory.
 * Dependencies & Triggers: Imports Issue, FileMetric, and ScanConfig from ../types,
 *   ScoringRationales from ../messages, and dimension contracts from ./scoringTypes;
 *   invoked by Analyzer scans, the dual-track pipeline, and callers of evaluateQualityScore.
 * Responsibilities: Merge optional partial weights over DEFAULT_QUALITY_WEIGHTS; orchestrate
 *   dimension deductions across issues and metrics; compute the weighted composite score,
 *   quality grade, and statistical confidence; and publish auditable rationales.
 * Exit Semantics & Design Rationale: Pure computation with no I/O and no throw paths;
 *   unmatched analyzer/rule combinations fall through to generic or zero deductions;
 *   every deduction records a rationale so output stays explainable, not black-box.
 */
import type { Issue, FileMetric, ScanConfig } from '../types';
import type {
    QualityDimension,
    QualityGrade,
    QualityScoreBreakdown,
    QualityScoreRationale,
    QualityWeights,
} from './scoringTypes';
import {
    ALL_QUALITY_DIMENSIONS,
    DEFAULT_QUALITY_WEIGHTS,
    DIMENSION_ANALYZERS,
} from './scoringTypes';
import {
    FAMILY_DIMENSIONS,
    applyIssueDeductions,
    applyMetricDeductions,
} from './dimensionDeductions';

/** Maximum clean score a quality dimension starts at before deductions. */
const DIMENSION_MAX_SCORE = 100;
/** Letter-grade cut-offs on the 0-100 composite score. */
const GRADE_A_PLUS_MIN = 95;
const GRADE_A_MIN = 85;
const GRADE_B_MIN = 75;
const GRADE_C_MIN = 65;
const GRADE_D_MIN = 50;
/** Composite rounding: one decimal place. */
const SCORE_ROUNDING = 10;
/** Confidence model: floor, line cap, and the scale that maps lines onto 0..1. */
const CONFIDENCE_FLOOR = 0.6;
const CONFIDENCE_LINE_CAP = 300;
const CONFIDENCE_LINE_SCALE = 750;
/** Fallback metric size when a file has no metric entry. */
const DEFAULT_METRIC_LINES = 50;
/** Percentage scale used when rounding confidence to two decimals. */
const PERCENT_SCALE = 100;

/**
 * Determine which quality dimensions were evaluated under the given scan configuration.
 *
 * @param config - Optional ScanConfig to inspect enabled analyzers.
 * @returns Partitioned dimensions and active analyzer sets.
 */
function calculateEvaluatedDimensions(config?: ScanConfig): {
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
function groupDeductionsByDimension(
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
function computeCompositeScore(
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
function resolveQualityGrade(compositeScore: number): QualityGrade {
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
function calculateConfidence(metric: FileMetric | null | undefined, coverage: number): number {
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
 * Transparent Multi-Dimensional Quality Scorer.
 * Implements auditable scoring across 10 dimensions with zero black-box magic numbers.
 */
export class QualityScorer {
    private weights: QualityWeights;

    constructor(customWeights?: Partial<QualityWeights>) {
        this.weights = { ...DEFAULT_QUALITY_WEIGHTS, ...(customWeights || {}) };
    }

    /**
     * Evaluate the transparent quality breakdown for a single file.
     *
     * @param filePath - Path to the audited file.
     * @param issues - Detected issues for this file.
     * @param metric - Optional precomputed lexical file metric.
     * @param config - Optional ScanConfig to identify enabled analyzers.
     * @returns Complete auditable quality score breakdown.
     */
    evaluateFile(
        filePath: string,
        issues: Issue[],
        metric?: FileMetric | null,
        config?: ScanConfig,
    ): QualityScoreBreakdown {
        const rawScores: Record<QualityDimension, number> = {
            architectureConsistency: DIMENSION_MAX_SCORE,
            semanticPurity: DIMENSION_MAX_SCORE,
            codeSecurity: DIMENSION_MAX_SCORE,
            performanceEfficiency: DIMENSION_MAX_SCORE,
            standardization: DIMENSION_MAX_SCORE,
            modernity: DIMENSION_MAX_SCORE,
            maintainability: DIMENSION_MAX_SCORE,
            commentQuality: DIMENSION_MAX_SCORE,
            duplication: DIMENSION_MAX_SCORE,
            techDebtRisk: DIMENSION_MAX_SCORE,
        };

        const rationales: QualityScoreRationale[] = [];
        const deductionPoints = {} as Record<QualityDimension, number>;
        for (const dim of ALL_QUALITY_DIMENSIONS) {
            deductionPoints[dim] = 0;
        }

        const applyDeduction = (
            dim: QualityDimension,
            points: number,
            reason: string,
            rule?: string,
            line?: number,
        ) => {
            deductionPoints[dim] += points;
            rawScores[dim] = Math.max(0, rawScores[dim] - points);
            rationales.push({
                dimension: dim,
                delta: -points,
                reason,
                rule,
                line,
            });
        };

        for (const issue of issues) {
            applyIssueDeductions(issue, applyDeduction);
        }

        if (metric) {
            applyMetricDeductions(metric, applyDeduction);
        }

        const { evaluatedBy, notEvaluated, evaluatedDimensions } =
            calculateEvaluatedDimensions(config);
        const deductionsByDimension = groupDeductionsByDimension(rationales, deductionPoints);
        const { compositeScore, coverage } = computeCompositeScore(
            rawScores,
            evaluatedDimensions,
            this.weights,
        );
        const grade = resolveQualityGrade(compositeScore);
        const confidence = calculateConfidence(metric, coverage);

        return {
            indices: rawScores,
            compositeScore,
            grade,
            confidence,
            weights: { ...this.weights },
            formulas: {
                composite:
                    'sum(indices[d] * weights[d] for d in evaluated) / sum(weights[d] for d in evaluated)',
                coverage: 'sum(weights[d] for d in evaluated) / sum(weights[d] for all dimensions)',
                confidence: 'clamp(baseConfidenceFromLines * coverage, floor, 1)',
                gradeCutoffs: [
                    { grade: 'A+', min: GRADE_A_PLUS_MIN },
                    { grade: 'A', min: GRADE_A_MIN },
                    { grade: 'B', min: GRADE_B_MIN },
                    { grade: 'C', min: GRADE_C_MIN },
                    { grade: 'D', min: GRADE_D_MIN },
                ],
                dimensionWeights: { ...this.weights },
                familyDimensions: { ...FAMILY_DIMENSIONS },
            },
            notEvaluated,
            coverage,
            deductionsByDimension,
            evaluatedBy,
            rationales,
            evaluatedAt: Date.now(),
        };
    }
}
