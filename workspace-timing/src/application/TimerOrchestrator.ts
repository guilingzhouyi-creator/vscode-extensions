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
import { WorkspaceTimingData, TimingConfig, TimeSession, DEFAULT_RING_BUFFER_CAP, DEFAULT_JOURNAL_FLUSH_MS, DEFAULT_FULL_SAVE_MS, DEFAULT_MAX_SESSIONS } from '../domain/models';
import { TimeAggregator, WeeklySummary } from '../domain/TimeAggregator';
import { DashboardData } from '../domain/dashboard-types';
import { GlobalAggregator } from './GlobalAggregator';
import { DisableManager, DisableState } from './DisableManager';
import { Scheduler } from './Scheduler';
import { CsvExporter } from './exporters/CsvExporter';
import { ReportExporter, ReportKind } from './exporters/ReportExporter';
import { LogLevel, log } from '../integration/Logger';

export type OrchestratorState = 'idle' | 'running' | 'disabled' | 'saving';

export class TimerOrchestrator {
    private readonly timer: TimerEngine;
    private readonly storage: StorageCoordinator;
    private readonly journal: JournalWriter;
    private readonly sessionManager: SessionManager;
    private readonly disableManager: DisableManager;
    private readonly scheduler: Scheduler;
    private readonly global: GlobalAggregator;

    private _state: OrchestratorState = 'idle';
    private _onStateChange: ((state: OrchestratorState) => void) | null = null;

    constructor(
        timer: TimerEngine,
        storage: StorageCoordinator,
        journal: JournalWriter,
        sessionManager: SessionManager,
        disableManager: DisableManager,
        scheduler: Scheduler,
        globalAggregator: GlobalAggregator,
    ) {
        this.timer = timer;
        this.storage = storage;
        this.journal = journal;
        this.sessionManager = sessionManager;
        this.disableManager = disableManager;
        this.scheduler = scheduler;
        this.global = globalAggregator;
    }

    /** 当前状态 */
    get state(): OrchestratorState {
        return this._state;
    }

    /** 会话管理器引用（供 UI 层获取快照） */
    get session(): SessionManager {
        return this.sessionManager;
    }

    /** 禁用管理器引用 */
    get disable(): DisableManager {
        return this.disableManager;
    }

    /** 状态变更回调 */
    onStateChange(cb: (state: OrchestratorState) => void): void {
        this._onStateChange = cb;
    }

    /**
     * 启动计时流程
     * 调用链：崩溃恢复 → 禁用判定 → 开始会话 → 启动调度器
     */
    async start(): Promise<void> {
        log(LogLevel.Info, 'TimerOrchestrator: start requested');

        // 禁用判定
        if (!this.disableManager.shouldCount()) {
            this._state = 'disabled';
            log(LogLevel.Info, 'TimerOrchestrator: timing is disabled, skipping');
            this._onStateChange?.(this._state);
            return;
        }

        try {
            // 崩溃恢复 + 开始会话
            await this.sessionManager.startSession();

            // 启动调度器
            this.scheduler.onStatusBarUpdate((totalMs) => {
                // 状态栏更新委托给 Presentation 层
                this._onTick?.(totalMs);
            });
            // 周期全量存盘完成后同步跨工作区累计（此前未接线，聚合长期陈旧）
            this.scheduler.onFullSaved(async () => {
                const snap = this.sessionManager.snapshot;
                await this.global.sync(snap.totalMs);
            });
            this.scheduler.start();

            this._state = 'running';
            log(LogLevel.Info, 'TimerOrchestrator: started successfully');
        } catch (err) {
            log(LogLevel.Error, 'TimerOrchestrator: start failed', err as Error);
            this._state = 'idle';
        }

        this._onStateChange?.(this._state);
    }

    /** 状态栏 tick 回调（由 Scheduler 驱动） */
    private _onTick: ((data: { totalMs: number; todayMs: number }) => void) | null = null;
    onTick(cb: (data: { totalMs: number; todayMs: number }) => void): void {
        this._onTick = cb;
    }

    /**
     * 停止计时流程
     * 结束会话 → 停止调度器 → 最终存盘
     */
    async stop(): Promise<SessionResult> {
        log(LogLevel.Info, 'TimerOrchestrator: stop requested');

        this._state = 'saving';
        this._onStateChange?.(this._state);

        // 停止调度器
        this.scheduler.stop();

        // 结束会话
        const result = await this.sessionManager.endSession();

        this._state = 'idle';
        this._onStateChange?.(this._state);

        log(LogLevel.Info,
            `TimerOrchestrator: stopped, elapsed=${result.elapsedMs}ms, total=${result.totalMs}ms`);
        return result;
    }

    /**
     * 响应禁用设置变更
     */
    async onDisableStateChanged(newState: DisableState): Promise<void> {
        log(LogLevel.Info, `TimerOrchestrator: disable state changed to ${newState}`);

        if (newState === 'enabled' && this._state === 'disabled') {
            // 从禁用恢复 → 重新启动
            await this.start();
        } else if (newState !== 'enabled' && this._state === 'running') {
            // 从运行变为禁用 → 停止
            await this.stop();
        }
    }

    /** 获取面板数据快照 */
    async getDashboardData(): Promise<DashboardData> {
        const snap = this.sessionManager.snapshot;
        const todayMs = this.sessionManager.getTodayMs();
        const cfg = this.disable.config;
        const sessions = this.timer.data.sessions;

        // 本周合计（自然周一至今，含进行中会话）
        const weeklySummary: WeeklySummary = TimeAggregator.weeklySummary(
            sessions,
            this.timer.data.currentSessionStartMs,
        );

        // 最近 7 天每日统计（柱状图）
        const dailyStats = TimeAggregator.last7Days(sessions, this.timer.data.currentSessionStartMs);

        // 周报多周趋势（近 4 周）+ 今日明细
        const weeklyTrend = TimeAggregator.weeklyTrend(sessions, 4)
            .map((w) => ({
                weekStart: w.weekStart,
                label: w.weekStart.slice(5),
                totalMs: w.totalMs,
                sessionCount: w.sessionCount,
            }));
        const todayDetail = this.buildTodayDetail(sessions);

        // 跨工作区累计（从缓存读取，不额外 I/O）
        const globalSnap = await this.global.snapshot();

        return {
            totalMs: snap.currentTotalMs,
            todayMs,
            // 会话数口径与周报摘要一致：已结束会话 + 进行中会话（此前只数已结束，
            // 与周报区"会话数"同屏不一致，如 0 vs 1）
            sessionsCount: sessions.length + (this.timer.data.currentSessionStartMs > 0 ? 1 : 0),
            dailyStats,
            weekTotalMs: weeklySummary.totalMs,
            weeklyTrend,
            weeklySummary: {
                totalMs: weeklySummary.totalMs,
                sessionCount: weeklySummary.sessionCount,
                avgDailyMs: weeklySummary.avgDailyMs,
                peakDate: weeklySummary.peakDate,
                peakDateMs: weeklySummary.peakDateMs,
                activeDays: weeklySummary.activeDays,
            },
            todayDetail,
            globalTotalMs: globalSnap.totalMs,
            workspaceCount: globalSnap.workspaceCount,
            workspaceList: globalSnap.workspaces,
            isEnabled: cfg.enabled,
            globalDisabled: cfg.globalDisabled,
            statusBarEnabled: cfg.statusBarEnabled,
            journalEnabled: cfg.journalEnabled ?? true,
            backupToFile: cfg.backupToFile ?? true,
            ringBufferCapacity: cfg.ringBufferCapacity ?? DEFAULT_RING_BUFFER_CAP,
            journalFlushIntervalMs: cfg.journalFlushIntervalMs ?? DEFAULT_JOURNAL_FLUSH_MS,
            fullSaveIntervalMs: cfg.fullSaveIntervalMs ?? DEFAULT_FULL_SAVE_MS,
            maxSessions: cfg.maxSessions ?? DEFAULT_MAX_SESSIONS,
        };
    }

    /** 构建今日会话明细（供面板展示） */
    private buildTodayDetail(sessions: TimeSession[]): DashboardData['todayDetail'] {
        const detail = TimeAggregator.dailyDetail(
            sessions,
            TimeAggregator.todayStr(),
            this.timer.data.currentSessionStartMs,
        );
        if (detail.sessionCount === 0) return null;
        return {
            date: detail.date,
            totalMs: detail.totalMs,
            sessionCount: detail.sessionCount,
            sessions: detail.sessions.map((s) => ({
                startLabel: s.startLabel,
                endLabel: s.endLabel,
                durationMs: s.durationMs,
            })),
            peakHour: detail.peakHour,
            activeWindow: detail.activeWindow,
        };
    }

    /**
     * 导出日报 / 周报为 Markdown 文本
     * @param kind 报告类型：'daily' 日报 / 'weekly' 周报
     */
    async exportReport(kind: ReportKind): Promise<string> {
        const sessions = this.timer.data.sessions;
        const today = TimeAggregator.todayStr();

        if (kind === 'daily') {
            const detail = TimeAggregator.dailyDetail(
                sessions,
                today,
                this.timer.data.currentSessionStartMs,
            );
            log(LogLevel.Info, `TimerOrchestrator: exported daily report (${detail.date})`);
            return ReportExporter.buildDailyReport(detail);
        }

        // weekly
        const summary = TimeAggregator.weeklySummary(
            sessions,
            this.timer.data.currentSessionStartMs,
        );
        const trend = TimeAggregator.weeklyTrend(sessions, 4)
            .map((w) => ({
                weekStart: w.weekStart,
                label: w.weekStart.slice(5),
                totalMs: w.totalMs,
                sessionCount: w.sessionCount,
            }));
        const dailyStats = TimeAggregator.last7Days(sessions, this.timer.data.currentSessionStartMs);
        log(LogLevel.Info, `TimerOrchestrator: exported weekly report (${summary.weekStart})`);
        return ReportExporter.buildWeeklyReport(summary, trend, dailyStats);
    }

    /**
     * 立即手动存盘（调试用）
     */
    async saveNow(): Promise<string> {
        if (this._state !== 'running') {
            return '计时未运行，无需存盘';
        }
        try {
            const flushed = await this.journal.tryFlush();
            await this.sessionManager.saveCheckpoint();
            // 同步到全局跨工作区累计。
            // ⚠️ 口径与 checkpoint 一致：使用 snap.totalMs（不含进行中会话），
            // 进行中增量由 journal 体系负责，避免全局累计与本地累计漂移。
            const snap = this.sessionManager.snapshot;
            await this.global.sync(snap.totalMs);
            return `已存盘: totalMs=${snap.totalMs}, globalSynced, journalFlushed=${flushed}`;
        } catch (err) {
            return `存盘失败: ${(err as Error).message}`;
        }
    }

    /** 从面板更新配置 */
    applyDashboardConfig(partial: Partial<DashboardData>): void {
        const cfg: Partial<TimingConfig> = {};
        if (partial.isEnabled !== undefined) cfg.enabled = partial.isEnabled;
        if (partial.globalDisabled !== undefined) cfg.globalDisabled = partial.globalDisabled;
        if (partial.statusBarEnabled !== undefined) cfg.statusBarEnabled = partial.statusBarEnabled;
        if (partial.journalEnabled !== undefined) cfg.journalEnabled = partial.journalEnabled;
        if (partial.backupToFile !== undefined) cfg.backupToFile = partial.backupToFile;
        if (partial.ringBufferCapacity !== undefined) cfg.ringBufferCapacity = partial.ringBufferCapacity;
        if (partial.journalFlushIntervalMs !== undefined) cfg.journalFlushIntervalMs = partial.journalFlushIntervalMs;
        if (partial.fullSaveIntervalMs !== undefined) cfg.fullSaveIntervalMs = partial.fullSaveIntervalMs;
        if (partial.maxSessions !== undefined) cfg.maxSessions = partial.maxSessions;
        this.disable.updateConfig(cfg);
        // 间隔/会话上限支持运行期热更新；journalEnabled/capacity 等需重启生效
        this.applyRuntimeConfig(cfg);
    }

    /**
     * 运行期热更新可变配置：调度间隔、会话历史上限。
     * 由 ConfigWatcher 与 applyDashboardConfig 共用。
     */
    applyRuntimeConfig(cfg: Partial<TimingConfig>): void {
        if (cfg.journalFlushIntervalMs !== undefined || cfg.fullSaveIntervalMs !== undefined) {
            this.scheduler.updateIntervals({
                journalFlushIntervalMs: cfg.journalFlushIntervalMs,
                fullSaveIntervalMs: cfg.fullSaveIntervalMs,
            });
        }
        if (cfg.maxSessions !== undefined) {
            this.sessionManager.setMaxSessions(cfg.maxSessions);
        }
    }

    /**
     * 导出当前工作区计时数据为 CSV 字符串
     * 配合 CsvExporter 使用，供 UI / 命令面板触发导出。
     *
     * @param workspaceName 工作区名称（用于 CSV 头部注释）
     */
    async exportCSV(workspaceName: string): Promise<string> {
        // 取当前计时数据的只读快照，避免导出时与计时器内部状态耦合
        const data: WorkspaceTimingData = {
            ...this.timer.data,
            sessions: [...this.timer.data.sessions],
        };

        const exporter = new CsvExporter();
        const csv = await exporter.export(data, workspaceName);
        log(LogLevel.Info, `TimerOrchestrator: exported CSV (${csv.length} bytes)`);
        return csv;
    }

    /**
     * 新建计时周期：结束当前会话 → 重置 totalMs → 重新开始
     * 历史会话记录保留在 sessions[] 中
     */
    async newPeriod(): Promise<void> {
        log(LogLevel.Info, 'TimerOrchestrator: new period requested');

        // 1. 结束当前会话（记录 sessions、存盘）
        await this.stop();

        // 2. 重置计时器数据（保留 history，totalMs 归零）
        //    修复：原实现直接 timer.reset() 会清空 sessions[]，与注释"历史会话记录保留"
        //    相矛盾。此处先保存历史会话，reset 后再恢复，实现"累计归零、历史保留"。
        //    同时保留用户的启用/禁用状态（reset 会把 isEnabled 恢复为默认 true）。
        const prevData = this.timer.data;
        const historySessions = prevData.sessions;
        this.timer.reset();
        this.timer.replaceData({
            ...this.timer.data,
            isEnabled: prevData.isEnabled,
            sessions: historySessions,
        });

        // 3. 同步全局（重置为 0）
        await this.global.sync(0);

        // 4. 新建空数据存盘
        const freshData: WorkspaceTimingData = { ...this.timer.data, sessions: [...this.timer.data.sessions] };
        await this.storage.save(freshData);

        // 5. 重新启动
        await this.start();
    }
}
