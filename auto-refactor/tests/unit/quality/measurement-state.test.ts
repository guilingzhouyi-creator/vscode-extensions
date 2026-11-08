/**
 * Module: Review measurement contract tests
 * File Path: tests/unit/quality/measurement-state.test.ts
 * Architecture Role: Enforce absent, failed, and measured observation semantics.
 * Dependencies & Triggers: Vitest and review-contracts.
 * Responsibilities: Verify finite values, provenance, and absence without fabricated defaults.
 * Exit Semantics & Design Rationale: Behavior is asserted at the measurement boundary.
 */
import { describe, expect, it } from 'vitest';
import { numberMeasurement } from '../../../src/core/review/review-contracts';

const provenance = { source: 'trajectory-comparison' as const, sampleIds: ['change-1'] };

describe('review measurement states', () => {
    it('retains an absent observation with its reason', () => {
        expect(numberMeasurement(null, provenance, 'missing-baseline')).toEqual({
            status: 'unmeasured',
            reason: 'missing-baseline',
        });
    });

    it.each([0, 20, -20])('retains a measured value of %s', (value) => {
        expect(numberMeasurement(value, provenance, 'unused')).toEqual({
            status: 'measured',
            value,
            provenance,
        });
    });

    it.each([NaN, Infinity, -Infinity])('rejects a non-finite measurement %s', (value) => {
        expect(numberMeasurement(value, provenance, 'unused')).toMatchObject({
            status: 'failed',
            error: { code: 'NON_FINITE_MEASUREMENT' },
        });
    });

    it.each(['', '   ', '\t\n'])('rejects a blank sample identity %j', (sampleId) => {
        expect(
            numberMeasurement(90, { ...provenance, sampleIds: [sampleId] }, 'unused'),
        ).toMatchObject({
            status: 'unmeasured',
            reason: 'missing-provenance',
        });
    });

    it('does not accept a value without source samples', () => {
        expect(numberMeasurement(90, { source: 'analysis', sampleIds: [] }, 'unused')).toEqual({
            status: 'unmeasured',
            reason: 'missing-provenance',
        });
    });

    it('does not retain a caller-owned mutable sample list', () => {
        const samples = ['first'];
        const result = numberMeasurement(1, { source: 'analysis', sampleIds: samples }, 'unused');
        samples.push('not-observed');
        expect(result).toMatchObject({ status: 'measured', provenance: { sampleIds: ['first'] } });
    });
});
