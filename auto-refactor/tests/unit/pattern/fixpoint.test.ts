/**
 * Module: Unit Tests — Structural Pattern Fixpoint Engine
 * File Path: tests/unit/pattern/fixpoint.test.ts
 * Architecture Role: Verifies GritQL-inspired transitive fixpoint rewriting,
 *   monotonic multi-round convergence, cycle prevention, and diff generation.
 * Dependencies & Triggers: Consumes structural-pattern-engine.ts; executed via vitest.
 * Responsibilities:
 *   1. Assert single-round noop and unchanged source handling.
 *   2. Assert multi-pass convergence on chained transformable expressions.
 *   3. Assert maxRounds cap prevents infinite rewrite loops.
 *   4. Assert cumulative unified diff accuracy across multiple rounds.
 * Exit Semantics & Design Rationale: Deterministic in-memory execution; fail-fast assertions.
 */

import { describe, it, expect } from 'vitest';
import {
    rewriteUntilFixpoint,
    type PatternSpec,
} from '../../../src/core/pattern';

describe('StructuralPatternEngine — Transitive Fixpoint Rewriting', () => {
    it('returns noop result when no patterns match', () => {
        const spec: PatternSpec = {
            id: 'RULE_NOOP',
            pattern: 'foo($X)',
            rewrite: 'bar($X)',
        };
        const source = 'const a = 1; const b = 2;';
        const result = rewriteUntilFixpoint(source, spec);

        expect(result.hasChanged).toBe(false);
        expect(result.rewrittenSource).toBe(source);
        expect(result.matches).toHaveLength(0);
        expect(result.roundsApplied).toBe(0);
    });

    it('converges in a single round for simple non-nested patterns', () => {
        const spec: PatternSpec = {
            id: 'RULE_SIMPLE',
            pattern: '$X ? true : false',
            rewrite: 'Boolean($X)',
        };
        const source = 'const flag = isValid ? true : false;';
        const result = rewriteUntilFixpoint(source, spec, { maxRounds: 3 });

        expect(result.hasChanged).toBe(true);
        expect(result.rewrittenSource).toBe('const flag = Boolean(isValid);');
        expect(result.roundsApplied).toBe(1);
    });

    it('iteratively simplifies nested chained expressions across multiple rounds', () => {
        // Pattern: double negation elimination: !(!$X) -> $X
        const doubleNegationSpec: PatternSpec = {
            id: 'RULE_DOUBLE_NEG',
            pattern: '!(!$X)',
            rewrite: '$X',
        };

        // Source has quadruple negation: !(!(!(!value))) -> 2 rounds to simplify to value
        const source = 'const clean = !(!(!(!value)));';
        const result = rewriteUntilFixpoint(source, doubleNegationSpec, { maxRounds: 5 });

        expect(result.hasChanged).toBe(true);
        expect(result.rewrittenSource).toBe('const clean = value;');
        expect(result.roundsApplied).toBe(2);
        expect(result.unifiedDiff).toContain('-const clean = !(!(!(!value)));');
        expect(result.unifiedDiff).toContain('+const clean = value;');
    });

    it('respects maxRounds budget and terminates cleanly', () => {
        // Pattern: strip outer wrapper
        const unwrapSpec: PatternSpec = {
            id: 'RULE_UNWRAP',
            pattern: 'wrap($X)',
            rewrite: '$X',
        };

        const deepNested = 'wrap(wrap(wrap(wrap(leaf))))';
        // With maxRounds = 2, only 2 layers of wrap should be stripped
        const result = rewriteUntilFixpoint(deepNested, unwrapSpec, { maxRounds: 2 });

        expect(result.hasChanged).toBe(true);
        expect(result.roundsApplied).toBe(2);
        expect(result.rewrittenSource).toBe('wrap(wrap(leaf))');
    });

    it('handles empty input and empty rules safely', () => {
        const emptyResult = rewriteUntilFixpoint('', []);
        expect(emptyResult.hasChanged).toBe(false);
        expect(emptyResult.roundsApplied).toBe(0);
    });
});
