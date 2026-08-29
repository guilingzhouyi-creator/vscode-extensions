/**
 * CommandRegistrar — 命令注册中心
 *
 * 职责：管理所有 VS Code command 的注册与释放
 * 边界：只负责注册/注销与交互确认；业务编排一律委托 application 层
 *       （如 reset 走 TimerOrchestrator.resetAllData，不在此处拼装存储操作）
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
import { exportTimingToFile } from './dashboardMessages';
import { sanitizeFileName } from './fileUtils';

export class CommandRegistrar {
    private readonly disposables: vscode.Disposable[] = [];

    register(
        context: vscode.ExtensionContext,
        orchestrator: TimerOrchestrator | null,
        statusBar: StatusBarController | null,
        globalAggregator: GlobalAggregator | null,
    ): void {
        // 启用
        this.registerCommand('workspaceTiming.enable', async () => {
            if (!orchestrator) { this.noWorkspaceMsg(); return; }
            orchestrator.disable.updateConfig({ enabled: true, globalDisabled: false });
            await orchestrator.onDisableStateChanged(orchestrator.disable.resolveState());
            persistTimingConfig({ enabled: true, globalDisabled: false }).catch(err =>
                log(LogLevel.Error, 'enable persist failed', err as Error)
            );
            vscode.window.showInformationMessage(t()['cmd.enabled']);
        });

        // 禁用
        this.registerCommand('workspaceTiming.disable', async () => {
            if (!orchestrator) { this.noWorkspaceMsg(); return; }
            orchestrator.disable.updateConfig({ enabled: false });
            await orchestrator.onDisableStateChanged(orchestrator.disable.resolveState());
            persistTimingConfig({ enabled: false }).catch(err =>
                log(LogLevel.Error, 'disable persist failed', err as Error)
            );
            vscode.window.showInformationMessage(t()['cmd.disabled']);
        });

        // 全局开关
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

        // 切换状态栏显示模式
        this.registerCommand('workspaceTiming.showStatus', () => {
            if (!statusBar) { this.noWorkspaceMsg(); return; }
            const newMode = statusBar.cycleMode();
            vscode.window.showInformationMessage(
                format(t()['cmd.modeSwitched'], statusBarModeLabel(newMode))
            );
        });

        // 打开配置面板
        this.registerCommand('workspaceTiming.openDashboard', () => {
            DashboardPanel.createOrShow(context.extensionUri);
        });

        // 导出 CSV（与 Dashboard 导出按钮共用逻辑）
        this.registerCommand('workspaceTiming.export', () => {
            void exportTimingToFile({
                getOrchestrator: () => orchestrator,
                getStatusBar: () => statusBar,
                getDashboard: () => DashboardPanel.currentPanel ?? null,
            });
        });

        // 调试：手动存盘
        this.registerCommand('workspaceTiming.debugSave', async () => {
            if (!orchestrator) { this.noWorkspaceMsg(); return; }
            const result = await orchestrator.saveNow();
            vscode.window.showInformationMessage(format(t()['cmd.debugSaved'], result));
        });

        // 新建计时周期（重置累计，保留历史）
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

        // 重置数据（业务编排委托 orchestrator.resetAllData：清数据→清全局→重启计时）
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

        // 清除跨工作区累计（仅清全局聚合，不影响各工作区本地计时）
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

        // 清除历史明细（保留累计数字；编排委托 orchestrator.clearHistory）
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

        // 从备份文件还原（默认定位 .vscode/workspace-timing.json；还原前自动安全快照）
        this.registerCommand('workspaceTiming.restore', async () => {
            if (!orchestrator || !statusBar) { this.noWorkspaceMsg(); return; }
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
            if (!workspaceRoot) { this.noWorkspaceMsg(); return; }

            const defaultUri = vscode.Uri.joinPath(workspaceRoot, '.vscode', 'workspace-timing.json');
            const picked = await vscode.window.showOpenDialog({
                defaultUri,
                canSelectMany: false,
                filters: { 'JSON Files (*.json)': ['json'], 'All Files': ['*'] },
                openLabel: t()['toast.exportSaveLabel'],
            });
            if (!picked || picked.length === 0) return;

            let raw: unknown;
            try {
                const bytes = await vscode.workspace.fs.readFile(picked[0]);
                raw = JSON.parse(Buffer.from(bytes).toString('utf-8'));
            } catch (err) {
                vscode.window.showErrorMessage(`${t()['toast.exportFailed']} (${(err as Error).message})`);
                return;
            }

            // 双侧摘要确认（当前 vs 文件）
            const dash = await orchestrator.getDashboardData();
            const fileData = (raw && typeof raw === 'object') ? (raw as { totalMs?: unknown; sessions?: unknown[] }) : undefined;
            const fileTotal = fileData && typeof fileData.totalMs === 'number' ? fileData.totalMs : 0;
            const fileSessions = Array.isArray(fileData?.sessions) ? fileData!.sessions!.length : 0;
            // 占位顺序：{0}=当前累计 {1}=当前会话数 {2}=文件累计 {3}=文件会话数
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
                vscode.window.showErrorMessage(`Restore failed: ${(err as Error).message}`);
            }
        });

        // 导出全历史聚合日报 CSV
        this.registerCommand('workspaceTiming.exportAggregated', async () => {
            if (!orchestrator) { this.noWorkspaceMsg(); return; }
            const workspaceName = sanitizeFileName(vscode.workspace.workspaceFolders?.[0]?.name ?? 'workspace');
            const defaultUri = vscode.Uri.file(
                `${workspaceName}-timing-${t()['export.filename.aggregated']}-${TimeAggregator.todayStr()}.csv`,
            );
            const uri = await vscode.window.showSaveDialog({
                defaultUri,
                filters: { 'CSV Files (*.csv)': ['csv'] },
                saveLabel: t()['toast.exportSaveLabel'],
            });
            if (!uri) return;
            try {
                const csv = await orchestrator.exportAggregatedCSV(workspaceName);
                await vscode.workspace.fs.writeFile(uri, Buffer.from(csv, 'utf8'));
                vscode.window.showInformationMessage(
                    format(t()['toast.exportSuccess'], uri.fsPath));
            } catch (err) {
                log(LogLevel.Error, 'aggregated export failed', err as Error);
                vscode.window.showErrorMessage(t()['toast.exportFailed']);
            }
        });

        // 将 disposables 注册到 context.subscriptions
        for (const d of this.disposables) {
            context.subscriptions.push(d);
        }

        log(LogLevel.Info, 'CommandRegistrar: all commands registered');
    }

    private registerCommand(id: string, handler: (...args: unknown[]) => unknown): void {
        const disposable = vscode.commands.registerCommand(id, handler);
        this.disposables.push(disposable);
    }

    /** 降级模式提示：当前未打开工作区 */
    private noWorkspaceMsg(): void {
        vscode.window.showWarningMessage(t()['cmd.noWorkspace']);
    }

    dispose(): void {
        for (const d of this.disposables) {
            d.dispose();
        }
        this.disposables.length = 0;
        log(LogLevel.Debug, 'CommandRegistrar: disposed');
    }
}
