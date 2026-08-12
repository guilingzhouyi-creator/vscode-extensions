/**
 * JournalStorageProvider — 日志文件存储
 *
 * 管理 .workspace-timing-data/journal 文件。
 * 不放入 .vscode/ — VS Code 对该目录有文件监听，
 * 写入会触发 UI 刷新导致间歇性屏闪。
 * 格式：每行一个紧凑 JSON，代表一条 TimeSlice：
 *   {"t":<timestamp_ms>,"d":<delta_ms>}
 *
 * 文件生命周期：
 *   - 写入：append 追加到文件末尾
 *   - 回放：崩溃恢复时读取全部行
 *   - 清理：全量存盘成功后 truncate 清空
 *
 * ★ 性能修复（0.3.2）：此前每次 flush 都 readFile 整份 journal → 拼接 → writeFile 整份，
 *   时间复杂度 O(文件大小)，多次 flush 叠加为 O(n²)，并放大磁盘读取。
 *   现维护一份与磁盘内容等价的「内存镜像」(_mirror)，doAppend 仅做内存拼接后整写，
 *   不再每次回读磁盘。镜像与文件内容的一致性由以下不变式保证：
 *     · 启动时 StorageCoordinator.recover() 必定 truncate 一次（文件与镜像均清空）；
 *     · 每次全量存盘成功后同样 truncate；
 *   因此在任意两次 flush 之间，_mirror 始终等于磁盘文件内容。
 */

import * as vscode from 'vscode';
import { TimeSlice, WorkspaceTimingData } from '../domain/models';
import { IStorageProvider } from './IStorageProvider';
import { LogLevel, log } from '../integration/Logger';

const STORAGE_DIR = '.workspace-timing-data';
const JOURNAL_FILE = 'journal';

export class JournalStorageProvider implements IStorageProvider {
    readonly id = 'journal-storage';

    private readonly journalUri: vscode.Uri;
    private readonly dirUri: vscode.Uri;
    private _available: boolean = true;

    /** 与磁盘 journal 内容一致的内存镜像，避免每次 flush 回读整份文件 */
    private _mirror: Buffer = Buffer.alloc(0);

    constructor(workspaceRoot: vscode.Uri) {
        this.dirUri = vscode.Uri.joinPath(workspaceRoot, STORAGE_DIR);
        this.journalUri = vscode.Uri.joinPath(this.dirUri, JOURNAL_FILE);
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
        this._mirror = Buffer.alloc(0);
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

    /** 实际执行追加写入（基于内存镜像，避免每轮回读磁盘） */
    private async doAppend(bytes: Buffer): Promise<void> {
        try {
            // 确保存储目录存在
            try {
                await vscode.workspace.fs.createDirectory(this.dirUri);
            } catch {
                // 目录已存在
            }

            this._mirror = Buffer.concat([this._mirror, bytes]);
            // 2 参数 writeFile 在目标 vscode 版本中等同于「整体替换」；
            // 内存镜像 _mirror 始终等于磁盘应写入的完整内容，故此处整写即可（无需回读）
            await vscode.workspace.fs.writeFile(this.journalUri, this._mirror);
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

    /** 清空 journal 文件（同步清空内存镜像） */
    async truncate(): Promise<void> {
        try {
            const exists = await this.exists();
            if (!exists) return;

            await vscode.workspace.fs.writeFile(this.journalUri, Buffer.alloc(0));
            this._mirror = Buffer.alloc(0);
            log(LogLevel.Debug, 'JournalStorageProvider: journal truncated');
        } catch (err) {
            log(LogLevel.Warn, 'JournalStorageProvider: truncate failed', err as Error);
        }
    }
}
