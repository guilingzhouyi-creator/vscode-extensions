/**
 * Module: Unit Test — High-Dimensional Code Density Vector Space & Riemannian Manifold Solver
 * File Path: tests/unit/density-vector-space.test.ts
 * Architecture Role: Formal verification suite for the 5D density Riemannian manifold solver,
 *   testing logit tangent projection, Mahalanobis covariance whitening, Fisher-Rao simplex distance,
 *   and refactoring gradient pullback field.
 * Dependencies & Triggers: Vitest test framework; imports from src/core/intelligence/density-vector-space.
 * Responsibilities:
 *   1. Validate logit transform boundary safety and inverse logit round-trip precision.
 *   2. Assert Cholesky whitening decorrelation and Mahalanobis distance equivalence ||z||_2.
 *   3. Assert optimal attractor properties (d_M ~ 0, rho_space ~ 1.0, isIsotropicOptimal = true).
 *   4. Verify Fisher-Rao spherical geodesic arc length on the probability simplex.
 *   5. Verify refactoring gradient direction and dominant deficit axis detection for targeted repairs.
 * Exit Semantics & Design Rationale: Deterministic, hermetic, 100% assertions; zero flaky tests.
 */

import { describe, it, expect } from 'vitest';
import {
    logitTransform,
    inverseLogit,
    toDensityVector5D,
    toTangentVector5D,
    computeWhitenedCoordinates,
    computeMahalanobisDistance,
    computeFisherSimplexDistance,
    computeRefactoringGradient,
    evaluateSpatialDensityManifold,
    calculateSpatialEffectiveDensity,
    DEFAULT_TARGET_TANGENT_ATTRACTOR,
} from '../../src/core/intelligence/density-vector-space';

describe('density-vector-space: Logit Tangent Space Mapping', () => {
    it('maps midpoint 0.5 to tangent origin 0.0', () => {
        const logitVal = logitTransform(0.5);
        expect(logitVal).toBeCloseTo(0.0, 5);
    });

    it('maps target attractor 0.90 to logit value ~2.1972', () => {
        const logitVal = logitTransform(0.90);
        expect(logitVal).toBeCloseTo(2.197225, 4);
    });

    it('handles extreme boundaries [0.0, 1.0] without NaN or Infinity', () => {
        const yZero = logitTransform(0.0);
        const yOne = logitTransform(1.0);
        expect(Number.isFinite(yZero)).toBe(true);
        expect(Number.isFinite(yOne)).toBe(true);
        expect(yZero).toBeLessThan(-5.0);
        expect(yOne).toBeGreaterThan(5.0);
    });

    it('satisfies inverse logit round-trip identity', () => {
        const testPoints = [0.1, 0.25, 0.5, 0.75, 0.9, 0.99];
        for (const probability of testPoints) {
            const logitVal = logitTransform(probability);
            const recovered = inverseLogit(logitVal);
            expect(recovered).toBeCloseTo(probability, 4);
        }
    });
});

describe('density-vector-space: Mahalanobis Distance & Covariance Whitening', () => {
    it('yields near-zero Mahalanobis distance at the optimal attractor', () => {
        const distance = computeMahalanobisDistance(DEFAULT_TARGET_TANGENT_ATTRACTOR);
        expect(distance).toBeCloseTo(0.0, 5);
    });

    it('yields zero whitened vector at the optimal attractor', () => {
        const whitenedVector = computeWhitenedCoordinates(DEFAULT_TARGET_TANGENT_ATTRACTOR);
        for (let i = 0; i < 5; i++) {
            expect(whitenedVector[i]).toBeCloseTo(0.0, 5);
        }
    });

    it('satisfies ||z||_2 == d_M across arbitrary coordinate deltas', () => {
        const arbitraryTangent = [1.5, 2.0, 0.8, 1.2, 2.5] as const;
        const whitenedVector = computeWhitenedCoordinates(arbitraryTangent);
        let normSq = 0;
        for (let i = 0; i < 5; i++) {
            normSq += whitenedVector[i] * whitenedVector[i];
        }
        const expectedDist = Math.sqrt(normSq);
        const actualDist = computeMahalanobisDistance(arbitraryTangent);
        expect(actualDist).toBeCloseTo(expectedDist, 5);
    });

    it('exhibits strict monotonicity: larger deficits produce larger Mahalanobis distance', () => {
        const healthyTangent = toTangentVector5D([0.88, 0.88, 0.82, 0.82, 0.88]);
        const mediumTangent = toTangentVector5D([0.60, 0.60, 0.60, 0.60, 0.60]);
        const degradedTangent = toTangentVector5D([0.20, 0.20, 0.20, 0.20, 0.20]);

        const dHealthy = computeMahalanobisDistance(healthyTangent);
        const dMedium = computeMahalanobisDistance(mediumTangent);
        const dDegraded = computeMahalanobisDistance(degradedTangent);

        expect(dHealthy).toBeLessThan(dMedium);
        expect(dMedium).toBeLessThan(dDegraded);
    });
});

describe('density-vector-space: Fisher-Rao Simplex Metric', () => {
    it('yields zero geodesic arc length when comparing matching simplex distributions', () => {
        const arc = computeFisherSimplexDistance(0.90, 0.10, 0.90, 0.10);
        expect(arc).toBeCloseTo(0.0, 4);
    });

    it('yields non-zero positive arc length for boilerplate-heavy distributions', () => {
        // Code with 20% payload, 80% plumbing overhead
        const arc = computeFisherSimplexDistance(0.20, 0.80, 0.90, 0.10);
        expect(arc).toBeGreaterThan(1.0);
    });
});

describe('density-vector-space: Refactoring Gradient Field', () => {
    it('correctly pinpoints payloadDensity as dominant deficit when only payload is collapsed', () => {
        const raw = [0.90, 0.90, 0.85, 0.85, 0.15] as const;
        const tangent = toTangentVector5D(raw);
        const { dominantAxis, gradient } = computeRefactoringGradient(raw, tangent);

        expect(dominantAxis).toBe('payloadDensity');
        // Deficit payoff (-gradient) for payloadDensity must be highest
        expect(gradient.payloadDensity).toBeLessThan(0);
        expect(-gradient.payloadDensity).toBeGreaterThan(-gradient.lineDensity);
    });

    it('correctly pinpoints lineDensity as dominant deficit when only line compactness is collapsed', () => {
        const raw = [0.15, 0.90, 0.85, 0.85, 0.90] as const;
        const tangent = toTangentVector5D(raw);
        const { dominantAxis, gradient } = computeRefactoringGradient(raw, tangent);

        expect(dominantAxis).toBe('lineDensity');
        expect(gradient.lineDensity).toBeLessThan(0);
        expect(-gradient.lineDensity).toBeGreaterThan(-gradient.payloadDensity);
    });
});

describe('density-vector-space: Manifold Evaluator & Composite Synthesis', () => {
    it('produces exact 1.0 score and zero distance for 1.0 max density code', () => {
        const evalResult = evaluateSpatialDensityManifold({
            lineDensity: 1.0,
            columnDensity: 1.0,
            reuseDensity: 1.0,
            sharedDensity: 1.0,
            payloadDensity: 1.0,
            entropyFactor: 1.0,
        });

        expect(evalResult.isIsotropicOptimal).toBe(true);
        expect(evalResult.mahalanobisDistance).toBe(0);
        expect(evalResult.spatialCompositeDensity).toBe(1.0);
    });

    it('produces near-ideal score (~1.0) and isotropic optimality for clean code', () => {
        const evalResult = evaluateSpatialDensityManifold({
            lineDensity: 0.90,
            columnDensity: 0.90,
            reuseDensity: 0.85,
            sharedDensity: 0.85,
            payloadDensity: 0.90,
            entropyFactor: 1.0,
        });

        expect(evalResult.isIsotropicOptimal).toBe(true);
        expect(evalResult.mahalanobisDistance).toBeLessThan(0.1);
        expect(evalResult.spatialCompositeDensity).toBeGreaterThanOrEqual(0.99);
    });

    it('smoothly scales with Goldilocks entropy factor', () => {
        const fullEntropy = calculateSpatialEffectiveDensity({
            lineDensity: 0.90,
            columnDensity: 0.90,
            reuseDensity: 0.85,
            sharedDensity: 0.85,
            payloadDensity: 0.90,
            entropyFactor: 1.0,
        });

        const halfEntropy = calculateSpatialEffectiveDensity({
            lineDensity: 0.90,
            columnDensity: 0.90,
            reuseDensity: 0.85,
            sharedDensity: 0.85,
            payloadDensity: 0.90,
            entropyFactor: 0.5,
        });

        expect(fullEntropy).toBeGreaterThanOrEqual(0.99);
        expect(halfEntropy).toBeCloseTo(0.50, 2);
    });

    it('handles zero or non-finite inputs gracefully without throwing', () => {
        const evalResult = evaluateSpatialDensityManifold({
            lineDensity: NaN,
            columnDensity: 0,
            reuseDensity: -1,
            sharedDensity: Infinity,
            payloadDensity: 0,
            entropyFactor: 1.0,
        });

        expect(Number.isFinite(evalResult.spatialCompositeDensity)).toBe(true);
        expect(evalResult.spatialCompositeDensity).toBeGreaterThanOrEqual(0.0);
        expect(evalResult.spatialCompositeDensity).toBeLessThan(0.50);
        expect(evalResult.isIsotropicOptimal).toBe(false);
    });
});
