/**
 * Module: Unit Tests — Kaplan-Meier Code Survival Model
 * File Path: tests/unit/evolution/code-survival-model.test.ts
 * Architecture Role: Verifies Kaplan-Meier product-limit survival estimation S(t),
 *   hazard rate calculations, half-life identification, and stability regime classification.
 * Dependencies & Triggers: Imports computeCodeSurvival from code-survival-model;
 *   executed under vitest test runner (`npm run test:unit` or `npm test`).
 * Responsibilities:
 *   1. Assert perfect survival S(t)=1.0 on empty or event-free revision histories.
 *   2. Assert stable mature classification when survival remains above 0.75.
 *   3. Assert acute infant mortality detection when code decays within first 5 revisions.
 *   4. Assert correct step-by-step product-limit math and hazard rates.
 *   5. Assert defensive handling of zero at-risk elements.
 * Exit Semantics & Design Rationale: Deterministic in-memory unit tests; ensures empirical
 *   actuarial survival model behaves correctly across edge cases.
 */

import { describe, it, expect } from 'vitest';
import {
    computeCodeSurvival,
    type SurvivalIntervalData,
} from '../../../src/core/evolution/code-survival-model';

describe('computeCodeSurvival', () => {
    it('returns perfect survival on empty intervals', () => {
        const result = computeCodeSurvival([]);
        expect(result.survivalProbability).toBe(1.0);
        expect(result.finalHazardRate).toBe(0.0);
        expect(result.estimatedHalfLife).toBeNull();
        expect(result.regime).toBe('stable_mature');
        expect(result.survivalCurve).toHaveLength(0);
    });

    it('identifies stable mature code with low recurring defect events', () => {
        // 10 revision intervals with minimal churn: n=100, d=1 at each step
        const intervals: SurvivalIntervalData[] = [];
        for (let t = 1; t <= 10; t++) {
            intervals.push({ timeStep: t, atRiskCount: 100, eventCount: 1 });
        }

        const result = computeCodeSurvival(intervals);
        // (1 - 0.01)^10 ≈ 0.9044
        expect(result.survivalProbability).toBeGreaterThan(0.85);
        expect(result.finalHazardRate).toBe(0.01);
        expect(result.estimatedHalfLife).toBeNull();
        expect(result.regime).toBe('stable_mature');
        expect(result.recommendation).toBeUndefined();
    });

    it('identifies high infant mortality with acute early regressions', () => {
        // Step 1: n=10, d=6 -> hazard = 0.6 -> S(t) = 0.40 <= 0.50
        const intervals: SurvivalIntervalData[] = [
            { timeStep: 1, atRiskCount: 10, eventCount: 6 },
            { timeStep: 2, atRiskCount: 4, eventCount: 1 },
        ];

        const result = computeCodeSurvival(intervals);
        expect(result.estimatedHalfLife).toBe(1);
        expect(result.regime).toBe('high_infant_mortality');
        expect(result.survivalProbability).toBeLessThanOrEqual(0.50);
        expect(result.recommendation).toContain('High infant mortality detected');
    });

    it('identifies moderate structural decay with late half-life', () => {
        // Gradual erosion: hazard 0.08 per step over 12 steps -> S(t) drops below 0.5 around step 8
        const intervals: SurvivalIntervalData[] = [];
        for (let t = 1; t <= 12; t++) {
            intervals.push({ timeStep: t, atRiskCount: 50, eventCount: 4 }); // hazard = 0.08
        }

        const result = computeCodeSurvival(intervals);
        expect(result.estimatedHalfLife).toBeGreaterThan(5);
        expect(result.regime).toBe('moderate_decay');
        expect(result.recommendation).toContain('Moderate structural decay observed');
    });

    it('handles zero at-risk elements safely without divide-by-zero errors', () => {
        const intervals: SurvivalIntervalData[] = [
            { timeStep: 1, atRiskCount: 0, eventCount: 0 },
            { timeStep: 2, atRiskCount: 10, eventCount: 2 },
        ];

        const result = computeCodeSurvival(intervals);
        expect(Number.isNaN(result.survivalProbability)).toBe(false);
        expect(result.survivalProbability).toBe(0.8);
        expect(result.finalHazardRate).toBe(0.2);
    });
});
