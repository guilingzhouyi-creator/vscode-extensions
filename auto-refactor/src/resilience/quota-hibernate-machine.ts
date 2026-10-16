/**
 * Module: Resilience Engine — Quota Exhaustion & Hibernate State Machine
 * File Path: src/resilience/quota-hibernate-machine.ts
 * Architecture Role: Resilient state machine managing rate-limit (429) backoff, quota exhaustion
 *   hibernation (up to 5 hours / 18,000,000 ms), and deterministic virtual-clock task wakeup.
 * Dependencies & Triggers: Node EventEmitter; consumed by daemon dispatchers, task executors,
 *   and remote API gateways upon 429 quota exhaustion.
 * Responsibilities:
 *   1. Track machine lifecycle states: IDLE, RUNNING, HIBERNATING, TERMINATED.
 *   2. On 429 or quota signal, compute remaining backoff duration capped at
 *      5 hours (18,000,000 ms).
 *   3. Enqueue pending tasks during hibernation without memory leaks or unbounded queues.
 *   4. Support VirtualClock injection for instant, deterministic testing of long-range timers.
 *   5. Trigger WAKE_UP event and flush queued tasks once hibernation countdown expires.
 * Exit Semantics & Design Rationale: Bounded state transitions;
 *   fail-safe recovery; zero loop heap allocation.
 */

import { EventEmitter } from 'events';

/**
 * Lifecycle states of the quota rate-limit and hibernation machine.
 */
export type QuotaMachineState = 'IDLE' | 'RUNNING' | 'HIBERNATING' | 'TERMINATED';

/** Maximum hibernation duration allowed: 5 hours in milliseconds. */
export const MAX_HIBERNATION_DURATION_MS = 5 * 60 * 60 * 1000; // 18,000,000 ms

/** Maximum queued tasks during hibernation to prevent memory exhaustion. */
export const MAX_PENDING_TASKS = 1000;

/** Virtual clock interface allowing deterministic time simulation in tests. */
export interface VirtualClock {
    now(): number;
    setTimeout(handler: () => void, timeoutMs: number): unknown;
    clearTimeout(timerId: unknown): void;
}

/** Standard system clock implementation backed by Node.js globals. */
export const SYSTEM_CLOCK: VirtualClock = {
    now: () => Date.now(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id as NodeJS.Timeout),
};

/**
 * Task descriptor queued during hibernation awaiting quota recovery.
 */
export interface PendingTask<T = unknown> {
    id: string;
    execute: () => Promise<T>;
    resolve: (value: T) => void;
    reject: (reason: unknown) => void;
}

/**
 * Quota exhaustion and hibernation state machine with virtual clock injection.
 */
export class QuotaHibernateMachine extends EventEmitter {
    private state: QuotaMachineState = 'IDLE';
    private clock: VirtualClock;
    private maxWaitMs: number;
    private hibernateStartMs: number = 0;
    private hibernateDurationMs: number = 0;
    private activeTimer: unknown = null;
    private taskQueue: PendingTask<any>[] = [];

    constructor(
        clock: VirtualClock = SYSTEM_CLOCK,
        maxWaitMs: number = MAX_HIBERNATION_DURATION_MS,
    ) {
        super();
        this.clock = clock;
        this.maxWaitMs = Math.min(maxWaitMs, MAX_HIBERNATION_DURATION_MS);
    }

    public getState(): QuotaMachineState {
        return this.state;
    }

    public start(): void {
        if (this.state === 'TERMINATED') {
            throw new Error('Cannot start terminated QuotaHibernateMachine');
        }
        if (this.state === 'IDLE') {
            this.setState('RUNNING');
        }
    }

    /**
     * Triggers hibernation on 429 quota exhaustion.
     * @param requestedWaitMs Desired wait duration or retry-after in milliseconds.
     * @returns Effective hibernation duration in milliseconds (capped at 5 hours).
     */
    public handleQuotaExhaustion(requestedWaitMs?: number): number {
        if (this.state === 'TERMINATED') {
            return 0;
        }

        const duration =
            requestedWaitMs && requestedWaitMs > 0
                ? Math.min(requestedWaitMs, this.maxWaitMs)
                : this.maxWaitMs;

        this.clearExistingTimer();
        this.hibernateStartMs = this.clock.now();
        this.hibernateDurationMs = duration;
        this.setState('HIBERNATING');

        this.emit('hibernating', {
            durationMs: duration,
            wakeAtMs: this.hibernateStartMs + duration,
        });

        this.activeTimer = this.clock.setTimeout(() => {
            this.wakeUp();
        }, duration);

        return duration;
    }

    /**
     * Wakes up the machine, transitions to RUNNING, and resumes pending tasks.
     */
    public wakeUp(): void {
        if (this.state !== 'HIBERNATING') {
            return;
        }

        this.clearExistingTimer();
        this.hibernateStartMs = 0;
        this.hibernateDurationMs = 0;
        this.setState('RUNNING');

        this.emit('wake_up', {
            timestampMs: this.clock.now(),
            pendingTasksCount: this.taskQueue.length,
        });

        this.flushPendingTasks();
    }

    /**
     * Submits a task. Runs immediately if RUNNING, or queues if HIBERNATING.
     */
    public enqueueTask<T>(id: string, execute: () => Promise<T>): Promise<T> {
        if (this.state === 'TERMINATED') {
            return Promise.reject(new Error('Machine is terminated'));
        }

        if (this.state === 'RUNNING' || this.state === 'IDLE') {
            if (this.state === 'IDLE') {
                this.setState('RUNNING');
            }
            return execute();
        }

        if (this.taskQueue.length >= MAX_PENDING_TASKS) {
            return Promise.reject(new Error('Hibernate task queue capacity exceeded (MAX=1000)'));
        }

        return new Promise<T>((resolve, reject) => {
            this.taskQueue.push({ id, execute, resolve, reject });
        });
    }

    public getRemainingHibernateMs(): number {
        if (this.state !== 'HIBERNATING') {
            return 0;
        }
        const elapsed = this.clock.now() - this.hibernateStartMs;
        return Math.max(0, this.hibernateDurationMs - elapsed);
    }

    public getPendingTaskCount(): number {
        return this.taskQueue.length;
    }

    public terminate(): void {
        this.clearExistingTimer();
        this.setState('TERMINATED');
        const tasks = this.taskQueue;
        this.taskQueue = [];
        for (let i = 0; i < tasks.length; i++) {
            tasks[i].reject(new Error('Machine terminated during hibernation'));
        }
    }

    private clearExistingTimer(): void {
        if (this.activeTimer !== null) {
            this.clock.clearTimeout(this.activeTimer);
            this.activeTimer = null;
        }
    }

    private setState(next: QuotaMachineState): void {
        const prev = this.state;
        if (prev === next) {
            return;
        }
        this.state = next;
        this.emit('state_changed', { from: prev, to: next, timestampMs: this.clock.now() });
    }

    private flushPendingTasks(): void {
        if (this.taskQueue.length === 0) {
            return;
        }
        const tasks = this.taskQueue;
        this.taskQueue = [];
        for (let i = 0; i < tasks.length; i++) {
            const task = tasks[i];
            task.execute().then(task.resolve).catch(task.reject);
        }
        this.emit('tasks_drained', { count: tasks.length });
    }
}
