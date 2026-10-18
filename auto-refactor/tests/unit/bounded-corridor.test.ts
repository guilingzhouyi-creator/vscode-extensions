/**
 * Module: Unit Test Suite — Compact Bounded Corridor & Numerical Interval Guard
 * File Path: tests/unit/bounded-corridor.test.ts
 * Architecture Role: Verifies mathematical invariants, closed interval clamping,
 *   safe division, and corridor tolerance evaluation under boundary conditions.
 * Dependencies & Triggers: Consumes boundedCorridor.ts; executed via vitest.
 * Responsibilities:
 *   1. Validate clamp() against out-of-bounds, reversed bounds, and non-finite inputs.
 *   2. Validate clampRatio() boundary enforcement within [0.0, 1.0].
 *   3. Validate clampScore() against negative deductions and overflowing bonuses.
 *   4. Validate safeDivide() against zero-division, NaN, and infinity edge cases.
 *   5. Validate isWithinCorridor() bidirectional tolerance invariant.
 * Exit Semantics & Design Rationale: Deterministic pure unit tests; zero I/O.
 */

import { describe, it, expect } from 'vitest';
import {
    clamp,
    clampRatio,
    clampScore,
    safeDivide,
    isWithinCorridor,
    assertWithinCorridor,
    sanitizeBound,
    DEFAULT_CORRIDOR_EPSILON,
} from '../../src/core/scoring/bounded-corridor';

describe('boundedCorridor - Mathematical Interval Invariants', () => {
    describe('clamp', () => {
        it('preserves values strictly inside [min, max]', () => {
            expect(clamp(5, 0, 10)).toBe(5);
            expect(clamp(0, 0, 10)).toBe(0);
            expect(clamp(10, 0, 10)).toBe(10);
            expect(clamp(7.5, 5.0, 8.0)).toBe(7.5);
        });

        it('clamps values below lower bound to min', () => {
            expect(clamp(-5, 0, 10)).toBe(0);
            expect(clamp(-999, -100, 100)).toBe(-100);
        });

        it('clamps values above upper bound to max', () => {
            expect(clamp(15, 0, 10)).toBe(10);
            expect(clamp(100.5, 0, 100)).toBe(100);
        });

        it('sanitizes non-finite inputs to lower bound', () => {
            expect(clamp(NaN, 0, 100)).toBe(0);
            expect(clamp(Infinity, 0, 100)).toBe(100);
            expect(clamp(-Infinity, 0, 100)).toBe(0);
        });

        it('automatically normalizes inverted bounds where min > max', () => {
            expect(clamp(5, 10, 0)).toBe(5);
            expect(clamp(-5, 10, 0)).toBe(0);
            expect(clamp(15, 10, 0)).toBe(10);
        });
    });

    describe('clampRatio', () => {
        it('guarantees ratio lies strictly within [0.0, 1.0]', () => {
            expect(clampRatio(0.42)).toBe(0.42);
            expect(clampRatio(-0.5)).toBe(0.0);
            expect(clampRatio(1.5)).toBe(1.0);
            expect(clampRatio(NaN)).toBe(0.0);
            expect(clampRatio(Infinity)).toBe(1.0);
            expect(clampRatio(-Infinity)).toBe(0.0);
        });
    });

    describe('clampScore', () => {
        it('clamps quality scores to [0.0, ceiling] with 0.01 precision rounding', () => {
            expect(clampScore(95.456)).toBe(95.46);
            expect(clampScore(-15.2)).toBe(0.0);
            expect(clampScore(125.8)).toBe(100.0);
            expect(clampScore(98.5, 95.0)).toBe(95.0);
            expect(clampScore(NaN)).toBe(0.0);
        });
    });

    describe('safeDivide', () => {
        it('returns exact quotient for valid inputs', () => {
            expect(safeDivide(10, 2)).toBe(5);
            expect(safeDivide(0, 5)).toBe(0);
            expect(safeDivide(7, 2)).toBe(3.5);
        });

        it('returns fallback value on zero division', () => {
            expect(safeDivide(10, 0)).toBe(0);
            expect(safeDivide(10, 0, -1)).toBe(-1);
            expect(safeDivide(0, 0, 100)).toBe(100);
        });

        it('returns fallback on NaN or Infinity inputs', () => {
            expect(safeDivide(NaN, 5, 0)).toBe(0);
            expect(safeDivide(5, NaN, 0)).toBe(0);
            expect(safeDivide(Infinity, 5, 0)).toBe(0);
            expect(safeDivide(5, Infinity, 0)).toBe(0);
        });
    });

    describe('isWithinCorridor', () => {
        it('evaluates bidirectional tolerance invariant correctly', () => {
            expect(isWithinCorridor(0.80005, 0.8, 1e-4)).toBe(true);
            expect(isWithinCorridor(0.79995, 0.8, 1e-4)).toBe(true);
            expect(isWithinCorridor(0.8002, 0.8, 1e-4)).toBe(false);
            expect(isWithinCorridor(0.7997, 0.8, 1e-4)).toBe(false);
        });

        it('uses default corridor epsilon 1e-4 when omitted', () => {
            expect(isWithinCorridor(100.00005, 100.0)).toBe(true);
            expect(isWithinCorridor(100.0002, 100.0)).toBe(false);
        });

        it('returns false safely for non-finite inputs', () => {
            expect(isWithinCorridor(NaN, 100)).toBe(false);
            expect(isWithinCorridor(100, NaN)).toBe(false);
            expect(isWithinCorridor(Infinity, Infinity)).toBe(false);
        });
    });

    describe('sanitizeBound', () => {
        it('normalizes inputs within thresholds or uses fallback', () => {
            expect(sanitizeBound(25, 10, 0, 50)).toBe(25);
            expect(sanitizeBound(undefined, 15, 0, 50)).toBe(15);
            expect(sanitizeBound(NaN, 10, 0, 50)).toBe(10);
            expect(sanitizeBound(100, 10, 0, 50)).toBe(50);
            expect(sanitizeBound(-20, 10, 0, 50)).toBe(0);
        });
    });

    describe('assertWithinCorridor', () => {
        it('passes without throwing when within corridor', () => {
            expect(() => assertWithinCorridor(0.80005, 0.8, 1e-4)).not.toThrow();
        });

        it('throws RangeError when deviating beyond corridor', () => {
            expect(() => assertWithinCorridor(0.85, 0.8, 1e-4, 'Test metric')).toThrow(RangeError);
        });
    });
});
