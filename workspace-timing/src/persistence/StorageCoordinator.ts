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

import { WorkspaceTimingData, createEmptyTimingData, LATEST_VERSION } from '../domain/models';
import { WorkspaceStateProvider } from './WorkspaceStateProvider';
import { FileStorageProvider } from './FileStorageProvider';
import { JournalStorageProvider } from './JournalStorageProvider';
import { LogLevel, log } from '../integration/Logger';

export class StorageCoordinator {
    private readonly primary: WorkspaceStateProvider;
    private readonly fileBackup: FileStorageProvider;
    private readonly journal: JournalStorageProvider;

    constructor(
        primary: WorkspaceStateProvider,
        fileBackup: FileStorageProvider,
        journal: JournalStorageProvider,
    ) {
        this.primary = primary;
        this.fileBackup = fileBackup;
        this.journal = journal;
    }

    /**
     * 完整崩溃恢复 + 数据加载
     *
     * 三步走：
     *   1. 加载主存储 → fallback JSON
     *   2. 回放 journal
     *   3. 补偿未完成会话
     */
    async recover(): Promise<WorkspaceTimingData> {
        log(LogLevel.Info, 'StorageCoordinator: crash recovery started');

        // Step 1: 加载主数据
        let data = await this.primary.load();
        let source = 'workspaceState';

        if (!data) {
            data = await this.fileBackup.load();
            source = 'fileBackup';
        }

        if (!data) {
            data = createEmptyTimingData();
            source = 'empty (fresh start)';
            log(LogLevel.Info, `StorageCoordinator: no existing data, starting fresh`);
        } else {
            log(LogLevel.Info, `StorageCoordinator: loaded from ${source}, totalMs=${data.totalMs}`);
        }

        // Step 2: 回放 journal
        const journalExists = await this.journal.exists();
        if (journalExists) {
            const slices = await this.journal.readJournal();
            if (slices.length > 0) {
                const journalDelta = slices.reduce((sum, s) => sum + s.deltaMs, 0);
                data.totalMs += journalDelta;
                log(LogLevel.Info,
                    `StorageCoordinator: replayed ${slices.length} journal entries, +${journalDelta}ms`);
            }
            await this.journal.truncate();
        }

        // Step 3: 补偿未完成会话
        if (data.currentSessionStartMs > 0) {
            const now = Date.now();
            const elapsed = now - data.currentSessionStartMs;
            if (elapsed > 0 && elapsed < 86400000) { // 最多补偿 24h，防止异常
                data.totalMs += elapsed;
                log(LogLevel.Info,
                    `StorageCoordinator: compensated unfinished session: +${elapsed}ms`);
            }
        }

        // 重置会话状态
        data.currentSessionStartMs = 0;
        data.lastSavedAtMs = Date.now();
        data.version = LATEST_VERSION;

        // 写回存储
        await this.save(data);

        log(LogLevel.Info,
            `StorageCoordinator: recovery complete, totalMs=${data.totalMs}`);
        return data;
    }

    /**
     * 级联写入：主存储 + JSON 备份
     * 主存储失败时不影响备份写入
     */
    async save(data: WorkspaceTimingData): Promise<void> {
        // 更新最后保存时间
        data.lastSavedAtMs = Date.now();

        const errors: string[] = [];

        try {
            await this.primary.save(data);
        } catch (err) {
            errors.push(`primary: ${(err as Error).message}`);
        }

        try {
            await this.fileBackup.save(data);
        } catch (err) {
            errors.push(`fileBackup: ${(err as Error).message}`);
        }

        if (errors.length > 0) {
            log(LogLevel.Warn, `StorageCoordinator: save partially failed: ${errors.join('; ')}`);
        }
    }

    /** 读取数据（不执行恢复，仅加载当前持久化状态） */
    async load(): Promise<WorkspaceTimingData | null> {
        let data = await this.primary.load();
        if (!data) {
            data = await this.fileBackup.load();
        }
        return data;
    }

    /** 删除所有存储数据 */
    async deleteAll(): Promise<void> {
        try {
            await this.primary.delete();
        } catch {
            // ignore
        }
        try {
            await this.fileBackup.delete();
        } catch {
            // ignore
        }
        try {
            await this.journal.delete();
        } catch {
            // ignore
        }
        log(LogLevel.Info, 'StorageCoordinator: all data deleted');
    }

    /** 获取 journal 存储引用（供 Scheduler/JournalWriter 使用） */
    getJournalProvider(): JournalStorageProvider {
        return this.journal;
    }
}
