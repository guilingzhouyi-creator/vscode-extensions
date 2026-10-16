/**
 * Module: Resilience Engine — Rate Limit Truncated Exponential Backoff Machine
 * File Path: src/resilience/rate-limit-backoff.ts
 * Architecture Role: Generic rate-limit backoff controller with full jitter and
 *   three-strike circuit breaker state machine for API resilience.
 * Dependencies & Triggers: None (zero external dependencies); consumed by remote
 *   API callers, Praxis client SDK, and task orchestration loops.
 * Responsibilities:
 *   1. Calculate truncated exponential backoff:
 *      T = min(600s, max(T_base, 5s) * 2^(a-1)) * (1 +/- J), J in [0, 0.2];
 *   2. Enforce three-strikes circuit breaker: suspend auto-retry (canAutoRetry = false)
 *      after 3 consecutive failures until operator manual confirmation;
 *   3. Support deterministic RNG and clock injection for test repeatability.
 * Exit Semantics & Design Rationale: Pure, fail-safe state machine. All time metrics
 *   strictly carry *Ms dimensions. Clamped within defined bounds with zero unhandled exceptions.
 */

/** Maximum backoff ceiling in milliseconds: 600s = 600,000ms. */
export const MAX_BACKOFF_CEILING_MS = 600_000;

/** Minimum base delay floor in milliseconds: 5s = 5,000ms. */
export const MIN_BASE_DELAY_MS = 5_000;

/** Default base delay in milliseconds: 5s = 5,000ms. */
export const DEFAULT_BASE_DELAY_MS = 5_000;

/** Maximum jitter ratio: J in [0, 0.2]. */
export const MAX_JITTER_RATIO = 0.2;

/** Three-strike threshold: after 3 consecutive failures, auto-retry is suspended. */
export const THREE_STRIKES_THRESHOLD = 3;

/**
 * Configuration options for the RateLimitBackoffMachine.
 */
export interface RateLimitBackoffOptions {
    /** Base delay in milliseconds (defaults to 5,000ms). */
    readonly baseDelayMs?: number;
    /** Maximum delay cap in milliseconds (defaults to 600,000ms). */
    readonly maxDelayMs?: number;
    /** Jitter ratio in [0, 0.2] (defaults to 0.2). */
    readonly jitterRatio?: number;
    /** Consecutive failure threshold for circuit break (defaults to 3). */
    readonly strikeThreshold?: number;
    /** Deterministic random number generator in [0, 1) for testing. */
    readonly rng?: () => number;
    /** Clock timestamp provider returning milliseconds epoch. */
    readonly clockMs?: () => number;
}

/**
 * Result returned upon recording a failure.
 */
export interface BackoffFailureResult {
    readonly attempt: number;
    readonly consecutiveFailures: number;
    readonly delayMs: number;
    readonly canAutoRetry: boolean;
    readonly isCircuitBroken: boolean;
    readonly requiresManualConfirmation: boolean;
}

/**
 * Snapshot of the current state of the backoff machine.
 */
export interface BackoffMachineState {
    readonly attempt: number;
    readonly consecutiveFailures: number;
    readonly canAutoRetry: boolean;
    readonly isCircuitBroken: boolean;
    readonly lastFailureTimestampMs: number | null;
    readonly lastSuccessTimestampMs: number | null;
}

/**
 * Generic Rate Limit Backoff Machine implementing truncated exponential backoff,
 * full jitter, and three-strike circuit breaker suspension.
 */
export class RateLimitBackoffMachine {
    private readonly baseDelayMs: number;
    private readonly maxDelayMs: number;
    private readonly jitterRatio: number;
    private readonly strikeThreshold: number;
    private readonly rng: () => number;
    private readonly clockMs: () => number;

    private _attempt = 0;
    private _consecutiveFailures = 0;
    private _canAutoRetry = true;
    private _isCircuitBroken = false;
    private _lastFailureTimestampMs: number | null = null;
    private _lastSuccessTimestampMs: number | null = null;

    constructor(options: RateLimitBackoffOptions = {}) {
        this.baseDelayMs = Math.max(
            MIN_BASE_DELAY_MS,
            options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS,
        );
        this.maxDelayMs = Math.max(this.baseDelayMs, options.maxDelayMs ?? MAX_BACKOFF_CEILING_MS);
        this.jitterRatio = Math.max(
            0,
            Math.min(MAX_JITTER_RATIO, options.jitterRatio ?? MAX_JITTER_RATIO),
        );
        this.strikeThreshold = Math.max(1, options.strikeThreshold ?? THREE_STRIKES_THRESHOLD);
        this.rng = options.rng ?? Math.random;
        this.clockMs = options.clockMs ?? Date.now;
    }

    /** Current cumulative attempt count since last success or full reset. */
    get attempt(): number {
        return this._attempt;
    }

    /** Number of consecutive recorded failures. */
    get consecutiveFailures(): number {
        return this._consecutiveFailures;
    }

    /** Whether automatic retry is allowed (false when strike threshold reached). */
    get canAutoRetry(): boolean {
        return this._canAutoRetry;
    }

    /** Whether the circuit breaker is tripped, suspending automatic retries. */
    get isCircuitBroken(): boolean {
        return this._isCircuitBroken;
    }

    /** Timestamp of the last recorded failure in milliseconds, or null. */
    get lastFailureTimestampMs(): number | null {
        return this._lastFailureTimestampMs;
    }

    /** Timestamp of the last recorded success in milliseconds, or null. */
    get lastSuccessTimestampMs(): number | null {
        return this._lastSuccessTimestampMs;
    }

    /**
     * Computes the truncated exponential backoff delay with jitter for a given attempt.
     * Formula: T = min(600s, max(T_base, 5s) * 2^(a-1)) * (1 +/- J), J in [0, 0.2]
     *
     * @param attempt - 1-based attempt index (defaults to current attempt or 1).
     * @returns Delay in milliseconds.
     */
    computeDelayMs(attempt?: number): number {
        const a = Math.max(1, attempt ?? (this._attempt > 0 ? this._attempt : 1));
        const power = Math.pow(2, a - 1);
        const nominalDelayMs = Math.min(this.maxDelayMs, this.baseDelayMs * power);

        // Jitter: (1 +/- J) where J in [0, 0.2]. Range is [1 - J, 1 + J].
        const r = this.rng();
        const clampedR = Math.max(0, Math.min(1, r));
        const jitterFactor = 1 - this.jitterRatio + clampedR * 2 * this.jitterRatio;

        const calculatedDelayMs = Math.round(nominalDelayMs * jitterFactor);
        return Math.max(0, calculatedDelayMs);
    }

    /**
     * Records an execution failure, advances attempt count and failure streak,
     * trips the circuit breaker on reaching the strike threshold, and computes next delay.
     *
     * @param _error - Optional error context for logging.
     * @returns Result descriptor with retry status and delay.
     */
    recordFailure(_error?: unknown): BackoffFailureResult {
        this._attempt++;
        this._consecutiveFailures++;
        this._lastFailureTimestampMs = this.clockMs();

        if (this._consecutiveFailures >= this.strikeThreshold) {
            this._canAutoRetry = false;
            this._isCircuitBroken = true;
        }

        const delayMs = this.computeDelayMs(this._attempt);
        return {
            attempt: this._attempt,
            consecutiveFailures: this._consecutiveFailures,
            delayMs,
            canAutoRetry: this._canAutoRetry,
            isCircuitBroken: this._isCircuitBroken,
            requiresManualConfirmation: this._isCircuitBroken,
        };
    }

    /**
     * Records an execution success, resetting failure count, attempt counter,
     * and closing any open circuit.
     */
    recordSuccess(): void {
        this._attempt = 0;
        this._consecutiveFailures = 0;
        this._canAutoRetry = true;
        this._isCircuitBroken = false;
        this._lastSuccessTimestampMs = this.clockMs();
    }

    /**
     * Operator manual confirmation: explicitly resets circuit breaker suspension,
     * allowing automatic retries to resume after a three-strike trip.
     */
    manualConfirm(): void {
        this._consecutiveFailures = 0;
        this._canAutoRetry = true;
        this._isCircuitBroken = false;
    }

    /**
     * Resets the machine completely to its initial pristine state.
     */
    reset(): void {
        this._attempt = 0;
        this._consecutiveFailures = 0;
        this._canAutoRetry = true;
        this._isCircuitBroken = false;
        this._lastFailureTimestampMs = null;
        this._lastSuccessTimestampMs = null;
    }

    /**
     * Returns an immutable snapshot of current machine state.
     */
    getState(): BackoffMachineState {
        return {
            attempt: this._attempt,
            consecutiveFailures: this._consecutiveFailures,
            canAutoRetry: this._canAutoRetry,
            isCircuitBroken: this._isCircuitBroken,
            lastFailureTimestampMs: this._lastFailureTimestampMs,
            lastSuccessTimestampMs: this._lastSuccessTimestampMs,
        };
    }
}
