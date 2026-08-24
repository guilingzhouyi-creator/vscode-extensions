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
import { WorkspaceTimingData, createEmptyTimingData, LATEST_VERSION, CRASH_COMPENSATION_CAP_MS, DailyTotalsMap } from '../domain/models';
import { TimeAggregator } from '../domain/TimeAggregator';
import { migrateToFolded } from '../domain/HistoryFolder';
import { WorkspaceStateProvider } from './WorkspaceStateProvider';
import { FileStorageProvider } from './FileStorageProvider';
import { JournalStorageProvider } from './JournalStorageProvider';
import { LogLevel, log } from '../integration/Logger';

/** journal 片段分组断点阈值：相邻片段起始间隔超过该值视为中断（如系统休眠） */
const JOURNAL_RUN_GAP_MS = 60000;

/** 本地日期 key（与 TimeAggregator 归桶口径一致） */
function dateKeyOf(ms: number): string {
    const d = new Date(ms);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
}

/** 合成会话段累入日桶（每段视为一条独立记录，计数记入段起始日） */
function addSegsToDaily(totals: DailyTotalsMap | undefined,
    segs: { startMs: number; durationMs: number }[]): DailyTotalsMap {
    const map: DailyTotalsMap = totals ? { ...totals } : {};
    for (const seg of segs) {
        const key = dateKeyOf(seg.startMs);
        const bucket = map[key] ?? { totalMs: 0, sessionCount: 0 };
        bucket.totalMs += seg.durationMs;
        bucket.sessionCount += 1;
        map[key] = bucket;
    }
    return map;
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
     * 完整崩溃恢复 + 数据加载
     *
     * 四步走：
     *   1. 加载主存储 → fallback JSON
     *   2. v1→v2 迁移 + 过期会话折叠进 dailyTotals（幂等）
     *   3. 回放 journal（合成段同步入桶）
     *   4. 补偿未完成会话
     */
    async recover(retentionDays = 45): Promise<WorkspaceTimingData> {
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

        // Step 1.5: v1→v2 迁移 + 过期会话折叠（幂等，retention<=0 时仅补空表）
        const migrated = migrateToFolded(data, retentionDays);
        if (migrated.foldedSessionCount > 0) {
            log(LogLevel.Info,
                `StorageCoordinator: folded ${migrated.foldedSessionCount} expired session(s) ` +
                `into ${Object.keys(migrated.dailyTotals).length} daily bucket(s)`);
        }
        data.sessions = migrated.sessions;
        data.dailyTotals = migrated.dailyTotals;

        // Step 2: 回放 journal
        // 进行中会话的增量由 journal 完整记录（checkpoint 只固化历史累计、不清空 journal）。
        // ★ 修复：回放时长必须落成按自然日切分的 finished TimeSession 并入 sessions[]，
        //   否则 totalMs 虽恢复，今日/近7天/周报等按日统计在重载后会丢失该段时长。
        //   片段按时间连续性分组（间隔 > JOURNAL_RUN_GAP_MS 视为断点，如系统休眠），
        //   每组合成会话；组内 durationMs 以墙钟跨度计（与按日归桶口径一致）。
        let journalReplayed = false;
        const journalExists = await this.journal.exists();
        if (journalExists) {
            let slices = await this.journal.readJournal();

            // ★ 幂等水位线：truncate 失败时 journal 会残留已回放过的切片，
            //   下次恢复若不拦截就会重复累计（数据翻倍）。上次恢复成功时会把
            //   已回放的最大时间戳记入 metadata.lastJournalTs，此处据此跳过旧切片。
            const watermark = Number(data.metadata?.['lastJournalTs'] ?? 0);
            if (watermark > 0) {
                const before = slices.length;
                slices = slices.filter(s => s.timestamp > watermark);
                if (slices.length < before) {
                    log(LogLevel.Warn,
                        `StorageCoordinator: skipped ${before - slices.length} already-replayed journal slice(s) ` +
                        `(watermark=${watermark}) — previous truncate likely failed`);
                }
            }

            if (slices.length > 0) {
                const journalDelta = slices.reduce((sum, s) => sum + s.deltaMs, 0);
                data.totalMs += journalDelta;
                journalReplayed = true;

                const runs: { startMs: number; endMs: number }[] = [];
                for (const s of slices) {
                    const start = s.timestamp - s.deltaMs;
                    const last = runs[runs.length - 1];
                    if (last && start <= last.endMs + JOURNAL_RUN_GAP_MS) {
                        last.endMs = Math.max(last.endMs, s.timestamp);
                    } else {
                        runs.push({ startMs: start, endMs: s.timestamp });
                    }
                }
                let synthesized = 0;
                for (const run of runs) {
                    const segs = TimeAggregator.splitByNaturalDay(run.startMs, run.endMs);
                    data.sessions.push(...segs);
                    // ★ 合成段同步入日桶：折叠层与原始层口径一致
                    data.dailyTotals = addSegsToDaily(data.dailyTotals, segs);
                    synthesized += segs.length;
                }

                log(LogLevel.Info,
                    `StorageCoordinator: replayed ${slices.length} journal entries, +${journalDelta}ms, ` +
                    `synthesized ${synthesized} session segment(s)`);
            }

            // 记录回放水位线（无论本次是否有新切片，都推进到 journal 最新时间戳），
            // 即使下方 truncate 失败，下次恢复也能据此去重。
            const maxTs = slices.reduce((max, s) => Math.max(max, s.timestamp), 0);
            if (maxTs > 0) {
                data.metadata = { ...data.metadata, lastJournalTs: String(maxTs) };
            }

            // truncate 失败会抛出（IJournalStore 契约）：捕获告警但继续激活——
            // 水位线已写入 data 并将随本次 save 持久化，残留切片不会造成重复累计。
            try {
                await this.journal.truncate();
            } catch (err) {
                log(LogLevel.Error,
                    'StorageCoordinator: journal truncate FAILED — residual slices will be ' +
                    'deduplicated via metadata.lastJournalTs on next recovery', err as Error);
            }
        }

        // Step 3: 补偿未完成会话
        // 仅当 journal 无有效回放且存在进行中会话时，才用起止时间差兜底补偿，
        // 避免与 journal 回放对同一时段重复累计（"三重计数"修复）。
        if (!journalReplayed && data.currentSessionStartMs > 0) {
            const now = Date.now();
            const elapsed = now - data.currentSessionStartMs;
            if (elapsed > 0 && elapsed < CRASH_COMPENSATION_CAP_MS) { // 最多补偿 24h，防止异常
                data.totalMs += elapsed;
                // ★ 补偿时长同样落成按日会话，保证日报/周报口径一致（并同步入日桶）
                const segs = TimeAggregator.splitByNaturalDay(data.currentSessionStartMs, now);
                data.sessions.push(...segs);
                data.dailyTotals = addSegsToDaily(data.dailyTotals, segs);
                log(LogLevel.Info,
                    `StorageCoordinator: compensated unfinished session: +${elapsed}ms`);
            }
        }

        // 重置会话状态
        data.currentSessionStartMs = 0;
        data.lastSavedAtMs = Date.now();
        data.version = LATEST_VERSION;

        // 写回存储（恢复属关键事件，强制落 JSON 备份）
        await this.save(data, true);

        log(LogLevel.Info,
            `StorageCoordinator: recovery complete, totalMs=${data.totalMs}`);
        return data;
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

    /** 读取数据（不执行恢复，仅加载当前持久化状态） */
    async load(): Promise<WorkspaceTimingData | null> {
        let data = await this.primary.load();
        if (!data) {
            data = await this.fileBackup.load();
        }
        return data;
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

    /** 主备份文件 URI（供还原命令默认定位文件对话框） */
    getBackupUri(): vscode.Uri {
        return this.fileBackup.uri;
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
