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
const Logger_1 = require("../integration/Logger");
class TimerOrchestrator {
    constructor(timer, storage, journal, sessionManager, disableManager, scheduler, globalAggregator, activityTracker, idleDetector) {
        this._state = 'idle';
        this._onStateChange = null;
        /** 连续打卡里程碑回调（由上层负责弹出桌面通知） */
        this._onStreakMilestone = null;
        /** 状态栏 tick 回调（由 Scheduler 驱动） */
        this._onTick = null;
        // ─── 定时自动导出 ────────────────────────────────
        this._autoExportCfg = {
            enabled: false, intervalMinutes: 60, format: 'weekly', targetPath: '',
        };
        this._lastAutoExportAt = 0;
        this._onAutoExport = null;
        this.timer = timer;
        this.storage = storage;
        this.journal = journal;
        this.sessionManager = sessionManager;
        this.disableManager = disableManager;
        this.scheduler = scheduler;
        this.global = globalAggregator;
        this.activityTracker = activityTracker;
        this.idleDetector = idleDetector;
    }
    /** 活动追踪器 */
    get activity() {
        return this.activityTracker;
    }
    /** 闲置检测器 */
    get idle() {
        return this.idleDetector;
    }
    /** 调度器（供 ConfigWatcher 热更新间隔）*/
    get schedulerInstance() {
        return this.scheduler;
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
    onStreakMilestone(cb) {
        this._onStreakMilestone = cb;
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
            this.scheduler.onStatusBarUpdate((data) => {
                this._onTick?.(data);
                // 每次状态栏刷新时评估连续打卡（仅当日首次达标时落库 + 通知）
                void this.evaluateStreak();
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
        const thisWeekMs = this.sessionManager.getThisWeekMs();
        const thisMonthMs = this.sessionManager.getThisMonthMs();
        const cfg = this.disable.config;
        const sessions = this.timer.data.sessions;
        // 本周每日统计（自然周：本周一→今日，供「周报」柱状图——复用 SessionManager 的已结束会话缓存）
        const dailyStats = this.sessionManager.getDailyStats();
        // ★ 本周卡片使用独立周累加器，不再从 dailyStats 累加
        const weekTotalMs = thisWeekMs;
        // 效率数据（叠加活跃编辑时长，扣除闲置）—— 与 dailyStats 时间范围一致（均为本周）
        const weekEfficiency = this.computeWeekEfficiency(dailyStats);
        // 跨工作区累计：同步读缓存，避免每 5s tick 一次 async 往返；
        // 缓存为空时回退空快照并后台拉取一次（activate 时也会预热，通常已就绪）
        const cachedGlobal = this.global.getCached();
        if (!cachedGlobal)
            this.global.refreshInBackground();
        const globalSnap = cachedGlobal ?? { totalMs: 0, workspaceCount: 0, workspaces: [] };
        // 活动时间线热力图（近 12 周，含本周）—— 复用已结束会话分桶缓存
        const heatmap = this.sessionManager.getHeatmap(12);
        // 连续打卡天数（持久化于工作区状态）
        const streak = this.timer.data.streak?.count ?? 0;
        // 本周目标（来自配置）
        const weeklyGoalMs = cfg.weeklyGoalMs ?? 0;
        return {
            totalMs: snap.currentTotalMs,
            todayMs,
            sessionsCount: sessions.length,
            dailyStats,
            heatmap,
            weekTotalMs,
            monthTotalMs: thisMonthMs,
            weekEfficiency,
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
            efficiencyEnabled: cfg.activityTrackingEnabled ?? true,
            dailyGoalMs: cfg.dailyGoalMs ?? 0,
            weeklyGoalMs,
            streak,
            statusBarClickAction: cfg.statusBarClickAction ?? 'cycle',
        };
    }
    /**
     * 计算「本周效率」：遍历每日明细，叠加活跃编辑时长、扣除闲置，
     * 返回 活跃/(总时长−闲置)。效率仅"本次会话内"可信（ActivityTracker/IdleDetector
     * 为内存态，重启归零），历史天恒为 0%——属已知限制，调用方应标注。
     */
    computeWeekEfficiency(dailyStats) {
        const cfg = this.disable.config;
        if (!cfg.activityTrackingEnabled)
            return undefined;
        let totalActiveMs = 0;
        let weekIdleMs = 0;
        let chartSumMs = 0;
        for (const d of dailyStats) {
            const activeMs = this.activityTracker.getDailyActiveMs(d.dateStr);
            const idleMs = this.idleDetector.getDailyIdleMs(d.dateStr);
            d.activeMs = activeMs;
            d.idleMs = idleMs;
            const effectiveMs = d.totalMs - idleMs;
            d.efficiency = effectiveMs > 0 ? activeMs / effectiveMs : 0;
            totalActiveMs += activeMs;
            weekIdleMs += idleMs;
            chartSumMs += d.totalMs;
        }
        const effectiveWeekMs = chartSumMs - weekIdleMs;
        return effectiveWeekMs > 0 ? totalActiveMs / effectiveWeekMs : 0;
    }
    /**
     * 装配「周报」所需的全部数据（供 WeeklyReportExporter 生成 Markdown）。
     * 每日明细为完整自然周（本周一→本周日，未来天时长为 0）。
     */
    async buildWeeklyReport(workspaceName) {
        const fullWeek = this.sessionManager.getWeekDailyStats(true);
        const weekTotalMs = this.sessionManager.getThisWeekMs();
        const dailyGoalMs = this.disable.config.dailyGoalMs ?? 0;
        const lastWeekTotalMs = this.sessionManager.getLastWeekMs();
        const weekEfficiency = this.computeWeekEfficiency(fullWeek);
        return {
            workspaceName,
            daily: fullWeek,
            weekTotalMs,
            dailyGoalMs,
            lastWeekTotalMs,
            weekEfficiency,
            generatedAt: new Date(),
        };
    }
    /**
     * 评估「连续打卡」：当今日累计达到每日目标，且今日尚未计入时，连续天数 +1。
     * - 仅在进行中（running）状态评估；
     * - 当日已计入则直接返回，避免重复落库/通知；
     * - 跨天中断（上次记录在更早的日期）则从 1 重新计数；
     * - 仅在状态真正变化时写盘（workspaceState + JSON 备份）并触发里程碑回调。
     * 返回当前连续天数。
     */
    async evaluateStreak() {
        if (this._state !== 'running')
            return this.timer.data.streak?.count ?? 0;
        const dailyGoalMs = this.disable.config.dailyGoalMs ?? 0;
        if (dailyGoalMs <= 0)
            return this.timer.data.streak?.count ?? 0;
        const todayMs = this.sessionManager.getTodayMs();
        if (todayMs < dailyGoalMs)
            return this.timer.data.streak?.count ?? 0;
        const data = this.timer.data;
        const todayStr = (0, TimeAggregator_1.localDateStr)(new Date());
        const prev = data.streak;
        if (prev && prev.dateStr === todayStr) {
            return prev.count; // 今日已计入，不重复
        }
        const yesterdayStr = (0, TimeAggregator_1.localDateStr)(new Date(Date.now() - models_1.MS_PER_DAY));
        const newCount = (prev && prev.dateStr === yesterdayStr) ? prev.count + 1 : 1;
        this.timer.setStreak({ dateStr: todayStr, count: newCount });
        try {
            await this.storage.save(data, true);
            (0, Logger_1.log)(Logger_1.LogLevel.Info, `TimerOrchestrator: streak updated to ${newCount} (${todayStr})`);
        }
        catch (err) {
            (0, Logger_1.log)(Logger_1.LogLevel.Warn, 'TimerOrchestrator: streak save failed', err);
        }
        this._onStreakMilestone?.(newCount);
        return newCount;
    }
    /** 清除连续打卡状态（重置/新建周期时调用） */
    async clearStreak() {
        if (this.timer.data.streak) {
            this.timer.setStreak(undefined);
            try {
                await this.storage.save(this.timer.data, true);
            }
            catch (err) {
                (0, Logger_1.log)(Logger_1.LogLevel.Warn, 'TimerOrchestrator: clear streak failed', err);
            }
        }
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
            // 同步到全局跨工作区累计
            const snap = this.sessionManager.snapshot;
            await this.global.sync(snap.currentTotalMs);
            return `已存盘: totalMs=${snap.currentTotalMs}, globalSynced, journalFlushed=${flushed}`;
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
        if (partial.efficiencyEnabled !== undefined)
            cfg.activityTrackingEnabled = partial.efficiencyEnabled;
        if (partial.dailyGoalMs !== undefined)
            cfg.dailyGoalMs = partial.dailyGoalMs * 60000;
        if (partial.weeklyGoalMs !== undefined)
            cfg.weeklyGoalMs = partial.weeklyGoalMs * 3600000;
        if (partial.statusBarClickAction !== undefined)
            cfg.statusBarClickAction = partial.statusBarClickAction;
        this.disable.updateConfig(cfg);
    }
    /**
     * 新建计时周期：结束当前会话 → 重置 totalMs → 重新开始
     * 历史会话记录保留在 sessions[] 中
     */
    async newPeriod() {
        (0, Logger_1.log)(Logger_1.LogLevel.Info, 'TimerOrchestrator: new period requested');
        // 1. 结束当前会话（记录 sessions、存盘）
        await this.stop();
        // 2. 重置计时器数据（保留 history，totalMs 归零）
        this.timer.reset();
        // 新建周期：连续打卡中断归零
        this.timer.setStreak(undefined);
        // 3. 同步全局（重置为 0）
        await this.global.sync(0);
        // 4. 新建空数据存盘
        const freshData = { ...this.timer.data, sessions: [...this.timer.data.sessions] };
        await this.storage.save(freshData, true);
        // 5. 重新启动
        await this.start();
    }
    /**
     * 装配「周期报告」（周报 / 月报）数据。
     * 周报复用 weeklyGoalMs 作为周期目标；月报暂不设周期目标（periodGoalMs=0）。
     */
    async buildPeriodReport(workspaceName, kind) {
        const now = new Date();
        const dailyGoalMs = this.disable.config.dailyGoalMs ?? 0;
        const weeklyGoalMs = this.disable.config.weeklyGoalMs ?? 0;
        if (kind === 'month') {
            const daily = this.sessionManager.getMonthDailyStats(true);
            const firstStr = daily.length ? daily[0].dateStr : (0, TimeAggregator_1.localDateStr)(now);
            const lastStr = daily.length ? daily[daily.length - 1].dateStr : firstStr;
            return {
                workspaceName,
                kind: 'month',
                periodLabel: '本月',
                rangeLabel: `${firstStr} ~ ${lastStr}`,
                daily,
                periodTotalMs: this.sessionManager.getThisMonthMs(),
                lastPeriodTotalMs: this.sessionManager.getLastMonthMs(),
                dailyGoalMs,
                periodGoalMs: 0,
                efficiency: undefined,
                generatedAt: new Date(),
            };
        }
        const daily = this.sessionManager.getWeekDailyStats(true);
        const firstStr = daily.length ? daily[0].dateStr : (0, TimeAggregator_1.localDateStr)(now);
        const lastStr = daily.length ? daily[daily.length - 1].dateStr : firstStr;
        return {
            workspaceName,
            kind: 'week',
            periodLabel: '本周',
            rangeLabel: `${firstStr} ~ ${lastStr}`,
            daily,
            periodTotalMs: this.sessionManager.getThisWeekMs(),
            lastPeriodTotalMs: this.sessionManager.getLastWeekMs(),
            dailyGoalMs,
            periodGoalMs: weeklyGoalMs,
            efficiency: this.computeWeekEfficiency(daily),
            generatedAt: new Date(),
        };
    }
    /** 装配「全量数据 JSON 导出」所需的完整数据束 */
    async buildExportBundle(workspaceName) {
        const data = await this.getDashboardData();
        const monthDaily = this.sessionManager.getMonthDailyStats(true);
        return {
            workspaceName,
            exportedAt: new Date().toISOString(),
            totals: {
                todayMs: data.todayMs,
                thisWeekMs: data.weekTotalMs,
                thisMonthMs: data.monthTotalMs,
                totalMs: data.totalMs,
                globalTotalMs: data.globalTotalMs,
            },
            streak: data.streak,
            goals: { dailyGoalMs: data.dailyGoalMs, weeklyGoalMs: data.weeklyGoalMs },
            dailyStats: data.dailyStats,
            monthDailyStats: monthDaily,
            heatmap: data.heatmap,
            sessions: this.timer.data.sessions,
        };
    }
    /** 注册定时自动导出回调（由上层执行实际写盘） */
    onAutoExport(cb) {
        this._onAutoExport = cb;
    }
    /** 更新自动导出配置（来自 VS Code 设置） */
    setAutoExportConfig(cfg) {
        if (cfg)
            this._autoExportCfg = { ...this._autoExportCfg, ...cfg };
    }
    /**
     * 触发条件检查：仅在「已启用 + 运行中 + 距上次导出超过间隔」时回调一次。
     * 由 Scheduler 的全量存盘周期（每 60s）驱动，无需独立定时器。
     */
    async maybeAutoExport() {
        const cfg = this._autoExportCfg;
        if (!cfg.enabled)
            return;
        if (this._state !== 'running')
            return;
        const now = Date.now();
        const intervalMs = Math.max(cfg.intervalMinutes, 1) * 60000;
        if (now - this._lastAutoExportAt < intervalMs)
            return;
        this._lastAutoExportAt = now;
        this._onAutoExport?.(cfg);
    }
}
exports.TimerOrchestrator = TimerOrchestrator;
//# sourceMappingURL=TimerOrchestrator.js.map