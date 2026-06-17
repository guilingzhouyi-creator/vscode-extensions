/**
 * TimerEngine — 计时核心
 *
 * 职责：start / stop / elapsed 计算
 * 边界：不关心存储、不关心 UI、不关心禁用策略
 * 依赖：仅依赖 models.ts
 */
import { WorkspaceTimingData } from './models';
export interface TimerSnapshot {
    /** 当前累计总时长 (ms) */
    totalMs: number;
    /** 当前会话已持续时长 (ms) */
    sessionElapsedMs: number;
    /** 当前总时长（含本次会话） */
    currentTotalMs: number;
}
export declare class TimerEngine {
    private _data;
    private _sessionStartMs;
    private _running;
    constructor(data?: WorkspaceTimingData);
    /** 获取内部数据（只读快照） */
    get data(): Readonly<WorkspaceTimingData>;
    /** 是否正在运行 */
    get isRunning(): boolean;
    /** 开始计时 */
    start(): void;
    /** 停止计时，返回本次会话历时 (ms) */
    stop(): number;
    /** 获取当前快照（不停止计时） */
    snapshot(): TimerSnapshot;
    /** 替换内部数据（用于崩溃恢复后加载） */
    replaceData(data: WorkspaceTimingData): void;
    /** 重置所有计时数据 */
    reset(): void;
    /** 裁剪会话列表到最大数量 */
    trimSessions(maxSessions: number): void;
}
