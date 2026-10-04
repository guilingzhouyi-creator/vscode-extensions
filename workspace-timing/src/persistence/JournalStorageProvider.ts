/**
 * JournalStorageProvider — 增量日志存储
 *
 * 将时间片写入 .vscode/workspace-timing.journal（NDJSON 格式）。
 * 每行一个 JSON 对象：{"t": timestamp, "d": deltaMs}
 *
 * 角色：
 *   - 崩溃保护的第三道防线（在 RingBuffer 之后、全量存盘之前）
 *   - JournalWriter.flush() 时批量追加
 *   - 全量存盘成功后 truncate 清空
 *   - 启动时如果文件非空 → 说明上次未正常退出 → 回放恢复
 *
 * 接口隔离：实现 IJournalStore（而非泛化的 IStorageProvider）——
 * journal 本质是追加流而非完整快照存储，过去以 save/load 占位实现
 * 满足 IStorageProvider 属于接口污染。
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { TimeSlice } from '../domain/models';
import { IJournalStore } from '../cache/IJournalStore';
import { LogLevel, log } from '../integration/Logger';

const JOURNAL_FILE = 'workspace-timing.journal';

/**
 * Journal 文件存储（实现 IJournalStore 窄接口）。
 * 空实现/恒 null 满足该接口属于接口隔离违反（LSP 反模式）。
 */
export class JournalStorageProvider implements IJournalStore {
    readonly id = 'journal-storage';

    private readonly journalUri: vscode.Uri;

    constructor(workspaceRoot: vscode.Uri) {
        const dotVscode = vscode.Uri.joinPath(workspaceRoot, '.vscode');
        this.journalUri = vscode.Uri.joinPath(dotVscode, JOURNAL_FILE);
    }

    // ---- journal 专有方法 ----

    /** 删除 journal 文件（deleteAll 级联路径复用 truncate 语义） */
    async delete(): Promise<void> {
        await this.truncate();
    }

    /** 检查 journal 文件是否存在 */
    async exists(): Promise<boolean> {
        try {
            await vscode.workspace.fs.stat(this.journalUri);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * 批量追加时间片到 journal。
     * ★ 失败语义（IJournalStore 契约）：写入失败时**抛出异常**，绝不静默吞掉——
     *   调用方（JournalWriter）依赖抛错把切片退回内存缓冲，否则数据两头落空。
     */
    async appendBatch(slices: TimeSlice[]): Promise<void> {
        if (slices.length === 0) return;

        try {
            const lines = slices.map(s => JSON.stringify({ t: s.timestamp, d: s.deltaMs }));
            const text = lines.join('\n') + '\n';
            const bytes = Buffer.from(text, 'utf-8');

            await this.doAppend(bytes);
        } catch (err) {
            log(LogLevel.Error, 'JournalStorageProvider: appendBatch failed', err as Error);
            throw err;
        }
    }

    /** 实际执行文件追加（失败向上抛出） */
    private async doAppend(bytes: Buffer): Promise<void> {
        // 确保 .vscode 目录存在（用 fsPath + path.dirname 正确解析父目录，
        // 而非 joinPath(uri,'..')——后者不解析 `..` 而是追加字面路径段）
        const dotVscode = vscode.Uri.file(path.dirname(this.journalUri.fsPath));
        try {
            await vscode.workspace.fs.createDirectory(dotVscode);
        } catch {
            // ignore: 目录已存在无需重新创建
        }

        // 修复 O(n) 全量重写：改用 Node fs.appendFile 直接追加（O(1)）。
        // 原实现每次"读全文件+合并+写回"，journal 增长后每次 flush 都会全量重写，
        // 日志越大越慢。Node 的 appendFile 追加为 O(1)，小写入通常原子完成。
        // VS Code 的 workspace.fs 无追加 API，故通过 fsPath 使用 Node fs。
        await fs.promises.appendFile(this.journalUri.fsPath, bytes);
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
                const slice = this.parseJournalLine(line);
                if (slice) slices.push(slice);
            }

            return slices;
        } catch (err) {
            log(LogLevel.Warn, 'JournalStorageProvider: readJournal failed', err as Error);
            return [];
        }
    }

    /**
     * 清空 journal 文件。
     * ★ 失败语义（IJournalStore 契约）：清空失败时**抛出异常**——
     *   truncate 失败意味着 journal 残留已回放过的切片，若静默则下次恢复会重复累计。
     *   recover() 依赖 metadata.lastJournalTs 水位线兜底（见 StorageCoordinator）。
     */
    async truncate(): Promise<void> {
        const exists = await this.exists();
        if (!exists) return;

        await vscode.workspace.fs.writeFile(this.journalUri, Buffer.alloc(0));
        log(LogLevel.Debug, 'JournalStorageProvider: journal truncated');
    }

    /** 解析并校验单行 journal 数据，损坏或非法时安全过滤 */
    private parseJournalLine(line: string): TimeSlice | null {
        const trimmed = line.trim();
        if (!trimmed) return null;

        try {
            const parsed = JSON.parse(trimmed);
            // 数值合法性校验：拒绝负值/非有限数/异常大 delta（delta 必须 < timestamp，
            // 否则回放时 start = timestamp - deltaMs 为负），防止脏数据污染恢复结果
            if (typeof parsed.t === 'number' && Number.isFinite(parsed.t) && parsed.t > 0
                && typeof parsed.d === 'number' && Number.isFinite(parsed.d)
                && parsed.d > 0 && parsed.d < parsed.t) {
                return { timestamp: parsed.t, deltaMs: parsed.d };
            }
        } catch {
            log(LogLevel.Warn, `JournalStorageProvider: skipping corrupt line: ${trimmed}`);
        }
        return null;
    }
}
