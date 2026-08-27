/**
 * SessionManager — 会话生命周期管理
 *
 * 职责：开始/结束会话、持久化、崩溃恢复入口协调
 * 边界：不关心禁用策略，由 TimerOrchestrator 控制调用时机
 */

import { TimerEngine, TimerSnapshot } from '../domain/TimerEngine';
import { WorkspaceTimingData, TimeSession } from '../domain/models';
import { TimeAggregator } from '../domain/TimeAggregator';
import { migrateToFolded } from '../domain/HistoryFolder';
import { StorageCoordinator } from '../persistence/StorageCoordinator';
import { JournalWriter } from '../cache/JournalWriter';
import { RecoveryService } from './RecoveryService';
import { LogLevel, log } from '../integration/Logger';

export interface SessionResult {
    /** 本次会话历时 (ms) */
    elapsedMs: number;
    /** 累计总时长 (ms) */
    totalMs: number;
    /** 会话记录数 */
    sessionCount: number;
}

export class SessionManager {
    private readonly timer: TimerEngine;
    private readonly storage: StorageCoordinator;
    private readonly journal: JournalWriter;
    private readonly recovery: RecoveryService;
    private maxSessions: number;
    /** 原始会话保留窗（天）；0=永不折叠 */
    private readonly _rawRetentionDays: number;
    /** checkpoint 计数：折叠按低频节流执行 */
    private _checkpointCount = 0;
    private _sessionActive: boolean = false;

    constructor(
        timer: TimerEngine,
        storage: StorageCoordinator,
        journal: JournalWriter,
        recovery: RecoveryService,
        maxSessions: number = 1000,
        historyRawRetentionDays: number = 45,
    ) {
        this.timer = timer;
        this.storage = storage;
        this.journal = journal;
        this.recovery = recovery;
        this.maxSessions = maxSessions;
        this._rawRetentionDays = historyRawRetentionDays;
    }

    /** 原始会话保留窗（供 orchestrator 迁移/还原路径复用同一参数） */
    get rawRetentionDays(): number {
        return this._rawRetentionDays;
    }

    /**
     * 折叠过期会话进 dailyTotals 沉淀层（幂等）。
     * 无过期会话时不写回、不触发任何存盘。
     */
    foldIfNeeded(): void {
        const data = this.timer.data;
        const res = migrateToFolded(
            { sessions: data.sessions as TimeSession[], dailyTotals: data.dailyTotals },
            this._rawRetentionDays,
        );
        if (res.foldedSessionCount === 0) return;
        this.timer.replaceData({
            ...data,
            sessions: res.sessions,
            dailyTotals: res.dailyTotals,
        });
        log(LogLevel.Info,
            `SessionManager: folded ${res.foldedSessionCount} expired session(s) into ` +
            `${Object.keys(res.dailyTotals).length} daily bucket(s)`);
    }

    /** 是否处于活跃会话中 */
    get isSessionActive(): boolean {
        return this._sessionActive;
    }

    /** 运行期热更新会话历史上限（0 = 不限） */
    setMaxSessions(maxSessions: number): void {
        this.maxSessions = maxSessions;
    }

    /**
     * 使今日累计缓存失效。
     * reset/newPeriod/崩溃恢复等数据清空或替换场景必须调用，
     * 否则 3s TTL 内 getTodayMs 会返回基于旧 sessions 的过期值。
     */
    invalidateTodayCache(): void {
        this._todayCacheAt = 0;
        this._todayCacheValue = 0;
    }

    /** 获取计时器快照 */
    get snapshot(): TimerSnapshot {
        return this.timer.snapshot();
    }

    /**
     * 执行崩溃恢复并开始新会话
     * 这是启动路径的核心方法
     */
    async startSession(): Promise<WorkspaceTimingData> {
        log(LogLevel.Info, 'SessionManager: starting session');

        // 1. 崩溃恢复（含 v1→v2 迁移与过期会话折叠），算法编排见 RecoveryService
        const data = await this.recovery.recover(this._rawRetentionDays);

        // 2. 替换计时器数据
        this.timer.replaceData(data);
        // 数据被恢复结果整体替换，今日缓存必须失效
        this.invalidateTodayCache();

        // 3. 开始计时
        this.timer.start();
        this._sessionActive = true;

        log(LogLevel.Info, `SessionManager: session started, base totalMs=${data.totalMs}`);
        return data;
    }

    /**
     * 结束当前会话
     * 执行最终存盘并清空 journal
     */
    async endSession(): Promise<SessionResult> {
        if (!this._sessionActive) {
            return { elapsedMs: 0, totalMs: this.timer.data.totalMs, sessionCount: 0 };
        }

        log(LogLevel.Info, 'SessionManager: ending session');

        // 1. 强制 flush 所有缓存数据到 journal
        const flushedCount = await this.journal.flushAll();
        if (flushedCount > 0) {
            log(LogLevel.Debug, `SessionManager: flushed ${flushedCount} slices before stop`);
        }

        // 2. 停止计时器
        const elapsed = this.timer.stop();
        this._sessionActive = false;

        // 3. 裁剪会话列表（使用用户配置的 maxSessions，0=不限）
        this.timer.trimSessions(this.maxSessions);

        // 3.5 折叠过期会话进日桶（历史治理）
        this.foldIfNeeded();

        // 4. 全量存盘（数据已由 timer.stop() 更新，创建副本避免引用问题；会话结束属关键事件，强制 JSON 备份）
        const finalData: WorkspaceTimingData = {
            ...this.timer.data,
            sessions: [...this.timer.data.sessions],
        };
        await this.storage.save(finalData, true);

        // 5. 清空 journal（await 确保退出路径上 truncate 落盘）
        await this.journal.truncate();

        const result: SessionResult = {
            elapsedMs: elapsed,
            totalMs: this.timer.data.totalMs,
            sessionCount: this.timer.data.sessions.length,
        };

        log(LogLevel.Info,
            `SessionManager: session ended, elapsed=${elapsed}ms, total=${this.timer.data.totalMs}ms`);
        return result;
    }

    /** 今日累计缓存的刷新间隔：状态栏每秒读取，聚合为 O(全部会话) 扫描，用短 TTL 抑制重复计算 */
    private static readonly TODAY_CACHE_TTL_MS = 3000;
    private _todayCacheAt = 0;
    private _todayCacheValue = 0;

    /**
     * 获取今日累计时长 (ms)
     * 带 3s TTL 缓存：跨午夜时缓存值最多滞后 3 秒自然切换（对秒级展示无感知）。
     */
    getTodayMs(): number {
        const now = Date.now();
        if (now - this._todayCacheAt >= SessionManager.TODAY_CACHE_TTL_MS) {
            this._todayCacheValue = TimeAggregator.todayMs(
                this.timer.data.sessions,
                this.timer.data.currentSessionStartMs,
            );
            this._todayCacheAt = now;
        }
        return this._todayCacheValue;
    }

    /**
     * 仅保存当前状态（不结束会话）
     * 由 Scheduler 周期性调用。
     *
     * ⚠️ 必须创建数据副本，不能修改计时器内部 totalMs，
     *    否则会与 stop() 中的累加逻辑产生重复计时。
     *
     * ⚠️ 崩溃恢复"三重计数"修复：主存储的 totalMs 只固化**已结束会话的累计**
     *   （snap.totalMs，不含进行中会话的实时时长）。进行中会话的时长由 journal 增量
     *   完整记录（checkpoint 不清空 journal），崩溃恢复时通过回放 journal 重建；
     *   journal 无有效回放时才用"补偿未完成会话"兜底。
     *   这避免了原实现（固化 currentTotalMs + journal 回放 + 补偿三者叠加）对同一
     *   会话时段重复累计的缺陷。
     */
    async saveCheckpoint(): Promise<void> {
        const snap = this.timer.snapshot();

        // 周期性裁剪会话历史（此前仅在 endSession 时裁剪，长期不结束会话会无限增长）
        this.timer.trimSessions(this.maxSessions);

        // 低频折叠：每 50 次 checkpoint（≈50 分钟）执行一次过期会话折叠
        if (++this._checkpointCount % 50 === 0) {
            this.foldIfNeeded();
        }

        const data: WorkspaceTimingData = {
            ...this.timer.data,
            totalMs: snap.totalMs,
            lastSavedAtMs: Date.now(),
            sessions: [...this.timer.data.sessions],
        };

        // 进行中会话增量保留在 journal（供崩溃恢复回放），这里不清空
        await this.storage.save(data);
        log(LogLevel.Debug, `SessionManager: checkpoint saved, totalMs=${snap.totalMs}`);
    }
}
