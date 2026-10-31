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

const DIMENSION_PERFORMANCE_EFFICIENCY = 'performanceEfficiency';

interface FamilyDeductionEntry {
    readonly dimension:
    | typeof DIMENSION_ARCHITECTURE_CONSISTENCY
    | typeof DIMENSION_CODE_SECURITY
    | typeof DIMENSION_PERFORMANCE_EFFICIENCY;
    readonly deduction: number;
    readonly rationale: (msg: string) => string;
}

interface FamilyRuleSpec {
    readonly matches: (ruleId: string, analyzer?: string) => boolean;
    readonly entries: readonly FamilyDeductionEntry[];
}

function containsRuleFragment(ruleId: string, fragment: string): boolean {
    return ruleId.includes(fragment);
}

function hasRuleOrFragment(
    ruleId: string,
    rules: readonly string[],
    fragments: readonly string[],
): boolean {
    if (rules.includes(ruleId)) {
        return true;
    }
    for (let i = 0; i < fragments.length; i++) {
        if (containsRuleFragment(ruleId, fragments[i])) {
            return true;
        }
    }
    return false;
}

const ARCHITECTURE_FAMILY_RULES: readonly FamilyRuleSpec[] = [
    {
        matches: (ruleId) => ruleId === RULE_ARCH_LEAK_002,
        entries: [
            {
                dimension: DIMENSION_ARCHITECTURE_CONSISTENCY,
                deduction: DEDUCTION_DTO_CREDENTIAL_LEAK,
                rationale: ScoringRationales.DTO_CREDENTIAL_LEAK,
            },
            {
                dimension: DIMENSION_CODE_SECURITY,
                deduction: DEDUCTION_DTO_CREDENTIAL_LEAK,
                rationale: ScoringRationales.DTO_CREDENTIAL_LEAK_SECURITY_AXIS,
            },
        ],
    },
    {
        matches: (ruleId) =>
            hasRuleOrFragment(ruleId, RULES_LAYER_CONSTRAINT, [
                FRAGMENT_LAYER,
                FRAGMENT_BOUNDARY,
                FRAGMENT_LEAK,
            ]),
        entries: [
            {
                dimension: DIMENSION_ARCHITECTURE_CONSISTENCY,
                deduction: DEDUCTION_LAYER_CONSTRAINT_VIOLATION,
                rationale: ScoringRationales.LAYER_CONSTRAINT_VIOLATION,
            },
        ],
    },
    {
        matches: (ruleId) =>
            hasRuleOrFragment(ruleId, [RULE_IMPORT_CYCLE], [FRAGMENT_CYCLE, FRAGMENT_CIRCULAR]),
        entries: [
            {
                dimension: DIMENSION_ARCHITECTURE_CONSISTENCY,
                deduction: DEDUCTION_CIRCULAR_DEPENDENCY,
                rationale: ScoringRationales.CIRCULAR_DEPENDENCY,
            },
        ],
    },
    {
        matches: () => true,
        entries: [
            {
                dimension: DIMENSION_ARCHITECTURE_CONSISTENCY,
                deduction: DEDUCTION_ARCHITECTURE_DESIGN_VIOLATION,
                rationale: ScoringRationales.ARCHITECTURE_DESIGN_VIOLATION,
            },
        ],
    },
];

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

const PERFORMANCE_FAMILY_RULES: readonly FamilyRuleSpec[] = [
    {
        matches: (ruleId) =>
            hasRuleOrFragment(
                ruleId,
                [RULE_PRF_TRANSIENT_ALLOCATION],
                [FRAGMENT_LOOP, FRAGMENT_ALLOC],
            ),
        entries: [
            {
                dimension: DIMENSION_PERFORMANCE_EFFICIENCY,
                deduction: DEDUCTION_TRANSIENT_LOOP_ALLOCATION,
                rationale: ScoringRationales.TRANSIENT_LOOP_ALLOCATION,
            },
        ],
    },
    {
        matches: () => true,
        entries: [
            {
                dimension: DIMENSION_PERFORMANCE_EFFICIENCY,
                deduction: DEDUCTION_INEFFICIENT_ALGORITHM,
                rationale: ScoringRationales.INEFFICIENT_ALGORITHM_PATH,
            },
        ],
    },
];

function dispatchFamilyRules(
    issue: Issue,
    rules: readonly FamilyRuleSpec[],
    apply: DeductionApplier,
): void {
    const line = issue.location?.start?.line;
    const ruleId = issue.rule;
    const msg = issue.message;
    for (let i = 0; i < rules.length; i++) {
        const spec = rules[i];
        if (!spec.matches(ruleId, issue.analyzer)) {
            continue;
        }
        for (let j = 0; j < spec.entries.length; j++) {
            const entry = spec.entries[j];
            apply(entry.dimension, entry.deduction, entry.rationale(msg), ruleId, line);
        }
        return;
    }
}

/**
 * Apply deductions for architecture consistency issues.
 *
 * @param issue - Analyzed issue finding.
 * @param apply - Deduction callback function.
 */
export function applyArchitectureDeductions(issue: Issue, apply: DeductionApplier): void {
    if (issue.analyzer !== ANALYZER_ARCHITECTURE && issue.analyzer !== ANALYZER_DEPENDENCY_GRAPH) {
        return;
    }
    dispatchFamilyRules(issue, ARCHITECTURE_FAMILY_RULES, apply);
}

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
        hasRuleOrFragment(rule, [], [FRAGMENT_SECRET, FRAGMENT_TOKEN, FRAGMENT_KEY])
    ) {
        return {
            deduction: DEDUCTION_HARDCODED_CREDENTIAL,
            rationale: ScoringRationales.HARDCODED_CREDENTIAL(msg),
        };
    }
    if (hasRuleOrFragment(rule, [], [FRAGMENT_EVAL, FRAGMENT_UNSAFE, FRAGMENT_SANITIZATION])) {
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
    const ruleId = issue.rule;
    const msg = issue.message;
    const resolution = resolveSecurityDeduction(issue.analyzer, ruleId, msg);
    if (!resolution) return;

    apply(
        DIMENSION_CODE_SECURITY,
        resolution.deduction,
        resolution.rationale,
        ruleId,
        issue.location?.start?.line,
    );
}

/**
 * Apply deductions for performance efficiency issues.
 *
 * @param issue - Analyzed issue finding.
 * @param apply - Deduction callback function.
 */
export function applyPerformanceDeductions(issue: Issue, apply: DeductionApplier): void {
    if (issue.analyzer !== ANALYZER_PERFORMANCE) return;
    dispatchFamilyRules(issue, PERFORMANCE_FAMILY_RULES, apply);
}
