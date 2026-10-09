/**
 * Module: Storage Coordinator (三级级联存储总协调器)
 * File Path: src/persistence/StorageCoordinator.ts
 * Architecture Role: 持久化层协调总枢纽，统一调度 VS Code workspaceState（主）、文件备份（备）与增量日志（恢复），编排容灾降级。
 * Dependencies & Triggers: 依赖 IStorageProvider、ISnapshotStorageProvider、IJournalStore 与 models；由 TimerEngine 全生命周期驱动。
 * Responsibilities: 执行三级级联读写与主备自动容灾降级；实施 JSON 文件备份降频写入（降低磁盘抖动）；支持安全快照与整库原子还原。
 * Exit Semantics & Design Rationale: 读操作主存优先、备存兜底；主存写失败时触发紧急降级全量落备；深复制盖戳保障调用方原数据无副作用。
 */

import { WorkspaceTimingData } from '../domain/models';
import { IStorageProvider } from './IStorageProvider';
import { IJournalStore } from '../cache/IJournalStore';
import { LogLevel, log } from '../integration/Logger';

/** 可生成命名快照的文件存储提供者接口 */
export interface ISnapshotStorageProvider extends IStorageProvider {
    saveAs(data: WorkspaceTimingData, fileName: string): Promise<void>;
}

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

    private readonly primary: IStorageProvider;
    private readonly fileBackup: ISnapshotStorageProvider;
    private readonly journal: IJournalStore;

    constructor(
        primary: IStorageProvider,
        fileBackup: ISnapshotStorageProvider,
        journal: IJournalStore,
    ) {
        this.primary = primary;
        this.fileBackup = fileBackup;
        this.journal = journal;
    }

    /**
     * 级联写入：主存储 + JSON 备份
     * 主存储失败时自动触发紧急降级，立即全量写入文件备份。
     * JSON 备份为二级兜底，每 FILE_BACKUP_EVERY_N 次落盘一次以降低磁盘抖动；
     * 会话结束/重置/恢复等关键事件用 forceFileBackup 强制写入。
     */
    async save(data: WorkspaceTimingData, forceFileBackup = false): Promise<void> {
        // 以副本盖时间戳：协调器不原地改写调用方数据（保持无副作用边界）
        const stamped: WorkspaceTimingData = { ...data, lastSavedAtMs: Date.now() };

        const errors: string[] = [];
        let primaryFailed = false;

        try {
            await this.primary.save(stamped);
        } catch (err) {
            primaryFailed = true;
            errors.push(`primary: ${(err as Error).message}`);
        }

        // 计数器模运算，防无界自增
        this._fileBackupCount = (this._fileBackupCount + 1) % StorageCoordinator.FILE_BACKUP_EVERY_N;

        // 主存失败时无条件紧急降级保存，或达到降频阈值/强制备份时保存
        const shouldSaveBackup = forceFileBackup || primaryFailed || this._fileBackupCount === 0;
        if (shouldSaveBackup) {
            try {
                await this.fileBackup.save(stamped);
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
     * 破坏性操作前的安全快照：把当前权威数据复制为 .vscode/workspace-timing.before-<op>.json
     * （固定名轮转覆盖，不累积）。静默失败——快照属尽力而为，不阻塞主流程。
     */
    async snapshotBeforeDestructive(op: string): Promise<void> {
        try {
            const current = (await this.load()).data;
            if (!current) {
                return;
            }
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
