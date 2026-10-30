/**
 * Module: Core Intelligence — Role & Scale Aware Elastic Technical Debt Budget Engine
 * File Path: src/core/intelligence/elastic-debt-budget.ts
 * Architecture Role: Evaluates newly introduced technical debt against dynamic, scale-aware,
 *   and quality-fused elastic budget envelopes instead of brittle rigid zero-tolerance deadlocks.
 * Dependencies & Triggers: Zero external dependencies; consumes purely numerical debt counts,
 *   project scale metrics, and composite quality scores. Triggered by scan gates, self-audit, and ratchets.
 * Responsibilities:
 *   1. Calculate scale and health-damped dynamic debt allowances for Critical, High, Medium, and Low tiers;
 *   2. Support elastic non-zero envelopes for Critical and High debt during architectural transitions;
 *   3. Compute composite weighted technical debt scores with health score fusion;
 *   4. Supply actionable arbitration verdicts (PERMITTED_ELASTIC vs BLOCKED_EXCEEDED_BUDGET).
 * Exit Semantics & Design Rationale: CC <= 10, Depth <= 3; strictly non-throwing; returns structured
 *   ElasticDebtBudgetEvaluation. Prevents false-positive deployment blockages on healthy large-scale codebases.
 */

/**
 * Standardized technical debt tier categories.
 */
export type ElasticDebtTier = 'critical' | 'high' | 'medium' | 'low';

/**
 * Technical debt counts partitioned by severity tier.
 */
export interface DebtTierCounts {
    critical: number;
    high: number;
    medium: number;
    low: number;
}

/**
 * Weights assigned to each debt tier for composite debt pressure calculation.
 */
export interface DebtTierWeights {
    readonly critical: number;
    readonly high: number;
    readonly medium: number;
    readonly low: number;
}

/**
 * Configuration options for evaluating elastic technical debt budgets.
 */
export interface ElasticDebtBudgetOptions {
    /** Base critical debt allowance (default: 2; permits transition elasticity instead of 0-veto) */
    readonly baseCriticalAllowance?: number;
    /** Base high debt allowance (default: 5; permits transition elasticity) */
    readonly baseHighAllowance?: number;
    /** Base medium debt allowance (default: 100) */
    readonly baseMediumAllowance?: number;
    /** Base low debt allowance (default: 500) */
    readonly baseLowAllowance?: number;
    /** Total project files scanned (used for dynamic scale square-root scaling) */
    readonly totalFiles?: number;
    /** Total project effective lines of code (ECL) */
    readonly totalEloc?: number;
    /** Project composite health score in [0.0, 100.0] */
    readonly compositeScore?: number;
    /** Prior baseline debt counts to evaluate delta additions */
    readonly baselineDebt?: Partial<DebtTierCounts>;
    /** Custom tier weights for composite pressure calculation */
    readonly tierWeights?: Partial<DebtTierWeights>;
    /** Maximum permissible composite weighted growth before triggering budget breach */
    readonly maxWeightedGrowth?: number;
    /** True if evaluating cumulative repository debt rather than incremental delta */
    readonly cumulative?: boolean;
}

/**
 * Operational verdict returned by the elastic technical debt budget evaluator.
 */
export type ElasticDebtBudgetVerdict =
    | 'PERMITTED_ZERO_DEBT'
    | 'PERMITTED_ELASTIC'
    | 'BLOCKED_EXCEEDED_BUDGET';

/**
 * Specific debt tier violation detail when a budget threshold is exceeded.
 */
export interface DebtTierViolation {
    readonly tier: ElasticDebtTier;
    readonly observed: number;
    readonly delta: number;
    readonly limit: number;
    readonly message: string;
}

/**
 * Comprehensive result of evaluating technical debt against elastic dynamic budgets.
 */
export interface ElasticDebtBudgetEvaluation {
    /** True if technical debt (including Critical and High) is within the elastic envelope */
    readonly isWithinBudget: boolean;
    /** Operational verdict status */
    readonly verdict: ElasticDebtBudgetVerdict;
    /** Dynamic elastic limits computed for the current project scale and health */
    readonly dynamicLimits: DebtTierCounts;
    /** Observed raw debt counts in current scan */
    readonly observedDebt: DebtTierCounts;
    /** Delta additions over baseline */
    readonly deltaDebt: DebtTierCounts;
    /** Composite weighted debt score */
    readonly weightedDebtScore: number;
    /** Net weighted debt growth over baseline */
    readonly weightedGrowth: number;
    /** Scale multiplier derived from repository file count */
    readonly scaleFactor: number;
    /** Health elasticity factor derived from composite quality score */
    readonly healthElasticityFactor: number;
    /** Technical rationale explaining evaluation outcome */
    readonly rationale: string;
    /** List of individual tier violations if any */
    readonly violations: readonly DebtTierViolation[];
}

const DEFAULT_BASE_CRITICAL = 2;
const DEFAULT_BASE_HIGH = 5;
const DEFAULT_BASE_MEDIUM = 100;
const DEFAULT_BASE_LOW = 500;
const REFERENCE_FILE_SCALE = 200;
const DEFAULT_WEIGHTED_GROWTH_LIMIT = 50;

const DEFAULT_TIER_WEIGHTS: DebtTierWeights = Object.freeze({
    critical: 10,
    high: 3,
    medium: 1,
    low: 0.2,
});

/**
 * Resolves the health elasticity multiplier based on current composite quality score.
 * High-quality projects (A+) earn wider elastic allowances; degrading projects are tightened.
 */
function resolveHealthElasticityFactor(compositeScore?: number): number {
    if (compositeScore === undefined || Number.isNaN(compositeScore)) {
        return 1.0;
    }
    if (compositeScore >= 98.0) return 1.25;
    if (compositeScore >= 95.0) return 1.10;
    if (compositeScore >= 90.0) return 1.00;
    if (compositeScore >= 80.0) return 0.70;
    return 0.40;
}

/**
 * Resolves the scale factor using sub-linear square-root scaling based on total file count.
 */
function resolveScaleFactor(totalFiles?: number): number {
    if (!totalFiles || totalFiles <= 0) {
        return 1.0;
    }
    return Math.max(1.0, Math.round(Math.sqrt(totalFiles / REFERENCE_FILE_SCALE) * 100) / 100);
}

/**
 * Computes composite weighted debt points across all tiers.
 */
export function computeWeightedDebtPoints(
    counts: DebtTierCounts,
    weights: DebtTierWeights = DEFAULT_TIER_WEIGHTS,
): number {
    return Math.round(
        (counts.critical * weights.critical +
            counts.high * weights.high +
            counts.medium * weights.medium +
            counts.low * weights.low) *
            100,
    ) / 100;
}

/**
 * Evaluates observed technical debt against elastic, dynamic, scale-aware budgets.
 * Crucially, Critical and High debt levels are treated elastically rather than via absolute one-vote veto.
 *
 * @param observed - Current observed debt counts.
 * @param options - Calibration options (files, score, baseline, allowances).
 * @returns Comprehensive ElasticDebtBudgetEvaluation result.
 */
function computeRawObserved(observed: Partial<DebtTierCounts>): DebtTierCounts {
    return {
        critical: Math.max(0, observed.critical ?? 0),
        high: Math.max(0, observed.high ?? 0),
        medium: Math.max(0, observed.medium ?? 0),
        low: Math.max(0, observed.low ?? 0),
    };
}

function computeDeltaDebt(
    raw: DebtTierCounts,
    baseline: Partial<DebtTierCounts> = {},
): DebtTierCounts {
    return {
        critical: Math.max(0, raw.critical - (baseline.critical ?? 0)),
        high: Math.max(0, raw.high - (baseline.high ?? 0)),
        medium: Math.max(0, raw.medium - (baseline.medium ?? 0)),
        low: Math.max(0, raw.low - (baseline.low ?? 0)),
    };
}

function computeDynamicLimits(options: ElasticDebtBudgetOptions, factor: number): DebtTierCounts {
    const isCumulative = options.cumulative === true;
    const baseCrit = options.baseCriticalAllowance ?? DEFAULT_BASE_CRITICAL;
    const baseHigh = options.baseHighAllowance ?? DEFAULT_BASE_HIGH;
    const baseMed =
        options.baseMediumAllowance ??
        (isCumulative && options.totalFiles
            ? Math.max(DEFAULT_BASE_MEDIUM, Math.floor(options.totalFiles * 1.5))
            : DEFAULT_BASE_MEDIUM);
    const baseLow =
        options.baseLowAllowance ??
        (isCumulative && options.totalFiles
            ? Math.max(DEFAULT_BASE_LOW, options.totalFiles * 10)
            : DEFAULT_BASE_LOW);
    return {
        critical: Math.max(1, Math.floor(baseCrit * factor)),
        high: Math.max(2, Math.floor(baseHigh * factor)),
        medium: Math.max(10, Math.floor(baseMed * factor)),
        low: Math.max(50, Math.floor(baseLow * factor)),
    };
}

function resolveTierWeights(options: ElasticDebtBudgetOptions): DebtTierWeights {
    return {
        critical: options.tierWeights?.critical ?? DEFAULT_TIER_WEIGHTS.critical,
        high: options.tierWeights?.high ?? DEFAULT_TIER_WEIGHTS.high,
        medium: options.tierWeights?.medium ?? DEFAULT_TIER_WEIGHTS.medium,
        low: options.tierWeights?.low ?? DEFAULT_TIER_WEIGHTS.low,
    };
}

function checkTierLimit(
    tier: ElasticDebtTier,
    observed: number,
    delta: number,
    limit: number,
): DebtTierViolation | null {
    if (delta <= limit) return null;
    return {
        tier,
        observed,
        delta,
        limit,
        message: `New ${tier} debt (${delta}) exceeds dynamic elastic limit (${limit})`,
    };
}

function collectViolations(
    raw: DebtTierCounts,
    delta: DebtTierCounts,
    limits: DebtTierCounts,
    weightedScore: number,
    weightedGrowth: number,
    maxGrowthLimit: number,
): DebtTierViolation[] {
    const violations: DebtTierViolation[] = [];
    const critViolation = checkTierLimit('critical', raw.critical, delta.critical, limits.critical);
    if (critViolation) violations.push(critViolation);
    const highViolation = checkTierLimit('high', raw.high, delta.high, limits.high);
    if (highViolation) violations.push(highViolation);
    const medViolation = checkTierLimit('medium', raw.medium, delta.medium, limits.medium);
    if (medViolation) violations.push(medViolation);
    if (weightedGrowth > maxGrowthLimit) {
        violations.push({
            tier: 'critical',
            observed: weightedScore,
            delta: weightedGrowth,
            limit: maxGrowthLimit,
            message: `Composite weighted debt growth (${weightedGrowth.toFixed(1)}) exceeds growth limit (${maxGrowthLimit})`,
        });
    }
    return violations;
}

function determineVerdictAndRationale(
    raw: DebtTierCounts,
    delta: DebtTierCounts,
    violations: DebtTierViolation[],
    scaleFactor: number,
    healthFactor: number,
    limits: DebtTierCounts,
): { verdict: ElasticDebtBudgetVerdict; rationale: string } {
    if (raw.critical === 0 && raw.high === 0 && delta.medium === 0) {
        return {
            verdict: 'PERMITTED_ZERO_DEBT',
            rationale: 'Zero Critical and High technical debt observed; fully compliant.',
        };
    }
    if (violations.length === 0) {
        return {
            verdict: 'PERMITTED_ELASTIC',
            rationale:
                `Technical debt is within dynamic elastic envelope (scale=${scaleFactor.toFixed(2)}, ` +
                `healthFactor=${healthFactor.toFixed(2)}, critical=${raw.critical}/${limits.critical}, ` +
                `high=${raw.high}/${limits.high}). No one-vote veto applied.`,
        };
    }
    return {
        verdict: 'BLOCKED_EXCEEDED_BUDGET',
        rationale: `Technical debt breached elastic budget thresholds: ${violations.map((v) => v.message).join('; ')}`,
    };
}

export function evaluateElasticDebtBudget(
    observed: Partial<DebtTierCounts>,
    options: ElasticDebtBudgetOptions = {},
): ElasticDebtBudgetEvaluation {
    const rawObserved = computeRawObserved(observed);
    const deltaDebt = computeDeltaDebt(rawObserved, options.baselineDebt);
    const scaleFactor = resolveScaleFactor(options.totalFiles);
    const healthFactor = resolveHealthElasticityFactor(options.compositeScore);
    const combinedFactor = scaleFactor * healthFactor;
    const dynamicLimits = computeDynamicLimits(options, combinedFactor);
    const weights = resolveTierWeights(options);

    const weightedScore = computeWeightedDebtPoints(rawObserved, weights);
    const weightedGrowth = computeWeightedDebtPoints(deltaDebt, weights);
    const defaultGrowthLimit =
        options.cumulative && options.totalFiles
            ? Math.max(DEFAULT_WEIGHTED_GROWTH_LIMIT, options.totalFiles * 10)
            : DEFAULT_WEIGHTED_GROWTH_LIMIT;
    const maxGrowthLimit = options.maxWeightedGrowth ?? defaultGrowthLimit;

    const violations = collectViolations(
        rawObserved,
        deltaDebt,
        dynamicLimits,
        weightedScore,
        weightedGrowth,
        maxGrowthLimit,
    );
    const isWithinBudget = violations.length === 0;

    const { verdict, rationale } = determineVerdictAndRationale(
        rawObserved,
        deltaDebt,
        violations,
        scaleFactor,
        healthFactor,
        dynamicLimits,
    );

    return {
        isWithinBudget,
        verdict,
        dynamicLimits,
        observedDebt: rawObserved,
        deltaDebt,
        weightedDebtScore: weightedScore,
        weightedGrowth,
        scaleFactor,
        healthElasticityFactor: healthFactor,
        rationale,
        violations,
    };
}
