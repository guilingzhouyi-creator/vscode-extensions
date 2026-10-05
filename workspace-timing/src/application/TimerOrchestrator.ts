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
    MS_PER_HOUR,
    MIN_WEEKLY_LIMIT_HOURS,
    MAX_WEEKLY_LIMIT_HOURS,
    sanitizeWeeklyLimitHours,
    sanitizeWeeklyLimitEnabled,
    LATEST_VERSION,
    ORCHESTRATOR_STATES,
    OrchestratorState,
} from '../domain/models';
import { validateTimingData } from '../persistence/DataValidator';
import { migrateToFolded } from '../domain/HistoryFolder';
import { TimeAggregator } from '../domain/TimeAggregator';
import { DashboardData } from '../domain/dashboard-types';
import { GlobalAggregator } from './GlobalAggregator';
import { DisableManager, DisableState } from './DisableManager';
import { Scheduler } from './Scheduler';
import { exportCSV, exportAggregatedCSV, exportReport, ReportKind } from './exporters/index';
import { buildDashboardData } from './DashboardDataAssembler';
import { LogLevel, log } from '../integration/Logger';
import { t, format } from '../i18n/index';

export type { OrchestratorState };
export { ORCHESTRATOR_STATES };

const DASHBOARD_CONFIG_DIRECT_MAP: ReadonlyArray<[keyof DashboardData, keyof TimingConfig]> = [
    ['isEnabled', 'enabled'],
    ['globalDisabled', 'globalDisabled'],
    ['locale', 'locale'],
    ['statusBarEnabled', 'statusBarEnabled'],
    ['journalEnabled', 'journalEnabled'],
    ['backupToFile', 'backupToFile'],
    ['ringBufferCapacity', 'ringBufferCapacity'],
    ['journalFlushIntervalMs', 'journalFlushIntervalMs'],
    ['fullSaveIntervalMs', 'fullSaveIntervalMs'],
    ['maxSessions', 'maxSessions'],
    ['historyRawRetentionDays', 'historyRawRetentionDays'],
    ['safetySnapshot', 'safetySnapshot'],
];

export class TimerOrchestrator {
    private readonly timer: TimerEngine;
    private readonly storage: StorageCoordinator;
    private readonly journal: JournalWriter;
    private readonly sessionManager: SessionManager;
    private readonly disableManager: DisableManager;
    private readonly scheduler: Scheduler;
    private readonly global: GlobalAggregator;

    private _state: OrchestratorState = ORCHESTRATOR_STATES.IDLE;
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

    /** 注册心跳回调（状态栏与面板刷新） */
    onTick(cb: (data: { totalMs: number; todayMs: number }) => void): void {
        this.scheduler.onStatusBarUpdate(cb);
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
            this._state = ORCHESTRATOR_STATES.DISABLED;
            log(LogLevel.Info, 'TimerOrchestrator: timing is disabled, skipping');
            this._onStateChange?.(this._state);
            return;
        }

        try {
            // 开始会话（含崩溃恢复）
            await this.sessionManager.startSession();

            // 启动周期任务调度
            this.scheduler.start();

            this._state = ORCHESTRATOR_STATES.RUNNING;
            log(LogLevel.Info, 'TimerOrchestrator: running');
            this._onStateChange?.(this._state);
        } catch (err) {
            this._state = ORCHESTRATOR_STATES.ERROR;
            log(LogLevel.Error, 'TimerOrchestrator: failed to start', err as Error);
            this._onStateChange?.(this._state);
            throw err;
        }
    }

    /**
     * 停止计时流程
     * 调用链：停止调度器 → 结束会话（最终存盘 + 清空 journal）
     */
    async stop(): Promise<SessionResult> {
        log(LogLevel.Info, 'TimerOrchestrator: stop requested');

        // 停止调度器并等待在途存盘完成
        await this.scheduler.stop();

        // 结束会话
        const result = await this.sessionManager.endSession();

        this._state = ORCHESTRATOR_STATES.STOPPED;
        log(LogLevel.Info, `TimerOrchestrator: stopped (elapsed=${result.elapsedMs}ms)`);
        this._onStateChange?.(this._state);

        return result;
    }

    /**
     * 禁用状态变更时的编排处理
     * 由 ConfigWatcher 或命令触发
     */
    async onDisableStateChanged(targetState: DisableState): Promise<void> {
        log(LogLevel.Info, `TimerOrchestrator: disable state changed to ${targetState}`);

        switch (targetState) {
            case 'enabled':
                if (this._state === ORCHESTRATOR_STATES.DISABLED || this._state === ORCHESTRATOR_STATES.STOPPED) {
                    await this.start();
                }
                break;

            case 'workspace-disabled':
            case 'globally-disabled':
                if (this._state === ORCHESTRATOR_STATES.RUNNING) {
                    await this.stop();
                    this._state = ORCHESTRATOR_STATES.DISABLED;
                    this._onStateChange?.(this._state);
                }
                break;
        }
    }

    /**
     * 立即存盘当前数据并同步到全局存储
     */
    async saveNow(): Promise<void> {
        log(LogLevel.Info, 'TimerOrchestrator: saving data now');
        await this.sessionManager.saveCheckpoint();
        await this.global.sync(this.timer.snapshot().currentTotalMs);
    }

    /**
     * 获取面板展示数据 DTO（纯组装）
     */
    async getDashboardData(): Promise<DashboardData> {
        this.sessionManager.autoRecycleSessions();
        const snap = this.timer.snapshot();
        const globalSnap = await this.global.snapshot();

        return buildDashboardData({
            data: this.timer.data,
            currentTotalMs: snap.currentTotalMs,
            todayMs: this.sessionManager.getTodayMs(),
            config: this.disableManager.config,
            global: globalSnap,
        });
    }

    /**
     * 导出日报 / 周报为 Markdown 文本
     */
    async exportReport(kind: ReportKind): Promise<string> {
        const locale = this.disableManager.config.locale === 'en' ? 'en' : 'zh-CN';
        return exportReport(this.timer.data, kind, locale);
    }

    /**
     * 切换当前工作区启用/禁用状态
     */
    async toggleWorkspace(): Promise<boolean> {
        return this.enqueue(async () => {
            const current = this.disableManager.config.enabled;
            const next = !current;
            log(LogLevel.Info, `TimerOrchestrator: toggling workspace enabled to ${next}`);
            this.disableManager.updateConfig({ enabled: next });
            await this.onDisableStateChanged(this.disableManager.resolveState());
            return next;
        });
    }

    /**
     * 切换全局启用/禁用状态
     */
    async toggleGlobal(): Promise<boolean> {
        return this.enqueue(async () => {
            const current = this.disableManager.config.globalDisabled;
            const next = !current;
            log(LogLevel.Info, `TimerOrchestrator: toggling global disabled to ${next}`);
            this.disableManager.updateConfig({ globalDisabled: next });
            await this.onDisableStateChanged(this.disableManager.resolveState());
            return next;
        });
    }

    /** 从面板更新配置（策略映射表驱动，CC <= 3） */
    applyDashboardConfig(partial: Partial<DashboardData>): void {
        const cfg: Partial<TimingConfig> = {};
        for (const [dashKey, cfgKey] of DASHBOARD_CONFIG_DIRECT_MAP) {
            if (partial[dashKey] !== undefined) {
                (cfg as Record<string, unknown>)[cfgKey] = partial[dashKey];
            }
        }
        if (partial.weeklyLimitEnabled !== undefined) {
            cfg.weeklyLimitEnabled = sanitizeWeeklyLimitEnabled(partial.weeklyLimitEnabled);
        }
        if (partial.weeklyLimitHours !== undefined) {
            cfg.weeklyLimitHours = sanitizeWeeklyLimitHours(partial.weeklyLimitHours);
        }
        this.disableManager.updateConfig(cfg);
        this.applyRuntimeConfig(cfg);
    }

    /**
     * 运行期配置热应用统一入口
     */
    applyConfig(config: TimingConfig): void {
        this.disableManager.updateConfig({
            enabled: config.enabled,
            globalDisabled: config.globalDisabled,
        });
        this.applyRuntimeConfig(config);
        void this.onDisableStateChanged(this.disableManager.resolveState());
    }

    /**
     * 运行期热更新可变配置
     */
    applyRuntimeConfig(cfg: Partial<TimingConfig>): void {
        if (cfg.journalFlushIntervalMs !== undefined || cfg.fullSaveIntervalMs !== undefined) {
            this.scheduler.updateIntervals({
                journalFlushIntervalMs: cfg.journalFlushIntervalMs,
                fullSaveIntervalMs: cfg.fullSaveIntervalMs,
            });
        }
        if (cfg.maxSessions !== undefined) this.sessionManager.setMaxSessions(Math.max(0, cfg.maxSessions));
        if (cfg.safetySnapshot !== undefined) this._safetySnapshotEnabled = cfg.safetySnapshot;
        if (cfg.weeklyLimitHours !== undefined || cfg.weeklyLimitEnabled !== undefined) this.checkWeeklyLimit();
    }

    /** 检测周工作时长是否超限并按需触发健康休息提醒 */
    checkWeeklyLimit(): void {
        const cfg = this.disableManager.config;
        const isEnabled = sanitizeWeeklyLimitEnabled(cfg.weeklyLimitEnabled);
        const limitHours = sanitizeWeeklyLimitHours(cfg.weeklyLimitHours);
        if (!isEnabled || limitHours < MIN_WEEKLY_LIMIT_HOURS || limitHours > MAX_WEEKLY_LIMIT_HOURS) return;

        const currentWeek = TimeAggregator.weekStartStr(new Date());
        if (this._weeklyLimitNotifiedWeek === currentWeek) return;

        const summary = TimeAggregator.weeklySummary(
            this.timer.data.sessions,
            this.timer.data.currentSessionStartMs,
            this.timer.data.dailyTotals,
        );

        if (summary.totalMs >= limitHours * MS_PER_HOUR) {
            this._weeklyLimitNotifiedWeek = currentWeek;
            const durStr = TimeAggregator.formatDuration(summary.totalMs);
            const limitStr = `${limitHours}h`;
            log(LogLevel.Warn, `TimerOrchestrator: weekly work limit exceeded (${durStr} >= ${limitStr})`);
            this._onWeeklyLimitExceeded?.(format(t()['notify.weeklyLimitExceeded'], durStr, limitStr));
        }
    }

    /**
     * 导出当前工作区计时数据为 CSV 字符串
     */
    async exportCSV(workspaceName: string): Promise<string> {
        const targetWorkspace = workspaceName.trim() || 'workspace';
        return exportCSV(this.timer.data, targetWorkspace);
    }

    /**
     * 新建计时周期：结束当前会话 → 重置 totalMs → 重新开始（历史会话保留）
     */
    async newPeriod(): Promise<void> {
        log(LogLevel.Info, 'TimerOrchestrator: new period requested');
        await this.enqueue(async () => {
            await this.stop();
            const prevData = this.timer.data;
            const historySessions = [...prevData.sessions];
            this.timer.reset();
            this.timer.replaceData({
                ...this.timer.data,
                isEnabled: prevData.isEnabled,
                sessions: historySessions,
                metadata: { ...prevData.metadata, lastJournalTs: 0 },
            });
            await this.global.sync(0, true);
            const freshData: WorkspaceTimingData = {
                ...this.timer.data,
                sessions: [...this.timer.data.sessions],
            };
            await this.storage.save(freshData, true);
            await this.start();
        });
    }

    /**
     * 重置本工作区计时数据并立即重新开始计时
     */
    async resetAllData(purgeGlobal = true): Promise<DashboardData> {
        log(LogLevel.Info, 'TimerOrchestrator: resetAllData requested');

        return this.enqueue(async () => {
            if (this._safetySnapshotEnabled) {
                await this.storage.snapshotBeforeDestructive('reset');
            }

            await this.stop();
            await this.storage.deleteAll();

            if (purgeGlobal) {
                await this.global.reset();
            }

            await this.start();
            return this.getDashboardData();
        });
    }

    /** 重操作串行队列 */
    private _opQueue: Promise<unknown> = Promise.resolve();

    private enqueue<T>(fn: () => Promise<T>): Promise<T> {
        const run = this._opQueue.then(fn, fn);
        this._opQueue = run.catch((err) => {
            log(LogLevel.Error, 'TimerOrchestrator: queued operation failed', err as Error);
        });
        return run;
    }

    /**
     * 清除历史明细（保留累计数字）
     */
    async clearHistory(): Promise<DashboardData> {
        log(LogLevel.Info, 'TimerOrchestrator: clearHistory requested');

        return this.enqueue(async () => {
            if (this._safetySnapshotEnabled) {
                await this.storage.snapshotBeforeDestructive('clear-history');
            }

            await this.stop();

            const d = this.timer.data;
            this.timer.replaceData({
                ...d,
                currentSessionStartMs: 0,
                sessions: [],
                dailyTotals: {},
                metadata: { ...d.metadata, lastJournalTs: 0 },
            });

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
     * 从外部 JSON 还原计时数据
     */
    async restoreFrom(raw: unknown): Promise<DashboardData> {
        const validation = validateTimingData(raw);
        if (!validation.ok || !validation.data) {
            throw new Error(`invalid timing data: ${validation.error ?? 'unknown'}`);
        }
        let data = validation.data;
        log(
            LogLevel.Info,
            `TimerOrchestrator: restore requested (file totalMs=${data.totalMs}, sessions=${data.sessions.length})`,
        );

        return this.enqueue(async () => {
            if (this._safetySnapshotEnabled) {
                await this.storage.snapshotBeforeDestructive('restore');
            }

            await this.stop();

            const migrated = migrateToFolded(data, {
                retentionDays: this.sessionManager.rawRetentionDays,
                maxSessions: this.sessionManager.maxSessionsLimit,
            });
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
     * 导出全历史聚合日报序列 CSV
     */
    async exportAggregatedCSV(workspaceName: string): Promise<string> {
        const targetWorkspace = workspaceName.trim() || 'workspace';
        return exportAggregatedCSV(this.timer.data, targetWorkspace);
    }
}
