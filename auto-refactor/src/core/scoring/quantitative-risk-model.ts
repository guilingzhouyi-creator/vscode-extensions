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
 *   4. Compute stochastic dynamics: Ornstein-Uhlenbeck mean-reversion half-life and excess kurtosis.
 * Exit Semantics & Design Rationale: Pure, non-throwing, zero I/O functions. Strictly bounded
 *   to CC <= 12, Depth <= 3, and execution time <= 3ms.
 */

/** Standard baseline score for excess return calculations (and safety floor). */
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
function roundTwoDecimals(value: number): number {
    if (!Number.isFinite(value)) return 0.0;
    return Math.round(value * 100) / 100;
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
 * Computes financial capital debt metrics, interest drag, and interest coverage ratio (ICR).
 *
 * @param input - Debt items, churn data, and refactoring yield measurements.
 * @returns Evaluated financial debt metrics.
 */
export function computeFinancialDebtLedger(input: FinancialDebtInput): FinancialDebtMetrics {
    const friction = input.dragFriction ?? DEFAULT_DRAG_FRICTION_COEFFICIENT;
    let totalMinutes = input.totalRemediationMinutes ?? 0;
    let dragMinutes = 0;

    if (input.fileDebts && input.fileDebts.length > 0) {
        const fileAgg = calculateDragFromFiles(input.fileDebts, friction);
        if (totalMinutes <= 0) totalMinutes = fileAgg.principalMinutes;
        dragMinutes = fileAgg.dragMinutes;
    } else {
        dragMinutes = totalMinutes * friction;
    }

    const principalHours = roundTwoDecimals(totalMinutes / MINUTES_IN_HOUR);
    const interestDragHours = roundTwoDecimals(dragMinutes / MINUTES_IN_HOUR);

    const yieldMin = input.refactoringYieldMinutes;
    const accrualMin = input.debtAccrualMinutes;

    if (yieldMin === undefined && accrualMin === undefined) {
        return {
            principalHours,
            interestDragHours,
            interestCoverageRatio: 2.0,
            rcr: 2.0,
            deficitStockHours: principalHours,
            frictionDragHours: interestDragHours,
            status: 'balanced',
            clearanceStatus: 'balanced',
        };
    }

    const safeYield = Math.max(0, yieldMin ?? 0);
    const safeAccrual = Math.max(0, accrualMin ?? 0);

    let icr: number;
    let status: FinancialDebtMetrics['status'];

    if (safeAccrual <= 0 && safeYield > 0) {
        icr = RATIO_SATURATION_CEILING;
        status = 'de-leveraging';
    } else if (safeAccrual <= 0 && safeYield <= 0) {
        icr = 1.0;
        status = 'balanced';
    } else {
        icr = roundTwoDecimals(safeYield / (safeAccrual + EPSILON_FLOAT));
        if (icr >= 2.0) status = 'de-leveraging';
        else if (icr >= 1.0) status = 'balanced';
        else status = 'insolvent';
    }

    const finalIcr = Math.min(RATIO_SATURATION_CEILING, icr);
    const clearanceStatus: FinancialDebtMetrics['clearanceStatus'] =
        status === 'de-leveraging' ? 'active-clearing' :
        status === 'balanced' ? 'balanced' : 'deficit-growing';

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
    const n = samples.length;
    let sumVariance = 0;
    let sumDownside = 0;

    for (const val of samples) {
        const diff = val - mean;
        sumVariance += diff * diff;
        const downDiff = Math.min(0, val - baseline);
        sumDownside += downDiff * downDiff;
    }

    const stdDev = n > 1 ? Math.sqrt(sumVariance / (n - 1)) : 0;
    const downsideDev = Math.sqrt(sumDownside / n);
    return { stdDev, downsideDev };
}

/**
 * Computes consecutive step Value at Risk (95%) and Maximum Drawdown.
 */
function computeVarAndMdd(samples: readonly number[]): { var95: number; mdd: number } {
    const n = samples.length;
    let peak = samples[0];
    let maxDrawdownPct = 0;

    const deltas: number[] = [];
    for (let i = 1; i < n; i++) {
        deltas.push(samples[i] - samples[i - 1]);
        if (samples[i] > peak) peak = samples[i];
        if (peak > 0) {
            const currentDd = ((peak - samples[i]) / peak) * 100.0;
            if (currentDd > maxDrawdownPct) maxDrawdownPct = currentDd;
        }
    }

    if (deltas.length < 2) {
        return { var95: 0.0, mdd: roundTwoDecimals(maxDrawdownPct) };
    }

    const deltaMean = deltas.reduce((acc, d) => acc + d, 0) / deltas.length;
    let deltaVariance = 0;
    for (const d of deltas) {
        const diff = d - deltaMean;
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

    const baseline = input.baselineScore ?? RISK_BASELINE_SCORE;
    const meanScore = samples.reduce((acc, v) => acc + v, 0) / samples.length;
    const { stdDev, downsideDev } = computeScoreDeviations(samples, meanScore, baseline);

    const excessScore = meanScore - baseline;
    let qsr: number;
    if (stdDev < EPSILON_FLOAT) {
        qsr = excessScore >= 0 ? RATIO_SATURATION_CEILING : 0.0;
    } else {
        qsr = Math.min(RATIO_SATURATION_CEILING, Math.max(0.0, excessScore / stdDev));
    }

    let sortino: number;
    if (downsideDev < EPSILON_FLOAT) {
        sortino = excessScore >= 0 ? RATIO_SATURATION_CEILING : 0.0;
    } else {
        sortino = Math.min(RATIO_SATURATION_CEILING, Math.max(0.0, excessScore / downsideDev));
    }

    const { var95, mdd } = computeVarAndMdd(samples);
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
    const n = sortedDebts.length;
    if (n === 0 || totalSum <= 0) return 0.0;

    let numerator = 0;
    for (let i = 0; i < n; i++) {
        const rank = i + 1;
        const weight = 2 * rank - n - 1;
        numerator += weight * sortedDebts[i];
    }

    const gini = numerator / (n * totalSum);
    return Math.max(0.0, Math.min(1.0, roundTwoDecimals(gini)));
}

/**
 * Computes Shannon entropy normalized to [0..1] across rule categories.
 */
function calculateCategoryEntropy(categoryCounts?: Record<string, number>): number {
    if (!categoryCounts) return 0.0;
    const activeCounts = Object.values(categoryCounts).filter((c) => Number.isFinite(c) && c > 0);
    const k = activeCounts.length;
    if (k <= 1) return 0.0;

    const totalViolations = activeCounts.reduce((acc, c) => acc + c, 0);
    if (totalViolations <= 0) return 0.0;

    let shannon = 0;
    for (const count of activeCounts) {
        const prob = count / totalViolations;
        shannon -= prob * Math.log2(prob);
    }

    const maxShannon = Math.log2(k);
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

    const totalDebtItems = validDebts.reduce((acc, d) => acc + d, 0);
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
    const n = scores.length;
    if (n < MIN_RISK_SAMPLE_SIZE) {
        return { halfLife: 1.0, theta: 1.0 };
    }

    const mean = scores.reduce((acc, s) => acc + s, 0) / n;
    let covLag = 0;
    let variance = 0;

    for (let t = 1; t < n; t++) {
        covLag += (scores[t] - mean) * (scores[t - 1] - mean);
    }
    for (let t = 0; t < n; t++) {
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
        halfLife: Math.max(0.1, Math.min(50.0, roundTwoDecimals(halfLife))),
        theta: roundTwoDecimals(theta),
    };
}

/**
 * Computes excess kurtosis for cyclomatic complexity values to detect heavy-tail risks.
 */
function calculateExcessKurtosis(values?: readonly number[]): { kurtosis: number; isFatTailed: boolean } {
    if (!values || values.length < 4) {
        return { kurtosis: 0.0, isFatTailed: false };
    }

    const validVals = values.filter((v) => Number.isFinite(v));
    const m = validVals.length;
    if (m < 4) return { kurtosis: 0.0, isFatTailed: false };

    const mean = validVals.reduce((acc, v) => acc + v, 0) / m;
    let secondMoment = 0;
    let fourthMoment = 0;

    for (const v of validVals) {
        const diff = v - mean;
        const diffSq = diff * diff;
        secondMoment += diffSq;
        fourthMoment += diffSq * diffSq;
    }

    const variance = secondMoment / m;
    if (variance < EPSILON_FLOAT) {
        return { kurtosis: 0.0, isFatTailed: false };
    }

    const meanFourthMoment = fourthMoment / m;
    const kurtosis = meanFourthMoment / (variance * variance) - 3.0;
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
 *
 * @param financialInput - Financial debt parameters.
 * @param riskInput - Historical score time-series.
 * @param inequalityInput - File debts and category counts.
 * @param stochasticInput - Trajectory and CC values.
 * @returns Unified quantitative risk assessment.
 */
export function evaluateQuantitativeRiskModel(
    financialInput: FinancialDebtInput,
    riskInput: QualityRiskInput,
    inequalityInput: InequalityInput,
    stochasticInput: StochasticInput,
): QuantitativeRiskAssessment {
    const financial = computeFinancialDebtLedger(financialInput);
    const riskRatios = computeQualityRiskRatios(riskInput);
    const inequality = computeDebtInequality(inequalityInput);
    const stochastic = computeStochasticDynamics(stochasticInput);
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
