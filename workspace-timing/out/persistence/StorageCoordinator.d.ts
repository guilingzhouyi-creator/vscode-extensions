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
 *   Step 3: 如果 sessionStartMs > 0，补偿未完成会话的历时
 */
import { WorkspaceTimingData } from '../domain/models';
import { WorkspaceStateProvider } from './WorkspaceStateProvider';
import { FileStorageProvider } from './FileStorageProvider';
import { JournalStorageProvider } from './JournalStorageProvider';
export declare class StorageCoordinator {
    private readonly primary;
    private readonly fileBackup;
    private readonly journal;
    constructor(primary: WorkspaceStateProvider, fileBackup: FileStorageProvider, journal: JournalStorageProvider);
    /**
     * 完整崩溃恢复 + 数据加载
     *
     * 三步走：
     *   1. 加载主存储 → fallback JSON
     *   2. 回放 journal
     *   3. 补偿未完成会话
     */
    recover(): Promise<WorkspaceTimingData>;
    /**
     * 级联写入：主存储 + JSON 备份
     * 主存储失败时不影响备份写入
     */
    save(data: WorkspaceTimingData): Promise<void>;
    /** 读取数据（不执行恢复，仅加载当前持久化状态） */
    load(): Promise<WorkspaceTimingData | null>;
    /** 删除所有存储数据 */
    deleteAll(): Promise<void>;
    /** 获取 journal 存储引用（供 Scheduler/JournalWriter 使用） */
    getJournalProvider(): JournalStorageProvider;
}
