/**
 * ConfigWatcher — 配置变更监听器
 *
 * 职责：监听 VS Code 设置变更，同步到 DisableManager 和其他模块
 * 边界：只做配置变更通知，不做业务决策
 */

import * as vscode from 'vscode';
import { TimingConfig, DEFAULT_CONFIG } from '../domain/models';
import { TimerOrchestrator } from '../application/TimerOrchestrator';
import { StatusBarController } from '../presentation/StatusBarController';
import { LogLevel, log } from './Logger';

const CONFIG_SECTION = 'workspaceTiming';

export class ConfigWatcher {
    private readonly disposables: vscode.Disposable[] = [];
    private readonly orchestrator: TimerOrchestrator;
    private readonly statusBar: StatusBarController;

    constructor(orchestrator: TimerOrchestrator, statusBar: StatusBarController) {
        this.orchestrator = orchestrator;
        this.statusBar = statusBar;
    }

    /** 开始监听配置变更 */
    start(): void {
        this.disposables.push(
            vscode.workspace.onDidChangeConfiguration(e => {
                if (!e.affectsConfiguration(CONFIG_SECTION)) return;

                try {
                    const config = this.readConfig();
                    this.applyConfig(config);
                } catch (err) {
                    // 配置应用失败不应冒泡为未捕获异常，阻塞其他配置监听器
                    log(LogLevel.Error, 'ConfigWatcher: failed to apply configuration', err as Error);
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
        const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);

        return {
            enabled: cfg.get<boolean>('enabled', DEFAULT_CONFIG.enabled),
            globalDisabled: cfg.get<boolean>('globalDisabled', DEFAULT_CONFIG.globalDisabled),
            statusBarEnabled: cfg.get<boolean>('statusBar.enabled', DEFAULT_CONFIG.statusBarEnabled),
            backupToFile: cfg.get<boolean>('storage.backupToFile', DEFAULT_CONFIG.backupToFile),
            journalEnabled: cfg.get<boolean>('storage.journalEnabled', DEFAULT_CONFIG.journalEnabled),
            ringBufferCapacity: cfg.get<number>('storage.ringBufferCapacity', DEFAULT_CONFIG.ringBufferCapacity),
            journalFlushIntervalMs: cfg.get<number>('storage.journalFlushInterval', DEFAULT_CONFIG.journalFlushIntervalMs),
            fullSaveIntervalMs: cfg.get<number>('storage.fullSaveInterval', DEFAULT_CONFIG.fullSaveIntervalMs),
            statusBarFormat: cfg.get<'compact' | 'detailed'>('statusBar.format', DEFAULT_CONFIG.statusBarFormat),
            statusBarClickAction: cfg.get<'cycle' | 'dashboard'>('statusBar.clickAction', DEFAULT_CONFIG.statusBarClickAction),
            maxSessions: cfg.get<number>('storage.maxSessions', DEFAULT_CONFIG.maxSessions),
            activityTrackingEnabled: cfg.get<boolean>('efficiency.enabled', DEFAULT_CONFIG.activityTrackingEnabled),
            idleTimeoutMs: cfg.get<number>('idleTimeoutMinutes', DEFAULT_CONFIG.idleTimeoutMs / 60000) * 60000,
            dailyGoalMs: cfg.get<number>('dailyGoalMinutes', DEFAULT_CONFIG.dailyGoalMs / 60000) * 60000,
        };
    }

    /** 应用配置到各模块 */
    private applyConfig(config: TimingConfig): void {
        this.orchestrator.disable.updateConfig({
            enabled: config.enabled,
            globalDisabled: config.globalDisabled,
        });
        this.statusBar.updateConfig({
            enabled: config.statusBarEnabled,
            clickAction: config.statusBarClickAction,
        });

        // ★ 热更新调度器间隔
        this.orchestrator.schedulerInstance.updateIntervals({
            journalFlushIntervalMs: config.journalFlushIntervalMs,
            fullSaveIntervalMs: config.fullSaveIntervalMs,
        });

        this.orchestrator.onDisableStateChanged(this.orchestrator.disable.resolveState());
    }

    /** 停止监听 */
    stop(): void {
        for (const d of this.disposables) {
            d.dispose();
        }
        this.disposables.length = 0;
    }
}
