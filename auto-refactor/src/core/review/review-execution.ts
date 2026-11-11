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

const STATUS_PENDING = 'pending';
const STATUS_RUNNING = 'running';
const STATUS_COMPLETE = 'complete';
const STATUS_FAILED = 'failed';
const STATUS_NOT_REQUIRED = 'not-required';
const STATUS_EXECUTED = 'executed';
const STATUS_NOT_APPLICABLE = 'not-applicable';
const STATUS_QUEUED = 'queued';
const STATUS_PARTIAL = 'partial';

const VALID_COVERAGE_STATUSES: ReadonlySet<string> = new Set([
    'supported',
    STATUS_EXECUTED,
    STATUS_NOT_APPLICABLE,
    'unsupported',
    STATUS_FAILED,
    'degraded',
]);

const VALID_TRACK_STATUSES: ReadonlySet<string> = new Set([
    STATUS_PENDING,
    STATUS_RUNNING,
    STATUS_COMPLETE,
    STATUS_FAILED,
    STATUS_NOT_REQUIRED,
]);

const VALID_TERMINATION_STATUSES: ReadonlySet<string> = new Set(['cancelled', 'superseded']);

function isNonBlankText(candidate: unknown): candidate is string {
    return typeof candidate === 'string' && candidate.trim().length > 0;
}

function isCoverageEntryValid(coverageItem: ReviewCapabilityCoverage): boolean {
    if (
        !coverageItem ||
        ![coverageItem.analyzer, coverageItem.capability, coverageItem.language].every(
            isNonBlankText,
        )
    ) {
        return false;
    }
    if (typeof coverageItem.required !== 'boolean') return false;
    if (!VALID_COVERAGE_STATUSES.has(coverageItem.status)) return false;
    if (coverageItem.reason !== undefined && !isNonBlankText(coverageItem.reason)) return false;
    return (
        coverageItem.policyAllowsNotApplicable === undefined ||
        typeof coverageItem.policyAllowsNotApplicable === 'boolean'
    );
}

function isExecutionInputValid(input: ReviewExecutionInput): boolean {
    if (!input || !isNonBlankText(input.reviewId)) return false;
    if (!Array.isArray(input.coverage) || !input.coverage.every(isCoverageEntryValid)) {
        return false;
    }
    if (
        !input.tracks ||
        ![input.tracks.fast, input.tracks.deep].every((status) => VALID_TRACK_STATUSES.has(status))
    ) {
        return false;
    }
    if (input.termination !== undefined && !VALID_TERMINATION_STATUSES.has(input.termination)) {
        return false;
    }
    return (
        input.failures === undefined ||
        (Array.isArray(input.failures) &&
            input.failures.every(
                (failure) =>
                    failure &&
                    isNonBlankText(failure.code) &&
                    isNonBlankText(failure.message) &&
                    (failure.retryable === undefined || typeof failure.retryable === 'boolean'),
            ))
    );
}

function isCapabilityComplete(coverageItem: ReviewCapabilityCoverage): boolean {
    if (coverageItem.status === STATUS_EXECUTED) return true;
    return (
        coverageItem.status === STATUS_NOT_APPLICABLE &&
        coverageItem.policyAllowsNotApplicable === true &&
        typeof coverageItem.reason === 'string' &&
        coverageItem.reason.trim().length > 0
    );
}

function hasExecutionFailure(input: ReviewExecutionInput): boolean {
    return (
        (input.failures?.length ?? 0) > 0 ||
        input.tracks.fast === STATUS_FAILED ||
        input.tracks.deep === STATUS_FAILED ||
        input.coverage.some(
            (coverageItem) => coverageItem.required && coverageItem.status === STATUS_FAILED,
        )
    );
}

function resolveExecutionStatus(input: ReviewExecutionInput): ReviewExecutionStatus {
    if (input.termination) return input.termination;
    const required = input.coverage.filter((coverageItem) => coverageItem.required);
    if (hasExecutionFailure(input)) return STATUS_FAILED;
    if (input.tracks.fast === STATUS_PENDING) return STATUS_QUEUED;
    if (input.tracks.fast === STATUS_RUNNING) return STATUS_RUNNING;
    if (input.tracks.deep === STATUS_PENDING || input.tracks.deep === STATUS_RUNNING) {
        return STATUS_PARTIAL;
    }
    if (
        required.length === 0 ||
        required.some((coverageItem) => !isCapabilityComplete(coverageItem))
    ) {
        return STATUS_PARTIAL;
    }
    return STATUS_COMPLETE;
}

/**
 * Build an independent execution observation from actual track and capability outcomes.
 *
 * @param input - Review identity, completion observations, and explicit terminal state.
 * @returns A versioned execution result whose completion is derived rather than caller asserted.
 * @throws When the review identifier is absent.
 */
export function createReviewExecution(input: ReviewExecutionInput): ReviewExecution {
    if (!isExecutionInputValid(input)) throw new Error('Invalid review execution facts');
    return {
        schemaVersion: 1,
        reviewId: input.reviewId,
        status: resolveExecutionStatus(input),
        coverage: input.coverage.map((item) => ({ ...item })),
        tracks: { ...input.tracks },
        failures: (input.failures ?? []).map((failure) => ({ ...failure })),
    };
}
