/**
 * Module: Core Engine - Role-Aware Elastic Budget Matrix
 * File Path: src/core/intelligence/elastic-budget-matrix.ts
 * Architecture Role: Multi-dimensional budget matrix providing elastic lines and complexity limits
 *   based on fine-grained file roles and effective code density metrics.
 * Dependencies & Triggers: Consumes FineGrainedFileRole and CodeDensityMetrics; consumed by
 *   large-file analyzer, architecture rules, and quality scorers.
 * Responsibilities: Resolve elastic physical line limits, effective code line (ECL) thresholds,
 *   cyclomatic complexity limits, and density-damping factors.
 * Exit Semantics & Design Rationale: Never throws; guarantees structured evaluation results
 *   preventing false-positive large-file alarms on well-documented or dictionary-heavy modules.
 */

import type { CodeDensityMetrics } from './code-density-analyzer';
import type { FineGrainedFileRole } from './file-role-inference';

const SEVERITY_BUDGET_ERROR: 'error' = 'error';
const SEVERITY_BUDGET_WARN: 'warning' = 'warning';

/** Role budget threshold contract */
export interface RoleBudgetThresholds {
    /** Physical line warning threshold */
    physicalLinesWarn: number;
    /** Physical line failure threshold */
    physicalLinesFail: number;
    /** Effective code line (ECL) warning threshold */
    effectiveLocWarn: number;
    /** Effective code line (ECL) failure threshold */
    effectiveLocFail: number;
    /** Cyclomatic complexity budget */
    complexityBudget: number;
    /** Nesting depth budget */
    nestingDepthBudget: number;
}

/** Elastic budget evaluation result */
export interface ElasticBudgetEvaluation {
    /** Effective physical line warning threshold after density damping */
    effectivePhysicalWarn: number;
    /** Effective physical line failure threshold after density damping */
    effectivePhysicalFail: number;
    /** Whether effective code line budget is exceeded */
    isEffectiveLocExceeded: boolean;
    /** Whether large file issue should be flagged */
    shouldFlagLargeFile: boolean;
    /** Violation severity level ('warning' | 'error' | null) */
    violationSeverity: 'warning' | 'error' | null;
    /** Evaluation explanation rationale */
    rationale: string;
}

// ---------------------------------------------------------------------------
// Architectural Role Baseline Budgets
// ---------------------------------------------------------------------------

const CORE_TRUNK_PHYSICAL_WARN = 500;
const CORE_TRUNK_PHYSICAL_FAIL = 900;
const CORE_TRUNK_ELOC_WARN = 350;
const CORE_TRUNK_ELOC_FAIL = 650;
const CORE_TRUNK_COMPLEXITY = 12;
const CORE_TRUNK_DEPTH = 4;

const BUSINESS_PHYSICAL_WARN = 400;
const BUSINESS_PHYSICAL_FAIL = 800;
const BUSINESS_ELOC_WARN = 280;
const BUSINESS_ELOC_FAIL = 550;
const BUSINESS_COMPLEXITY = 10;
const BUSINESS_DEPTH = 4;

const SHARED_LIB_PHYSICAL_WARN = 350;
const SHARED_LIB_PHYSICAL_FAIL = 600;
const SHARED_LIB_ELOC_WARN = 220;
const SHARED_LIB_ELOC_FAIL = 450;
const SHARED_LIB_COMPLEXITY = 8;
const SHARED_LIB_DEPTH = 3;

const ALGO_PHYSICAL_WARN = 800;
const ALGO_PHYSICAL_FAIL = 1500;
const ALGO_ELOC_WARN = 600;
const ALGO_ELOC_FAIL = 1100;
const ALGO_COMPLEXITY = 20;
const ALGO_DEPTH = 5;

const RULES_PHYSICAL_WARN = 1200;
const RULES_PHYSICAL_FAIL = 3000;
const RULES_ELOC_WARN = 800;
const RULES_ELOC_FAIL = 2000;
const RULES_COMPLEXITY = 6;
const RULES_DEPTH = 3;

const CONFIG_PHYSICAL_WARN = 1000;
const CONFIG_PHYSICAL_FAIL = 2500;
const CONFIG_ELOC_WARN = 600;
const CONFIG_ELOC_FAIL = 1500;
const CONFIG_COMPLEXITY = 4;
const CONFIG_DEPTH = 3;

const TEST_PHYSICAL_WARN = 1000;
const TEST_PHYSICAL_FAIL = 2000;
const TEST_ELOC_WARN = 700;
const TEST_ELOC_FAIL = 1400;
const TEST_COMPLEXITY = 15;
const TEST_DEPTH = 4;

const GATE_INFRA_PHYSICAL_WARN = 500;
const GATE_INFRA_PHYSICAL_FAIL = 800;
const GATE_INFRA_ELOC_WARN = 350;
const GATE_INFRA_ELOC_FAIL = 600;
const GATE_INFRA_COMPLEXITY = 15;
const GATE_INFRA_DEPTH = 4;

// ---------------------------------------------------------------------------
// Dynamic Scaling & Density Constants
// ---------------------------------------------------------------------------

const DYNAMIC_BASELINE_LOC = 400;
const DYNAMIC_FAIL_RATIO = 2.0;
const DYNAMIC_PHYSICAL_RATIO = 1.4;
const LOW_DENSITY_DAMPING_FACTOR = 1.5;
const NEUTRAL_DENSITY_FACTOR = 1.0;
const HIGH_DENSITY_VIOLATION_THRESHOLD = 0.35;

const ROLE_AUTO_GENERATED = 'auto_generated';

// ---------------------------------------------------------------------------
// Language Normalization Factors
// ---------------------------------------------------------------------------

const VERBOSITY_PYTHON = 0.7;
const VERBOSITY_GDSCRIPT = 0.75;
const VERBOSITY_STANDARD = 1.0;
const VERBOSITY_RUST = 1.25;
const VERBOSITY_C_CPP = 1.35;
const VERBOSITY_GO = 1.4;

const LANG_PYTHON = 'python';
const LANG_PY = 'py';
const LANG_GDSCRIPT = 'gdscript';
const LANG_GD = 'gd';
const LANG_TYPESCRIPT = 'typescript';
const LANG_TS = 'ts';
const LANG_JAVASCRIPT = 'javascript';
const LANG_JS = 'js';
const LANG_RUST = 'rust';
const LANG_RS = 'rs';
const LANG_GO = 'go';
const LANG_C = 'c';
const LANG_CPP = 'cpp';
const LANG_CPP_ALT = 'c++';

/** Base role budget configuration table */
const BASE_ROLE_BUDGETS: Record<FineGrainedFileRole, RoleBudgetThresholds> = {
    core_trunk: {
        physicalLinesWarn: CORE_TRUNK_PHYSICAL_WARN,
        physicalLinesFail: CORE_TRUNK_PHYSICAL_FAIL,
        effectiveLocWarn: CORE_TRUNK_ELOC_WARN,
        effectiveLocFail: CORE_TRUNK_ELOC_FAIL,
        complexityBudget: CORE_TRUNK_COMPLEXITY,
        nestingDepthBudget: CORE_TRUNK_DEPTH,
    },
    business_module: {
        physicalLinesWarn: BUSINESS_PHYSICAL_WARN,
        physicalLinesFail: BUSINESS_PHYSICAL_FAIL,
        effectiveLocWarn: BUSINESS_ELOC_WARN,
        effectiveLocFail: BUSINESS_ELOC_FAIL,
        complexityBudget: BUSINESS_COMPLEXITY,
        nestingDepthBudget: BUSINESS_DEPTH,
    },
    shared_library: {
        physicalLinesWarn: SHARED_LIB_PHYSICAL_WARN,
        physicalLinesFail: SHARED_LIB_PHYSICAL_FAIL,
        effectiveLocWarn: SHARED_LIB_ELOC_WARN,
        effectiveLocFail: SHARED_LIB_ELOC_FAIL,
        complexityBudget: SHARED_LIB_COMPLEXITY,
        nestingDepthBudget: SHARED_LIB_DEPTH,
    },
    algorithm_computation: {
        physicalLinesWarn: ALGO_PHYSICAL_WARN,
        physicalLinesFail: ALGO_PHYSICAL_FAIL,
        effectiveLocWarn: ALGO_ELOC_WARN,
        effectiveLocFail: ALGO_ELOC_FAIL,
        complexityBudget: ALGO_COMPLEXITY,
        nestingDepthBudget: ALGO_DEPTH,
    },
    rules_registry: {
        physicalLinesWarn: RULES_PHYSICAL_WARN,
        physicalLinesFail: RULES_PHYSICAL_FAIL,
        effectiveLocWarn: RULES_ELOC_WARN,
        effectiveLocFail: RULES_ELOC_FAIL,
        complexityBudget: RULES_COMPLEXITY,
        nestingDepthBudget: RULES_DEPTH,
    },
    config_constant: {
        physicalLinesWarn: CONFIG_PHYSICAL_WARN,
        physicalLinesFail: CONFIG_PHYSICAL_FAIL,
        effectiveLocWarn: CONFIG_ELOC_WARN,
        effectiveLocFail: CONFIG_ELOC_FAIL,
        complexityBudget: CONFIG_COMPLEXITY,
        nestingDepthBudget: CONFIG_DEPTH,
    },
    test_suite: {
        physicalLinesWarn: TEST_PHYSICAL_WARN,
        physicalLinesFail: TEST_PHYSICAL_FAIL,
        effectiveLocWarn: TEST_ELOC_WARN,
        effectiveLocFail: TEST_ELOC_FAIL,
        complexityBudget: TEST_COMPLEXITY,
        nestingDepthBudget: TEST_DEPTH,
    },
    auto_generated: {
        physicalLinesWarn: Number.MAX_SAFE_INTEGER,
        physicalLinesFail: Number.MAX_SAFE_INTEGER,
        effectiveLocWarn: Number.MAX_SAFE_INTEGER,
        effectiveLocFail: Number.MAX_SAFE_INTEGER,
        complexityBudget: Number.MAX_SAFE_INTEGER,
        nestingDepthBudget: Number.MAX_SAFE_INTEGER,
    },
    gate_infrastructure: {
        physicalLinesWarn: GATE_INFRA_PHYSICAL_WARN,
        physicalLinesFail: GATE_INFRA_PHYSICAL_FAIL,
        effectiveLocWarn: GATE_INFRA_ELOC_WARN,
        effectiveLocFail: GATE_INFRA_ELOC_FAIL,
        complexityBudget: GATE_INFRA_COMPLEXITY,
        nestingDepthBudget: GATE_INFRA_DEPTH,
    },
};

/**
 * Multi-language syntactic verbosity coefficients.
 * Normalizes syntactic footprint differences relative to TypeScript/JavaScript (1.0).
 */
export const LANGUAGE_VERBOSITY_FACTORS: Readonly<Record<string, number>> = {
    [LANG_PYTHON]: VERBOSITY_PYTHON,
    [LANG_PY]: VERBOSITY_PYTHON,
    [LANG_GDSCRIPT]: VERBOSITY_GDSCRIPT,
    [LANG_GD]: VERBOSITY_GDSCRIPT,
    [LANG_TYPESCRIPT]: VERBOSITY_STANDARD,
    [LANG_TS]: VERBOSITY_STANDARD,
    [LANG_JAVASCRIPT]: VERBOSITY_STANDARD,
    [LANG_JS]: VERBOSITY_STANDARD,
    [LANG_RUST]: VERBOSITY_RUST,
    [LANG_RS]: VERBOSITY_RUST,
    [LANG_GO]: VERBOSITY_GO,
    [LANG_C]: VERBOSITY_C_CPP,
    [LANG_CPP]: VERBOSITY_C_CPP,
    [LANG_CPP_ALT]: VERBOSITY_C_CPP,
};

/**
 * Resolves the verbosity factor for a given language identifier or file extension.
 *
 * @param language - Language identifier or extension (e.g., 'python', 'rs', 'go')
 * @returns Verbosity factor (defaulting to 1.0 for unspecified languages)
 */
export function getLanguageVerbosityFactor(language?: string): number {
    if (!language) return VERBOSITY_STANDARD;
    const key = language.toLowerCase().replace(/^\./, '');
    return LANGUAGE_VERBOSITY_FACTORS[key] ?? VERBOSITY_STANDARD;
}

/**
 * Retrieves baseline budget thresholds for given role, optionally scaled by language verbosity.
 *
 * @param role - Fine-grained architectural role
 * @param language - Optional language identifier for verbosity normalization
 * @param baseEffectiveLocWarn - Optional custom base effective LOC budget
 * @returns Role budget configuration
 */
export function getRoleBudget(
    role: FineGrainedFileRole,
    language?: string,
    baseEffectiveLocWarn?: number,
): RoleBudgetThresholds {
    const base = BASE_ROLE_BUDGETS[role] ?? BASE_ROLE_BUDGETS.business_module;
    const vFactor = getLanguageVerbosityFactor(language);

    if (
        baseEffectiveLocWarn !== undefined &&
        Number.isFinite(baseEffectiveLocWarn) &&
        baseEffectiveLocWarn > 0
    ) {
        // Compute dynamically based on parameterized base budget
        const roleScale = base.effectiveLocWarn / DYNAMIC_BASELINE_LOC;
        const dynamicWarn = Math.round(baseEffectiveLocWarn * vFactor * roleScale);
        const dynamicFail = Math.round(dynamicWarn * DYNAMIC_FAIL_RATIO);
        const physicalWarn = Math.round(dynamicWarn * DYNAMIC_PHYSICAL_RATIO);
        const physicalFail = Math.round(dynamicFail * DYNAMIC_PHYSICAL_RATIO);

        return {
            ...base,
            physicalLinesWarn: physicalWarn,
            physicalLinesFail: physicalFail,
            effectiveLocWarn: dynamicWarn,
            effectiveLocFail: dynamicFail,
        };
    }

    if (vFactor === VERBOSITY_STANDARD) {
        return base;
    }

    return {
        ...base,
        physicalLinesWarn: Math.round(base.physicalLinesWarn * vFactor),
        physicalLinesFail: Math.round(base.physicalLinesFail * vFactor),
        effectiveLocWarn: Math.round(base.effectiveLocWarn * vFactor),
        effectiveLocFail: Math.round(base.effectiveLocFail * vFactor),
    };
}

/**
 * Evaluates file size with elastic density damping against role budgets.
 *
 * @param role - File architectural role
 * @param metrics - Code density metrics
 * @param language - Optional language identifier for verbosity normalization
 * @param baseEffectiveLocWarn - Optional custom base effective LOC budget
 * @returns Elastic budget evaluation result
 */
export function evaluateRoleElasticBudget(
    role: FineGrainedFileRole,
    metrics: CodeDensityMetrics,
    language?: string,
    baseEffectiveLocWarn?: number,
): ElasticBudgetEvaluation {
    const base = getRoleBudget(role, language, baseEffectiveLocWarn);

    // Auto-generated code is fully exempt
    if (role === ROLE_AUTO_GENERATED) {
        return {
            effectivePhysicalWarn: Number.MAX_SAFE_INTEGER,
            effectivePhysicalFail: Number.MAX_SAFE_INTEGER,
            isEffectiveLocExceeded: false,
            shouldFlagLargeFile: false,
            violationSeverity: null,
            rationale: 'Auto-generated code is exempt from file size and complexity limits',
        };
    }

    // Well-documented or data-heavy files receive 1.5x physical line headroom damping
    const densityDampingFactor = metrics.isLowDensityDocumented
        ? LOW_DENSITY_DAMPING_FACTOR
        : NEUTRAL_DENSITY_FACTOR;
    const effectivePhysicalWarn = Math.round(base.physicalLinesWarn * densityDampingFactor);
    const effectivePhysicalFail = Math.round(base.physicalLinesFail * densityDampingFactor);

    // Evaluate effective code lines vs thresholds
    const isEclFail = metrics.effectiveCodeLines >= base.effectiveLocFail;
    const isEclWarn = metrics.effectiveCodeLines >= base.effectiveLocWarn;
    const isPhysicalFail = metrics.physicalLines >= effectivePhysicalFail;
    const isPhysicalWarn = metrics.physicalLines >= effectivePhysicalWarn;

    // Violation criteria: ECL exceeded, or physical exceeded with high density (>0.35)
    let violationSeverity: 'warning' | 'error' | null = null;
    let rationale = 'File size is within elastic complexity budget';

    if (isEclFail || (isPhysicalFail && metrics.effectiveDensity > HIGH_DENSITY_VIOLATION_THRESHOLD)) {
        violationSeverity = SEVERITY_BUDGET_ERROR;
        rationale = `Effective code lines (${metrics.effectiveCodeLines}) or physical lines (${metrics.physicalLines}) exceeds error threshold for role [${role}]`;
    } else if (isEclWarn || (isPhysicalWarn && metrics.effectiveDensity > HIGH_DENSITY_VIOLATION_THRESHOLD)) {
        violationSeverity = SEVERITY_BUDGET_WARN;
        rationale = `Effective code lines (${metrics.effectiveCodeLines}) or physical lines (${metrics.physicalLines}) exceeds warning threshold for role [${role}]`;
    }

    return {
        effectivePhysicalWarn,
        effectivePhysicalFail,
        isEffectiveLocExceeded: isEclWarn,
        shouldFlagLargeFile: violationSeverity !== null,
        violationSeverity,
        rationale,
    };
}
