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
const ActivityTracker_1 = require("./application/ActivityTracker");
const IdleDetector_1 = require("./application/IdleDetector");
const CsvExporter_1 = require("./application/exporters/CsvExporter");
const WeeklyReportExporter_1 = require("./application/exporters/WeeklyReportExporter");
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
let storage = null;
let globalStorage = null;
let _goalNotifiedToday = false; // 每日目标达成仅通知一次
let _lastGoalCheckDate = '';
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
            storage = new StorageCoordinator_1.StorageCoordinator(workspaceStateProvider, fileStorageProvider, journalStorageProvider);
            // 缓存层
            const journal = new JournalWriter_1.JournalWriter(journalStorageProvider);
            // Application 层
            const disableManager = new DisableManager_1.DisableManager();
            const sessionManager = new SessionManager_1.SessionManager(timer, storage, journal);
            scheduler = new Scheduler_1.Scheduler(journal, sessionManager);
            const activityTracker = new ActivityTracker_1.ActivityTracker();
            const idleDetector = new IdleDetector_1.IdleDetector();
            globalStorage = new GlobalStorageProvider_1.GlobalStorageProvider(context);
            const globalAggregator = new GlobalAggregator_1.GlobalAggregator(globalStorage);
            void globalAggregator.snapshot(); // 预热全局缓存：面板首次打开即有跨工作区数据，且免去首帧 async 等待
            orchestrator = new TimerOrchestrator_1.TimerOrchestrator(timer, storage, journal, sessionManager, disableManager, scheduler, globalAggregator, activityTracker, idleDetector);
            // ★ 活动追踪 + 闲置检测 — 启动监听
            activityTracker.start();
            idleDetector.start();
            scheduler.onHeartbeat(() => {
                activityTracker.tick();
                idleDetector.tick();
            });
            // Presentation 层
            statusBar = new StatusBarController_1.StatusBarController();
            statusBar.show();
            // 状态栏 + 面板 tick（今日 + 累计）
            orchestrator.onTick(({ totalMs, todayMs }) => {
                statusBar?.updateTime(todayMs, totalMs);
                // ★ 每日目标达成通知（仅一次）
                const cfg = orchestrator.disable.config;
                if (cfg.dailyGoalMs > 0 && todayMs >= cfg.dailyGoalMs) {
                    const today = new Date().toDateString();
                    if (today !== _lastGoalCheckDate) {
                        _lastGoalCheckDate = today;
                        _goalNotifiedToday = false;
                    }
                    if (!_goalNotifiedToday) {
                        _goalNotifiedToday = true;
                        const h = Math.floor(todayMs / 3600000);
                        const m = Math.floor((todayMs % 3600000) / 60000);
                        vscode.window.showInformationMessage((0, index_1.format)((0, index_1.t)()['toast.goalReached'], String(h), String(m)));
                    }
                }
                if (DashboardPanel_1.DashboardPanel.currentPanel && orchestrator) {
                    orchestrator.getDashboardData().then(data => {
                        DashboardPanel_1.DashboardPanel.currentPanel?.updateData(data);
                    }).catch(err => {
                        // 面板更新失败不应导致扩展主机崩溃
                        (0, Logger_1.log)(Logger_1.LogLevel.Warn, 'Dashboard update failed', err);
                    });
                }
            });
            orchestrator.onStateChange((state) => {
                if (state === 'disabled') {
                    statusBar?.updateTime(0, 0);
                }
            });
            // ★ 每次全量存盘后同步跨工作区全局累计
            scheduler.onFullSave(async () => {
                const snap = orchestrator?.session.snapshot;
                if (snap) {
                    await globalAggregator.sync(snap.currentTotalMs);
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
                        orchestrator?.newPeriod().catch(err => (0, Logger_1.log)(Logger_1.LogLevel.Error, 'newPeriod failed', err));
                        vscode.window.showInformationMessage((0, index_1.t)()['toast.newPeriod']);
                        break;
                    case 'reset':
                        orchestrator?.stop().then(() => {
                            storage?.deleteAll();
                            globalStorage?.delete();
                            statusBar?.updateTime(0, 0);
                            vscode.window.showInformationMessage((0, index_1.t)()['toast.reset']);
                        }).catch(err => (0, Logger_1.log)(Logger_1.LogLevel.Error, 'reset failed', err));
                        break;
                    case 'exportCSV':
                        (async () => {
                            if (!orchestrator)
                                return;
                            const data = await orchestrator.getDashboardData();
                            const wsName = vscode.workspace.workspaceFolders?.[0]?.name ?? 'workspace';
                            const csv = new CsvExporter_1.CsvExporter().exportDashboard(data, wsName);
                            const uri = await vscode.window.showSaveDialog({
                                defaultUri: vscode.Uri.file(`${wsName}-timing.csv`),
                                filters: { 'CSV Files': ['csv'] },
                            });
                            if (uri) {
                                await vscode.workspace.fs.writeFile(uri, Buffer.from(csv, 'utf-8'));
                                vscode.window.showInformationMessage((0, index_1.format)((0, index_1.t)()['toast.exported'], uri.fsPath));
                            }
                        })().catch(err => (0, Logger_1.log)(Logger_1.LogLevel.Error, 'CSV export failed', err));
                        break;
                    case 'exportWeeklyReport':
                        (async () => {
                            if (!orchestrator)
                                return;
                            const wsName = vscode.workspace.workspaceFolders?.[0]?.name ?? 'workspace';
                            const input = await orchestrator.buildWeeklyReport(wsName);
                            const md = new WeeklyReportExporter_1.WeeklyReportExporter().generate(input);
                            const uri = await vscode.window.showSaveDialog({
                                defaultUri: vscode.Uri.file(`${wsName}-weekly-report.md`),
                                filters: { 'Markdown Files': ['md'] },
                            });
                            if (uri) {
                                await vscode.workspace.fs.writeFile(uri, Buffer.from(md, 'utf-8'));
                                vscode.window.showInformationMessage((0, index_1.format)((0, index_1.t)()['toast.exported'], uri.fsPath));
                            }
                        })().catch(err => (0, Logger_1.log)(Logger_1.LogLevel.Error, 'Weekly report export failed', err));
                        break;
                    case 'exportDiagnostic':
                        (async () => {
                            if (!orchestrator)
                                return;
                            const data = await orchestrator.getDashboardData();
                            const diags = (0, Logger_1.exportDiagnostics)();
                            const wsName = vscode.workspace.workspaceFolders?.[0]?.name ?? 'workspace';
                            const report = buildDiagnosticReport(data, diags, wsName);
                            const uri = await vscode.window.showSaveDialog({
                                defaultUri: vscode.Uri.file(`${wsName}-diagnostic.txt`),
                                filters: { 'Text Files': ['txt'] },
                            });
                            if (uri) {
                                await vscode.workspace.fs.writeFile(uri, Buffer.from(report, 'utf-8'));
                                vscode.window.showInformationMessage((0, index_1.format)((0, index_1.t)()['toast.diagnosticExported'], uri.fsPath));
                            }
                        })().catch(err => (0, Logger_1.log)(Logger_1.LogLevel.Error, 'Diagnostic export failed', err));
                        break;
                    case 'langToggle':
                        DashboardPanel_1.DashboardPanel._useEnglish = !DashboardPanel_1.DashboardPanel._useEnglish;
                        DashboardPanel_1.DashboardPanel.currentPanel?.dispose();
                        DashboardPanel_1.DashboardPanel.createOrShow(context.extensionUri);
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
        commandRegistrar.register(context, orchestrator, statusBar, storage);
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
        // 停止计时并存盘（优雅落盘，必须等待完成）
        if (orchestrator) {
            orchestrator.activity.stop();
            orchestrator.idle.stop();
            // ★ 0.3.2：经 LifecycleManager.onVSCodeClose 执行 await 优雅存盘，
            //   确保扩展卸载/窗口关闭前数据落盘完成（旧实现为同步非等待，可能丢失最后一次写）。
            if (lifecycleManager) {
                await lifecycleManager.onVSCodeClose();
            }
            else {
                await orchestrator.stop();
            }
        }
        // 停止调度器
        scheduler?.stop();
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
function buildDiagnosticReport(data, diags, wsName) {
    const lines = [];
    const now = new Date().toISOString();
    lines.push('========================================');
    lines.push('Workspace Timing — Diagnostic Report');
    lines.push('========================================');
    lines.push(`Generated: ${now}`);
    lines.push(`Workspace: ${wsName}`);
    lines.push(`Extension Version: 0.3.0`);
    lines.push('');
    lines.push('--- Config ---');
    lines.push(`Enabled: ${data.isEnabled}`);
    lines.push(`Global Disabled: ${data.globalDisabled}`);
    lines.push(`Status Bar: ${data.statusBarEnabled}`);
    lines.push(`Efficiency Tracking: ${data.efficiencyEnabled}`);
    lines.push(`Journal Enabled: ${data.journalEnabled}`);
    lines.push(`Backup to File: ${data.backupToFile}`);
    lines.push(`Ring Buffer Cap: ${data.ringBufferCapacity}`);
    lines.push(`Journal Flush: ${data.journalFlushIntervalMs}ms`);
    lines.push(`Full Save: ${data.fullSaveIntervalMs}ms`);
    lines.push(`Max Sessions: ${data.maxSessions}`);
    lines.push('');
    lines.push('--- Stats ---');
    lines.push(`Total: ${data.totalMs}ms (${Math.floor(data.totalMs / 3600000)}h ${Math.floor((data.totalMs % 3600000) / 60000)}m)`);
    lines.push(`Today: ${data.todayMs}ms`);
    lines.push(`Week Total: ${data.weekTotalMs}ms`);
    lines.push(`Sessions: ${data.sessionsCount}`);
    lines.push(`Global Total: ${data.globalTotalMs}ms (${data.workspaceCount} workspaces)`);
    if (data.weekEfficiency !== undefined) {
        lines.push(`Week Efficiency: ${(data.weekEfficiency * 100).toFixed(1)}%`);
    }
    lines.push('');
    lines.push('--- Daily Breakdown ---');
    for (const d of data.dailyStats) {
        const parts = [`${d.label}(${d.weekday})`, `total=${d.totalMs}ms`];
        if (d.activeMs !== undefined)
            parts.push(`active=${d.activeMs}ms`);
        if (d.idleMs !== undefined)
            parts.push(`idle=${d.idleMs}ms`);
        if (d.efficiency !== undefined)
            parts.push(`eff=${(d.efficiency * 100).toFixed(0)}%`);
        lines.push(parts.join(' '));
    }
    lines.push('');
    lines.push('--- Recent Logs (last 200) ---');
    const levelNames = ['DEBUG', 'INFO', 'WARN', 'ERROR'];
    for (const entry of diags) {
        const ts = new Date(entry.timestamp).toISOString();
        lines.push(`[${levelNames[entry.level] ?? '?'}][${ts}] ${entry.message}`);
        if (entry.stack) {
            lines.push(`  Stack: ${entry.stack.split('\n').slice(0, 3).join('\n  ')}`);
        }
    }
    return lines.join('\n');
}
//# sourceMappingURL=extension.js.map