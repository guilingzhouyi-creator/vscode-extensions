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
import { ALL_QUALITY_DIMENSIONS, DIMENSION_ANALYZERS, DIMENSION_SCALE_MODE } from './scoringTypes';

/** Maximum clean score a quality dimension starts at before deductions. */
export const DIMENSION_MAX_SCORE = 100;
/**
 * Grade cut-offs on the 0-100 composite score, evenly spaced by 10.
 *
 * The previous 95/85/75/65/50 spread gave the F band a 50-point span while A+ had only 5,
 * so an F covered nearly as much range as A through D combined and read as a catch-all.
 * Even spacing makes each band describe the same amount of quality.
 */
export const GRADE_A_PLUS_MIN = 90;
/** Grade A minimum threshold. */
export const GRADE_A_MIN = 80;
/** Grade B minimum threshold. */
export const GRADE_B_MIN = 70;
/** Grade C minimum threshold. */
export const GRADE_C_MIN = 60;
/** Grade D minimum threshold. */
export const GRADE_D_MIN = 50;
/** Composite rounding: two decimal places (0.01 precision). */
export const SCORE_ROUNDING = 100;
/** Confidence floor threshold. */
export const CONFIDENCE_FLOOR = 0.6;
/** Confidence line cap upper bound. */
export const CONFIDENCE_LINE_CAP = 300;
/** Confidence line scaling factor. */
export const CONFIDENCE_LINE_SCALE = 750;
/**
 * Volume multiplier applied to the confidence ramp at project scope.
 *
 * A repository is an order of magnitude larger than a typical file, so the same divisor
 * would saturate baseConfidence to 1.0 immediately and erase the volume term. Multiplying
 * the scale keeps a project on a comparable curve to a file instead of always at the ceiling.
 */
export const PROJECT_SCALE_FACTOR = 20;
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
 * `points` is the linear sum of the entries, so a consumer can add the audit trail up
 * and recover it exactly. `effectivePoints` is what the index curve actually consumed:
 * it differs from `points` once scale dampening compresses a large file, and it is the
 * value `DIMENSION_MAX_SCORE - indices[dim]` reconciles against. Publishing both keeps
 * the two previously-conflicting numbers distinguishable instead of overwriting one
 * with the other.
 *
 * @param rationales - Recorded rationale items from deduction applier.
 * @param linearPoints - Linear accumulated penalty points per dimension.
 * @param effectivePoints - Post-curve penalty points per dimension.
 * @returns Audit trail map partitioned by quality dimension.
 */
export function groupDeductionsByDimension(
    rationales: QualityScoreRationale[],
    linearPoints: Record<QualityDimension, number>,
    effectivePoints: Record<QualityDimension, number>,
): Record<
    QualityDimension,
    {
        points: number;
        effectivePoints: number;
        entries: { rule: string; points: number; reason: string }[];
    }
> {
    const deductionsByDimension = {} as Record<
        QualityDimension,
        {
            points: number;
            effectivePoints: number;
            entries: { rule: string; points: number; reason: string }[];
        }
    >;
    for (const dim of ALL_QUALITY_DIMENSIONS) {
        deductionsByDimension[dim] = { points: 0, effectivePoints: 0, entries: [] };
    }
    for (const entry of rationales) {
        const bucket = deductionsByDimension[entry.dimension];
        const points = -entry.delta;
        bucket.points += points;
        bucket.entries.push({ rule: entry.rule ?? 'metric', points, reason: entry.reason });
    }
    for (const dim of ALL_QUALITY_DIMENSIONS) {
        deductionsByDimension[dim].points = linearPoints[dim];
        deductionsByDimension[dim].effectivePoints = effectivePoints[dim];
    }
    return deductionsByDimension;
}

/**
 * Floor applied to a dimension index before the weighted geometric mean, in index units.
 *
 * The geometric mean is undefined at 0, and a repository with one collapsed axis must not be
 * reported as 0 overall (that would make the aggregate carry no information). Clamping each
 * index to this floor keeps the aggregate strictly inside (0, 100] while still punishing a
 * collapsed axis: one axis at the floor and nine at 100 yields ~85, against 90 for the
 * arithmetic mean, so the shortfall registers without the whole score collapsing.
 */
export const COMPOSITE_INDEX_FLOOR = 15;

/**
 * Calculate the weighted composite score and measured weight coverage.
 *
 * The composite is a weighted geometric mean rather than an arithmetic one. An arithmetic
 * mean lets nine full-score axes hide a collapsed one (0 plus nine 100s averaged to 90), which
 * overstates a repository whose weakest axis is failing. The geometric mean is bounded by the
 * minimum index, so a single weak axis necessarily pulls the aggregate down in proportion to
 * how weak it is, while `coverage` stays an arithmetic weight ratio and is unaffected.
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
    // A negative or non-finite weight makes the weighted mean meaningless rather than
    // merely skewed, and the previous `totalWeight || 1` fallback silently turned that
    // into an arbitrary score, so reject the configuration at the boundary instead.
    let overallWeight = 0;
    for (const dim of ALL_QUALITY_DIMENSIONS) {
        const w = weights[dim];
        if (typeof w !== 'number' || !Number.isFinite(w) || w < 0) {
            throw new RangeError(
                `quality weight for "${dim}" must be a finite non-negative number, got ${String(w)}`,
            );
        }
        overallWeight += w;
    }

    let logSum = 0;
    let totalWeight = 0;
    for (const dim of evaluatedDimensions) {
        const w = weights[dim];
        const index = Math.max(
            COMPOSITE_INDEX_FLOOR,
            Math.min(DIMENSION_MAX_SCORE, rawScores[dim]),
        );
        logSum += w * Math.log(index);
        totalWeight += w;
    }
    const coverage =
        overallWeight === 0
            ? 1
            : Math.round((totalWeight / overallWeight) * SCORE_ROUNDING) / SCORE_ROUNDING;

    // A zero total weight means no dimension was measured at all, which happens on a narrow
    // scan (e.g. only the simplify analyzer runs, and it witnesses none of the ten axes).
    // That is missing data, not a misconfiguration, so it reports as no score with full
    // coverage rather than being coerced to 0 and graded F. A negative or non-finite weight
    // is a genuine misconfiguration and was already rejected above.
    if (evaluatedDimensions.length === 0) {
        return { compositeScore: Number.NaN, coverage };
    }
    if (totalWeight <= 0) {
        throw new RangeError(
            'composite score is undefined: every measured dimension has zero weight',
        );
    }
    const compositeScore =
        Math.round(Math.exp(logSum / totalWeight) * SCORE_ROUNDING) / SCORE_ROUNDING;
    return { compositeScore, coverage };
}

/**
 * Whether a composite score was actually measured.
 *
 * A composite is NaN when no dimension carried a weight, which happens on a narrow scan
 * where the enabled analyzers witness none of the axes. NaN is not "zero": every comparison
 * against it is false, so an unguarded `after - before` yields NaN, a NaN delta fails both
 * `> threshold` and `< -threshold`, and the code silently falls through to its default
 * branch. Downstream consumers must test measurability before doing arithmetic.
 *
 * @param score - Composite score, possibly NaN.
 * @returns True when the score is a real measurement.
 */
export function isMeasured(score: number): boolean {
    return Number.isFinite(score);
}

/**
 * Difference between two composite scores, or null when either side is unmeasured.
 *
 * Callers that report a numeric delta need a way to say "not comparable" without inventing
 * a zero, which would read as "no change" rather than "no data".
 *
 * @param before - Composite score before the change.
 * @param after - Composite score after the change.
 * @returns The signed difference, or null when either side is unmeasured.
 */
export function scoreDelta(before: number, after: number): number | null {
    if (!isMeasured(before) || !isMeasured(after)) {
        return null;
    }
    return after - before;
}

/**
 * Map a numeric composite score to a letter grade.
 *
 * A NaN composite means no dimension was measured, which is not the same as a bad score:
 * grading it 'F' would report missing data as a failing verdict. The caller sees 'N/A'
 * instead and is expected to check `coverage` before quoting a grade.
 *
 * @param compositeScore - Computed composite score (0-100), or NaN when nothing was measured.
 * @returns Matching QualityGrade, or 'N/A' when no dimension contributed a weight.
 */
export function resolveQualityGrade(compositeScore: number): QualityGrade {
    if (Number.isNaN(compositeScore)) return 'N/A';
    if (compositeScore >= GRADE_A_PLUS_MIN) return 'A+';
    if (compositeScore >= GRADE_A_MIN) return 'A';
    if (compositeScore >= GRADE_B_MIN) return 'B';
    if (compositeScore >= GRADE_C_MIN) return 'C';
    if (compositeScore >= GRADE_D_MIN) return 'D';
    return 'F';
}

/**
 * Compute statistical confidence adjusted for measured volume and coverage.
 *
 * Two regimes, because a single file and a whole repository are different populations:
 *
 * - File scope: confidence rises with the file's own line count, capped at
 *   `CONFIDENCE_LINE_CAP`. A 20-line file cannot support a strong claim.
 * - Project scope: the "lines" figure is the repository total, which passes the file cap
 *   immediately, so the old code reduced `confidence` to exactly `coverage` for every
 *   repository above ~300 lines and the volume term stopped existing. The cap is not applied
 *   here; a larger sample genuinely is more evidence.
 *
 * @param lines - Evidence volume: a file's non-blank lines, or a repository total.
 * @param coverage - Dimension coverage ratio (0-1).
 * @param scope - Whether `lines` describes one file or the whole repository.
 * @returns Confidence score clamped between floor and 1.
 */
export function calculateConfidenceFromVolume(
    lines: number,
    coverage: number,
    scope: 'file' | 'project',
): number {
    const effective = scope === 'file' ? Math.min(lines, CONFIDENCE_LINE_CAP) : lines;
    // A repository's total is unbounded, so the ramp is scaled by an order of magnitude
    // relative to the file case to keep the curve in a comparable range.
    const scale =
        scope === 'file' ? CONFIDENCE_LINE_SCALE : CONFIDENCE_LINE_SCALE * PROJECT_SCALE_FACTOR;
    const baseConfidence = Math.min(
        1.0,
        Math.max(
            CONFIDENCE_FLOOR,
            Math.round((CONFIDENCE_FLOOR + effective / scale) * PERCENT_SCALE) / PERCENT_SCALE,
        ),
    );
    return (
        Math.round(Math.max(CONFIDENCE_FLOOR, baseConfidence * coverage) * PERCENT_SCALE) /
        PERCENT_SCALE
    );
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
    return calculateConfidenceFromVolume(
        metric?.nonBlankLines ?? DEFAULT_METRIC_LINES,
        coverage,
        'file',
    );
}

/**
 * Half-point of the dimension index curve, in density units (deduction points per 100
 * lines). At `density == SATURATION_HALFPOINT` the index is exactly 50, so a dimension
 * must accumulate half this density before it reads as half healthy.
 *
 * The previous form was `min(rawPoints, 100 * (1 - e^(-density/40)))`. Its `min`
 * hard-clamped the penalty at 100, so every density past ~240 collapsed to index 0 and a
 * dimension carrying 24840 points became indistinguishable from one carrying 1230. The
 * reciprocal form asymptotes to 0 instead of to the 100-point ceiling, keeping extreme
 * cases strictly ordered and reportable.
 */
export const SATURATION_HALFPOINT = 30;

/**
 * Computes scores across all dimensions, applying scale-normalized density dampening for
 * large files.
 *
 * `absolute` dimensions (currently only codeSecurity) score by absolute defect count: one
 * hard-coded credential is one defect whether the file is 20 or 500 lines, so scaling its
 * penalty by size would understate it. The rest score by defect density, so a 500-line file
 * is not punished five times harder than a 100-line one for the same defect count. The
 * per-dimension choice is declared in `DIMENSION_SCALE_MODE`, not hardcoded at the branch.
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
        if (scaleFactor <= 1 || DIMENSION_SCALE_MODE[dim] === 'absolute') {
            rawScores[dim] = Math.max(0, DIMENSION_MAX_SCORE - rawPoints);
        } else {
            const density = rawPoints / scaleFactor;
            rawScores[dim] =
                (DIMENSION_MAX_SCORE * SATURATION_HALFPOINT) / (SATURATION_HALFPOINT + density);
        }
    }
    return rawScores;
}

/**
 * Recover the penalty a dimension index reflects, in index units.
 *
 * The index is not `100 - points`: the density curve compresses the penalty, so the gap
 * between the ceiling and the index is the penalty the curve actually charged. Publishing
 * it as `effectivePoints` keeps `DIMENSION_MAX_SCORE - indices[dim]` reconcilable by a
 * consumer, while `points` carries the uncompressed linear total the curve consumed.
 *
 * @param index - Computed dimension index (0-100).
 * @returns Penalty in index units, in [0, 100].
 */
export function effectivePenaltyFromIndex(index: number): number {
    const clamped = Math.max(0, Math.min(DIMENSION_MAX_SCORE, index));
    return DIMENSION_MAX_SCORE - clamped;
}

/**
 * Accumulates LOC-weighted raw scores and rationales across all file metrics.
 *
 * @param fileQualityScores - Map of file path to individual QualityScoreBreakdown.
 * @param fileMetrics - Per-file metric records of this scan.
 * @returns Aggregated raw scores, total weight, collected rationales, and the files that
 *   were present in `fileMetrics` but had no score entry.
 */
export function accumulateProjectMetrics(
    fileQualityScores: Record<string, import('./scoringTypes').QualityScoreBreakdown>,
    fileMetrics: FileMetric[],
): {
    rawScores: Record<QualityDimension, number>;
    totalWeight: number;
    allRationales: QualityScoreRationale[];
    skippedFiles: string[];
} {
    const rawScores = {} as Record<QualityDimension, number>;
    for (const dim of ALL_QUALITY_DIMENSIONS) {
        rawScores[dim] = 0;
    }
    let totalWeight = 0;
    const allRationales: QualityScoreRationale[] = [];
    // A file present in `fileMetrics` but absent from `fileQualityScores` would otherwise
    // vanish from the project score while still being counted in `filesScanned`, leaving
    // no trace anywhere in the report. This cannot happen on the current cold path (both
    // are driven from the same array) but the warm/incremental path rebuilds the score map
    // separately, where a key mismatch (notably `\` vs `/` separators on Windows) would drop
    // the file silently. Counted and reported rather than skipped quietly.
    const skippedFiles: string[] = [];

    for (const m of fileMetrics) {
        const fScore = fileQualityScores[m.file];
        if (!fScore) {
            skippedFiles.push(m.file);
            continue;
        }

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

    return { rawScores, totalWeight, allRationales, skippedFiles };
}

export * from './modernization-formulas';
