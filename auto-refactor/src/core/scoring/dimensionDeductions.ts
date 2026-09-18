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

/** Analyzer ids matched by the deduction evaluators (named so no id literal is repeated). */
const ANALYZER_ARCHITECTURE = 'architecture';
const ANALYZER_DEPENDENCY_GRAPH = 'dependency-graph';
const ANALYZER_GOVERNANCE = 'governance';
const ANALYZER_HYGIENE = 'hygiene';
const ANALYZER_SECURITY = 'security';
const ANALYZER_SECRETS = 'secrets';
const ANALYZER_PERFORMANCE = 'performance';
const ANALYZER_LARGE_FILE = 'large-file';
const ANALYZER_COMPLEXITY = 'complexity';
const ANALYZER_COMMENTS = 'comments';
const ANALYZER_CONSTANTS = 'constants';

/** Quality dimensions written by the deduction evaluators. */
const DIMENSION_SEMANTIC_PURITY = 'semanticPurity';
const DIMENSION_STANDARDIZATION = 'standardization';
const DIMENSION_MODERNITY = 'modernity';
const DIMENSION_MAINTAINABILITY = 'maintainability';
const DIMENSION_COMMENT_QUALITY = 'commentQuality';
const DIMENSION_DUPLICATION = 'duplication';
const DIMENSION_TECH_DEBT_RISK = 'techDebtRisk';

/** Rule ids with a dedicated deduction. */
const RULE_ARCH_LEAK_002 = 'ARCH-LEAK-002';
const RULE_SEC_VUL_001 = 'SEC-VUL-001';
const RULE_SEC_VUL_002 = 'SEC-VUL-002';
const RULE_SEC_VUL_003 = 'SEC-VUL-003';
const RULE_SEC_VUL_004 = 'SEC-VUL-004';
const RULE_SEC_VUL_005 = 'SEC-VUL-005';
const RULE_SEC_VUL_006 = 'SEC-VUL-006';
const RULE_SEC_LEAK_001 = 'SEC-LEAK-001';

/** Rule-id or message fragments the evaluators match on. */
const FRAGMENT_PLACEHOLDER_MARKER = 'wip';
const FRAGMENT_LAYER = 'layer';
const FRAGMENT_BOUNDARY = 'boundary';
const FRAGMENT_LEAK = 'LEAK';
const FRAGMENT_CYCLE = 'cycle';
const FRAGMENT_CIRCULAR = 'circular';
const FRAGMENT_TYPE = 'type';
const FRAGMENT_ESCAPE = 'escape';
const FRAGMENT_DEAD = 'dead';
const FRAGMENT_UNREACHABLE = 'unreachable';
const FRAGMENT_UNUSED = 'unused';
const FRAGMENT_SECRET = 'secret';
const FRAGMENT_TOKEN = 'token';
const FRAGMENT_EVAL = 'eval';
const FRAGMENT_UNSAFE = 'unsafe';
const FRAGMENT_SANITIZATION = 'sanitization';
const FRAGMENT_LOOP = 'loop';
const FRAGMENT_ALLOC = 'alloc';
const FRAGMENT_UNBOUNDED = 'unbounded';
const FRAGMENT_LEAK_ALT = 'leak';
const FRAGMENT_NAMING = 'naming';
const FRAGMENT_LINES = 'lines';
const FRAGMENT_LEGACY = 'legacy';
const FRAGMENT_DEPRECATED = 'deprecated';
const FRAGMENT_NESTING = 'nesting';
const FRAGMENT_BANNED = 'banned';
const FRAGMENT_JARGON = 'jargon';
const FRAGMENT_MISSING = 'missing';
const FRAGMENT_DUPLICATE = 'duplicate';
const FRAGMENT_MAGIC = 'magic';
const FRAGMENT_ERROR = 'error';
const FRAGMENT_WARNING = 'warning';

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
            'performanceEfficiency',
            DEDUCTION_TRANSIENT_LOOP_ALLOCATION,
            ScoringRationales.TRANSIENT_LOOP_ALLOCATION(msg),
            r,
            line,
        );
    } else if (r.includes(FRAGMENT_UNBOUNDED) || r.includes(FRAGMENT_LEAK_ALT)) {
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
