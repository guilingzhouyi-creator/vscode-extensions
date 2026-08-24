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
import { t, format } from '../i18n/index';

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
            vscode.window.showInformationMessage(t()['cmd.enabled']);
        });

        // 禁用
        this.registerCommand('workspaceTiming.disable', async () => {
            if (!orchestrator) { this.noWorkspaceMsg(); return; }
            orchestrator.disable.updateConfig({ enabled: false });
            await orchestrator.onDisableStateChanged(orchestrator.disable.resolveState());
            vscode.window.showInformationMessage(t()['cmd.disabled']);
        });

        // 全局开关
        this.registerCommand('workspaceTiming.toggleGlobal', async () => {
            if (!orchestrator) { this.noWorkspaceMsg(); return; }
            const current = orchestrator.disable.config.globalDisabled;
            orchestrator.disable.updateConfig({ globalDisabled: !current });
            await orchestrator.onDisableStateChanged(orchestrator.disable.resolveState());

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
