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
import { LogLevel, log } from '../integration/Logger';
import { persistTimingConfig } from '../integration/ConfigWatcher';
import { t, format } from '../i18n/index';
import { TimeAggregator } from '../domain/TimeAggregator';
import { exportTimingToFile, exportAggregatedToFile } from './dashboardMessages';

export class CommandRegistrar {
    private readonly subscriptions: vscode.Disposable[] = [];

    register(
        context: vscode.ExtensionContext,
        orchestrator: TimerOrchestrator | null,
        statusBar: StatusBarController | null,
        globalAggregator: GlobalAggregator | null,
    ): void {
        this.registerSwitchCommands(orchestrator, statusBar);
        this.registerDataControlCommands(orchestrator, statusBar, globalAggregator);
        this.registerViewAndExportCommands(context, orchestrator, statusBar);

        for (const d of this.subscriptions) {
            context.subscriptions.push(d);
        }

        log(LogLevel.Info, 'CommandRegistrar: all commands registered');
    }

    private registerSwitchCommands(
        orchestrator: TimerOrchestrator | null,
        statusBar: StatusBarController | null,
    ): void {
        /** 注册启用计时命令契约：更新工作区配置并驱动状态机恢复就绪态 */
        this.registerCommand('workspaceTiming.enable', async () => {
            if (!orchestrator) { this.noWorkspaceMsg(); return; }
            orchestrator.disable.updateConfig({ enabled: true, globalDisabled: false });
            await orchestrator.onDisableStateChanged(orchestrator.disable.resolveState());
            persistTimingConfig({ enabled: true, globalDisabled: false }).catch(err =>
                log(LogLevel.Error, 'enable persist failed', err as Error)
            );
            vscode.window.showInformationMessage(t()['cmd.enabled']);
        });

        /** 注册工作区禁用计时命令契约：暂挂活动采集并持久化停用状态 */
        this.registerCommand('workspaceTiming.disable', async () => {
            if (!orchestrator) { this.noWorkspaceMsg(); return; }
            orchestrator.disable.updateConfig({ enabled: false });
            await orchestrator.onDisableStateChanged(orchestrator.disable.resolveState());
            persistTimingConfig({ enabled: false }).catch(err =>
                log(LogLevel.Error, 'disable persist failed', err as Error)
            );
            vscode.window.showInformationMessage(t()['cmd.disabled']);
        });

        /** 注册跨工作区全局禁用开关契约：在所有打开的窗口中全局屏蔽计时采集 */
        this.registerCommand('workspaceTiming.toggleGlobal', async () => {
            if (!orchestrator) { this.noWorkspaceMsg(); return; }
            const current = orchestrator.disable.config.globalDisabled;
            orchestrator.disable.updateConfig({ globalDisabled: !current });
            await orchestrator.onDisableStateChanged(orchestrator.disable.resolveState());
            persistTimingConfig({ globalDisabled: !current }).catch(err =>
                log(LogLevel.Error, 'toggleGlobal persist failed', err as Error)
            );

            vscode.window.showInformationMessage(
                !current ? t()['cmd.globalDisabled'] : t()['cmd.globalEnabled']);
        });

        /** 注册状态栏显示模式循环切换契约：轮转显示今日/总计/紧凑样式并落盘配置 */
        this.registerCommand('workspaceTiming.showStatus', () => {
            if (!statusBar) { this.noWorkspaceMsg(); return; }
            const nextMode = statusBar.cycleMode();
            persistTimingConfig({ statusBarMode: nextMode }).catch(err =>
                log(LogLevel.Error, 'showStatus persist failed', err as Error)
            );
            vscode.window.showInformationMessage(
                format(t()['cmd.modeSwitched'], statusBarModeLabel(nextMode))
            );
        });
    }

    private registerDataControlCommands(
        orchestrator: TimerOrchestrator | null,
        statusBar: StatusBarController | null,
        globalAggregator: GlobalAggregator | null,
    ): void {
        /** 注册立即强制存盘调试契约：绕过定时降频窗口，触发全量同步落盘 */
        this.registerCommand('workspaceTiming.debugSave', async () => {
            if (!orchestrator) { this.noWorkspaceMsg(); return; }
            await orchestrator.saveNow();
            vscode.window.showInformationMessage(format(t()['cmd.debugSaved'], 'OK'));
        });

        /** 注册新建周期命令契约：弹出破坏性模态确认框后重置累计工时并保留历史切片 */
        this.registerCommand('workspaceTiming.newPeriod', async () => {
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
        this.registerCommand('workspaceTiming.reset', async () => {
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
        this.registerCommand('workspaceTiming.clearGlobal', async () => {
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
        this.registerCommand('workspaceTiming.clearHistory', async () => {
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
        this.registerCommand('workspaceTiming.restore', async () => {
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
        this.registerCommand('workspaceTiming.openDashboard', () => {
            DashboardPanel.createOrShow(context.extensionUri);
        });

        /** 注册导出原始会话流水 CSV 报表命令契约：复用 Dashboard 管道实现异步落盘 */
        this.registerCommand('workspaceTiming.export', () => {
            void exportTimingToFile({
                getOrchestrator: () => orchestrator,
                getStatusBar: () => statusBar,
                getDashboard: () => DashboardPanel.currentPanel ?? null,
            });
        });

        /** 注册导出多维聚合日报 CSV 报表命令契约：按天对工时及 AI 辅助时长汇总导出 */
        this.registerCommand('workspaceTiming.exportAggregated', () => {
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

        const defaultUri = vscode.Uri.joinPath(workspaceRoot, '.vscode', 'workspace-timing.json');
        const picked = await vscode.window.showOpenDialog({
            defaultUri,
            canSelectMany: false,
            filters: { [t()['export.filter.json']]: ['json'], [t()['export.filter.all']]: ['*'] },
            openLabel: t()['toast.exportSaveLabel'],
        });
        if (!picked || picked.length === 0) return;

        let raw: unknown;
        try {
            const bytes = await vscode.workspace.fs.readFile(picked[0]);
            raw = JSON.parse(Buffer.from(bytes).toString('utf-8'));
        } catch (err) {
            vscode.window.showErrorMessage(format(t()['toast.restoreFailed'], (err as Error).message));
            return;
        }

        // 双侧摘要确认（当前 vs 文件）
        const dash = await orchestrator.getDashboardData();
        const fileData = (raw && typeof raw === 'object') ? (raw as { totalMs?: unknown; sessions?: unknown[] }) : undefined;
        const fileTotal = fileData && typeof fileData.totalMs === 'number' ? fileData.totalMs : 0;
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
            log(LogLevel.Error, 'restore failed', err as Error);
            vscode.window.showErrorMessage(
                format(t()['toast.restoreFailed'], (err as Error).message));
        }
    }

    dispose(): void {
        for (const d of this.subscriptions) {
            d.dispose();
        }
        this.subscriptions.length = 0;
        log(LogLevel.Debug, 'CommandRegistrar: disposed');
    }
}
