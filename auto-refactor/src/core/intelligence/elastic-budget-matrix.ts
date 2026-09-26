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

/** Base role budget configuration table */
const BASE_ROLE_BUDGETS: Record<FineGrainedFileRole, RoleBudgetThresholds> = {
    core_trunk: {
        physicalLinesWarn: 500,
        physicalLinesFail: 900,
        effectiveLocWarn: 350,
        effectiveLocFail: 650,
        complexityBudget: 12,
        nestingDepthBudget: 4,
    },
    business_module: {
        physicalLinesWarn: 400,
        physicalLinesFail: 800,
        effectiveLocWarn: 280,
        effectiveLocFail: 550,
        complexityBudget: 10,
        nestingDepthBudget: 4,
    },
    shared_library: {
        physicalLinesWarn: 350,
        physicalLinesFail: 600,
        effectiveLocWarn: 220,
        effectiveLocFail: 450,
        complexityBudget: 8,
        nestingDepthBudget: 3,
    },
    algorithm_computation: {
        physicalLinesWarn: 800,
        physicalLinesFail: 1500,
        effectiveLocWarn: 600,
        effectiveLocFail: 1100,
        complexityBudget: 20,
        nestingDepthBudget: 5,
    },
    rules_registry: {
        physicalLinesWarn: 1200,
        physicalLinesFail: 3000,
        effectiveLocWarn: 800,
        effectiveLocFail: 2000,
        complexityBudget: 6,
        nestingDepthBudget: 3,
    },
    config_constant: {
        physicalLinesWarn: 1000,
        physicalLinesFail: 2500,
        effectiveLocWarn: 600,
        effectiveLocFail: 1500,
        complexityBudget: 4,
        nestingDepthBudget: 3,
    },
    test_suite: {
        physicalLinesWarn: 1000,
        physicalLinesFail: 2000,
        effectiveLocWarn: 700,
        effectiveLocFail: 1400,
        complexityBudget: 15,
        nestingDepthBudget: 4,
    },
    auto_generated: {
        physicalLinesWarn: Number.MAX_SAFE_INTEGER,
        physicalLinesFail: Number.MAX_SAFE_INTEGER,
        effectiveLocWarn: Number.MAX_SAFE_INTEGER,
        effectiveLocFail: Number.MAX_SAFE_INTEGER,
        complexityBudget: Number.MAX_SAFE_INTEGER,
        nestingDepthBudget: Number.MAX_SAFE_INTEGER,
    },
};

/**
 * Retrieves baseline budget thresholds for given role.
 *
/**
 * Multi-language syntactic verbosity coefficients.
 * Normalizes syntactic footprint differences relative to TypeScript/JavaScript (1.0).
 */
export const LANGUAGE_VERBOSITY_FACTORS: Readonly<Record<string, number>> = {
    python: 0.7,
    py: 0.7,
    gdscript: 0.75,
    gd: 0.75,
    typescript: 1.0,
    ts: 1.0,
    javascript: 1.0,
    js: 1.0,
    rust: 1.25,
    rs: 1.25,
    go: 1.4,
    c: 1.35,
    cpp: 1.35,
    'c++': 1.35,
};

/**
 * Resolves the verbosity factor for a given language identifier or file extension.
 *
 * @param language - Language identifier or extension (e.g., 'python', 'rs', 'go')
 * @returns Verbosity factor (defaulting to 1.0 for unspecified languages)
 */
export function getLanguageVerbosityFactor(language?: string): number {
    if (!language) return 1.0;
    const key = language.toLowerCase().replace(/^\./, '');
    return LANGUAGE_VERBOSITY_FACTORS[key] ?? 1.0;
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
        const roleScale = base.effectiveLocWarn / 400; // Normalized to 400 default baseline
        const dynamicWarn = Math.round(baseEffectiveLocWarn * vFactor * roleScale);
        const dynamicFail = Math.round(dynamicWarn * 2.0);
        const physicalWarn = Math.round(dynamicWarn * 1.4);
        const physicalFail = Math.round(dynamicFail * 1.4);

        return {
            ...base,
            physicalLinesWarn: physicalWarn,
            physicalLinesFail: physicalFail,
            effectiveLocWarn: dynamicWarn,
            effectiveLocFail: dynamicFail,
        };
    }

    if (vFactor === 1.0) {
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
    if (role === 'auto_generated') {
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
    const densityDampingFactor = metrics.isLowDensityDocumented ? 1.5 : 1.0;
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

    if (isEclFail || (isPhysicalFail && metrics.effectiveDensity > 0.35)) {
        violationSeverity = 'error';
        rationale = `Effective code lines (${metrics.effectiveCodeLines}) or physical lines (${metrics.physicalLines}) exceeds error threshold for role [${role}]`;
    } else if (isEclWarn || (isPhysicalWarn && metrics.effectiveDensity > 0.35)) {
        violationSeverity = 'warning';
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
