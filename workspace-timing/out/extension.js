"use strict";
/**
 * WorkspaceTiming — VS Code Extension Entry
 *
 * 插件入口：activate / deactivate
 * 职责：组装所有模块，启动计时流程
 * 严格遵循"先地基后上层"原则：
 *   1. Logger → 2. Storage → 3. Cache → 4. Domain → 5. Application → 6. Presentation
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
// Domain
const TimerEngine_1 = require("./domain/TimerEngine");
const Logger_1 = require("./integration/Logger");
// Cache
const JournalWriter_1 = require("./cache/JournalWriter");
// Persistence
const WorkspaceStateProvider_1 = require("./persistence/WorkspaceStateProvider");
const FileStorageProvider_1 = require("./persistence/FileStorageProvider");
const JournalStorageProvider_1 = require("./persistence/JournalStorageProvider");
const StorageCoordinator_1 = require("./persistence/StorageCoordinator");
// Application
const TimerOrchestrator_1 = require("./application/TimerOrchestrator");
const SessionManager_1 = require("./application/SessionManager");
const DisableManager_1 = require("./application/DisableManager");
const Scheduler_1 = require("./application/Scheduler");
// Presentation
const StatusBarController_1 = require("./presentation/StatusBarController");
const CommandRegistrar_1 = require("./presentation/CommandRegistrar");
const DashboardPanel_1 = require("./presentation/DashboardPanel");
const GlobalStorageProvider_1 = require("./persistence/GlobalStorageProvider");
const GlobalAggregator_1 = require("./application/GlobalAggregator");
const index_1 = require("./i18n/index");
// Integration
const LifecycleManager_1 = require("./integration/LifecycleManager");
const ConfigWatcher_1 = require("./integration/ConfigWatcher");
let orchestrator = null;
let statusBar = null;
let commandRegistrar = null;
let lifecycleManager = null;
let configWatcher = null;
let scheduler = null;
function activate(context) {
    const startTime = Date.now();
    // 初始化 i18n
    (0, index_1.init)();
    // 设置日志等级
    (0, Logger_1.setLogLevel)(context.extensionMode === vscode.ExtensionMode.Development
        ? Logger_1.LogLevel.Debug
        : Logger_1.LogLevel.Info);
    (0, Logger_1.log)(Logger_1.LogLevel.Info, 'WorkspaceTiming: activating...');
    try {
        // ─── 获取工作区根目录 ───
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
        if (workspaceRoot) {
            // ═══ 有工作区：完整模式（计时 + 存储 + 状态栏）═══
            const timer = new TimerEngine_1.TimerEngine();
            // Persistence 层
            const workspaceStateProvider = new WorkspaceStateProvider_1.WorkspaceStateProvider(context);
            const fileStorageProvider = new FileStorageProvider_1.FileStorageProvider(workspaceRoot);
            const journalStorageProvider = new JournalStorageProvider_1.JournalStorageProvider(workspaceRoot);
            const storage = new StorageCoordinator_1.StorageCoordinator(workspaceStateProvider, fileStorageProvider, journalStorageProvider);
            // 缓存层
            const journal = new JournalWriter_1.JournalWriter(journalStorageProvider);
            // Application 层
            const disableManager = new DisableManager_1.DisableManager();
            const sessionManager = new SessionManager_1.SessionManager(timer, storage, journal);
            scheduler = new Scheduler_1.Scheduler(journal, sessionManager);
            const globalStorage = new GlobalStorageProvider_1.GlobalStorageProvider(context);
            const globalAggregator = new GlobalAggregator_1.GlobalAggregator(globalStorage);
            orchestrator = new TimerOrchestrator_1.TimerOrchestrator(timer, storage, journal, sessionManager, disableManager, scheduler, globalAggregator);
            // Presentation 层
            statusBar = new StatusBarController_1.StatusBarController();
            statusBar.show();
            // 状态栏 + 面板 tick（今日 + 累计）
            orchestrator.onTick(({ totalMs, todayMs }) => {
                statusBar?.updateTime(todayMs, totalMs);
                if (DashboardPanel_1.DashboardPanel.currentPanel && orchestrator) {
                    orchestrator.getDashboardData().then(data => {
                        DashboardPanel_1.DashboardPanel.currentPanel?.updateData(data);
                    });
                }
            });
            orchestrator.onStateChange((state) => {
                if (state === 'disabled') {
                    statusBar?.updateTime(0, 0);
                }
            });
            // Dashboard 面板消息路由
            const dashboardMessageHandler = (msg) => {
                switch (msg.type) {
                    case 'updateConfig':
                        orchestrator?.applyDashboardConfig(msg.payload);
                        vscode.window.showInformationMessage((0, index_1.t)()['toast.configUpdated']);
                        break;
                    case 'newPeriod':
                        orchestrator?.newPeriod();
                        vscode.window.showInformationMessage((0, index_1.t)()['toast.newPeriod']);
                        break;
                    case 'reset':
                        orchestrator?.stop().then(() => {
                            storage?.deleteAll();
                            globalStorage?.delete();
                            statusBar?.updateTime(0, 0);
                            vscode.window.showInformationMessage((0, index_1.t)()['toast.reset']);
                        });
                        break;
                    case 'exportCSV':
                        vscode.window.showInformationMessage('CSV 导出功能待实现');
                        break;
                }
            };
            // 设置全局面板消息处理器
            DashboardPanel_1.DashboardPanel.setMessageHandler(dashboardMessageHandler);
            // 面板数据同步已合并到上方 onTick 中
            // Integration 层
            lifecycleManager = new LifecycleManager_1.LifecycleManager(orchestrator);
            lifecycleManager.start();
            configWatcher = new ConfigWatcher_1.ConfigWatcher(orchestrator, statusBar);
            configWatcher.start();
            // 启动计时
            orchestrator.start();
            (0, Logger_1.log)(Logger_1.LogLevel.Info, `WorkspaceTiming: full mode activated (${Date.now() - startTime}ms)`);
        }
        else {
            // ═══ 无工作区：降级模式（仅注册命令）═══
            (0, Logger_1.log)(Logger_1.LogLevel.Info, 'WorkspaceTiming: no workspace folder, running in degraded mode');
        }
        // ─── 无论有无工作区，命令必须注册 ───
        commandRegistrar = new CommandRegistrar_1.CommandRegistrar();
        commandRegistrar.register(context, orchestrator, statusBar, null);
        // 注册订阅
        context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => {
            // 工作区变化时不做特殊处理
        }));
        const elapsed = Date.now() - startTime;
        (0, Logger_1.log)(Logger_1.LogLevel.Info, `WorkspaceTiming: activated in ${elapsed}ms`);
    }
    catch (err) {
        (0, Logger_1.log)(Logger_1.LogLevel.Error, 'WorkspaceTiming: activation failed', err);
    }
}
function deactivate() {
    (0, Logger_1.log)(Logger_1.LogLevel.Info, 'WorkspaceTiming: deactivating...');
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
    }
    catch (err) {
        (0, Logger_1.log)(Logger_1.LogLevel.Error, 'WorkspaceTiming: deactivation error', err);
    }
    (0, Logger_1.log)(Logger_1.LogLevel.Info, 'WorkspaceTiming: deactivated');
}
//# sourceMappingURL=extension.js.map