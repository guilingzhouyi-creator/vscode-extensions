/**
 * SessionManager — 会话生命周期管理
 *
 * 职责：开始/结束会话、持久化、崩溃恢复入口协调
 * 边界：不关心禁用策略，由 TimerOrchestrator 控制调用时机
 */
import { TimerEngine, TimerSnapshot } from '../domain/TimerEngine';
import { WorkspaceTimingData } from '../domain/models';
import { DailyChartEntry, HeatmapDay } from '../domain/dashboard-types';
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
    /** 获取本周每日统计（自然周，本周一→今日，供「周报」柱状图）— 复用已结束会话缓存 */
    getDailyStats(): DailyChartEntry[];
    /** 获取自然周每日明细（fullWeek=true 时含本周日至周日，供周报导出）— 复用已结束会话缓存 */
    getWeekDailyStats(fullWeek?: boolean): DailyChartEntry[];
    /** 获取上一自然周累计时长 (ms) — 复用已结束会话缓存 */
    getLastWeekMs(): number;
    /** 获取本月累计时长 (ms) — 复用已结束会话缓存 */
    getThisMonthMs(): number;
    /** 获取上一自然月累计时长 (ms) — 复用已结束会话缓存 */
    getLastMonthMs(): number;
    /** 获取自然月每日明细（本月 1 号起；fullMonth=true 含至月末）— 复用已结束会话缓存 */
    getMonthDailyStats(fullMonth?: boolean): DailyChartEntry[];
    /** 活动时间线热力图（近 weeks 周，含本周）— 复用已结束会话缓存 */
    getHeatmap(weeks?: number): HeatmapDay[];
    /**
     * 仅保存当前状态（不结束会话）
     * 由 Scheduler 周期性调用。
     *
     * ★ 设计约定（与 0.1.x 的零边界方案相反，但消除了重复计与归属丢失）：
     *   - totalMs 始终等于「已结束会话」的累加和（权威源），此处不做任何折叠；
     *   - currentSessionStartMs 原样保留，使进行中会话的真实起始日存续到磁盘；
     *   - 进行中会话由 TimeAggregator 在今日/本周交集计算时叠加，
     *     并由 recover() 在重载时收尾为 finished TimeSession。
     *   这样既不会与 recover 的边界补偿重复计（边界优先于 journal），
     *   又保证日报/周报能按真实自然日归并（含跨午夜自动切分）。
     */
    saveCheckpoint(): Promise<void>;
    /**
     * 若进行中会话跨越了自然日 00:00，则在午夜边界处将其切分为两段。
     * 供 saveCheckpoint 周期调用，确保每一个自然日都拥有独立 finished TimeSession，
     * 使日报/周报的每日柱子能精确反映当天时长。
     */
    private splitActiveSessionAtMidnight;
    /** 标记缓存失效（会话列表变化时调用） */
    private invalidateFinishedCache;
    /**
     * 惰性重建已结束会话的分桶缓存。
     * 键由「会话数量 + 首/尾会话时间戳」构成：新增/裁剪/恢复/重置都会改变键，
     * 从而自然失效；运行中的活跃会话变化不会影响键，因此高频刷新时命中缓存。
     */
    private ensureFinishedCache;
}
