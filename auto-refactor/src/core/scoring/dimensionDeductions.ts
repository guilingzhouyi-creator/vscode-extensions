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
import type { Issue, FileMetric } from '../types';
import { ScoringRationales } from '../messages';
import type { QualityDimension } from './scoringTypes';

const DEDUCTION_CIRCULAR_DEPENDENCY = 25;
const DEDUCTION_CRITICAL_CODE_EXECUTION = 40;
const DEDUCTION_CRITICAL_COMMAND_INJECTION = 40;
const DEDUCTION_PROTOTYPE_POLLUTION = 35;
const DEDUCTION_INSECURE_RANDOMNESS = 25;
const DEDUCTION_GENERIC_SECURITY = 25;
const DEDUCTION_HARDCODED_CREDENTIAL = 50;
const DEDUCTION_MISSING_PUBLIC_API_DOC = 8;
const DEDUCTION_DUPLICATE_LITERAL = 8;
const DEDUCTION_MAGIC_NUMBER = 4;
const DEDUCTION_HARDCODED_STRING = 3;

const DIMENSION_ARCHITECTURE_CONSISTENCY = 'architectureConsistency';
const DIMENSION_CODE_SECURITY = 'codeSecurity';

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
    'GOV-TYP': 'architectureConsistency',
    ARCH: 'architectureConsistency',
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

const DEDUCTION_DTO_CREDENTIAL_LEAK = 30;
const DEDUCTION_PATH_TRAVERSAL = 30;
const DEDUCTION_POTENTIAL_INJECTION = 30;
const DEDUCTION_LAYER_CONSTRAINT_VIOLATION = 20;
const DEDUCTION_BROKEN_HASH = 20;
const DEDUCTION_SENSITIVE_DATA_LOGGED = 20;
const DEDUCTION_MEMORY_LEAK_RISK = 20;
const DEDUCTION_ARCHITECTURE_DESIGN_VIOLATION = 15;
const DEDUCTION_TRANSIENT_LOOP_ALLOCATION = 15;
const DEDUCTION_LINE_COUNT_OVERFLOW = 15;
const DEDUCTION_CYCLOMATIC_COMPLEXITY = 15;
const DEDUCTION_BANNED_JARGON = 15;
const DEDUCTION_ERROR_TECH_DEBT = 15;
const DEDUCTION_TYPE_SAFETY_ESCAPE = 10;
const DEDUCTION_UNREACHABLE_DEAD_CODE = 10;
const DEDUCTION_INEFFICIENT_ALGORITHM = 10;
const DEDUCTION_DEPRECATED_FEATURE = 10;
const DEDUCTION_NESTING_DEPTH_OVERFLOW = 10;
const DEDUCTION_EXCESSIVE_EXPORTED_SYMBOLS = 10;
const DEDUCTION_UNUSED_BINDING = 5;
const DEDUCTION_NAMING_VIOLATION = 5;
const DEDUCTION_SUBSTANDARD_COMMENT = 5;
const DEDUCTION_WARNING_TECH_DEBT = 5;
const MAX_NESTING_DEPTH = 5;
const MAX_EXPORTED_SYMBOLS = 30;

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
 * Apply deductions for architecture consistency issues.
 *
 * @param issue - Analyzed issue finding.
 * @param apply - Deduction callback function.
 */
export function applyArchitectureDeductions(issue: Issue, apply: DeductionApplier): void {
    if (issue.analyzer !== 'architecture' && issue.analyzer !== 'dependency-graph') return;

    const line = issue.location?.start?.line;
    const r = issue.rule;
    const msg = issue.message;

    if (r === 'ARCH-LEAK-002' || r.includes('ARCH-LEAK-002')) {
        apply(
            DIMENSION_ARCHITECTURE_CONSISTENCY,
            DEDUCTION_DTO_CREDENTIAL_LEAK,
            ScoringRationales.DTO_CREDENTIAL_LEAK(msg),
            r,
            line,
        );
        apply(
            DIMENSION_CODE_SECURITY,
            DEDUCTION_DTO_CREDENTIAL_LEAK,
            ScoringRationales.DTO_CREDENTIAL_LEAK(msg),
            r,
            line,
        );
    } else if (r.includes('layer') || r.includes('boundary') || r.includes('LEAK')) {
        apply(
            DIMENSION_ARCHITECTURE_CONSISTENCY,
            DEDUCTION_LAYER_CONSTRAINT_VIOLATION,
            ScoringRationales.LAYER_CONSTRAINT_VIOLATION(msg),
            r,
            line,
        );
    } else if (r.includes('cycle') || r.includes('circular')) {
        apply(
            DIMENSION_ARCHITECTURE_CONSISTENCY,
            DEDUCTION_CIRCULAR_DEPENDENCY,
            ScoringRationales.CIRCULAR_DEPENDENCY(msg),
            r,
            line,
        );
    } else {
        apply(
            DIMENSION_ARCHITECTURE_CONSISTENCY,
            DEDUCTION_ARCHITECTURE_DESIGN_VIOLATION,
            ScoringRationales.ARCHITECTURE_DESIGN_VIOLATION(msg),
            r,
            line,
        );
    }
}

/**
 * Apply deductions for semantic purity issues.
 *
 * @param issue - Analyzed issue finding.
 * @param apply - Deduction callback function.
 */
export function applySemanticPurityDeductions(issue: Issue, apply: DeductionApplier): void {
    const line = issue.location?.start?.line;
    const r = issue.rule;
    const msg = issue.message;

    if (issue.analyzer === 'governance' && (r.includes('type') || r.includes('escape'))) {
        apply(
            'semanticPurity',
            DEDUCTION_TYPE_SAFETY_ESCAPE,
            ScoringRationales.TYPE_SAFETY_ESCAPE(msg),
            r,
            line,
        );
    }
    if (issue.analyzer === 'hygiene' && (r.includes('dead') || r.includes('unreachable'))) {
        apply(
            'semanticPurity',
            DEDUCTION_UNREACHABLE_DEAD_CODE,
            ScoringRationales.UNREACHABLE_DEAD_CODE(msg),
            r,
            line,
        );
    }
    if (issue.analyzer === 'hygiene' && r.includes('unused')) {
        apply(
            'semanticPurity',
            DEDUCTION_UNUSED_BINDING,
            ScoringRationales.UNUSED_BINDING_OR_IMPORT(msg),
            r,
            line,
        );
    }
}

/**
 * Apply deductions for code security and secrets issues.
 *
 * @param issue - Analyzed issue finding.
 * @param apply - Deduction callback function.
 */
export function applySecurityDeductions(issue: Issue, apply: DeductionApplier): void {
    const line = issue.location?.start?.line;
    const r = issue.rule;
    const msg = issue.message;

    if (issue.analyzer === 'security') {
        if (r === 'SEC-VUL-001') {
            apply(
                DIMENSION_CODE_SECURITY,
                DEDUCTION_CRITICAL_CODE_EXECUTION,
                ScoringRationales.CRITICAL_CODE_EXECUTION(msg),
                r,
                line,
            );
        } else if (r === 'SEC-VUL-002') {
            apply(
                DIMENSION_CODE_SECURITY,
                DEDUCTION_CRITICAL_COMMAND_INJECTION,
                ScoringRationales.CRITICAL_COMMAND_INJECTION(msg),
                r,
                line,
            );
        } else if (r === 'SEC-VUL-003') {
            apply(
                DIMENSION_CODE_SECURITY,
                DEDUCTION_PROTOTYPE_POLLUTION,
                ScoringRationales.PROTOTYPE_POLLUTION_RISK(msg),
                r,
                line,
            );
        } else if (r === 'SEC-VUL-004') {
            apply(
                DIMENSION_CODE_SECURITY,
                DEDUCTION_INSECURE_RANDOMNESS,
                ScoringRationales.INSECURE_RANDOMNESS_RISK(msg),
                r,
                line,
            );
        } else if (r === 'SEC-VUL-005') {
            apply(
                DIMENSION_CODE_SECURITY,
                DEDUCTION_BROKEN_HASH,
                ScoringRationales.BROKEN_HASH_ALGORITHM(msg),
                r,
                line,
            );
        } else if (r === 'SEC-VUL-006') {
            apply(
                DIMENSION_CODE_SECURITY,
                DEDUCTION_PATH_TRAVERSAL,
                ScoringRationales.PATH_TRAVERSAL_RISK(msg),
                r,
                line,
            );
        } else if (r === 'SEC-LEAK-001') {
            apply(
                DIMENSION_CODE_SECURITY,
                DEDUCTION_SENSITIVE_DATA_LOGGED,
                ScoringRationales.SENSITIVE_DATA_LOGGED(msg),
                r,
                line,
            );
        } else {
            apply(
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
        apply(
            DIMENSION_CODE_SECURITY,
            DEDUCTION_HARDCODED_CREDENTIAL,
            ScoringRationales.HARDCODED_CREDENTIAL(msg),
            r,
            line,
        );
    } else if (r.includes('eval') || r.includes('unsafe') || r.includes('sanitization')) {
        apply(
            DIMENSION_CODE_SECURITY,
            DEDUCTION_POTENTIAL_INJECTION,
            ScoringRationales.POTENTIAL_INJECTION_RISK(msg),
            r,
            line,
        );
    }
}

/**
 * Apply deductions for performance efficiency issues.
 *
 * @param issue - Analyzed issue finding.
 * @param apply - Deduction callback function.
 */
export function applyPerformanceDeductions(issue: Issue, apply: DeductionApplier): void {
    if (issue.analyzer !== 'performance') return;

    const line = issue.location?.start?.line;
    const r = issue.rule;
    const msg = issue.message;

    if (r.includes('loop') || r.includes('alloc')) {
        apply(
            'performanceEfficiency',
            DEDUCTION_TRANSIENT_LOOP_ALLOCATION,
            ScoringRationales.TRANSIENT_LOOP_ALLOCATION(msg),
            r,
            line,
        );
    } else if (r.includes('unbounded') || r.includes('leak')) {
        apply(
            'performanceEfficiency',
            DEDUCTION_MEMORY_LEAK_RISK,
            ScoringRationales.MEMORY_LEAK_RISK(msg),
            r,
            line,
        );
    } else {
        apply(
            'performanceEfficiency',
            DEDUCTION_INEFFICIENT_ALGORITHM,
            ScoringRationales.INEFFICIENT_ALGORITHM_PATH(msg),
            r,
            line,
        );
    }
}

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
    if (issue.analyzer === 'governance' && r.includes('naming')) {
        apply(
            'standardization',
            DEDUCTION_NAMING_VIOLATION,
            ScoringRationales.NAMING_CONVENTION_VIOLATION(msg),
            r,
            line,
        );
    }
    if (issue.analyzer === 'large-file' && r.includes('lines')) {
        apply(
            'standardization',
            DEDUCTION_LINE_COUNT_OVERFLOW,
            ScoringRationales.LINE_COUNT_OVERFLOW(msg),
            r,
            line,
        );
    }

    // Modernity
    if (
        issue.analyzer === 'governance' &&
        (r.includes('var') || r.includes('legacy') || r.includes('deprecated'))
    ) {
        apply(
            'modernity',
            DEDUCTION_DEPRECATED_FEATURE,
            ScoringRationales.DEPRECATED_LANGUAGE_FEATURE(msg),
            r,
            line,
        );
    }

    // Maintainability
    if (issue.analyzer === 'complexity') {
        apply(
            'maintainability',
            DEDUCTION_CYCLOMATIC_COMPLEXITY,
            ScoringRationales.CYCLOMATIC_COMPLEXITY_HIGH(msg),
            r,
            line,
        );
    }
    if (issue.analyzer === 'large-file' && r.includes('nesting')) {
        apply(
            'maintainability',
            DEDUCTION_NESTING_DEPTH_OVERFLOW,
            ScoringRationales.NESTED_BLOCK_OVERFLOW(msg),
            r,
            line,
        );
    }

    // Comment Quality
    if (issue.analyzer === 'comments') {
        if (r.includes('banned') || r.includes('jargon') || r.includes('wip')) {
            apply(
                'commentQuality',
                DEDUCTION_BANNED_JARGON,
                ScoringRationales.BANNED_JARGON_IN_COMMENT(msg),
                r,
                line,
            );
        } else if (r.includes('missing')) {
            apply(
                'commentQuality',
                DEDUCTION_MISSING_PUBLIC_API_DOC,
                ScoringRationales.MISSING_PUBLIC_API_DOC(msg),
                r,
                line,
            );
        } else {
            apply(
                'commentQuality',
                DEDUCTION_SUBSTANDARD_COMMENT,
                ScoringRationales.SUBSTANDARD_COMMENT_QUALITY(msg),
                r,
                line,
            );
        }
    }

    // Duplication
    if (issue.analyzer === 'constants') {
        if (r.includes('duplicate')) {
            apply(
                'duplication',
                DEDUCTION_DUPLICATE_LITERAL,
                ScoringRationales.DUPLICATE_LITERAL(msg),
                r,
                line,
            );
        } else if (r.includes('magic')) {
            apply(
                'duplication',
                DEDUCTION_MAGIC_NUMBER,
                ScoringRationales.MAGIC_NUMBER(msg),
                r,
                line,
            );
        } else {
            apply(
                'duplication',
                DEDUCTION_HARDCODED_STRING,
                ScoringRationales.HARDCODED_STRING(msg),
                r,
                line,
            );
        }
    }

    // Technical Debt Risk
    const debtDimension = familyDimensionOf(r) ?? 'techDebtRisk';
    if (issue.severity === 'error') {
        apply(
            debtDimension,
            DEDUCTION_ERROR_TECH_DEBT,
            ScoringRationales.ERROR_TECH_DEBT(msg),
            r,
            line,
        );
    } else if (issue.severity === 'warning') {
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
            'maintainability',
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
