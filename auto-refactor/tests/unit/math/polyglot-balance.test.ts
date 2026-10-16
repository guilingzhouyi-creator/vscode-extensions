/**
 * Module: Unit Test — Polyglot Generalization & Modernization Balance
 * File Path: tests/unit/math/polyglot-balance.test.ts
 * Architecture Role: Deterministic verification of polyglot multi-language generalization
 *   and weighted Gaussian dispersion penalty scoring formulas.
 * Dependencies & Triggers: vitest, calculatePolyglotGeneralizationIndex from modernization-metrics.
 * Responsibilities:
 *   1. Verify single-language identity preservation without dispersion penalty.
 *   2. Verify homogeneous multi-language equilibrium with minimal dispersion deduction.
 *   3. Verify heterogeneous multi-language dispersion penalty dampening on lagged stacks.
 *   4. Verify custom weighting and safe clamping boundaries on invalid inputs.
 * Exit Semantics & Design Rationale: Pure mathematical unit test; 100% deterministic.
 */

import { describe, it, expect } from 'vitest';
import { calculatePolyglotGeneralizationIndex } from '../../../src/core/scoring/modernization-metrics';

describe('Polyglot Generalization & Modernization Balance Formula', () => {
    it('preserves single-language score with zero dispersion penalty', () => {
        const singleLang = { typescript: 96.5 };
        const index = calculatePolyglotGeneralizationIndex(singleLang);
        expect(index).toBe(96.5);
    });

    it('handles empty or invalid language dictionary safely', () => {
        expect(calculatePolyglotGeneralizationIndex({})).toBe(100.0);
        expect(calculatePolyglotGeneralizationIndex(null as unknown as Record<string, number>)).toBe(100.0);
    });

    it('maintains high equilibrium index for homogeneous multi-language stacks', () => {
        const scores = {
            typescript: 99.0,
            gdscript: 100.0,
            shell: 100.0,
            rust: 100.0,
        };
        const index = calculatePolyglotGeneralizationIndex(scores);
        // Mean is 99.75, variance is tiny (0.1875), std is ~0.433
        // Dispersion factor is ~0.9957, score is ~99.32
        expect(index).toBeGreaterThanOrEqual(99.0);
        expect(index).toBeLessThanOrEqual(100.0);
    });

    it('applies rational dispersion penalty when a stack language lags significantly', () => {
        const laggedScores = {
            typescript: 99.0,
            gdscript: 100.0,
            python: 64.0,
            shell: 100.0,
            rust: 100.0,
        };
        const index = calculatePolyglotGeneralizationIndex(laggedScores);
        // Unweighted: Mean = 92.6, Variance is around 204.64, StdDev is ~14.3
        // Dispersion factor is ~0.857, score is ~79.36
        expect(index).toBeLessThan(85.0);
        expect(index).toBeGreaterThan(70.0);
    });

    it('correctly incorporates logarithmic LOC custom weights', () => {
        const scores = {
            typescript: 98.0,
            python: 60.0,
        };
        // If typescript has weight 10 and python has weight 1, mean should lean heavily to TS
        const weights = {
            typescript: 10.0,
            python: 1.0,
        };
        const weightedIndex = calculatePolyglotGeneralizationIndex(scores, weights);
        const unweightedIndex = calculatePolyglotGeneralizationIndex(scores);

        // Weighted mean (94.55) > unweighted mean (79.0)
        expect(weightedIndex).toBeGreaterThan(unweightedIndex);
    });

    it('clamps negative or out-of-range scores safely', () => {
        const extremeScores = {
            typescript: 150.0,
            rust: -20.0,
        };
        const index = calculatePolyglotGeneralizationIndex(extremeScores);
        expect(index).toBeGreaterThanOrEqual(0.0);
        expect(index).toBeLessThanOrEqual(100.0);
    });
});
