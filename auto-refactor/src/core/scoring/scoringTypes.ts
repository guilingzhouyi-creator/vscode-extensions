/**
 * Module: Core Engine — Quality Scoring Contracts and Default Weights
 * File Path: src/core/scoring/scoringTypes.ts
 * Architecture Role: Single source of truth for the quality model — dimension and grade
 *   unions, dimension ordering, weight and rationale contracts, and the score breakdown.
 * Dependencies & Triggers: Imports nothing; imported by `qualityScorer`, `core/analyzer`,
 *   `core/trajectory`, `core/memory`, and `core/types` (which re-exports it) plus `api.ts`,
 *   so every quality-scoring call and type-only reference resolves through this module.
 * Responsibilities: Define `QualityDimension`, `ALL_QUALITY_DIMENSIONS`, `QualityWeights`,
 *   `DEFAULT_QUALITY_WEIGHTS` (security 1.5 highest, tech-debt 1.3), the
 *   `QualityScoreRationale` audit record, `QualityGrade`, and `QualityScoreBreakdown`
 *   fields: indices, composite score, grade, confidence, weights, rationales, timestamp.
 * Exit Semantics & Design Rationale: Type and constant declarations only — no imports, I/O,
 *   branching, or throw paths; the score range is pinned at 0.0-100.0 and confidence at
 *   0.0-1.0, and every deduction must carry a rationale, so no black-box score can be
 *   represented.
 */

/**
 * One independently scored quality axis. Every axis contributes a 0.0-100.0 index to
 * `QualityScoreBreakdown.indices`; iterate `ALL_QUALITY_DIMENSIONS` for canonical ordering
 * instead of relying on the declaration order of the union members.
 */
export type QualityDimension =
    | 'architectureConsistency'
    | 'semanticPurity'
    | 'codeSecurity'
    | 'performanceEfficiency'
    | 'standardization'
    | 'modernity'
    | 'maintainability'
    | 'commentQuality'
    | 'duplication'
    | 'techDebtRisk';

/**
 * Quality review profile targeting specific system layers or composite audits.
 */
export type QualityReviewProfile = 'frontend' | 'backend' | 'composite';

/**
 * Canonical ordered enumeration of all quality dimensions, used whenever every axis must be
 * visited (for example index initialization in `qualityScorer` and `anomalyDetector`); it
 * must stay in exact sync with the `QualityDimension` union.
 */

/**
 * Canonical ordered enumeration of all quality dimensions, used whenever every axis must be
 * visited (for example index initialization in `qualityScorer` and `anomalyDetector`); it must
 * stay in exact sync with the `QualityDimension` union, and `DIMENSION_ANALYZERS` below must
 * cover every member.
 */
export const ALL_QUALITY_DIMENSIONS: readonly QualityDimension[] = [
    'architectureConsistency',
    'semanticPurity',
    'codeSecurity',
    'performanceEfficiency',
    'standardization',
    'modernity',
    'maintainability',
    'commentQuality',
    'duplication',
    'techDebtRisk',
] as const;

/**
 * Analyzers whose evidence feeds each quality dimension. A dimension is *not evaluated* when none
 * of its analyzers is enabled in the scan configuration, so the model never scores an axis that
 * was not actually measured (see `QualityScoreBreakdown.notEvaluated` / `coverage`).
 *
 * These lists mirror the deduction table in `scoring/dimensionDeductions.ts`, which is the single
 * source of truth: every analyzer that can deduct a dimension must appear here, and
 * `validate-scoring-coverage` fails the build when the two drift apart. `techDebtRisk` is the one
 * documented exception — the severity fallback in that module lets *every* analyzer feed it, so
 * its list names the analyzer that owns debt routing, not the whole set.
 */
export const DIMENSION_ANALYZERS: Record<QualityDimension, readonly string[]> = {
    architectureConsistency: [
        'architecture',
        'dependency-graph',
        'dependency-layout',
        'data-architecture',
        'stdlib',
        'naming',
        'gdscript-game',
        'vscode-extension',
    ],
    semanticPurity: ['governance', 'hygiene', 'dependency-graph', 'stdlib'],
    codeSecurity: ['architecture', 'security', 'secrets'],
    performanceEfficiency: [
        'performance',
        'data-architecture',
        'complexity',
        'gdscript-game',
        'vscode-extension',
    ],
    standardization: ['hygiene', 'large-file', 'dependency-layout', 'stdlib', 'naming', 'docs'],
    modernity: [
        'governance',
        'ts-modern',
        'python-modern',
        'rust-modern',
        'gdscript-modern',
        'gdscript-game',
        'test-modernity',
    ],
    maintainability: ['complexity', 'large-file', 'test-modernity', 'stdlib', 'gdscript-game'],
    commentQuality: ['comments', 'vscode-extension'],
    duplication: ['constants', 'hygiene'],
    techDebtRisk: ['governance'],
};

/**
 * Per-dimension scaling mode used by the index curve.
 *
 * `absolute` scores by raw defect count and ignores file size; `density` divides the count
 * by the file's line scale factor. Security is absolute because one hard-coded credential
 * is one defect whether the file is 20 or 500 lines, so size-scaling would understate it.
 * Declaring this here keeps the curve reading configuration rather than a hardcoded rule id.
 */
export const DIMENSION_SCALE_MODE: Record<QualityDimension, 'absolute' | 'density'> = {
    architectureConsistency: 'density',
    semanticPurity: 'density',
    codeSecurity: 'absolute',
    performanceEfficiency: 'density',
    standardization: 'density',
    modernity: 'density',
    maintainability: 'density',
    commentQuality: 'density',
    duplication: 'density',
    techDebtRisk: 'density',
};

/** Dimension weights for the composite Quality Index (default balanced) */
export type QualityWeights = Record<QualityDimension, number>;

/**
 * Balanced per-dimension weights used when the caller supplies no custom weights.
 *
 * Normalized to sum to 1.0, matching `DEFAULT_PILLAR_WEIGHTS` and the static-quality model
 * so weights are directly comparable across scoring surfaces. Only the ratios carry meaning:
 * security weighs heaviest, tech-debt risk follows, and each value can be overridden by the
 * partial `customWeights` passed to the `QualityScorer` constructor.
 */
export const DEFAULT_QUALITY_WEIGHTS: QualityWeights = {
    architectureConsistency: 0.111,
    semanticPurity: 0.093,
    codeSecurity: 0.139,
    performanceEfficiency: 0.102,
    standardization: 0.083,
    modernity: 0.074,
    maintainability: 0.111,
    commentQuality: 0.074,
    duplication: 0.093,
    techDebtRisk: 0.12,
};

/** Traceable deduction or bonus explanation */
export interface QualityScoreRationale {
    dimension: QualityDimension;
    delta: number; // e.g. -15 or +5
    reason: string;
    rule?: string;
    line?: number;
    domainId?: string;
}

/**
 * Letter grade for a composite score: `A+` at >= 90, `A` at >= 80, `B` at >= 70, `C` at >= 60,
 * `D` at >= 50 and `F` below 50. The cut-offs live in `scorer-formulas` as the single source
 * of truth; this type only names the possible labels, so callers should display the value
 * rather than re-derive the buckets.
 *
 * `N/A` means no dimension carried a weight, so no composite could be formed. That is
 * missing data rather than a failing score, and a consumer should check `coverage` before
 * quoting a letter.
 */
export type QualityGrade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F' | 'N/A';

/** Complete breakdown of a quality assessment */
export interface QualityScoreBreakdown {
    /** 10 individual independent indices (0.0 to 100.0) */
    indices: Record<QualityDimension, number>;
    /** Weighted composite quality score (0.0 to 100.0) */
    compositeScore: number;
    /** Letter grade based on composite score */
    grade: QualityGrade;
    /** Statistical confidence (0.0 to 1.0) based on code volume and analyzer coverage */
    confidence: number;
    /** Normalized weights applied during evaluation */
    weights: QualityWeights;
    /** Complete transparent audit trail explaining all deductions */
    rationales: QualityScoreRationale[];
    /** Evaluation timestamp (epoch ms) */
    evaluatedAt: number;
    /**
     * Present when the project aggregate excluded files that had metrics but no per-file
     * score. Such files still count towards `filesScanned`, so their absence would bias the
     * composite downward with no visible cause; this makes the gap auditable.
     */
    skippedFileWarning?: string;
    /**
     * Dimensions whose analyzers did not run; excluded from the weighted composite.
     */
    notEvaluated?: QualityDimension[];
    /** Share of the total weight that was actually measured (0.0-1.0). */
    coverage?: number;
    /**
     * Enabled analyzers that witness each dimension, so "security disabled but secrets enabled"
     * reconciles instead of reading as a contradiction; empty means the dimension was not measured.
     */
    evaluatedBy?: Partial<Record<QualityDimension, string[]>>;
    /**
     * Machine-readable definition of the quantified standard this score was produced under:
     * the composite/coverage/confidence formulas, the per-dimension weights and the grade
     * cut-offs, so a consumer can re-derive the grade instead of trusting the label.
     */
    /**
     * Per-dimension deduction audit: which rules took how many points and why, so an index of 0 can
     * be traced to the exact rules instead of being an unexplained number.
     */
    deductionsByDimension?: Record<
        QualityDimension,
        {
            /** Linear sum of the audit-trail entries, before the index curve compresses them. */
            points: number;
            /**
             * Penalty the index curve actually consumed; `100 - indices[dim]` reconciles to it.
             */
            effectivePoints: number;
            entries: { rule: string; points: number; reason: string }[];
        }
    >;
    formulas?: {
        /** How a linear point total becomes a 0-100 index, per scaling mode. */
        indexMapping: string;
        /** Half-point `H` of the density curve: at density H the index is exactly 50. */
        saturationHalfpoint: number;
        /**
         * Index floor applied before the composite's geometric mean. Publishing it lets a
         * consumer re-derive the score; the index floor is what keeps a collapsed axis from
         * driving the whole aggregate to zero.
         */
        compositeIndexFloor?: number;
        /** Which dimensions score by absolute count versus defect density. */
        dimensionScaleMode: Record<QualityDimension, 'absolute' | 'density'>;
        composite: string;
        coverage: string;
        confidence: string;
        gradeCutoffs: { grade: string; min: number }[];
        dimensionWeights: Record<string, number>;
        familyDimensions: Record<string, string>;
    };
}
