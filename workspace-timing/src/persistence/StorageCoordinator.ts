/**
 * StorageCoordinator — 存储协调器
 *
 * 职责：
 *   1. 协调三级存储：workspaceState（主）→ JSON 文件（备）→ journal（崩溃恢复）
 *   2. 级联写入主 + 备
 *
 * 崩溃恢复算法已上移至应用层 RecoveryService（领域规则不属于持久化层），
 * 本类只保留原始读写原语：load / save / restore / snapshot / deleteAll。
 */

import { WorkspaceTimingData } from '../domain/models';
import { WorkspaceStateProvider } from './WorkspaceStateProvider';
import { FileStorageProvider } from './FileStorageProvider';
import { JournalStorageProvider } from './JournalStorageProvider';
import { LogLevel, log } from '../integration/Logger';

/** 数据加载结果：data 为空表示无任何现网数据；source 供恢复诊断日志 */
export interface LoadResult {
    data: WorkspaceTimingData | null;
    /** 数据来源：workspaceState / fileBackup / none */
    source: 'workspaceState' | 'fileBackup' | 'none';
}

export class StorageCoordinator {
    /** 文件备份降频：每 N 次全量存盘才写一次 JSON 备份（主存 workspaceState 仍每次写） */
    private static readonly FILE_BACKUP_EVERY_N = 3;
    private _fileBackupCount = 0;

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
     * 级联写入：主存储 + JSON 备份
     * 主存储失败时不影响备份写入。
     * JSON 备份为二级兜底，每 FILE_BACKUP_EVERY_N 次落盘一次以降低磁盘抖动；
     * 会话结束/重置/恢复等关键事件用 forceFileBackup 强制写入。
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
        if (forceFileBackup || this._fileBackupCount % StorageCoordinator.FILE_BACKUP_EVERY_N === 0) {
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

    /** 读取数据（主存优先，文件备份兜底），并报告实际来源供恢复诊断 */
    async load(): Promise<LoadResult> {
        const primaryData = await this.primary.load();
        if (primaryData) {
            return { data: primaryData, source: 'workspaceState' };
        }
        const fileData = await this.fileBackup.load();
        if (fileData) {
            return { data: fileData, source: 'fileBackup' };
        }
        return { data: null, source: 'none' };
    }

    /**
     * 还原：以外部数据整体替换三级存储中的两级（主存 + JSON 备份），
     * 并截断 journal（旧增量对新数据无效）。调用方需已完成校验与迁移。
     */
    async restore(data: WorkspaceTimingData): Promise<void> {
        await this.save(data, true);
        try {
            await this.journal.truncate();
        } catch (err) {
            log(LogLevel.Warn, 'StorageCoordinator: journal truncate after restore failed', err as Error);
        }
        log(LogLevel.Info, `StorageCoordinator: data restored (totalMs=${data.totalMs}, sessions=${data.sessions.length})`);
    }

    /**
     * 破坏性操作前的安全快照：把当前 JSON 备份复制为 .vscode/workspace-timing.before-<op>.json
     * （固定名轮转覆盖，不累积）。静默失败——快照属尽力而为，不阻塞主流程。
     */
    async snapshotBeforeDestructive(op: string): Promise<void> {
        try {
            const current = await this.fileBackup.load();
            if (!current) return; // 无现网数据则无需快照
            await this.fileBackup.saveAs(current, `workspace-timing.before-${op}.json`);
            log(LogLevel.Info, `StorageCoordinator: safety snapshot written (op=${op})`);
        } catch (err) {
            log(LogLevel.Warn, `StorageCoordinator: safety snapshot failed (op=${op})`, err as Error);
        }
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
}