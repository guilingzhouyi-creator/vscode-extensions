/**
 * Module: RateLimitBackoff Unit Tests
 * File Path: tests/unit/rate-limit-backoff.test.ts
 * Architecture Role: Deterministic verification of truncated exponential backoff,
 *   full jitter distribution, and three-strike circuit breaker state transitions.
 * Dependencies & Triggers: Vitest / node:assert; RateLimitBackoffMachine.
 * Responsibilities: Prove math invariant bounds and state machine transitions.
 * Exit Semantics & Design Rationale: 100% deterministic with injected RNG and clock.
 */

import { describe, it, expect } from 'vitest';
import {
    RateLimitBackoffMachine,
    MIN_BASE_DELAY_MS,
    MAX_BACKOFF_CEILING_MS,
    MAX_JITTER_RATIO,
    THREE_STRIKES_THRESHOLD,
} from '../../src/resilience/rate-limit-backoff';

describe('RateLimitBackoffMachine', () => {
    it('initializes with defensive defaults and clamps invalid options', () => {
        const machine = new RateLimitBackoffMachine({
            baseDelayMs: 1_000, // Below minimum 5,000ms -> should clamp to 5,000ms
            maxDelayMs: 1_000_000, // Above maximum ceiling -> allowed, but checked against ceiling
            jitterRatio: 0.5, // Above max 0.2 -> clamped to 0.2
            strikeThreshold: 0, // Below min 1 -> clamped to 1
        });

        expect(machine.attempt).toBe(0);
        expect(machine.consecutiveFailures).toBe(0);
        expect(machine.canAutoRetry).toBe(true);
        expect(machine.isCircuitBroken).toBe(false);
        expect(machine.lastFailureTimestampMs).toBeNull();
        expect(machine.lastSuccessTimestampMs).toBeNull();
    });

    it('computes truncated exponential backoff with deterministic jitter', () => {
        // RNG returns 0.5 (midpoint -> jitterFactor = 1.0)
        let simulatedTimeMs = 1_000_000;
        const machine = new RateLimitBackoffMachine({
            baseDelayMs: MIN_BASE_DELAY_MS, // 5,000ms
            maxDelayMs: MAX_BACKOFF_CEILING_MS, // 600,000ms
            jitterRatio: MAX_JITTER_RATIO, // 0.2
            rng: () => 0.5, // Exactly 1.0 multiplier
            clockMs: () => simulatedTimeMs,
        });

        // Attempt 1: 5000 * 2^0 = 5,000ms
        const delay1 = machine.computeDelayMs(1);
        expect(delay1).toBe(5_000);

        // Attempt 2: 5000 * 2^1 = 10,000ms
        const delay2 = machine.computeDelayMs(2);
        expect(delay2).toBe(10_000);

        // Attempt 3: 5000 * 2^2 = 20,000ms
        const delay3 = machine.computeDelayMs(3);
        expect(delay3).toBe(20_000);

        // Attempt 8: 5000 * 2^7 = 640,000ms -> capped at 600,000ms
        const delay8 = machine.computeDelayMs(8);
        expect(delay8).toBe(MAX_BACKOFF_CEILING_MS);
    });

    it('bounds jitter correctly between [1 - J, 1 + J]', () => {
        const minJitterMachine = new RateLimitBackoffMachine({
            baseDelayMs: 10_000,
            jitterRatio: 0.2,
            rng: () => 0.0, // Minimum jitter -> 0.8 factor
        });
        expect(minJitterMachine.computeDelayMs(1)).toBe(8_000);

        const maxJitterMachine = new RateLimitBackoffMachine({
            baseDelayMs: 10_000,
            jitterRatio: 0.2,
            rng: () => 1.0, // Maximum jitter -> 1.2 factor
        });
        expect(maxJitterMachine.computeDelayMs(1)).toBe(12_000);
    });

    it('enforces three-strike circuit breaker trip and operator manual confirmation', () => {
        let simulatedTimeMs = 50_000;
        const machine = new RateLimitBackoffMachine({
            baseDelayMs: 5_000,
            strikeThreshold: THREE_STRIKES_THRESHOLD,
            rng: () => 0.5,
            clockMs: () => simulatedTimeMs,
        });

        // Failure 1
        simulatedTimeMs += 100;
        const res1 = machine.recordFailure(new Error('Transient 503'));
        expect(res1.attempt).toBe(1);
        expect(res1.consecutiveFailures).toBe(1);
        expect(res1.canAutoRetry).toBe(true);
        expect(res1.isCircuitBroken).toBe(false);
        expect(machine.lastFailureTimestampMs).toBe(50_100);

        // Failure 2
        simulatedTimeMs += 500;
        const res2 = machine.recordFailure(new Error('Transient 503'));
        expect(res2.attempt).toBe(2);
        expect(res2.consecutiveFailures).toBe(2);
        expect(res2.canAutoRetry).toBe(true);
        expect(res2.isCircuitBroken).toBe(false);

        // Failure 3 -> Circuit Trips!
        simulatedTimeMs += 1_000;
        const res3 = machine.recordFailure(new Error('Rate limit exceeded (429)'));
        expect(res3.attempt).toBe(3);
        expect(res3.consecutiveFailures).toBe(3);
        expect(res3.canAutoRetry).toBe(false);
        expect(res3.isCircuitBroken).toBe(true);
        expect(res3.requiresManualConfirmation).toBe(true);
        expect(machine.canAutoRetry).toBe(false);
        expect(machine.isCircuitBroken).toBe(true);

        // Operator confirms resolution
        machine.manualConfirm();
        expect(machine.consecutiveFailures).toBe(0);
        expect(machine.canAutoRetry).toBe(true);
        expect(machine.isCircuitBroken).toBe(false);
        // Attempt count is preserved across manual confirm until success/reset
        expect(machine.attempt).toBe(3);

        // Success resets attempts and circuit completely
        simulatedTimeMs += 2_000;
        machine.recordSuccess();
        expect(machine.attempt).toBe(0);
        expect(machine.consecutiveFailures).toBe(0);
        expect(machine.canAutoRetry).toBe(true);
        expect(machine.isCircuitBroken).toBe(false);
        expect(machine.lastSuccessTimestampMs).toBe(simulatedTimeMs);
    });

    it('supports full state snapshot and clean reset', () => {
        const machine = new RateLimitBackoffMachine({ baseDelayMs: 5_000 });
        machine.recordFailure();
        machine.recordFailure();

        const state = machine.getState();
        expect(state.attempt).toBe(2);
        expect(state.consecutiveFailures).toBe(2);
        expect(state.canAutoRetry).toBe(true);

        machine.reset();
        expect(machine.attempt).toBe(0);
        expect(machine.consecutiveFailures).toBe(0);
        expect(machine.canAutoRetry).toBe(true);
        expect(machine.lastFailureTimestampMs).toBeNull();
        expect(machine.lastSuccessTimestampMs).toBeNull();
    });
});
