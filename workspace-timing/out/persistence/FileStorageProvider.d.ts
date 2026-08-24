/**
 * FileStorageProvider — JSON 文件备份存储
 *
 * 将计时数据写入 .vscode/workspace-timing.json。
 * 用户可见、可版本控制、可移植。
 * 配合 workspaceState 作为双重保障。
 */
import * as vscode from 'vscode';
import { WorkspaceTimingData } from '../domain/models';
import { IStorageProvider } from './IStorageProvider';
export declare class FileStorageProvider implements IStorageProvider {
    readonly id = "file-storage";
    private readonly fileUri;
    private _available;
    constructor(workspaceRoot: vscode.Uri);
    isAvailable(): boolean;
    load(): Promise<WorkspaceTimingData | null>;
    save(data: WorkspaceTimingData): Promise<void>;
    delete(): Promise<void>;
}
