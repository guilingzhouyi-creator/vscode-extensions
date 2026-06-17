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
import { WorkspaceTimingData, TimingConfig } from '../domain/models';
import { TimeAggregator } from '../domain/TimeAggregator';
import { DashboardData } from '../domain/dashboard-types';
import { GlobalAggregator } from './GlobalAggregator';
import { DisableManager, DisableState } from './DisableManager';
import { Scheduler } from './Scheduler';
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

        // 最近 7 天每日统计
        const dailyStats = TimeAggregator.last7Days(sessions, this.timer.data.currentSessionStartMs);
        const weekTotalMs = dailyStats.reduce((sum, d) => sum + d.totalMs, 0);

        // 跨工作区累计（从缓存读取，不额外 I/O）
        const globalSnap = await this.global.snapshot();

        return {
            totalMs: snap.currentTotalMs,
            todayMs,
            sessionsCount: sessions.length,
            dailyStats,
            weekTotalMs,
            globalTotalMs: globalSnap.totalMs,
            workspaceCount: globalSnap.workspaceCount,
            workspaceList: globalSnap.workspaces,
            isEnabled: cfg.enabled,
            globalDisabled: cfg.globalDisabled,
            statusBarEnabled: cfg.statusBarEnabled,
            journalEnabled: cfg.journalEnabled ?? true,
            backupToFile: cfg.backupToFile ?? true,
            ringBufferCapacity: cfg.ringBufferCapacity ?? 1024,
            journalFlushIntervalMs: cfg.journalFlushIntervalMs ?? 10000,
            fullSaveIntervalMs: cfg.fullSaveIntervalMs ?? 60000,
            maxSessions: cfg.maxSessions ?? 1000,
        };
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
            // 同步到全局跨工作区累计
            const snap = this.sessionManager.snapshot;
            await this.global.sync(snap.currentTotalMs);
            return `已存盘: totalMs=${snap.currentTotalMs}, globalSynced, journalFlushed=${flushed}`;
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
        this.timer.reset();

        // 3. 同步全局（重置为 0）
        await this.global.sync(0);

        // 4. 新建空数据存盘
        const freshData: WorkspaceTimingData = { ...this.timer.data, sessions: [...this.timer.data.sessions] };
        await this.storage.save(freshData);

        // 5. 重新启动
        await this.start();
    }
}
