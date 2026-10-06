/**
 * Substantial Contract Facade Template
 *
 * Demonstrates a compliant facade adhering to ARCH-FAC-001:
 * 1. Substantive business logic & orchestration (ELOC >= 15).
 * 2. Aggregates >= 3 orthogonal subdomains.
 * 3. Defensive runtime contract validation (guard clauses).
 * 4. Deep immutability guarantees via Object.freeze.
 */

// Simulated subdomains (orthogonal domain modules)
export interface ConfigService {
    get(key: string): string | undefined;
    has(key: string): boolean;
}

export interface TelemetryService {
    recordEvent(name: string, data: Record<string, unknown>): void;
    flush(): Promise<void>;
}

export interface TaskCoordinator {
    getActiveTaskCount(): number;
    dispatchTask(id: string, payload: unknown): boolean;
}

export interface SubsystemStatusSnapshot {
    readonly isReady: boolean;
    readonly activeTasks: number;
    readonly configLoaded: boolean;
    readonly timestamp: number;
}

export interface FacadeOptions {
    readonly timeoutMs?: number;
    readonly enableTelemetry?: boolean;
    readonly maxConcurrentTasks?: number;
}

export class CoreSystemFacade {
    private readonly config: ConfigService;
    private readonly telemetry: TelemetryService;
    private readonly coordinator: TaskCoordinator;
    private readonly options: FacadeOptions;

    constructor(
        config: ConfigService,
        telemetry: TelemetryService,
        coordinator: TaskCoordinator,
        options: FacadeOptions = {}
    ) {
        // 1. 运行时输入防御性契约断言与参数守卫 (ARCH-FAC-001)
        if (!config || !telemetry || !coordinator) {
            throw new Error('CoreSystemFacade requires all 3 domain services to be initialized.');
        }
        if (options.timeoutMs !== undefined && options.timeoutMs <= 0) {
            throw new RangeError('options.timeoutMs must be a positive integer.');
        }
        if (options.maxConcurrentTasks !== undefined && options.maxConcurrentTasks < 1) {
            throw new RangeError('options.maxConcurrentTasks must be at least 1.');
        }

        this.config = config;
        this.telemetry = telemetry;
        this.coordinator = coordinator;
        this.options = Object.freeze({ ...options });
    }

    /**
     * 编排三个子系统生成不可变快照 (Immutability Guarantee)
     */
    public getSystemSnapshot(): SubsystemStatusSnapshot {
        const rawSnapshot: SubsystemStatusSnapshot = {
            isReady: this.config.has('system.initialized'),
            activeTasks: this.coordinator.getActiveTaskCount(),
            configLoaded: this.config.has('env'),
            timestamp: Date.now(),
        };

        if (this.options.enableTelemetry) {
            this.telemetry.recordEvent('system.snapshot_queried', {
                activeTasks: rawSnapshot.activeTasks,
            });
        }

        // 不可变性封装保障：杜绝外部调用方对状态进行非法突变
        return Object.freeze(rawSnapshot);
    }

    /**
     * 协调分发任务并记录遥测
     */
    public submitTask(taskId: string, payload: unknown): boolean {
        if (!taskId || taskId.trim().length === 0) {
            throw new TypeError('taskId must be a non-empty string.');
        }

        const maxTasks = this.options.maxConcurrentTasks ?? 100;
        if (this.coordinator.getActiveTaskCount() >= maxTasks) {
            return false;
        }

        const dispatched = this.coordinator.dispatchTask(taskId, payload);
        if (dispatched && this.options.enableTelemetry) {
            this.telemetry.recordEvent('task.dispatched', { taskId });
        }
        return dispatched;
    }
}
