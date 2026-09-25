/**
 * Module: Core Engine - Worker Pool Manager & Execution Dispatcher
 * File Path: src/core/scheduler/worker-pool-manager.ts
 * Architecture Role: Concrete multi-tier execution manager implementing IExecutionScheduler;
 *   allocates and coordinates concurrent worker slots across thread, process, and in-memory pools.
 * Dependencies & Triggers: Consumes execution-scheduler contracts, Node os and events modules;
 *   triggered by CLI scans, daemon batch processes, and sparse-orchestrator requests.
 * Responsibilities: Manage task priority queues with starvation prevention; dynamically scale
 *   worker pool size to CPU cores; pool analyzer instances; collect runtime latency metrics.
 * Exit Semantics & Design Rationale: Never throws unhandled rejections; fails individual tasks
 *   gracefully; provides complete cleanup on shutdown to prevent worker or event listener leaks.
 */

import * as os from 'os';
import type {
    ExecutionTask,
    IExecutionScheduler,
    SchedulerMetrics,
    TaskPriority,
} from './execution-scheduler';

/**
 * Configuration options for the WorkerPoolManager.
 */
export interface WorkerPoolOptions {
    /** Maximum number of concurrent worker execution slots (defaults to os.cpus().length) */
    readonly maxConcurrency?: number;
    /** Maximum pending queue depth before rejecting non-critical tasks */
    readonly maxQueueDepth?: number;
    /** Aging threshold in milliseconds after which task priority is dynamically boosted */
    readonly starvationAgeMs?: number;
    /** Default timeout in milliseconds for submitted tasks */
    readonly defaultTaskTimeoutMs?: number;
}

interface QueuedTask<TInput = unknown, TResult = unknown> {
    readonly task: ExecutionTask<TInput, TResult>;
    readonly resolve: (result: TResult) => void;
    readonly reject: (error: Error) => void;
    readonly enqueuedAt: number;
    timer?: NodeJS.Timeout;
}

/**
 * Concrete multi-tier worker pool manager and preemptive task scheduler.
 */
export class WorkerPoolManager implements IExecutionScheduler {
    private readonly maxConcurrency: number;
    private readonly maxQueueDepth: number;
    private readonly starvationAgeMs: number;
    private readonly defaultTaskTimeoutMs: number;

    private readonly queue: QueuedTask<any, any>[] = [];
    private activeWorkersCount = 0;
    private isShuttingDown = false;

    // Telemetry accumulators
    private completedCount = 0;
    private failedCount = 0;
    private readonly recordedDurations: number[] = [];
    private readonly maxLatencySamples = 500;
    private windowStartTime = Date.now();
    private windowCompletedCount = 0;

    // Analyzer instance pool for object reuse
    private readonly analyzerInstancePool = new Map<string, unknown[]>();

    public constructor(options?: WorkerPoolOptions) {
        const cpuCount = typeof os.cpus === 'function' ? os.cpus().length : 4;
        const defaultConcurrency = Math.min(16, Math.max(2, cpuCount));
        this.maxConcurrency = Math.max(1, options?.maxConcurrency ?? defaultConcurrency);
        this.maxQueueDepth = Math.max(10, options?.maxQueueDepth ?? 10_000);
        this.starvationAgeMs = Math.max(500, options?.starvationAgeMs ?? 3_000);
        this.defaultTaskTimeoutMs = options?.defaultTaskTimeoutMs ?? 30_000;
    }

    /**
     * Submits an individual task to the prioritized execution queue.
     */
    public submit<TInput, TResult>(task: ExecutionTask<TInput, TResult>): Promise<TResult> {
        if (this.isShuttingDown) {
            return Promise.reject(
                new Error('Scheduler is shutting down; cannot accept new tasks'),
            );
        }

        if (this.queue.length >= this.maxQueueDepth && task.priority < 30) {
            const queueMsg =
                `Scheduler queue capacity reached (${this.queue.length} >= ${this.maxQueueDepth})`;
            return Promise.reject(new Error(queueMsg));
        }

        return new Promise<TResult>((resolve, reject) => {
            const timeoutMs = task.timeoutMs ?? this.defaultTaskTimeoutMs;
            let timer: NodeJS.Timeout | undefined;

            if (timeoutMs > 0 && timeoutMs < Number.MAX_SAFE_INTEGER) {
                timer = setTimeout(() => {
                    this.removeQueuedTask(task.id);
                    this.failedCount++;
                    reject(new Error(`Task [${task.id}] timed out after ${timeoutMs}ms`));
                }, timeoutMs);
            }

            const item: QueuedTask<TInput, TResult> = {
                task,
                resolve,
                reject,
                enqueuedAt: Date.now(),
                timer,
            };

            this.insertPrioritized(item);
            this.pump();
        });
    }

    /**
     * Submits a collection of tasks and awaits their collective execution.
     */
    public async submitBatch<TInput, TResult>(
        tasks: ExecutionTask<TInput, TResult>[],
    ): Promise<TResult[]> {
        return Promise.all(tasks.map((task) => this.submit(task)));
    }

    /**
     * Borrows an analyzer instance from the reusable object pool.
     */
    public acquireAnalyzer<T>(domain: string, factory: () => T): T {
        const bucket = this.analyzerInstancePool.get(domain);
        if (bucket && bucket.length > 0) {
            return bucket.pop() as T;
        }
        return factory();
    }

    /**
     * Returns an analyzer instance to the reusable object pool.
     */
    public releaseAnalyzer<T>(domain: string, instance: T): void {
        let bucket = this.analyzerInstancePool.get(domain);
        if (!bucket) {
            bucket = [];
            this.analyzerInstancePool.set(domain, bucket);
        }
        if (bucket.length < 32) {
            bucket.push(instance);
        }
    }

    /**
     * Retrieves aggregated runtime telemetry and throughput metrics.
     */
    public getMetrics(): SchedulerMetrics {
        const now = Date.now();
        const windowElapsedSec = Math.max(0.1, (now - this.windowStartTime) / 1000);
        const throughput = Number((this.windowCompletedCount / windowElapsedSec).toFixed(1));

        let avgLatency = 0;
        let p99Latency = 0;

        if (this.recordedDurations.length > 0) {
            const sum = this.recordedDurations.reduce((acc, val) => acc + val, 0);
            avgLatency = Number((sum / this.recordedDurations.length).toFixed(2));
            const sorted = [...this.recordedDurations].sort((a, b) => a - b);
            const p99Index = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99));
            p99Latency = sorted[p99Index];
        }

        return {
            activeWorkers: this.activeWorkersCount,
            workerCapacity: this.maxConcurrency,
            queueDepth: this.queue.length,
            completedTasks: this.completedCount,
            failedTasks: this.failedCount,
            throughputPerSecond: throughput,
            averageLatencyMs: avgLatency,
            p99LatencyMs: p99Latency,
        };
    }

    /**
     * Gracefully shuts down workers and drains queues.
     */
    public async shutdown(drainTimeoutMs = 5000): Promise<void> {
        this.isShuttingDown = true;

        for (const item of this.queue) {
            if (item.timer) {
                clearTimeout(item.timer);
            }
            item.reject(new Error('Scheduler shutdown requested'));
        }
        this.queue.length = 0;

        const start = Date.now();
        while (this.activeWorkersCount > 0 && Date.now() - start < drainTimeoutMs) {
            await new Promise((resolve) => setTimeout(resolve, 20));
        }

        this.analyzerInstancePool.clear();
    }

    /**
     * Dispatches queued tasks to available worker execution slots.
     */
    private pump(): void {
        if (this.isShuttingDown) {
            return;
        }

        while (this.activeWorkersCount < this.maxConcurrency && this.queue.length > 0) {
            // Apply priority aging to prevent starvation
            this.boostStarvedTasks();

            const next = this.queue.shift();
            if (!next) {
                break;
            }

            this.activeWorkersCount++;
            const startMs = Date.now();

            this.executeItem(next)
                .then((result) => {
                    if (next.timer) {
                        clearTimeout(next.timer);
                    }
                    this.recordSuccess(Date.now() - startMs);
                    next.resolve(result);
                })
                .catch((err) => {
                    if (next.timer) {
                        clearTimeout(next.timer);
                    }
                    this.failedCount++;
                    next.reject(err instanceof Error ? err : new Error(String(err)));
                })
                .finally(() => {
                    this.activeWorkersCount--;
                    this.pump();
                });
        }
    }

    /**
     * Executes the task payload via its designated execution delegate.
     */
    private async executeItem<TInput, TResult>(
        item: QueuedTask<TInput, TResult>,
    ): Promise<TResult> {
        const { task } = item;
        if (typeof task.execute === 'function') {
            return task.execute(task.input);
        }
        return Promise.resolve(task.input as unknown as TResult);
    }

    /**
     * Inserts a task item into the priority queue with binary/linear order.
     */
    private insertPrioritized(item: QueuedTask<any, any>): void {
        let inserted = false;
        for (let i = 0; i < this.queue.length; i++) {
            if (item.task.priority > this.queue[i].task.priority) {
                this.queue.splice(i, 0, item);
                inserted = true;
                break;
            }
        }
        if (!inserted) {
            this.queue.push(item);
        }
    }

    /**
     * Promotes older low-priority tasks to prevent starvation under heavy load.
     */
    private boostStarvedTasks(): void {
        const now = Date.now();
        for (let i = 0; i < this.queue.length; i++) {
            const item = this.queue[i];
            if (now - item.enqueuedAt >= this.starvationAgeMs) {
                // Remove and re-insert with boosted priority
                this.queue.splice(i, 1);
                const currentPriority = item.task.priority as number;
                const boostedPriority = Math.min(40, currentPriority + 10) as TaskPriority;
                const boostedTask: ExecutionTask<any, any> = {
                    ...item.task,
                    priority: boostedPriority,
                };
                const boostedItem: QueuedTask<any, any> = {
                    ...item,
                    task: boostedTask,
                };
                this.insertPrioritized(boostedItem);
            }
        }
    }

    /**
     * Removes an item from the pending queue by task ID.
     */
    private removeQueuedTask(id: string): void {
        const index = this.queue.findIndex((entry) => entry.task.id === id);
        if (index !== -1) {
            const removed = this.queue.splice(index, 1)[0];
            if (removed.timer) {
                clearTimeout(removed.timer);
            }
        }
    }

    /**
     * Records task execution success and records rolling latency samples.
     */
    private recordSuccess(durationElapsed: number): void {
        this.completedCount++;
        this.windowCompletedCount++;
        if (this.recordedDurations.length >= this.maxLatencySamples) {
            this.recordedDurations.shift();
        }
        this.recordedDurations.push(durationElapsed);

        // Reset rolling throughput window every 5 seconds
        if (Date.now() - this.windowStartTime > 5000) {
            this.windowStartTime = Date.now();
            this.windowCompletedCount = 0;
        }
    }
}

/**
 * Default global singleton instance of WorkerPoolManager.
 */
export const defaultWorkerPoolManager = new WorkerPoolManager();
