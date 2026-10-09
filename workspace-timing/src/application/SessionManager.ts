/**
 * SessionManager — 会话生命周期管理
 *
 * 职责：开始/结束会话、持久化、崩溃恢复入口协调
 * 边界：不关心禁用策略，由 TimerOrchestrator 控制调用时机
 */

import { TimerEngine, TimerSnapshot } from '../domain/TimerEngine';
import {
    WorkspaceTimingData,
    ActivityMode,
    DEFAULT_RAW_RETENTION_DAYS,
    DEFAULT_SESSION_CAP,
    MAX_SESSIONS_PER_DAY,
    FOLD_CHECKPOINT_MOD,
} from '../domain/models';
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
    /** 原始会话保留窗（天）；0=不折叠 */
    private readonly _rawRetentionDays: number;
    /** checkpoint 计数：折叠按低频节流执行 */
    private _checkpointCount = 0;
    private _sessionActive: boolean = false;

    constructor(
        timer: TimerEngine,
        storage: StorageCoordinator,
        journal: JournalWriter,
        recovery: RecoveryService,
        maxSessions: number = DEFAULT_SESSION_CAP,
        historyRawRetentionDays: number = DEFAULT_RAW_RETENTION_DAYS,
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
     * 自动回收与折叠：
     * 1. 跨周归零（旧周全条目沉淀入 dailyTotals）；
     * 2. 单日上限截断（每日最高 20 条，淘汰最远条目入 dailyTotals）；
     * 3. 双阈值折叠过期与溢出容量的会话进 dailyTotals 沉淀层（无损回收、幂等）。
     */
    foldIfNeeded(): void {
        const data = this.timer.data;
        const foldResult = migrateToFolded(
            {
                sessions: data.sessions,
                idleSessions: data.idleSessions,
                dailyTotals: data.dailyTotals,
            },
            {
                retentionDays: this._rawRetentionDays,
                maxSessions: this.maxSessions,
                maxPerDay: MAX_SESSIONS_PER_DAY,
                pruneWeekly: true,
            },
        );
        if (foldResult.foldedSessionCount === 0 && foldResult.foldedIdleCount === 0) return;
        this.timer.replaceData({
            ...data,
            sessions: foldResult.sessions,
            idleSessions: foldResult.idleSessions,
            dailyTotals: foldResult.dailyTotals,
        });
        log(
            LogLevel.Info,
            `SessionManager: folded ${foldResult.foldedSessionCount} session(s) and ` +
                `${foldResult.foldedIdleCount} idle session(s) into ` +
                `${Object.keys(foldResult.dailyTotals).length} daily bucket(s)`,
        );
    }

    /**
     * 显式触发会话生命周期自动回收。
     */
    autoRecycleSessions(): void {
        this.foldIfNeeded();
    }

    /** 是否处于活跃会话中 */
    get isSessionActive(): boolean {
        return this._sessionActive;
    }

    /**
     * 运行期热更新会话历史保留条数上限（0 = 不限）。
     */
    setMaxSessions(maxSessions: number): void {
        this.maxSessions = maxSessions;
        this.foldIfNeeded();
    }

    /** 获取计时器快照 */
    get snapshot(): TimerSnapshot {
        return this.timer.snapshot();
    }

    /**
     * 执行崩溃恢复流程并开启当前工作区新会话。
     */
    async startSession(): Promise<WorkspaceTimingData> {
        log(LogLevel.Info, 'SessionManager: starting session');

        // 1. 崩溃恢复
        const data = await this.recovery.recover(this._rawRetentionDays, this.maxSessions);

        // 2. 替换计时器数据
        this.timer.replaceData(data);

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

        // 3. 自动折叠
        this.foldIfNeeded();

        // 4. 全量存盘（会话结束属关键事件，强制 JSON 备份）
        const finalData: WorkspaceTimingData = {
            ...this.timer.data,
            sessions: [...this.timer.data.sessions],
            metadata: { ...this.timer.data.metadata, lastJournalTs: 0 },
        };
        await this.storage.save(finalData, true);

        // 5. 清空 journal（await 确保退出路径上 truncate 落盘）
        await this.journal.truncate();

        const foldedCount = Object.values(this.timer.data.dailyTotals ?? {}).reduce(
            (sum, b) => sum + (b.sessionCount || 0),
            0,
        );
        const result: SessionResult = {
            elapsedMs: elapsed,
            totalMs: this.timer.data.totalMs,
            sessionCount: foldedCount + this.timer.data.sessions.length,
        };

        log(
            LogLevel.Info,
            `SessionManager: session ended, elapsed=${elapsed}ms, total=${this.timer.data.totalMs}ms`,
        );
        return result;
    }

    /**
     * 获取今日累计时长 (ms)——O(1)：直接读 TimerEngine 增量计数器
     */
    getTodayMs(): number {
        return this.timer.getTodayMs();
    }

    /**
     * 仅保存当前状态（不结束会话）
     * 由 Scheduler 周期性调用。
     */
    async saveCheckpoint(): Promise<void> {
        const snap = this.timer.snapshot();

        if (
            (this.maxSessions > 0 && this.timer.data.sessions.length > this.maxSessions) ||
            ++this._checkpointCount % FOLD_CHECKPOINT_MOD === 0
        ) {
            this.foldIfNeeded();
        }

        const data: WorkspaceTimingData = {
            ...this.timer.data,
            totalMs: snap.totalMs,
            lastSavedAtMs: Date.now(),
            sessions: [...this.timer.data.sessions],
        };

        await this.storage.save(data);
        log(LogLevel.Debug, `SessionManager: checkpoint saved, totalMs=${snap.totalMs}`);
    }

    /**
     * 跨午夜自然日会话切分与轮转
     */
    async rotateSessionAtMidnight(): Promise<void> {
        if (!this._sessionActive) return;

        const today = TimeAggregator.todayStr();
        const todayZeroMs = parseLocalDate(today);

        log(LogLevel.Info, `SessionManager: rotating session at midnight (${today})`);
        this.timer.rotateSession(todayZeroMs);
        this.foldIfNeeded();

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
     * 系统休眠/挂起恢复处理
     */
    async handleSystemResume(sleepStartMs: number, resumeMs: number): Promise<void> {
        if (!this._sessionActive) return;

        log(LogLevel.Info, `SessionManager: handling system resume (gap=${resumeMs - sleepStartMs}ms)`);
        this.timer.resumeFromSleep(sleepStartMs, resumeMs);
        this.foldIfNeeded();

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
     * 推进 journal 回放水位线（数值类型安全）
     */
    private advanceJournalWatermark(boundaryMs: number): void {
        this.timer.replaceData({
            ...this.timer.data,
            sessions: [...this.timer.data.sessions],
            metadata: { ...this.timer.data.metadata, lastJournalTs: String(boundaryMs) },
        });
    }

    /** 是否正处于空闲离开暂停态 */
    get isPausedIdle(): boolean {
        return this.timer.isPausedIdle;
    }

    /** 当前活动模式 */
    get currentMode(): ActivityMode {
        return this.timer.currentMode;
    }

    /** 切换活动模式 */
    switchMode(mode: ActivityMode): void {
        this.timer.switchMode(mode);
    }

    /**
     * 处理空闲超时自动暂停：追溯截断至离开时刻
     */
    async handleIdlePause(idleStartMs: number): Promise<void> {
        if (!this._sessionActive) return;
        log(LogLevel.Info, `SessionManager: handling idle pause (retroactive to ${idleStartMs})`);

        this.timer.pauseForIdle(idleStartMs);
        this.foldIfNeeded();
        this.advanceJournalWatermark(idleStartMs);

        await this.journal.truncate();
        await this.saveCheckpoint();
    }

    /**
     * 处理空闲唤醒恢复
     */
    async handleIdleResume(resumeMs: number, idleStartMs: number = 0): Promise<void> {
        if (!this._sessionActive) return;
        log(LogLevel.Info, `SessionManager: handling idle resume (at ${resumeMs})`);

        this.timer.resumeFromIdle(resumeMs, idleStartMs);
        this.advanceJournalWatermark(resumeMs);
        await this.saveCheckpoint();
    }

    /** 获取今日手动工时 */
    getTodayManualMs(): number {
        return this.timer.getTodayManualMs();
    }

    /** 获取今日 AI 工时 */
    getTodayAiMs(): number {
        return this.timer.getTodayAiMs();
    }

    /** 获取今日空闲离开工时 */
    getTodayIdleMs(): number {
        return this.timer.getTodayIdleMs();
    }
}
