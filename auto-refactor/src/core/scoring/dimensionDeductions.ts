/**
 * Module: Core Engine — Quality Dimension Deduction Rules
 * File Path: src/core/scoring/dimensionDeductions.ts
 * Architecture Role: Rule-to-dimension deduction evaluators for transparent quality scoring.
 * Dependencies & Triggers: Imports Issue, FileMetric from ../types, ScoringRationales from
 *   ../messages, and dimension types from ./scoringTypes; called by QualityScorer.
 * Responsibilities: Run the declarative table from ./dimensionRuleTable (standardization,
 *   modernity, semantic purity, maintainability, comments, duplication), add the severity debt
 *   fallback, delegate architecture/security/performance families to
 *   ./dimensionFamilyDeductions, and apply file-metric deductions (nesting, exported symbols).
 * Exit Semantics & Design Rationale: Pure functions with zero side effects beyond calling the
 *   provided deduction applier callback; swallows no errors and performs no I/O.
 */
import {
    DEDUCTION_ERROR_TECH_DEBT,
    DEDUCTION_NESTING_DEPTH_OVERFLOW,
    DEDUCTION_EXCESSIVE_EXPORTED_SYMBOLS,
    DEDUCTION_WARNING_TECH_DEBT,
    MAX_NESTING_DEPTH,
    MAX_EXPORTED_SYMBOLS,
    DIMENSION_ARCHITECTURE_CONSISTENCY,
    DIMENSION_MAINTAINABILITY,
    DIMENSION_TECH_DEBT_RISK,
    DIMENSION_PERFORMANCE_EFFICIENCY,
    DIMENSION_MODERNITY,
    DIMENSION_STANDARDIZATION,
    FRAGMENT_ERROR,
    FRAGMENT_WARNING,
} from './dimensionLiterals';
import { DIMENSION_RULES } from './dimensionRuleTable';
import {
    applyArchitectureDeductions,
    applySecurityDeductions,
    applyPerformanceDeductions,
} from './dimensionFamilyDeductions';
export {
    applyArchitectureDeductions,
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
    'GOV-PRF': DIMENSION_PERFORMANCE_EFFICIENCY,
    'PRF-MEM': DIMENSION_PERFORMANCE_EFFICIENCY,
    'PRF-IO': DIMENSION_PERFORMANCE_EFFICIENCY,
    'PRF-ALG': DIMENSION_PERFORMANCE_EFFICIENCY,
    'PRF-LEAK': DIMENSION_PERFORMANCE_EFFICIENCY,
    'PRF-POL': DIMENSION_PERFORMANCE_EFFICIENCY,
    CMP: DIMENSION_PERFORMANCE_EFFICIENCY,
    'GOV-TYP': DIMENSION_ARCHITECTURE_CONSISTENCY,
    ARCH: DIMENSION_ARCHITECTURE_CONSISTENCY,
    'ARCH-HDL': DIMENSION_ARCHITECTURE_CONSISTENCY,
    'ARCH-CFG': DIMENSION_ARCHITECTURE_CONSISTENCY,
    'ARCH-BLR': DIMENSION_ARCHITECTURE_CONSISTENCY,
    'ARCH-SKL': DIMENSION_ARCHITECTURE_CONSISTENCY,
    'ARCH-ROL': DIMENSION_ARCHITECTURE_CONSISTENCY,
    'ARCH-UTL': DIMENSION_ARCHITECTURE_CONSISTENCY,
    'ARCH-ABS': DIMENSION_ARCHITECTURE_CONSISTENCY,
    'CPX-REC': DIMENSION_MAINTAINABILITY,
    'CPX-BUD': DIMENSION_MAINTAINABILITY,
    'CPX-JST': DIMENSION_MAINTAINABILITY,
    'CPX-HOP': DIMENSION_MAINTAINABILITY,
    'CPX-RED': DIMENSION_MAINTAINABILITY,
    CPX: DIMENSION_PERFORMANCE_EFFICIENCY,
    'DAT-LAY': DIMENSION_ARCHITECTURE_CONSISTENCY,
    'DAT-DEF': DIMENSION_ARCHITECTURE_CONSISTENCY,
    DAT: DIMENSION_PERFORMANCE_EFFICIENCY,
    'TST-TAU': DIMENSION_MAINTAINABILITY,
    'TST-DBT': DIMENSION_MAINTAINABILITY,
    TST: DIMENSION_MODERNITY,
    'DEP-LAZ': DIMENSION_ARCHITECTURE_CONSISTENCY,
    'DEP-RES': DIMENSION_ARCHITECTURE_CONSISTENCY,
    'DEP-INV': DIMENSION_ARCHITECTURE_CONSISTENCY,
    'DEP-ORD': DIMENSION_STANDARDIZATION,
    'DEP-WLD': DIMENSION_STANDARDIZATION,
    DEP: DIMENSION_STANDARDIZATION,
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
 * Apply the declarative dimension rules, then the severity-based technical-debt deduction.
 *
 * Each dimension is deducted at most once per finding: the first table row that covers the
 * finding wins, and later rows for the same dimension are skipped, so the catch-all row can be
 * written last without negating every specific rule.
 *
 * @param issue - Analyzed issue finding.
 * @param apply - Deduction callback function.
 */
export function applyQualityDimensionDeductions(issue: Issue, apply: DeductionApplier): void {
    const line = issue.location?.start?.line;
    const claimed = new Set<QualityDimension>();
    for (const rule of DIMENSION_RULES) {
        if (rule.analyzer !== issue.analyzer) continue;
        if (claimed.has(rule.dimension)) continue;
        if (!rule.covers(issue)) continue;
        claimed.add(rule.dimension);
        apply(rule.dimension, rule.points, rule.rationale(issue.message), issue.rule, line);
    }
    applySeverityDeductions(issue, apply, claimed, line);
}

/**
 * List the analyzers that can deduct each dimension, derived from the rule table.
 *
 * The coverage model in `DIMENSION_ANALYZERS` decides which axes count as measured, so the two
 * must agree: a deduction from an analyzer a dimension does not declare would be scored without
 * being counted as measured. `techDebtRisk` is the documented exception — every analyzer feeds
 * it through the severity fallback above.
 *
 * @returns Analyzer ids per dimension, one entry per table row (an id may repeat).
 */
export function dimensionDeductionSources(): Record<QualityDimension, string[]> {
    // Accumulated as delimited text so the loop allocates nothing and runs no linear search.
    const joined = new Map<QualityDimension, string>();
    for (const rule of DIMENSION_RULES) {
        joined.set(rule.dimension, (joined.get(rule.dimension) ?? '') + rule.analyzer + '|');
    }
    const result = {} as Record<QualityDimension, string[]>;
    for (const [dimension, analyzers] of joined) {
        result[dimension] = analyzers.split('|').filter(Boolean).sort();
    }
    return result;
}

/**
 * Apply the severity-based technical-debt deduction that every analyzer feeds.
 *
 * The dimension is the finding's explicitly routed family dimension when it has one, so a rule
 * with a dedicated axis is never double-counted as generic debt. When that dedicated dimension
 * has already been deducted by the rule table, the severity deduction is routed to
 * DIMENSION_TECH_DEBT_RISK to prevent unfair double penalty on the primary quality dimension.
 *
 * @param issue - Analyzed issue finding.
 * @param apply - Deduction callback function.
 * @param claimed - Optional set of dimensions already deducted by rule table.
 * @param line - Start line of the finding, when known.
 */
function applySeverityDeductions(
    issue: Issue,
    apply: DeductionApplier,
    claimed?: Set<QualityDimension>,
    line?: number,
): void {
    let debtDimension = familyDimensionOf(issue.rule) ?? DIMENSION_TECH_DEBT_RISK;
    if (claimed && claimed.has(debtDimension)) {
        debtDimension = DIMENSION_TECH_DEBT_RISK;
    }
    if (issue.severity === FRAGMENT_ERROR) {
        apply(
            debtDimension,
            DEDUCTION_ERROR_TECH_DEBT,
            ScoringRationales.ERROR_TECH_DEBT(issue.message),
            issue.rule,
            line,
        );
    } else if (issue.severity === FRAGMENT_WARNING) {
        apply(
            debtDimension,
            DEDUCTION_WARNING_TECH_DEBT,
            ScoringRationales.WARNING_TECH_DEBT(issue.message),
            issue.rule,
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
