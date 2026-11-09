/**
 * Module: Review — Multi-Pass Coverage Tests
 * File Path: tests/unit/quality/review-pass-coverage.test.ts
 * Architecture Role: Falsify whole-file coverage inferred from repeated bounded executions.
 * Dependencies & Triggers: Vitest and production execution coverage reduction.
 * Responsibilities: Preserve failures, actual call counts and whole-file invocation evidence.
 * Exit Semantics & Design Rationale: Repeated windows never manufacture full coverage.
 */
import { describe, expect, it } from 'vitest';
import * as coverage from '../../../src/core/review/execution-coverage';
import type { FileExecutionObservation } from '../../../src/core/review/analyzer-execution';

function pass(lineBounds?: readonly [number, number], failed = false): FileExecutionObservation {
    return {
        path: 'src/a.ts', lineBounds,
        parser: { adapter: 'typescript', precision: 'ast', status: 'complete', diagnostics: 0 },
        analyzers: [{
            analyzer: 'performance', version: 1, calls: 1,
            status: failed ? 'failed' : 'complete',
            ...(failed ? { reason: 'analyzer-threw', failure: 'probe failure' } : {}),
        }],
    };
}
function reduce(execution: readonly FileExecutionObservation[]) {
    return coverage.collectReviewPassCoverage({
        requirements: [{ analyzer: 'performance', version: 1 }],
        inputs: [{ path: 'src/a.ts', kind: 'text' }], execution,
    });
}
describe('review pass coverage', () => {
    it('keeps adjacent windows incomplete even when their union spans the file', () => {
        expect(reduce([pass([1, 10]), pass([11, 20])])).toMatchObject([{
            path: 'src/a.ts', status: 'degraded', calls: 2, reason: 'line-window',
        }]);
    });
    it('accepts an actual whole-file pass while retaining all invocation counts', () => {
        expect(reduce([pass([1, 10]), pass()])).toMatchObject([{
            status: 'executed', calls: 2,
        }]);
    });
    it('does not erase an earlier failure after a successful whole-file retry', () => {
        expect(reduce([pass(undefined, true), pass()])).toMatchObject([{
            status: 'failed', calls: 2, reason: 'analyzer-threw',
        }]);
    });
    it('rejects observations outside the captured input scope', () => {
        expect(() => reduce([{ ...pass(), path: 'src/other.ts' }])).toThrow(/scope/);
    });
    it('does not join different analyzer versions into one executed fact', () => {
        const changed = { ...pass(), analyzers: [{ ...pass().analyzers[0], version: 2 }] };
        expect(reduce([pass(), changed])).toMatchObject([{
            status: 'failed', calls: 2, reason: 'inconsistent-analyzer-version',
        }]);
    });
});
