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
import { TimeBasedCacheStrategy } from './cache/ICacheStrategy';
import { init as initI18n, t, format } from './i18n/index';

// Integration
import { LifecycleManager } from './integration/LifecycleManager';
import { ConfigWatcher, readTimingConfig } from './integration/ConfigWatcher';

let orchestrator: TimerOrchestrator | null = null;
let statusBar: StatusBarController | null = null;
let commandRegistrar: CommandRegistrar | null = null;
let lifecycleManager: LifecycleManager | null = null;
let configWatcher: ConfigWatcher | null = null;
let scheduler: Scheduler | null = null;
// 存储引用提升到模块级：命令注册（如 reset）与面板消息处理都需要在
// activate 作用域之外访问；此前作为块级局部变量传出 null 导致命令失效。
let storageRef: StorageCoordinator | null = null;
let globalStorageRef: GlobalStorageProvider | null = null;

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

            // 读取用户配置（复用 ConfigWatcher 的 readTimingConfig，保证初始化/运行期配置同源）
            const cfg = readTimingConfig();

            // Persistence 层
            const workspaceStateProvider = new WorkspaceStateProvider(context);
            const fileStorageProvider = new FileStorageProvider(workspaceRoot);
            const journalStorageProvider = new JournalStorageProvider(workspaceRoot);
            storageRef = new StorageCoordinator(
                workspaceStateProvider,
                fileStorageProvider,
                journalStorageProvider,
            );
            const storage = storageRef;

            // 缓存层：capacity 与 flush 策略从配置读取（此前被忽略，形同虚设）
            const journal = new JournalWriter(
                journalStorageProvider,
                cfg.ringBufferCapacity,
                new TimeBasedCacheStrategy(cfg.journalFlushIntervalMs),
            );

            // Application 层
            const disableManager = new DisableManager(cfg);
            const sessionManager = new SessionManager(timer, storage, journal, cfg.maxSessions);
            scheduler = new Scheduler(journal, sessionManager, {
                journalFlushIntervalMs: cfg.journalFlushIntervalMs,
                fullSaveIntervalMs: cfg.fullSaveIntervalMs,
                journalEnabled: cfg.journalEnabled ?? true,
            });
            const globalStorage = new GlobalStorageProvider(context);
            globalStorageRef = globalStorage;
            const globalAggregator = new GlobalAggregator(globalStorage);
            orchestrator = new TimerOrchestrator(
                timer, storage, journal, sessionManager, disableManager, scheduler, globalAggregator,
            );

            // Presentation 层
            statusBar = new StatusBarController();
            statusBar.show();

            // 状态栏 + 面板 tick（今日 + 累计）
            // 面板数据刷新节流：状态栏每秒更新，但 getDashboardData() 含全量 sessions 聚合（O(N)），
            // 面板不可见/无面板时跳过，且每秒刷新会造成 CPU/内存压力。面板数据降为每 5 秒刷新。
            let lastPanelUpdateMs = 0;
            const PANEL_REFRESH_INTERVAL_MS = 5000;
            orchestrator.onTick(({ totalMs, todayMs }) => {
                statusBar?.updateTime(todayMs, totalMs);
                const now = Date.now();
                if (DashboardPanel.currentPanel && orchestrator
                    && now - lastPanelUpdateMs >= PANEL_REFRESH_INTERVAL_MS) {
                    lastPanelUpdateMs = now;
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
                            storageRef?.deleteAll();
                            globalStorageRef?.delete();
                            statusBar?.updateTime(0, 0);
                            vscode.window.showInformationMessage(t()['toast.reset']);
                        });
                        break;
                    case 'exportCSV':
                        exportTimingToFile();
                        break;
                    case 'exportReport':
                        exportReportToFile(msg.payload.kind);
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
        // 修复：此前此处传入 null，导致 reset 命令永远命中"无工作区"守卫而失效。
        commandRegistrar.register(context, orchestrator, statusBar, storageRef);

        // 导出命令：可从命令面板触发，与 Dashboard 导出按钮共用逻辑
        context.subscriptions.push(
            vscode.commands.registerCommand('workspaceTiming.export', () => {
                exportTimingToFile();
            }),
        );

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

export async function deactivate(): Promise<void> {
    log(LogLevel.Info, 'WorkspaceTiming: deactivating...');

    try {
        // 停止配置监听
        configWatcher?.stop();

        // 停止生命周期监听
        lifecycleManager?.stop();

        // 停止调度器（同步清理定时器）
        scheduler?.stop();

        // 停止计时并存盘（await 确保数据完整落盘，避免扩展卸载时丢数据）
        if (orchestrator) {
            await orchestrator.stop();
        }

        // 释放命令
        commandRegistrar?.dispose();

        // 释放状态栏
        statusBar?.dispose();

        // 关闭 Dashboard 面板并清除全局消息处理器（释放闭包引用，防泄漏）
        DashboardPanel.disposeCurrent();
        DashboardPanel.setMessageHandler(null);

    } catch (err) {
        log(LogLevel.Error, 'WorkspaceTiming: deactivation error', err as Error);
    }

    log(LogLevel.Info, 'WorkspaceTiming: deactivated');
}

/**
 * 将当前工作区计时数据导出为 CSV 文件
 * 供 Dashboard 导出按钮与 workspaceTiming.export 命令共用。
 */
async function exportTimingToFile(): Promise<void> {
    try {
        if (!orchestrator) {
            vscode.window.showWarningMessage(t()['toast.exportNoWorkspace']);
            return;
        }

        // 获取工作区名称
        const workspaceName = vscode.workspace.workspaceFolders?.[0]?.name ?? 'workspace';

        // 用户选择保存路径（默认 .csv）
        const defaultUri = vscode.Uri.file(
            `${workspaceName}-timing-${new Date().toISOString().slice(0, 10)}.csv`,
        );
        const uri = await vscode.window.showSaveDialog({
            defaultUri,
            filters: { 'CSV 文件 (*.csv)': ['csv'] },
            saveLabel: t()['toast.exportSaveLabel'],
        });

        if (!uri) {
            // 用户取消
            vscode.window.showInformationMessage(t()['toast.exportCancelled']);
            return;
        }

        const csv = await orchestrator.exportCSV(workspaceName);
        await vscode.workspace.fs.writeFile(uri, Buffer.from(csv, 'utf8'));

        vscode.window.showInformationMessage(
            format(t()['toast.exportSuccess'], uri.fsPath),
        );
    } catch (err) {
        log(LogLevel.Error, 'WorkspaceTiming: export CSV failed', err as Error);
        vscode.window.showErrorMessage(t()['toast.exportFailed']);
    }
}

/**
 * 将日报 / 周报导出为 Markdown 文件
 * 供 Dashboard 导出按钮与命令面板触发。
 */
async function exportReportToFile(kind: 'daily' | 'weekly'): Promise<void> {
    try {
        if (!orchestrator) {
            vscode.window.showWarningMessage(t()['toast.exportNoWorkspace']);
            return;
        }

        const workspaceName = vscode.workspace.workspaceFolders?.[0]?.name ?? 'workspace';
        const today = new Date().toISOString().slice(0, 10);
        const prefix = kind === 'daily' ? '日报' : '周报';
        const defaultUri = vscode.Uri.file(
            `${workspaceName}-${prefix}-${today}.md`,
        );

        const uri = await vscode.window.showSaveDialog({
            defaultUri,
            filters: { 'Markdown 文件 (*.md)': ['md'] },
            saveLabel: t()['toast.exportSaveLabel'],
        });

        if (!uri) {
            vscode.window.showInformationMessage(t()['toast.exportCancelled']);
            return;
        }

        const md = await orchestrator.exportReport(kind);
        await vscode.workspace.fs.writeFile(uri, Buffer.from(md, 'utf8'));

        const key = kind === 'daily' ? 'toast.exportReportDaily' : 'toast.exportReportWeekly';
        vscode.window.showInformationMessage(
            format(t()[key], uri.fsPath),
        );
    } catch (err) {
        log(LogLevel.Error, 'WorkspaceTiming: export report failed', err as Error);
        vscode.window.showErrorMessage(t()['toast.exportFailed']);
    }
}
