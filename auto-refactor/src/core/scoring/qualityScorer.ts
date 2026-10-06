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
import type { Issue, FileMetric, ScanConfig, ProjectArchetype } from '../types';
import type {
    QualityDimension,
    QualityScoreBreakdown,
    QualityScoreRationale,
    QualityWeights,
    QualityReviewProfile,
} from './scoringTypes';
import {
    ALL_QUALITY_DIMENSIONS,
    DEFAULT_QUALITY_WEIGHTS,
    DIMENSION_SCALE_MODE,
} from './scoringTypes';
import {
    FAMILY_DIMENSIONS,
    applyIssueDeductions,
    applyMetricDeductions,
    type IssueDeductionOptions,
} from './dimensionDeductions';
import { ArchetypeWeightTuner } from './archetype-weight-tuner';
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
    calculateConfidenceFromVolume,
    applyScaleDampedScores,
    effectivePenaltyFromIndex,
    SATURATION_HALFPOINT,
    accumulateProjectMetrics,
} from './scorer-formulas';

/** Files named in the skipped-file warning before the list is truncated. */
const SKIPPED_FILE_DETAIL_LIMIT = 5;

/**
 * Transparent Multi-Dimensional Quality Scorer.
 * Implements auditable scoring across 10 dimensions with zero black-box magic numbers.
 */
export class QualityScorer {
    private weights: QualityWeights;
    private hasExplicitCustomWeights: boolean;
    private tuner: ArchetypeWeightTuner;

    constructor(
        customWeights?: Partial<QualityWeights>,
        archetype?: ProjectArchetype | QualityReviewProfile,
    ) {
        this.tuner = new ArchetypeWeightTuner();
        this.hasExplicitCustomWeights = !!customWeights && Object.keys(customWeights).length > 0;
        const base = { ...DEFAULT_QUALITY_WEIGHTS, ...(customWeights || {}) };
        this.weights = archetype ? this.tuner.tuneWeights(archetype, base) : base;
    }

    /**
     * Evaluate the transparent quality breakdown for a single file.
     *
     * @param filePath - Path to the audited file.
     * @param issues - Detected issues for this file.
     * @param metric - Optional precomputed lexical file metric.
     * @param config - Optional ScanConfig to identify enabled analyzers.
     * @param options - Optional deduction control settings and penalty adjustment
     *   options (e.g. literal deduction suppression, evolutionary multipliers, and
     *   compounding dampening).
     * @returns Complete auditable quality score breakdown.
     */
    evaluateFile(
        filePath: string,
        issues: Issue[],
        metric?: FileMetric | null,
        config?: ScanConfig,
        options?: IssueDeductionOptions,
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
            applyIssueDeductions(issue, applyDeduction, options);
        }

        if (metric) {
            applyMetricDeductions(metric, applyDeduction);
        }

        const lines = metric?.nonBlankLines ?? metric?.lines ?? 100;
        const scaleFactor = Math.max(1, lines / 100);

        // Snapshot the linear totals before the curve consumes them: the index curve is not
        // invertible from the index alone, so the report has to carry both.
        const linearPoints = { ...deductionPoints };
        const rawScores = applyScaleDampedScores(deductionPoints, scaleFactor);
        const effectivePoints = {} as Record<QualityDimension, number>;
        for (const dim of ALL_QUALITY_DIMENSIONS) {
            effectivePoints[dim] = effectivePenaltyFromIndex(rawScores[dim]);
            deductionPoints[dim] = DIMENSION_MAX_SCORE - rawScores[dim];
        }

        const { evaluatedBy, notEvaluated, evaluatedDimensions } =
            calculateEvaluatedDimensions(config);
        const deductionsByDimension = groupDeductionsByDimension(
            rationales,
            linearPoints,
            effectivePoints,
        );

        const effectiveWeights =
            config?.archetype && !this.hasExplicitCustomWeights
                ? this.tuner.tuneWeights(config.archetype, this.weights)
                : this.weights;

        const { compositeScore, coverage } = computeCompositeScore(
            rawScores,
            evaluatedDimensions,
            effectiveWeights,
        );
        const grade = resolveQualityGrade(compositeScore);
        const confidence = calculateConfidence(metric, coverage);

        return {
            indices: rawScores,
            compositeScore,
            grade,
            confidence,
            weights: { ...effectiveWeights },
            formulas: {
                indexMapping:
                    'density dims: index = 100 * H / (H + linearPoints / scaleFactor), H = ' +
                    `${SATURATION_HALFPOINT}; absolute dims: index = max(0, 100 - linearPoints)`,
                saturationHalfpoint: SATURATION_HALFPOINT,
                dimensionScaleMode: { ...DIMENSION_SCALE_MODE },
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

        const { rawScores, totalWeight, allRationales, skippedFiles } = accumulateProjectMetrics(
            fileQualityScores,
            fileMetrics,
        );
        let skippedFileWarning: string | undefined;

        if (skippedFiles.length > 0) {
            // Surfaced rather than swallowed: a file that leaves the project aggregate but
            // stays in `filesScanned` biases the composite downward with no visible cause.
            // Published on the breakdown so any consumer of the report can see it.
            skippedFileWarning =
                `quality: ${skippedFiles.length} file(s) had metrics but no quality score and ` +
                `were excluded from the project aggregate: ${skippedFiles
                    .slice(0, SKIPPED_FILE_DETAIL_LIMIT)
                    .join(', ')}${skippedFiles.length > SKIPPED_FILE_DETAIL_LIMIT ? ', …' : ''}`;
        }

        // At project level the per-file indices are already curve-shaped, so the linear
        // and effective views coincide: the gap between them only exists within a file.
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
        const deductionsByDimension = groupDeductionsByDimension(
            allRationales,
            deductionPoints,
            deductionPoints,
        );
        const { compositeScore, coverage } = computeCompositeScore(
            rawScores,
            evaluatedDimensions,
            this.weights,
        );
        const grade = resolveQualityGrade(compositeScore);
        // Project scope: totalWeight is the repository's non-blank line total. Passing it
        // through the file-scoped helper capped it at 300 lines, so baseConfidence was always
        // 1.0 and the published confidence collapsed to exactly coverage.
        const confidence = calculateConfidenceFromVolume(totalWeight, coverage, 'project');

        return {
            indices: rawScores,
            compositeScore,
            grade,
            confidence,
            weights: { ...this.weights },
            formulas: {
                indexMapping:
                    'density dims: index = 100 * H / (H + linearPoints / scaleFactor), H = ' +
                    `${SATURATION_HALFPOINT}; absolute dims: index = max(0, 100 - linearPoints)`,
                saturationHalfpoint: SATURATION_HALFPOINT,
                dimensionScaleMode: { ...DIMENSION_SCALE_MODE },
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
            skippedFileWarning,
        };
    }
}
