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
    splitAt(splitMs: number): void;
    /** 获取当前快照（不停止计时） */
    snapshot(): TimerSnapshot;
    /** 替换内部数据（用于崩溃恢复后加载） */
    replaceData(data: WorkspaceTimingData): void;
    /** 更新连续打卡状态（持久化于 _data，随存盘落库） */
    setStreak(streak: {
        dateStr: string;
        count: number;
    } | undefined): void;
    /** 重置所有计时数据 */
    reset(): void;
    /** 裁剪会话列表到最大数量 */
    trimSessions(maxSessions: number): void;
}
