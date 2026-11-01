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
import { evaluateAntiGamingConjunction } from '../scoring/antiGaming';

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
 * One stage threshold evaluated against the run metrics.
 */
interface ThresholdCheck {
    readonly failed: boolean;
    readonly message: string;
}

/**
 * Build the metric threshold checks for one stage.
 *
 * Each check is a pure comparison plus its explanation, so adding a threshold means adding one
 * table entry instead of another nested branch — the flat table is what keeps a gate that keeps
 * growing from turning into a decision tree nobody can audit.
 *
 * @param options - Gate inputs carrying the run metrics.
 * @param thresholds - Effective thresholds for the stage.
 * @param stage - Lifecycle stage being evaluated.
 * @returns Ordered checks with their explanatory messages.
 */
function buildThresholdChecks(
    options: CompositeGateOptions,
    thresholds: StageThresholds,
    stage: GateStage,
): ThresholdCheck[] {
    const metrics = options.metrics;
    return [
        {
            failed: !options.staticPass,
            message: 'Static hygiene / AST slice / rule catalog checks failed.',
        },
        {
            failed: !options.dynamicPass,
            message: 'Dynamic unit tests / regression test suites failed.',
        },
        {
            failed: metrics.regressionDensity > thresholds.maxRegressionDensity,
            message: `Regression density (${metrics.regressionDensity} findings/kELOC) exceeds stage ${stage} threshold (${thresholds.maxRegressionDensity}).`,
        },
        {
            failed: metrics.qed < thresholds.minQed,
            message: `Quality Efficiency QED (${metrics.qed}) is below stage ${stage} threshold (${thresholds.minQed}).`,
        },
        {
            failed: metrics.deltaQSemantic < thresholds.minDeltaQ,
            message: `Semantic quality change ΔQ (${metrics.deltaQSemantic}) is below stage ${stage} threshold (${thresholds.minDeltaQ}).`,
        },
    ];
}

/**
 * Route one anti-gaming alert to violations or warnings for the current stage.
 *
 * @param message - Alert text naming the cause.
 * @param stage - Lifecycle stage being evaluated.
 * @param thresholds - Effective thresholds for the stage.
 * @param sinks - Collection bundle that receives the alert.
 * @param sinks.violations - Blocking findings for the stage.
 * @param sinks.warnings - Non-blocking drift findings for the stage.
 */
function appendGamingAlert(
    message: string,
    stage: GateStage,
    thresholds: StageThresholds,
    sinks: { violations: string[]; warnings: string[] },
): void {
    const blocking = stage === 'pre-push' || stage === 'release' || !thresholds.allowGamingWarning;
    if (blocking) {
        sinks.violations.push(message);
        return;
    }
    sinks.warnings.push(message);
}

/**
 * Whether the change claims a quality or efficiency gain.
 *
 * The conjunction is aimed at a change that claims a score gain while rewriting almost nothing.
 * A small honest bug fix also trips the ratio and the zero-debt condition, so without this guard
 * it would be frozen as gaming.
 *
 * @param metrics - Run metrics of the audited change.
 * @returns True when the change asserts an improvement.
 */
function claimsScoreGain(metrics: CompositeGateOptions['metrics']): boolean {
    return (
        metrics.deltaQSemantic > 0 || metrics.qed > 0 || metrics.afterScore > metrics.beforeScore
    );
}

/**
 * Canonical `BLOCK_GAMING_DETECTED` evaluation for one run.
 *
 * @param options - Gate inputs carrying counters and metrics.
 * @returns Conjunction verdict from the scoring SSOT operator.
 */
function evaluateGamingVerdict(options: CompositeGateOptions) {
    return evaluateAntiGamingConjunction({
        changedEloc: options.counters.semantic,
        totalEloc: options.counters.unique,
        netDebtEliminated: options.metrics.debtDelta.netDebtCleared,
        gamingPenalty: options.metrics.gamingPenalty,
        claimsScoreGain: claimsScoreGain(options.metrics),
    });
}

/**
 * Evaluates rule violations and warnings based on stage thresholds.
 *
 * @param options - Gate inputs.
 * @param thresholds - Effective thresholds for the stage.
 * @param stage - Lifecycle stage being evaluated.
 * @returns Violations that block the stage and warnings that only report drift.
 */
function collectGateViolations(
    options: CompositeGateOptions,
    thresholds: StageThresholds,
    stage: GateStage,
): { violations: string[]; warnings: string[] } {
    const sinks = { violations: [] as string[], warnings: [] as string[] };
    for (const check of buildThresholdChecks(options, thresholds, stage)) {
        if (check.failed) sinks.violations.push(check.message);
    }

    if (options.metrics.gamingPenalty > 0) {
        appendGamingAlert(
            `Anti-gaming alert: superficial churn detected with 0 semantic ROI (penalty: ${options.metrics.gamingPenalty}).`,
            stage,
            thresholds,
            sinks,
        );
    }

    // The pattern-penalty branch above already reported this run, so only the ratio-based
    // conjunction needs its own alert.
    const conjunction = evaluateGamingVerdict(options);
    if (conjunction.isGaming && options.metrics.gamingPenalty <= 0) {
        appendGamingAlert(
            `Anti-gaming alert: ${conjunction.reason ?? 'trivial semantic churn detected.'}`,
            stage,
            thresholds,
            sinks,
        );
    }

    return sinks;
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
    if (evaluateGamingVerdict(options).isGaming) return COMPOSITE_VERDICT.BLOCK_GAMING_DETECTED;
    if (
        options.metrics.qed < thresholds.minQed ||
        options.metrics.deltaQSemantic < thresholds.minDeltaQ
    )
        return COMPOSITE_VERDICT.BLOCK_QUALITY_DEGRADATION;
    if (warnings.length > 0) return COMPOSITE_VERDICT.WARN_QUALITY_DRIFT;
    return COMPOSITE_VERDICT.PASS;
}

interface GateSummaryTextOptions {
    stage: GateStage;
    passed: boolean;
    verdictCode: CompositeVerdictCode;
    options: CompositeGateOptions;
    violations: string[];
    warnings: string[];
}

/**
 * Formats a clean feedback report for agent and CI environments.
 */
function formatGateSummaryText(params: GateSummaryTextOptions): string {
    const { stage, passed, verdictCode, options, violations, warnings } = params;
    const lines: string[] = [
        `==================== COMPOSITE QUALITY GATE [${stage.toUpperCase()}] ====================`,
        `  Status: ${passed ? '✔ PASS' : '✖ BLOCK'} (${verdictCode})`,
        `  Score:  ${options.metrics.beforeScore} ➔ ${options.metrics.afterScore} (ΔQ: ${options.metrics.deltaQSemantic >= 0 ? '+' : ''}${options.metrics.deltaQSemantic})`,
        `  ELOC:   Processed=${options.counters.processed} | Semantic=${options.counters.semantic} | Changed=${options.counters.changed}`,
        `  QED:    ${options.metrics.qed} (ROI/semantic ELOC) | ReviewYield: ${options.metrics.reviewYield}`,
        `  Regress: Density=${options.metrics.regressionDensity} findings/kELOC (${options.metrics.debtDelta.regressionFindingsCount} issues)`,
    ];

    if (violations.length > 0) {
        lines.push('  Violations:');
        for (const violation of violations) lines.push(`    • [BLOCK] ${violation}`);
    }
    if (warnings.length > 0) {
        lines.push('  Warnings:');
        for (const warning of warnings) lines.push(`    • [WARN] ${warning}`);
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
    const summaryText = formatGateSummaryText({
        stage,
        passed,
        verdictCode,
        options,
        violations,
        warnings,
    });

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
