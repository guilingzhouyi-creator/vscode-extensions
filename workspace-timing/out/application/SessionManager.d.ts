/**
 * SessionManager — 会话生命周期管理
 *
 * 职责：开始/结束会话、持久化、崩溃恢复入口协调
 * 边界：不关心禁用策略，由 TimerOrchestrator 控制调用时机
 */
import { TimerEngine, TimerSnapshot } from '../domain/TimerEngine';
import { WorkspaceTimingData } from '../domain/models';
import { DailyChartEntry } from '../domain/dashboard-types';
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
    /**
     * 已结束会话的「按日分桶」结果缓存。
     * 仅在会话列表发生变化（结束会话 / 裁剪 / 恢复 / 重置）时重建，
     * 避免状态栏与面板每次刷新重复扫描全量会话（O(n)）。
     */
    private _finishedCacheKey;
    private _finishedByDate;
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
    /** 获取今日累计时长 (ms) — 复用已结束会话缓存 */
    getTodayMs(): number;
    /** 获取本周累计时长 (ms) — 复用已结束会话缓存 */
    getThisWeekMs(): number;
    /** 获取近 7 天每日统计（供柱状图）— 复用已结束会话缓存 */
    getDailyStats(): DailyChartEntry[];
    /**
     * 仅保存当前状态（不结束会话）
     * 由 Scheduler 周期性调用。
     *
     * ⚠️ 必须创建数据副本，不能修改计时器内部 totalMs，
     *    否则会与 stop() 中的累加逻辑产生重复计时。
     */
    saveCheckpoint(): Promise<void>;
    /** 标记缓存失效（会话列表变化时调用） */
    private invalidateFinishedCache;
    /**
     * 惰性重建已结束会话的分桶缓存。
     * 键由「会话数量 + 首/尾会话时间戳」构成：新增/裁剪/恢复/重置都会改变键，
     * 从而自然失效；运行中的活跃会话变化不会影响键，因此高频刷新时命中缓存。
     */
    private ensureFinishedCache;
}
