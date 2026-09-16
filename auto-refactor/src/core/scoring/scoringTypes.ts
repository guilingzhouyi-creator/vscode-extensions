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
 */
export const DIMENSION_ANALYZERS: Record<QualityDimension, readonly string[]> = {
    architectureConsistency: ['architecture', 'dependency-graph'],
    semanticPurity: ['constants', 'simplify'],
    codeSecurity: ['security', 'secrets'],
    performanceEfficiency: ['performance'],
    standardization: ['hygiene', 'comments'],
    modernity: ['ts-modern', 'python-modern', 'rust-modern', 'gdscript-modern'],
    maintainability: ['complexity', 'large-file'],
    commentQuality: ['comments'],
    duplication: ['constants', 'simplify'],
    techDebtRisk: ['governance'],
};

/** Dimension weights for the composite Quality Index (default balanced) */
export type QualityWeights = Record<QualityDimension, number>;

/**
 * Balanced per-dimension weights used when the caller supplies no custom weights. Weights are
 * relative multipliers, not percentages: security weighs heaviest at 1.5, tech-debt risk
 * follows at 1.3, and each value can be overridden by the partial `customWeights` passed to
 * the `QualityScorer` constructor.
 */
export const DEFAULT_QUALITY_WEIGHTS: QualityWeights = {
    architectureConsistency: 1.2,
    semanticPurity: 1.0,
    codeSecurity: 1.5,
    performanceEfficiency: 1.1,
    standardization: 0.9,
    modernity: 0.8,
    maintainability: 1.2,
    commentQuality: 0.8,
    duplication: 1.0,
    techDebtRisk: 1.3,
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
 * Letter grade for a composite score: `A+` at >= 95, `A` at >= 85, `B` at >= 75, `C` at >= 65,
 * `D` at >= 50 and `F` below 50. The thresholds live in `qualityScorer`; this type only names
 * the possible labels, so callers should display the value rather than re-derive the buckets.
 */
export type QualityGrade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';

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
    evaluatedAt: number; /** Dimensions whose analyzers did not run; excluded from the weighted
        composite. */
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
        { points: number; entries: { rule: string; points: number; reason: string }[] }
    >;
    formulas?: {
        composite: string;
        coverage: string;
        confidence: string;
        gradeCutoffs: { grade: string; min: number }[];
        dimensionWeights: Record<string, number>;
        familyDimensions: Record<string, string>;
    };
}
