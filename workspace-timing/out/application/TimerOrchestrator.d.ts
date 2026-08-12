/**
 * TimerOrchestrator — 计时总控
 *
 * 职责：协调 SessionManager + DisableManager + Scheduler
 * 边界：不直接操作存储、不渲染 UI
 * 调用链：
 *   ExtensionEntry → TimerOrchestrator → SessionManager → TimerEngine
 *                                       → DisableManager
 *                                       → Scheduler
 */
import { TimerEngine } from '../domain/TimerEngine';
import { StorageCoordinator } from '../persistence/StorageCoordinator';
import { JournalWriter } from '../cache/JournalWriter';
import { SessionManager, SessionResult } from './SessionManager';
import { TimingConfig } from '../domain/models';
import { DashboardData } from '../domain/dashboard-types';
import { GlobalAggregator } from './GlobalAggregator';
import { PeriodKind, PeriodReportInput } from './exporters/PeriodReportExporter';
import { ExportBundle } from './exporters/JsonExporter';
import { DisableManager, DisableState } from './DisableManager';
import { Scheduler } from './Scheduler';
import { ActivityTracker } from './ActivityTracker';
import { IdleDetector } from './IdleDetector';
import { WeeklyReportInput } from './exporters/WeeklyReportExporter';
export type OrchestratorState = 'idle' | 'running' | 'disabled' | 'saving';
export declare class TimerOrchestrator {
    private readonly timer;
    private readonly storage;
    private readonly journal;
    private readonly sessionManager;
    private readonly disableManager;
    private readonly scheduler;
    private readonly global;
    private readonly activityTracker;
    private readonly idleDetector;
    private _state;
    private _onStateChange;
    constructor(timer: TimerEngine, storage: StorageCoordinator, journal: JournalWriter, sessionManager: SessionManager, disableManager: DisableManager, scheduler: Scheduler, globalAggregator: GlobalAggregator, activityTracker: ActivityTracker, idleDetector: IdleDetector);
    /** 活动追踪器 */
    get activity(): ActivityTracker;
    /** 闲置检测器 */
    get idle(): IdleDetector;
    /** 调度器（供 ConfigWatcher 热更新间隔）*/
    get schedulerInstance(): Scheduler;
    /** 当前状态 */
    get state(): OrchestratorState;
    /** 会话管理器引用（供 UI 层获取快照） */
    get session(): SessionManager;
    /** 禁用管理器引用 */
    get disable(): DisableManager;
    /** 状态变更回调 */
    onStateChange(cb: (state: OrchestratorState) => void): void;
    /** 连续打卡里程碑回调（由上层负责弹出桌面通知） */
    private _onStreakMilestone;
    onStreakMilestone(cb: (count: number) => void): void;
    /**
     * 启动计时流程
     * 调用链：崩溃恢复 → 禁用判定 → 开始会话 → 启动调度器
     */
    start(): Promise<void>;
    /** 状态栏 tick 回调（由 Scheduler 驱动） */
    private _onTick;
    onTick(cb: (data: {
        totalMs: number;
        todayMs: number;
    }) => void): void;
    /**
     * 停止计时流程
     * 结束会话 → 停止调度器 → 最终存盘
     */
    stop(): Promise<SessionResult>;
    /**
     * 响应禁用设置变更
     */
    onDisableStateChanged(newState: DisableState): Promise<void>;
    /** 获取面板数据快照 */
    getDashboardData(): Promise<DashboardData>;
    /**
     * 计算「本周效率」：遍历每日明细，叠加活跃编辑时长、扣除闲置，
     * 返回 活跃/(总时长−闲置)。效率仅"本次会话内"可信（ActivityTracker/IdleDetector
     * 为内存态，重启归零），历史天恒为 0%——属已知限制，调用方应标注。
     */
    private computeWeekEfficiency;
    /**
     * 装配「周报」所需的全部数据（供 WeeklyReportExporter 生成 Markdown）。
     * 每日明细为完整自然周（本周一→本周日，未来天时长为 0）。
     */
    buildWeeklyReport(workspaceName: string): Promise<WeeklyReportInput>;
    /**
     * 评估「连续打卡」：当今日累计达到每日目标，且今日尚未计入时，连续天数 +1。
     * - 仅在进行中（running）状态评估；
     * - 当日已计入则直接返回，避免重复落库/通知；
     * - 跨天中断（上次记录在更早的日期）则从 1 重新计数；
     * - 仅在状态真正变化时写盘（workspaceState + JSON 备份）并触发里程碑回调。
     * 返回当前连续天数。
     */
    evaluateStreak(): Promise<number>;
    /** 清除连续打卡状态（重置/新建周期时调用） */
    clearStreak(): Promise<void>;
    /**
     * 立即手动存盘（调试用）
     */
    saveNow(): Promise<string>;
    /** 从面板更新配置 */
    applyDashboardConfig(partial: Partial<DashboardData>): void;
    /**
     * 新建计时周期：结束当前会话 → 重置 totalMs → 重新开始
     * 历史会话记录保留在 sessions[] 中
     */
    newPeriod(): Promise<void>;
    /**
     * 装配「周期报告」（周报 / 月报）数据。
     * 周报复用 weeklyGoalMs 作为周期目标；月报暂不设周期目标（periodGoalMs=0）。
     */
    buildPeriodReport(workspaceName: string, kind: PeriodKind): Promise<PeriodReportInput>;
    /** 装配「全量数据 JSON 导出」所需的完整数据束 */
    buildExportBundle(workspaceName: string): Promise<ExportBundle>;
    private _autoExportCfg;
    private _lastAutoExportAt;
    private _onAutoExport;
    /** 注册定时自动导出回调（由上层执行实际写盘） */
    onAutoExport(cb: (cfg: NonNullable<TimingConfig['autoExport']>) => void): void;
    /** 更新自动导出配置（来自 VS Code 设置） */
    setAutoExportConfig(cfg: TimingConfig['autoExport']): void;
    /**
     * 触发条件检查：仅在「已启用 + 运行中 + 距上次导出超过间隔」时回调一次。
     * 由 Scheduler 的全量存盘周期（每 60s）驱动，无需独立定时器。
     */
    maybeAutoExport(): Promise<void>;
}
