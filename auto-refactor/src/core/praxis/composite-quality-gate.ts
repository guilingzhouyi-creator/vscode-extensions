/**
 * Module: Core Praxis — Composite Quality Gate Engine
 * File Path: src/core/praxis/composite-quality-gate.ts
 * Architecture Role: Evaluates multi-stage composite gate decisions combining static checks,
 *   dynamic tests, regression density, and long-term semantic QED trajectory thresholds.
 * Dependencies & Triggers: Consumes eloc-types and quality-efficiency-engine; called by Git hooks
 *   (pre-commit, pre-push) and audit-all.
 * Responsibilities: Evaluate multi-stage gate policies, enforce regression density limits,
 *   and block gaming or quality degradation.
 * Exit Semantics & Design Rationale: Deterministic gate evaluation; returns structured result
 *   without throwing unhandled exceptions.
 */

import type { ElocCounters, TrajectoryQualityMetrics } from '../trajectory/eloc-types';

/**
 * Lifecycle stage for composite gate threshold evaluation.
 */
export type GateStage = 'development' | 'pre-commit' | 'pre-push' | 'release';

/**
 * Immutable canonical verdict dictionary for composite quality gate evaluations.
 */
export const COMPOSITE_VERDICT = Object.freeze({
    PASS: 'PASS',
    WARN_QUALITY_DRIFT: 'WARN_QUALITY_DRIFT',
    BLOCK_STATIC_FAILURE: 'BLOCK_STATIC_FAILURE',
    BLOCK_DYNAMIC_FAILURE: 'BLOCK_DYNAMIC_FAILURE',
    BLOCK_REGRESSION: 'BLOCK_REGRESSION',
    BLOCK_QUALITY_DEGRADATION: 'BLOCK_QUALITY_DEGRADATION',
    BLOCK_GAMING_DETECTED: 'BLOCK_GAMING_DETECTED',
} as const);

/**
 * Standardized verdict codes returned by composite gate evaluations.
 */
export type CompositeVerdictCode = (typeof COMPOSITE_VERDICT)[keyof typeof COMPOSITE_VERDICT];

/**
 * Gate threshold criteria configuring acceptance limits per stage.
 */
export interface StageThresholds {
    minQed: number;
    maxRegressionDensity: number;
    minDeltaQ: number;
    allowGamingWarning: boolean;
}

/**
 * Default threshold configurations calibrated across development stages.
 */
export const STAGE_THRESHOLDS: Record<GateStage, StageThresholds> = {
    development: {
        minQed: -0.05,
        maxRegressionDensity: 50.0,
        minDeltaQ: -5.0,
        allowGamingWarning: true,
    },
    'pre-commit': {
        minQed: -0.01,
        maxRegressionDensity: 10.0,
        minDeltaQ: -2.0,
        allowGamingWarning: false,
    },
    'pre-push': {
        minQed: 0.0,
        maxRegressionDensity: 0.0,
        minDeltaQ: 0.0,
        allowGamingWarning: false,
    },
    release: {
        minQed: 0.01,
        maxRegressionDensity: 0.0,
        minDeltaQ: 0.0,
        allowGamingWarning: false,
    },
};

/**
 * Options supplied to execute composite gate verification.
 */
export interface CompositeGateOptions {
    stage?: GateStage;
    staticPass: boolean;
    dynamicPass: boolean;
    metrics: TrajectoryQualityMetrics;
    counters: ElocCounters;
    customThresholds?: Partial<StageThresholds>;
}

/**
 * Comprehensive verdict result from composite gate verification.
 */
export interface CompositeGateResult {
    passed: boolean;
    verdictCode: CompositeVerdictCode;
    violations: string[];
    warnings: string[];
    stage: GateStage;
    metrics: {
        qed: number;
        deltaQSemantic: number;
        regressionDensity: number;
        reviewYield: number;
        gamingPenalty: number;
        beforeScore: number;
        afterScore: number;
    };
    summaryText: string;
}

/**
 * Evaluates rule violations and warnings based on stage thresholds.
 */
function collectGateViolations(
    options: CompositeGateOptions,
    thresholds: StageThresholds,
    stage: GateStage,
): { violations: string[]; warnings: string[] } {
    const violations: string[] = [];
    const warnings: string[] = [];

    if (!options.staticPass) {
        violations.push('Static hygiene / AST slice / rule catalog checks failed.');
    }
    if (!options.dynamicPass) {
        violations.push('Dynamic unit tests / regression test suites failed.');
    }
    if (options.metrics.regressionDensity > thresholds.maxRegressionDensity) {
        violations.push(
            `Regression density (${options.metrics.regressionDensity} findings/kELOC) exceeds stage ${stage} threshold (${thresholds.maxRegressionDensity}).`,
        );
    }
    if (options.metrics.qed < thresholds.minQed) {
        violations.push(
            `Quality Efficiency QED (${options.metrics.qed}) is below stage ${stage} threshold (${thresholds.minQed}).`,
        );
    }
    if (options.metrics.deltaQSemantic < thresholds.minDeltaQ) {
        violations.push(
            `Semantic quality change ΔQ (${options.metrics.deltaQSemantic}) is below stage ${stage} threshold (${thresholds.minDeltaQ}).`,
        );
    }
    if (options.metrics.gamingPenalty > 0) {
        const msg = `Anti-gaming alert: superficial churn detected with 0 semantic ROI (penalty: ${options.metrics.gamingPenalty}).`;
        if (stage === 'pre-push' || stage === 'release' || !thresholds.allowGamingWarning) {
            violations.push(msg);
        } else {
            warnings.push(msg);
        }
    }

    return { violations, warnings };
}

/**
 * Resolves canonical verdict code for gate result.
 */
function resolveVerdictCode(
    options: CompositeGateOptions,
    violations: string[],
    warnings: string[],
    thresholds: StageThresholds,
): CompositeVerdictCode {
    if (!options.staticPass) return COMPOSITE_VERDICT.BLOCK_STATIC_FAILURE;
    if (!options.dynamicPass) return COMPOSITE_VERDICT.BLOCK_DYNAMIC_FAILURE;
    if (options.metrics.regressionDensity > thresholds.maxRegressionDensity)
        return COMPOSITE_VERDICT.BLOCK_REGRESSION;
    if (options.metrics.gamingPenalty > 0 && violations.some((v) => v.includes('Anti-gaming')))
        return COMPOSITE_VERDICT.BLOCK_GAMING_DETECTED;
    if (
        options.metrics.qed < thresholds.minQed ||
        options.metrics.deltaQSemantic < thresholds.minDeltaQ
    )
        return COMPOSITE_VERDICT.BLOCK_QUALITY_DEGRADATION;
    if (warnings.length > 0) return COMPOSITE_VERDICT.WARN_QUALITY_DRIFT;
    return COMPOSITE_VERDICT.PASS;
}

/**
 * Formats a clean feedback report for agent and CI environments.
 */
function formatGateSummaryText(
    stage: GateStage,
    passed: boolean,
    verdictCode: CompositeVerdictCode,
    options: CompositeGateOptions,
    violations: string[],
    warnings: string[],
): string {
    const lines: string[] = [
        `==================== COMPOSITE QUALITY GATE [${stage.toUpperCase()}] ====================`,
        `  Status: ${passed ? '✔ PASSED' : '❌ BLOCKED'} (${verdictCode})`,
        `  Score:  ${options.metrics.beforeScore} ➔ ${options.metrics.afterScore} (ΔQ: ${options.metrics.deltaQSemantic >= 0 ? '+' : ''}${options.metrics.deltaQSemantic})`,
        `  ELOC:   Processed=${options.counters.processed} | Semantic=${options.counters.semantic} | Changed=${options.counters.changed}`,
        `  QED:    ${options.metrics.qed} (ROI/semantic ELOC) | ReviewYield: ${options.metrics.reviewYield}`,
        `  Regress: Density=${options.metrics.regressionDensity} findings/kELOC (${options.metrics.debtDelta.regressionFindingsCount} issues)`,
    ];

    if (violations.length > 0) {
        lines.push('  Violations:');
        for (const v of violations) lines.push(`    • [BLOCK] ${v}`);
    }
    if (warnings.length > 0) {
        lines.push('  Warnings:');
        for (const w of warnings) lines.push(`    • [WARN] ${w}`);
    }
    lines.push('========================================================================');

    return lines.join('\n');
}

/**
 * Evaluates the 4-element composite quality gate:
 * Gate = StaticPass ∧ DynamicPass ∧ RegressionPass ∧ QualityDeltaPass(τ_phase)
 *
 * @param options - Gate inputs including static/dynamic test status and trajectory metrics.
 * @returns Comprehensive CompositeGateResult.
 */
export function evaluateCompositeGate(options: CompositeGateOptions): CompositeGateResult {
    const stage: GateStage = options.stage ?? 'pre-commit';
    const thresholds: StageThresholds = {
        ...STAGE_THRESHOLDS[stage],
        ...options.customThresholds,
    };

    const { violations, warnings } = collectGateViolations(options, thresholds, stage);
    const verdictCode = resolveVerdictCode(options, violations, warnings, thresholds);
    const passed = violations.length === 0;
    const summaryText = formatGateSummaryText(
        stage,
        passed,
        verdictCode,
        options,
        violations,
        warnings,
    );

    return {
        passed,
        verdictCode,
        violations,
        warnings,
        stage,
        metrics: {
            qed: options.metrics.qed,
            deltaQSemantic: options.metrics.deltaQSemantic,
            regressionDensity: options.metrics.regressionDensity,
            reviewYield: options.metrics.reviewYield,
            gamingPenalty: options.metrics.gamingPenalty,
            beforeScore: options.metrics.beforeScore,
            afterScore: options.metrics.afterScore,
        },
        summaryText,
    };
}
