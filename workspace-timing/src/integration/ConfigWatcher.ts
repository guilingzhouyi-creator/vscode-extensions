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
} from '../domain/models';
import { DashboardData } from '../domain/dashboard-types';
import { LogLevel, log } from './Logger';
import { t, setLocale, resolveLocale } from '../i18n/index';

const CONFIG_SECTION = 'workspaceTiming';
const CONFIG_KEY_ENABLED = 'enabled';

/**
 * 读取当前用户配置（唯一入口，避免多处重复实现导致配置漂移）。
 * 供 ConfigWatcher 与 extension.ts 初始化共用，保证初始化/运行期配置同源。
 */
export function readTimingConfig(): TimingConfig {
    const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);

    return {
        enabled: cfg.get<boolean>(CONFIG_KEY_ENABLED, DEFAULT_CONFIG.enabled),
        globalDisabled: cfg.get<boolean>('globalDisabled', DEFAULT_CONFIG.globalDisabled),
        locale: sanitizeLocale(cfg.get('locale', DEFAULT_CONFIG.locale)),
        statusBarEnabled: cfg.get<boolean>('statusBar.enabled', DEFAULT_CONFIG.statusBarEnabled),
        backupToFile: cfg.get<boolean>('storage.backupToFile', DEFAULT_CONFIG.backupToFile),
        journalEnabled: cfg.get<boolean>('storage.journalEnabled', DEFAULT_CONFIG.journalEnabled),
        ringBufferCapacity: sanitizeRingBufferCapacity(
            cfg.get<number>('storage.ringBufferCapacity', DEFAULT_CONFIG.ringBufferCapacity)),
        journalFlushIntervalMs: sanitizeJournalFlushIntervalMs(
            cfg.get<number>('storage.journalFlushInterval', DEFAULT_CONFIG.journalFlushIntervalMs)),
        fullSaveIntervalMs: sanitizeFullSaveIntervalMs(
            cfg.get<number>('storage.fullSaveInterval', DEFAULT_CONFIG.fullSaveIntervalMs)),
        statusBarMode: sanitizeStatusBarMode(cfg.get('statusBar.mode', DEFAULT_CONFIG.statusBarMode)),
        maxSessions: sanitizeMaxSessions(
            cfg.get<number>('storage.maxSessions', DEFAULT_CONFIG.maxSessions)),
        historyRawRetentionDays: sanitizeHistoryRawRetentionDays(
            cfg.get<number>('storage.historyRawRetentionDays', DEFAULT_CONFIG.historyRawRetentionDays)),
        safetySnapshot: cfg.get<boolean>('storage.safetySnapshot', DEFAULT_CONFIG.safetySnapshot),
        weeklyLimitEnabled: sanitizeWeeklyLimitEnabled(cfg.get('weeklyLimit.enabled', DEFAULT_CONFIG.weeklyLimitEnabled)),
        weeklyLimitHours: sanitizeWeeklyLimitHours(cfg.get('weeklyLimit.hours', DEFAULT_CONFIG.weeklyLimitHours)),
        idleTimeoutMinutes: sanitizeIdleTimeoutMinutes(cfg.get('idleTimeoutMinutes', DEFAULT_CONFIG.idleTimeoutMinutes)),
        aiDetectionEnabled: sanitizeAiDetectionEnabled(cfg.get('aiDetectionEnabled', DEFAULT_CONFIG.aiDetectionEnabled)),
        aiCooldownSeconds: sanitizeAiCooldownSeconds(cfg.get('aiCooldownSeconds', DEFAULT_CONFIG.aiCooldownSeconds)),
        chartDualTrackDisplay: sanitizeChartDualTrackDisplay(
            cfg.get<boolean>('chartDualTrackDisplay', DEFAULT_CONFIG.chartDualTrackDisplay)),
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
    { field: CONFIG_KEY_ENABLED, key: CONFIG_KEY_ENABLED },
    { field: 'globalDisabled', key: 'globalDisabled' },
    { field: 'locale', key: 'locale' },
    { field: 'statusBarEnabled', key: 'statusBar.enabled' },
    { field: 'statusBarMode', key: 'statusBar.mode' },
    { field: 'journalEnabled', key: 'storage.journalEnabled' },
    { field: 'backupToFile', key: 'storage.backupToFile' },
    { field: 'ringBufferCapacity', key: 'storage.ringBufferCapacity' },
    { field: 'journalFlushIntervalMs', key: 'storage.journalFlushInterval' },
    { field: 'fullSaveIntervalMs', key: 'storage.fullSaveInterval' },
    { field: 'maxSessions', key: 'storage.maxSessions' },
    { field: 'historyRawRetentionDays', key: 'storage.historyRawRetentionDays' },
    { field: 'safetySnapshot', key: 'storage.safetySnapshot' },
    { field: 'weeklyLimitEnabled', key: 'weeklyLimit.enabled', sanitize: sanitizeWeeklyLimitEnabled },
    { field: 'weeklyLimitHours', key: 'weeklyLimit.hours', sanitize: sanitizeWeeklyLimitHours },
    { field: 'idleTimeoutMinutes', key: 'idleTimeoutMinutes', sanitize: sanitizeIdleTimeoutMinutes },
    { field: 'aiDetectionEnabled', key: 'aiDetectionEnabled', sanitize: sanitizeAiDetectionEnabled },
    { field: 'aiCooldownSeconds', key: 'aiCooldownSeconds', sanitize: sanitizeAiCooldownSeconds },
    { field: 'chartDualTrackDisplay', key: 'chartDualTrackDisplay', sanitize: sanitizeChartDualTrackDisplay },
];

/**
 * 将面板或命令修改的配置持久化写入 VS Code settings.json (默认 ConfigurationTarget.Global)
 */
export async function persistTimingConfig(
    partial: Partial<DashboardData> | Partial<TimingConfig>,
    target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Global,
): Promise<void> {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
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
        log(LogLevel.Error, 'ConfigWatcher: failed to persist configuration to VS Code settings', err as Error);
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
                if (!e.affectsConfiguration(CONFIG_SECTION)) return;

                try {
                    const config = this.readConfig();
                    this.applyConfig(config);
                } catch (err) {
                    log(LogLevel.Error, 'ConfigWatcher: failed to apply config change', err as Error);
                }
            }),
        );

        const config = this.readConfig();
        this.applyConfig(config);

        log(LogLevel.Info, 'ConfigWatcher: started');
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
                log(LogLevel.Info, 'ConfigWatcher: locale changed, dashboard recreated');
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
