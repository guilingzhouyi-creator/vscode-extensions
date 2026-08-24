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
import { IJournalStore } from '../cache/IJournalStore';
export declare class JournalStorageProvider implements IStorageProvider, IJournalStore {
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
    /**
     * 批量追加时间片到 journal。
     * ★ 失败语义（IJournalStore 契约）：写入失败时**抛出异常**，绝不静默吞掉——
     *   调用方（JournalWriter）依赖抛错把切片退回内存缓冲，否则数据两头落空。
     */
    appendBatch(slices: TimeSlice[]): Promise<void>;
    /** 实际执行文件追加（失败向上抛出） */
    private doAppend;
    /** 读取 journal 中所有时间片 */
    readJournal(): Promise<TimeSlice[]>;
    /**
     * 清空 journal 文件。
     * ★ 失败语义（IJournalStore 契约）：清空失败时**抛出异常**——
     *   truncate 失败意味着 journal 残留已回放过的切片，若静默则下次恢复会重复累计。
     *   recover() 依赖 metadata.lastJournalTs 水位线兜底（见 StorageCoordinator）。
     */
    truncate(): Promise<void>;
}
