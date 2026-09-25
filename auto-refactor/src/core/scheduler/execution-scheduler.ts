/**
 * Module: Core Engine - Execution Scheduler Interfaces
 * File Path: src/core/scheduler/execution-scheduler.ts
 * Architecture Role: Primary contract definitions for the unified execution scheduler layer;
 *   decouples high-throughput task submission from worker thread and process pool runtimes.
 * Dependencies & Triggers: Consumes AnalyzerContext and Issue types from ../types;
 *   consumed by worker-pool-manager, sparse-orchestrator, and CLI execution engines.
 * Responsibilities: Declare task priority levels, execution target topologies, task descriptor
 *   contracts, scheduler metrics, and the IExecutionScheduler interface.
 * Exit Semantics & Design Rationale: Pure contracts and enums; synchronous zero-cost abstractions
 *   enabling seamless pluggability across Node threads, child processes, and in-memory executors.
 */


/**
 * Task priority enumeration for preemptive scheduler dispatching.
 */
export enum TaskPriority {
    IDLE = 0,
    LOW = 10,
    NORMAL = 20,
    HIGH = 30,
    CRITICAL = 40,
}

/**
 * Target execution runtime environment for dispatched tasks.
 */
export type ExecutionTargetKind = 'in_process' | 'worker_thread' | 'process_fork';

/**
 * Status lifecycle of a scheduled review task.
 */
export type TaskExecutionStatus =
    | 'pending'
    | 'running'
    | 'completed'
    | 'failed'
    | 'cancelled';

/**
 * Task payload descriptor submitted to the execution scheduler.
 */
export interface ExecutionTask<TInput = unknown, TResult = unknown> {
    /** Unique task identifier */
    readonly id: string;
    /** Logical domain or analyzer family identifier */
    readonly domain: string;
    /** Dispatch priority */
    readonly priority: TaskPriority;
    /** Preferred execution environment */
    readonly targetKind: ExecutionTargetKind;
    /** Execution payload data passed to worker */
    readonly input: TInput;
    /** Creation timestamp in milliseconds */
    readonly createdAt: number;
    /** Optional execution timeout in milliseconds */
    readonly timeoutMs?: number;
    /** Optional affinity key to bind tasks with shared locality to the same worker */
    readonly affinityKey?: string;
    /** Custom execution function for in-process or thread dispatch */
    readonly execute?: (input: TInput) => Promise<TResult> | TResult;
}

/**
 * Runtime telemetry and performance metrics collected by the scheduler.
 */
export interface SchedulerMetrics {
    /** Total active worker units across thread and process pools */
    readonly activeWorkers: number;
    /** Maximum worker capacity provisioned */
    readonly workerCapacity: number;
    /** Number of tasks currently waiting in the priority queue */
    readonly queueDepth: number;
    /** Cumulative number of successfully executed tasks */
    readonly completedTasks: number;
    /** Cumulative number of failed or rejected tasks */
    readonly failedTasks: number;
    /** Instantaneous task throughput per second */
    readonly throughputPerSecond: number;
    /** Average task execution latency in milliseconds */
    readonly averageLatencyMs: number;
    /** 99th percentile task execution latency in milliseconds */
    readonly p99LatencyMs: number;
}

/**
 * Unified execution scheduler contract interface.
 */
export interface IExecutionScheduler {
    /**
     * Submits an execution task to the prioritized scheduler.
     *
     * @param task - Task descriptor containing payload and execution requirements
     * @returns Promise resolving to the task execution output
     */
    submit<TInput, TResult>(task: ExecutionTask<TInput, TResult>): Promise<TResult>;

    /**
     * Submits a batch of tasks to be processed with locality-aware affinity.
     *
     * @param tasks - Array of execution tasks
     * @returns Promise resolving to an array of task outputs
     */
    submitBatch<TInput, TResult>(tasks: ExecutionTask<TInput, TResult>[]): Promise<TResult[]>;

    /**
     * Retrieves current runtime metrics and capacity utilization.
     */
    getMetrics(): SchedulerMetrics;

    /**
     * Gracefully shuts down all workers and cancels pending tasks.
     *
     * @param drainTimeoutMs - Maximum wait time for in-flight tasks to finish
     */
    shutdown(drainTimeoutMs?: number): Promise<void>;
}
