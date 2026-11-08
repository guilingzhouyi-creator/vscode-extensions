/**
 * Module: Core Review — Execution Completion
 * File Path: src/core/review/review-execution.ts
 * Architecture Role: Reduce observed coverage and track outcomes into a versioned status.
 * Dependencies & Triggers: Neutral review contracts; consumed by SDK and service adapters.
 * Responsibilities: Preserve incomplete, failed, cancelled, and superseded execution states.
 * Exit Semantics & Design Rationale: Complete execution alone never grants publication authority.
 */
import type {
    ReviewCapabilityCoverage,
    ReviewExecutionStatus,
    ReviewFailure,
} from './review-contracts';

/** Execution lifecycle status of a review track (`fast` or `deep`). */
export type ReviewTrackStatus = 'pending' | 'running' | 'complete' | 'failed' | 'not-required';

/** Raw execution telemetry input reduced into a canonical review execution record. */
export interface ReviewExecutionInput {
    readonly reviewId: string;
    readonly coverage: readonly ReviewCapabilityCoverage[];
    readonly tracks: { readonly fast: ReviewTrackStatus; readonly deep: ReviewTrackStatus };
    readonly termination?: 'cancelled' | 'superseded';
    readonly failures?: readonly ReviewFailure[];
}

/** Versioned execution facts, kept separate from diagnostic verdict and trusted receipts. */
export interface ReviewExecution {
    readonly schemaVersion: 1;
    readonly reviewId: string;
    readonly status: ReviewExecutionStatus;
    readonly coverage: readonly ReviewCapabilityCoverage[];
    readonly tracks: ReviewExecutionInput['tracks'];
    readonly failures: readonly ReviewFailure[];
}

function nonBlank(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

function validCoverage(item: ReviewCapabilityCoverage): boolean {
    if (!item || ![item.analyzer, item.capability, item.language].every(nonBlank)) return false;
    if (typeof item.required !== 'boolean') return false;
    if (
        !['supported', 'executed', 'not-applicable', 'unsupported', 'failed', 'degraded'].includes(
            item.status,
        )
    )
        return false;
    if (item.reason !== undefined && !nonBlank(item.reason)) return false;
    return (
        item.policyAllowsNotApplicable === undefined ||
        typeof item.policyAllowsNotApplicable === 'boolean'
    );
}

function validExecution(input: ReviewExecutionInput): boolean {
    if (!input || !nonBlank(input.reviewId)) return false;
    if (!Array.isArray(input.coverage) || !input.coverage.every(validCoverage)) return false;
    const trackStatuses: readonly string[] = [
        'pending',
        'running',
        'complete',
        'failed',
        'not-required',
    ];
    if (
        !input.tracks ||
        ![input.tracks.fast, input.tracks.deep].every((status) => trackStatuses.includes(status))
    )
        return false;
    if (input.termination !== undefined && !['cancelled', 'superseded'].includes(input.termination))
        return false;
    return (
        input.failures === undefined ||
        (Array.isArray(input.failures) &&
            input.failures.every(
                (failure) =>
                    failure &&
                    nonBlank(failure.code) &&
                    nonBlank(failure.message) &&
                    (failure.retryable === undefined || typeof failure.retryable === 'boolean'),
            ))
    );
}

function capabilityComplete(item: ReviewCapabilityCoverage): boolean {
    if (item.status === 'executed') return true;
    return (
        item.status === 'not-applicable' &&
        item.policyAllowsNotApplicable === true &&
        typeof item.reason === 'string' &&
        item.reason.trim().length > 0
    );
}

function hasExecutionFailure(input: ReviewExecutionInput): boolean {
    return (
        (input.failures?.length ?? 0) > 0 ||
        input.tracks.fast === 'failed' ||
        input.tracks.deep === 'failed' ||
        input.coverage.some((item) => item.required && item.status === 'failed')
    );
}

function executionStatus(input: ReviewExecutionInput): ReviewExecutionStatus {
    if (input.termination) return input.termination;
    const required = input.coverage.filter((item) => item.required);
    if (hasExecutionFailure(input)) return 'failed';
    if (input.tracks.fast === 'pending') return 'queued';
    if (input.tracks.fast === 'running') return 'running';
    if (input.tracks.deep === 'pending' || input.tracks.deep === 'running') return 'partial';
    if (required.length === 0 || required.some((item) => !capabilityComplete(item)))
        return 'partial';
    return 'complete';
}

/**
 * Build an independent execution observation from actual track and capability outcomes.
 *
 * @param input - Review identity, completion observations, and explicit terminal state.
 * @returns A versioned execution result whose completion is derived rather than caller asserted.
 * @throws When the review identifier is absent.
 */
export function createReviewExecution(input: ReviewExecutionInput): ReviewExecution {
    if (!validExecution(input)) throw new Error('Invalid review execution facts');
    return {
        schemaVersion: 1,
        reviewId: input.reviewId,
        status: executionStatus(input),
        coverage: input.coverage.map((item) => ({ ...item })),
        tracks: { ...input.tracks },
        failures: (input.failures ?? []).map((failure) => ({ ...failure })),
    };
}
