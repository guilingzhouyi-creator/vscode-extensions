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
    QualityScoreBreakdown,
    QualityScoreRationale,
    QualityWeights,
} from './scoringTypes';
import {
    ALL_QUALITY_DIMENSIONS,
    DEFAULT_QUALITY_WEIGHTS,
} from './scoringTypes';
import {
    FAMILY_DIMENSIONS,
    applyIssueDeductions,
    applyMetricDeductions,
} from './dimensionDeductions';
import {
    DIMENSION_MAX_SCORE,
    GRADE_A_PLUS_MIN,
    GRADE_A_MIN,
    GRADE_B_MIN,
    GRADE_C_MIN,
    GRADE_D_MIN,
    SCORE_ROUNDING,
    calculateEvaluatedDimensions,
    groupDeductionsByDimension,
    computeCompositeScore,
    resolveQualityGrade,
    calculateConfidence,
    applyScaleDampedScores,
    accumulateProjectMetrics,
} from './scorer-formulas';

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

        const lines = metric?.nonBlankLines ?? (metric?.lines ?? 100);
        const scaleFactor = Math.max(1, lines / 100);

        const rawScores = applyScaleDampedScores(deductionPoints, scaleFactor);
        for (const dim of ALL_QUALITY_DIMENSIONS) {
            deductionPoints[dim] = DIMENSION_MAX_SCORE - rawScores[dim];
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

    /**
     * Evaluate the project-level quality score breakdown by aggregating file quality scores
     * using code line weights (LOC-weighted micro-average), avoiding floor-clamping saturation.
     *
     * @param fileQualityScores - Map of file path to individual QualityScoreBreakdown.
     * @param fileMetrics - Per-file metric records of this scan.
     * @param config - Optional ScanConfig to identify enabled analyzers.
     * @param allIssues - Optional full list of scan issues for fallback.
     * @returns Aggregated project quality score breakdown.
     */
    evaluateProject(
        fileQualityScores: Record<string, QualityScoreBreakdown>,
        fileMetrics: FileMetric[],
        config?: ScanConfig,
        allIssues?: Issue[],
    ): QualityScoreBreakdown {
        const fileCount = Object.keys(fileQualityScores).length;
        if (fileCount === 0 || fileMetrics.length === 0) {
            return this.evaluateFile('PROJECT_OVERALL', allIssues ?? [], null, config);
        }

        const { rawScores, totalWeight, allRationales } = accumulateProjectMetrics(
            fileQualityScores,
            fileMetrics,
        );

        const deductionPoints = {} as Record<QualityDimension, number>;
        const divisor = totalWeight || 1;
        for (const dim of ALL_QUALITY_DIMENSIONS) {
            const weightedScore = rawScores[dim] / divisor;
            rawScores[dim] = Math.round(weightedScore * SCORE_ROUNDING) / SCORE_ROUNDING;
            deductionPoints[dim] = Math.max(0, DIMENSION_MAX_SCORE - rawScores[dim]);
        }

        allRationales.sort((a, b) => a.delta - b.delta);

        const { evaluatedBy, notEvaluated, evaluatedDimensions } =
            calculateEvaluatedDimensions(config);
        const deductionsByDimension = groupDeductionsByDimension(allRationales, deductionPoints);
        const { compositeScore, coverage } = computeCompositeScore(
            rawScores,
            evaluatedDimensions,
            this.weights,
        );
        const grade = resolveQualityGrade(compositeScore);
        const confidence = calculateConfidence(
            { nonBlankLines: totalWeight } as FileMetric,
            coverage,
        );

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
            rationales: allRationales.slice(0, 10),
            evaluatedAt: Date.now(),
        };
    }
}
