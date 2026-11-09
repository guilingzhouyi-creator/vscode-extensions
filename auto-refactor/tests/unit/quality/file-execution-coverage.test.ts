/**
 * Module: Review — Required File Coverage Tests
 * File Path: tests/unit/quality/file-execution-coverage.test.ts
 * Architecture Role: Exercise coverage reduction and production completion semantics together.
 * Dependencies & Triggers: Vitest and scanner observation/completion contracts.
 * Responsibilities: Reject registration-only, degraded, mismatched, failed and empty execution claims.
 * Exit Semantics & Design Rationale: Deterministic facts model scanner outcomes, not diagnostic counts.
 */
import { describe, expect, it } from 'vitest';
import type {
    FileExecutionObservation, AnalyzerExecutionObservation,
} from '../../../src/core/review/analyzer-execution';
import {
    captureFileRequirements, collectExecutionCoverage,
} from '../../../src/core/review/execution-coverage';
import { createReviewExecution } from '../../../src/core/review/review-execution';

function observed(): FileExecutionObservation {
    return {
        path: 'a.ts',
        parser: { adapter: 'typescript', precision: 'ast', status: 'complete', diagnostics: 0 },
        analyzers: [{ analyzer: 'complexity', version: 1, calls: 5, status: 'complete' }],
    };
}
function collect(file?: FileExecutionObservation, version = 1) {
    return collectExecutionCoverage({
        requirements: [{ analyzer: 'complexity', version }],
        inputs: [{ path: 'a.ts', kind: 'text' }], execution: file ? [file] : [],
    });
}
function completion(coverage: ReturnType<typeof collect>) {
    return createReviewExecution({
        reviewId: 'coverage-test', coverage, tracks: { fast: 'complete', deep: 'complete' },
    }).status;
}
function changedAnalyzer(changes: Partial<AnalyzerExecutionObservation>) {
    const file = observed();
    return { ...file, analyzers: [{ ...file.analyzers[0], ...changes }] };
}

describe('required file execution coverage', () => {
    it('retains real calls, version and path in immutable executed facts', () => {
        const facts = collect(observed());
        expect(facts).toEqual([{
            path: 'a.ts', analyzer: 'complexity', capability: 'file-analysis', language: 'typescript',
            required: true, status: 'executed', calls: 5, observedVersion: 1, requiredVersion: 1,
        }]);
        expect(Object.isFrozen(facts)).toBe(true);
        expect(Object.isFrozen(facts[0])).toBe(true);
        expect(completion(facts)).toBe('complete');
    });

    it('keeps configured but unobserved analyzers incomplete', () => {
        const facts = collect();
        expect(facts[0]).toMatchObject({ status: 'supported', calls: 0, reason: 'analyzer-not-run' });
        expect(completion(facts)).toBe('partial');
    });

    it.each(['routing-skip', 'preflight-skip'])('does not exempt %s', (reason) => {
        const facts = collect(changedAnalyzer({ calls: 0, status: 'not-run', reason }));
        expect(facts[0]).toMatchObject({ status: 'supported', reason });
        expect(facts[0].policyAllowsNotApplicable).toBeUndefined();
        expect(completion(facts)).toBe('partial');
    });

    it('preserves failure after some hooks ran', () => {
        const facts = collect(changedAnalyzer({ calls: 3, status: 'failed', reason: 'analyzer-exception' }));
        expect(facts[0]).toMatchObject({ status: 'failed', calls: 3 });
        expect(completion(facts)).toBe('failed');
    });

    it.each([
        ['lexical', { adapter: 'skeleton', precision: 'lexical', status: 'degraded', diagnostics: 0 }],
        ['unspecified', { adapter: 'custom', precision: 'unspecified', status: 'unavailable', diagnostics: null }],
        ['recovery', { adapter: 'typescript', precision: 'ast', status: 'degraded', diagnostics: 1 }],
        ['unknown diagnostics', { adapter: 'custom', precision: 'ast', status: 'complete', diagnostics: null }],
    ] as const)('keeps %s parsing incomplete', (_, parser) => {
        const facts = collect({ ...observed(), parser });
        expect(facts[0].status).toBe('degraded');
        expect(completion(facts)).toBe('partial');
    });

    it('retains unsupported parser state', () => {
        const file = observed();
        const facts = collect({ ...file, parser: { ...file.parser, status: 'unsupported' } });
        expect(facts[0]).toMatchObject({ status: 'unsupported', reason: 'parser-unsupported' });
        expect(completion(facts)).toBe('partial');
    });

    it('does not treat a line window as full-file execution', () => {
        const facts = collect({ ...observed(), lineBounds: [2, 5] });
        expect(facts[0]).toMatchObject({ status: 'degraded', reason: 'line-window' });
        expect(completion(facts)).toBe('partial');
    });

    it('keeps explicitly partial analyzer output incomplete', () => {
        const facts = collect(changedAnalyzer({ status: 'partial', reason: 'limited-analysis' }));
        expect(facts[0]).toMatchObject({ status: 'degraded', reason: 'limited-analysis' });
    });

    it('rejects a language-exclusive expert on a different language despite real calls', () => {
        const facts = collectExecutionCoverage({
            requirements: [{ analyzer: 'python-modern', version: 1 }],
            inputs: [{ path: 'a.ts', kind: 'text' }],
            execution: [changedAnalyzer({ analyzer: 'python-modern' })],
        });
        expect(facts[0]).toMatchObject({
            status: 'unsupported', reason: 'analyzer-language-unsupported', calls: 5,
        });
        expect(completion(facts)).toBe('partial');
    });

    it('pins the required version to observed implementation', () => {
        expect(collect(observed(), 2)[0]).toMatchObject({
            status: 'degraded', reason: 'analyzer-version-mismatch', observedVersion: 1, requiredVersion: 2,
        });
        expect(collect(changedAnalyzer({ version: null }))[0]).toMatchObject({
            status: 'degraded', reason: 'analyzer-version-unknown',
        });
    });

    it.each(['missing', 'binary', 'symlink', 'submodule', 'unsupported'] as const)(
        'preserves %s input without a policy exemption', (kind) => {
            const facts = collectExecutionCoverage({
                requirements: [{ analyzer: 'complexity' }],
                inputs: [{ path: 'a.ts', kind }], execution: [],
            });
            expect(facts[0]).toMatchObject({ status: 'unsupported', reason: `input-${kind}`, calls: 0 });
            expect(completion(facts)).toBe('partial');
        },
    );

    it('cannot establish completeness from empty scope or requirements', () => {
        for (const requirements of [[], [{ analyzer: 'complexity' }]]) {
            const facts = collectExecutionCoverage({ requirements, inputs: [], execution: [] });
            expect(facts).toEqual([]);
            expect(completion(facts)).toBe('partial');
        }
        expect(completion(collectExecutionCoverage({
            requirements: [], inputs: [{ path: 'a.ts', kind: 'text' }], execution: [observed()],
        }))).toBe('partial');
    });

    it('rejects duplicate observations instead of choosing favorable facts', () => {
        expect(() => collectExecutionCoverage({
            requirements: [], inputs: [], execution: [observed(), observed()],
        })).toThrow(/duplicate file/i);
        const file = observed();
        expect(() => collect({ ...file, analyzers: [...file.analyzers, ...file.analyzers] }))
            .toThrow(/duplicate analyzer/i);
        expect(() => collectExecutionCoverage({
            requirements: [], inputs: [{ path: 'a.ts', kind: 'text' }, { path: 'a.ts', kind: 'text' }],
            execution: [],
        })).toThrow(/duplicate snapshot/i);
    });

    it('captures requirement inputs before asynchronous execution', () => {
        const requirements = [{ analyzer: 'complexity', version: 1 }];
        const captured = captureFileRequirements(requirements);
        requirements[0].version = 2;
        requirements.length = 0;
        expect(captured).toEqual([{ analyzer: 'complexity', version: 1 }]);
        expect(Object.isFrozen(captured[0])).toBe(true);
    });

    it.each([0, -1, NaN, Infinity, 1.5])('rejects an invalid version %s', (version) => {
        expect(() => captureFileRequirements([{ analyzer: 'complexity', version }])).toThrow(/version/i);
    });

    it('rejects blank and duplicate requirements', () => {
        expect(() => captureFileRequirements([{ analyzer: ' ' }])).toThrow(/name/i);
        expect(() => captureFileRequirements([{ analyzer: 'complexity' }, { analyzer: 'complexity' }]))
            .toThrow(/duplicate/i);
    });
});
