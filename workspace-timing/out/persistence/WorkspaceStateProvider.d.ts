/**
 * WorkspaceStateProvider — 主存储提供者
 *
 * 通过 VS Code 的 workspaceState 进行存储。
 * 优点是自动按工作区隔离、无需额外文件、读写快速。
 * 缺点是数据不直观可见。
 */
import * as vscode from 'vscode';
import { WorkspaceTimingData } from '../domain/models';
import { IStorageProvider } from './IStorageProvider';
export declare class WorkspaceStateProvider implements IStorageProvider {
    readonly id = "workspace-state";
    private readonly context;
    private _available;
    constructor(context: vscode.ExtensionContext);
    isAvailable(): boolean;
    load(): Promise<WorkspaceTimingData | null>;
    save(data: WorkspaceTimingData): Promise<void>;
    delete(): Promise<void>;
}
