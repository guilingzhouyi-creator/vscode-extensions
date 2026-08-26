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
import { GlobalStorageProvider } from './persistence/GlobalStorageProvider';
import { GlobalAggregator } from './application/GlobalAggregator';
import { TimeBasedCacheStrategy } from './cache/ICacheStrategy';
import { normalizeWorkspaceId } from './domain/global-types';
import {
    createDashboardMessageHandler,
    exportTimingToFile,
    MessageRouterContext,
} from './presentation/dashboardMessages';
import { init as initI18n } from './i18n/index';

// Integration
import { LifecycleManager } from './integration/LifecycleManager';
import { ConfigWatcher, readTimingConfig } from './integration/ConfigWatcher';

let orchestrator: TimerOrchestrator | null = null;
let statusBar: StatusBarController | null = null;
let commandRegistrar: CommandRegistrar | null = null;
let lifecycleManager: LifecycleManager | null = null;
let configWatcher: ConfigWatcher | null = null;
let scheduler: Scheduler | null = null;
// 全局聚合器提升到模块级：命令注册（clearGlobal）需要在 activate 作用域之外访问。
let globalAggregatorRef: GlobalAggregator | null = null;

/** 面板消息路由依赖（延迟解引用模块级变量，兼容无工作区降级模式） */
function getRouterContext(): MessageRouterContext {
    return {
        getOrchestrator: () => orchestrator,
        getStatusBar: () => statusBar,
        getDashboard: () => DashboardPanel.currentPanel ?? null,
    };
}

export function activate(context: vscode.ExtensionContext): void {
    const startTime = Date.now();

    // 初始化 i18n（先按 VS Code 语言；进入完整模式后按用户 locale 配置覆盖）
    initI18n(undefined, vscode.env.language);

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
            // 按配置覆盖语言（auto=跟随 VS Code 显示语言）
            initI18n(cfg.locale, vscode.env.language);

            // Persistence 层
            const workspaceStateProvider = new WorkspaceStateProvider(context);
            const fileStorageProvider = new FileStorageProvider(workspaceRoot);
            const journalStorageProvider = new JournalStorageProvider(workspaceRoot);
            const storage = new StorageCoordinator(
                workspaceStateProvider,
                fileStorageProvider,
                journalStorageProvider,
            );
            // 缓存层：capacity 与 flush 策略从配置读取（此前被忽略，形同虚设）
            const journal = new JournalWriter(
                journalStorageProvider,
                cfg.ringBufferCapacity,
                new TimeBasedCacheStrategy(cfg.journalFlushIntervalMs),
            );

            // Application 层
            const disableManager = new DisableManager(cfg);
            const sessionManager = new SessionManager(timer, storage, journal, cfg.maxSessions, cfg.historyRawRetentionDays);
            scheduler = new Scheduler(journal, sessionManager, {
                journalFlushIntervalMs: cfg.journalFlushIntervalMs,
                fullSaveIntervalMs: cfg.fullSaveIntervalMs,
                journalEnabled: cfg.journalEnabled ?? true,
            });
            const globalStorage = new GlobalStorageProvider(context);
            // 工作区信息经解析器注入（依赖倒置）：GlobalAggregator 不再直连 vscode API
            const globalAggregator = new GlobalAggregator(globalStorage, () => {
                const root = vscode.workspace.workspaceFolders?.[0];
                if (!root) return undefined;
                return {
                    id: normalizeWorkspaceId(root.uri.toString()),
                    name: root.name,
                    uri: root.uri.toString(),
                };
            });
            globalAggregatorRef = globalAggregator;
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
                // 面板必须存在且可见才聚合：隐藏面板的 updateData 本就空转，聚合纯属浪费
                if (DashboardPanel.currentPanel?.isVisible && orchestrator
                    && now - lastPanelUpdateMs >= PANEL_REFRESH_INTERVAL_MS) {
                    lastPanelUpdateMs = now;
                    orchestrator.getDashboardData().then(data => {
                        DashboardPanel.currentPanel?.updateData(data);
                    }).catch(err => {
                        // 面板更新失败不应导致扩展主机崩溃（未处理的 Promise 拒绝）
                        log(LogLevel.Warn, 'Dashboard update failed', err as Error);
                    });
                }
            });
            orchestrator.onStateChange((state) => {
                if (state === 'disabled') {
                    statusBar?.updateTime(0, 0);
                }
            });

            // Dashboard 面板消息路由（分发逻辑见 presentation/dashboardMessages.ts）
            DashboardPanel.setMessageHandler(createDashboardMessageHandler(getRouterContext()));

            // Integration 层
            lifecycleManager = new LifecycleManager(orchestrator);
            lifecycleManager.start();

            configWatcher = new ConfigWatcher(orchestrator, statusBar, context.extensionUri);
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
        // globalAggregatorRef 传入：命令面板 reset/clearGlobal 与面板 reset 语义对齐（都清全局聚合）。
        commandRegistrar.register(context, orchestrator, statusBar, globalAggregatorRef);

        // 导出命令：可从命令面板触发，与 Dashboard 导出按钮共用逻辑
        context.subscriptions.push(
            vscode.commands.registerCommand('workspaceTiming.export', () => {
                void exportTimingToFile(getRouterContext());
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
