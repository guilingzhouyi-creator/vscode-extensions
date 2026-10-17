/**
 * Module: TimerOrchestrator
 * File Path: src/application/TimerOrchestrator.ts
 * Architecture Role: Central business orchestrator and application coordinator facade
 * Dependencies & Triggers: TimerEngine, StorageCoordinator, JournalWriter, SessionManager,
 *   DisableManager, Scheduler, GlobalAggregator; invoked by extension lifecycle and UI commands
 * Responsibilities: Coordinate session state machines; manage destructive operations via
 *   serialized FIFO queue; dispatch configuration updates; generate dashboard DTOs and exports
 * Exit Semantics & Design Rationale: Coordinates graceful shutdown across Scheduler and
 *   SessionManager; enforces serialized execution queue to prevent concurrent state corruption
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
    ActivityMode,
} from '../domain/models';
import { validateTimingData } from '../persistence/data-validator';
import { migrateToFolded } from '../domain/history-folder';
import { TimeAggregator } from '../domain/TimeAggregator';
import { DashboardData } from '../domain/dashboard-types';
import { GlobalAggregator } from './GlobalAggregator';
import { DisableManager, DisableState } from './DisableManager';
import { Scheduler, StatusBarDisplayData } from './Scheduler';
import { exportCSV, exportAggregatedCSV, exportReport, ReportKind } from './exporters/index';
import { buildDashboardData } from './dashboard-data-assembler';
import { LogLevel, log } from '../integration/logger';
import { t, format } from '../i18n/index';

export type { OrchestratorState };
export { ORCHESTRATOR_STATES };

const SNAPSHOT_REASON_RESET = 'reset';
const SNAPSHOT_REASON_CLEAR_HISTORY = 'clear-history';
const SNAPSHOT_REASON_RESTORE = 'restore';
const DEFAULT_WORKSPACE_NAME = 'workspace';
const LOCALE_EN = 'en';
const LOCALE_ZH_CN = 'zh-CN';
const UNKNOWN_ERROR_MESSAGE = 'unknown';
const DISABLE_STATE_ENABLED = 'enabled';
const DISABLE_STATE_WS = 'workspace-disabled';
const DISABLE_STATE_GLOBAL = 'globally-disabled';
const LOG_START_REQUESTED = 'TimerOrchestrator: start requested';
const LOG_TIMING_DISABLED = 'TimerOrchestrator: timing is disabled, skipping';
const LOG_RUNNING = 'TimerOrchestrator: running';
const LOG_FAILED_TO_START = 'TimerOrchestrator: failed to start';
const LOG_STOP_REQUESTED = 'TimerOrchestrator: stop requested';
const LOG_SAVING_DATA = 'TimerOrchestrator: saving data now';
const LOG_NEW_PERIOD = 'TimerOrchestrator: new period requested';
const LOG_RESET_ALL_DATA = 'TimerOrchestrator: resetAllData requested';
const LOG_OP_QUEUE_FAILED = 'TimerOrchestrator: queued operation failed';
const LOG_CLEAR_HISTORY = 'TimerOrchestrator: clearHistory requested';
const LOG_JOURNAL_TRUNCATE_FAILED = 'clearHistory: journal truncate failed';

const CONFIG_MAPPINGS_TEXT = `isEnabled:enabled
globalDisabled:globalDisabled
locale:locale
statusBarEnabled:statusBarEnabled
journalEnabled:journalEnabled
backupToFile:backupToFile
ringBufferCapacity:ringBufferCapacity
journalFlushIntervalMs:journalFlushIntervalMs
fullSaveIntervalMs:fullSaveIntervalMs
maxSessions:maxSessions
historyRawRetentionDays:historyRawRetentionDays
safetySnapshot:safetySnapshot
idleTimeoutMinutes:idleTimeoutMinutes
aiDetectionEnabled:aiDetectionEnabled
aiCooldownSeconds:aiCooldownSeconds`;

const DASHBOARD_CONFIG_DIRECT_MAP: ReadonlyArray<[keyof DashboardData, keyof TimingConfig]> =
    Object.freeze(
        CONFIG_MAPPINGS_TEXT.split('\n').map((line) => {
            const [d, c] = line.split(':');
            return [d as keyof DashboardData, c as keyof TimingConfig] as [keyof DashboardData, keyof TimingConfig];
        }),
    );

/**
 * Coordinates timer execution, persistent storage, scheduling, and UI state synchronization.
 */
export class TimerOrchestrator {
    private _state: OrchestratorState = ORCHESTRATOR_STATES.IDLE;
    private _safetySnapshotEnabled: boolean = true;
    private _onStateChange: ((state: OrchestratorState) => void) | null = null;
    private _weeklyLimitNotifiedWeek: string | null = null;
    private _onWeeklyLimitExceeded: ((message: string) => void) | null = null;
    private _opQueue: Promise<unknown> = Promise.resolve();

    constructor(
        private readonly timer: TimerEngine,
        private readonly storage: StorageCoordinator,
        private readonly journal: JournalWriter,
        private readonly sessionManager: SessionManager,
        private readonly disableManager: DisableManager,
        private readonly scheduler: Scheduler,
        private readonly global: GlobalAggregator,
    ) {}

    get state(): OrchestratorState { return this._state; }
    get session(): SessionManager { return this.sessionManager; }
    get disable(): DisableManager { return this.disableManager; }

    onStateChange(cb: (state: OrchestratorState) => void): void { this._onStateChange = cb; }
    onTick(cb: (data: StatusBarDisplayData) => void): void { this.scheduler.onStatusBarUpdate(cb); }
    onWeeklyLimitExceeded(cb: (message: string) => void): void { this._onWeeklyLimitExceeded = cb; }

    async start(): Promise<void> {
        log(LogLevel.Info, LOG_START_REQUESTED);
        if (!this.disableManager.shouldCount()) {
            this._state = ORCHESTRATOR_STATES.DISABLED;
            log(LogLevel.Info, LOG_TIMING_DISABLED);
            this._onStateChange?.(this._state);
            return;
        }
        try {
            await this.sessionManager.startSession();
            this.scheduler.start();
            this._state = ORCHESTRATOR_STATES.RUNNING;
            log(LogLevel.Info, LOG_RUNNING);
            this._onStateChange?.(this._state);
        } catch (err) {
            this._state = ORCHESTRATOR_STATES.ERROR;
            log(LogLevel.Error, LOG_FAILED_TO_START, err as Error);
            this._onStateChange?.(this._state);
            throw err;
        }
    }

    async stop(): Promise<SessionResult> {
        log(LogLevel.Info, LOG_STOP_REQUESTED);
        await this.scheduler.stop();
        const result = await this.sessionManager.endSession();
        this._state = ORCHESTRATOR_STATES.STOPPED;
        log(LogLevel.Info, `TimerOrchestrator: stopped (elapsed=${result.elapsedMs}ms)`);
        this._onStateChange?.(this._state);
        return result;
    }

    async onDisableStateChanged(targetState: DisableState): Promise<void> {
        log(LogLevel.Info, `TimerOrchestrator: disable state changed to ${targetState}`);
        if (targetState === DISABLE_STATE_ENABLED) {
            if (this._state === ORCHESTRATOR_STATES.DISABLED || this._state === ORCHESTRATOR_STATES.STOPPED) {
                await this.start();
            }
            return;
        }
        if (targetState === DISABLE_STATE_WS || targetState === DISABLE_STATE_GLOBAL) {
            if (this._state === ORCHESTRATOR_STATES.RUNNING) {
                await this.stop();
                this._state = ORCHESTRATOR_STATES.DISABLED;
                this._onStateChange?.(this._state);
            }
        }
    }

    async saveNow(): Promise<void> {
        log(LogLevel.Info, LOG_SAVING_DATA);
        await this.sessionManager.saveCheckpoint();
        await this.global.sync(this.timer.snapshot().currentTotalMs);
    }

    async getDashboardData(): Promise<DashboardData> {
        this.sessionManager.autoRecycleSessions();
        const snap = this.timer.snapshot();
        const globalSnap = await this.global.snapshot();
        return buildDashboardData({
            data: this.timer.data,
            currentTotalMs: snap.currentTotalMs,
            todayMs: this.sessionManager.getTodayMs(),
            manualTodayMs: this.sessionManager.getTodayManualMs(),
            aiTodayMs: this.sessionManager.getTodayAiMs(),
            idleTodayMs: this.sessionManager.getTodayIdleMs(),
            manualTotalMs: snap.manualTotalMs,
            aiTotalMs: snap.aiTotalMs,
            idleTotalMs: snap.idleTotalMs,
            config: this.disableManager.config,
            global: globalSnap,
        });
    }

    async handleActivity(mode: ActivityMode, timestampMs: number): Promise<void> {
        if (this._state === ORCHESTRATOR_STATES.PAUSED_IDLE) {
            log(LogLevel.Info, `TimerOrchestrator: resuming from idle (activity detected: ${mode})`);
            await this.sessionManager.handleIdleResume(timestampMs);
            this._state = ORCHESTRATOR_STATES.RUNNING;
            this._onStateChange?.(this._state);
        }
        this.sessionManager.switchMode(mode);
    }

    async handleIdleTimeout(idleStartMs: number): Promise<void> {
        if (this._state === ORCHESTRATOR_STATES.RUNNING) {
            log(LogLevel.Info, `TimerOrchestrator: pausing for idle (idleStartMs=${idleStartMs})`);
            await this.sessionManager.handleIdlePause(idleStartMs);
            this._state = ORCHESTRATOR_STATES.PAUSED_IDLE;
            this._onStateChange?.(this._state);
        }
    }

    handleModeChange(mode: ActivityMode): void { this.sessionManager.switchMode(mode); }

    async exportReport(kind: ReportKind): Promise<string> {
        const locale = this.disableManager.config.locale === LOCALE_EN ? LOCALE_EN : LOCALE_ZH_CN;
        return exportReport(this.timer.data, kind, locale);
    }

    async toggleWorkspace(): Promise<boolean> {
        return this.enqueue(async () => {
            const next = !this.disableManager.config.enabled;
            log(LogLevel.Info, `TimerOrchestrator: toggling workspace enabled to ${next}`);
            this.disableManager.updateConfig({ enabled: next });
            await this.onDisableStateChanged(this.disableManager.resolveState());
            return next;
        });
    }

    async toggleGlobal(): Promise<boolean> {
        return this.enqueue(async () => {
            const next = !this.disableManager.config.globalDisabled;
            log(LogLevel.Info, `TimerOrchestrator: toggling global disabled to ${next}`);
            this.disableManager.updateConfig({ globalDisabled: next });
            await this.onDisableStateChanged(this.disableManager.resolveState());
            return next;
        });
    }

    applyDashboardConfig(partial: Partial<DashboardData>): void {
        const cfg: Partial<TimingConfig> = {};
        for (const [dashKey, cfgKey] of DASHBOARD_CONFIG_DIRECT_MAP) {
            if (partial[dashKey] !== undefined) (cfg as Record<string, unknown>)[cfgKey] = partial[dashKey];
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

    applyConfig(config: TimingConfig): void {
        this.disableManager.updateConfig({ enabled: config.enabled, globalDisabled: config.globalDisabled });
        this.applyRuntimeConfig(config);
        void this.onDisableStateChanged(this.disableManager.resolveState());
    }

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

    async exportCSV(workspaceName: string): Promise<string> {
        const targetWorkspace = workspaceName.trim() || DEFAULT_WORKSPACE_NAME;
        return exportCSV(this.timer.data, targetWorkspace);
    }

    async newPeriod(): Promise<void> {
        log(LogLevel.Info, LOG_NEW_PERIOD);
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
            const freshData: WorkspaceTimingData = { ...this.timer.data, sessions: [...this.timer.data.sessions] };
            await this.storage.save(freshData, true);
            await this.start();
        });
    }

    async resetAllData(purgeGlobal = true): Promise<DashboardData> {
        log(LogLevel.Info, LOG_RESET_ALL_DATA);
        return this.enqueue(async () => {
            if (this._safetySnapshotEnabled) await this.storage.snapshotBeforeDestructive(SNAPSHOT_REASON_RESET);
            await this.stop();
            await this.storage.deleteAll();
            if (purgeGlobal) await this.global.reset();
            await this.start();
            return this.getDashboardData();
        });
    }

    private enqueue<T>(fn: () => Promise<T>): Promise<T> {
        const run = this._opQueue.then(fn, fn);
        this._opQueue = run.catch((err) => { log(LogLevel.Error, LOG_OP_QUEUE_FAILED, err as Error); });
        return run;
    }

    async clearHistory(): Promise<DashboardData> {
        log(LogLevel.Info, LOG_CLEAR_HISTORY);
        return this.enqueue(async () => {
            if (this._safetySnapshotEnabled) {
                await this.storage.snapshotBeforeDestructive(SNAPSHOT_REASON_CLEAR_HISTORY);
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
                log(LogLevel.Warn, LOG_JOURNAL_TRUNCATE_FAILED, err as Error);
            }
            await this.start();
            return this.getDashboardData();
        });
    }

    async restoreFrom(raw: unknown): Promise<DashboardData> {
        const validation = validateTimingData(raw);
        if (!validation.ok || !validation.data) {
            const errMsg = validation.error ?? UNKNOWN_ERROR_MESSAGE;
            throw new Error(`invalid timing data: ${errMsg}`);
        }
        let data = validation.data;
        log(LogLevel.Info, `TimerOrchestrator: restore requested (file totalMs=${data.totalMs})`);

        return this.enqueue(async () => {
            if (this._safetySnapshotEnabled) {
                await this.storage.snapshotBeforeDestructive(SNAPSHOT_REASON_RESTORE);
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

    async exportAggregatedCSV(workspaceName: string): Promise<string> {
        const targetWorkspace = workspaceName.trim() || DEFAULT_WORKSPACE_NAME;
        return exportAggregatedCSV(this.timer.data, targetWorkspace);
    }
}
