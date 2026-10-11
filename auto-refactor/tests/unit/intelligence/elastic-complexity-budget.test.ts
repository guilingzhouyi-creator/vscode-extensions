/**
 * Module: Unit Test — Elastic Complexity Budget Blast Radius Verification
 * File Path: tests/unit/intelligence/elastic-complexity-budget.test.ts
 * Architecture Role: Verifies the second-order blast radius multiplier and elastic budget allowances.
 * Dependencies & Triggers: Vitest framework, elastic-complexity-budget module.
 * Responsibilities: Assert that unexported helper functions gain 1.2x budget while exported functions remain at base.
 * Exit Semantics & Design Rationale: Deterministic test suite passing under `npm test` and `vitest run`.
 */

import { describe, it, expect } from 'vitest';
import {
    computeBlastRadiusMultiplier,
    evaluateElasticComplexityBudget,
    type FunctionComplexityContext,
} from '../../../src/core/intelligence/elastic-complexity-budget';

describe('Elastic Complexity Budget — Blast Radius Dimension', () => {
    it('grants 1.2x multiplier to unexported functions with shallow nesting (depth <= 3)', () => {
        expect(computeBlastRadiusMultiplier(false, 2)).toBe(1.2);
        expect(computeBlastRadiusMultiplier(false, 3)).toBe(1.2);
        expect(computeBlastRadiusMultiplier(false, undefined)).toBe(1.2);
    });

    it('denies 1.2x bonus to unexported functions when nesting depth is too deep (> 3)', () => {
        expect(computeBlastRadiusMultiplier(false, 4)).toBe(1.0);
        expect(computeBlastRadiusMultiplier(false, 5)).toBe(1.0);
    });

    it('denies 1.2x bonus to exported functions regardless of nesting depth', () => {
        expect(computeBlastRadiusMultiplier(true, 1)).toBe(1.0);
        expect(computeBlastRadiusMultiplier(true, 2)).toBe(1.0);
        expect(computeBlastRadiusMultiplier(true, 4)).toBe(1.0);
    });

    it('defaults to 1.0 multiplier when isExported is undefined', () => {
        expect(computeBlastRadiusMultiplier(undefined, 2)).toBe(1.0);
    });

    it('allows higher CC for private helper while flagging exported function at same CC', () => {
        const privateFn: FunctionComplexityContext = {
            name: 'internalHelper',
            filePath: 'src/core/helpers.ts',
            language: 'typescript',
            cc: 17,
            loc: 30,
            maxDepth: 2,
            startLine: 1,
            startColumn: 1,
            isExported: false,
        };

        const publicFn: FunctionComplexityContext = {
            ...privateFn,
            name: 'exportedApi',
            isExported: true,
        };

        const privateEval = evaluateElasticComplexityBudget(privateFn, 12, 20);
        const publicEval = evaluateElasticComplexityBudget(publicFn, 12, 20);

        expect(privateEval.multipliers.blastRadius).toBe(1.2);
        expect(publicEval.multipliers.blastRadius).toBe(1.0);

        // EffectiveWarn for private is higher due to 1.2x multiplier
        expect(privateEval.effectiveWarn).toBeGreaterThan(publicEval.effectiveWarn);
        expect(privateEval.isExceeded).toBe(false);
        expect(publicEval.isExceeded).toBe(true);
    });
});
