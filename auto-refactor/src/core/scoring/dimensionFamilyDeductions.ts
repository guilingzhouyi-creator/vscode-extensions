/**
 * Module: Core Scoring — Rule-Family Deduction Appliers
 * File Path: src/core/scoring/dimensionFamilyDeductions.ts
 * Architecture Role: Per-family deduction appliers split out of the dimension deduction table.
 * Dependencies & Triggers: ./dimensionLiterals (shared ids, points, fragments) and the
 *   DeductionApplier contract; re-exported by ./dimensionDeductions for existing callers.
 * Responsibilities: Map architecture, semantic-purity, security, and performance findings onto
 *   their quality dimensions with the documented point values.
 * Exit Semantics & Design Rationale: Pure appliers that only invoke the injected callback, so they
 *   are reusable across scans and never mutate analyzer state.
 */
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
import type { Issue } from '../types';
import { ScoringRationales } from '../messages';
import {
    DEDUCTION_CIRCULAR_DEPENDENCY,
    DEDUCTION_CRITICAL_CODE_EXECUTION,
    DEDUCTION_CRITICAL_COMMAND_INJECTION,
    DEDUCTION_PROTOTYPE_POLLUTION,
    DEDUCTION_INSECURE_RANDOMNESS,
    DEDUCTION_GENERIC_SECURITY,
    DEDUCTION_HARDCODED_CREDENTIAL,
    DIMENSION_ARCHITECTURE_CONSISTENCY,
    DIMENSION_CODE_SECURITY,
    DEDUCTION_DTO_CREDENTIAL_LEAK,
    DEDUCTION_PATH_TRAVERSAL,
    DEDUCTION_POTENTIAL_INJECTION,
    DEDUCTION_LAYER_CONSTRAINT_VIOLATION,
    DEDUCTION_BROKEN_HASH,
    DEDUCTION_SENSITIVE_DATA_LOGGED,
    DEDUCTION_MEMORY_LEAK_RISK,
    DEDUCTION_ARCHITECTURE_DESIGN_VIOLATION,
    DEDUCTION_TRANSIENT_LOOP_ALLOCATION,
    DEDUCTION_TYPE_SAFETY_ESCAPE,
    DEDUCTION_UNREACHABLE_DEAD_CODE,
    DEDUCTION_INEFFICIENT_ALGORITHM,
    DEDUCTION_UNUSED_BINDING,
    ANALYZER_ARCHITECTURE,
    ANALYZER_DEPENDENCY_GRAPH,
    ANALYZER_GOVERNANCE,
    ANALYZER_HYGIENE,
    ANALYZER_SECURITY,
    ANALYZER_SECRETS,
    ANALYZER_PERFORMANCE,
    DIMENSION_SEMANTIC_PURITY,
    RULE_ARCH_LEAK_002,
    RULE_SEC_VUL_001,
    RULE_SEC_VUL_002,
    RULE_SEC_VUL_003,
    RULE_SEC_VUL_004,
    RULE_SEC_VUL_005,
    RULE_SEC_VUL_006,
    RULE_SEC_LEAK_001,
    FRAGMENT_LAYER,
    FRAGMENT_BOUNDARY,
    FRAGMENT_LEAK,
    FRAGMENT_CYCLE,
    FRAGMENT_CIRCULAR,
    FRAGMENT_TYPE,
    FRAGMENT_ESCAPE,
    FRAGMENT_DEAD,
    FRAGMENT_UNREACHABLE,
    FRAGMENT_UNUSED,
    FRAGMENT_SECRET,
    FRAGMENT_TOKEN,
    FRAGMENT_EVAL,
    FRAGMENT_UNSAFE,
    FRAGMENT_SANITIZATION,
    FRAGMENT_LOOP,
    FRAGMENT_ALLOC,
    FRAGMENT_UNBOUNDED,
    FRAGMENT_LEAK_ALT,
} from './dimensionLiterals';
import type { DeductionApplier } from './dimensionDeductions';

/**
 * Apply deductions for architecture consistency issues.
 *
 * @param issue - Analyzed issue finding.
 * @param apply - Deduction callback function.
 */
export function applyArchitectureDeductions(issue: Issue, apply: DeductionApplier): void {
    if (issue.analyzer !== ANALYZER_ARCHITECTURE && issue.analyzer !== ANALYZER_DEPENDENCY_GRAPH)
        return;

    const line = issue.location?.start?.line;
    const r = issue.rule;
    const msg = issue.message;

    if (r === RULE_ARCH_LEAK_002 || r.includes(RULE_ARCH_LEAK_002)) {
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
    } else if (
        r.includes(FRAGMENT_LAYER) ||
        r.includes(FRAGMENT_BOUNDARY) ||
        r.includes(FRAGMENT_LEAK)
    ) {
        apply(
            DIMENSION_ARCHITECTURE_CONSISTENCY,
            DEDUCTION_LAYER_CONSTRAINT_VIOLATION,
            ScoringRationales.LAYER_CONSTRAINT_VIOLATION(msg),
            r,
            line,
        );
    } else if (r.includes(FRAGMENT_CYCLE) || r.includes(FRAGMENT_CIRCULAR)) {
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

    if (
        issue.analyzer === ANALYZER_GOVERNANCE &&
        (r.includes(FRAGMENT_TYPE) || r.includes(FRAGMENT_ESCAPE))
    ) {
        apply(
            DIMENSION_SEMANTIC_PURITY,
            DEDUCTION_TYPE_SAFETY_ESCAPE,
            ScoringRationales.TYPE_SAFETY_ESCAPE(msg),
            r,
            line,
        );
    }
    if (
        issue.analyzer === ANALYZER_HYGIENE &&
        (r.includes(FRAGMENT_DEAD) || r.includes(FRAGMENT_UNREACHABLE))
    ) {
        apply(
            DIMENSION_SEMANTIC_PURITY,
            DEDUCTION_UNREACHABLE_DEAD_CODE,
            ScoringRationales.UNREACHABLE_DEAD_CODE(msg),
            r,
            line,
        );
    }
    if (issue.analyzer === ANALYZER_HYGIENE && r.includes(FRAGMENT_UNUSED)) {
        apply(
            DIMENSION_SEMANTIC_PURITY,
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

    if (issue.analyzer === ANALYZER_SECURITY) {
        if (r === RULE_SEC_VUL_001) {
            apply(
                DIMENSION_CODE_SECURITY,
                DEDUCTION_CRITICAL_CODE_EXECUTION,
                ScoringRationales.CRITICAL_CODE_EXECUTION(msg),
                r,
                line,
            );
        } else if (r === RULE_SEC_VUL_002) {
            apply(
                DIMENSION_CODE_SECURITY,
                DEDUCTION_CRITICAL_COMMAND_INJECTION,
                ScoringRationales.CRITICAL_COMMAND_INJECTION(msg),
                r,
                line,
            );
        } else if (r === RULE_SEC_VUL_003) {
            apply(
                DIMENSION_CODE_SECURITY,
                DEDUCTION_PROTOTYPE_POLLUTION,
                ScoringRationales.PROTOTYPE_POLLUTION_RISK(msg),
                r,
                line,
            );
        } else if (r === RULE_SEC_VUL_004) {
            apply(
                DIMENSION_CODE_SECURITY,
                DEDUCTION_INSECURE_RANDOMNESS,
                ScoringRationales.INSECURE_RANDOMNESS_RISK(msg),
                r,
                line,
            );
        } else if (r === RULE_SEC_VUL_005) {
            apply(
                DIMENSION_CODE_SECURITY,
                DEDUCTION_BROKEN_HASH,
                ScoringRationales.BROKEN_HASH_ALGORITHM(msg),
                r,
                line,
            );
        } else if (r === RULE_SEC_VUL_006) {
            apply(
                DIMENSION_CODE_SECURITY,
                DEDUCTION_PATH_TRAVERSAL,
                ScoringRationales.PATH_TRAVERSAL_RISK(msg),
                r,
                line,
            );
        } else if (r === RULE_SEC_LEAK_001) {
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
        issue.analyzer === ANALYZER_SECRETS ||
        r.includes(FRAGMENT_SECRET) ||
        r.includes(FRAGMENT_TOKEN) ||
        r.includes('key')
    ) {
        apply(
            DIMENSION_CODE_SECURITY,
            DEDUCTION_HARDCODED_CREDENTIAL,
            ScoringRationales.HARDCODED_CREDENTIAL(msg),
            r,
            line,
        );
    } else if (
        r.includes(FRAGMENT_EVAL) ||
        r.includes(FRAGMENT_UNSAFE) ||
        r.includes(FRAGMENT_SANITIZATION)
    ) {
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
 * Quality dimension id scored for performance-efficiency findings.
 */
const DIMENSION_PERFORMANCE_EFFICIENCY = 'performanceEfficiency';

/**
 * Apply deductions for performance efficiency issues.
 *
 * @param issue - Analyzed issue finding.
 * @param apply - Deduction callback function.
 */
export function applyPerformanceDeductions(issue: Issue, apply: DeductionApplier): void {
    if (issue.analyzer !== ANALYZER_PERFORMANCE) return;

    const line = issue.location?.start?.line;
    const r = issue.rule;
    const msg = issue.message;

    if (r.includes(FRAGMENT_LOOP) || r.includes(FRAGMENT_ALLOC)) {
        apply(
            DIMENSION_PERFORMANCE_EFFICIENCY,
            DEDUCTION_TRANSIENT_LOOP_ALLOCATION,
            ScoringRationales.TRANSIENT_LOOP_ALLOCATION(msg),
            r,
            line,
        );
    } else if (r.includes(FRAGMENT_UNBOUNDED) || r.includes(FRAGMENT_LEAK_ALT)) {
        apply(
            DIMENSION_PERFORMANCE_EFFICIENCY,
            DEDUCTION_MEMORY_LEAK_RISK,
            ScoringRationales.MEMORY_LEAK_RISK(msg),
            r,
            line,
        );
    } else {
        apply(
            DIMENSION_PERFORMANCE_EFFICIENCY,
            DEDUCTION_INEFFICIENT_ALGORITHM,
            ScoringRationales.INEFFICIENT_ALGORITHM_PATH(msg),
            r,
            line,
        );
    }
}
