import { describe, it, expect } from 'vitest';
import {
    computeFinancialDebtLedger,
    computeQualityRiskRatios,
    computeDebtInequality,
    computeStochasticDynamics,
    evaluateQuantitativeRiskModel,
    RISK_BASELINE_SCORE,
    RATIO_SATURATION_CEILING,
} from '../../../src/core/scoring/quantitative-risk-model';

describe('Quantitative Risk Model Engine', () => {
    describe('computeFinancialDebtLedger', () => {
        it('should compute principal and interest drag from total remediation minutes', () => {
            const result = computeFinancialDebtLedger({
                totalRemediationMinutes: 600, // 10 hours
            });

            expect(result.principalHours).toBe(10);
            expect(result.interestDragHours).toBe(0.8); // 10 * 0.08 = 0.8 hours
            expect(result.interestCoverageRatio).toBe(2.0);
            expect(result.status).toBe('balanced');
        });

        it('should compute churn and fan-in weighted interest drag from file items', () => {
            const result = computeFinancialDebtLedger({
                fileDebts: [
                    {
                        filePath: 'src/core/critical.ts',
                        remediationMinutes: 300, // 5 hours
                        churn30d: 8.0, // tanh(8/4) = tanh(2) ~= 0.964
                        fanIn: 10.0,   // ln(1 + 10) ~= 2.398
                    },
                    {
                        filePath: 'src/utils/leaf.ts',
                        remediationMinutes: 300, // 5 hours
                        churn30d: 0.5, // tanh(0.5/4) ~= 0.124
                        fanIn: 1.0,    // ln(2) ~= 0.693
                    },
                ],
                refactoringYieldMinutes: 120,
                debtAccrualMinutes: 40,
            });

            expect(result.principalHours).toBe(10);
            expect(result.interestDragHours).toBeGreaterThan(0.5);
            // ICR = 120 / 40 = 3.0 (>= 2.0 -> de-leveraging)
            expect(result.interestCoverageRatio).toBe(3.0);
            expect(result.status).toBe('de-leveraging');
        });

        it('should classify insolvent status when refactoring yield cannot cover accrual', () => {
            const result = computeFinancialDebtLedger({
                totalRemediationMinutes: 1200,
                refactoringYieldMinutes: 30,
                debtAccrualMinutes: 90,
            });

            // ICR = 30 / 90 = 0.33 (< 1.0 -> insolvent)
            expect(result.interestCoverageRatio).toBe(0.33);
            expect(result.status).toBe('insolvent');
        });

        it('should handle zero debt accrual with positive refactoring yield gracefully', () => {
            const result = computeFinancialDebtLedger({
                totalRemediationMinutes: 300,
                refactoringYieldMinutes: 60,
                debtAccrualMinutes: 0,
            });

            expect(result.interestCoverageRatio).toBe(RATIO_SATURATION_CEILING);
            expect(result.status).toBe('de-leveraging');
        });
    });

    describe('computeQualityRiskRatios', () => {
        it('should report insufficient samples when history has fewer than 5 items', () => {
            const result = computeQualityRiskRatios({
                historyScores: [95.0, 96.0, 94.5],
            });

            expect(result.isSampleSufficient).toBe(false);
            expect(result.qsr).toBe(0.0);
            expect(result.sortino).toBe(0.0);
            expect(result.meanScore).toBe(95.17);
        });

        it('should saturate QSR and Sortino when variance is zero for scores >= baseline', () => {
            const result = computeQualityRiskRatios({
                historyScores: [98.0, 98.0, 98.0, 98.0, 98.0, 98.0],
            });

            expect(result.isSampleSufficient).toBe(true);
            expect(result.meanScore).toBe(98.0);
            expect(result.standardDeviation).toBe(0.0);
            expect(result.downsideDeviation).toBe(0.0);
            expect(result.qsr).toBe(RATIO_SATURATION_CEILING);
            expect(result.sortino).toBe(RATIO_SATURATION_CEILING);
            expect(result.mdd).toBe(0.0);
        });

        it('should compute valid Sharpe and Sortino ratios for fluctuating series', () => {
            // Scores oscillating above baseline 90
            const history = [92.0, 95.0, 93.0, 96.0, 94.0, 97.0];
            const result = computeQualityRiskRatios({
                historyScores: history,
                baselineScore: RISK_BASELINE_SCORE,
            });

            expect(result.isSampleSufficient).toBe(true);
            expect(result.meanScore).toBe(94.5);
            expect(result.standardDeviation).toBeGreaterThan(0);
            // Since all scores >= 90, downside deviation should be 0, so Sortino saturates
            expect(result.downsideDeviation).toBe(0.0);
            expect(result.sortino).toBe(RATIO_SATURATION_CEILING);
            expect(result.qsr).toBeGreaterThan(2.0);
        });

        it('should calculate downside deviation and maximum drawdown when scores drop below baseline', () => {
            // A drop from 95 to 85, then recovery to 92
            const history = [95.0, 96.0, 85.0, 88.0, 92.0];
            const result = computeQualityRiskRatios({
                historyScores: history,
            });

            expect(result.downsideDeviation).toBeGreaterThan(0);
            expect(result.sortino).toBeLessThan(RATIO_SATURATION_CEILING);
            // Peak was 96.0, trough was 85.0 -> DD = (96 - 85)/96 * 100% = 11.46%
            expect(result.mdd).toBeCloseTo(11.46, 1);
            expect(result.var95).toBeGreaterThanOrEqual(0.0);
        });
    });

    describe('computeDebtInequality', () => {
        it('should report zero Gini coefficient for empty or all-zero debts', () => {
            const resEmpty = computeDebtInequality({ fileDebts: [] });
            expect(resEmpty.debtGini).toBe(0.0);

            const resZeros = computeDebtInequality({ fileDebts: [0, 0, 0, 0] });
            expect(resZeros.debtGini).toBe(0.0);
        });

        it('should report zero Gini coefficient for perfectly equal debt distribution', () => {
            const result = computeDebtInequality({
                fileDebts: [10, 10, 10, 10, 10],
            });

            expect(result.debtGini).toBe(0.0);
        });

        it('should report high Gini coefficient when debt is concentrated in a single file', () => {
            const result = computeDebtInequality({
                fileDebts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 100],
            });

            // 9 files have 0, 1 file has 100 -> Gini should be (10-1)/10 = 0.90
            expect(result.debtGini).toBe(0.9);
        });

        it('should compute normalized rule family Shannon entropy', () => {
            // Uniformly distributed across 4 categories
            const uniformRes = computeDebtInequality({
                fileDebts: [5, 5],
                ruleCategoryCounts: {
                    CPX: 10,
                    PRF: 10,
                    SEC: 10,
                    ARCH: 10,
                },
            });

            expect(uniformRes.defectEntropy).toBe(1.0);

            // Completely concentrated in 1 category
            const concRes = computeDebtInequality({
                fileDebts: [5, 5],
                ruleCategoryCounts: {
                    CPX: 40,
                },
            });

            expect(concRes.defectEntropy).toBe(0.0);
        });
    });

    describe('computeStochasticDynamics', () => {
        it('should fallback to default half-life when history is short', () => {
            const result = computeStochasticDynamics({
                historyScores: [95.0, 96.0],
            });

            expect(result.halfLifeCommits).toBe(1.0);
            expect(result.reversionRateTheta).toBe(1.0);
            expect(result.isFatTailed).toBe(false);
        });

        it('should estimate mean-reversion half-life for fluctuating series', () => {
            // Persistent drift and gradual return to baseline
            const scores = [90.0, 92.0, 95.0, 96.0, 95.0, 93.0, 91.0, 90.0];
            const result = computeStochasticDynamics({
                historyScores: scores,
            });

            expect(result.halfLifeCommits).toBeGreaterThan(0.5);
            expect(result.halfLifeCommits).toBeLessThan(50.0);
            expect(result.reversionRateTheta).toBeGreaterThan(0);
        });

        it('should handle rapid alternating oscillations with instantaneous reversion', () => {
            const alternatingScores = [98.0, 92.0, 98.0, 92.0, 98.0, 92.0];
            const result = computeStochasticDynamics({
                historyScores: alternatingScores,
            });

            expect(result.halfLifeCommits).toBe(1.0);
            expect(result.reversionRateTheta).toBe(1.0);
        });

        it('should detect Leptokurtic fat-tail when extreme cyclomatic complexity exists', () => {
            // Normal CC around 3-5 with one extreme outlier of 85
            const ccs = [3, 4, 3, 5, 4, 3, 4, 5, 3, 4, 85];
            const result = computeStochasticDynamics({
                historyScores: [95, 96, 95, 96, 95],
                complexityValues: ccs,
            });

            expect(result.kurtosisCc).toBeGreaterThan(3.0);
            expect(result.isFatTailed).toBe(true);
        });
    });

    describe('evaluateQuantitativeRiskModel', () => {
        it('should evaluate full aggregate model without runtime exceptions', () => {
            const assessment = evaluateQuantitativeRiskModel(
                { totalRemediationMinutes: 240, refactoringYieldMinutes: 60, debtAccrualMinutes: 30 },
                { historyScores: [95, 96, 94, 95, 97, 96] },
                { fileDebts: [2, 5, 1, 10], ruleCategoryCounts: { CPX: 5, SEC: 3 } },
                { historyScores: [95, 96, 94, 95, 97, 96], complexityValues: [4, 5, 3, 6, 4] },
            );

            expect(assessment.financial.status).toBe('de-leveraging');
            expect(assessment.riskRatios.isSampleSufficient).toBe(true);
            expect(assessment.inequality.totalDebtItems).toBe(18);
            expect(assessment.stochastic.isFatTailed).toBe(false);
        });
    });
});
