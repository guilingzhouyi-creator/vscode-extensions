/**
 * FileStorageProvider — JSON 文件备份存储
 *
 * 将计时数据写入 .vscode/workspace-timing.json。
 * 用户可见、可版本控制、可移植。
 * 配合 workspaceState 作为双重保障。
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { WorkspaceTimingData } from '../domain/models';
import { IStorageProvider } from './IStorageProvider';
import { LogLevel, log } from '../integration/Logger';

const FILE_NAME = 'workspace-timing.json';

export class FileStorageProvider implements IStorageProvider {
    readonly id = 'file-storage';

    private readonly fileUri: vscode.Uri;
    private _available: boolean = true;

    constructor(workspaceRoot: vscode.Uri) {
        const dotVscode = vscode.Uri.joinPath(workspaceRoot, '.vscode');
        this.fileUri = vscode.Uri.joinPath(dotVscode, FILE_NAME);
    }

    isAvailable(): boolean {
        return this._available;
    }

    async load(): Promise<WorkspaceTimingData | null> {
        try {
            try {
                await vscode.workspace.fs.stat(this.fileUri);
            } catch {
                // 文件不存在
                return null;
            }

            const bytes = await vscode.workspace.fs.readFile(this.fileUri);
            const text = Buffer.from(bytes).toString('utf-8');
            const data: WorkspaceTimingData = JSON.parse(text);

            if (typeof data.totalMs !== 'number' || typeof data.version !== 'number') {
                log(LogLevel.Warn, 'FileStorageProvider: invalid data format, ignoring');
                return null;
            }

            return data;
        } catch (err) {
            log(LogLevel.Warn, 'FileStorageProvider: load failed', err as Error);
            this._available = false;
            return null;
        }
    }

    /** 主备份文件路径（供还原命令做默认定位） */
    get uri(): vscode.Uri {
        return this.fileUri;
    }

    async save(data: WorkspaceTimingData): Promise<void> {
        await this.writeTo(this.fileUri, data);
    }

    /**
     * 写入 .vscode/ 下的指定文件名（安全快照 / before-restore 等辅助文件）。
     * 与 save 同格式（pretty JSON），不改变主备份文件。
     */
    async saveAs(data: WorkspaceTimingData, fileName: string): Promise<void> {
        const dotVscode = vscode.Uri.file(path.dirname(this.fileUri.fsPath));
        const target = vscode.Uri.joinPath(dotVscode, fileName);
        await this.writeTo(target, data);
    }

    private async writeTo(target: vscode.Uri, data: WorkspaceTimingData): Promise<void> {
        try {
            const text = JSON.stringify(data, null, 2);
            const bytes = Buffer.from(text, 'utf-8');

            // 确保 .vscode 目录存在（用 fsPath + path.dirname 正确解析父目录，
            // 而非 joinPath(uri,'..')——后者不解析 `..` 而是追加字面路径段）
            const dotVscode = vscode.Uri.file(path.dirname(target.fsPath));
            try {
                await vscode.workspace.fs.createDirectory(dotVscode);
            } catch {
                // 目录已存在
            }

            await vscode.workspace.fs.writeFile(target, bytes);
        } catch (err) {
            log(LogLevel.Error, 'FileStorageProvider: write failed', err as Error);
            throw err;
        }
    }

    async delete(): Promise<void> {
        try {
            try {
                await vscode.workspace.fs.stat(this.fileUri);
            } catch {
                return; // 文件不存在，无需删除
            }
            await vscode.workspace.fs.delete(this.fileUri);
        } catch (err) {
            log(LogLevel.Error, 'FileStorageProvider: delete failed', err as Error);
            throw err;
        }
    }
}
