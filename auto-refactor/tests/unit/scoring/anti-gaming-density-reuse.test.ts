/**
 * Module: Unit Tests — Anti-Gaming Density Reuse
 * File Path: tests/unit/scoring/anti-gaming-density-reuse.test.ts
 * Architecture Role: Pins that `detectScoreGaming` yields identical results whether it computes
 *   the effective-density result itself or receives one from the caller. `evaluateFileQuality`
 *   now passes its already-computed result in to avoid tokenizing every file twice; if the two
 *   paths ever diverge, the score would depend on call order instead of on the code.
 * Dependencies & Triggers: Imports antiGaming and effectiveDensity; vitest unit lane.
 * Responsibilities:
 *   1. Assert byte-identical anti-gaming output for both call shapes.
 *   2. Cover a clean file, a tautological-test file, and an unreadable-density input.
 * Exit Semantics & Design Rationale: Pure assertions, no I/O, no timing. Comparing whole result
 *   objects is deliberate: a penalty difference of one point is still a different verdict.
 */
import { describe, it, expect } from 'vitest';
import { detectScoreGaming } from '../../../src/core/scoring/antiGaming';
import { computeEffectiveCodeDensity } from '../../../src/core/scoring/effectiveDensity';

/** Forwarder count that reaches `FORWARDING_SPLIT_THRESHOLD` inside the anti-gaming pass. */
const FORWARDING_COUNT_THAT_TRIPS = 5;
/** Density below `DENSITY_SPLIT_THRESHOLD`, which the splitting check requires alongside the count. */
const DENSITY_THAT_TRIPS = 0.5;

const CLEAN_SOURCE = [
    'export function add(left: number, right: number): number {',
    '    return left + right;',
    '}',
    '',
].join('\n');

const TAUTOLOGICAL_TEST = [
    "describe('padding', () => {",
    "    it('a', () => { expect(true).toBe(true); });",
    "    it('b', () => { expect(true).toBe(true); });",
    "    it('c', () => { expect(true).toBe(true); });",
    '});',
    '',
].join('\n');

describe('detectScoreGaming — density reuse is behavior-preserving', () => {
    it('produces the same result for a clean file with and without a supplied density', () => {
        const density = computeEffectiveCodeDensity(CLEAN_SOURCE);
        const computed = detectScoreGaming('src/math.ts', CLEAN_SOURCE);
        const reused = detectScoreGaming('src/math.ts', CLEAN_SOURCE, density);
        expect(reused).toEqual(computed);
    });

    it('produces the same result for a tautological test file', () => {
        const filePath = 'tests/unit/padding.spec.ts';
        const density = computeEffectiveCodeDensity(TAUTOLOGICAL_TEST);
        const computed = detectScoreGaming(filePath, TAUTOLOGICAL_TEST);
        const reused = detectScoreGaming(filePath, TAUTOLOGICAL_TEST, density);
        expect(reused).toEqual(computed);
        // Guard the fixture: a tautology fixture that detects nothing makes the comparison vacuous.
        expect(computed.hasGaming).toBe(true);
    });

    it('reads the supplied density through to the density-driven checks', () => {
        // `checkArtificialSplitting` fires on `forwardingCount >= 5 && effectiveDensity < 0.65`, and
        // both fields come from the density result. Supplying a result that trips that gate proves
        // the argument is actually read; recomputing internally would ignore it and stay silent.
        const filePath = 'src/core/layout.ts';
        const forwarding = Array.from(
            { length: 5 },
            (_, index) => `    handle${index}(value: string): string { return value; }`,
        ).join('\n');
        const honest = computeEffectiveCodeDensity(forwarding);

        const tripping = {
            ...honest,
            forwardingCount: FORWARDING_COUNT_THAT_TRIPS,
            effectiveDensity: DENSITY_THAT_TRIPS,
        };
        const withTripping = detectScoreGaming(filePath, forwarding, tripping);
        const withHonest = detectScoreGaming(filePath, forwarding, honest);

        expect(withTripping.gamingKinds).toContain('artificial_function_splitting');
        expect(withTripping).not.toEqual(withHonest);
    });
});
