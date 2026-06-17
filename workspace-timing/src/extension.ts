/**
 * WorkspaceTiming — VS Code Extension Entry
 *
 * 插件入口：activate / deactivate
 * 职责：组装所有模块，启动计时流程
 * 严格遵循"先地基后上层"原则：
 *   1. Logger → 2. Storage → 3. Cache → 4. Domain → 5. Application → 6. Presentation
 */

import * as vscode from 'vscode';

// Domain
import { TimerEngine } from './domain/TimerEngine';
import { LogLevel, setLogLevel, log } from './integration/Logger';

// Cache
import { JournalWriter } from './cache/JournalWriter';

// Persistence
import { WorkspaceStateProvider } from './persistence/WorkspaceStateProvider';
import { FileStorageProvider } from './persistence/FileStorageProvider';
import { JournalStorageProvider } from './persistence/JournalStorageProvider';
import { StorageCoordinator } from './persistence/StorageCoordinator';

// Application
import { TimerOrchestrator } from './application/TimerOrchestrator';
import { SessionManager } from './application/SessionManager';
import { DisableManager } from './application/DisableManager';
import { Scheduler } from './application/Scheduler';

// Presentation
import { StatusBarController } from './presentation/StatusBarController';
import { CommandRegistrar } from './presentation/CommandRegistrar';
import { DashboardPanel } from './presentation/DashboardPanel';
import { DashboardMessage } from './domain/dashboard-types';
import { GlobalStorageProvider } from './persistence/GlobalStorageProvider';
import { GlobalAggregator } from './application/GlobalAggregator';
import { init as initI18n, t } from './i18n/index';

// Integration
import { LifecycleManager } from './integration/LifecycleManager';
import { ConfigWatcher } from './integration/ConfigWatcher';

let orchestrator: TimerOrchestrator | null = null;
let statusBar: StatusBarController | null = null;
let commandRegistrar: CommandRegistrar | null = null;
let lifecycleManager: LifecycleManager | null = null;
let configWatcher: ConfigWatcher | null = null;
let scheduler: Scheduler | null = null;

export function activate(context: vscode.ExtensionContext): void {
    const startTime = Date.now();

    // 初始化 i18n
    initI18n();

    // 设置日志等级
    setLogLevel(context.extensionMode === vscode.ExtensionMode.Development
        ? LogLevel.Debug
        : LogLevel.Info);

    log(LogLevel.Info, 'WorkspaceTiming: activating...');

    try {
        // ─── 获取工作区根目录 ───
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;

        if (workspaceRoot) {
            // ═══ 有工作区：完整模式（计时 + 存储 + 状态栏）═══
            const timer = new TimerEngine();

            // Persistence 层
            const workspaceStateProvider = new WorkspaceStateProvider(context);
            const fileStorageProvider = new FileStorageProvider(workspaceRoot);
            const journalStorageProvider = new JournalStorageProvider(workspaceRoot);
            const storage = new StorageCoordinator(
                workspaceStateProvider,
                fileStorageProvider,
                journalStorageProvider,
            );

            // 缓存层
            const journal = new JournalWriter(journalStorageProvider);

            // Application 层
            const disableManager = new DisableManager();
            const sessionManager = new SessionManager(timer, storage, journal);
            scheduler = new Scheduler(journal, sessionManager);
            const globalStorage = new GlobalStorageProvider(context);
            const globalAggregator = new GlobalAggregator(globalStorage);
            orchestrator = new TimerOrchestrator(
                timer, storage, journal, sessionManager, disableManager, scheduler, globalAggregator,
            );

            // Presentation 层
            statusBar = new StatusBarController();
            statusBar.show();

            // 状态栏 + 面板 tick（今日 + 累计）
            orchestrator.onTick(({ totalMs, todayMs }) => {
                statusBar?.updateTime(todayMs, totalMs);
                if (DashboardPanel.currentPanel && orchestrator) {
                    orchestrator.getDashboardData().then(data => {
                        DashboardPanel.currentPanel?.updateData(data);
                    });
                }
            });
            orchestrator.onStateChange((state) => {
                if (state === 'disabled') {
                    statusBar?.updateTime(0, 0);
                }
            });

            // Dashboard 面板消息路由
            const dashboardMessageHandler = (msg: DashboardMessage) => {
                switch (msg.type) {
                    case 'updateConfig':
                        orchestrator?.applyDashboardConfig(msg.payload);
                        vscode.window.showInformationMessage(t()['toast.configUpdated']);
                        break;
                    case 'newPeriod':
                        orchestrator?.newPeriod();
                        vscode.window.showInformationMessage(t()['toast.newPeriod']);
                        break;
                    case 'reset':
                        orchestrator?.stop().then(() => {
                            storage?.deleteAll();
                            globalStorage?.delete();
                            statusBar?.updateTime(0, 0);
                            vscode.window.showInformationMessage(t()['toast.reset']);
                        });
                        break;
                    case 'exportCSV':
                        vscode.window.showInformationMessage('CSV 导出功能待实现');
                        break;
                }
            };

            // 设置全局面板消息处理器
            DashboardPanel.setMessageHandler(dashboardMessageHandler);

            // 面板数据同步已合并到上方 onTick 中

            // Integration 层
            lifecycleManager = new LifecycleManager(orchestrator);
            lifecycleManager.start();

            configWatcher = new ConfigWatcher(orchestrator, statusBar);
            configWatcher.start();

            // 启动计时
            orchestrator.start();

            log(LogLevel.Info,
                `WorkspaceTiming: full mode activated (${Date.now() - startTime}ms)`);

        } else {
            // ═══ 无工作区：降级模式（仅注册命令）═══
            log(LogLevel.Info, 'WorkspaceTiming: no workspace folder, running in degraded mode');
        }

        // ─── 无论有无工作区，命令必须注册 ───
        commandRegistrar = new CommandRegistrar();
        commandRegistrar.register(context, orchestrator, statusBar, null);

        // 注册订阅
        context.subscriptions.push(
            vscode.workspace.onDidChangeWorkspaceFolders(() => {
                // 工作区变化时不做特殊处理
            }),
        );

        const elapsed = Date.now() - startTime;
        log(LogLevel.Info, `WorkspaceTiming: activated in ${elapsed}ms`);

    } catch (err) {
        log(LogLevel.Error, 'WorkspaceTiming: activation failed', err as Error);
    }
}

export function deactivate(): void {
    log(LogLevel.Info, 'WorkspaceTiming: deactivating...');

    try {
        // 停止配置监听
        configWatcher?.stop();

        // 停止生命周期监听
        lifecycleManager?.stop();

        // 停止调度器
        scheduler?.stop();

        // 停止计时并存盘（同步完成）
        if (orchestrator) {
            orchestrator.stop();
        }

        // 释放命令
        commandRegistrar?.dispose();

        // 释放状态栏
        statusBar?.dispose();

    } catch (err) {
        log(LogLevel.Error, 'WorkspaceTiming: deactivation error', err as Error);
    }

    log(LogLevel.Info, 'WorkspaceTiming: deactivated');
}
