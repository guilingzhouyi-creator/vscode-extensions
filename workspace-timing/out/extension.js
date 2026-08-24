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
const ICacheStrategy_1 = require("./cache/ICacheStrategy");
const global_types_1 = require("./domain/global-types");
const dashboardMessages_1 = require("./presentation/dashboardMessages");
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
// 全局聚合器提升到模块级：命令注册（clearGlobal）需要在 activate 作用域之外访问。
let globalAggregatorRef = null;
/** 面板消息路由依赖（延迟解引用模块级变量，兼容无工作区降级模式） */
function getRouterContext() {
    return {
        getOrchestrator: () => orchestrator,
        getStatusBar: () => statusBar,
    };
}
function activate(context) {
    const startTime = Date.now();
    // 初始化 i18n（先按 VS Code 语言；进入完整模式后按用户 locale 配置覆盖）
    (0, index_1.init)(undefined, vscode.env.language);
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
            // 读取用户配置（复用 ConfigWatcher 的 readTimingConfig，保证初始化/运行期配置同源）
            const cfg = (0, ConfigWatcher_1.readTimingConfig)();
            // 按配置覆盖语言（auto=跟随 VS Code 显示语言）
            (0, index_1.init)(cfg.locale, vscode.env.language);
            // Persistence 层
            const workspaceStateProvider = new WorkspaceStateProvider_1.WorkspaceStateProvider(context);
            const fileStorageProvider = new FileStorageProvider_1.FileStorageProvider(workspaceRoot);
            const journalStorageProvider = new JournalStorageProvider_1.JournalStorageProvider(workspaceRoot);
            const storage = new StorageCoordinator_1.StorageCoordinator(workspaceStateProvider, fileStorageProvider, journalStorageProvider);
            // 缓存层：capacity 与 flush 策略从配置读取（此前被忽略，形同虚设）
            const journal = new JournalWriter_1.JournalWriter(journalStorageProvider, cfg.ringBufferCapacity, new ICacheStrategy_1.TimeBasedCacheStrategy(cfg.journalFlushIntervalMs));
            // Application 层
            const disableManager = new DisableManager_1.DisableManager(cfg);
            const sessionManager = new SessionManager_1.SessionManager(timer, storage, journal, cfg.maxSessions);
            scheduler = new Scheduler_1.Scheduler(journal, sessionManager, {
                journalFlushIntervalMs: cfg.journalFlushIntervalMs,
                fullSaveIntervalMs: cfg.fullSaveIntervalMs,
                journalEnabled: cfg.journalEnabled ?? true,
            });
            const globalStorage = new GlobalStorageProvider_1.GlobalStorageProvider(context);
            // 工作区信息经解析器注入（依赖倒置）：GlobalAggregator 不再直连 vscode API
            const globalAggregator = new GlobalAggregator_1.GlobalAggregator(globalStorage, () => {
                const root = vscode.workspace.workspaceFolders?.[0];
                if (!root)
                    return undefined;
                return {
                    id: (0, global_types_1.normalizeWorkspaceId)(root.uri.toString()),
                    name: root.name,
                    uri: root.uri.toString(),
                };
            });
            globalAggregatorRef = globalAggregator;
            orchestrator = new TimerOrchestrator_1.TimerOrchestrator(timer, storage, journal, sessionManager, disableManager, scheduler, globalAggregator);
            // Presentation 层
            statusBar = new StatusBarController_1.StatusBarController();
            statusBar.show();
            // 状态栏 + 面板 tick（今日 + 累计）
            // 面板数据刷新节流：状态栏每秒更新，但 getDashboardData() 含全量 sessions 聚合（O(N)），
            // 面板不可见/无面板时跳过，且每秒刷新会造成 CPU/内存压力。面板数据降为每 5 秒刷新。
            let lastPanelUpdateMs = 0;
            const PANEL_REFRESH_INTERVAL_MS = 5000;
            orchestrator.onTick(({ totalMs, todayMs }) => {
                statusBar?.updateTime(todayMs, totalMs);
                const now = Date.now();
                if (DashboardPanel_1.DashboardPanel.currentPanel && orchestrator
                    && now - lastPanelUpdateMs >= PANEL_REFRESH_INTERVAL_MS) {
                    lastPanelUpdateMs = now;
                    orchestrator.getDashboardData().then(data => {
                        DashboardPanel_1.DashboardPanel.currentPanel?.updateData(data);
                    }).catch(err => {
                        // 面板更新失败不应导致扩展主机崩溃（未处理的 Promise 拒绝）
                        (0, Logger_1.log)(Logger_1.LogLevel.Warn, 'Dashboard update failed', err);
                    });
                }
            });
            orchestrator.onStateChange((state) => {
                if (state === 'disabled') {
                    statusBar?.updateTime(0, 0);
                }
            });
            // Dashboard 面板消息路由（分发逻辑见 presentation/dashboardMessages.ts）
            DashboardPanel_1.DashboardPanel.setMessageHandler((0, dashboardMessages_1.createDashboardMessageHandler)(getRouterContext()));
            // Integration 层
            lifecycleManager = new LifecycleManager_1.LifecycleManager(orchestrator);
            lifecycleManager.start();
            configWatcher = new ConfigWatcher_1.ConfigWatcher(orchestrator, statusBar, context.extensionUri);
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
        // 修复：此前此处传入 null，导致 reset 命令永远命中"无工作区"守卫而失效。
        // globalAggregatorRef 传入：命令面板 reset/clearGlobal 与面板 reset 语义对齐（都清全局聚合）。
        commandRegistrar.register(context, orchestrator, statusBar, globalAggregatorRef);
        // 导出命令：可从命令面板触发，与 Dashboard 导出按钮共用逻辑
        context.subscriptions.push(vscode.commands.registerCommand('workspaceTiming.export', () => {
            void (0, dashboardMessages_1.exportTimingToFile)(getRouterContext());
        }));
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
async function deactivate() {
    (0, Logger_1.log)(Logger_1.LogLevel.Info, 'WorkspaceTiming: deactivating...');
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
        DashboardPanel_1.DashboardPanel.disposeCurrent();
        DashboardPanel_1.DashboardPanel.setMessageHandler(null);
    }
    catch (err) {
        (0, Logger_1.log)(Logger_1.LogLevel.Error, 'WorkspaceTiming: deactivation error', err);
    }
    (0, Logger_1.log)(Logger_1.LogLevel.Info, 'WorkspaceTiming: deactivated');
}
//# sourceMappingURL=extension.js.map