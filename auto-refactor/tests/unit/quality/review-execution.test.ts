/**
 * Module: Review execution completion regressions
 * File Path: tests/unit/quality/review-execution.test.ts
 * Architecture Role: Pin completion semantics independently from diagnostic verdicts.
 * Dependencies & Triggers: Vitest, execution reducer, and the public SDK.
 * Responsibilities: Reject incomplete capabilities, pending deep work, and terminal failures.
 * Exit Semantics & Design Rationale: Routing or partial analysis cannot grant complete coverage.
 */
import { describe, expect, it } from 'vitest';
import { createReviewExecution } from '../../../src/core/review/review-execution';
import type { ReviewCapabilityCoverage } from '../../../src/core/review/review-contracts';
import { PraxisReviewClient } from '../../../src/core/praxis/praxis-review-client';

const executed: ReviewCapabilityCoverage = {
    analyzer: 'example',
    capability: 'syntax',
    language: 'typescript',
    required: true,
    status: 'executed',
};
const base = {
    reviewId: 'review-example',
    coverage: [executed],
    tracks: { fast: 'complete', deep: 'not-required' } as const,
};

describe('review execution completion', () => {
    it.each([
        { tracks: { fast: 'finished', deep: 'not-required' } },
        { tracks: { fast: 'complete', deep: 'unknown' } },
        { termination: 'finished' },
        { reviewId: '   ' },
        { coverage: [{ ...executed, analyzer: ' ' }] },
        { coverage: [{ ...executed, required: 'false' }] },
        { coverage: [{ ...executed, status: 'unknown' }] },
    ])('rejects malformed execution facts: %j', (override) => {
        expect(() =>
            Reflect.apply(createReviewExecution, undefined, [{ ...base, ...override }]),
        ).toThrow(/invalid review execution/i);
    });

    it('keeps completed execution separate from a diagnostic verdict', () => {
        expect(createReviewExecution(base).status).toBe('complete');
    });

    it('does not treat an empty or optional-only coverage set as complete', () => {
        expect(createReviewExecution({ ...base, coverage: [] }).status).toBe('partial');
        expect(
            createReviewExecution({ ...base, coverage: [{ ...executed, required: false }] }).status,
        ).toBe('partial');
    });

    it.each(['supported', 'unsupported', 'degraded'] as const)(
        'keeps %s required coverage partial',
        (status) => {
            expect(
                createReviewExecution({ ...base, coverage: [{ ...executed, status }] }).status,
            ).toBe('partial');
        },
    );

    it('requires explicit policy permission and a reason for non-applicability', () => {
        const capability = { ...executed, status: 'not-applicable' as const };
        expect(createReviewExecution({ ...base, coverage: [capability] }).status).toBe('partial');
        expect(
            createReviewExecution({ ...base, coverage: [{ ...capability, reason: 'no-input' }] })
                .status,
        ).toBe('partial');
        expect(
            createReviewExecution({
                ...base,
                coverage: [
                    {
                        ...capability,
                        reason: 'no-input',
                        policyAllowsNotApplicable: true,
                    },
                ],
            }).status,
        ).toBe('complete');
    });

    it('keeps required deep work pending until it actually completes', () => {
        expect(
            createReviewExecution({ ...base, tracks: { fast: 'complete', deep: 'pending' } })
                .status,
        ).toBe('partial');
        expect(
            createReviewExecution({ ...base, tracks: { fast: 'complete', deep: 'failed' } }).status,
        ).toBe('failed');
    });

    it.each(['cancelled', 'superseded'] as const)(
        'preserves terminal %s execution',
        (termination) => {
            expect(createReviewExecution({ ...base, termination }).status).toBe(termination);
        },
    );

    it('does not mark parser or execution failures complete', () => {
        const result = createReviewExecution({
            ...base,
            failures: [{ code: 'PARSE_FAILED', message: 'bad input' }],
        });
        expect(result.status).toBe('failed');
        expect(JSON.parse(JSON.stringify(result)).failures[0].code).toBe('PARSE_FAILED');
    });

    it('copies observations rather than retaining mutable caller arrays', () => {
        const coverage = [{ ...executed }];
        const result = createReviewExecution({ ...base, coverage });
        coverage[0].status = 'failed';
        coverage.length = 0;
        expect(result.coverage).toHaveLength(1);
        expect(result.status).toBe('complete');
        expect(result.coverage[0].status).toBe('executed');
    });

    it('reports legacy SDK static analysis as partial instead of a complete analyzer run', async () => {
        const client = new PraxisReviewClient({
            enableMoE: false,
            includeDualFacedPresentation: false,
        });
        const result = await client.reviewFile('src/example.ts', 'export const value = 1;');
        expect(result.execution.schemaVersion).toBe(1);
        expect(result.execution.status).toBe('partial');
        expect(result.execution.reviewId.length).toBeGreaterThan(0);
    });
});
