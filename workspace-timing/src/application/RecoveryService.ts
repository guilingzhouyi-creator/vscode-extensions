/**
 * RecoveryService — 崩溃恢复编排（应用层）
 *
 * 职责：把"加载主数据 → 迁移折叠 → 回放 journal → 补偿未完成会话"的
 *       恢复算法从持久化层上移到应用层——持久化层只提供原始读写原语，
 *       领域规则（自然日切段、日桶归并、折叠迁移、水位线去重）全部由
 *       应用层与领域层持有。
 *
 * 边界：不依赖 VS Code API；数据加载与最终落盘经 IRecoveryStore 端口注入，
 *       journal 读写经 IJournalStore 端口注入。
 */

import {
    WorkspaceTimingData,
    createEmptyTimingData,
    LATEST_VERSION,
    MS_PER_DAY,
    MS_PER_MINUTE,
    MS_PER_SECOND,
    DEFAULT_RAW_RETENTION_DAYS,
    DEFAULT_SESSION_CAP,
    DailyTotalsMap,
    TimeSlice,
} from '../domain/models';
import { TimeAggregator, localDateStr } from '../domain/TimeAggregator';
import { migrateToFolded } from '../domain/HistoryFolder';
import { IJournalStore } from '../cache/IJournalStore';
import { LogLevel, log } from '../integration/Logger';

/** 切片连续性判定容差：3 秒（心跳间隔 1s 的 3 倍） */
const SLICE_CONTINUITY_GAP_MS = 3 * MS_PER_SECOND;

/** 主数据源端口 */
export interface IRecoveryStore {
    load(): Promise<{ data: WorkspaceTimingData | null; source: string }>;
    save(data: WorkspaceTimingData, forceFileBackup?: boolean): Promise<void>;
}

/** 合成会话段累入日桶 */
function addSegsToDaily(
    totals: DailyTotalsMap | undefined,
    segs: { startMs: number; durationMs: number }[],
): DailyTotalsMap {
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
     *   1. 读取主存储（主存优先，文件备份兜底）
     *   2. 回放 journal 并做幂等水位线去重
     *   3. 补偿未完成会话
     *   4. 单阶段收敛双阈值会话折叠（时间窗 + 容量上限）
     *   5. 重置状态并强制落盘
     */
    async recover(
        retentionDays = DEFAULT_RAW_RETENTION_DAYS,
        maxSessions = DEFAULT_SESSION_CAP,
    ): Promise<WorkspaceTimingData> {
        log(LogLevel.Info, 'RecoveryService: crash recovery started');

        // Step 1: 加载主数据
        const loaded = await this.store.load();
        const data = loaded.data ?? createEmptyTimingData();
        const source = loaded.source;

        if (!loaded.data) {
            log(LogLevel.Info, 'RecoveryService: no existing data, starting fresh');
        } else {
            log(LogLevel.Info, `RecoveryService: loaded from ${source}, totalMs=${data.totalMs}`);
        }

        // Step 2: 回放 journal（增量日志回放）
        const journalReplayed = await this.replayJournal(data);

        // Step 3: 补偿未完成会话
        this.compensateUnfinishedSession(data, journalReplayed);

        // Step 4: 单阶段统一收敛折叠（消除双重折叠冗余）
        const folded = migrateToFolded(data, { retentionDays, maxSessions });
        if (folded.foldedSessionCount > 0) {
            log(
                LogLevel.Info,
                `RecoveryService: converged and folded ${folded.foldedSessionCount} expired/overflow session(s) ` +
                    `into ${Object.keys(folded.dailyTotals).length} daily bucket(s)`,
            );
        }
        data.sessions = folded.sessions;
        data.dailyTotals = folded.dailyTotals;

        // Step 5: 重置会话状态并写回存储（恢复属关键事件，强制落 JSON 备份）
        data.currentSessionStartMs = 0;
        data.lastSavedAtMs = Date.now();
        data.version = LATEST_VERSION;

        await this.store.save(data, true);

        log(LogLevel.Info, `RecoveryService: recovery complete, totalMs=${data.totalMs}`);
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
            if (last && start <= last.endMs + SLICE_CONTINUITY_GAP_MS) {
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

        log(
            LogLevel.Info,
            `RecoveryService: replayed ${slices.length} journal entries, +${journalDelta}ms, ` +
                `synthesized ${synthesized} session segment(s)`,
        );
    }

    /**
     * 回放 journal 并执行幂等水位线过滤与自然日切分
     */
    private async replayJournal(data: WorkspaceTimingData): Promise<boolean> {
        if (!(await this.journal.exists())) {
            return false;
        }

        let slices = await this.journal.readJournal();
        const watermark = Number(data.metadata?.lastJournalTs ?? 0);
        if (watermark > 0) {
            const before = slices.length;
            slices = slices.filter((s) => s.timestamp > watermark);
            if (slices.length < before) {
                log(
                    LogLevel.Warn,
                    `RecoveryService: skipped ${before - slices.length} already-replayed journal slice(s) ` +
                        `(watermark=${watermark}) — previous truncate likely failed`,
                );
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
            log(
                LogLevel.Error,
                'RecoveryService: journal truncate FAILED — residual slices will be ' +
                    'deduplicated via metadata.lastJournalTs on next recovery',
                err as Error,
            );
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

        const lastSaved =
            data.lastSavedAtMs > data.currentSessionStartMs ? data.lastSavedAtMs : data.currentSessionStartMs;
        const maxCompensatedEnd = Math.min(now, lastSaved + MS_PER_MINUTE);
        const elapsed = maxCompensatedEnd - data.currentSessionStartMs;
        if (elapsed > 0) {
            data.totalMs += elapsed;
            const segs = TimeAggregator.splitByNaturalDay(data.currentSessionStartMs, maxCompensatedEnd);
            data.sessions.push(...segs);
            data.dailyTotals = addSegsToDaily(data.dailyTotals, segs);
            log(LogLevel.Info, `RecoveryService: compensated unfinished session: +${elapsed}ms`);
        }
    }
}
