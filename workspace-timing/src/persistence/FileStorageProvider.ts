/**
 * FileStorageProvider — JSON 文件备份存储
 *
 * 将计时数据写入 .workspace-timing-data/data.json。
 * 不放入 .vscode/ — VS Code 对该目录有文件监听，
 * 写入会触发 UI 刷新导致间歇性屏闪。
 * 用户可见、可版本控制、可移植。
 * 配合 workspaceState 作为双重保障。
 */

import * as vscode from 'vscode';
import { WorkspaceTimingData } from '../domain/models';
import { IStorageProvider } from './IStorageProvider';
import { LogLevel, log } from '../integration/Logger';

const STORAGE_DIR = '.workspace-timing-data';
const FILE_NAME = 'data.json';

export class FileStorageProvider implements IStorageProvider {
    readonly id = 'file-storage';

    private readonly fileUri: vscode.Uri;
    private readonly dirUri: vscode.Uri;
    private _available: boolean = true;

    constructor(workspaceRoot: vscode.Uri) {
        this.dirUri = vscode.Uri.joinPath(workspaceRoot, STORAGE_DIR);
        this.fileUri = vscode.Uri.joinPath(this.dirUri, FILE_NAME);
    }

    isAvailable(): boolean {
        return this._available;
    }

    async load(): Promise<WorkspaceTimingData | null> {
        try {
            try {
                await vscode.workspace.fs.stat(this.fileUri);
            } catch {
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

    async save(data: WorkspaceTimingData): Promise<void> {
        try {
            const text = JSON.stringify(data, null, 2);
            const bytes = Buffer.from(text, 'utf-8');

            try {
                await vscode.workspace.fs.createDirectory(this.dirUri);
            } catch {
                // 目录已存在
            }

            await vscode.workspace.fs.writeFile(this.fileUri, bytes);
        } catch (err) {
            log(LogLevel.Error, 'FileStorageProvider: save failed', err as Error);
            throw err;
        }
    }

    async delete(): Promise<void> {
        try {
            try {
                await vscode.workspace.fs.stat(this.fileUri);
            } catch {
                return;
            }
            await vscode.workspace.fs.delete(this.fileUri);
        } catch (err) {
            log(LogLevel.Error, 'FileStorageProvider: delete failed', err as Error);
            throw err;
        }
    }
}
