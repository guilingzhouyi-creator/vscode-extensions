/**
 * Module: Unit Test — Grouped Expert Dispatcher Bitmask Integrity
 * File Path: tests/unit/grouped-dispatcher-bitmask.test.ts
 * Architecture Role: Regression guard ensuring all 32 AnalyzerBit flags (including unsigned bit 31)
 *   resolve strictly via bitmask lookup rather than positional EXPERT_CATALOG index.
 * Dependencies & Triggers: Consumes GroupedExpertDispatcher, AnalyzerBit, BIT_TO_ANALYZER_NAME,
 *   and EXPERT_BY_BIT; runs under Vitest unit suite.
 * Responsibilities: Validate 1:1 parity between bit positions 0..31 and dispatched expertId batches,
 *   including combined multi-bit masks and signed negative coercion on bit 31.
 * Exit Semantics & Design Rationale: Passes when all 32 single-bit and composite assertions match.
 */
import { describe, expect, it } from 'vitest';
import { GroupedExpertDispatcher } from '../../src/core/experts/grouped-dispatcher';
import { AnalyzerBit, BIT_TO_ANALYZER_NAME } from '../../src/core/constants/analyzer-bitmask';
import { EXPERT_BY_BIT } from '../../src/core/experts/expert-catalog';

const TOTAL_BIT_COUNT = 32;
const BIT_INDEX_HIGH = 31;
const BIT_CONCURRENCY_UNSIGNED = (1 << BIT_INDEX_HIGH) >>> 0;

describe('GroupedExpertDispatcher 32-bit bitmask mapping', () => {
    const dispatcher = new GroupedExpertDispatcher();

    it('maps every single AnalyzerBit flag (0..31) 1:1 to its canonical expertId', () => {
        for (let bitIdx = 0; bitIdx < TOTAL_BIT_COUNT; bitIdx++) {
            const bit = (1 << bitIdx) >>> 0;
            const expectedName = BIT_TO_ANALYZER_NAME[bit];
            const catalogProfile = EXPERT_BY_BIT.get(bit);
            expect(expectedName).toBeDefined();
            expect(catalogProfile?.id).toBe(expectedName);

            const plan = dispatcher.buildDispatchPlan([
                {
                    id: `slice-${bitIdx}`,
                    filePath: `src/mod-${bitIdx}.ts`,
                    activeMask: bit,
                },
            ]);

            expect(plan.batches).toHaveLength(1);
            expect(plan.batches[0].expertBit).toBe(bit);
            expect(plan.batches[0].expertId).toBe(expectedName);
            expect(plan.activeExpertMask).toBe(bit);
            expect(plan.activeExpertIds).toEqual([expectedName]);
        }
    });

    it('normalizes signed bit 31 (AnalyzerBit.CONCURRENCY) to unsigned key lookup', () => {
        const plan = dispatcher.buildDispatchPlan([
            {
                id: 'concurrency-signed',
                filePath: 'src/worker.ts',
                activeMask: AnalyzerBit.CONCURRENCY,
            },
            {
                id: 'constants-and-concurrency',
                filePath: 'src/entry.ts',
                activeMask: AnalyzerBit.CONSTANTS | BIT_CONCURRENCY_UNSIGNED,
            },
        ]);

        const byId = new Map(plan.batches.map((batch) => [batch.expertId, batch]));
        expect(byId.get('constants')?.expertBit).toBe(AnalyzerBit.CONSTANTS);
        expect(byId.get('concurrency')?.expertBit).toBe(BIT_CONCURRENCY_UNSIGNED);
        expect(byId.get('concurrency')?.items.map((item) => item.id)).toEqual([
            'concurrency-signed',
            'constants-and-concurrency',
        ]);
        expect(plan.activeExpertMask).toBe(
            (AnalyzerBit.CONSTANTS | BIT_CONCURRENCY_UNSIGNED) >>> 0,
        );
    });
});
