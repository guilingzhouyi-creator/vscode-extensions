import { describe, it, expect } from 'vitest';
import {
    logGamma,
    logBeta,
    regularizedIncompleteBeta,
    inverseIncompleteBeta,
    computeExactBetaCredibleInterval,
} from '../../../src/core/scoring/bayesian-beta-solver';

describe('Bayesian Beta Distribution Solver', () => {
    describe('logGamma and logBeta', () => {
        it('should accurately compute logGamma for known integer and half-integer values', () => {
            // Gamma(1) = 1 => ln Gamma(1) = 0
            expect(logGamma(1)).toBeCloseTo(0, 10);
            // Gamma(2) = 1 => ln Gamma(2) = 0
            expect(logGamma(2)).toBeCloseTo(0, 10);
            // Gamma(5) = 24 => ln 24 approx 3.1780538303
            expect(logGamma(5)).toBeCloseTo(Math.log(24), 10);
            // Gamma(0.5) = sqrt(pi) => ln sqrt(pi) approx 0.5723649429
            expect(logGamma(0.5)).toBeCloseTo(0.5 * Math.log(Math.PI), 10);
        });

        it('should compute symmetric logBeta', () => {
            const b1 = logBeta(2.5, 4.5);
            const b2 = logBeta(4.5, 2.5);
            expect(b1).toBeCloseTo(b2, 12);
        });
    });

    describe('regularizedIncompleteBeta and inverseIncompleteBeta', () => {
        it('should satisfy boundary properties', () => {
            expect(regularizedIncompleteBeta(2, 3, 0)).toBe(0);
            expect(regularizedIncompleteBeta(2, 3, 1)).toBe(1);
            expect(inverseIncompleteBeta(2, 3, 0)).toBe(0);
            expect(inverseIncompleteBeta(2, 3, 1)).toBe(1);
        });

        it('should satisfy inverse identity: I(I_inv(p)) == p', () => {
            const alpha = 3.5;
            const beta = 5.2;
            const testProbabilities = [0.01, 0.025, 0.1, 0.5, 0.9, 0.975, 0.99];

            for (const p of testProbabilities) {
                const x = inverseIncompleteBeta(alpha, beta, p);
                const pRecalculated = regularizedIncompleteBeta(alpha, beta, x);
                expect(pRecalculated).toBeCloseTo(p, 5);
            }
        });

        it('should handle extreme and asymmetric shapes without breaking', () => {
            // Skewed Jeffreys prior update with small sample
            const xLow = inverseIncompleteBeta(0.5, 9.5, 0.025);
            const xHigh = inverseIncompleteBeta(0.5, 9.5, 0.975);
            expect(xLow).toBeGreaterThan(0);
            expect(xHigh).toBeLessThan(1);
            expect(xLow).toBeLessThan(xHigh);
        });
    });

    describe('computeExactBetaCredibleInterval', () => {
        it('should produce exact 95% credible interval for Jeffreys prior with high success', () => {
            // N = 100, k = 90 => alpha = 90.5, beta = 10.5
            const interval = computeExactBetaCredibleInterval(90.5, 10.5, 0.95);
            expect(interval.isExact).toBe(true);
            expect(interval.credibleScore).toBeCloseTo(89.6, 1);
            expect(interval.lowerBound).toBeGreaterThan(80);
            expect(interval.lowerBound).toBeLessThan(interval.credibleScore);
            expect(interval.upperBound).toBeGreaterThan(interval.credibleScore);
            expect(interval.upperBound).toBeLessThanOrEqual(100);
            expect(interval.margin).toBeGreaterThan(0);
        });

        it('should avoid negative bounds on small sample near zero boundary', () => {
            // N = 3, k = 0 => alpha = 0.5, beta = 3.5
            const interval = computeExactBetaCredibleInterval(0.5, 3.5, 0.95);
            expect(interval.lowerBound).toBeGreaterThanOrEqual(0.0);
            expect(interval.upperBound).toBeLessThanOrEqual(100.0);
            expect(interval.credibleScore).toBeCloseTo(12.5, 1);
        });
    });
});
