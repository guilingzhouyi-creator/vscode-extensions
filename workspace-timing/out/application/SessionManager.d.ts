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
    /** 原始会话保留窗（天）；0=永不折叠 */
    private readonly _rawRetentionDays;
    /** checkpoint 计数：折叠按低频节流执行 */
    private _checkpointCount;
    private _sessionActive;
    constructor(timer: TimerEngine, storage: StorageCoordinator, journal: JournalWriter, maxSessions?: number, historyRawRetentionDays?: number);
    /** 原始会话保留窗（供 orchestrator 迁移/还原路径复用同一参数） */
    get rawRetentionDays(): number;
    /**
     * 折叠过期会话进 dailyTotals 沉淀层（幂等）。
     * 无过期会话时不写回、不触发任何存盘。
     */
    foldIfNeeded(): void;
    /** 是否处于活跃会话中 */
    get isSessionActive(): boolean;
    /** 运行期热更新会话历史上限（0 = 不限） */
    setMaxSessions(maxSessions: number): void;
    /**
     * 使今日累计缓存失效。
     * reset/newPeriod/崩溃恢复等数据清空或替换场景必须调用，
     * 否则 3s TTL 内 getTodayMs 会返回基于旧 sessions 的过期值。
     */
    invalidateTodayCache(): void;
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
    /** 今日累计缓存的刷新间隔：状态栏每秒读取，聚合为 O(全部会话) 扫描，用短 TTL 抑制重复计算 */
    private static readonly TODAY_CACHE_TTL_MS;
    private _todayCacheAt;
    private _todayCacheValue;
    /**
     * 获取今日累计时长 (ms)
     * 带 3s TTL 缓存：跨午夜时缓存值最多滞后 3 秒自然切换（对秒级展示无感知）。
     */
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
