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
import { StatusBarController } from './StatusBarController';
export declare class CommandRegistrar {
    private readonly disposables;
    register(context: vscode.ExtensionContext, orchestrator: TimerOrchestrator | null, statusBar: StatusBarController | null, globalAggregator: GlobalAggregator | null): void;
    private registerCommand;
    /** 降级模式提示：当前未打开工作区 */
    private noWorkspaceMsg;
    dispose(): void;
}
