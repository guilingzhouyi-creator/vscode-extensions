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

import { WorkspaceTimingData, createEmptyTimingData, LATEST_VERSION, MS_PER_DAY } from '../domain/models';
import { WorkspaceStateProvider } from './WorkspaceStateProvider';
import { FileStorageProvider } from './FileStorageProvider';
import { JournalStorageProvider } from './JournalStorageProvider';
import { LogLevel, log } from '../integration/Logger';

export class StorageCoordinator {
    private readonly primary: WorkspaceStateProvider;
    private readonly fileBackup: FileStorageProvider;
    private readonly journal: JournalStorageProvider;

    /** 文件备份降频：每 N 次全量存盘才写一次 JSON 备份（主存 workspaceState 仍每次写，保证主恢复源新鲜） */
    private static readonly FILE_BACKUP_EVERY_N = 3;
    private _fileBackupCount = 0;

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

        const hadActiveBoundary = data.currentSessionStartMs > 0;

        // Step 2: 回放 journal —— 仅当「无活跃会话边界」时作为兜底。
        //   若存在边界，活跃会话将由 Step 3 完整收尾，journal 不再 replay，避免重复计。
        const journalExists = await this.journal.exists();
        if (journalExists) {
            const slices = await this.journal.readJournal();
            if (slices.length > 0) {
                if (!hadActiveBoundary) {
                    const journalDelta = slices.reduce((sum, s) => sum + s.deltaMs, 0);
                    data.totalMs += journalDelta;
                    // ★ 兜底：把 journal 跨度合成为一条 finished 会话，
                    //   保证该时段时长能归并到正确自然日（而非仅膨胀 totalMs）。
                    const first = slices[0];
                    const last = slices[slices.length - 1];
                    data.sessions.push({
                        startMs: first.timestamp - first.deltaMs,
                        endMs: last.timestamp,
                        durationMs: journalDelta,
                    });
                    log(LogLevel.Info,
                        `StorageCoordinator: replayed ${slices.length} journal entries, +${journalDelta}ms (synthesized session)`);
                } else {
                    log(LogLevel.Debug,
                        `StorageCoordinator: active boundary present, skipping journal replay (avoid double-count)`);
                }
            }
            await this.journal.truncate();
        }

        // Step 3: 活跃会话收尾（边界优先）
        //   将进行中会话收尾为 finished TimeSession 并入 sessions[] 与 totalMs，
        //   使「会话数」与「日报/周报按日归并」在重载后即可正确反映昨日/跨天时长。
        //   最多补偿 24h，防止异常数据导致计时暴涨。
        if (hadActiveBoundary) {
            const now = Date.now();
            const elapsed = now - data.currentSessionStartMs;
            if (elapsed > 0 && elapsed < MS_PER_DAY) {
                data.totalMs += elapsed;
                data.sessions.push({
                    startMs: data.currentSessionStartMs,
                    endMs: now,
                    durationMs: elapsed,
                });
                log(LogLevel.Info,
                    `StorageCoordinator: closed unfinished session: +${elapsed}ms`);
            }
            // 收尾后清除活跃边界（新会话由 startSession → timer.start() 重新开启）
            data.currentSessionStartMs = 0;
        }

        data.lastSavedAtMs = Date.now();
        data.version = LATEST_VERSION;

        // 写回存储
        await this.save(data, true);

        log(LogLevel.Info,
            `StorageCoordinator: recovery complete, totalMs=${data.totalMs}`);
        return data;
    }

    /**
     * 级联写入：主存储 + JSON 备份
     * 主存储失败时不影响备份写入。
     * ★ 文件备份降频：主存 workspaceState 每次都写（主恢复源，需新鲜）；
     *   JSON 备份为二级兜底，每 FILE_BACKUP_EVERY_N 次才落盘一次（或关键事件强制），
     *   以降低磁盘 I/O 抖动。forceFileBackup 用于会话结束/重置/恢复等必须落盘的场景。
     */
    async save(data: WorkspaceTimingData, forceFileBackup = false): Promise<void> {
        // 更新最后保存时间
        data.lastSavedAtMs = Date.now();

        const errors: string[] = [];

        try {
            await this.primary.save(data);
        } catch (err) {
            errors.push(`primary: ${(err as Error).message}`);
        }

        this._fileBackupCount++;
        const doBackup = forceFileBackup
            || (this._fileBackupCount % StorageCoordinator.FILE_BACKUP_EVERY_N === 0);
        if (doBackup) {
            try {
                await this.fileBackup.save(data);
            } catch (err) {
                errors.push(`fileBackup: ${(err as Error).message}`);
            }
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
