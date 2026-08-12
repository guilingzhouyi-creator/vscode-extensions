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
        const elapsed = now - this._sessionStartMs;

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
     * 在指定时间戳将「进行中」会话切分为两段。
     *
     * 用于「跨午夜自动切分」：让每一个自然日都拥有独立的 finished TimeSession，
     * 使日报 / 周报能按真实自然日归并时长（而非把跨天时长全算到起始日）。
     *
     * 前置条件：计时器处于运行态，且 splitMs 落在 (sessionStart, now) 之间。
     * 调用后：第一段 [sessionStart, splitMs] 入 sessions[] 并累加到 totalMs；
     *        第二段立即从 splitMs 续接（currentSessionStartMs = splitMs），继续计时。
     *
     * ⚠️ totalMs 始终只累加「已结束段」，进行中的第二段由 snapshot() 在读取时叠加，
     *    不会与 recover()/stop() 的累加产生重复计。
     */
    splitAt(splitMs: number): void {
        if (!this._running) return;
        const now = Date.now();
        if (splitMs <= this._sessionStartMs || splitMs >= now) return;

        const elapsed = splitMs - this._sessionStartMs;

        // 第一段：收尾并入历史
        this._data.totalMs += elapsed;
        this._data.sessions.push({
            startMs: this._sessionStartMs,
            endMs: splitMs,
            durationMs: elapsed,
        });

        // 第二段：从切分点立即续接
        this._sessionStartMs = splitMs;
        this._data.currentSessionStartMs = splitMs;
    }

    /** 获取当前快照（不停止计时） */
    snapshot(): TimerSnapshot {
        const sessionElapsed = this._running
            ? Date.now() - this._sessionStartMs
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
