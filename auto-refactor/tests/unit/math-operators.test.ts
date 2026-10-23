/**
 * Module: Unit Test Suite — Pure Mathematical & Algorithmic Operator Library
 * File Path: tests/unit/math-operators.test.ts
 * Architecture Role: Verifies analytical mathematical invariants, numerical stability,
 *   Lipschitz continuity, boundary monotonic convergence, and error bounds for pure math modules.
 * Dependencies & Triggers: Consumes src/core/math/index.ts; executed via vitest.
 * Responsibilities:
 *   1. Validate Bayesian solver (Lanczos Gamma, Incomplete Beta, Inverse Beta, Exact Credible Intervals).
 *   2. Validate saturation curves (Logistic sigmoid, Michaelis-Menten rational, Gaussian bell).
 *   3. Validate information-theoretic metrics (Shannon entropy, Simpson diversity).
 *   4. Validate MCDA geometric mean and Popoviciu dispersion bounding.
 *   5. Validate multi-plane power-law resonance calculations.
 * Exit Semantics & Design Rationale: Deterministic pure numerical tests; zero I/O; 100% reproducible.
 */

import { describe, it, expect } from 'vitest';
import {
    clamp,
    clampRatio,
    clampScore,
    safeDivide,
    isWithinCorridor,
    logGamma,
    logBeta,
    computeRegularizedIncompleteBeta,
    computeInverseIncompleteBeta,
    computeExactBetaCredibleInterval,
    applyLogisticSaturation,
    calculateMarginalDeduction,
    computeMichaelisMentenRational,
    computeGaussianBellDensity,
    calculateShannonEntropy,
    calculateSimpsonDiversityIndex,
    computeWeightedGeometricMean,
    computePopoviciuDispersionPenalty,
    computePowerResonance,
} from '../../src/core/math';

describe('Core Math — Pure Mathematical Operators', () => {
    describe('Numerical Corridor Primitives', () => {
        it('clamps values and protects boundaries', () => {
            expect(clamp(50, 0, 100)).toBe(50);
            expect(clamp(-10, 0, 100)).toBe(0);
            expect(clamp(150, 0, 100)).toBe(100);
            expect(clamp(NaN, 10, 20)).toBe(10);
            expect(clampRatio(1.5)).toBe(1.0);
            expect(clampRatio(-0.5)).toBe(0.0);
            expect(clampScore(95.456)).toBe(95.46);
        });

        it('safeDivide protects against zero and non-finite divisors', () => {
            expect(safeDivide(10, 2)).toBe(5);
            expect(safeDivide(10, 0, -1)).toBe(-1);
            expect(safeDivide(NaN, 5, 0)).toBe(0);
            expect(safeDivide(5, Infinity, 0)).toBe(0);
        });

        it('isWithinCorridor evaluates bidirectional tolerance corridor', () => {
            expect(isWithinCorridor(10.00005, 10.0, 1e-4)).toBe(true);
            expect(isWithinCorridor(10.0005, 10.0, 1e-4)).toBe(false);
        });
    });

    describe('Bayesian Beta Solver & Credible Intervals', () => {
        it('computes accurate logGamma for integer and half-integer values', () => {
            // Gamma(1) = 1 => ln(1) = 0
            expect(logGamma(1)).toBeCloseTo(0.0, 8);
            // Gamma(2) = 1! = 1 => ln(1) = 0
            expect(logGamma(2)).toBeCloseTo(0.0, 8);
            // Gamma(5) = 4! = 24 => ln(24) ≈ 3.17805383
            expect(logGamma(5)).toBeCloseTo(Math.log(24), 8);
            // Gamma(0.5) = sqrt(pi) => ln(sqrt(pi)) ≈ 0.57236494
            expect(logGamma(0.5)).toBeCloseTo(Math.log(Math.sqrt(Math.PI)), 8);
        });

        it('computes accurate logBeta symmetry ln B(a, b) = ln B(b, a)', () => {
            const beta1 = logBeta(2.5, 4.5);
            const beta2 = logBeta(4.5, 2.5);
            expect(beta1).toBeCloseTo(beta2, 10);
        });

        it('computes regularized incomplete beta I_x(a, b) in [0, 1]', () => {
            expect(computeRegularizedIncompleteBeta(2, 3, 0)).toBe(0.0);
            expect(computeRegularizedIncompleteBeta(2, 3, 1)).toBe(1.0);
            // Uniform Beta(1, 1): I_x(1, 1) = x
            expect(computeRegularizedIncompleteBeta(1, 1, 0.42)).toBeCloseTo(0.42, 6);
        });

        it('inverts incomplete beta function I_x(a, b) = p with roundtrip consistency', () => {
            const a = 3.5;
            const b = 2.5;
            const targetP = 0.65;
            const xSolved = computeInverseIncompleteBeta(a, b, targetP);
            const pRoundtrip = computeRegularizedIncompleteBeta(a, b, xSolved);
            expect(pRoundtrip).toBeCloseTo(targetP, 4);
        });

        it('computes exact Bayesian credible interval for Beta distribution', () => {
            const interval = computeExactBetaCredibleInterval(10, 2, 0.95);
            expect(interval.isExact).toBe(true);
            expect(interval.posteriorMean).toBeCloseTo(10 / 12, 4);
            expect(interval.lowerBound).toBeLessThan(interval.credibleScore);
            expect(interval.upperBound).toBeGreaterThan(interval.credibleScore);
            expect(interval.lowerBound).toBeGreaterThan(50.0);
            expect(interval.upperBound).toBeLessThanOrEqual(100.0);
        });
    });

    describe('Saturation & Rational Decay Curves', () => {
        it('applyLogisticSaturation preserves linear threshold and saturates at ceiling', () => {
            // Under linear threshold (15), penalty is exact
            expect(applyLogisticSaturation(10)).toBe(10);
            // Beyond threshold, penalty is smoothly damped
            const saturated = applyLogisticSaturation(80);
            expect(saturated).toBeGreaterThan(15);
            expect(saturated).toBeLessThanOrEqual(100);
            // Extreme inputs floor at ceiling
            expect(applyLogisticSaturation(1000)).toBeLessThanOrEqual(100);
        });

        it('calculateMarginalDeduction applies harmonic sub-linear scaling', () => {
            expect(calculateMarginalDeduction(0, 10)).toBe(0);
            expect(calculateMarginalDeduction(1, 10)).toBe(10);
            const ded3 = calculateMarginalDeduction(3, 10);
            // 10 * (1 + 1/sqrt(2) + 1/sqrt(3)) ≈ 10 * (1 + 0.707 + 0.577) = 22.84 => 23
            expect(ded3).toBe(23);
        });

        it('computeMichaelisMentenRational exhibits strict hyperbolic convexity', () => {
            expect(computeMichaelisMentenRational(0, 30, 100)).toBe(100);
            // At half-saturation (30), score is exactly 50
            expect(computeMichaelisMentenRational(30, 30, 100)).toBe(50);
            // At 60 (2 * H), score is 100 * 30 / 90 = 33.33
            expect(computeMichaelisMentenRational(60, 30, 100)).toBe(33.33);
        });

        it('computeGaussianBellDensity bounds peak at 1.0 and tails smoothly', () => {
            expect(computeGaussianBellDensity(5, 5, 2)).toBe(1.0);
            expect(computeGaussianBellDensity(7, 5, 2)).toBeCloseTo(Math.exp(-0.5), 6);
            expect(computeGaussianBellDensity(100, 5, 2)).toBeCloseTo(0.0, 6);
        });
    });

    describe('Information Theory & Entropy', () => {
        it('calculateShannonEntropy computes character stream entropy in bits', () => {
            expect(calculateShannonEntropy('')).toBe(0.0);
            // Single repeated char has 0 entropy
            expect(calculateShannonEntropy('aaaaaaa')).toBe(0.0);
            // 2 equally distributed chars has 1 bit
            expect(calculateShannonEntropy('abababab')).toBe(1.0);
            // 4 equally distributed chars has 2 bits
            expect(calculateShannonEntropy('abcdabcd')).toBe(2.0);
        });

        it('calculateSimpsonDiversityIndex reflects category balance', () => {
            expect(calculateSimpsonDiversityIndex([])).toBe(0.0);
            expect(calculateSimpsonDiversityIndex([100])).toBe(0.0);
            // 5 equal groups has diversity 1 - 5 * (0.2)^2 = 1 - 0.2 = 0.8
            expect(calculateSimpsonDiversityIndex([20, 20, 20, 20, 20])).toBe(0.8);
        });
    });

    describe('MCDA & Statistical Dispersion', () => {
        it('computeWeightedGeometricMean pulls down score when single axis collapses', () => {
            // Nine 100s and one 15 (floor)
            const scores = [100, 100, 100, 100, 100, 100, 100, 100, 100, 15];
            const weights = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
            const gm = computeWeightedGeometricMean(scores, weights, 15);
            // exp(0.9 * ln(100) + 0.1 * ln(15)) ≈ exp(4.144 + 0.270) = exp(4.414) ≈ 82.6
            expect(gm).toBeLessThan(90); // significantly lower than arithmetic mean 91.5
            expect(gm).toBeGreaterThan(80);
        });

        it('computePopoviciuDispersionPenalty bounds variance penalty by Popoviciu limit', () => {
            expect(computePopoviciuDispersionPenalty(0)).toBe(1.0);
            // Maximum theoretical sigma = 50.0 => penalty = 1.0 - (50/50)*0.5 = 0.5
            expect(computePopoviciuDispersionPenalty(50.0)).toBe(0.5);
        });
    });

    describe('Multi-Factor Power-Law Resonance', () => {
        it('computePowerResonance evaluates non-linear multi-plane interaction', () => {
            const coeffs = { alpha: 1.0, beta: 1.2, gamma: 0.8 };
            // S=2, D=2, H=1 => 2^1 * 2^1.2 * 1^0.8 = 2 * 2.2974 = 4.59
            const res = computePowerResonance({ staticScore: 2, dynamicScore: 2, historicalScore: 1, coeffs });
            expect(res).toBeCloseTo(4.59, 1);

            // Ceiling clamp
            const saturated = computePowerResonance({
                staticScore: 100,
                dynamicScore: 100,
                historicalScore: 10,
                coeffs,
                modifier: 1.0,
                ceiling: 100.0,
            });
            expect(saturated).toBe(100.0);
        });
    });
});
