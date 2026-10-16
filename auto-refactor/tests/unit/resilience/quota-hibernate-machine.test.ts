/**
 * Module: Unit Test — Quota Exhaustion & Hibernate State Machine
 * File Path: tests/unit/resilience/quota-hibernate-machine.test.ts
 * Architecture Role: Deterministic verification of 5-hour quota sleep, virtual clock, and task recovery.
 * Dependencies & Triggers: vitest, QuotaHibernateMachine.
 * Responsibilities:
 *   1. Assert state transitions (IDLE -> RUNNING -> HIBERNATING -> RUNNING).
 *   2. Assert 5-hour upper bound ceiling (18,000,000 ms).
 *   3. Assert VirtualClock deterministic instant time advancement.
 *   4. Assert pending task queueing and automatic drainage on wakeup.
 * Exit Semantics & Design Rationale: Standard vitest suite; zero real-time delay.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    QuotaHibernateMachine,
    MAX_HIBERNATION_DURATION_MS,
    VirtualClock,
} from '../../../src/resilience/quota-hibernate-machine';

class MockVirtualClock implements VirtualClock {
    private currentTime = 1000000;
    private timers: { id: number; dueTime: number; handler: () => void }[] = [];
    private nextId = 1;

    public now(): number {
        return this.currentTime;
    }

    public setTimeout(handler: () => void, timeoutMs: number): unknown {
        const id = this.nextId++;
        this.timers.push({ id, dueTime: this.currentTime + timeoutMs, handler });
        return id;
    }

    public clearTimeout(timerId: unknown): void {
        this.timers = this.timers.filter((t) => t.id !== timerId);
    }

    public advanceTime(ms: number): void {
        this.currentTime += ms;
        const ready = this.timers.filter((t) => t.dueTime <= this.currentTime);
        this.timers = this.timers.filter((t) => t.dueTime > this.currentTime);
        for (const timer of ready) {
            timer.handler();
        }
    }
}

describe('QuotaHibernateMachine', () => {
    let clock: MockVirtualClock;
    let machine: QuotaHibernateMachine;

    beforeEach(() => {
        clock = new MockVirtualClock();
        machine = new QuotaHibernateMachine(clock);
    });

    it('should initialize in IDLE state and transition to RUNNING on start', () => {
        expect(machine.getState()).toBe('IDLE');
        machine.start();
        expect(machine.getState()).toBe('RUNNING');
    });

    it('should enter HIBERNATING on 429 quota signal and cap at 5 hours (18,000,000 ms)', () => {
        machine.start();
        // Request 10 hours
        const waitMs = machine.handleQuotaExhaustion(10 * 3600 * 1000);
        expect(waitMs).toBe(MAX_HIBERNATION_DURATION_MS);
        expect(machine.getState()).toBe('HIBERNATING');
        expect(machine.getRemainingHibernateMs()).toBe(MAX_HIBERNATION_DURATION_MS);
    });

    it('should queue tasks during hibernation and drain them on wake up', async () => {
        machine.start();
        machine.handleQuotaExhaustion(3600 * 1000); // 1 hour

        let executed = false;
        const taskPromise = machine.enqueueTask('task-1', async () => {
            executed = true;
            return 'success';
        });

        expect(executed).toBe(false);
        expect(machine.getPendingTaskCount()).toBe(1);

        // Advance 1 hour
        clock.advanceTime(3600 * 1000);

        expect(machine.getState()).toBe('RUNNING');
        const result = await taskPromise;
        expect(result).toBe('success');
        expect(executed).toBe(true);
        expect(machine.getPendingTaskCount()).toBe(0);
    });

    it('should support explicit wakeUp() call', () => {
        machine.start();
        machine.handleQuotaExhaustion(10000);
        expect(machine.getState()).toBe('HIBERNATING');
        machine.wakeUp();
        expect(machine.getState()).toBe('RUNNING');
    });

    it('should reject queued tasks when terminated', async () => {
        machine.start();
        machine.handleQuotaExhaustion(5000);
        const taskPromise = machine.enqueueTask('task-fail', async () => 'ok');
        machine.terminate();
        expect(machine.getState()).toBe('TERMINATED');
        await expect(taskPromise).rejects.toThrow('Machine terminated');
    });
});
