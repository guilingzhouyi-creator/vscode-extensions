/**
 * Module: ConfigWatcher — Configuration Change Listener & Persistence Mapper
 * File Path: src/integration/ConfigWatcher.ts
 * Architecture Role: Integration layer configuration observer and persistence gateway
 * Dependencies & Triggers: Consumes vscode.workspace configuration events; triggers RuntimeConfigPort, StatusBarLike, and i18n locale updates
 * Responsibilities: Read and sanitize workspace timing configurations, map persistence fields to VS Code settings, observe configuration changes, and notify downstream runtime ports
 * Exit Semantics & Design Rationale: Pure configuration observer with no domain business logic; sanitizes user inputs at boundary to prevent state corruption; safely disposes listeners on stop
 */

import * as vscode from 'vscode';
import {
    TimingConfig,
    StatusBarMode,
    DEFAULT_CONFIG,
    TIMING_CONFIG_KEYS,
    sanitizeWeeklyLimitHours,
    sanitizeWeeklyLimitEnabled,
    sanitizeRingBufferCapacity,
    sanitizeJournalFlushIntervalMs,
    sanitizeFullSaveIntervalMs,
    sanitizeHistoryRawRetentionDays,
    sanitizeMaxSessions,
    sanitizeStatusBarMode,
    sanitizeLocale,
    sanitizeIdleTimeoutMinutes,
    sanitizeAiDetectionEnabled,
    sanitizeAiCooldownSeconds,
    sanitizeChartDualTrackDisplay,
    TIMING_CONFIG_FIELDS,
} from '../domain/models';
import { DashboardData } from '../domain/dashboard-types';
import { LogLevel, log } from './logger';
import { setLocale, resolveLocale } from '../i18n/index';

const LOG_PERSIST_CONFIG_FAILED = 'ConfigWatcher: failed to persist configuration to VS Code settings';
const LOG_APPLY_CONFIG_FAILED = 'ConfigWatcher: failed to apply config change';
const LOG_LOCALE_CHANGED = 'ConfigWatcher: locale changed, dashboard recreated';
const LOG_CONFIG_WATCHER_STARTED = 'ConfigWatcher: started';

/**
 * 读取当前用户配置（唯一入口，避免多处重复实现导致配置漂移）。
 * 供 ConfigWatcher 与 extension.ts 初始化共用，保证初始化/运行期配置同源。
 */
export function readTimingConfig(): TimingConfig {
    const cfg = vscode.workspace.getConfiguration(TIMING_CONFIG_KEYS.SECTION);

    return {
        enabled: cfg.get<boolean>(TIMING_CONFIG_KEYS.ENABLED, DEFAULT_CONFIG.enabled),
        globalDisabled: cfg.get<boolean>(TIMING_CONFIG_KEYS.GLOBAL_DISABLED, DEFAULT_CONFIG.globalDisabled),
        locale: sanitizeLocale(cfg.get(TIMING_CONFIG_KEYS.LOCALE, DEFAULT_CONFIG.locale)),
        statusBarEnabled: cfg.get<boolean>(TIMING_CONFIG_KEYS.STATUS_BAR_ENABLED, DEFAULT_CONFIG.statusBarEnabled),
        backupToFile: cfg.get<boolean>(TIMING_CONFIG_KEYS.STORAGE_BACKUP_TO_FILE, DEFAULT_CONFIG.backupToFile),
        journalEnabled: cfg.get<boolean>(TIMING_CONFIG_KEYS.STORAGE_JOURNAL_ENABLED, DEFAULT_CONFIG.journalEnabled),
        ringBufferCapacity: sanitizeRingBufferCapacity(
            cfg.get<number>(TIMING_CONFIG_KEYS.STORAGE_RING_BUFFER_CAPACITY, DEFAULT_CONFIG.ringBufferCapacity)),
        journalFlushIntervalMs: sanitizeJournalFlushIntervalMs(
            cfg.get<number>(TIMING_CONFIG_KEYS.STORAGE_JOURNAL_FLUSH_INTERVAL, DEFAULT_CONFIG.journalFlushIntervalMs)),
        fullSaveIntervalMs: sanitizeFullSaveIntervalMs(
            cfg.get<number>(TIMING_CONFIG_KEYS.STORAGE_FULL_SAVE_INTERVAL, DEFAULT_CONFIG.fullSaveIntervalMs)),
        statusBarMode: sanitizeStatusBarMode(cfg.get(TIMING_CONFIG_KEYS.STATUS_BAR_MODE, DEFAULT_CONFIG.statusBarMode)),
        maxSessions: sanitizeMaxSessions(
            cfg.get<number>(TIMING_CONFIG_KEYS.STORAGE_MAX_SESSIONS, DEFAULT_CONFIG.maxSessions)),
        historyRawRetentionDays: sanitizeHistoryRawRetentionDays(
            cfg.get<number>(TIMING_CONFIG_KEYS.STORAGE_HISTORY_RAW_RETENTION_DAYS, DEFAULT_CONFIG.historyRawRetentionDays)),
        safetySnapshot: cfg.get<boolean>(TIMING_CONFIG_KEYS.STORAGE_SAFETY_SNAPSHOT, DEFAULT_CONFIG.safetySnapshot),
        weeklyLimitEnabled: sanitizeWeeklyLimitEnabled(cfg.get(TIMING_CONFIG_KEYS.WEEKLY_LIMIT_ENABLED, DEFAULT_CONFIG.weeklyLimitEnabled)),
        weeklyLimitHours: sanitizeWeeklyLimitHours(cfg.get(TIMING_CONFIG_KEYS.WEEKLY_LIMIT_HOURS, DEFAULT_CONFIG.weeklyLimitHours)),
        idleTimeoutMinutes: sanitizeIdleTimeoutMinutes(cfg.get(TIMING_CONFIG_KEYS.IDLE_TIMEOUT_MINUTES, DEFAULT_CONFIG.idleTimeoutMinutes)),
        aiDetectionEnabled: sanitizeAiDetectionEnabled(cfg.get(TIMING_CONFIG_KEYS.AI_DETECTION_ENABLED, DEFAULT_CONFIG.aiDetectionEnabled)),
        aiCooldownSeconds: sanitizeAiCooldownSeconds(cfg.get(TIMING_CONFIG_KEYS.AI_COOLDOWN_SECONDS, DEFAULT_CONFIG.aiCooldownSeconds)),
        chartDualTrackDisplay: sanitizeChartDualTrackDisplay(
            cfg.get<boolean>(TIMING_CONFIG_KEYS.CHART_DUAL_TRACK_DISPLAY, DEFAULT_CONFIG.chartDualTrackDisplay)),
    };
}

/**
 * 持久化字段映射表（声明式单一事实源）。
 */
const PERSIST_FIELDS: ReadonlyArray<{
    field: string;
    key: string;
    sanitize?: (v: unknown) => unknown;
}> = [
    { field: TIMING_CONFIG_FIELDS.ENABLED, key: TIMING_CONFIG_KEYS.ENABLED },
    { field: TIMING_CONFIG_FIELDS.GLOBAL_DISABLED, key: TIMING_CONFIG_KEYS.GLOBAL_DISABLED },
    { field: TIMING_CONFIG_FIELDS.LOCALE, key: TIMING_CONFIG_KEYS.LOCALE },
    { field: TIMING_CONFIG_FIELDS.STATUS_BAR_ENABLED, key: TIMING_CONFIG_KEYS.STATUS_BAR_ENABLED },
    { field: TIMING_CONFIG_FIELDS.STATUS_BAR_MODE, key: TIMING_CONFIG_KEYS.STATUS_BAR_MODE },
    { field: TIMING_CONFIG_FIELDS.JOURNAL_ENABLED, key: TIMING_CONFIG_KEYS.STORAGE_JOURNAL_ENABLED },
    { field: TIMING_CONFIG_FIELDS.BACKUP_TO_FILE, key: TIMING_CONFIG_KEYS.STORAGE_BACKUP_TO_FILE },
    { field: TIMING_CONFIG_FIELDS.RING_BUFFER_CAPACITY, key: TIMING_CONFIG_KEYS.STORAGE_RING_BUFFER_CAPACITY },
    { field: TIMING_CONFIG_FIELDS.JOURNAL_FLUSH_INTERVAL_MS, key: TIMING_CONFIG_KEYS.STORAGE_JOURNAL_FLUSH_INTERVAL },
    { field: TIMING_CONFIG_FIELDS.FULL_SAVE_INTERVAL_MS, key: TIMING_CONFIG_KEYS.STORAGE_FULL_SAVE_INTERVAL },
    { field: TIMING_CONFIG_FIELDS.MAX_SESSIONS, key: TIMING_CONFIG_KEYS.STORAGE_MAX_SESSIONS },
    { field: TIMING_CONFIG_FIELDS.HISTORY_RAW_RETENTION_DAYS, key: TIMING_CONFIG_KEYS.STORAGE_HISTORY_RAW_RETENTION_DAYS },
    { field: TIMING_CONFIG_FIELDS.SAFETY_SNAPSHOT, key: TIMING_CONFIG_KEYS.STORAGE_SAFETY_SNAPSHOT },
    { field: TIMING_CONFIG_FIELDS.WEEKLY_LIMIT_ENABLED, key: TIMING_CONFIG_KEYS.WEEKLY_LIMIT_ENABLED, sanitize: sanitizeWeeklyLimitEnabled },
    { field: TIMING_CONFIG_FIELDS.WEEKLY_LIMIT_HOURS, key: TIMING_CONFIG_KEYS.WEEKLY_LIMIT_HOURS, sanitize: sanitizeWeeklyLimitHours },
    { field: TIMING_CONFIG_FIELDS.IDLE_TIMEOUT_MINUTES, key: TIMING_CONFIG_KEYS.IDLE_TIMEOUT_MINUTES, sanitize: sanitizeIdleTimeoutMinutes },
    { field: TIMING_CONFIG_FIELDS.AI_DETECTION_ENABLED, key: TIMING_CONFIG_KEYS.AI_DETECTION_ENABLED, sanitize: sanitizeAiDetectionEnabled },
    { field: TIMING_CONFIG_FIELDS.AI_COOLDOWN_SECONDS, key: TIMING_CONFIG_KEYS.AI_COOLDOWN_SECONDS, sanitize: sanitizeAiCooldownSeconds },
    { field: TIMING_CONFIG_FIELDS.CHART_DUAL_TRACK_DISPLAY, key: TIMING_CONFIG_KEYS.CHART_DUAL_TRACK_DISPLAY, sanitize: sanitizeChartDualTrackDisplay },
];

/**
 * 将面板或命令修改的配置持久化写入 VS Code settings.json (默认 ConfigurationTarget.Global)
 */
export async function persistTimingConfig(
    partial: Partial<DashboardData> | Partial<TimingConfig>,
    target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Global,
): Promise<void> {
    const config = vscode.workspace.getConfiguration(TIMING_CONFIG_KEYS.SECTION);
    const rawRecord = partial as Record<string, unknown>;
    const record: Record<string, unknown> = {
        ...rawRecord,
        ...(rawRecord.isEnabled !== undefined && rawRecord.enabled === undefined
            ? { enabled: rawRecord.isEnabled }
            : {}),
    };
    const touched: string[] = [];
    const promises = PERSIST_FIELDS
        .filter(({ field }) => record[field] !== undefined)
        .map(({ field, key, sanitize }) => {
            touched.push(key);
            const raw = record[field];
            return config.update(key, sanitize ? sanitize(raw) : raw, target);
        });

    try {
        await Promise.all(promises);
        log(LogLevel.Debug, `ConfigWatcher: persisted config update (${touched.join(', ')})`);
    } catch (err) {
        log(LogLevel.Error, LOG_PERSIST_CONFIG_FAILED, err as Error);
    }
}

/** 状态栏最小端口（integration 层不依赖 presentation 具体类） */
export interface StatusBarLike {
    updateConfig(config: { enabled?: boolean; mode?: StatusBarMode }): void;
}

/**
 * 运行期配置热应用端口（消费方定义，依赖倒置）：
 * integration 层只要求"给我一份配置你能热应用"，
 * 不感知 TimerOrchestrator 内部的禁用策略/调度器/会话上限结构。
 */
export interface RuntimeConfigPort {
    applyConfig(config: TimingConfig): void;
}

export interface ActivityWatcherLike {
    updateConfig(options: {
        idleTimeoutMinutes?: number;
        aiDetectionEnabled?: boolean;
        aiCooldownSeconds?: number;
    }): void;
}

export class ConfigWatcher implements vscode.Disposable {
    private readonly subscriptions: vscode.Disposable[] = [];
    private readonly orchestrator: RuntimeConfigPort;
    private readonly statusBar: StatusBarLike;
    /** 面板按新语言重建策略（由组合根注入，无面板打开时静默跳过） */
    private readonly recreatePanel: () => void;
    private readonly activityWatcher?: ActivityWatcherLike | null;
    /** 上次应用的语言设置（undefined=尚未应用过首轮） */
    private _lastLocale: string | undefined = undefined;

    constructor(
        orchestrator: RuntimeConfigPort,
        statusBar: StatusBarLike,
        recreatePanel: () => void,
        activityWatcher?: ActivityWatcherLike | null,
    ) {
        this.orchestrator = orchestrator;
        this.statusBar = statusBar;
        this.recreatePanel = recreatePanel;
        this.activityWatcher = activityWatcher;
    }

    /** 开始监听配置变更 */
    start(): void {
        this.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration(e => {
                if (!e.affectsConfiguration(TIMING_CONFIG_KEYS.SECTION)) return;

                try {
                    const config = this.readConfig();
                    this.applyConfig(config);
                } catch (err) {
                    log(LogLevel.Error, LOG_APPLY_CONFIG_FAILED, err as Error);
                }
            }),
        );

        const config = this.readConfig();
        this.applyConfig(config);

        log(LogLevel.Info, LOG_CONFIG_WATCHER_STARTED);
    }

    /** 读取当前配置 */
    private readConfig(): TimingConfig {
        return readTimingConfig();
    }

    /** 应用配置到各模块 */
    private applyConfig(config: TimingConfig): void {
        if (config.locale !== undefined && config.locale !== this._lastLocale) {
            const isFirstApply = this._lastLocale === undefined;
            this._lastLocale = config.locale;
            setLocale(resolveLocale(config.locale));
            if (!isFirstApply) {
                this.recreatePanel();
                log(LogLevel.Info, LOG_LOCALE_CHANGED);
            }
        }

        this.orchestrator.applyConfig(config);

        this.statusBar.updateConfig({
            enabled: config.statusBarEnabled,
            mode: config.statusBarMode,
        });

        if (this.activityWatcher) {
            this.activityWatcher.updateConfig({
                idleTimeoutMinutes: config.idleTimeoutMinutes,
                aiDetectionEnabled: config.aiDetectionEnabled,
                aiCooldownSeconds: config.aiCooldownSeconds,
            });
        }

        log(LogLevel.Debug,
            `ConfigWatcher: config applied (enabled=${config.enabled}, globalDisabled=${config.globalDisabled})`);
    }

    /** 停止监听并释放资源 */
    stop(): void {
        for (const d of this.subscriptions) {
            d.dispose();
        }
        this.subscriptions.length = 0;
    }

    /** vscode.Disposable 契约接口实现 */
    dispose(): void {
        this.stop();
    }
}
