/**
 * Module: CommandRegistrar — VS Code 命令注册与交互调度中心
 * File Path: src/presentation/CommandRegistrar.ts
 * Architecture Role: Presentation layer command dispatcher bridging VS Code command palette and application services
 * Dependencies & Triggers: vscode API, TimerOrchestrator, StatusBarController, GlobalAggregator, i18n subsystem; invoked during extension activate
 * Responsibilities: Register VS Code commands (enable, disable, toggleGlobal, showStatus, reset, export, newPeriod, restore); handle confirmation dialogs and file pickers; coordinate graceful command unregistration
 * Exit Semantics & Design Rationale: Encapsulates user interactions and confirmation modals while delegating actual state mutations to TimerOrchestrator; manages subscriptions for clean disposal
 */

import * as vscode from 'vscode';
import { TimerOrchestrator } from '../application/TimerOrchestrator';
import { GlobalAggregator } from '../application/GlobalAggregator';
import { StatusBarController, statusBarModeLabel } from './StatusBarController';
import { DashboardPanel } from './DashboardPanel';
import { LogLevel, log } from '../integration/logger';
import { persistTimingConfig } from '../integration/ConfigWatcher';
import { t, format } from '../i18n/index';
import { TimeAggregator } from '../domain/TimeAggregator';
import { ActivityWatcher } from '../integration/ActivityWatcher';
import { exportTimingToFile, exportAggregatedToFile } from './dashboardMessages';
import {
    TIMING_COMMAND_IDS,
    ACTIVITY_MODE_MANUAL,
    ACTIVITY_MODE_AI,
    TYPEOF_OBJECT,
    TYPEOF_NUMBER,
    DIR_DOT_VSCODE,
    FILE_TIMING_JSON,
    EXT_JSON,
    WILDCARD_STAR,
    ENCODING_UTF8,
} from '../domain/models';

const LOG_COMMANDS_REGISTERED = 'CommandRegistrar: all commands registered';
const LOG_TOGGLE_GLOBAL_PERSIST_FAILED = 'toggleGlobal persist failed';
const LOG_SHOW_STATUS_PERSIST_FAILED = 'showStatus persist failed';
const LOG_ENABLE_PERSIST_FAILED = 'enable persist failed';
const LOG_DISABLE_PERSIST_FAILED = 'disable persist failed';
const LOG_RESTORE_FAILED = 'restore failed';
const LOG_COMMAND_REGISTRAR_DISPOSED = 'CommandRegistrar: disposed';

export class CommandRegistrar {
    private readonly subscriptions: vscode.Disposable[] = [];

    register(
        context: vscode.ExtensionContext,
        orchestrator: TimerOrchestrator | null,
        statusBar: StatusBarController | null,
        globalAggregator: GlobalAggregator | null,
        activityWatcher: ActivityWatcher | null = null,
    ): void {
        this.registerSwitchCommands(orchestrator, statusBar, activityWatcher);
        this.registerDataControlCommands(orchestrator, statusBar, globalAggregator);
        this.registerViewAndExportCommands(context, orchestrator, statusBar);

        for (const d of this.subscriptions) {
            context.subscriptions.push(d);
        }

        log(LogLevel.Info, LOG_COMMANDS_REGISTERED);
    }

    private registerSwitchCommands(
        orchestrator: TimerOrchestrator | null,
        statusBar: StatusBarController | null,
        activityWatcher: ActivityWatcher | null = null,
    ): void {
        /** 注册启用计时命令契约：更新工作区配置并驱动状态机恢复就绪态 */
        this.registerCommand(TIMING_COMMAND_IDS.ENABLE, async () => {
            if (!orchestrator) { this.noWorkspaceMsg(); return; }
            orchestrator.disable.updateConfig({ enabled: true, globalDisabled: false });
            await orchestrator.onDisableStateChanged(orchestrator.disable.resolveState());
            persistTimingConfig({ enabled: true, globalDisabled: false }).catch(err =>
                log(LogLevel.Error, LOG_ENABLE_PERSIST_FAILED, err as Error)
            );
            vscode.window.showInformationMessage(t()['cmd.enabled']);
        });

        /** 注册工作区禁用计时命令契约：暂挂活动采集并持久化停用状态 */
        this.registerCommand(TIMING_COMMAND_IDS.DISABLE, async () => {
            if (!orchestrator) { this.noWorkspaceMsg(); return; }
            orchestrator.disable.updateConfig({ enabled: false });
            await orchestrator.onDisableStateChanged(orchestrator.disable.resolveState());
            persistTimingConfig({ enabled: false }).catch(err =>
                log(LogLevel.Error, LOG_DISABLE_PERSIST_FAILED, err as Error)
            );
            vscode.window.showInformationMessage(t()['cmd.disabled']);
        });

        /** 注册跨工作区全局禁用开关契约：在所有打开的窗口中全局屏蔽计时采集 */
        this.registerCommand(TIMING_COMMAND_IDS.TOGGLE_GLOBAL, async () => {
            if (!orchestrator) { this.noWorkspaceMsg(); return; }
            const current = orchestrator.disable.config.globalDisabled;
            orchestrator.disable.updateConfig({ globalDisabled: !current });
            await orchestrator.onDisableStateChanged(orchestrator.disable.resolveState());
            persistTimingConfig({ globalDisabled: !current }).catch(err =>
                log(LogLevel.Error, LOG_TOGGLE_GLOBAL_PERSIST_FAILED, err as Error)
            );

            vscode.window.showInformationMessage(
                !current ? t()['cmd.globalDisabled'] : t()['cmd.globalEnabled']);
        });

        /** 注册状态栏显示模式循环切换契约：轮转显示今日/总计/紧凑样式并落盘配置 */
        this.registerCommand(TIMING_COMMAND_IDS.SHOW_STATUS, () => {
            if (!statusBar) { this.noWorkspaceMsg(); return; }
            const nextMode = statusBar.cycleMode();
            persistTimingConfig({ statusBarMode: nextMode }).catch(err =>
                log(LogLevel.Error, LOG_SHOW_STATUS_PERSIST_FAILED, err as Error)
            );
            vscode.window.showInformationMessage(
                format(t()['cmd.modeSwitched'], statusBarModeLabel(nextMode))
            );
        });

        /** 注册活动模式轮转切换命令契约（自动 -> AI协作 -> 人工开发 -> 自动） */
        this.registerCommand(TIMING_COMMAND_IDS.TOGGLE_ACTIVITY_MODE, () => {
            if (!activityWatcher) { this.noWorkspaceMsg(); return; }
            const nextOverride = activityWatcher.toggleModeOverride();
            let label = t()['mode.label.auto'];
            if (nextOverride === ACTIVITY_MODE_AI) {
                label = t()['mode.label.ai'];
            } else if (nextOverride === ACTIVITY_MODE_MANUAL) {
                label = t()['mode.label.manual'];
            }
            vscode.window.showInformationMessage(format(t()['cmd.activityModeSwitched'], label));
        });

        /** 注册强制锁定为 AI 协作模式命令 */
        this.registerCommand(TIMING_COMMAND_IDS.SET_MODE_AI, () => {
            if (!activityWatcher) { this.noWorkspaceMsg(); return; }
            activityWatcher.setModeOverride(ACTIVITY_MODE_AI);
            vscode.window.showInformationMessage(t()['cmd.activityModeAi']);
        });

        /** 注册强制锁定为人工开发模式命令 */
        this.registerCommand(TIMING_COMMAND_IDS.SET_MODE_MANUAL, () => {
            if (!activityWatcher) { this.noWorkspaceMsg(); return; }
            activityWatcher.setModeOverride(ACTIVITY_MODE_MANUAL);
            vscode.window.showInformationMessage(t()['cmd.activityModeManual']);
        });

        /** 注册恢复自动智能感知模式命令 */
        this.registerCommand(TIMING_COMMAND_IDS.SET_MODE_AUTO, () => {
            if (!activityWatcher) { this.noWorkspaceMsg(); return; }
            activityWatcher.setModeOverride(null);
            vscode.window.showInformationMessage(t()['cmd.activityModeAuto']);
        });
    }

    private registerDataControlCommands(
        orchestrator: TimerOrchestrator | null,
        statusBar: StatusBarController | null,
        globalAggregator: GlobalAggregator | null,
    ): void {
        /** 注册立即强制存盘调试契约：绕过定时降频窗口，触发全量同步落盘 */
        this.registerCommand(TIMING_COMMAND_IDS.DEBUG_SAVE, async () => {
            if (!orchestrator) { this.noWorkspaceMsg(); return; }
            await orchestrator.saveNow();
            vscode.window.showInformationMessage(format(t()['cmd.debugSaved'], 'OK'));
        });

        /** 注册新建周期命令契约：弹出破坏性模态确认框后重置累计工时并保留历史切片 */
        this.registerCommand(TIMING_COMMAND_IDS.NEW_PERIOD, async () => {
            if (!orchestrator || !statusBar) { this.noWorkspaceMsg(); return; }
            const msg = t()['confirm.newPeriod'];
            const title = t()['confirm.newPeriod.title'];
            const confirm = await vscode.window.showWarningMessage(msg, { modal: true }, title);
            if (confirm === title) {
                await orchestrator.newPeriod();
                vscode.window.showInformationMessage(t()['toast.newPeriod']);
            }
        });

        /** 注册全量数据重置命令契约：业务编排委托 orchestrator.resetAllData 清空并重启计时 */
        this.registerCommand(TIMING_COMMAND_IDS.RESET, async () => {
            if (!orchestrator || !statusBar) { this.noWorkspaceMsg(); return; }
            const msg = t()['confirm.reset'];
            const title = t()['confirm.reset.title'];
            const confirm = await vscode.window.showWarningMessage(msg, { modal: true }, title);

            if (confirm === title) {
                await orchestrator.resetAllData();
                statusBar.updateTime(0, 0);
                vscode.window.showInformationMessage(t()['toast.reset']);
            }
        });

        /** 注册清除跨工作区累计契约：仅清理全局聚合存储，严格隔离各本地工作区数据 */
        this.registerCommand(TIMING_COMMAND_IDS.CLEAR_GLOBAL, async () => {
            if (!globalAggregator) { this.noWorkspaceMsg(); return; }
            const msg = t()['confirm.clearGlobal'];
            const title = t()['confirm.clearGlobal.title'];
            const confirm = await vscode.window.showWarningMessage(msg, { modal: true }, title);
            if (confirm === title) {
                await globalAggregator.reset();
                vscode.window.showInformationMessage(t()['toast.clearGlobal']);
            }
        });

        /** 注册清除历史明细契约：保留累计汇总指标，安全裁剪细粒度历史会话切片 */
        this.registerCommand(TIMING_COMMAND_IDS.CLEAR_HISTORY, async () => {
            if (!orchestrator || !statusBar) { this.noWorkspaceMsg(); return; }
            const msg = t()['confirm.clearHistory'];
            const title = t()['confirm.clearHistory.title'];
            const confirm = await vscode.window.showWarningMessage(msg, { modal: true }, title);
            if (confirm === title) {
                const data = await orchestrator.clearHistory();
                statusBar.updateTime(data.todayMs, data.totalMs);
                vscode.window.showInformationMessage(t()['toast.clearHistoryDone']);
            }
        });

        /** 注册从备份文件还原契约：引导用户选择历史快照并在比对后安全覆盖恢复 */
        this.registerCommand(TIMING_COMMAND_IDS.RESTORE, async () => {
            if (!orchestrator || !statusBar) { this.noWorkspaceMsg(); return; }
            await this.handleRestoreCommand(orchestrator, statusBar);
        });
    }

    private registerViewAndExportCommands(
        context: vscode.ExtensionContext,
        orchestrator: TimerOrchestrator | null,
        statusBar: StatusBarController | null,
    ): void {
        /** 注册打开可视化配置与统计仪表盘 Webview 命令契约 */
        this.registerCommand(TIMING_COMMAND_IDS.OPEN_DASHBOARD, () => {
            DashboardPanel.createOrShow(context.extensionUri);
        });

        /** 注册导出原始会话流水 CSV 报表命令契约：复用 Dashboard 管道实现异步落盘 */
        this.registerCommand(TIMING_COMMAND_IDS.EXPORT, () => {
            void exportTimingToFile({
                getOrchestrator: () => orchestrator,
                getStatusBar: () => statusBar,
                getDashboard: () => DashboardPanel.currentPanel ?? null,
            });
        });

        /** 注册导出多维聚合日报 CSV 报表命令契约：按天对工时及 AI 辅助时长汇总导出 */
        this.registerCommand(TIMING_COMMAND_IDS.EXPORT_AGGREGATED, () => {
            void exportAggregatedToFile({
                getOrchestrator: () => orchestrator,
                getStatusBar: () => statusBar,
                getDashboard: () => DashboardPanel.currentPanel ?? null,
            });
        });
    }

    private registerCommand(id: string, handler: (...args: unknown[]) => unknown): void {
        const disposable = vscode.commands.registerCommand(id, handler);
        this.subscriptions.push(disposable);
    }

    /** 降级模式提示：当前未打开工作区 */
    private noWorkspaceMsg(): void {
        vscode.window.showWarningMessage(t()['cmd.noWorkspace']);
    }

    /**
     * 处理从备份文件恢复计时数据的完整交互流程。
     * 包括：文件选择对话框、JSON 解析、双侧差异确认提示、数据应用与状态栏刷新。
     *
     * @param orchestrator - 计时总控器实例
     * @param statusBar - 状态栏控制器实例
     */
    private async handleRestoreCommand(
        orchestrator: TimerOrchestrator,
        statusBar: StatusBarController,
    ): Promise<void> {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
        if (!workspaceRoot) { this.noWorkspaceMsg(); return; }

        const defaultUri = vscode.Uri.joinPath(workspaceRoot, DIR_DOT_VSCODE, FILE_TIMING_JSON);
        const picked = await vscode.window.showOpenDialog({
            defaultUri,
            canSelectMany: false,
            filters: { [t()['export.filter.json']]: [EXT_JSON], [t()['export.filter.all']]: [WILDCARD_STAR] },
            openLabel: t()['toast.exportSaveLabel'],
        });
        if (!picked || picked.length === 0) return;

        let raw: unknown;
        try {
            const bytes = await vscode.workspace.fs.readFile(picked[0]);
            raw = JSON.parse(Buffer.from(bytes).toString(ENCODING_UTF8));
        } catch (err) {
            vscode.window.showErrorMessage(format(t()['toast.restoreFailed'], (err as Error).message));
            return;
        }

        // 双侧摘要确认（当前 vs 文件）
        const dash = await orchestrator.getDashboardData();
        const fileData = (raw && typeof raw === TYPEOF_OBJECT) ? (raw as { totalMs?: unknown; sessions?: unknown[] }) : undefined;
        const fileTotal = fileData && typeof fileData.totalMs === TYPEOF_NUMBER ? (fileData.totalMs as number) : 0;
        const fileSessions = Array.isArray(fileData?.sessions) ? fileData!.sessions!.length : 0;
        // 模板参数索引：{0}=当前累计 {1}=当前会话数 {2}=文件累计 {3}=文件会话数
        const summary = format(t()['confirm.restore'],
            TimeAggregator.formatDurationCompact(dash.totalMs), String(dash.sessionsCount),
            TimeAggregator.formatDurationCompact(fileTotal), String(fileSessions));
        const title = t()['confirm.restore.title'];
        const confirm = await vscode.window.showWarningMessage(summary, { modal: true }, title);
        if (confirm !== title) return;

        try {
            const data = await orchestrator.restoreFrom(raw);
            statusBar.updateTime(data.todayMs, data.totalMs);
            vscode.window.showInformationMessage(format(t()['toast.restored'], picked[0].fsPath));
        } catch (err) {
            log(LogLevel.Error, LOG_RESTORE_FAILED, err as Error);
            vscode.window.showErrorMessage(
                format(t()['toast.restoreFailed'], (err as Error).message));
        }
    }

    dispose(): void {
        for (const d of this.subscriptions) {
            d.dispose();
        }
        this.subscriptions.length = 0;
        log(LogLevel.Debug, LOG_COMMAND_REGISTRAR_DISPOSED);
    }
}
