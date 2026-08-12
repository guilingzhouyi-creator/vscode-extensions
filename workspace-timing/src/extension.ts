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
import { LogLevel, setLogLevel, log, exportDiagnostics } from './integration/Logger';

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
import { ActivityTracker } from './application/ActivityTracker';
import { IdleDetector } from './application/IdleDetector';
import { CsvExporter } from './application/exporters/CsvExporter';
import { WeeklyReportExporter } from './application/exporters/WeeklyReportExporter';

// Presentation
import { StatusBarController } from './presentation/StatusBarController';
import { CommandRegistrar } from './presentation/CommandRegistrar';
import { DashboardPanel } from './presentation/DashboardPanel';
import { DashboardMessage } from './domain/dashboard-types';
import { GlobalStorageProvider } from './persistence/GlobalStorageProvider';
import { GlobalAggregator } from './application/GlobalAggregator';
import { init as initI18n, t, format } from './i18n/index';

// Integration
import { LifecycleManager } from './integration/LifecycleManager';
import { ConfigWatcher } from './integration/ConfigWatcher';

let orchestrator: TimerOrchestrator | null = null;
let statusBar: StatusBarController | null = null;
let commandRegistrar: CommandRegistrar | null = null;
let lifecycleManager: LifecycleManager | null = null;
let configWatcher: ConfigWatcher | null = null;
let scheduler: Scheduler | null = null;
let storage: StorageCoordinator | null = null;
let globalStorage: GlobalStorageProvider | null = null;
let _goalNotifiedToday = false;     // 每日目标达成仅通知一次
let _lastGoalCheckDate = '';

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
            storage = new StorageCoordinator(
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
            const activityTracker = new ActivityTracker();
            const idleDetector = new IdleDetector();
            globalStorage = new GlobalStorageProvider(context);
            const globalAggregator = new GlobalAggregator(globalStorage);
            orchestrator = new TimerOrchestrator(
                timer, storage, journal, sessionManager, disableManager, scheduler, globalAggregator, activityTracker, idleDetector,
            );

            // ★ 活动追踪 + 闲置检测 — 启动监听
            activityTracker.start();
            idleDetector.start();
            scheduler.onHeartbeat(() => {
                activityTracker.tick();
                idleDetector.tick();
            });

            // Presentation 层
            statusBar = new StatusBarController();
            statusBar.show();

            // 状态栏 + 面板 tick（今日 + 累计）
            orchestrator.onTick(({ totalMs, todayMs }) => {
                statusBar?.updateTime(todayMs, totalMs);

                // ★ 每日目标达成通知（仅一次）
                const cfg = orchestrator!.disable.config;
                if (cfg.dailyGoalMs > 0 && todayMs >= cfg.dailyGoalMs) {
                    const today = new Date().toDateString();
                    if (today !== _lastGoalCheckDate) { _lastGoalCheckDate = today; _goalNotifiedToday = false; }
                    if (!_goalNotifiedToday) {
                        _goalNotifiedToday = true;
                        const h = Math.floor(todayMs / 3600000);
                        const m = Math.floor((todayMs % 3600000) / 60000);
                        vscode.window.showInformationMessage(
                            format(t()['toast.goalReached'], String(h), String(m)));
                    }
                }

                if (DashboardPanel.currentPanel && orchestrator) {
                    orchestrator.getDashboardData().then(data => {
                        DashboardPanel.currentPanel?.updateData(data);
                    }).catch(err => {
                        // 面板更新失败不应导致扩展主机崩溃
                        log(LogLevel.Warn, 'Dashboard update failed', err as Error);
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
            const dashboardMessageHandler = (msg: DashboardMessage) => {
                switch (msg.type) {
                    case 'updateConfig':
                        orchestrator?.applyDashboardConfig(msg.payload);
                        vscode.window.showInformationMessage(t()['toast.configUpdated']);
                        break;
                    case 'newPeriod':
                        orchestrator?.newPeriod().catch(err =>
                            log(LogLevel.Error, 'newPeriod failed', err as Error)
                        );
                        vscode.window.showInformationMessage(t()['toast.newPeriod']);
                        break;
                    case 'reset':
                        orchestrator?.stop().then(() => {
                            storage?.deleteAll();
                            globalStorage?.delete();
                            statusBar?.updateTime(0, 0);
                            vscode.window.showInformationMessage(t()['toast.reset']);
                        }).catch(err =>
                            log(LogLevel.Error, 'reset failed', err as Error)
                        );
                        break;
                    case 'exportCSV':
                        (async () => {
                            if (!orchestrator) return;
                            const data = await orchestrator.getDashboardData();
                            const wsName = vscode.workspace.workspaceFolders?.[0]?.name ?? 'workspace';
                            const csv = new CsvExporter().exportDashboard(data, wsName);
                            const uri = await vscode.window.showSaveDialog({
                                defaultUri: vscode.Uri.file(`${wsName}-timing.csv`),
                                filters: { 'CSV Files': ['csv'] },
                            });
                            if (uri) {
                                await vscode.workspace.fs.writeFile(uri, Buffer.from(csv, 'utf-8'));
                                vscode.window.showInformationMessage(format(t()['toast.exported'], uri.fsPath));
                            }
                        })().catch(err => log(LogLevel.Error, 'CSV export failed', err as Error));
                        break;
                    case 'exportWeeklyReport':
                        (async () => {
                            if (!orchestrator) return;
                            const wsName = vscode.workspace.workspaceFolders?.[0]?.name ?? 'workspace';
                            const input = await orchestrator.buildWeeklyReport(wsName);
                            const md = new WeeklyReportExporter().generate(input);
                            const uri = await vscode.window.showSaveDialog({
                                defaultUri: vscode.Uri.file(`${wsName}-weekly-report.md`),
                                filters: { 'Markdown Files': ['md'] },
                            });
                            if (uri) {
                                await vscode.workspace.fs.writeFile(uri, Buffer.from(md, 'utf-8'));
                                vscode.window.showInformationMessage(format(t()['toast.exported'], uri.fsPath));
                            }
                        })().catch(err => log(LogLevel.Error, 'Weekly report export failed', err as Error));
                        break;
                    case 'exportDiagnostic':
                        (async () => {
                            if (!orchestrator) return;
                            const data = await orchestrator.getDashboardData();
                            const diags = exportDiagnostics();
                            const wsName = vscode.workspace.workspaceFolders?.[0]?.name ?? 'workspace';
                            const report = buildDiagnosticReport(data, diags, wsName);
                            const uri = await vscode.window.showSaveDialog({
                                defaultUri: vscode.Uri.file(`${wsName}-diagnostic.txt`),
                                filters: { 'Text Files': ['txt'] },
                            });
                            if (uri) {
                                await vscode.workspace.fs.writeFile(uri, Buffer.from(report, 'utf-8'));
                                vscode.window.showInformationMessage(format(t()['toast.diagnosticExported'], uri.fsPath));
                            }
                        })().catch(err => log(LogLevel.Error, 'Diagnostic export failed', err as Error));
                        break;
                    case 'langToggle':
                        DashboardPanel._useEnglish = !DashboardPanel._useEnglish;
                        DashboardPanel.currentPanel?.dispose();
                        DashboardPanel.createOrShow(context.extensionUri);
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
        commandRegistrar.register(context, orchestrator, statusBar, storage);

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

        // 停止计时并存盘（优雅落盘，必须等待完成）
        if (orchestrator) {
            orchestrator.activity.stop();
            orchestrator.idle.stop();
            // ★ 0.3.2：经 LifecycleManager.onVSCodeClose 执行 await 优雅存盘，
            //   确保扩展卸载/窗口关闭前数据落盘完成（旧实现为同步非等待，可能丢失最后一次写）。
            if (lifecycleManager) {
                await lifecycleManager.onVSCodeClose();
            } else {
                await orchestrator.stop();
            }
        }

        // 停止调度器
        scheduler?.stop();

        // 释放命令
        commandRegistrar?.dispose();

        // 释放状态栏
        statusBar?.dispose();

    } catch (err) {
        log(LogLevel.Error, 'WorkspaceTiming: deactivation error', err as Error);
    }

    log(LogLevel.Info, 'WorkspaceTiming: deactivated');
}

// ─── 诊断报告生成器 ────────────────────────────────────

import { DashboardData } from './domain/dashboard-types';
import { LogEntry } from './integration/Logger';

function buildDiagnosticReport(data: DashboardData, diags: LogEntry[], wsName: string): string {
    const lines: string[] = [];
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
        if (d.activeMs !== undefined) parts.push(`active=${d.activeMs}ms`);
        if (d.idleMs !== undefined) parts.push(`idle=${d.idleMs}ms`);
        if (d.efficiency !== undefined) parts.push(`eff=${(d.efficiency * 100).toFixed(0)}%`);
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
