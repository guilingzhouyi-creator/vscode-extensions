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
import {
    WorkspaceTimingData,
    TimingConfig,
    TimeSession,
    DEFAULT_RING_BUFFER_CAP,
    DEFAULT_JOURNAL_FLUSH_MS,
    DEFAULT_FULL_SAVE_MS,
    DEFAULT_MAX_SESSIONS,
    MS_PER_HOUR,
    MIN_WEEKLY_LIMIT_HOURS,
    MAX_WEEKLY_LIMIT_HOURS,
    sanitizeWeeklyLimitHours,
    sanitizeWeeklyLimitEnabled,
    LATEST_VERSION,
} from '../domain/models';
import { validateTimingData } from '../persistence/DataValidator';
import { migrateToFolded } from '../domain/HistoryFolder';
import { AggregatedCsvExporter } from './exporters/AggregatedCsvExporter';
import { TimeAggregator, WeeklySummary } from '../domain/TimeAggregator';
import { DashboardData } from '../domain/dashboard-types';
import { GlobalAggregator } from './GlobalAggregator';
import { DisableManager, DisableState } from './DisableManager';
import { Scheduler } from './Scheduler';
import { CsvExporter } from './exporters/CsvExporter';
import { ReportExporter, ReportKind } from './exporters/ReportExporter';
import { LogLevel, log } from '../integration/Logger';
import { t, format } from '../i18n/index';

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
    /** 破坏性操作前自动安全快照开关（workspaceTiming.safetySnapshot） */
    private _safetySnapshotEnabled: boolean = true;
    private _onStateChange: ((state: OrchestratorState) => void) | null = null;
    /** 已发送超限休息提醒的周标识（YYYY-MM-DD，防单周重复轰炸） */
    private _weeklyLimitNotifiedWeek: string | null = null;
    /** 超限提醒回调 */
    private _onWeeklyLimitExceeded: ((message: string) => void) | null = null;

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

    /** 注册超限健康休息提醒回调 */
    onWeeklyLimitExceeded(cb: (message: string) => void): void {
        this._onWeeklyLimitExceeded = cb;
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
            this.scheduler.onStatusBarUpdate((data) => {
                // 状态栏更新委托给 Presentation 层
                this._onTick?.(data);
                this.checkWeeklyLimit();
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

        // 结束会话；endSession 抛异常时也必须恢复状态，
        // 否则 _state 永久卡在 'saving'（saveNow 等依赖 running 态的路径全部失效）
        try {
            return await this.sessionManager.endSession();
        } finally {
            this._state = 'idle';
            this._onStateChange?.(this._state);
        }
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

        // 本周合计（自然周一至今，含进行中会话与折叠层）
        const weeklySummary: WeeklySummary = TimeAggregator.weeklySummary(
            sessions,
            this.timer.data.currentSessionStartMs,
            this.timer.data.dailyTotals,
        );

        // 最近 7 天每日统计（柱状图，跟随界面语言）
        const locale = cfg.locale === 'en' ? 'en' : 'zh-CN';
        const dailyStats = TimeAggregator.last7Days(sessions, this.timer.data.currentSessionStartMs, locale);

        // 活动时间线热力图（近 12 周，含本周；窗口化聚合，复用按日口径）
        const heatmap = TimeAggregator.heatmapDays(
            sessions,
            this.timer.data.currentSessionStartMs,
            this.timer.data.dailyTotals,
            12,
        );

        // 周报多周趋势（近 4 周）+ 今日明细
        const weeklyTrend = TimeAggregator.weeklyTrend(
            sessions,
            4,
            this.timer.data.currentSessionStartMs,
            this.timer.data.dailyTotals,
        ).map((w) => ({
            weekStart: w.weekStart,
            weekEnd: w.weekEnd,
            label: `${w.weekStart.slice(5)} ~ ${w.weekEnd.slice(5)}`,
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
            heatmap,
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
            locale: cfg.locale ?? 'auto',
            statusBarEnabled: cfg.statusBarEnabled,
            journalEnabled: cfg.journalEnabled ?? true,
            backupToFile: cfg.backupToFile ?? true,
            ringBufferCapacity: cfg.ringBufferCapacity ?? DEFAULT_RING_BUFFER_CAP,
            journalFlushIntervalMs: cfg.journalFlushIntervalMs ?? DEFAULT_JOURNAL_FLUSH_MS,
            fullSaveIntervalMs: cfg.fullSaveIntervalMs ?? DEFAULT_FULL_SAVE_MS,
            maxSessions: cfg.maxSessions ?? DEFAULT_MAX_SESSIONS,
            weeklyLimitEnabled: cfg.weeklyLimitEnabled ?? false,
            weeklyLimitHours: cfg.weeklyLimitHours ?? 40,
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
            hourly: detail.hourly.map((h) => ({
                hour: h.hour,
                totalMs: h.totalMs,
                sessionCount: h.sessionCount,
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
        const trend = TimeAggregator.weeklyTrend(
            sessions,
            4,
            this.timer.data.currentSessionStartMs,
            this.timer.data.dailyTotals,
        ).map((w) => ({
            weekStart: w.weekStart,
            weekEnd: w.weekEnd,
            label: `${w.weekStart.slice(5)} ~ ${w.weekEnd.slice(5)}`,
            totalMs: w.totalMs,
            sessionCount: w.sessionCount,
        }));
        const locale = this.disable.config.locale === 'en' ? 'en' : 'zh-CN';
        const dailyStats = TimeAggregator.last7Days(sessions, this.timer.data.currentSessionStartMs, locale);
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
        if (partial.locale !== undefined) cfg.locale = partial.locale;
        if (partial.statusBarEnabled !== undefined) cfg.statusBarEnabled = partial.statusBarEnabled;
        if (partial.journalEnabled !== undefined) cfg.journalEnabled = partial.journalEnabled;
        if (partial.backupToFile !== undefined) cfg.backupToFile = partial.backupToFile;
        if (partial.ringBufferCapacity !== undefined) cfg.ringBufferCapacity = partial.ringBufferCapacity;
        if (partial.journalFlushIntervalMs !== undefined) cfg.journalFlushIntervalMs = partial.journalFlushIntervalMs;
        if (partial.fullSaveIntervalMs !== undefined) cfg.fullSaveIntervalMs = partial.fullSaveIntervalMs;
        if (partial.maxSessions !== undefined) cfg.maxSessions = partial.maxSessions;
        if (partial.weeklyLimitEnabled !== undefined) {
            cfg.weeklyLimitEnabled = sanitizeWeeklyLimitEnabled(partial.weeklyLimitEnabled);
        }
        if (partial.weeklyLimitHours !== undefined) {
            cfg.weeklyLimitHours = sanitizeWeeklyLimitHours(partial.weeklyLimitHours);
        }
        this.disable.updateConfig(cfg);
        // 间隔/会话上限支持运行期热更新；journalEnabled/capacity 等需重启生效
        this.applyRuntimeConfig(cfg);
    }

    /**
     * 运行期热更新可变配置：调度间隔、会话历史上限、周工作上限。
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
            this.sessionManager.setMaxSessions(Math.max(0, cfg.maxSessions));
        }
        if (cfg.safetySnapshot !== undefined) {
            this._safetySnapshotEnabled = cfg.safetySnapshot;
        }
        if (cfg.weeklyLimitHours !== undefined || cfg.weeklyLimitEnabled !== undefined) {
            this.checkWeeklyLimit();
        }
    }

    /** 检测周工作时长是否超限并按需触发健康休息提醒（每周仅提醒一次，严格校验上下界与跨周边界） */
    checkWeeklyLimit(): void {
        const cfg = this.disable.config;
        const isEnabled = sanitizeWeeklyLimitEnabled(cfg.weeklyLimitEnabled);
        const limitHours = sanitizeWeeklyLimitHours(cfg.weeklyLimitHours);
        if (!isEnabled || limitHours < MIN_WEEKLY_LIMIT_HOURS || limitHours > MAX_WEEKLY_LIMIT_HOURS) {
            return;
        }

        const now = new Date();
        const currentWeek = TimeAggregator.weekStartStr(now);
        // 本周已提醒过则零开销立即退出
        if (this._weeklyLimitNotifiedWeek === currentWeek) {
            return;
        }

        const limitMs = limitHours * MS_PER_HOUR;
        const weekTotalMs = TimeAggregator.weeklySummary(
            this.timer.data.sessions,
            this.timer.data.currentSessionStartMs,
            this.timer.data.dailyTotals,
        ).totalMs;

        if (weekTotalMs >= limitMs) {
            this._weeklyLimitNotifiedWeek = currentWeek;
            const durStr = TimeAggregator.formatDuration(weekTotalMs);
            const limitStr = `${limitHours}h`;
            const message = format(t()['notify.weeklyLimitExceeded'], durStr, limitStr);
            log(LogLevel.Warn, `TimerOrchestrator: weekly work limit exceeded (${durStr} >= ${limitStr})`);
            this._onWeeklyLimitExceeded?.(message);
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

        await this.enqueue(async () => {
            await this.doNewPeriod();
        });
    }

    private async doNewPeriod(): Promise<void> {
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
        this.sessionManager.invalidateTodayCache();

        // 3. 同步全局（重置为 0）。
        //    force：绕过"值未变化"守卫——若上一轮周期恰好也同步过 0，
        //    守卫会吞掉本次清零，全局聚合中本工作区残留旧累计。
        await this.global.sync(0, true);

        // 4. 新建空数据存盘（关键事件，强制 JSON 备份）
        const freshData: WorkspaceTimingData = { ...this.timer.data, sessions: [...this.timer.data.sessions] };
        await this.storage.save(freshData, true);

        // 5. 重新启动
        await this.start();
    }

    /**
     * 重置本工作区计时数据并立即重新开始计时（UI 层唯一 reset 入口）。
     *
     * 统一此前命令面板与面板消息两条 reset 路径的编排：
     *   stop → 清工作区数据 → (可选)清全局聚合 → start 从零起步。
     * 全局清空走 GlobalAggregator.reset()：同时清内存缓存与增量同步守卫，
     * 确保当前工作区下次 checkpoint 会回填（否则会被"值未变化"守卫跳过）。
     *
     * @param purgeGlobal 是否级联清除跨工作区累计中本工作区的条目
     * @returns 重置后的最新面板数据，供调用方立即推送（不等下一个刷新周期）
     */
    async resetAllData(purgeGlobal = true): Promise<DashboardData> {
        log(LogLevel.Info, 'TimerOrchestrator: resetAllData requested');

        return this.enqueue(async () => {
            // 0. 安全快照（可配置关闭）
            if (this._safetySnapshotEnabled) {
                await this.storage.snapshotBeforeDestructive('reset');
            }

            // 1. 结束当前会话并存盘
            await this.stop();

            // 2. 清空工作区本地数据（workspaceState + JSON 备份 + journal）
            await this.storage.deleteAll();

            // 3. 级联清全局聚合
            if (purgeGlobal) {
                await this.global.reset();
            }

            // 4. 从零重新开始计时
            await this.start();

            // 5. 返回归零后的最新面板数据
            return this.getDashboardData();
        });
    }

    /**
     * 重操作串行队列：newPeriod / resetAllData / 禁用切换等重编排必须串行执行，
     * 防止用户连点按钮触发并发 stop→reset→start 交错（会话数错乱、二次重置）。
     * 队列中前序操作失败不阻断后续（catch 后继续）。
     */
    private _opQueue: Promise<unknown> = Promise.resolve();

    private enqueue<T>(fn: () => Promise<T>): Promise<T> {
        const run = this._opQueue.then(fn, fn); // 前序失败也执行本操作
        this._opQueue = run.catch(err => {
            log(LogLevel.Error, 'TimerOrchestrator: queued operation failed', err as Error);
        });
        return run;
    }

    /**
     * 清除历史明细（保留累计数字）：删除 sessions/dailyTotals 并截断 journal，
     * totalMs 计数器与全局聚合保持不变。
     * 适用场景：隐私清理（不留下"何时在哪个项目干了什么"），但保住累计时长。
     *
     * @returns 清除后的最新面板数据，供调用方立即推送
     */
    async clearHistory(): Promise<DashboardData> {
        log(LogLevel.Info, 'TimerOrchestrator: clearHistory requested');

        return this.enqueue(async () => {
            if (this._safetySnapshotEnabled) {
                await this.storage.snapshotBeforeDestructive('clear-history');
            }

            await this.stop();

            // 明细清空；totalMs 等其余字段保持
            const d = this.timer.data;
            this.timer.replaceData({
                ...d,
                currentSessionStartMs: 0,
                sessions: [],
                dailyTotals: {},
            });
            this.sessionManager.invalidateTodayCache();

            // 强制落盘（关键事件）并截断 journal
            const fresh: WorkspaceTimingData = { ...this.timer.data, sessions: [] };
            await this.storage.save(fresh, true);
            try {
                await this.journal.truncate();
            } catch (err) {
                log(LogLevel.Warn, 'clearHistory: journal truncate failed', err as Error);
            }

            await this.start();
            return this.getDashboardData();
        });
    }

    /**
     * 从外部 JSON 还原计时数据（整体替换主存 + JSON 备份，并截断 journal）。
     *
     * 流程：校验净化 → stop → v1/v2 标准化折叠 → restore → start → 返回面板数据。
     * 校验失败抛错且**不触碰现网数据**；执行前自动写安全快照
     * （workspace-timing.before-restore.json，受 safetySnapshot 开关控制）。
     *
     * @param raw 未解析的外部 JSON 内容
     */
    async restoreFrom(raw: unknown): Promise<DashboardData> {
        const validation = validateTimingData(raw);
        if (!validation.ok || !validation.data) {
            throw new Error(`invalid timing data: ${validation.error ?? 'unknown'}`);
        }
        let data = validation.data;
        log(LogLevel.Info,
            `TimerOrchestrator: restore requested (file totalMs=${data.totalMs}, sessions=${data.sessions.length})`);

        return this.enqueue(async () => {
            if (this._safetySnapshotEnabled) {
                await this.storage.snapshotBeforeDestructive('restore');
            }

            await this.stop();

            // 版本标准化 + 按当前保留窗折叠（幂等；v1 文件在此完成迁移）
            const migrated = migrateToFolded(data, this.sessionManager.rawRetentionDays);
            data = {
                ...data,
                version: LATEST_VERSION,
                sessions: migrated.sessions,
                dailyTotals: migrated.dailyTotals,
            };

            await this.storage.restore(data);
            await this.start();
            return this.getDashboardData();
        });
    }

    /**
     * 导出全历史聚合日报序列 CSV（折叠桶 ∪ 当期原始计算，日期升序）。
     */
    async exportAggregatedCSV(workspaceName: string): Promise<string> {
        const data = this.timer.data;
        const series = TimeAggregator.fullDailySeries(
            data.sessions as TimeSession[],
            data.currentSessionStartMs,
            data.dailyTotals,
        );
        const csv = new AggregatedCsvExporter().build(series, workspaceName);
        log(LogLevel.Info, `TimerOrchestrator: exported aggregated CSV (${series.length} days, ${csv.length} bytes)`);
        return csv;
    }
}
