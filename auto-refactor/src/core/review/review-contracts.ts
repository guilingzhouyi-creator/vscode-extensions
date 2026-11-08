/**
 * Module: Core Review — Measurement and Execution Contracts
 * File Path: src/core/review/review-contracts.ts
 * Architecture Role: Runtime-neutral observation boundary for analysis and quality consumers.
 * Dependencies & Triggers: Consumed by trajectory learning and review execution adapters.
 * Responsibilities: Preserve provenance, absence, execution coverage, and explicit failures.
 * Exit Semantics & Design Rationale: Invalid observations never become numeric fallback evidence.
 */

/** Source of an observation, distinct from the component rendering its result. */
export interface MeasurementProvenance {
    readonly source:
        | 'analysis'
        | 'trajectory-comparison'
        | 'test-execution'
        | 'mutation-execution'
        | 'holdout-validation';
    readonly sampleIds: readonly string[];
}

/** Structured failure suitable for persistence without exception serialization. */
export interface ReviewFailure {
    readonly code: string;
    readonly message: string;
    readonly retryable?: boolean;
}

/** An observation can be absent or inapplicable without claiming a numeric value. */
export type Measurement<T> =
    | { readonly status: 'measured'; readonly value: T; readonly provenance: MeasurementProvenance }
    | { readonly status: 'unmeasured'; readonly reason: string }
    | { readonly status: 'not-applicable'; readonly reason: string }
    | { readonly status: 'failed'; readonly error: ReviewFailure };

/** Review completion is independent from whether its diagnostics permit a change. */
export type ReviewExecutionStatus =
    'queued' | 'running' | 'partial' | 'complete' | 'failed' | 'cancelled' | 'superseded';

/** Execution coverage records a capability's actual outcome rather than its routing plan. */
export interface ReviewCapabilityCoverage {
    readonly analyzer: string;
    readonly capability: string;
    readonly language: string;
    readonly required: boolean;
    readonly status:
        'supported' | 'executed' | 'not-applicable' | 'unsupported' | 'failed' | 'degraded';
    readonly reason?: string;
    readonly policyAllowsNotApplicable?: boolean;
}

/**
 * Construct a numeric observation without manufacturing a value or provenance.
 *
 * @param value - Observed finite value, or null when no observation exists.
 * @param provenance - Actual source and sample identities used by the measurement.
 * @param missingReason - Reason reported when the observation is absent.
 * @returns A measured, unmeasured, or failed observation.
 */
export function numberMeasurement(
    value: number | null,
    provenance: MeasurementProvenance,
    missingReason: string,
): Measurement<number> {
    if (value === null) return { status: 'unmeasured', reason: missingReason };
    if (!Number.isFinite(value)) {
        return {
            status: 'failed',
            error: { code: 'NON_FINITE_MEASUREMENT', message: 'Measurement value must be finite.' },
        };
    }
    if (
        provenance.sampleIds.length === 0 ||
        provenance.sampleIds.some((id) => typeof id !== 'string' || id.trim().length === 0)
    ) {
        return { status: 'unmeasured', reason: 'missing-provenance' };
    }
    return {
        status: 'measured',
        value,
        provenance: { source: provenance.source, sampleIds: [...provenance.sampleIds] },
    };
}
