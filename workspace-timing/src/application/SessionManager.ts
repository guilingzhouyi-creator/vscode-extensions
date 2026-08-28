/**
 * SessionManager — 会话生命周期管理
 *
 * 职责：开始/结束会话、持久化、崩溃恢复入口协调
 * 边界：不关心禁用策略，由 TimerOrchestrator 控制调用时机
 */

import { TimerEngine, TimerSnapshot } from '../domain/TimerEngine';
import { WorkspaceTimingData, TimeSession } from '../domain/models';
import { TimeAggregator, parseLocalDate } from '../domain/TimeAggregator';
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

    /** 运行期热更新会话历史上限（0 = 不限） */
    get maxSessionsLimit(): number {
        return this.maxSessions;
    }

    /** 原始会话保留窗（供 orchestrator 迁移/还原路径复用同一参数） */
    get rawRetentionDays(): number {
        return this._rawRetentionDays;
    }

    /**
     * 双阈值折叠过期与溢出容量的会话进 dailyTotals 沉淀层（无损回收、幂等）。
     * 无过期或溢出会话时不写回、不触发任何存盘。
     */
    foldIfNeeded(): void {
        const data = this.timer.data;
        const res = migrateToFolded(
            { sessions: data.sessions as TimeSession[], dailyTotals: data.dailyTotals },
            { retentionDays: this._rawRetentionDays, maxSessions: this.maxSessions },
        );
        if (res.foldedSessionCount === 0) return;
        this.timer.replaceData({
            ...data,
            sessions: res.sessions,
            dailyTotals: res.dailyTotals,
        });
        log(LogLevel.Info,
            `SessionManager: folded ${res.foldedSessionCount} expired/overflow session(s) into ` +
            `${Object.keys(res.dailyTotals).length} daily bucket(s)`);
    }

    /** 是否处于活跃会话中 */
    get isSessionActive(): boolean {
        return this._sessionActive;
    }

    /** 运行期热更新会话历史上限（0 = 不限），立即触发容量自动回收 */
    setMaxSessions(maxSessions: number): void {
        this.maxSessions = maxSessions;
        this.foldIfNeeded();
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

        // 1. 崩溃恢复（含 v1→v2 迁移与双阈值会话折叠），算法编排见 RecoveryService
        const data = await this.recovery.recover(this._rawRetentionDays, this.maxSessions);

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

        // 3. 自动折叠（双阈值无损回收：时间保留窗 + 容量上限）
        this.foldIfNeeded();

        // 4. 全量存盘（数据已由 timer.stop() 更新，创建副本避免引用问题；会话结束属关键事件，强制 JSON 备份）
        const finalData: WorkspaceTimingData = {
            ...this.timer.data,
            sessions: [...this.timer.data.sessions],
        };
        await this.storage.save(finalData, true);

        // 5. 清空 journal（await 确保退出路径上 truncate 落盘）
        await this.journal.truncate();

        const foldedCount = Object.values(this.timer.data.dailyTotals ?? {})
            .reduce((sum, b) => sum + (b.sessionCount || 0), 0);
        const result: SessionResult = {
            elapsedMs: elapsed,
            totalMs: this.timer.data.totalMs,
            sessionCount: foldedCount + this.timer.data.sessions.length,
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

        // 周期性双阈值自动折叠回收（会话溢出容量时立即折叠，或每 50 次检查点 ≈50 分钟执行一次）
        if ((this.maxSessions > 0 && this.timer.data.sessions.length > this.maxSessions) ||
            ++this._checkpointCount % 50 === 0) {
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

    /**
     * 跨午夜自然日会话切分与轮转：
     * 状态栏/心跳检测到自然日更替时调用，将昨日部分封存，今日部分清零起计，
     * 保证状态栏今日时长、今日明细与 Windows 本地操作系统时间绝对对齐。
     */
    async rotateSessionAtMidnight(): Promise<void> {
        if (!this._sessionActive) return;

        const today = TimeAggregator.todayStr();
        const todayZeroMs = parseLocalDate(today);

        log(LogLevel.Info, `SessionManager: rotating session at midnight (${today})`);
        this.timer.rotateSession(todayZeroMs);
        this.invalidateTodayCache();
        this.foldIfNeeded();

        // ★ 崩溃恢复双重计数修复：封存段已计入 totalMs 并即将随本次落盘固化，但
        //   journal 仍保留封存段对应的时间片（journal 仅在会话结束/恢复时截断）。
        //   若不推进水位线，崩溃恢复回放 journal 会把封存段再次累加（totalMs 双计，
        //   跨午夜/休眠后崩溃恢复时长虚高）。此处将水位线推进到轮转边界：
        //   恢复时跳过 timestamp ≤ 边界的旧切片，仅回放新会话段的增量。
        this.advanceJournalWatermark(todayZeroMs);

        const snap = this.timer.snapshot();
        const data: WorkspaceTimingData = {
            ...this.timer.data,
            totalMs: snap.totalMs,
            lastSavedAtMs: Date.now(),
            sessions: [...this.timer.data.sessions],
        };
        await this.storage.save(data);
    }

    /**
     * 系统休眠/挂起恢复处理：
     * 当检测到心跳间隔异常（系统曾休眠/盒盖），封存休眠前时长，休眠期间不计入时长，
     * 并将唤醒时刻作为新会话起点，彻底消除夜间休眠导致次日今日时长虚高的问题。
     */
    async handleSystemResume(sleepStartMs: number, resumeMs: number): Promise<void> {
        if (!this._sessionActive) return;

        log(LogLevel.Info, `SessionManager: handling system resume (gap=${resumeMs - sleepStartMs}ms)`);
        this.timer.resumeFromSleep(sleepStartMs, resumeMs);
        this.invalidateTodayCache();
        this.foldIfNeeded();

        // ★ 崩溃恢复双重计数修复（同 rotateSessionAtMidnight）：休眠前封存段已计入
        //   totalMs 并即将落盘，但 journal 仍保留其时间片。推进水位线到唤醒时刻，
        //   恢复时跳过 ≤ resumeMs 的旧切片，避免封存段在崩溃恢复回放时被再次累计。
        this.advanceJournalWatermark(resumeMs);

        const snap = this.timer.snapshot();
        const data: WorkspaceTimingData = {
            ...this.timer.data,
            totalMs: snap.totalMs,
            lastSavedAtMs: resumeMs,
            sessions: [...this.timer.data.sessions],
        };
        await this.storage.save(data);
    }

    /**
     * 推进 journal 回放水位线到新会话段起点（跨午夜轮转边界 / 休眠唤醒时刻）。
     *
     * 背景：journal 仅在会话结束 / 崩溃恢复 / 还原时截断。跨午夜轮转与休眠恢复会把
     * 封存段累入 totalMs 并落盘，但 journal 中对应时间片仍然保留——若水位线不推进，
     * 崩溃恢复回放时会把封存段再次累加（双重计数，时长虚高）。
     *
     * ⚠️ 必须同时写回 timer.data：后续 saveCheckpoint 从 timer.data 重建数据并落盘，
     * 若只改局部 data 对象，下一次全量存盘会把推进后的水位线覆盖丢失。
     */
    private advanceJournalWatermark(boundaryMs: number): void {
        this.timer.replaceData({
            ...this.timer.data,
            metadata: { ...this.timer.data.metadata, lastJournalTs: String(boundaryMs) },
        });
    }
}
