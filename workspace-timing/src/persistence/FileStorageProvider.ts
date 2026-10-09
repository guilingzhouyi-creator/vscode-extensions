/**
 * Module: File Storage Provider (文件级冗余备份持久化提供者)
 * File Path: src/persistence/FileStorageProvider.ts
 * Architecture Role: 持久化层二级冗余备份驱动，通过工作区本地 JSON 文件实现人机可读、版本可控的本地容灾存储。
 * Dependencies & Triggers: 依赖 vscode.workspace.fs、domain/models 与 Logger；由 StorageCoordinator 级联或快照机制调用。
 * Responsibilities: 实现 IStorageProvider 接口；加载与解析本地 JSON 数据；原子写入 (stagingUri -> rename) 规避断电截断损坏；生成指定命名前置快照。
 * Exit Semantics & Design Rationale: 两步原子写入保障崩溃一致性；异常捕获降级标记可用性状态，防止二级备份故障阻塞主扩展生命周期。
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
                // ignore: 目录已存在无需重新创建
            }

            // 原子写：先写同目录临时文件再 rename 覆盖，避免崩溃/断电留下半截 JSON
            // 原子写入保护：若备份文件被并发截断将导致二级文件备份失效；load 校验虽能拒读，但可能造成数据丢失
            const stagingUri = target.with({ path: `${target.path}.tmp` });
            await vscode.workspace.fs.writeFile(stagingUri, bytes);
            await vscode.workspace.fs.rename(stagingUri, target, { overwrite: true });
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
