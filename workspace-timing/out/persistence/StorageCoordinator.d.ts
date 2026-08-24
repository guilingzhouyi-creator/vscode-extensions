/**
 * StorageCoordinator — 存储协调器
 *
 * 职责：
 *   1. 协调三级存储：workspaceState（主）→ JSON 文件（备）→ journal（崩溃恢复）
 *   2. 崩溃恢复：三步走算法（加载主数据 → 回放 journal → 补偿未完成会话）
 *   3. 写入时级联写入主 + 备
 *
 * 崩溃恢复算法（三步走）：
 *   Step 1: 从 workspaceState 加载；若不可用则 fallback 到 JSON 文件
 *   Step 2: 如果 journal 存在，回放所有未提交的 TimeSlice
 *   Step 3: 仅当 journal 无有效回放且 sessionStartMs > 0 时，补偿未完成会话的历时（兜底）
 */
import * as vscode from 'vscode';
import { WorkspaceTimingData } from '../domain/models';
import { WorkspaceStateProvider } from './WorkspaceStateProvider';
import { FileStorageProvider } from './FileStorageProvider';
import { JournalStorageProvider } from './JournalStorageProvider';
export declare class StorageCoordinator {
    /** 文件备份降频：每 N 次全量存盘才写一次 JSON 备份（主存 workspaceState 仍每次写） */
    private static readonly FILE_BACKUP_EVERY_N;
    private _fileBackupCount;
    private readonly primary;
    private readonly fileBackup;
    private readonly journal;
    constructor(primary: WorkspaceStateProvider, fileBackup: FileStorageProvider, journal: JournalStorageProvider);
    /**
     * 完整崩溃恢复 + 数据加载
     *
     * 四步走：
     *   1. 加载主存储 → fallback JSON
     *   2. v1→v2 迁移 + 过期会话折叠进 dailyTotals（幂等）
     *   3. 回放 journal（合成段同步入桶）
     *   4. 补偿未完成会话
     */
    recover(retentionDays?: number): Promise<WorkspaceTimingData>;
    /**
     * 级联写入：主存储 + JSON 备份
     * 主存储失败时不影响备份写入。
     * JSON 备份为二级兜底，每 FILE_BACKUP_EVERY_N 次落盘一次以降低磁盘抖动；
     * 会话结束/重置/恢复等关键事件用 forceFileBackup 强制写入。
     */
    save(data: WorkspaceTimingData, forceFileBackup?: boolean): Promise<void>;
    /** 读取数据（不执行恢复，仅加载当前持久化状态） */
    load(): Promise<WorkspaceTimingData | null>;
    /**
     * 还原：以外部数据整体替换三级存储中的两级（主存 + JSON 备份），
     * 并截断 journal（旧增量对新数据无效）。调用方需已完成校验与迁移。
     */
    restore(data: WorkspaceTimingData): Promise<void>;
    /**
     * 破坏性操作前的安全快照：把当前 JSON 备份复制为 .vscode/workspace-timing.before-<op>.json
     * （固定名轮转覆盖，不累积）。静默失败——快照属尽力而为，不阻塞主流程。
     */
    snapshotBeforeDestructive(op: string): Promise<void>;
    /** 主备份文件 URI（供还原命令默认定位文件对话框） */
    getBackupUri(): vscode.Uri;
    /** 删除所有存储数据 */
    deleteAll(): Promise<void>;
    /** 获取 journal 存储引用（供 Scheduler/JournalWriter 使用） */
    getJournalProvider(): JournalStorageProvider;
}
