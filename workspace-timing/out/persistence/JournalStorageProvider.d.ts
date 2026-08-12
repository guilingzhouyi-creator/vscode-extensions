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
export declare class JournalStorageProvider implements IStorageProvider {
    readonly id = "journal-storage";
    private readonly journalUri;
    private readonly dirUri;
    private _available;
    /** 与磁盘 journal 内容一致的内存镜像，避免每次 flush 回读整份文件 */
    private _mirror;
    constructor(workspaceRoot: vscode.Uri);
    isAvailable(): boolean;
    load(): Promise<null>;
    save(_data: WorkspaceTimingData): Promise<void>;
    delete(): Promise<void>;
    /** 检查 journal 文件是否存在 */
    exists(): Promise<boolean>;
    /** 批量追加时间片到 journal */
    appendBatch(slices: TimeSlice[]): Promise<void>;
    /** 实际执行追加写入（基于内存镜像，避免每轮回读磁盘） */
    private doAppend;
    /** 读取 journal 中所有时间片 */
    readJournal(): Promise<TimeSlice[]>;
    /** 清空 journal 文件（同步清空内存镜像） */
    truncate(): Promise<void>;
}
