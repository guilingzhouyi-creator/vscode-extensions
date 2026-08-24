"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.TimerOrchestrator = void 0;
const models_1 = require("../domain/models");
const TimeAggregator_1 = require("../domain/TimeAggregator");
const CsvExporter_1 = require("./exporters/CsvExporter");
const ReportExporter_1 = require("./exporters/ReportExporter");
const Logger_1 = require("../integration/Logger");
class TimerOrchestrator {
    constructor(timer, storage, journal, sessionManager, disableManager, scheduler, globalAggregator) {
        this._state = 'idle';
        this._onStateChange = null;
        /** 状态栏 tick 回调（由 Scheduler 驱动） */
        this._onTick = null;
        /**
         * 重操作串行队列：newPeriod / resetAllData / 禁用切换等重编排必须串行执行，
         * 防止用户连点按钮触发并发 stop→reset→start 交错（会话数错乱、二次重置）。
         * 队列中前序操作失败不阻断后续（catch 后继续）。
         */
        this._opQueue = Promise.resolve();
        this.timer = timer;
        this.storage = storage;
        this.journal = journal;
        this.sessionManager = sessionManager;
        this.disableManager = disableManager;
        this.scheduler = scheduler;
        this.global = globalAggregator;
    }
    /** 当前状态 */
    get state() {
        return this._state;
    }
    /** 会话管理器引用（供 UI 层获取快照） */
    get session() {
        return this.sessionManager;
    }
    /** 禁用管理器引用 */
    get disable() {
        return this.disableManager;
    }
    /** 状态变更回调 */
    onStateChange(cb) {
        this._onStateChange = cb;
    }
    /**
     * 启动计时流程
     * 调用链：崩溃恢复 → 禁用判定 → 开始会话 → 启动调度器
     */
    async start() {
        (0, Logger_1.log)(Logger_1.LogLevel.Info, 'TimerOrchestrator: start requested');
        // 禁用判定
        if (!this.disableManager.shouldCount()) {
            this._state = 'disabled';
            (0, Logger_1.log)(Logger_1.LogLevel.Info, 'TimerOrchestrator: timing is disabled, skipping');
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
            (0, Logger_1.log)(Logger_1.LogLevel.Info, 'TimerOrchestrator: started successfully');
        }
        catch (err) {
            (0, Logger_1.log)(Logger_1.LogLevel.Error, 'TimerOrchestrator: start failed', err);
            this._state = 'idle';
        }
        this._onStateChange?.(this._state);
    }
    onTick(cb) {
        this._onTick = cb;
    }
    /**
     * 停止计时流程
     * 结束会话 → 停止调度器 → 最终存盘
     */
    async stop() {
        (0, Logger_1.log)(Logger_1.LogLevel.Info, 'TimerOrchestrator: stop requested');
        this._state = 'saving';
        this._onStateChange?.(this._state);
        // 停止调度器
        this.scheduler.stop();
        // 结束会话
        const result = await this.sessionManager.endSession();
        this._state = 'idle';
        this._onStateChange?.(this._state);
        (0, Logger_1.log)(Logger_1.LogLevel.Info, `TimerOrchestrator: stopped, elapsed=${result.elapsedMs}ms, total=${result.totalMs}ms`);
        return result;
    }
    /**
     * 响应禁用设置变更
     */
    async onDisableStateChanged(newState) {
        (0, Logger_1.log)(Logger_1.LogLevel.Info, `TimerOrchestrator: disable state changed to ${newState}`);
        if (newState === 'enabled' && this._state === 'disabled') {
            // 从禁用恢复 → 重新启动
            await this.start();
        }
        else if (newState !== 'enabled' && this._state === 'running') {
            // 从运行变为禁用 → 停止
            await this.stop();
        }
    }
    /** 获取面板数据快照 */
    async getDashboardData() {
        const snap = this.sessionManager.snapshot;
        const todayMs = this.sessionManager.getTodayMs();
        const cfg = this.disable.config;
        const sessions = this.timer.data.sessions;
        // 本周合计（自然周一至今，含进行中会话）
        const weeklySummary = TimeAggregator_1.TimeAggregator.weeklySummary(sessions, this.timer.data.currentSessionStartMs);
        // 最近 7 天每日统计（柱状图）
        const dailyStats = TimeAggregator_1.TimeAggregator.last7Days(sessions, this.timer.data.currentSessionStartMs);
        // 周报多周趋势（近 4 周）+ 今日明细
        const weeklyTrend = TimeAggregator_1.TimeAggregator.weeklyTrend(sessions, 4)
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
            ringBufferCapacity: cfg.ringBufferCapacity ?? models_1.DEFAULT_RING_BUFFER_CAP,
            journalFlushIntervalMs: cfg.journalFlushIntervalMs ?? models_1.DEFAULT_JOURNAL_FLUSH_MS,
            fullSaveIntervalMs: cfg.fullSaveIntervalMs ?? models_1.DEFAULT_FULL_SAVE_MS,
            maxSessions: cfg.maxSessions ?? models_1.DEFAULT_MAX_SESSIONS,
        };
    }
    /** 构建今日会话明细（供面板展示） */
    buildTodayDetail(sessions) {
        const detail = TimeAggregator_1.TimeAggregator.dailyDetail(sessions, TimeAggregator_1.TimeAggregator.todayStr(), this.timer.data.currentSessionStartMs);
        if (detail.sessionCount === 0)
            return null;
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
    async exportReport(kind) {
        const sessions = this.timer.data.sessions;
        const today = TimeAggregator_1.TimeAggregator.todayStr();
        if (kind === 'daily') {
            const detail = TimeAggregator_1.TimeAggregator.dailyDetail(sessions, today, this.timer.data.currentSessionStartMs);
            (0, Logger_1.log)(Logger_1.LogLevel.Info, `TimerOrchestrator: exported daily report (${detail.date})`);
            return ReportExporter_1.ReportExporter.buildDailyReport(detail);
        }
        // weekly
        const summary = TimeAggregator_1.TimeAggregator.weeklySummary(sessions, this.timer.data.currentSessionStartMs);
        const trend = TimeAggregator_1.TimeAggregator.weeklyTrend(sessions, 4)
            .map((w) => ({
            weekStart: w.weekStart,
            label: w.weekStart.slice(5),
            totalMs: w.totalMs,
            sessionCount: w.sessionCount,
        }));
        const dailyStats = TimeAggregator_1.TimeAggregator.last7Days(sessions, this.timer.data.currentSessionStartMs);
        (0, Logger_1.log)(Logger_1.LogLevel.Info, `TimerOrchestrator: exported weekly report (${summary.weekStart})`);
        return ReportExporter_1.ReportExporter.buildWeeklyReport(summary, trend, dailyStats);
    }
    /**
     * 立即手动存盘（调试用）
     */
    async saveNow() {
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
        }
        catch (err) {
            return `存盘失败: ${err.message}`;
        }
    }
    /** 从面板更新配置 */
    applyDashboardConfig(partial) {
        const cfg = {};
        if (partial.isEnabled !== undefined)
            cfg.enabled = partial.isEnabled;
        if (partial.globalDisabled !== undefined)
            cfg.globalDisabled = partial.globalDisabled;
        if (partial.statusBarEnabled !== undefined)
            cfg.statusBarEnabled = partial.statusBarEnabled;
        if (partial.journalEnabled !== undefined)
            cfg.journalEnabled = partial.journalEnabled;
        if (partial.backupToFile !== undefined)
            cfg.backupToFile = partial.backupToFile;
        if (partial.ringBufferCapacity !== undefined)
            cfg.ringBufferCapacity = partial.ringBufferCapacity;
        if (partial.journalFlushIntervalMs !== undefined)
            cfg.journalFlushIntervalMs = partial.journalFlushIntervalMs;
        if (partial.fullSaveIntervalMs !== undefined)
            cfg.fullSaveIntervalMs = partial.fullSaveIntervalMs;
        if (partial.maxSessions !== undefined)
            cfg.maxSessions = partial.maxSessions;
        this.disable.updateConfig(cfg);
        // 间隔/会话上限支持运行期热更新；journalEnabled/capacity 等需重启生效
        this.applyRuntimeConfig(cfg);
    }
    /**
     * 运行期热更新可变配置：调度间隔、会话历史上限。
     * 由 ConfigWatcher 与 applyDashboardConfig 共用。
     */
    applyRuntimeConfig(cfg) {
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
    async exportCSV(workspaceName) {
        // 取当前计时数据的只读快照，避免导出时与计时器内部状态耦合
        const data = {
            ...this.timer.data,
            sessions: [...this.timer.data.sessions],
        };
        const exporter = new CsvExporter_1.CsvExporter();
        const csv = await exporter.export(data, workspaceName);
        (0, Logger_1.log)(Logger_1.LogLevel.Info, `TimerOrchestrator: exported CSV (${csv.length} bytes)`);
        return csv;
    }
    /**
     * 新建计时周期：结束当前会话 → 重置 totalMs → 重新开始
     * 历史会话记录保留在 sessions[] 中
     */
    async newPeriod() {
        (0, Logger_1.log)(Logger_1.LogLevel.Info, 'TimerOrchestrator: new period requested');
        await this.enqueue(async () => {
            await this.doNewPeriod();
        });
    }
    async doNewPeriod() {
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
        const freshData = { ...this.timer.data, sessions: [...this.timer.data.sessions] };
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
    async resetAllData(purgeGlobal = true) {
        (0, Logger_1.log)(Logger_1.LogLevel.Info, 'TimerOrchestrator: resetAllData requested');
        return this.enqueue(async () => {
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
    enqueue(fn) {
        const run = this._opQueue.then(fn, fn); // 前序失败也执行本操作
        this._opQueue = run.catch(err => {
            (0, Logger_1.log)(Logger_1.LogLevel.Error, 'TimerOrchestrator: queued operation failed', err);
        });
        return run;
    }
}
exports.TimerOrchestrator = TimerOrchestrator;
//# sourceMappingURL=TimerOrchestrator.js.map