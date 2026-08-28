/**
 * TimerEngine — 计时核心
 *
 * 职责：start / stop / elapsed 计算
 * 边界：不关心存储、不关心 UI、不关心禁用策略
 * 依赖：仅依赖 models.ts
 */

import { WorkspaceTimingData, createEmptyTimingData } from './models';

export interface TimerSnapshot {
    /** 当前累计总时长 (ms) */
    totalMs: number;
    /** 当前会话已持续时长 (ms) */
    sessionElapsedMs: number;
    /** 当前总时长（含本次会话） */
    currentTotalMs: number;
}

export class TimerEngine {
    private _data: WorkspaceTimingData;
    private _sessionStartMs: number = 0;
    private _running: boolean = false;

    constructor(data?: WorkspaceTimingData) {
        this._data = data ?? createEmptyTimingData();
    }

    /** 获取内部数据（只读快照） */
    get data(): Readonly<WorkspaceTimingData> {
        return this._data;
    }

    /** 是否正在运行 */
    get isRunning(): boolean {
        return this._running;
    }

    /** 开始计时 */
    start(): void {
        if (this._running) return;
        this._running = true;
        this._sessionStartMs = Date.now();
        this._data.currentSessionStartMs = this._sessionStartMs;
    }

    /** 停止计时，返回本次会话历时 (ms) */
    stop(): number {
        if (!this._running) return 0;
        this._running = false;

        const now = Date.now();
        // 时钟回拨防御：elapsed 不允许为负（否则 totalMs 会被扣减、sessions 出现负时长）
        const elapsed = Math.max(0, now - this._sessionStartMs);

        // 累加到 total
        this._data.totalMs += elapsed;
        this._data.currentSessionStartMs = 0;
        this._data.lastSavedAtMs = now;

        // 记录会话
        this._data.sessions.push({
            startMs: this._sessionStartMs,
            endMs: now,
            durationMs: elapsed,
        });

        return elapsed;
    }

    /**
     * 跨午夜自然日会话切分与轮转：
     * 将当前运行中会话截至 boundaryMs（昨日 23:59:59.999/次日零点）封存入 sessions[] 并累加 totalMs，
     * 同时无缝开启从 boundaryMs 起算的新会话段。
     * @returns 封存的昨日会话段时长 (ms)
     */
    rotateSession(boundaryMs: number): number {
        if (!this._running) return 0;

        const elapsed = Math.max(0, boundaryMs - this._sessionStartMs);
        this._data.totalMs += elapsed;

        if (elapsed > 0) {
            this._data.sessions.push({
                startMs: this._sessionStartMs,
                endMs: boundaryMs,
                durationMs: elapsed,
            });
        }

        this._sessionStartMs = boundaryMs;
        this._data.currentSessionStartMs = boundaryMs;
        this._data.lastSavedAtMs = boundaryMs;

        return elapsed;
    }

    /**
     * 系统休眠/挂起恢复处理：
     * 将休眠前的会话段封存截至 sleepStartMs，休眠时间不计入时长，
     * 并在唤醒时刻 resumeMs 重新开启活跃会话段。
     * @returns 封存的休眠前会话段时长 (ms)
     */
    resumeFromSleep(sleepStartMs: number, resumeMs: number): number {
        if (!this._running) return 0;

        const elapsed = Math.max(0, sleepStartMs - this._sessionStartMs);
        this._data.totalMs += elapsed;

        if (elapsed > 0) {
            this._data.sessions.push({
                startMs: this._sessionStartMs,
                endMs: sleepStartMs,
                durationMs: elapsed,
            });
        }

        this._sessionStartMs = resumeMs;
        this._data.currentSessionStartMs = resumeMs;
        this._data.lastSavedAtMs = resumeMs;

        return elapsed;
    }

    /** 获取当前快照（不停止计时） */
    snapshot(): TimerSnapshot {
        // 时钟回拨防御：进行中会话历时不为负
        const sessionElapsed = this._running
            ? Math.max(0, Date.now() - this._sessionStartMs)
            : 0;

        return {
            totalMs: this._data.totalMs,
            sessionElapsedMs: sessionElapsed,
            currentTotalMs: this._data.totalMs + sessionElapsed,
        };
    }

    /** 替换内部数据（用于崩溃恢复后加载） */
    replaceData(data: WorkspaceTimingData): void {
        this._data = { ...data };
    }

    /** 重置所有计时数据 */
    reset(): void {
        this._data = createEmptyTimingData();
        this._sessionStartMs = 0;
        this._running = false;
    }

    /** 裁剪会话列表到最大数量 */
    trimSessions(maxSessions: number): void {
        if (maxSessions <= 0) return;
        if (this._data.sessions.length > maxSessions) {
            this._data.sessions = this._data.sessions.slice(-maxSessions);
        }
    }
}
