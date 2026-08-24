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
    /** 主备份文件路径（供还原命令做默认定位） */
    get uri(): vscode.Uri;
    save(data: WorkspaceTimingData): Promise<void>;
    /**
     * 写入 .vscode/ 下的指定文件名（安全快照 / before-restore 等辅助文件）。
     * 与 save 同格式（pretty JSON），不改变主备份文件。
     */
    saveAs(data: WorkspaceTimingData, fileName: string): Promise<void>;
    private writeTo;
    delete(): Promise<void>;
}
