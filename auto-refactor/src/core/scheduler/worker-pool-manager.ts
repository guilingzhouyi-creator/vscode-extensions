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
import { sharedMemoryGovernor, CacheEvictionTier } from '../memory/memory-governor';

const MAX_BOOSTED_PRIORITY = 40;
const PRIORITY_BOOST_STEP = 10;
const DEFAULT_DRAIN_TIMEOUT_MS = 5000;
const METRICS_WINDOW_RESET_MS = 5000;
const DEFAULT_MAX_LATENCY_SAMPLES = 500;
const MAX_ANALYZER_INSTANCES_PER_BUCKET = 32;

const DEFAULT_FALLBACK_CPU_COUNT = 4;
const MAX_DEFAULT_CONCURRENCY = 16;
const MIN_DEFAULT_CONCURRENCY = 2;
const MIN_QUEUE_DEPTH_LIMIT = 10;
const MIN_STARVATION_AGE_MS = 500;
const CRITICAL_TASK_PRIORITY_THRESHOLD = 30;
const MILLIS_PER_SECOND = 1000;
const SHUTDOWN_POLL_INTERVAL_MS = 20;
const PERCENTILE_99_RATIO = 0.99;

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
    private oldestStarvableEnqueuedAt = 0;
    private activeWorkersCount = 0;
    private isShuttingDown = false;

    // Telemetry accumulators
    private completedCount = 0;
    private failedCount = 0;
    private readonly recordedDurations: number[] = [];
    private readonly maxLatencySamples = DEFAULT_MAX_LATENCY_SAMPLES;
    private windowStartTime = Date.now();
    private windowCompletedCount = 0;

    // Analyzer instance pool for object reuse
    private readonly analyzerInstancePool = new Map<string, unknown[]>();

    public constructor(options?: WorkerPoolOptions) {
        const cpuCount =
            typeof os.cpus === 'function' ? os.cpus().length : DEFAULT_FALLBACK_CPU_COUNT;
        const defaultConcurrency = Math.min(
            MAX_DEFAULT_CONCURRENCY,
            Math.max(MIN_DEFAULT_CONCURRENCY, cpuCount),
        );
        this.maxConcurrency = Math.max(1, options?.maxConcurrency ?? defaultConcurrency);
        this.maxQueueDepth = Math.max(MIN_QUEUE_DEPTH_LIMIT, options?.maxQueueDepth ?? 10_000);
        this.starvationAgeMs = Math.max(MIN_STARVATION_AGE_MS, options?.starvationAgeMs ?? 3_000);
        this.defaultTaskTimeoutMs = options?.defaultTaskTimeoutMs ?? 30_000;

        sharedMemoryGovernor.register({
            name: `workerPoolManager:${Math.random().toString(36).slice(2)}`,
            tier: CacheEvictionTier.Ephemeral,
            clear: () => this.analyzerInstancePool.clear(),
            getSize: () => {
                let count = 0;
                for (const bucket of this.analyzerInstancePool.values()) {
                    count += bucket.length;
                }
                return count;
            },
        });
    }

    /**
     * Submits an individual task to the prioritized execution queue.
     */
    public submit<TInput, TResult>(task: ExecutionTask<TInput, TResult>): Promise<TResult> {
        if (this.isShuttingDown) {
            return Promise.reject(new Error('Scheduler is shutting down; cannot accept new tasks'));
        }

        if (
            this.queue.length >= this.maxQueueDepth &&
            task.priority < CRITICAL_TASK_PRIORITY_THRESHOLD
        ) {
            const queueMsg = `Scheduler queue capacity reached (${this.queue.length} >= ${this.maxQueueDepth})`;
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

            const queuedTaskItem: QueuedTask<TInput, TResult> = {
                task,
                resolve,
                reject,
                enqueuedAt: Date.now(),
                timer,
            };

            this.insertPrioritized(queuedTaskItem);
            this.pumpExecutionSlots();
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
     * Borrows an analyzer instance according to tiered residency (KTransformers offloading).
     * Hot resident experts are retained; cold offloaded experts are created on demand.
     */
    public acquireTieredAnalyzer<T>(domain: string, isHotResident: boolean, factory: () => T): T {
        if (!isHotResident) {
            return factory();
        }
        return this.acquireAnalyzer(domain, factory);
    }

    /**
     * Returns an analyzer instance to the tiered pool. Cold instances are evicted immediately.
     */
    public releaseTieredAnalyzer<T>(domain: string, instance: T, isHotResident: boolean): void {
        if (!isHotResident) {
            return;
        }
        this.releaseAnalyzer(domain, instance);
    }

    /**
     * Borrows an analyzer instance from the reusable object pool.
     */
    public acquireAnalyzer<T>(domain: string, factory: () => T): T {
        const bucket = this.analyzerInstancePool.get(domain);
        if (bucket && bucket.length > 0) {
            const inst = bucket.pop() as T;
            if (inst && typeof (inst as any).resetState === 'function') {
                (inst as any).resetState();
            }
            return inst;
        }
        return factory();
    }

    /**
     * Returns an analyzer instance to the reusable object pool.
     */
    public releaseAnalyzer<T>(domain: string, instance: T): void {
        if (instance && typeof (instance as any).resetState === 'function') {
            (instance as any).resetState();
        }
        let bucket = this.analyzerInstancePool.get(domain);
        if (!bucket) {
            bucket = [];
            this.analyzerInstancePool.set(domain, bucket);
        }
        if (bucket.length < MAX_ANALYZER_INSTANCES_PER_BUCKET) {
            bucket.push(instance);
        }
    }

    /**
     * Retrieves aggregated runtime telemetry and throughput metrics.
     */
    public getMetrics(): SchedulerMetrics {
        const now = Date.now();
        const windowElapsedSec = Math.max(0.1, (now - this.windowStartTime) / MILLIS_PER_SECOND);
        const throughput = Math.round((this.windowCompletedCount / windowElapsedSec) * 100) / 100;

        let avgLatency = 0;
        let percentile99Latency = 0;

        if (this.recordedDurations.length > 0) {
            const sum = this.recordedDurations.reduce((acc, val) => acc + val, 0);
            avgLatency = Number((sum / this.recordedDurations.length).toFixed(2));
            const sorted = [...this.recordedDurations].sort(
                (firstDuration, secondDuration) => firstDuration - secondDuration,
            );
            const percentile99Index = Math.min(
                sorted.length - 1,
                Math.floor(sorted.length * PERCENTILE_99_RATIO),
            );
            percentile99Latency = sorted[percentile99Index];
        }

        return {
            activeWorkers: this.activeWorkersCount,
            workerCapacity: this.maxConcurrency,
            queueDepth: this.queue.length,
            completedTasks: this.completedCount,
            failedTasks: this.failedCount,
            throughputPerSecond: throughput,
            averageLatencyMs: avgLatency,
            p99LatencyMs: percentile99Latency,
        };
    }

    /**
     * Gracefully shuts down workers and drains queues.
     */
    public async shutdown(drainTimeoutMs = DEFAULT_DRAIN_TIMEOUT_MS): Promise<void> {
        this.isShuttingDown = true;

        for (const taskEntry of this.queue) {
            if (taskEntry.timer) {
                clearTimeout(taskEntry.timer);
            }
            taskEntry.reject(new Error('Scheduler shutdown requested'));
        }
        this.queue.length = 0;
        this.oldestStarvableEnqueuedAt = 0;

        const start = Date.now();
        while (this.activeWorkersCount > 0 && Date.now() - start < drainTimeoutMs) {
            await new Promise((resolve) => setTimeout(resolve, SHUTDOWN_POLL_INTERVAL_MS));
        }

        this.analyzerInstancePool.clear();
    }

    /**
     * Pumps queued tasks into available worker execution slots.
     */
    private pumpExecutionSlots(): void {
        if (this.isShuttingDown) {
            return;
        }

        if (this.activeWorkersCount >= this.maxConcurrency || this.queue.length === 0) {
            return;
        }

        // Apply priority aging once per dispatch cycle to prevent starvation
        this.boostStarvedTasks();

        const availableSlots = this.maxConcurrency - this.activeWorkersCount;
        const dispatchCount = Math.min(availableSlots, this.queue.length);
        if (dispatchCount <= 0) {
            return;
        }

        const tasksToDispatch = this.queue.splice(0, dispatchCount);
        if (this.queue.length === 0) {
            this.oldestStarvableEnqueuedAt = 0;
        }

        for (const next of tasksToDispatch) {
            this.activeWorkersCount++;
            const startMs = Date.now();

            this.executeItem(next)
                .then((taskExecutionResult) => {
                    if (next.timer) {
                        clearTimeout(next.timer);
                    }
                    this.recordSuccess(Date.now() - startMs);
                    next.resolve(taskExecutionResult);
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
                    this.pumpExecutionSlots();
                });
        }
    }

    /**
     * Executes the task payload via its designated execution delegate.
     */
    private async executeItem<TInput, TResult>(
        taskItem: QueuedTask<TInput, TResult>,
    ): Promise<TResult> {
        const { task } = taskItem;
        if (typeof task.execute === 'function') {
            return task.execute(task.input);
        }
        return Promise.resolve(task.input as unknown as TResult);
    }

    /**
     * Inserts a task item into the priority queue with binary/linear order.
     */
    private insertPrioritized(incomingTask: QueuedTask<any, any>): void {
        const priority = incomingTask.task.priority as number;
        if (priority < MAX_BOOSTED_PRIORITY) {
            const currentOldest = this.oldestStarvableEnqueuedAt;
            if (
                currentOldest === 0 ||
                currentOldest === Number.MAX_SAFE_INTEGER ||
                incomingTask.enqueuedAt < currentOldest
            ) {
                this.oldestStarvableEnqueuedAt = incomingTask.enqueuedAt;
            }
        }

        let inserted = false;
        for (let i = 0; i < this.queue.length; i++) {
            if (incomingTask.task.priority > this.queue[i].task.priority) {
                this.queue.splice(i, 0, incomingTask);
                inserted = true;
                break;
            }
        }
        if (!inserted) {
            this.queue.push(incomingTask);
        }
    }

    private static compareTaskPriority(
        firstTask: QueuedTask<any, any>,
        secondTask: QueuedTask<any, any>,
    ): number {
        return (secondTask.task.priority as number) - (firstTask.task.priority as number);
    }

    /**
     * Promotes older low-priority tasks to prevent starvation under heavy load.
     */
    private boostStarvedTasks(): void {
        if (this.queue.length === 0) {
            this.oldestStarvableEnqueuedAt = 0;
            return;
        }

        const now = Date.now();
        if (
            this.oldestStarvableEnqueuedAt > 0 &&
            now - this.oldestStarvableEnqueuedAt < this.starvationAgeMs
        ) {
            return;
        }

        let anyBoosted = false;
        let minStarvableEnqueued = Number.MAX_SAFE_INTEGER;

        for (let i = 0; i < this.queue.length; i++) {
            const pendingTask = this.queue[i];
            let priority = pendingTask.task.priority as number;
            if (
                priority < MAX_BOOSTED_PRIORITY &&
                now - pendingTask.enqueuedAt >= this.starvationAgeMs
            ) {
                priority = Math.min(
                    MAX_BOOSTED_PRIORITY,
                    priority + PRIORITY_BOOST_STEP,
                ) as TaskPriority;
                const boostedTask: ExecutionTask<any, any> = {
                    ...pendingTask.task,
                    priority: priority as TaskPriority,
                };
                this.queue[i] = {
                    ...pendingTask,
                    task: boostedTask,
                };
                anyBoosted = true;
            }
            if (
                priority < MAX_BOOSTED_PRIORITY &&
                this.queue[i].enqueuedAt < minStarvableEnqueued
            ) {
                minStarvableEnqueued = this.queue[i].enqueuedAt;
            }
        }

        this.oldestStarvableEnqueuedAt = minStarvableEnqueued;

        if (anyBoosted) {
            this.queue.sort(WorkerPoolManager.compareTaskPriority);
        }
    }

    /**
     * Removes an item from the pending queue by task ID.
     */
    private removeQueuedTask(taskId: string): void {
        const index = this.queue.findIndex((entry) => entry.task.id === taskId);
        if (index !== -1) {
            const removed = this.queue.splice(index, 1)[0];
            if (removed.timer) {
                clearTimeout(removed.timer);
            }
            if (this.queue.length === 0) {
                this.oldestStarvableEnqueuedAt = 0;
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
        if (Date.now() - this.windowStartTime > METRICS_WINDOW_RESET_MS) {
            this.windowStartTime = Date.now();
            this.windowCompletedCount = 0;
        }
    }
}

/**
 * Default global singleton instance of WorkerPoolManager.
 */
export const defaultWorkerPoolManager = new WorkerPoolManager();
