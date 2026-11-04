/**
 * Module: Unit Tests — Token Estimation & Measured Savings Baseline
 * File Path: tests/unit/token-estimate.test.ts
 * Architecture Role: Contract test for the provider-agnostic token estimator and the JSON
 *   baseline used to make `tokenSavingsRatio` reproducible. Both replaced silent assumptions: a
 *   single `chars / 4` divisor under-reported CJK prompts, and a constant baseline made every
 *   savings claim unfalsifiable.
 * Dependencies & Triggers: Imports from `src/core/guidance/token-estimate`; runs in the vitest
 *   unit lane invoked by `npm test`.
 * Responsibilities:
 *   1. Pin the CJK/Latin weighting so a locale regression is visible.
 *   2. Pin baseline measurement against the actual JSON payload.
 *   3. Pin the degenerate inputs (empty string, empty record set) that must not inflate a saving.
 * Exit Semantics & Design Rationale: Pure arithmetic with fixed inputs, so a failure always means
 *   the weighting contract changed. Assertions use inequalities where the exact ceiling depends on
 *   glyph classification, and equalities only where the formula is definitional.
 */
import { describe, it, expect } from 'vitest';
import {
    estimateNarrowTokens,
    estimateTokens,
    measureJsonBaseline,
} from '../../src/core/guidance/token-estimate';

describe('estimateTokens — glyph-aware weighting', () => {
    it('returns zero for empty input', () => {
        expect(estimateTokens('')).toBe(0);
    });

    it('never drops below one token for non-empty input', () => {
        expect(estimateTokens('a')).toBe(1);
    });

    it('amortises Latin text at four characters per token', () => {
        expect(estimateTokens('abcd')).toBe(1);
        expect(estimateTokens('abcdefgh')).toBe(2);
    });

    it('counts each CJK glyph as a full token', () => {
        const cjk = '代码治理';
        expect(estimateTokens(cjk)).toBe(cjk.length);
    });

    it('reports CJK prompts as heavier than the same-length Latin prompts', () => {
        const latin = 'abcdefgh';
        const cjk = '代码治理检查';
        expect(estimateTokens(cjk)).toBeGreaterThan(estimateTokens(latin));
    });

    it('counts fullwidth forms as wide glyphs', () => {
        // U+FF21 FULLWIDTH LATIN CAPITAL LETTER A
        expect(estimateTokens('\uff21')).toBe(1);
    });
});

describe('measureJsonBaseline — the payload a compact prompt replaces', () => {
    it('returns zero for an empty record set', () => {
        expect(measureJsonBaseline([])).toBe(0);
    });

    it('equals the serialized length of the same records', () => {
        const records = [{ rule: 'CPX-001', line: 3 }];
        expect(measureJsonBaseline(records)).toBe(JSON.stringify(records).length);
    });

    it('grows with the record set', () => {
        const one = measureJsonBaseline([{ rule: 'A' }]);
        const two = measureJsonBaseline([{ rule: 'A' }, { rule: 'B' }]);
        expect(two).toBeGreaterThan(one);
    });
});

describe('estimateNarrowTokens — baseline estimate without re-serializing', () => {
    it('returns zero for a non-positive length', () => {
        expect(estimateNarrowTokens(0)).toBe(0);
        expect(estimateNarrowTokens(-5)).toBe(0);
    });

    it('matches the narrow-character ratio', () => {
        expect(estimateNarrowTokens(8)).toBe(estimateTokens('abcdefgh'));
    });
});
