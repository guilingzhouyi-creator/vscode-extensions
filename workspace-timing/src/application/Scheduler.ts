/**
 * Scheduler — 周期任务调度器
 *
 * 职责：
 *   1. 每 N 秒从 RingBuffer flush 到 journal
 *   2. 每 M 秒执行全量存盘 + journal truncate
 *   3. 每秒通知 StatusBar 更新
 *
 * 所有间隔可通过 TimingConfig 配置。
 */

import { JournalWriter } from '../cache/JournalWriter';
import { SessionManager } from './SessionManager';
import { LogLevel, log } from '../integration/Logger';

export interface SchedulerOptions {
    /** journal flush 间隔 (ms) */
    journalFlushIntervalMs: number;
    /** 全量存盘间隔 (ms) */
    fullSaveIntervalMs: number;
    /** 状态栏更新间隔 (ms) */
    statusBarUpdateIntervalMs: number;
}

export interface StatusBarDisplayData {
    totalMs: number;
    todayMs: number;
}

export type StatusBarUpdateCallback = (data: StatusBarDisplayData) => void;

export class Scheduler {
    private readonly journal: JournalWriter;
    private readonly sessionManager: SessionManager;
    private readonly options: SchedulerOptions;

    private journalTimer: ReturnType<typeof setInterval> | null = null;
    private fullSaveTimer: ReturnType<typeof setInterval> | null = null;
    private statusBarTimer: ReturnType<typeof setInterval> | null = null;
    private statusBarCallback: StatusBarUpdateCallback | null = null;

    private _running: boolean = false;

    constructor(
        journal: JournalWriter,
        sessionManager: SessionManager,
        options?: Partial<SchedulerOptions>,
    ) {
        this.journal = journal;
        this.sessionManager = sessionManager;
        this.options = {
            journalFlushIntervalMs: 10000,
            fullSaveIntervalMs: 60000,
            statusBarUpdateIntervalMs: 1000,
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

    /** 启动所有周期任务 */
    start(): void {
        if (this._running) return;
        this._running = true;

        // 1. Journal flush 定时器
        this.journalTimer = setInterval(async () => {
            try {
                await this.journal.tryFlush();
            } catch (err) {
                log(LogLevel.Error, 'Scheduler: journal flush failed', err as Error);
            }
        }, this.options.journalFlushIntervalMs);

        // 2. 全量存盘定时器
        this.fullSaveTimer = setInterval(() => {
            try {
                this.sessionManager.saveCheckpoint();
            } catch (err) {
                log(LogLevel.Error, 'Scheduler: full save failed', err as Error);
            }
        }, this.options.fullSaveIntervalMs);

        // 3. 心跳定时器：每秒推入时间片 + 更新状态栏
        this.statusBarTimer = setInterval(() => {
            try {
                // 推入时间片到 RingBuffer
                this.journal.push({
                    timestamp: Date.now(),
                    deltaMs: this.options.statusBarUpdateIntervalMs, // 1000ms = 1s
                });

                // 更新状态栏（含今日时长和累计时长）
                if (this.statusBarCallback) {
                    const snap = this.sessionManager.snapshot;
                    const todayMs = this.sessionManager.getTodayMs();
                    this.statusBarCallback({ totalMs: snap.currentTotalMs, todayMs });
                }
            } catch {
                // 状态栏更新失败不抛异常
            }
        }, this.options.statusBarUpdateIntervalMs);

        log(LogLevel.Info, 'Scheduler: started');
    }

    /** 停止所有周期任务 */
    stop(): void {
        this._running = false;

        if (this.journalTimer) {
            clearInterval(this.journalTimer);
            this.journalTimer = null;
        }
        if (this.fullSaveTimer) {
            clearInterval(this.fullSaveTimer);
            this.fullSaveTimer = null;
        }
        if (this.statusBarTimer) {
            clearInterval(this.statusBarTimer);
            this.statusBarTimer = null;
        }

        log(LogLevel.Info, 'Scheduler: stopped');
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
