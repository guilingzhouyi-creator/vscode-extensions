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
    private maxSessions;
    private _sessionActive;
    constructor(timer: TimerEngine, storage: StorageCoordinator, journal: JournalWriter, maxSessions?: number);
    /** 是否处于活跃会话中 */
    get isSessionActive(): boolean;
    /** 运行期热更新会话历史上限（0 = 不限） */
    setMaxSessions(maxSessions: number): void;
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
     *
     * ⚠️ 崩溃恢复"三重计数"修复：主存储的 totalMs 只固化**已结束会话的累计**
     *   （snap.totalMs，不含进行中会话的实时时长）。进行中会话的时长由 journal 增量
     *   完整记录（checkpoint 不清空 journal），崩溃恢复时通过回放 journal 重建；
     *   journal 无有效回放时才用"补偿未完成会话"兜底。
     *   这避免了原实现（固化 currentTotalMs + journal 回放 + 补偿三者叠加）对同一
     *   会话时段重复累计的缺陷。
     */
    saveCheckpoint(): Promise<void>;
}
