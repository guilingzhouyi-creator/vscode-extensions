/**
 * CommandRegistrar — 命令注册中心
 *
 * 职责：管理所有 VS Code command 的注册与释放
 * 边界：只负责注册/注销，不执行业务逻辑
 */

import * as vscode from 'vscode';
import { TimerOrchestrator } from '../application/TimerOrchestrator';
import { StatusBarController } from './StatusBarController';
import { StorageCoordinator } from '../persistence/StorageCoordinator';
import { GlobalAggregator } from '../application/GlobalAggregator';
import { DashboardPanel } from './DashboardPanel';
import { LogLevel, log } from '../integration/Logger';
import { t, format } from '../i18n/index';

export class CommandRegistrar {
    private readonly disposables: vscode.Disposable[] = [];

    register(
        context: vscode.ExtensionContext,
        orchestrator: TimerOrchestrator | null,
        statusBar: StatusBarController | null,
        storage: StorageCoordinator | null,
        globalAggregator: GlobalAggregator | null,
    ): void {
        // 启用
        this.registerCommand('workspaceTiming.enable', async () => {
            if (!orchestrator) { this.noWorkspaceMsg(); return; }
            orchestrator.disable.updateConfig({ enabled: true, globalDisabled: false });
            await orchestrator.onDisableStateChanged(orchestrator.disable.resolveState());
            vscode.window.showInformationMessage('工作区计时: 已启用');
        });

        // 禁用
        this.registerCommand('workspaceTiming.disable', async () => {
            if (!orchestrator) { this.noWorkspaceMsg(); return; }
            orchestrator.disable.updateConfig({ enabled: false });
            await orchestrator.onDisableStateChanged(orchestrator.disable.resolveState());
            vscode.window.showInformationMessage('工作区计时: 已禁用');
        });

        // 全局开关
        this.registerCommand('workspaceTiming.toggleGlobal', async () => {
            if (!orchestrator) { this.noWorkspaceMsg(); return; }
            const current = orchestrator.disable.config.globalDisabled;
            orchestrator.disable.updateConfig({ globalDisabled: !current });
            await orchestrator.onDisableStateChanged(orchestrator.disable.resolveState());

            const msg = !current ? '工作区计时: 已全局禁用' : '工作区计时: 已全局启用';
            vscode.window.showInformationMessage(msg);
        });

        // 切换状态栏显示模式
        this.registerCommand('workspaceTiming.showStatus', () => {
            if (!statusBar) { this.noWorkspaceMsg(); return; }
            const newMode = statusBar.cycleMode();
            const label: Record<string, string> = {
                'today-total': '今日优先',
                'total-today': '累计优先',
                'compact': '紧凑',
            };
            vscode.window.showInformationMessage(
                format(t()['cmd.modeSwitched'], label[newMode] ?? newMode)
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
            vscode.window.showInformationMessage(`[调试] ${result}`);
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

        // 重置数据
        this.registerCommand('workspaceTiming.reset', async () => {
            if (!orchestrator || !statusBar || !storage) { this.noWorkspaceMsg(); return; }
            const msg = t()['confirm.reset'];
            const title = t()['confirm.reset.title'];
            const confirm = await vscode.window.showWarningMessage(msg, { modal: true }, title);

            if (confirm === title) {
                await orchestrator.stop();
                await storage.deleteAll();
                // 与面板 reset 路径语义对齐：同步清除跨工作区全局聚合中本工作区的累计。
                // 走 GlobalAggregator.reset()：同时清空内存缓存与增量同步守卫，
                // 否则下次 checkpoint 会因"值未变化"被跳过，当前工作区不再回填。
                if (globalAggregator) {
                    try {
                        await globalAggregator.reset();
                    } catch (err) {
                        log(LogLevel.Warn, 'reset: global storage delete failed', err as Error);
                    }
                }
                statusBar.updateTime(0, 0);
                // 修复：此前 reset 后只 stop 不重启，计时永久停摆、面板数据陈旧。
                // 清空后立即重新开始会话（从零起步），恢复状态栏与面板刷新。
                await orchestrator.start();
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
        vscode.window.showWarningMessage('工作区计时: 请先打开一个工作区文件夹');
    }

    dispose(): void {
        for (const d of this.disposables) {
            d.dispose();
        }
        this.disposables.length = 0;
        log(LogLevel.Debug, 'CommandRegistrar: disposed');
    }
}
