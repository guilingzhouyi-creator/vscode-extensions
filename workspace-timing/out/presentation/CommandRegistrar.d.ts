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
export declare class CommandRegistrar {
    private readonly disposables;
    register(context: vscode.ExtensionContext, orchestrator: TimerOrchestrator | null, statusBar: StatusBarController | null, storage: StorageCoordinator | null): void;
    private registerCommand;
    /** 降级模式提示：当前未打开工作区 */
    private noWorkspaceMsg;
    dispose(): void;
}
