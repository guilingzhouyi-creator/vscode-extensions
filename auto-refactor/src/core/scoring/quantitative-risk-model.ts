/**
 * Module: Core Scoring — Quantitative Risk Model & Financial Debt Metrics
 * File Path: src/core/scoring/quantitative-risk-model.ts
 * Architecture Role: Mathematical calculation engine for financial capital debt,
 *   volatility-adjusted quality risk, debt inequality distribution, and stochastic dynamics.
 * Dependencies & Triggers: Pure mathematical library; consumed by qualityScorer,
 *   aas-reporter, and audit telemetry.
 * Responsibilities:
 *   1. Compute financial debt ledger: principal, interest drag, and interest coverage ratio (ICR).
 *   2. Compute risk-adjusted quality metrics: Sharpe ratio (QSR), Sortino ratio, VaR 95%, MDD.
 *   3. Compute debt inequality economics: Gini coefficient and rule family Shannon entropy.
 *   4. Compute stochastic dynamics: Ornstein-Uhlenbeck mean-reversion half-life and
 *      excess kurtosis.
 * Exit Semantics & Design Rationale: Pure, non-throwing, zero I/O functions. Strictly bounded
 *   to CC <= 12, Depth <= 3, and execution time <= 3ms.
 */

/** Standard fallback baseline score when historical sampling is unavailable. */
export const RISK_BASELINE_SCORE = 90.0;

/** Default sliding window size for historical quality risk analysis. */
export const DEFAULT_RISK_WINDOW_SIZE = 30;

/** Minimum sample count required for statistically meaningful risk metrics. */
export const MIN_RISK_SAMPLE_SIZE = 5;

/** Maximum allowable sliding window size to preserve recent sensitivity. */
export const MAX_RISK_WINDOW_SIZE = 50;

/** Saturation ceiling for Sharpe and Sortino ratios to prevent infinite values. */
export const RATIO_SATURATION_CEILING = 999.0;

/** Normal distribution critical value for single-tailed 95% confidence interval. */
export const GAUSSIAN_Z_95 = 1.645;

/** Standard regularized risk resolution epsilon when empirical deviation is zero. */
export const MIN_RISK_DEV_EPSILON = 0.05;

/** Drag friction calibration factor mapping churn and fan-in to interest drag. */
export const DEFAULT_DRAG_FRICTION_COEFFICIENT = 0.08;

/** Churn scaling denominator for hyperbolic tangent dampening. */
export const CHURN_SCALE_DENOMINATOR = 4.0;

/** Minutes in an engineering work hour. */
export const MINUTES_IN_HOUR = 60.0;

/** Minimum positive epsilon to avoid division by zero in ratios. */
export const EPSILON_FLOAT = 1e-4;

/** Threshold for excess kurtosis signifying heavy-tailed (Leptokurtic) distribution. */
export const FAT_TAIL_KURTOSIS_THRESHOLD = 3.0;

/** Numeric scale factor for percentages and rounding. */
const PERCENT_SCALE = 100.0;

/** Normal distribution baseline kurtosis subtracted for excess kurtosis. */
const NORMAL_DISTRIBUTION_KURTOSIS = 3.0;

/** Minimum sample count required for kurtosis calculation. */
const MIN_KURTOSIS_SAMPLE_COUNT = 4;

const STATUS_DE_LEVERAGING = 'de-leveraging' as const;
const STATUS_BALANCED = 'balanced' as const;
const STATUS_INSOLVENT = 'insolvent' as const;
const STATUS_INSUFFICIENT_SAMPLES = 'insufficient_samples' as const;

const CLEARANCE_ACTIVE_CLEARING = 'active-clearing' as const;
const CLEARANCE_BALANCED = 'balanced' as const;
const CLEARANCE_DEFICIT_GROWING = 'deficit-growing' as const;
const CLEARANCE_INSUFFICIENT_SAMPLES = 'insufficient_samples' as const;

/**
 * Single file record carrying remediation effort and topological centrality.
 */
export interface FileDebtItem {
    readonly filePath: string;
    readonly remediationMinutes: number;
    readonly churn30d?: number;
    readonly fanIn?: number;
}

/**
 * Input envelope for financial debt ledger quantification.
 */
export interface FinancialDebtInput {
    readonly totalRemediationMinutes?: number;
    readonly fileDebts?: readonly FileDebtItem[];
    readonly refactoringYieldMinutes?: number;
    readonly debtAccrualMinutes?: number;
    readonly dragFriction?: number;
}

/**
 * Result metrics for financial capital debt and interest coverage.
 */
export interface FinancialDebtMetrics {
    readonly principalHours: number;
    readonly interestDragHours: number;
    readonly interestCoverageRatio: number;
    /** Native term: Remediation Clearance Ratio (RCR) */
    readonly rcr: number;
    /** Native term: Technical Deficit Stock (TDS) in hours */
    readonly deficitStockHours: number;
    /** Native term: Complexity Friction Drag (CFD) in hours */
    readonly frictionDragHours: number;
    readonly status: 'de-leveraging' | 'balanced' | 'insolvent' | 'insufficient_samples';
    /** Native status tag */
    readonly clearanceStatus: 'active-clearing' | 'balanced' | 'deficit-growing' | 'insufficient_samples';
}

/**
 * Input envelope for volatility and downside risk evaluation.
 */
export interface QualityRiskInput {
    readonly historyScores: readonly number[];
    readonly windowSize?: number;
    readonly baselineScore?: number;
}

/**
 * Result metrics for risk-adjusted quality performance.
 */
export interface QualityRiskMetrics {
    readonly qsr: number;
    readonly sortino: number;
    readonly var95: number;
    readonly mdd: number;
    /** Native term: Engineering Resilience Quotient (ERQ, alias for qsr) */
    readonly erq: number;
    /** Native term: Downside Defense Ratio (DDR, alias for sortino) */
    readonly ddr: number;
    /** Native term: Extreme Degradation Bound at 95% confidence (EDB-95, alias for var95) */
    readonly edb95: number;
    /** Native term: Peak-to-Trough Degradation (PTD, alias for mdd) */
    readonly ptd: number;
    readonly meanScore: number;
    readonly standardDeviation: number;
    readonly downsideDeviation: number;
    readonly isSampleSufficient: boolean;
}

/**
 * Input envelope for debt inequality and defect entropy analysis.
 */
export interface InequalityInput {
    readonly fileDebts: readonly number[];
    readonly ruleCategoryCounts?: Record<string, number>;
}

/**
 * Result metrics for debt concentration and rule family entropy.
 */
export interface InequalityMetrics {
    readonly debtGini: number;
    readonly defectEntropy: number;
    /** Native term: Debt Skewness Index (DSI, alias for debtGini) */
    readonly dsi: number;
    /** Native term: Root-Cause Dispersion (RCD, alias for defectEntropy) */
    readonly rcd: number;
    readonly totalDebtItems: number;
}

/**
 * Input envelope for stochastic mean reversion and tail-risk dynamics.
 */
export interface StochasticInput {
    readonly historyScores: readonly number[];
    readonly complexityValues?: readonly number[];
}

/**
 * Result metrics for Ornstein-Uhlenbeck reversion and excess kurtosis.
 */
export interface StochasticMetrics {
    readonly halfLifeCommits: number;
    /** Native term: Elastic Healing Half-Life in commits (EHL, alias for halfLifeCommits) */
    readonly ehl: number;
    readonly reversionRateTheta: number;
    readonly kurtosisCc: number;
    readonly isFatTailed: boolean;
}

/**
 * Consolidated parameter object for evaluating unified quantitative risk assessment.
 */
export interface QuantitativeRiskModelParams {
    readonly financial: FinancialDebtInput;
    readonly risk: QualityRiskInput;
    readonly inequality: InequalityInput;
    readonly stochastic: StochasticInput;
}

/**
 * Unified quantitative risk assessment aggregating all mathematical domains.
 */
export interface QuantitativeRiskAssessment {
    readonly financial: FinancialDebtMetrics;
    readonly riskRatios: QualityRiskMetrics;
    readonly inequality: InequalityMetrics;
    readonly stochastic: StochasticMetrics;
    /** Native alias: Debt Dynamics domain */
    readonly debtDynamics?: FinancialDebtMetrics;
    /** Native alias: Temporal Resilience domain */
    readonly temporalResilience?: QualityRiskMetrics;
    /** Native alias: Spatial Dispersion domain */
    readonly spatialDispersion?: InequalityMetrics;
}

/**
 * Helper to round a number to two decimal places safely.
 */
function roundTwoDecimals(inputNumericValue: number): number {
    return Number.isFinite(inputNumericValue) ? Math.round(inputNumericValue * PERCENT_SCALE) / PERCENT_SCALE : 0.0;
}

/**
 * Compute technical debt principal and interest drag from file topology.
 */
function calculateDragFromFiles(
    files: readonly FileDebtItem[],
    friction: number,
): { principalMinutes: number; dragMinutes: number } {
    let principalMinutes = 0;
    let dragMinutes = 0;
    for (const item of files) {
        if (!Number.isFinite(item.remediationMinutes) || item.remediationMinutes <= 0) {
            continue;
        }
        principalMinutes += item.remediationMinutes;
        const churnVal = Math.max(0, item.churn30d ?? 1.0);
        const fanInVal = Math.max(0, item.fanIn ?? 1.0);
        const churnFactor = Math.tanh(churnVal / CHURN_SCALE_DENOMINATOR);
        const fanInFactor = Math.log(1.0 + fanInVal);
        dragMinutes += churnFactor * fanInFactor * item.remediationMinutes * friction;
    }
    return { principalMinutes, dragMinutes };
}

/**
 * Resolves total principal minutes and interest drag from debt inputs.
 */
function resolvePrincipalAndDragMinutes(input: FinancialDebtInput): { totalMinutes: number; dragMinutes: number } {
    const friction = typeof input.dragFriction === 'number' ? input.dragFriction : DEFAULT_DRAG_FRICTION_COEFFICIENT;
    const initialMinutes = typeof input.totalRemediationMinutes === 'number' ? input.totalRemediationMinutes : 0;

    if (!input.fileDebts || input.fileDebts.length === 0) {
        return {
            totalMinutes: initialMinutes,
            dragMinutes: initialMinutes * friction,
        };
    }

    const fileAgg = calculateDragFromFiles(input.fileDebts, friction);
    return {
        totalMinutes: initialMinutes > 0 ? initialMinutes : fileAgg.principalMinutes,
        dragMinutes: fileAgg.dragMinutes,
    };
}

/**
 * Computes dynamic baseline support floor from continuous historical samples.
 * Uses 5th percentile (95% confidence support floor Q0.05) as objective empirical
 * support level, aligned with VaR-95 without hardcoded expectation values.
 *
 * @param samples - Array of historical composite scores.
 * @returns Empirically estimated baseline support score.
 */
export function computeEmpiricalBaseline(samples: readonly number[]): number {
    if (samples.length === 0) return 0.0;
    if (samples.length < MIN_RISK_SAMPLE_SIZE) {
        const sum = samples.reduce((acc, v) => acc + v, 0);
        return roundTwoDecimals(sum / samples.length);
    }
    const sorted = samples.slice().sort((a, b) => a - b);
    const rank = 0.05 * (sorted.length - 1);
    const lowerIndex = Math.floor(rank);
    const upperIndex = Math.ceil(rank);
    const weight = rank - lowerIndex;
    const quantileVal = sorted[lowerIndex] + weight * (sorted[upperIndex] - sorted[lowerIndex]);
    return roundTwoDecimals(quantileVal);
}

/**
 * Evaluates coverage ratio (ICR/RCR) and status based on yield, accrual, and ongoing friction drag.
 */
function evaluateCoverageRatioAndStatus(
    safeYield: number,
    safeAccrual: number,
    dragMinutes = 0,
): { icr: number; status: FinancialDebtMetrics['status'] } {
    if (safeAccrual <= 0) {
        if (safeYield > 0) {
            // When accrual is zero, evaluate yield against continuous friction drag from existing debt stock
            const effectiveDrag = Math.max(1.0, dragMinutes);
            const icr = roundTwoDecimals(safeYield / effectiveDrag);
            return { icr, status: STATUS_DE_LEVERAGING };
        }
        return { icr: 1.0, status: STATUS_BALANCED };
    }

    const icr = roundTwoDecimals(safeYield / (safeAccrual + EPSILON_FLOAT));
    let status: FinancialDebtMetrics['status'] = STATUS_INSOLVENT;
    if (icr >= 2.0) {
        status = STATUS_DE_LEVERAGING;
    } else if (icr >= 1.0) {
        status = STATUS_BALANCED;
    }
    return { icr, status };
}

/**
 * Maps operational status to clearance state.
 */
function resolveClearanceStatus(status: FinancialDebtMetrics['status']): FinancialDebtMetrics['clearanceStatus'] {
    switch (status) {
        case STATUS_DE_LEVERAGING:
            return CLEARANCE_ACTIVE_CLEARING;
        case STATUS_BALANCED:
            return CLEARANCE_BALANCED;
        default:
            return CLEARANCE_DEFICIT_GROWING;
    }
}

/**
 * Computes financial capital debt metrics, interest drag, and interest coverage ratio (ICR).
 *
 * @param input - Debt items, churn data, and refactoring yield measurements.
 * @returns Evaluated financial debt metrics.
 */
export function computeFinancialDebtLedger(input: FinancialDebtInput): FinancialDebtMetrics {
    const { totalMinutes, dragMinutes } = resolvePrincipalAndDragMinutes(input);
    const principalHours = roundTwoDecimals(totalMinutes / MINUTES_IN_HOUR);
    const interestDragHours = roundTwoDecimals(dragMinutes / MINUTES_IN_HOUR);

    const yieldMin = input.refactoringYieldMinutes;
    const accrualMin = input.debtAccrualMinutes;

    if (yieldMin === undefined && accrualMin === undefined) {
        return {
            principalHours,
            interestDragHours,
            interestCoverageRatio: 0.0,
            rcr: 0.0,
            deficitStockHours: principalHours,
            frictionDragHours: interestDragHours,
            status: STATUS_INSUFFICIENT_SAMPLES,
            clearanceStatus: CLEARANCE_INSUFFICIENT_SAMPLES,
        };
    }

    const safeYield = Math.max(0, typeof yieldMin === 'number' ? yieldMin : 0);
    const safeAccrual = Math.max(0, typeof accrualMin === 'number' ? accrualMin : 0);
    const { icr, status } = evaluateCoverageRatioAndStatus(safeYield, safeAccrual, dragMinutes);

    const finalIcr = Math.min(RATIO_SATURATION_CEILING, icr);
    const clearanceStatus = resolveClearanceStatus(status);

    return {
        principalHours,
        interestDragHours,
        interestCoverageRatio: finalIcr,
        rcr: finalIcr,
        deficitStockHours: principalHours,
        frictionDragHours: interestDragHours,
        status,
        clearanceStatus,
    };
}

/**
 * Computes standard deviation and downside deviation for risk evaluation.
 */
function computeScoreDeviations(
    samples: readonly number[],
    mean: number,
    baseline: number,
): { stdDev: number; downsideDev: number } {
    const sampleCount = samples.length;
    let sumVariance = 0;
    let sumDownside = 0;

    for (const val of samples) {
        const diff = val - mean;
        sumVariance += diff * diff;
        const downDiff = Math.min(0, val - baseline);
        sumDownside += downDiff * downDiff;
    }

    const stdDev = sampleCount > 1 ? Math.sqrt(sumVariance / (sampleCount - 1)) : 0;
    const downsideDev = Math.sqrt(sumDownside / sampleCount);
    return { stdDev, downsideDev };
}

/**
 * Computes consecutive step Value at Risk (95%) and Maximum Drawdown.
 */
function computeRiskAndDrawdown(samples: readonly number[]): { var95: number; mdd: number } {
    const sampleCount = samples.length;
    let peak = samples[0];
    let maxDrawdownPct = 0;

    const deltas: number[] = [];
    for (let i = 1; i < sampleCount; i++) {
        deltas.push(samples[i] - samples[i - 1]);
        if (samples[i] > peak) peak = samples[i];
        if (peak > 0) {
            const currentDd = ((peak - samples[i]) / peak) * PERCENT_SCALE;
            if (currentDd > maxDrawdownPct) maxDrawdownPct = currentDd;
        }
    }

    if (deltas.length < 2) {
        return { var95: 0.0, mdd: roundTwoDecimals(maxDrawdownPct) };
    }

    const deltaMean = deltas.reduce((accumulator, delta) => accumulator + delta, 0) / deltas.length;
    let deltaVariance = 0;
    for (const delta of deltas) {
        const diff = delta - deltaMean;
        deltaVariance += diff * diff;
    }
    const deltaStd = Math.sqrt(deltaVariance / (deltas.length - 1));
    const potentialDrop = -(deltaMean - GAUSSIAN_Z_95 * deltaStd);
    const var95 = Math.max(0.0, roundTwoDecimals(potentialDrop));

    return { var95, mdd: roundTwoDecimals(maxDrawdownPct) };
}

/**
 * Computes risk-adjusted quality performance ratios: QSR, Sortino, VaR 95%, and MDD.
 *
 * @param input - Array of historical composite scores and optional sliding window size.
 * @returns Evaluated risk metrics with sample sufficiency guard.
 */
export function computeQualityRiskRatios(input: QualityRiskInput): QualityRiskMetrics {
    const windowSize = Math.max(
        MIN_RISK_SAMPLE_SIZE,
        Math.min(MAX_RISK_WINDOW_SIZE, input.windowSize ?? DEFAULT_RISK_WINDOW_SIZE),
    );
    const validScores = input.historyScores.filter((s) => Number.isFinite(s));
    const samples = validScores.slice(-windowSize);

    if (samples.length < MIN_RISK_SAMPLE_SIZE) {
        const fallbackMean = samples.length > 0
            ? samples.reduce((acc, v) => acc + v, 0) / samples.length
            : 0;
        return {
            qsr: 0.0,
            sortino: 0.0,
            var95: 0.0,
            mdd: 0.0,
            erq: 0.0,
            ddr: 0.0,
            edb95: 0.0,
            ptd: 0.0,
            meanScore: roundTwoDecimals(fallbackMean),
            standardDeviation: 0.0,
            downsideDeviation: 0.0,
            isSampleSufficient: false,
        };
    }

    const baseline = typeof input.baselineScore === 'number' && Number.isFinite(input.baselineScore)
        ? input.baselineScore
        : computeEmpiricalBaseline(samples);
    const meanScore = samples.reduce((acc, v) => acc + v, 0) / samples.length;
    const { stdDev, downsideDev } = computeScoreDeviations(samples, meanScore, baseline);

    const excessScore = meanScore - baseline;
    let qsr: number;
    if (stdDev < EPSILON_FLOAT) {
        qsr = excessScore > 0 ? roundTwoDecimals(excessScore / MIN_RISK_DEV_EPSILON) : 0.0;
    } else {
        qsr = Math.min(RATIO_SATURATION_CEILING, Math.max(0.0, excessScore / stdDev));
    }

    let sortino: number;
    if (downsideDev < EPSILON_FLOAT) {
        sortino = excessScore > 0 ? roundTwoDecimals(excessScore / MIN_RISK_DEV_EPSILON) : 0.0;
    } else {
        sortino = Math.min(RATIO_SATURATION_CEILING, Math.max(0.0, excessScore / downsideDev));
    }

    const { var95, mdd } = computeRiskAndDrawdown(samples);
    const finalQsr = roundTwoDecimals(qsr);
    const finalSortino = roundTwoDecimals(sortino);

    return {
        qsr: finalQsr,
        sortino: finalSortino,
        var95,
        mdd,
        erq: finalQsr,
        ddr: finalSortino,
        edb95: var95,
        ptd: mdd,
        meanScore: roundTwoDecimals(meanScore),
        standardDeviation: roundTwoDecimals(stdDev),
        downsideDeviation: roundTwoDecimals(downsideDev),
        isSampleSufficient: true,
    };
}

/**
 * Computes file-level technical debt Gini coefficient from ascending sorted slice.
 */
function calculateGiniCoefficient(sortedDebts: readonly number[], totalSum: number): number {
    const itemCount = sortedDebts.length;
    if (itemCount === 0 || totalSum <= 0) return 0.0;

    let numerator = 0;
    for (let i = 0; i < itemCount; i++) {
        const rank = i + 1;
        const weight = 2 * rank - itemCount - 1;
        numerator += weight * sortedDebts[i];
    }

    const gini = numerator / (itemCount * totalSum);
    return Math.max(0.0, Math.min(1.0, roundTwoDecimals(gini)));
}

/**
 * Computes Shannon entropy normalized to [0..1] across rule categories.
 */
function calculateCategoryEntropy(categoryCounts?: Record<string, number>): number {
    if (!categoryCounts) return 0.0;
    const activeCounts = Object.values(categoryCounts).filter((c) => Number.isFinite(c) && c > 0);
    const activeCategoryCount = activeCounts.length;
    if (activeCategoryCount <= 1) return 0.0;

    const totalViolations = activeCounts.reduce((accumulator, count) => accumulator + count, 0);
    if (totalViolations <= 0) return 0.0;

    let shannon = 0;
    for (const count of activeCounts) {
        const prob = count / totalViolations;
        shannon -= prob * Math.log2(prob);
    }

    const maxShannon = Math.log2(activeCategoryCount);
    if (maxShannon <= 0) return 0.0;
    return Math.max(0.0, Math.min(1.0, roundTwoDecimals(shannon / maxShannon)));
}

/**
 * Computes debt inequality metrics: Gini coefficient and normalized rule family entropy.
 *
 * @param input - File debt numbers and rule category breakdown.
 * @returns Evaluated inequality metrics.
 */
export function computeDebtInequality(input: InequalityInput): InequalityMetrics {
    const validDebts = input.fileDebts
        .filter((d) => Number.isFinite(d) && d >= 0)
        .slice()
        .sort((a, b) => a - b);

    const totalDebtItems = validDebts.reduce((accumulator, debt) => accumulator + debt, 0);
    const debtGini = calculateGiniCoefficient(validDebts, totalDebtItems);
    const defectEntropy = calculateCategoryEntropy(input.ruleCategoryCounts);

    return {
        debtGini,
        defectEntropy,
        dsi: debtGini,
        rcd: defectEntropy,
        totalDebtItems: Math.round(totalDebtItems),
    };
}

/**
 * Estimates discrete Ornstein-Uhlenbeck lag-1 autocorrelation and half-life in commits.
 */
function estimateOuHalfLife(scores: readonly number[]): { halfLife: number; theta: number } {
    const scoreCount = scores.length;
    if (scoreCount < MIN_RISK_SAMPLE_SIZE) {
        return { halfLife: 1.0, theta: 1.0 };
    }

    const mean = scores.reduce((accumulator, score) => accumulator + score, 0) / scoreCount;
    let covLag = 0;
    let variance = 0;

    for (let t = 1; t < scoreCount; t++) {
        covLag += (scores[t] - mean) * (scores[t - 1] - mean);
    }
    for (let t = 0; t < scoreCount; t++) {
        const diff = scores[t] - mean;
        variance += diff * diff;
    }

    if (variance < EPSILON_FLOAT) {
        return { halfLife: 1.0, theta: 1.0 };
    }

    const rawRho = covLag / variance;
    if (rawRho <= 0) {
        return { halfLife: 1.0, theta: 1.0 };
    }

    const rho = Math.min(0.999, Math.max(0.01, rawRho));
    const theta = -Math.log(rho);
    const halfLife = Math.log(2.0) / theta;

    return {
        halfLife: Math.max(0.1, Math.min(MAX_RISK_WINDOW_SIZE, roundTwoDecimals(halfLife))),
        theta: roundTwoDecimals(theta),
    };
}

/**
 * Computes excess kurtosis for cyclomatic complexity values to detect heavy-tail risks.
 */
function calculateExcessKurtosis(values?: readonly number[]): { kurtosis: number; isFatTailed: boolean } {
    if (!values || values.length < MIN_KURTOSIS_SAMPLE_COUNT) {
        return { kurtosis: 0.0, isFatTailed: false };
    }

    const validVals = values.filter((v) => Number.isFinite(v));
    const validSampleCount = validVals.length;
    if (validSampleCount < MIN_KURTOSIS_SAMPLE_COUNT) return { kurtosis: 0.0, isFatTailed: false };

    const mean = validVals.reduce((accumulator, val) => accumulator + val, 0) / validSampleCount;
    let secondMoment = 0;
    let fourthMoment = 0;

    for (const val of validVals) {
        const diff = val - mean;
        const diffSq = diff * diff;
        secondMoment += diffSq;
        fourthMoment += diffSq * diffSq;
    }

    const variance = secondMoment / validSampleCount;
    if (variance < EPSILON_FLOAT) {
        return { kurtosis: 0.0, isFatTailed: false };
    }

    const meanFourthMoment = fourthMoment / validSampleCount;
    const kurtosis = meanFourthMoment / (variance * variance) - NORMAL_DISTRIBUTION_KURTOSIS;
    const roundedKurt = roundTwoDecimals(kurtosis);

    return {
        kurtosis: roundedKurt,
        isFatTailed: roundedKurt > FAT_TAIL_KURTOSIS_THRESHOLD,
    };
}

/**
 * Computes stochastic dynamics: Ornstein-Uhlenbeck reversion half-life and CC excess kurtosis.
 *
 * @param input - Historical quality scores and cyclomatic complexity array.
 * @returns Evaluated stochastic metrics.
 */
export function computeStochasticDynamics(input: StochasticInput): StochasticMetrics {
    const validScores = input.historyScores.filter((s) => Number.isFinite(s));
    const { halfLife, theta } = estimateOuHalfLife(validScores);
    const { kurtosis, isFatTailed } = calculateExcessKurtosis(input.complexityValues);

    return {
        halfLifeCommits: halfLife,
        ehl: halfLife,
        reversionRateTheta: theta,
        kurtosisCc: kurtosis,
        isFatTailed,
    };
}

/**
 * Evaluates comprehensive quantitative risk assessment across all four mathematical domains.
 * Supports consolidated parameter object (SIM-ARGS-001) as well as legacy 4-tuple arguments.
 *
 * @param params - Consolidated QuantitativeRiskModelParams or financial input.
 * @param riskInput - Optional historical score time-series for legacy calls.
 * @param inequalityInput - Optional file debts and category counts for legacy calls.
 * @param stochasticInput - Optional trajectory and CC values for legacy calls.
 * @returns Unified quantitative risk assessment.
 */
export function evaluateQuantitativeRiskModel(
    params: QuantitativeRiskModelParams,
): QuantitativeRiskAssessment;
export function evaluateQuantitativeRiskModel(
    financialInput: FinancialDebtInput,
    riskInput: QualityRiskInput,
    inequalityInput: InequalityInput,
    stochasticInput: StochasticInput,
): QuantitativeRiskAssessment;
export function evaluateQuantitativeRiskModel(
    paramsOrFinancial: QuantitativeRiskModelParams | FinancialDebtInput,
    riskInput?: QualityRiskInput,
    inequalityInput?: InequalityInput,
    stochasticInput?: StochasticInput,
): QuantitativeRiskAssessment {
    const isSingleObject =
        paramsOrFinancial &&
        typeof paramsOrFinancial === 'object' &&
        'financial' in paramsOrFinancial &&
        'risk' in paramsOrFinancial &&
        'inequality' in paramsOrFinancial &&
        'stochastic' in paramsOrFinancial;

    const financialInputResolved = isSingleObject
        ? (paramsOrFinancial as QuantitativeRiskModelParams).financial
        : (paramsOrFinancial as FinancialDebtInput);
    const riskInputResolved = isSingleObject
        ? (paramsOrFinancial as QuantitativeRiskModelParams).risk
        : (riskInput as QualityRiskInput);
    const inequalityInputResolved = isSingleObject
        ? (paramsOrFinancial as QuantitativeRiskModelParams).inequality
        : (inequalityInput as InequalityInput);
    const stochasticInputResolved = isSingleObject
        ? (paramsOrFinancial as QuantitativeRiskModelParams).stochastic
        : (stochasticInput as StochasticInput);

    const financial = computeFinancialDebtLedger(financialInputResolved);
    const riskRatios = computeQualityRiskRatios(riskInputResolved);
    const inequality = computeDebtInequality(inequalityInputResolved);
    const stochastic = computeStochasticDynamics(stochasticInputResolved);
    return {
        financial,
        riskRatios,
        inequality,
        stochastic,
        debtDynamics: financial,
        temporalResilience: riskRatios,
        spatialDispersion: inequality,
    };
}
