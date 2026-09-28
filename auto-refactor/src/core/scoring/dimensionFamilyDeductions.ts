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
    DEDUCTION_ARCHITECTURE_DESIGN_VIOLATION,
    DEDUCTION_TRANSIENT_LOOP_ALLOCATION,
    DEDUCTION_INEFFICIENT_ALGORITHM,
    ANALYZER_ARCHITECTURE,
    ANALYZER_DEPENDENCY_GRAPH,
    ANALYZER_SECURITY,
    ANALYZER_SECRETS,
    ANALYZER_PERFORMANCE,
    RULE_ARCH_LEAK_002,
    RULE_SEC_VUL_001,
    RULE_SEC_VUL_002,
    RULE_SEC_VUL_003,
    RULE_SEC_VUL_004,
    RULE_SEC_VUL_005,
    RULE_SEC_VUL_006,
    RULE_SEC_LEAK_001,
    FRAGMENT_SECRET,
    FRAGMENT_TOKEN,
    FRAGMENT_EVAL,
    FRAGMENT_UNSAFE,
    FRAGMENT_SANITIZATION,
    FRAGMENT_LAYER,
    FRAGMENT_BOUNDARY,
    FRAGMENT_LEAK,
    FRAGMENT_CYCLE,
    FRAGMENT_CIRCULAR,
    FRAGMENT_LOOP,
    FRAGMENT_ALLOC,
    FRAGMENT_KEY,
} from './dimensionLiterals';
import type { DeductionApplier } from './dimensionDeductions';

/** Architecture rules that breach a declared layer or boundary. */
const RULES_LAYER_CONSTRAINT = [
    'ARCH-LEAK-001',
    'ARCH-DIR-001',
    'ARCH-DIR-002',
    'ARCH-DIR-003',
    'ARCH-BND-001',
];
/** Dependency-graph rule for an import cycle. */
const RULE_IMPORT_CYCLE = 'import-cycle';
/** Performance rule for a transient allocation inside a loop body. */
const RULE_PRF_TRANSIENT_ALLOCATION = 'PRF-MEM-001';

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

    if (r === RULE_ARCH_LEAK_002) {
        // Charged to two axes on purpose: a leaked credential is an architecture breach and
        // a security defect. The security-side rationale carries a [dual-axis] tag so the
        // report can distinguish this from an accidental double charge.
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
            ScoringRationales.DTO_CREDENTIAL_LEAK_SECURITY_AXIS(msg),
            r,
            line,
        );
    } else if (
        RULES_LAYER_CONSTRAINT.includes(r) ||
        // Fragment fallback for custom architecture analyzers whose rule ids this engine cannot
        // know; built-in rules match by id first so a rename cannot silently drop the deduction.
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
    } else if (
        r === RULE_IMPORT_CYCLE ||
        r.includes(FRAGMENT_CYCLE) ||
        r.includes(FRAGMENT_CIRCULAR)
    ) {
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
type SecurityDeductionRuleHandler = (msg: string) => { deduction: number; rationale: string };

const SECURITY_RULE_MAP: Record<string, SecurityDeductionRuleHandler> = {
    [RULE_SEC_VUL_001]: (msg) => ({
        deduction: DEDUCTION_CRITICAL_CODE_EXECUTION,
        rationale: ScoringRationales.CRITICAL_CODE_EXECUTION(msg),
    }),
    [RULE_SEC_VUL_002]: (msg) => ({
        deduction: DEDUCTION_CRITICAL_COMMAND_INJECTION,
        rationale: ScoringRationales.CRITICAL_COMMAND_INJECTION(msg),
    }),
    [RULE_SEC_VUL_003]: (msg) => ({
        deduction: DEDUCTION_PROTOTYPE_POLLUTION,
        rationale: ScoringRationales.PROTOTYPE_POLLUTION_RISK(msg),
    }),
    [RULE_SEC_VUL_004]: (msg) => ({
        deduction: DEDUCTION_INSECURE_RANDOMNESS,
        rationale: ScoringRationales.INSECURE_RANDOMNESS_RISK(msg),
    }),
    [RULE_SEC_VUL_005]: (msg) => ({
        deduction: DEDUCTION_BROKEN_HASH,
        rationale: ScoringRationales.BROKEN_HASH_ALGORITHM(msg),
    }),
    [RULE_SEC_VUL_006]: (msg) => ({
        deduction: DEDUCTION_PATH_TRAVERSAL,
        rationale: ScoringRationales.PATH_TRAVERSAL_RISK(msg),
    }),
    [RULE_SEC_LEAK_001]: (msg) => ({
        deduction: DEDUCTION_SENSITIVE_DATA_LOGGED,
        rationale: ScoringRationales.SENSITIVE_DATA_LOGGED(msg),
    }),
};

function resolveSecurityDeduction(
    analyzer: string | undefined,
    rule: string,
    msg: string,
): { deduction: number; rationale: string } | null {
    if (analyzer === ANALYZER_SECURITY) {
        const handler = SECURITY_RULE_MAP[rule];
        if (handler) return handler(msg);
        return {
            deduction: DEDUCTION_GENERIC_SECURITY,
            rationale: ScoringRationales.GENERIC_SECURITY_RISK(msg),
        };
    }
    if (
        analyzer === ANALYZER_SECRETS ||
        rule.includes(FRAGMENT_SECRET) ||
        rule.includes(FRAGMENT_TOKEN) ||
        rule.includes(FRAGMENT_KEY)
    ) {
        return {
            deduction: DEDUCTION_HARDCODED_CREDENTIAL,
            rationale: ScoringRationales.HARDCODED_CREDENTIAL(msg),
        };
    }
    if (
        rule.includes(FRAGMENT_EVAL) ||
        rule.includes(FRAGMENT_UNSAFE) ||
        rule.includes(FRAGMENT_SANITIZATION)
    ) {
        return {
            deduction: DEDUCTION_POTENTIAL_INJECTION,
            rationale: ScoringRationales.POTENTIAL_INJECTION_RISK(msg),
        };
    }
    return null;
}

/**
 * Apply deductions for code security and secrets issues.
 *
 * @param issue - Analyzed issue finding.
 * @param apply - Deduction callback function.
 */
export function applySecurityDeductions(issue: Issue, apply: DeductionApplier): void {
    const r = issue.rule;
    const msg = issue.message;
    const resolution = resolveSecurityDeduction(issue.analyzer, r, msg);
    if (!resolution) return;

    apply(
        DIMENSION_CODE_SECURITY,
        resolution.deduction,
        resolution.rationale,
        r,
        issue.location?.start?.line,
    );
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

    if (
        r === RULE_PRF_TRANSIENT_ALLOCATION ||
        r.includes(FRAGMENT_LOOP) ||
        r.includes(FRAGMENT_ALLOC)
    ) {
        apply(
            DIMENSION_PERFORMANCE_EFFICIENCY,
            DEDUCTION_TRANSIENT_LOOP_ALLOCATION,
            ScoringRationales.TRANSIENT_LOOP_ALLOCATION(msg),
            r,
            line,
        );
    } else {
        // Blocking-I/O and nested-loop findings both land here: the model has no dedicated I/O
        // deduction, and an unlisted rule must still deduct rather than silently score 100.
        apply(
            DIMENSION_PERFORMANCE_EFFICIENCY,
            DEDUCTION_INEFFICIENT_ALGORITHM,
            ScoringRationales.INEFFICIENT_ALGORITHM_PATH(msg),
            r,
            line,
        );
    }
}
