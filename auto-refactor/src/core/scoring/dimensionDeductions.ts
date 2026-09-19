/**
 * Module: Core Engine — Quality Dimension Deduction Rules
 * File Path: src/core/scoring/dimensionDeductions.ts
 * Architecture Role: Rule-to-dimension deduction evaluators for transparent quality scoring.
 * Dependencies & Triggers: Imports Issue, FileMetric from ../types, ScoringRationales from
 *   ../messages, and dimension types from ./scoringTypes; called by QualityScorer.
 * Responsibilities: Map individual issues to deductions across Architecture, Security,
 *   Performance, Maintainability, Comments, Duplication, and Technical Debt dimensions.
 * Exit Semantics & Design Rationale: Pure functions with zero side effects beyond calling the
 *   provided deduction applier callback; swallows no errors and performs no I/O.
 */
import {
    DEDUCTION_MISSING_PUBLIC_API_DOC,
    DEDUCTION_DUPLICATE_LITERAL,
    DEDUCTION_MAGIC_NUMBER,
    DEDUCTION_HARDCODED_STRING,
    DIMENSION_ARCHITECTURE_CONSISTENCY,
    DEDUCTION_LINE_COUNT_OVERFLOW,
    DEDUCTION_CYCLOMATIC_COMPLEXITY,
    DEDUCTION_BANNED_JARGON,
    DEDUCTION_ERROR_TECH_DEBT,
    DEDUCTION_DEPRECATED_FEATURE,
    DEDUCTION_NESTING_DEPTH_OVERFLOW,
    DEDUCTION_EXCESSIVE_EXPORTED_SYMBOLS,
    DEDUCTION_NAMING_VIOLATION,
    DEDUCTION_SUBSTANDARD_COMMENT,
    DEDUCTION_WARNING_TECH_DEBT,
    MAX_NESTING_DEPTH,
    MAX_EXPORTED_SYMBOLS,
    ANALYZER_GOVERNANCE,
    ANALYZER_LARGE_FILE,
    ANALYZER_COMPLEXITY,
    ANALYZER_COMMENTS,
    ANALYZER_CONSTANTS,
    DIMENSION_STANDARDIZATION,
    DIMENSION_MODERNITY,
    DIMENSION_MAINTAINABILITY,
    DIMENSION_COMMENT_QUALITY,
    DIMENSION_DUPLICATION,
    DIMENSION_TECH_DEBT_RISK,
    FRAGMENT_PLACEHOLDER_MARKER,
    FRAGMENT_NAMING,
    FRAGMENT_LINES,
    FRAGMENT_LEGACY,
    FRAGMENT_DEPRECATED,
    FRAGMENT_NESTING,
    FRAGMENT_BANNED,
    FRAGMENT_JARGON,
    FRAGMENT_MISSING,
    FRAGMENT_DUPLICATE,
    FRAGMENT_MAGIC,
    FRAGMENT_ERROR,
    FRAGMENT_WARNING,
} from './dimensionLiterals';
import {
    applyArchitectureDeductions,
    applySemanticPurityDeductions,
    applySecurityDeductions,
    applyPerformanceDeductions,
} from './dimensionFamilyDeductions';
export {
    applyArchitectureDeductions,
    applySemanticPurityDeductions,
    applySecurityDeductions,
    applyPerformanceDeductions,
} from './dimensionFamilyDeductions';

import type { Issue, FileMetric } from '../types';
import { ScoringRationales } from '../messages';
import type { QualityDimension } from './scoringTypes';

/**
 * Explicit rule-family -> quality dimension routing for the quantified standard.
 */
export const FAMILY_DIMENSIONS: Record<string, QualityDimension> = {
    'GOV-PRF': 'performanceEfficiency',
    'PRF-MEM': 'performanceEfficiency',
    'PRF-IO': 'performanceEfficiency',
    'PRF-ALG': 'performanceEfficiency',
    'PRF-LEAK': 'performanceEfficiency',
    CMP: 'performanceEfficiency',
    'GOV-TYP': DIMENSION_ARCHITECTURE_CONSISTENCY,
    ARCH: DIMENSION_ARCHITECTURE_CONSISTENCY,
};

/**
 * Resolve a rule id to its explicitly routed dimension.
 *
 * @param rule - Emitted rule id.
 * @returns The routed dimension, or null when the family has no explicit owner.
 */
export function familyDimensionOf(rule: string): QualityDimension | null {
    let best: string | null = null;
    for (const prefix of Object.keys(FAMILY_DIMENSIONS)) {
        if (rule.startsWith(prefix + '-') && (best === null || prefix.length > best.length)) {
            best = prefix;
        }
    }
    return best === null ? null : FAMILY_DIMENSIONS[best];
}

/** Analyzer ids matched by the deduction evaluators (named so no id literal is repeated). */

/** Quality dimensions written by the deduction evaluators. */

/** Rule ids with a dedicated deduction. */

/** Rule-id or message fragments the evaluators match on. */

/**
 * Callback signature for applying a deduction to a quality dimension.
 */
export type DeductionApplier = (
    dim: QualityDimension,
    points: number,
    reason: string,
    rule?: string,
    line?: number,
) => void;

/**
 * Apply deductions for standardization, modernity, maintainability, comments, and duplication.
 *
 * @param issue - Analyzed issue finding.
 * @param apply - Deduction callback function.
 */
export function applyQualityDimensionDeductions(issue: Issue, apply: DeductionApplier): void {
    const line = issue.location?.start?.line;
    const r = issue.rule;
    const msg = issue.message;

    // Standardization
    if (issue.analyzer === ANALYZER_GOVERNANCE && r.includes(FRAGMENT_NAMING)) {
        apply(
            DIMENSION_STANDARDIZATION,
            DEDUCTION_NAMING_VIOLATION,
            ScoringRationales.NAMING_CONVENTION_VIOLATION(msg),
            r,
            line,
        );
    }
    if (issue.analyzer === ANALYZER_LARGE_FILE && r.includes(FRAGMENT_LINES)) {
        apply(
            DIMENSION_STANDARDIZATION,
            DEDUCTION_LINE_COUNT_OVERFLOW,
            ScoringRationales.LINE_COUNT_OVERFLOW(msg),
            r,
            line,
        );
    }

    // Modernity
    if (
        issue.analyzer === ANALYZER_GOVERNANCE &&
        (r.includes('var') || r.includes(FRAGMENT_LEGACY) || r.includes(FRAGMENT_DEPRECATED))
    ) {
        apply(
            DIMENSION_MODERNITY,
            DEDUCTION_DEPRECATED_FEATURE,
            ScoringRationales.DEPRECATED_LANGUAGE_FEATURE(msg),
            r,
            line,
        );
    }

    // Maintainability
    if (issue.analyzer === ANALYZER_COMPLEXITY) {
        apply(
            DIMENSION_MAINTAINABILITY,
            DEDUCTION_CYCLOMATIC_COMPLEXITY,
            ScoringRationales.CYCLOMATIC_COMPLEXITY_HIGH(msg),
            r,
            line,
        );
    }
    if (issue.analyzer === ANALYZER_LARGE_FILE && r.includes(FRAGMENT_NESTING)) {
        apply(
            DIMENSION_MAINTAINABILITY,
            DEDUCTION_NESTING_DEPTH_OVERFLOW,
            ScoringRationales.NESTED_BLOCK_OVERFLOW(msg),
            r,
            line,
        );
    }

    // Comment Quality
    if (issue.analyzer === ANALYZER_COMMENTS) {
        if (
            r.includes(FRAGMENT_BANNED) ||
            r.includes(FRAGMENT_JARGON) ||
            r.includes(FRAGMENT_PLACEHOLDER_MARKER)
        ) {
            apply(
                DIMENSION_COMMENT_QUALITY,
                DEDUCTION_BANNED_JARGON,
                ScoringRationales.BANNED_JARGON_IN_COMMENT(msg),
                r,
                line,
            );
        } else if (r.includes(FRAGMENT_MISSING)) {
            apply(
                DIMENSION_COMMENT_QUALITY,
                DEDUCTION_MISSING_PUBLIC_API_DOC,
                ScoringRationales.MISSING_PUBLIC_API_DOC(msg),
                r,
                line,
            );
        } else {
            apply(
                DIMENSION_COMMENT_QUALITY,
                DEDUCTION_SUBSTANDARD_COMMENT,
                ScoringRationales.SUBSTANDARD_COMMENT_QUALITY(msg),
                r,
                line,
            );
        }
    }

    // Duplication
    if (issue.analyzer === ANALYZER_CONSTANTS) {
        if (r.includes(FRAGMENT_DUPLICATE)) {
            apply(
                DIMENSION_DUPLICATION,
                DEDUCTION_DUPLICATE_LITERAL,
                ScoringRationales.DUPLICATE_LITERAL(msg),
                r,
                line,
            );
        } else if (r.includes(FRAGMENT_MAGIC)) {
            apply(
                DIMENSION_DUPLICATION,
                DEDUCTION_MAGIC_NUMBER,
                ScoringRationales.MAGIC_NUMBER(msg),
                r,
                line,
            );
        } else {
            apply(
                DIMENSION_DUPLICATION,
                DEDUCTION_HARDCODED_STRING,
                ScoringRationales.HARDCODED_STRING(msg),
                r,
                line,
            );
        }
    }

    // Technical Debt Risk
    const debtDimension = familyDimensionOf(r) ?? DIMENSION_TECH_DEBT_RISK;
    if (issue.severity === FRAGMENT_ERROR) {
        apply(
            debtDimension,
            DEDUCTION_ERROR_TECH_DEBT,
            ScoringRationales.ERROR_TECH_DEBT(msg),
            r,
            line,
        );
    } else if (issue.severity === FRAGMENT_WARNING) {
        apply(
            debtDimension,
            DEDUCTION_WARNING_TECH_DEBT,
            ScoringRationales.WARNING_TECH_DEBT(msg),
            r,
            line,
        );
    }
}

/**
 * Apply all issue-based deductions across quality dimensions.
 *
 * @param issue - Analyzed issue finding.
 * @param apply - Deduction callback function.
 */
export function applyIssueDeductions(issue: Issue, apply: DeductionApplier): void {
    applyArchitectureDeductions(issue, apply);
    applySemanticPurityDeductions(issue, apply);
    applySecurityDeductions(issue, apply);
    applyPerformanceDeductions(issue, apply);
    applyQualityDimensionDeductions(issue, apply);
}

/**
 * Apply metrics-based deductions from FileMetric data.
 *
 * @param metric - Computed file metric measurements.
 * @param apply - Deduction callback function.
 */
export function applyMetricDeductions(metric: FileMetric, apply: DeductionApplier): void {
    if (metric.maxNestingDepth > MAX_NESTING_DEPTH) {
        apply(
            DIMENSION_MAINTAINABILITY,
            DEDUCTION_NESTING_DEPTH_OVERFLOW,
            ScoringRationales.MAX_NESTING_DEPTH_OVERFLOW(metric.maxNestingDepth),
        );
    }
    if (metric.exportedSymbols > MAX_EXPORTED_SYMBOLS) {
        apply(
            DIMENSION_ARCHITECTURE_CONSISTENCY,
            DEDUCTION_EXCESSIVE_EXPORTED_SYMBOLS,
            ScoringRationales.EXCESSIVE_EXPORTED_SYMBOLS(metric.exportedSymbols),
        );
    }
}
