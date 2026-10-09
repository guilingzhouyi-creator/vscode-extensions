/**
 * Module: Journal Storage Provider (增量日志文件系统持久化提供者)
 * File Path: src/persistence/JournalStorageProvider.ts
 * Architecture Role: 持久化层增量日志物理实现，履行 cache/IJournalStore 契约，以流式 NDJSON 格式提供纳秒级高频落盘防护。
 * Dependencies & Triggers: 依赖 Node.js fs.promises、path 与 cache/IJournalStore；被 JournalWriter 在批处理刷盘及截断时调用。
 * Responsibilities: 格式化时间片并流式追加到 journal 文件；读取并校验全量历史切片；截断清空日志文件；文件及目录自愈创建。
 * Exit Semantics & Design Rationale: 采用 Node 原生 fs.promises 避免 VS Code 文件系统句柄死锁；逐行校验过滤损坏记录，单行崩溃不影响整体解析。
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { TimeSlice } from '../domain/models';
import { IJournalStore } from '../cache/IJournalStore';
import { LogLevel, log } from '../integration/Logger';

const JOURNAL_FILE = 'workspace-timing.journal';

export class JournalStorageProvider implements IJournalStore {
    readonly id = 'journal-storage';

    private readonly filePath: string;

    constructor(workspaceRoot: vscode.Uri) {
        const dotVscodePath = path.join(workspaceRoot.fsPath, '.vscode');
        this.filePath = path.join(dotVscodePath, JOURNAL_FILE);
    }

    /** 删除 journal 文件（复用 truncate 语义清空） */
    async delete(): Promise<void> {
        await this.truncate();
    }

    /** 检查 journal 文件是否存在 */
    async exists(): Promise<boolean> {
        try {
            const stat = await fs.promises.stat(this.filePath);
            return stat.isFile();
        } catch {
            return false;
        }
    }

    /**
     * 批量追加时间片到 journal。
     * 使用流式字符串拼接消除临时对象堆分配。
     */
    async appendBatch(slices: TimeSlice[]): Promise<void> {
        if (slices.length === 0) {
            return;
        }

        try {
            let text = '';
            for (let i = 0; i < slices.length; i++) {
                const s = slices[i];
                text += `{"t":${s.timestamp},"d":${s.deltaMs}}\n`;
            }

            await this.doAppend(text);
        } catch (err) {
            log(LogLevel.Error, 'JournalStorageProvider: appendBatch failed', err as Error);
            throw err;
        }
    }

    /** 实际执行文件追加（保证目录存在，O(1) 尾部追加） */
    private async doAppend(text: string): Promise<void> {
        const dir = path.dirname(this.filePath);
        try {
            await fs.promises.mkdir(dir, { recursive: true });
        } catch {
            // ignore
        }
        await fs.promises.appendFile(this.filePath, text, 'utf-8');
    }

    /** 读取 journal 中所有时间片 */
    async readJournal(): Promise<TimeSlice[]> {
        try {
            const fileExists = await this.exists();
            if (!fileExists) {
                return [];
            }

            const text = (await fs.promises.readFile(this.filePath, 'utf-8')).trim();
            if (!text) {
                return [];
            }

            const slices: TimeSlice[] = [];
            const lines = text.split('\n');

            for (let i = 0; i < lines.length; i++) {
                const slice = this.parseJournalLine(lines[i]);
                if (slice) {
                    slices.push(slice);
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
        const fileExists = await this.exists();
        if (!fileExists) {
            return;
        }

        await fs.promises.writeFile(this.filePath, '', 'utf-8');
        log(LogLevel.Debug, 'JournalStorageProvider: journal truncated');
    }

    /** 解析并校验单行 journal 数据，损坏或非法时安全过滤 */
    private parseJournalLine(line: string): TimeSlice | null {
        const trimmed = line.trim();
        if (!trimmed) {
            return null;
        }

        try {
            const parsed = JSON.parse(trimmed);
            if (
                typeof parsed.t === 'number' &&
                Number.isFinite(parsed.t) &&
                parsed.t > 0 &&
                typeof parsed.d === 'number' &&
                Number.isFinite(parsed.d) &&
                parsed.d > 0 &&
                parsed.d < parsed.t
            ) {
                return { timestamp: parsed.t, deltaMs: parsed.d };
            }
        } catch {
            log(LogLevel.Warn, `JournalStorageProvider: skipping corrupt line: ${trimmed}`);
        }
        return null;
    }
}
