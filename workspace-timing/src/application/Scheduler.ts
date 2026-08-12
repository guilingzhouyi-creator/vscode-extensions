/**
 * Scheduler — 周期任务调度器
 *
 * 职责：
 *   1. 每 N 秒从 RingBuffer flush 到 journal
 *   2. 每 M 秒执行全量存盘 + journal truncate
 *   3. 每秒通知 StatusBar 更新
 *
 * 所有间隔可通过 TimingConfig 配置。
 *
 * ★ 修复（0.3.2）：updateIntervals 此前会「无脑重建全部 4 个定时器」，
 *   即便只是改了 enabled 这类与间隔无关的配置，也会打断所有定时器的相位并重建。
 *   现改为仅重启「间隔确实发生变化」的定时器，避免无谓的定时器抖动。
 */

import { JournalWriter } from '../cache/JournalWriter';
import { SessionManager } from './SessionManager';
import { LogLevel, log } from '../integration/Logger';
import {
    DEFAULT_HEARTBEAT_MS,
    DEFAULT_STATUS_BAR_MS,
    DEFAULT_JOURNAL_FLUSH_MS,
    DEFAULT_FULL_SAVE_MS,
} from '../domain/models';

export interface SchedulerOptions {
    /** journal flush 间隔 (ms) */
    journalFlushIntervalMs: number;
    /** 全量存盘间隔 (ms) */
    fullSaveIntervalMs: number;
    /** 状态栏更新间隔 (ms) — 独立于心跳计时器，通常 5s 足够 */
    statusBarUpdateIntervalMs: number;
    /** 心跳间隔 (ms) — 每秒推入时间片到 RingBuffer */
    heartbeatIntervalMs: number;
}

export interface StatusBarDisplayData {
    totalMs: number;
    todayMs: number;
}

export type StatusBarUpdateCallback = (data: StatusBarDisplayData) => void;
export type FullSaveCallback = () => void | Promise<void>;
/** 每秒心跳回调 — 供 ActivityTracker / IdleDetector 等消费 */
export type HeartbeatCallback = () => void;

export class Scheduler {
    private readonly journal: JournalWriter;
    private readonly sessionManager: SessionManager;
    private options: SchedulerOptions;

    private journalTimer: ReturnType<typeof setInterval> | null = null;
    private fullSaveTimer: ReturnType<typeof setInterval> | null = null;
    private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    private statusBarTimer: ReturnType<typeof setInterval> | null = null;
    private statusBarCallback: StatusBarUpdateCallback | null = null;
    private fullSaveCallback: FullSaveCallback | null = null;
    private heartbeatCallback: HeartbeatCallback | null = null;

    private _running: boolean = false;

    constructor(
        journal: JournalWriter,
        sessionManager: SessionManager,
        options?: Partial<SchedulerOptions>,
    ) {
        this.journal = journal;
        this.sessionManager = sessionManager;
        this.options = {
            journalFlushIntervalMs: DEFAULT_JOURNAL_FLUSH_MS,
            fullSaveIntervalMs: DEFAULT_FULL_SAVE_MS,
            heartbeatIntervalMs: DEFAULT_HEARTBEAT_MS,
            statusBarUpdateIntervalMs: DEFAULT_STATUS_BAR_MS,
            ...options,
        };
    }

    /** 是否正在运行 */
    get isRunning(): boolean {
        return this._running;
    }

    /** 注册状态栏更新回调 */
    onStatusBarUpdate(cb: StatusBarUpdateCallback): void {
        this.statusBarCallback = cb;
    }

    /** 注册全量存盘后回调 */
    onFullSave(cb: FullSaveCallback): void {
        this.fullSaveCallback = cb;
    }

    /** 注册心跳回调（每秒）*/
    onHeartbeat(cb: HeartbeatCallback): void {
        this.heartbeatCallback = cb;
    }

    /**
     * ★ 配置热更新 — 仅重启间隔发生变化的定时器。
     * 无变化的定时器保持原相位，避免无关配置变更引起的抖动。
     */
    updateIntervals(partial: Partial<SchedulerOptions>): void {
        const prev = this.options;
        const next: SchedulerOptions = { ...prev, ...partial };

        const changed = {
            journal: next.journalFlushIntervalMs !== prev.journalFlushIntervalMs,
            fullSave: next.fullSaveIntervalMs !== prev.fullSaveIntervalMs,
            heartbeat: next.heartbeatIntervalMs !== prev.heartbeatIntervalMs,
            statusBar: next.statusBarUpdateIntervalMs !== prev.statusBarUpdateIntervalMs,
        };

        const anyChanged = changed.journal || changed.fullSave || changed.heartbeat || changed.statusBar;
        this.options = next;

        if (!anyChanged) return;
        if (!this._running) return; // 未运行则仅更新配置，待 start() 时生效

        if (changed.journal) this.restartJournalTimer();
        if (changed.fullSave) this.restartFullSaveTimer();
        if (changed.heartbeat) this.restartHeartbeatTimer();
        if (changed.statusBar) this.restartStatusBarTimer();
    }

    /** 启动所有周期任务 */
    start(): void {
        if (this._running) return;
        this._running = true;
        this.startJournalTimer();
        this.startFullSaveTimer();
        this.startHeartbeatTimer();
        this.startStatusBarTimer();
        log(LogLevel.Info, 'Scheduler: started');
    }

    private startJournalTimer(): void {
        this.journalTimer = setInterval(async () => {
            try {
                await this.journal.tryFlush();
            } catch (err) {
                log(LogLevel.Error, 'Scheduler: journal flush failed', err as Error);
            }
        }, this.options.journalFlushIntervalMs);
    }

    private startFullSaveTimer(): void {
        this.fullSaveTimer = setInterval(async () => {
            try {
                await this.sessionManager.saveCheckpoint();
                await this.fullSaveCallback?.();
            } catch (err) {
                log(LogLevel.Error, 'Scheduler: full save failed', err as Error);
            }
        }, this.options.fullSaveIntervalMs);
    }

    private startHeartbeatTimer(): void {
        this.heartbeatTimer = setInterval(() => {
            this.journal.push({
                timestamp: Date.now(),
                deltaMs: this.options.heartbeatIntervalMs,
            });
            this.heartbeatCallback?.();
        }, this.options.heartbeatIntervalMs);
    }

    private startStatusBarTimer(): void {
        this.statusBarTimer = setInterval(() => {
            try {
                if (this.statusBarCallback) {
                    const snap = this.sessionManager.snapshot;
                    const todayMs = this.sessionManager.getTodayMs();
                    this.statusBarCallback({ totalMs: snap.currentTotalMs, todayMs });
                }
            } catch {
                // no-op
            }
        }, this.options.statusBarUpdateIntervalMs);
    }

    private restartJournalTimer(): void {
        if (this.journalTimer) { clearInterval(this.journalTimer); this.journalTimer = null; }
        this.startJournalTimer();
    }

    private restartFullSaveTimer(): void {
        if (this.fullSaveTimer) { clearInterval(this.fullSaveTimer); this.fullSaveTimer = null; }
        this.startFullSaveTimer();
    }

    private restartHeartbeatTimer(): void {
        if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
        this.startHeartbeatTimer();
    }

    private restartStatusBarTimer(): void {
        if (this.statusBarTimer) { clearInterval(this.statusBarTimer); this.statusBarTimer = null; }
        this.startStatusBarTimer();
    }

    /** 停止所有周期任务 */
    stop(): void {
        this._running = false;
        this.clearAllTimers();
        log(LogLevel.Info, 'Scheduler: stopped');
    }

    private clearAllTimers(): void {
        if (this.journalTimer) { clearInterval(this.journalTimer); this.journalTimer = null; }
        if (this.fullSaveTimer) { clearInterval(this.fullSaveTimer); this.fullSaveTimer = null; }
        if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
        if (this.statusBarTimer) { clearInterval(this.statusBarTimer); this.statusBarTimer = null; }
    }

    /** 触发一次立即存盘 */
    async saveNow(): Promise<void> {
        try {
            this.journal.flushAll();
            await this.sessionManager.saveCheckpoint();
            log(LogLevel.Debug, 'Scheduler: manual save completed');
        } catch (err) {
            log(LogLevel.Error, 'Scheduler: manual save failed', err as Error);
        }
    }
}
