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
    CRASH_COMPENSATION_CAP_MS,
    DailyTotalsMap,
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
     * 完整崩溃恢复 + 数据加载
     *
     * 四步走：
     *   1. 加载主存储 → fallback JSON
     *   2. v1→v2 迁移 + 过期会话折叠进 dailyTotals（幂等）
     *   3. 回放 journal（合成段同步入桶）
     *   4. 补偿未完成会话
     */
    async recover(retentionDays = 45): Promise<WorkspaceTimingData> {
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

        // Step 1.5: v1→v2 迁移 + 过期会话折叠（幂等，retention<=0 时仅补空表）
        const migrated = migrateToFolded(data, retentionDays);
        if (migrated.foldedSessionCount > 0) {
            log(LogLevel.Info,
                `RecoveryService: folded ${migrated.foldedSessionCount} expired session(s) ` +
                `into ${Object.keys(migrated.dailyTotals).length} daily bucket(s)`);
        }
        data.sessions = migrated.sessions;
        data.dailyTotals = migrated.dailyTotals;

        // Step 2: 回放 journal
        // 进行中会话的增量由 journal 完整记录（checkpoint 只固化历史累计、不清空 journal）。
        // ★ 回放时长必须落成按自然日切分的 finished TimeSession 并入 sessions[]，
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
                        `RecoveryService: skipped ${before - slices.length} already-replayed journal slice(s) ` +
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
                    `RecoveryService: replayed ${slices.length} journal entries, +${journalDelta}ms, ` +
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
                    'RecoveryService: journal truncate FAILED — residual slices will be ' +
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
                    `RecoveryService: compensated unfinished session: +${elapsed}ms`);
            }
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
}