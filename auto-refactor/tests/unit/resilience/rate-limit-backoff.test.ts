import { describe, it, expect } from 'vitest';
import {
    RateLimitBackoffMachine,
    MAX_BACKOFF_CEILING_MS,
    MIN_BASE_DELAY_MS,
} from '../../../src/resilience/rate-limit-backoff';

describe('RateLimitBackoffMachine (API Rate Limiting & Resilience)', () => {
    describe('Truncated Exponential Backoff Formula', () => {
        it('computes exponential growth: T_base * 2^(a-1) with 0 jitter', () => {
            const machine = new RateLimitBackoffMachine({
                baseDelayMs: 5_000,
                maxDelayMs: 600_000,
                jitterRatio: 0.2,
                rng: () => 0.5,
            });

            expect(machine.computeDelayMs(1)).toBe(5_000);
            expect(machine.computeDelayMs(2)).toBe(10_000);
            expect(machine.computeDelayMs(3)).toBe(20_000);
            expect(machine.computeDelayMs(4)).toBe(40_000);
        });

        it('enforces minimum base delay floor of 5,000ms (5s)', () => {
            const machine = new RateLimitBackoffMachine({
                baseDelayMs: 1_000,
                rng: () => 0.5,
            });
            expect(machine.computeDelayMs(1)).toBe(MIN_BASE_DELAY_MS);
        });

        it('enforces maximum backoff ceiling of 600,000ms (600s)', () => {
            const machine = new RateLimitBackoffMachine({
                baseDelayMs: 5_000,
                maxDelayMs: 600_000,
                rng: () => 0.5,
            });
            expect(machine.computeDelayMs(10)).toBe(MAX_BACKOFF_CEILING_MS);
        });

        it('applies jitter within range [1 - J, 1 + J] where J in [0, 0.2]', () => {
            const minMachine = new RateLimitBackoffMachine({
                baseDelayMs: 10_000,
                jitterRatio: 0.2,
                rng: () => 0,
            });
            expect(minMachine.computeDelayMs(1)).toBe(8_000);

            const maxMachine = new RateLimitBackoffMachine({
                baseDelayMs: 10_000,
                jitterRatio: 0.2,
                rng: () => 1.0,
            });
            expect(maxMachine.computeDelayMs(1)).toBe(12_000);
        });
    });

    describe('Three-Strike Circuit Breaker Mechanism', () => {
        it('permits auto-retry for the first two consecutive failures', () => {
            const machine = new RateLimitBackoffMachine({ rng: () => 0.5 });

            const res1 = machine.recordFailure(new Error('429 Too Many Requests'));
            expect(res1.attempt).toBe(1);
            expect(res1.consecutiveFailures).toBe(1);
            expect(res1.canAutoRetry).toBe(true);
            expect(res1.isCircuitBroken).toBe(false);

            const res2 = machine.recordFailure(new Error('429 Too Many Requests'));
            expect(res2.attempt).toBe(2);
            expect(res2.consecutiveFailures).toBe(2);
            expect(res2.canAutoRetry).toBe(true);
            expect(res2.isCircuitBroken).toBe(false);
        });

        it('trips the circuit breaker on the 3rd consecutive failure and suspends auto-retry', () => {
            const machine = new RateLimitBackoffMachine({ rng: () => 0.5 });

            machine.recordFailure();
            machine.recordFailure();
            const res3 = machine.recordFailure();

            expect(res3.attempt).toBe(3);
            expect(res3.consecutiveFailures).toBe(3);
            expect(res3.canAutoRetry).toBe(false);
            expect(res3.isCircuitBroken).toBe(true);
            expect(res3.requiresManualConfirmation).toBe(true);
            expect(machine.canAutoRetry).toBe(false);
            expect(machine.isCircuitBroken).toBe(true);
        });

        it('resumes auto-retry when manualConfirm() is explicitly called by operator', () => {
            const machine = new RateLimitBackoffMachine({ rng: () => 0.5 });
            machine.recordFailure();
            machine.recordFailure();
            machine.recordFailure();
            expect(machine.canAutoRetry).toBe(false);

            machine.manualConfirm();
            expect(machine.canAutoRetry).toBe(true);
            expect(machine.isCircuitBroken).toBe(false);
            expect(machine.consecutiveFailures).toBe(0);
        });

        it('resets consecutive failures and attempt counter on recordSuccess()', () => {
            const machine = new RateLimitBackoffMachine({ rng: () => 0.5 });
            machine.recordFailure();
            machine.recordFailure();
            expect(machine.consecutiveFailures).toBe(2);

            machine.recordSuccess();
            expect(machine.consecutiveFailures).toBe(0);
            expect(machine.attempt).toBe(0);
            expect(machine.canAutoRetry).toBe(true);
            expect(machine.isCircuitBroken).toBe(false);
        });

        it('provides an accurate state snapshot via getState()', () => {
            const clock = 1_000_000;
            const machine = new RateLimitBackoffMachine({
                clockMs: () => clock,
                rng: () => 0.5,
            });

            machine.recordFailure();
            const state = machine.getState();
            expect(state.attempt).toBe(1);
            expect(state.consecutiveFailures).toBe(1);
            expect(state.canAutoRetry).toBe(true);
            expect(state.isCircuitBroken).toBe(false);
            expect(state.lastFailureTimestampMs).toBe(1_000_000);
        });
    });
});

