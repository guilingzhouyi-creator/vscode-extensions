/**
 * ConfigWatcher — 配置变更监听器
 *
 * 职责：监听 VS Code 设置变更，同步到 DisableManager 和其他模块
 * 边界：只做配置变更通知，不做业务决策
 */

import * as vscode from 'vscode';
import {
    TimingConfig,
    DEFAULT_CONFIG,
    sanitizeWeeklyLimitHours,
    sanitizeWeeklyLimitEnabled,
} from '../domain/models';
import { DashboardData } from '../domain/dashboard-types';
import { TimerOrchestrator } from '../application/TimerOrchestrator';
import { LogLevel, log } from './Logger';
import { t, setLocale, resolveLocale } from '../i18n/index';

const CONFIG_SECTION = 'workspaceTiming';

/**
 * 配置数值下限钳制（面板/JSON 手写越界防护）：
 * - ringBufferCapacity < 1 会使 RingBuffer 构造抛异常，导致扩展激活失败；
 * - flush/save 间隔 <= 0 会让 setInterval 以 ~1ms 疯狂触发（CPU/I/O 热点）。
 * 与面板输入框的 min 属性保持一致口径。
 */
const MIN_RING_BUFFER_CAP = 1;
const MIN_INTERVAL_MS = 1000;

/**
 * 读取当前用户配置（唯一入口，避免多处重复实现导致配置漂移）。
 * 供 ConfigWatcher 与 extension.ts 初始化共用，保证初始化/运行期配置同源。
 */
export function readTimingConfig(): TimingConfig {
    const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);

    return {
        enabled: cfg.get<boolean>('enabled', DEFAULT_CONFIG.enabled),
        globalDisabled: cfg.get<boolean>('globalDisabled', DEFAULT_CONFIG.globalDisabled),
        locale: cfg.get<'auto' | 'zh-CN' | 'en'>('locale', DEFAULT_CONFIG.locale),
        statusBarEnabled: cfg.get<boolean>('statusBar.enabled', DEFAULT_CONFIG.statusBarEnabled),
        backupToFile: cfg.get<boolean>('storage.backupToFile', DEFAULT_CONFIG.backupToFile),
        journalEnabled: cfg.get<boolean>('storage.journalEnabled', DEFAULT_CONFIG.journalEnabled),
        ringBufferCapacity: Math.max(MIN_RING_BUFFER_CAP, Math.floor(
            cfg.get<number>('storage.ringBufferCapacity', DEFAULT_CONFIG.ringBufferCapacity),
        )),
        journalFlushIntervalMs: Math.max(MIN_INTERVAL_MS,
            cfg.get<number>('storage.journalFlushInterval', DEFAULT_CONFIG.journalFlushIntervalMs)),
        fullSaveIntervalMs: Math.max(MIN_INTERVAL_MS,
            cfg.get<number>('storage.fullSaveInterval', DEFAULT_CONFIG.fullSaveIntervalMs)),
        statusBarFormat: cfg.get<'compact' | 'detailed'>('statusBar.format', DEFAULT_CONFIG.statusBarFormat),
        maxSessions: Math.max(0,
            cfg.get<number>('storage.maxSessions', DEFAULT_CONFIG.maxSessions)),
        historyRawRetentionDays: Math.max(0,
            cfg.get<number>('storage.historyRawRetentionDays', DEFAULT_CONFIG.historyRawRetentionDays)),
        safetySnapshot: cfg.get<boolean>('storage.safetySnapshot', DEFAULT_CONFIG.safetySnapshot),
        weeklyLimitEnabled: sanitizeWeeklyLimitEnabled(cfg.get('weeklyLimit.enabled', DEFAULT_CONFIG.weeklyLimitEnabled)),
        weeklyLimitHours: sanitizeWeeklyLimitHours(cfg.get('weeklyLimit.hours', DEFAULT_CONFIG.weeklyLimitHours)),
    };
}

/**
 * 将面板或命令修改的配置持久化写入 VS Code settings.json (默认 ConfigurationTarget.Global)
 */
export async function persistTimingConfig(
    partial: Partial<DashboardData> | Partial<TimingConfig>,
    target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Global,
): Promise<void> {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    const promises: Thenable<void>[] = [];

    if ('isEnabled' in partial && partial.isEnabled !== undefined) {
        promises.push(config.update('enabled', partial.isEnabled, target));
    }
    if ('enabled' in partial && partial.enabled !== undefined) {
        promises.push(config.update('enabled', partial.enabled, target));
    }
    if ('globalDisabled' in partial && partial.globalDisabled !== undefined) {
        promises.push(config.update('globalDisabled', partial.globalDisabled, target));
    }
    if ('locale' in partial && partial.locale !== undefined) {
        promises.push(config.update('locale', partial.locale, target));
    }
    if ('statusBarEnabled' in partial && partial.statusBarEnabled !== undefined) {
        promises.push(config.update('statusBar.enabled', partial.statusBarEnabled, target));
    }
    if ('statusBarFormat' in partial && partial.statusBarFormat !== undefined) {
        promises.push(config.update('statusBar.format', partial.statusBarFormat, target));
    }
    if ('journalEnabled' in partial && partial.journalEnabled !== undefined) {
        promises.push(config.update('storage.journalEnabled', partial.journalEnabled, target));
    }
    if ('backupToFile' in partial && partial.backupToFile !== undefined) {
        promises.push(config.update('storage.backupToFile', partial.backupToFile, target));
    }
    if ('ringBufferCapacity' in partial && partial.ringBufferCapacity !== undefined) {
        promises.push(config.update('storage.ringBufferCapacity', partial.ringBufferCapacity, target));
    }
    if ('journalFlushIntervalMs' in partial && partial.journalFlushIntervalMs !== undefined) {
        promises.push(config.update('storage.journalFlushInterval', partial.journalFlushIntervalMs, target));
    }
    if ('fullSaveIntervalMs' in partial && partial.fullSaveIntervalMs !== undefined) {
        promises.push(config.update('storage.fullSaveInterval', partial.fullSaveIntervalMs, target));
    }
    if ('maxSessions' in partial && partial.maxSessions !== undefined) {
        promises.push(config.update('storage.maxSessions', partial.maxSessions, target));
    }
    if ('historyRawRetentionDays' in partial && partial.historyRawRetentionDays !== undefined) {
        promises.push(config.update('storage.historyRawRetentionDays', partial.historyRawRetentionDays, target));
    }
    if ('safetySnapshot' in partial && partial.safetySnapshot !== undefined) {
        promises.push(config.update('storage.safetySnapshot', partial.safetySnapshot, target));
    }
    if ('weeklyLimitEnabled' in partial && partial.weeklyLimitEnabled !== undefined) {
        promises.push(config.update('weeklyLimit.enabled', sanitizeWeeklyLimitEnabled(partial.weeklyLimitEnabled), target));
    }
    if ('weeklyLimitHours' in partial && partial.weeklyLimitHours !== undefined) {
        promises.push(config.update('weeklyLimit.hours', sanitizeWeeklyLimitHours(partial.weeklyLimitHours), target));
    }

    try {
        await Promise.all(promises);
        log(LogLevel.Debug, `ConfigWatcher: persisted config update (${Object.keys(partial).join(', ')})`);
    } catch (err) {
        log(LogLevel.Error, 'ConfigWatcher: failed to persist configuration to VS Code settings', err as Error);
    }
}

/** 状态栏最小端口（integration 层不依赖 presentation 具体类） */
export interface StatusBarLike {
    updateConfig(config: { enabled?: boolean }): void;
}

export class ConfigWatcher {
    private readonly disposables: vscode.Disposable[] = [];
    private readonly orchestrator: TimerOrchestrator;
    private readonly statusBar: StatusBarLike;
    /** 面板按新语言重建策略（由组合根注入，无面板打开时静默跳过） */
    private readonly recreatePanel: () => void;
    /** 上次应用的语言设置（undefined=尚未应用过首轮） */
    private _lastLocale: string | undefined = undefined;

    constructor(
        orchestrator: TimerOrchestrator,
        statusBar: StatusBarLike,
        recreatePanel: () => void,
    ) {
        this.orchestrator = orchestrator;
        this.statusBar = statusBar;
        this.recreatePanel = recreatePanel;
    }

    /** 开始监听配置变更 */
    start(): void {
        this.disposables.push(
            vscode.workspace.onDidChangeConfiguration(e => {
                if (!e.affectsConfiguration(CONFIG_SECTION)) return;

                try {
                    // 云端同步占位：检测用户尝试开启云端同步 → 提示即将推出
                    this.checkCloudSyncPlaceholder(e);

                    const config = this.readConfig();
                    this.applyConfig(config);
                } catch (err) {
                    // 单次配置变更处理失败不应阻塞后续变更
                    log(LogLevel.Error, 'ConfigWatcher: failed to apply config change', err as Error);
                }
            }),
        );

        // 读取初始配置
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
        // 0. 语言切换：热生效（面板重建 + 状态栏重渲染）；命令标题需窗口重载（VS Code 限制）
        if (config.locale !== undefined && config.locale !== this._lastLocale) {
            const isFirstApply = this._lastLocale === undefined;
            this._lastLocale = config.locale;
            setLocale(resolveLocale(config.locale));
            if (!isFirstApply) {
                // 面板开着 → 按新语言重建（重建策略由组合根注入，含面板存在性判断）
                this.recreatePanel();
                log(LogLevel.Info, 'ConfigWatcher: locale changed, dashboard recreated');
            }
        }

        // 1. 更新 DisableManager
        this.orchestrator.disable.updateConfig({
            enabled: config.enabled,
            globalDisabled: config.globalDisabled,
        });

        // 2. 更新 StatusBar
        this.statusBar.updateConfig({
            enabled: config.statusBarEnabled,
        });

        // 3. 热更新调度间隔与会话历史上限（journalEnabled/capacity 需重启生效）
        this.orchestrator.applyRuntimeConfig(config);

        this.orchestrator.onDisableStateChanged(this.orchestrator.disable.resolveState());

        log(LogLevel.Debug,
            `ConfigWatcher: config applied (enabled=${config.enabled}, globalDisabled=${config.globalDisabled})`);
    }

    /**
     * 云端同步占位检测：
     * 用户尝试开启 cloudSync.enabled 时给出「即将推出」提示。
     * v0.2.0 阶段仅为扩展点占位，不实现真实同步。
     */
    private checkCloudSyncPlaceholder(e: vscode.ConfigurationChangeEvent): void {
        if (!e.affectsConfiguration('workspaceTiming.cloudSync')) return;

        const cfg = vscode.workspace.getConfiguration('workspaceTiming.cloudSync');
        const enabled = cfg.get<boolean>('enabled', false);

        if (enabled) {
            // 占位提示：云端同步即将推出
            vscode.window.showInformationMessage(t()['toast.cloudSyncPlaceholder']);
            log(LogLevel.Info, 'ConfigWatcher: cloud sync placeholder triggered');
        }
    }

    /** 停止监听 */
    stop(): void {
        for (const d of this.disposables) {
            d.dispose();
        }
        this.disposables.length = 0;
    }
}
