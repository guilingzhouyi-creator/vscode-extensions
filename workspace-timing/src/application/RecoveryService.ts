/**
 * RecoveryService — 崩溃恢复编排（应用层）
 *
 * 职责：把"加载主数据 → 迁移折叠 → 回放 journal → 补偿未完成会话"的
 *       恢复算法从持久化层上移到应用层——持久化层只提供原始读写原语，
 *       领域规则（自然日切段、日桶归并、折叠迁移、水位线去重）全部由
 *       应用层与领域层持有。
 *
 * 边界：不依赖 VS Code API；数据加载与最终落盘经 IRecoveryStore 端口注入，
 *       journal 读写经 IJournalStore 端口注入（均为纯 Node 可测的窄接口）。
 *
 * 算法（与历史 v0.4.x 行为逐字等价，仅职责迁移）：
 *   Step 1   ：从主存储加载；不可用则 fallback 到文件备份；再不可用则全新开始
 *   Step 1.5 ：v1→v2 迁移 + 过期会话折叠（幂等）
 *   Step 2   ：回放 journal（按连续性分组合成会话段，同步入日桶，水位线去重）
 *   Step 3   ：仅当 journal 无有效回放且存在进行中会话时，补偿未完成会话历时
 *   Step 4   ：重置会话状态并写回存储
 */

import {
    WorkspaceTimingData,
    createEmptyTimingData,
    LATEST_VERSION,
    MS_PER_DAY,
    DailyTotalsMap,
    TimeSlice,
} from '../domain/models';
import { TimeAggregator, localDateStr } from '../domain/TimeAggregator';
import { migrateToFolded } from '../domain/HistoryFolder';
import { IJournalStore } from '../cache/IJournalStore';
import { LogLevel, log } from '../integration/Logger';

/** journal 片段分组断点阈值：相邻片段起始间隔超过该值视为中断（如系统休眠） */
const JOURNAL_RUN_GAP_MS = 60000;

/** 主数据源端口（StorageCoordinator 天然满足：load=主存+文件兜底并报告来源，save=级联落盘） */
export interface IRecoveryStore {
    load(): Promise<{ data: WorkspaceTimingData | null; source: string }>;
    save(data: WorkspaceTimingData, forceFileBackup?: boolean): Promise<void>;
}

/** 合成会话段累入日桶（每段视为一条独立记录，计数记入段起始日） */
function addSegsToDaily(totals: DailyTotalsMap | undefined,
    segs: { startMs: number; durationMs: number }[]): DailyTotalsMap {
    const map: DailyTotalsMap = totals ? { ...totals } : {};
    for (const seg of segs) {
        const key = localDateStr(seg.startMs);
        const bucket = map[key] ?? { totalMs: 0, sessionCount: 0 };
        bucket.totalMs += seg.durationMs;
        bucket.sessionCount += 1;
        map[key] = bucket;
    }
    return map;
}

export class RecoveryService {
    private readonly store: IRecoveryStore;
    private readonly journal: IJournalStore;

    constructor(store: IRecoveryStore, journal: IJournalStore) {
        this.store = store;
        this.journal = journal;
    }

    /**
     * 执行崩溃恢复流程：
     *   1. 读取主存储（内存/文件）
     *   1.5. v1→v2 迁移 + 双阈值会话折叠（时间窗 + 容量上限）
     *   2. 读取 journal 并做幂等水位线去重
     *   3. 回放 journal（合成段同步入桶）
     *   4. 补偿未完成会话
     */
    async recover(retentionDays = 45, maxSessions = 1000): Promise<WorkspaceTimingData> {
        log(LogLevel.Info, 'RecoveryService: crash recovery started');

        // Step 1: 加载主数据
        const loaded = await this.store.load();
        const data = loaded.data ?? createEmptyTimingData();
        const source = loaded.source;

        if (!loaded.data) {
            log(LogLevel.Info, `RecoveryService: no existing data, starting fresh`);
        } else {
            log(LogLevel.Info, `RecoveryService: loaded from ${source}, totalMs=${data.totalMs}`);
        }

        // Step 1.5: v1→v2 迁移 + 双阈值会话折叠（幂等）
        const migrated = migrateToFolded(data, { retentionDays, maxSessions });
        if (migrated.foldedSessionCount > 0) {
            log(LogLevel.Info,
                `RecoveryService: folded ${migrated.foldedSessionCount} expired/overflow session(s) ` +
                `into ${Object.keys(migrated.dailyTotals).length} daily bucket(s)`);
        }
        data.sessions = migrated.sessions;
        data.dailyTotals = migrated.dailyTotals;

        // Step 2: 回放 journal
        const journalReplayed = await this.replayJournal(data);

        // Step 3: 补偿未完成会话
        this.compensateUnfinishedSession(data, journalReplayed);

        // 若回放或补偿后会话超出容量上限，再次执行折叠收敛
        if (maxSessions > 0 && data.sessions.length > maxSessions) {
            const finalFold = migrateToFolded(data, { retentionDays, maxSessions });
            data.sessions = finalFold.sessions;
            data.dailyTotals = finalFold.dailyTotals;
        }

        // Step 4: 重置会话状态并写回存储（恢复属关键事件，强制落 JSON 备份）
        data.currentSessionStartMs = 0;
        data.lastSavedAtMs = Date.now();
        data.version = LATEST_VERSION;

        await this.store.save(data, true);

        log(LogLevel.Info,
            `RecoveryService: recovery complete, totalMs=${data.totalMs}`);
        return data;
    }

    /**
     * 将按时间连续性分组的切片段合成并入 sessions 与 dailyTotals
     */
    private applyJournalSlices(data: WorkspaceTimingData, slices: TimeSlice[]): void {
        const journalDelta = slices.reduce((sum, s) => sum + s.deltaMs, 0);
        data.totalMs += journalDelta;

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
            data.dailyTotals = addSegsToDaily(data.dailyTotals, segs);
            synthesized += segs.length;
        }

        log(LogLevel.Info,
            `RecoveryService: replayed ${slices.length} journal entries, +${journalDelta}ms, ` +
            `synthesized ${synthesized} session segment(s)`);
    }

    /**
     * 回放 journal 并执行幂等水位线过滤与自然日切分
     */
    private async replayJournal(data: WorkspaceTimingData): Promise<boolean> {
        if (!await this.journal.exists()) {
            return false;
        }

        let slices = await this.journal.readJournal();
        const watermark = Number(data.metadata?.['lastJournalTs'] ?? 0);
        if (watermark > 0) {
            const before = slices.length;
            slices = slices.filter(s => s.timestamp > watermark);
            if (slices.length < before) {
                log(LogLevel.Warn,
                    `RecoveryService: skipped ${before - slices.length} already-replayed journal slice(s) ` +
                    `(watermark=${watermark}) — previous truncate likely failed`);
            }
        }

        const journalReplayed = slices.length > 0;
        if (journalReplayed) {
            this.applyJournalSlices(data, slices);
        }

        const maxTs = slices.reduce((max, s) => Math.max(max, s.timestamp), 0);
        if (maxTs > 0) {
            data.metadata = { ...data.metadata, lastJournalTs: String(maxTs) };
        }

        try {
            await this.journal.truncate();
        } catch (err) {
            log(LogLevel.Error,
                'RecoveryService: journal truncate FAILED — residual slices will be ' +
                'deduplicated via metadata.lastJournalTs on next recovery', err as Error);
        }

        return journalReplayed;
    }

    /**
     * 补偿未完成会话
     */
    private compensateUnfinishedSession(data: WorkspaceTimingData, journalReplayed: boolean): void {
        if (journalReplayed || data.currentSessionStartMs <= 0) {
            return;
        }

        const now = Date.now();
        const totalElapsed = now - data.currentSessionStartMs;
        if (totalElapsed <= 0 || totalElapsed >= MS_PER_DAY) {
            return;
        }

        const lastSaved = data.lastSavedAtMs > data.currentSessionStartMs
            ? data.lastSavedAtMs
            : data.currentSessionStartMs;
        const maxCompensatedEnd = Math.min(now, lastSaved + 60000);
        const elapsed = maxCompensatedEnd - data.currentSessionStartMs;
        if (elapsed > 0) {
            data.totalMs += elapsed;
            const segs = TimeAggregator.splitByNaturalDay(data.currentSessionStartMs, maxCompensatedEnd);
            data.sessions.push(...segs);
            data.dailyTotals = addSegsToDaily(data.dailyTotals, segs);
            log(LogLevel.Info,
                `RecoveryService: compensated unfinished session: +${elapsed}ms`);
        }
    }
}
