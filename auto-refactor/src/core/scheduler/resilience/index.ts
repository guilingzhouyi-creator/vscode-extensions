/**
 * Module: Core Scheduler — Resilience & Rate-Limit Backoff Subsystem Facade
 * File Path: src/core/scheduler/resilience/index.ts
 * Architecture Role: Central facade for rate limiting backoff and quota hibernation state machines.
 * Dependencies & Triggers: Consumed by agent quota gateway and task execution orchestrators.
 * Responsibilities: Re-export resilience state machines with an immutable facade satisfying ARCH-FAC-001.
 * Exit Semantics & Design Rationale: Immutable subsystem facade; deterministic recovery.
 */

import {
    QuotaHibernateMachine,
    MAX_HIBERNATION_DURATION_MS,
    SYSTEM_CLOCK,
} from './quota-hibernate-machine';
import {
    RateLimitBackoffMachine,
    MAX_BACKOFF_CEILING_MS,
    MIN_BASE_DELAY_MS,
} from './rate-limit-backoff';

export * from './quota-hibernate-machine';
export * from './rate-limit-backoff';

/** Subsystem facade providing frozen access to resilience machines and limits. */
export const ResilienceSubsystem = Object.freeze({
    QuotaHibernateMachine,
    RateLimitBackoffMachine,
    MAX_HIBERNATION_DURATION_MS,
    MAX_BACKOFF_CEILING_MS,
    MIN_BASE_DELAY_MS,
    SYSTEM_CLOCK,
});
