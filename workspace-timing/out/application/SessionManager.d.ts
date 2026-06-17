/**
 * SessionManager — 会话生命周期管理
 *
 * 职责：开始/结束会话、持久化、崩溃恢复入口协调
 * 边界：不关心禁用策略，由 TimerOrchestrator 控制调用时机
 */
import { TimerEngine, TimerSnapshot } from '../domain/TimerEngine';
import { WorkspaceTimingData } from '../domain/models';
import { StorageCoordinator } from '../persistence/StorageCoordinator';
import { JournalWriter } from '../cache/JournalWriter';
export interface SessionResult {
    /** 本次会话历时 (ms) */
    elapsedMs: number;
    /** 累计总时长 (ms) */
    totalMs: number;
    /** 会话记录数 */
    sessionCount: number;
}
export declare class SessionManager {
    private readonly timer;
    private readonly storage;
    private readonly journal;
    private _sessionActive;
    constructor(timer: TimerEngine, storage: StorageCoordinator, journal: JournalWriter);
    /** 是否处于活跃会话中 */
    get isSessionActive(): boolean;
    /** 获取计时器快照 */
    get snapshot(): TimerSnapshot;
    /**
     * 执行崩溃恢复并开始新会话
     * 这是启动路径的核心方法
     */
    startSession(): Promise<WorkspaceTimingData>;
    /**
     * 结束当前会话
     * 执行最终存盘并清空 journal
     */
    endSession(): Promise<SessionResult>;
    /** 获取今日累计时长 (ms) */
    getTodayMs(): number;
    /**
     * 仅保存当前状态（不结束会话）
     * 由 Scheduler 周期性调用。
     *
     * ⚠️ 必须创建数据副本，不能修改计时器内部 totalMs，
     *    否则会与 stop() 中的累加逻辑产生重复计时。
     */
    saveCheckpoint(): Promise<void>;
}
