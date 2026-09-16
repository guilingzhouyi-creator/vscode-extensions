/**
 * ConfigWatcher — 配置变更监听器
 *
 * 职责：监听 VS Code 设置变更，同步到 DisableManager 和其他模块
 * 边界：只做配置变更通知，不做业务决策
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
} from '../domain/models';
import { DashboardData } from '../domain/dashboard-types';
import { LogLevel, log } from './Logger';
import { t, setLocale, resolveLocale } from '../i18n/index';

const CONFIG_SECTION = 'workspaceTiming';

/**
 * 读取当前用户配置（唯一入口，避免多处重复实现导致配置漂移）。
 * 供 ConfigWatcher 与 extension.ts 初始化共用，保证初始化/运行期配置同源。
 *
 * 所有数值型配置经 domain/models 的净化器钳制（与 package.json 的
 * minimum/maximum、面板输入框 min/max 属性三方一致，见 models.ts 边界单一真源）：
 * - ringBufferCapacity < 1 会使 RingBuffer 构造抛异常，导致扩展激活失败；
 * - flush/save 间隔 <= 0 会让 setInterval 以 ~1ms 疯狂触发（CPU/I/O 热点）；
 * - 超出上界的值一律钳回合法域，杜绝手写配置越界。
 */
export function readTimingConfig(): TimingConfig {
    const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);

    return {
        enabled: cfg.get<boolean>('enabled', DEFAULT_CONFIG.enabled),
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
    };
}

/**
 * 持久化字段映射表（声明式单一事实源）。
 *   field    → 入参触达名（TimingConfig / DashboardData 历史双轨名，如 isEnabled=enabled）
 *   key      → VS Code settings 键（相对 workspaceTiming 段）
 *   sanitize → 写入前净化器（可选）
 * 新增可持久化字段只需在此登记，不再增长 if 链。
 */
const PERSIST_FIELDS: ReadonlyArray<{
    field: string;
    key: string;
    sanitize?: (v: unknown) => unknown;
}> = [
    { field: 'isEnabled', key: 'enabled' },   // DashboardData 历史触达名
    { field: 'enabled', key: 'enabled' },     // TimingConfig 本名
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
];

/**
 * 将面板或命令修改的配置持久化写入 VS Code settings.json (默认 ConfigurationTarget.Global)
 */
export async function persistTimingConfig(
    partial: Partial<DashboardData> | Partial<TimingConfig>,
    target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Global,
): Promise<void> {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    const record = partial as Record<string, unknown>;
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

export class ConfigWatcher {
    private readonly disposables: vscode.Disposable[] = [];
    private readonly orchestrator: RuntimeConfigPort;
    private readonly statusBar: StatusBarLike;
    /** 面板按新语言重建策略（由组合根注入，无面板打开时静默跳过） */
    private readonly recreatePanel: () => void;
    /** 上次应用的语言设置（undefined=尚未应用过首轮） */
    private _lastLocale: string | undefined = undefined;

    constructor(
        orchestrator: RuntimeConfigPort,
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

        // 1. 更新 DisableManager + 可变配置分发 + 禁用状态编排（经窄端口，门面内聚处理）
        this.orchestrator.applyConfig(config);

        // 2. 更新 StatusBar（显示开关 + 初始显示模式）
        this.statusBar.updateConfig({
            enabled: config.statusBarEnabled,
            mode: config.statusBarMode,
        });

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
