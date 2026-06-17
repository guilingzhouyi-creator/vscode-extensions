/**
 * JournalStorageProvider — 日志文件存储
 *
 * 管理 .vscode/workspace-timing.journal 文件。
 * 格式：每行一个紧凑 JSON，代表一条 TimeSlice：
 *   {"t":<timestamp_ms>,"d":<delta_ms>}
 *
 * 文件生命周期：
 *   - 写入：append 追加到文件末尾
 *   - 回放：崩溃恢复时读取全部行
 *   - 清理：全量存盘成功后 truncate 清空
 */

import * as vscode from 'vscode';
import { TimeSlice, WorkspaceTimingData } from '../domain/models';
import { IStorageProvider } from './IStorageProvider';
import { LogLevel, log } from '../integration/Logger';

const JOURNAL_FILE = 'workspace-timing.journal';

export class JournalStorageProvider implements IStorageProvider {
    readonly id = 'journal-storage';

    private readonly journalUri: vscode.Uri;
    private _available: boolean = true;

    constructor(workspaceRoot: vscode.Uri) {
        const dotVscode = vscode.Uri.joinPath(workspaceRoot, '.vscode');
        this.journalUri = vscode.Uri.joinPath(dotVscode, JOURNAL_FILE);
    }

    // IStorageProvider 方法（journal 不支持完整 load/save，
    // 这些方法通过 StorageCoordinator 委托给主存储）

    isAvailable(): boolean {
        return this._available;
    }

    async load(): Promise<null> {
        return null;
    }

    async save(_data: WorkspaceTimingData): Promise<void> {
        // journal 不支持全量 save，参数保留以满足接口契约
    }

    async delete(): Promise<void> {
        await this.truncate();
    }

    // ---- journal 专有方法 ----

    /** 检查 journal 文件是否存在 */
    async exists(): Promise<boolean> {
        try {
            await vscode.workspace.fs.stat(this.journalUri);
            return true;
        } catch {
            return false;
        }
    }

    /** 批量追加时间片到 journal */
    async appendBatch(slices: TimeSlice[]): Promise<void> {
        if (slices.length === 0) return;

        try {
            const lines = slices.map(s => JSON.stringify({ t: s.timestamp, d: s.deltaMs }));
            const text = lines.join('\n') + '\n';
            const bytes = Buffer.from(text, 'utf-8');

            await this.doAppend(bytes);
        } catch (err) {
            log(LogLevel.Warn, 'JournalStorageProvider: appendBatch failed', err as Error);
            this._available = false;
        }
    }

    /** 实际执行文件追加 */
    private async doAppend(bytes: Buffer): Promise<void> {
        try {
            // 确保 .vscode 目录存在
            const dotVscode = vscode.Uri.joinPath(this.journalUri, '..');
            try {
                await vscode.workspace.fs.createDirectory(dotVscode);
            } catch {
                // 目录已存在
            }

            // 读取现有内容，追加写入
            let existing = Buffer.alloc(0);
            try {
                const existingBytes = await vscode.workspace.fs.readFile(this.journalUri);
                existing = Buffer.from(existingBytes);
            } catch {
                // 文件不存在，从头开始
            }

            const combined = Buffer.concat([existing, bytes]);
            await vscode.workspace.fs.writeFile(this.journalUri, combined);
        } catch (err) {
            log(LogLevel.Error, 'JournalStorageProvider: append failed', err as Error);
        }
    }

    /** 读取 journal 中所有时间片 */
    async readJournal(): Promise<TimeSlice[]> {
        try {
            const exists = await this.exists();
            if (!exists) return [];

            const bytes = await vscode.workspace.fs.readFile(this.journalUri);
            const text = Buffer.from(bytes).toString('utf-8').trim();
            if (!text) return [];

            const slices: TimeSlice[] = [];
            const lines = text.split('\n');

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;

                try {
                    const parsed = JSON.parse(trimmed);
                    if (typeof parsed.t === 'number' && typeof parsed.d === 'number') {
                        slices.push({ timestamp: parsed.t, deltaMs: parsed.d });
                    }
                } catch {
                    // 跳过损坏的行
                    log(LogLevel.Warn, `JournalStorageProvider: skipping corrupt line: ${trimmed}`);
                }
            }

            return slices;
        } catch (err) {
            log(LogLevel.Warn, 'JournalStorageProvider: readJournal failed', err as Error);
            return [];
        }
    }

    /** 清空 journal 文件 */
    async truncate(): Promise<void> {
        try {
            const exists = await this.exists();
            if (!exists) return;

            await vscode.workspace.fs.writeFile(this.journalUri, Buffer.alloc(0));
            log(LogLevel.Debug, 'JournalStorageProvider: journal truncated');
        } catch (err) {
            log(LogLevel.Warn, 'JournalStorageProvider: truncate failed', err as Error);
        }
    }
}
