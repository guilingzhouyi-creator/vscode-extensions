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
export declare class JournalStorageProvider implements IStorageProvider {
    readonly id = "journal-storage";
    private readonly journalUri;
    private _available;
    constructor(workspaceRoot: vscode.Uri);
    isAvailable(): boolean;
    load(): Promise<null>;
    save(_data: WorkspaceTimingData): Promise<void>;
    delete(): Promise<void>;
    /** 检查 journal 文件是否存在 */
    exists(): Promise<boolean>;
    /** 批量追加时间片到 journal */
    appendBatch(slices: TimeSlice[]): Promise<void>;
    /** 实际执行文件追加 */
    private doAppend;
    /** 读取 journal 中所有时间片 */
    readJournal(): Promise<TimeSlice[]>;
    /** 清空 journal 文件 */
    truncate(): Promise<void>;
}
