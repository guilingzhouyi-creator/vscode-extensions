/**
 * Module: Core Engine — Transparent Multi-Dimensional Quality Scoring
 * File Path: src/core/scoring/qualityScorer.ts
 * Architecture Role: In-memory scoring layer that converts analyzer `Issue[]` output and
 *   `FileMetric` data into an auditable `QualityScoreBreakdown` for reports and memory.
 * Dependencies & Triggers: Imports `Issue`, `FileMetric`, and `ScanConfig` from `../types`,
 *   `ScoringRationales` from `../messages`, and dimension/weight/grade/breakdown contracts
 *   from `./scoringTypes`; invoked by `Analyzer` scans, the dual-track pipeline, and API
 *   callers of `evaluateQualityScore`, and constructed with `config.scoringWeights`.
 * Responsibilities: Merge optional partial weights over `DEFAULT_QUALITY_WEIGHTS`; deduct
 *   points per issue by analyzer/rule pattern; penalize nesting depth above 5 and more than
 *   30 exported symbols; clamp each index at 0; compute the weighted composite rounded to
 *   one decimal; map it to grades A+ through F; derive confidence from non-blank lines; and
 *   return indices, rationales, weights, grade, confidence, and an evaluation timestamp.
 * Exit Semantics & Design Rationale: Pure computation with no I/O and no throw paths;
 *   unmatched analyzer/rule combinations fall through to generic or zero deductions; the
 *   `_config` argument is accepted but unused; `totalWeight || 1` guards an all-zero weight
 *   set; every deduction records a rationale so output stays explainable, not black-box.
 */
import type { Issue, FileMetric, ScanConfig } from '../types';
import { ScoringRationales } from '../messages';
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

// ── Scoring policy (weights, grade cut-offs, confidence model) ──
/** Penalty points deducted from the architecture index per finding. */
const DEDUCTION_CIRCULAR_DEPENDENCY = 25;
/** Penalty points deducted from the security index per finding. */
const DEDUCTION_CRITICAL_CODE_EXECUTION = 40;
const DEDUCTION_CRITICAL_COMMAND_INJECTION = 40;
const DEDUCTION_PROTOTYPE_POLLUTION = 35;
const DEDUCTION_INSECURE_RANDOMNESS = 25;
const DEDUCTION_GENERIC_SECURITY = 25;
const DEDUCTION_HARDCODED_CREDENTIAL = 50;
/** Penalty points deducted from the comment-quality index. */
const DEDUCTION_MISSING_PUBLIC_API_DOC = 8;
/** Penalty points deducted from the duplication index. */
const DEDUCTION_DUPLICATE_LITERAL = 8;
const DEDUCTION_MAGIC_NUMBER = 4;
const DEDUCTION_HARDCODED_STRING = 3;

/** Maximum clean score a quality dimension starts at before deductions. */
const DIMENSION_MAX_SCORE = 100;
/** Dimension key for the architecture-consistency index. */
const DIMENSION_ARCHITECTURE_CONSISTENCY = 'architectureConsistency';
/** Dimension key for the code-security index. */
const DIMENSION_CODE_SECURITY = 'codeSecurity';
/** Deduction applied to both affected indices for an ARCH-LEAK-002 DTO credential leak. */
const DEDUCTION_DTO_CREDENTIAL_LEAK = 30;
/** Deduction from the security index for a SEC-VUL-006 path-traversal risk. */
const DEDUCTION_PATH_TRAVERSAL = 30;
/** Deduction from the security index for an eval/unsafe/sanitization risk. */
const DEDUCTION_POTENTIAL_INJECTION = 30;
/** Deduction from the architecture index for a layer or boundary violation. */
const DEDUCTION_LAYER_CONSTRAINT_VIOLATION = 20;
/** Deduction from the security index for a SEC-VUL-005 broken hash algorithm. */
const DEDUCTION_BROKEN_HASH = 20;
/** Deduction from the security index for SEC-LEAK-001 sensitive data logging. */
const DEDUCTION_SENSITIVE_DATA_LOGGED = 20;
/** Deduction from the performance index for an unbounded memory-leak risk. */
const DEDUCTION_MEMORY_LEAK_RISK = 20;
/** Deduction from the architecture index for an uncategorized design violation. */
const DEDUCTION_ARCHITECTURE_DESIGN_VIOLATION = 15;
/** Deduction from the performance index for a transient loop allocation. */
const DEDUCTION_TRANSIENT_LOOP_ALLOCATION = 15;
/** Deduction from the standardization index for a file line-count overflow. */
const DEDUCTION_LINE_COUNT_OVERFLOW = 15;
/** Deduction from the maintainability index for high cyclomatic complexity. */
const DEDUCTION_CYCLOMATIC_COMPLEXITY = 15;
/** Deduction from the comment-quality index for banned jargon in a comment. */
const DEDUCTION_BANNED_JARGON = 15;
/** Deduction from the tech-debt index for an error-severity issue. */
const DEDUCTION_ERROR_TECH_DEBT = 15;
/** Deduction from the semantic-purity index for a type-safety escape. */
const DEDUCTION_TYPE_SAFETY_ESCAPE = 10;
/** Deduction from the semantic-purity index for unreachable dead code. */
const DEDUCTION_UNREACHABLE_DEAD_CODE = 10;
/** Deduction from the performance index for an inefficient algorithm path. */
const DEDUCTION_INEFFICIENT_ALGORITHM = 10;
/** Deduction from the modernity index for a deprecated language feature. */
const DEDUCTION_DEPRECATED_FEATURE = 10;
/** Deduction from the maintainability index for excessive nesting depth. */
const DEDUCTION_NESTING_DEPTH_OVERFLOW = 10;
/** Deduction from the architecture index for excessive exported symbols. */
const DEDUCTION_EXCESSIVE_EXPORTED_SYMBOLS = 10;
/** Deduction from the semantic-purity index for an unused binding or import. */
const DEDUCTION_UNUSED_BINDING = 5;
/** Deduction from the standardization index for a naming violation. */
const DEDUCTION_NAMING_VIOLATION = 5;
/** Deduction from the comment-quality index for a substandard comment. */
const DEDUCTION_SUBSTANDARD_COMMENT = 5;
/** Deduction from the tech-debt index for a warning-severity issue. */
const DEDUCTION_WARNING_TECH_DEBT = 5;
/** Nesting depth above which the maintainability metric penalty applies. */
const MAX_NESTING_DEPTH = 5;
/** Exported-symbol count above which the architecture metric penalty applies. */
const MAX_EXPORTED_SYMBOLS = 30;
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
 * Transparent Multi-Dimensional Quality Scorer.
 * Implements auditable scoring across 10 dimensions with zero black-box magic numbers.
 */
export class QualityScorer {
    private weights: QualityWeights;

    constructor(customWeights?: Partial<QualityWeights>) {
        this.weights = { ...DEFAULT_QUALITY_WEIGHTS, ...(customWeights || {}) };
    }

    /** Evaluate the transparent quality breakdown for a single file */
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

        const applyDeduction = (
            dim: QualityDimension,
            points: number,
            reason: string,
            rule?: string,
            line?: number,
        ) => {
            rawScores[dim] = Math.max(0, rawScores[dim] - points);
            rationales.push({
                dimension: dim,
                delta: -points,
                reason,
                rule,
                line,
            });
        };

        // Analyze issues and deduct points accordingly
        for (const issue of issues) {
            const line = issue.location?.start?.line;
            const r = issue.rule;
            const msg = issue.message;

            // 1. Architecture Consistency
            if (issue.analyzer === 'architecture' || issue.analyzer === 'dependency-graph') {
                if (r === 'ARCH-LEAK-002' || r.includes('ARCH-LEAK-002')) {
                    applyDeduction(
                        DIMENSION_ARCHITECTURE_CONSISTENCY,
                        DEDUCTION_DTO_CREDENTIAL_LEAK,
                        ScoringRationales.DTO_CREDENTIAL_LEAK(msg),
                        r,
                        line,
                    );
                    applyDeduction(
                        DIMENSION_CODE_SECURITY,
                        DEDUCTION_DTO_CREDENTIAL_LEAK,
                        ScoringRationales.DTO_CREDENTIAL_LEAK(msg),
                        r,
                        line,
                    );
                } else if (r.includes('layer') || r.includes('boundary') || r.includes('LEAK')) {
                    applyDeduction(
                        DIMENSION_ARCHITECTURE_CONSISTENCY,
                        DEDUCTION_LAYER_CONSTRAINT_VIOLATION,
                        ScoringRationales.LAYER_CONSTRAINT_VIOLATION(msg),
                        r,
                        line,
                    );
                } else if (r.includes('cycle') || r.includes('circular')) {
                    applyDeduction(
                        DIMENSION_ARCHITECTURE_CONSISTENCY,
                        DEDUCTION_CIRCULAR_DEPENDENCY,
                        ScoringRationales.CIRCULAR_DEPENDENCY(msg),
                        r,
                        line,
                    );
                } else {
                    applyDeduction(
                        DIMENSION_ARCHITECTURE_CONSISTENCY,
                        DEDUCTION_ARCHITECTURE_DESIGN_VIOLATION,
                        ScoringRationales.ARCHITECTURE_DESIGN_VIOLATION(msg),
                        r,
                        line,
                    );
                }
            }

            // 2. Semantic Purity
            if (issue.analyzer === 'governance' && (r.includes('type') || r.includes('escape'))) {
                applyDeduction(
                    'semanticPurity',
                    DEDUCTION_TYPE_SAFETY_ESCAPE,
                    ScoringRationales.TYPE_SAFETY_ESCAPE(msg),
                    r,
                    line,
                );
            }
            if (issue.analyzer === 'hygiene' && (r.includes('dead') || r.includes('unreachable'))) {
                applyDeduction(
                    'semanticPurity',
                    DEDUCTION_UNREACHABLE_DEAD_CODE,
                    ScoringRationales.UNREACHABLE_DEAD_CODE(msg),
                    r,
                    line,
                );
            }
            if (issue.analyzer === 'hygiene' && r.includes('unused')) {
                applyDeduction(
                    'semanticPurity',
                    DEDUCTION_UNUSED_BINDING,
                    ScoringRationales.UNUSED_BINDING_OR_IMPORT(msg),
                    r,
                    line,
                );
            }

            // 3. Code Security
            if (issue.analyzer === 'security') {
                if (r === 'SEC-VUL-001') {
                    applyDeduction(
                        DIMENSION_CODE_SECURITY,
                        DEDUCTION_CRITICAL_CODE_EXECUTION,
                        ScoringRationales.CRITICAL_CODE_EXECUTION(msg),
                        r,
                        line,
                    );
                } else if (r === 'SEC-VUL-002') {
                    applyDeduction(
                        DIMENSION_CODE_SECURITY,
                        DEDUCTION_CRITICAL_COMMAND_INJECTION,
                        ScoringRationales.CRITICAL_COMMAND_INJECTION(msg),
                        r,
                        line,
                    );
                } else if (r === 'SEC-VUL-003') {
                    applyDeduction(
                        DIMENSION_CODE_SECURITY,
                        DEDUCTION_PROTOTYPE_POLLUTION,
                        ScoringRationales.PROTOTYPE_POLLUTION_RISK(msg),
                        r,
                        line,
                    );
                } else if (r === 'SEC-VUL-004') {
                    applyDeduction(
                        DIMENSION_CODE_SECURITY,
                        DEDUCTION_INSECURE_RANDOMNESS,
                        ScoringRationales.INSECURE_RANDOMNESS_RISK(msg),
                        r,
                        line,
                    );
                } else if (r === 'SEC-VUL-005') {
                    applyDeduction(
                        DIMENSION_CODE_SECURITY,
                        DEDUCTION_BROKEN_HASH,
                        ScoringRationales.BROKEN_HASH_ALGORITHM(msg),
                        r,
                        line,
                    );
                } else if (r === 'SEC-VUL-006') {
                    applyDeduction(
                        DIMENSION_CODE_SECURITY,
                        DEDUCTION_PATH_TRAVERSAL,
                        ScoringRationales.PATH_TRAVERSAL_RISK(msg),
                        r,
                        line,
                    );
                } else if (r === 'SEC-LEAK-001') {
                    applyDeduction(
                        DIMENSION_CODE_SECURITY,
                        DEDUCTION_SENSITIVE_DATA_LOGGED,
                        ScoringRationales.SENSITIVE_DATA_LOGGED(msg),
                        r,
                        line,
                    );
                } else {
                    applyDeduction(
                        DIMENSION_CODE_SECURITY,
                        DEDUCTION_GENERIC_SECURITY,
                        ScoringRationales.GENERIC_SECURITY_RISK(msg),
                        r,
                        line,
                    );
                }
            } else if (
                issue.analyzer === 'secrets' ||
                r.includes('secret') ||
                r.includes('token') ||
                r.includes('key')
            ) {
                applyDeduction(
                    DIMENSION_CODE_SECURITY,
                    DEDUCTION_HARDCODED_CREDENTIAL,
                    ScoringRationales.HARDCODED_CREDENTIAL(msg),
                    r,
                    line,
                );
            } else if (r.includes('eval') || r.includes('unsafe') || r.includes('sanitization')) {
                applyDeduction(
                    DIMENSION_CODE_SECURITY,
                    DEDUCTION_POTENTIAL_INJECTION,
                    ScoringRationales.POTENTIAL_INJECTION_RISK(msg),
                    r,
                    line,
                );
            }

            // 4. Performance Efficiency
            if (issue.analyzer === 'performance') {
                if (r.includes('loop') || r.includes('alloc')) {
                    applyDeduction(
                        'performanceEfficiency',
                        DEDUCTION_TRANSIENT_LOOP_ALLOCATION,
                        ScoringRationales.TRANSIENT_LOOP_ALLOCATION(msg),
                        r,
                        line,
                    );
                } else if (r.includes('unbounded') || r.includes('leak')) {
                    applyDeduction(
                        'performanceEfficiency',
                        DEDUCTION_MEMORY_LEAK_RISK,
                        ScoringRationales.MEMORY_LEAK_RISK(msg),
                        r,
                        line,
                    );
                } else {
                    applyDeduction(
                        'performanceEfficiency',
                        DEDUCTION_INEFFICIENT_ALGORITHM,
                        ScoringRationales.INEFFICIENT_ALGORITHM_PATH(msg),
                        r,
                        line,
                    );
                }
            }

            // 5. Standardization
            if (issue.analyzer === 'governance' && r.includes('naming')) {
                applyDeduction(
                    'standardization',
                    DEDUCTION_NAMING_VIOLATION,
                    ScoringRationales.NAMING_CONVENTION_VIOLATION(msg),
                    r,
                    line,
                );
            }
            if (issue.analyzer === 'large-file' && r.includes('lines')) {
                applyDeduction(
                    'standardization',
                    DEDUCTION_LINE_COUNT_OVERFLOW,
                    ScoringRationales.LINE_COUNT_OVERFLOW(msg),
                    r,
                    line,
                );
            }

            // 6. Modernity
            if (
                issue.analyzer === 'governance' &&
                (r.includes('var') || r.includes('legacy') || r.includes('deprecated'))
            ) {
                applyDeduction(
                    'modernity',
                    DEDUCTION_DEPRECATED_FEATURE,
                    ScoringRationales.DEPRECATED_LANGUAGE_FEATURE(msg),
                    r,
                    line,
                );
            }

            // 7. Maintainability
            if (issue.analyzer === 'complexity') {
                applyDeduction(
                    'maintainability',
                    DEDUCTION_CYCLOMATIC_COMPLEXITY,
                    ScoringRationales.CYCLOMATIC_COMPLEXITY_HIGH(msg),
                    r,
                    line,
                );
            }
            if (issue.analyzer === 'large-file' && r.includes('nesting')) {
                applyDeduction(
                    'maintainability',
                    DEDUCTION_NESTING_DEPTH_OVERFLOW,
                    ScoringRationales.NESTED_BLOCK_OVERFLOW(msg),
                    r,
                    line,
                );
            }

            // 8. Comment Quality
            if (issue.analyzer === 'comments') {
                if (r.includes('banned') || r.includes('jargon') || r.includes('wip')) {
                    applyDeduction(
                        'commentQuality',
                        DEDUCTION_BANNED_JARGON,
                        ScoringRationales.BANNED_JARGON_IN_COMMENT(msg),
                        r,
                        line,
                    );
                } else if (r.includes('missing')) {
                    applyDeduction(
                        'commentQuality',
                        DEDUCTION_MISSING_PUBLIC_API_DOC,
                        ScoringRationales.MISSING_PUBLIC_API_DOC(msg),
                        r,
                        line,
                    );
                } else {
                    applyDeduction(
                        'commentQuality',
                        DEDUCTION_SUBSTANDARD_COMMENT,
                        ScoringRationales.SUBSTANDARD_COMMENT_QUALITY(msg),
                        r,
                        line,
                    );
                }
            }

            // 9. Duplication
            if (issue.analyzer === 'constants') {
                if (r.includes('duplicate')) {
                    applyDeduction(
                        'duplication',
                        DEDUCTION_DUPLICATE_LITERAL,
                        ScoringRationales.DUPLICATE_LITERAL(msg),
                        r,
                        line,
                    );
                } else if (r.includes('magic')) {
                    applyDeduction(
                        'duplication',
                        DEDUCTION_MAGIC_NUMBER,
                        ScoringRationales.MAGIC_NUMBER(msg),
                        r,
                        line,
                    );
                } else {
                    applyDeduction(
                        'duplication',
                        DEDUCTION_HARDCODED_STRING,
                        ScoringRationales.HARDCODED_STRING(msg),
                        r,
                        line,
                    );
                }
            }

            // 10. Technical Debt Risk
            if (issue.severity === 'error') {
                applyDeduction(
                    'techDebtRisk',
                    DEDUCTION_ERROR_TECH_DEBT,
                    ScoringRationales.ERROR_TECH_DEBT(msg),
                    r,
                    line,
                );
            } else if (issue.severity === 'warning') {
                applyDeduction(
                    'techDebtRisk',
                    DEDUCTION_WARNING_TECH_DEBT,
                    ScoringRationales.WARNING_TECH_DEBT(msg),
                    r,
                    line,
                );
            }
        }

        // Additional metrics-based evaluation
        if (metric) {
            if (metric.maxNestingDepth > MAX_NESTING_DEPTH) {
                applyDeduction(
                    'maintainability',
                    DEDUCTION_NESTING_DEPTH_OVERFLOW,
                    ScoringRationales.MAX_NESTING_DEPTH_OVERFLOW(metric.maxNestingDepth),
                );
            }
            if (metric.exportedSymbols > MAX_EXPORTED_SYMBOLS) {
                applyDeduction(
                    DIMENSION_ARCHITECTURE_CONSISTENCY,
                    DEDUCTION_EXCESSIVE_EXPORTED_SYMBOLS,
                    ScoringRationales.EXCESSIVE_EXPORTED_SYMBOLS(metric.exportedSymbols),
                );
            }
        }

        // Evaluability: a dimension whose analyzers are absent from the scan configuration was not
        // measured, so scoring it (0 or 100) would fabricate quality. It is excluded from the
        // weighted composite and published instead; confidence shrinks with the measured share.
        const notEvaluated = ALL_QUALITY_DIMENSIONS.filter((dim) =>
            DIMENSION_ANALYZERS[dim].every((id) => {
                if (config === undefined) return false;
                const declaration = config.analyzers?.[id];
                return declaration === undefined || declaration.enabled === false;
            }),
        );
        const evaluatedDimensions = ALL_QUALITY_DIMENSIONS.filter(
            (dim) => !notEvaluated.includes(dim),
        );

        // Compute weighted composite score over the measured weights only
        let totalWeightedScore = 0;
        let totalWeight = 0;
        let overallWeight = 0;
        for (const dim of ALL_QUALITY_DIMENSIONS) {
            overallWeight += this.weights[dim];
        }
        for (const dim of evaluatedDimensions) {
            const w = this.weights[dim];
            totalWeightedScore += rawScores[dim] * w;
            totalWeight += w;
        }
        const compositeScore =
            Math.round((totalWeightedScore / (totalWeight || 1)) * SCORE_ROUNDING) / SCORE_ROUNDING;
        const coverage =
            overallWeight === 0
                ? 1
                : Math.round((totalWeight / overallWeight) * SCORE_ROUNDING) / SCORE_ROUNDING;

        // Determine letter grade
        let grade: QualityGrade = 'F';
        if (compositeScore >= GRADE_A_PLUS_MIN) grade = 'A+';
        else if (compositeScore >= GRADE_A_MIN) grade = 'A';
        else if (compositeScore >= GRADE_B_MIN) grade = 'B';
        else if (compositeScore >= GRADE_C_MIN) grade = 'C';
        else if (compositeScore >= GRADE_D_MIN) grade = 'D';

        // Statistical confidence calculation (scaled by non-blank lines & issue density)
        const lines = metric?.nonBlankLines ?? DEFAULT_METRIC_LINES;
        const baseConfidence = Math.min(
            1.0,
            Math.max(
                CONFIDENCE_FLOOR,
                Math.round(
                    (CONFIDENCE_FLOOR +
                        Math.min(lines, CONFIDENCE_LINE_CAP) / CONFIDENCE_LINE_SCALE) *
                        PERCENT_SCALE,
                ) / PERCENT_SCALE,
            ),
        );
        // Measured-coverage factor: a scan that measured 40% of the model weight cannot claim
        // the confidence of a full scan, regardless of how many lines it read.
        const confidence =
            Math.round(
                Math.max(CONFIDENCE_FLOOR, Number(baseConfidence) * coverage) * PERCENT_SCALE,
            ) / PERCENT_SCALE;

        return {
            indices: rawScores,
            compositeScore,
            grade,
            confidence,
            weights: { ...this.weights },
            notEvaluated,
            coverage,
            rationales,
            evaluatedAt: Date.now(),
        };
    }
}
