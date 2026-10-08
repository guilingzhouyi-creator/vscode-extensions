/**
 * Scheduler — 周期任务调度器
 *
 * 职责：
 *   1. 每秒心跳：推入 1 条时间片到 RingBuffer + 尝试 journal flush + 更新状态栏
 *      —— flush 只是"尝试"，是否真正落盘由 JournalWriter 的缓存策略裁决；
 *   2. 每 fullSaveIntervalMs 执行全量存盘（checkpoint 固化历史累计，不清 journal）；
 *   3. 优雅停止：等待在途保存任务完成，防止退出竞态导致文件损坏。
 *
 * 所有间隔可通过 TimingConfig 配置。
 */

import { JournalWriter } from '../cache/JournalWriter';
import { SessionManager } from './SessionManager';
import { TimeAggregator } from '../domain/TimeAggregator';
import { LogLevel, log } from '../integration/Logger';
import {
    DEFAULT_JOURNAL_FLUSH_MS,
    MS_PER_MINUTE,
    MS_PER_SECOND,
    SLEEP_DETECT_GAP_MS,
    sanitizeJournalFlushIntervalMs,
    sanitizeFullSaveIntervalMs,
} from '../domain/models';

export interface SchedulerOptions {
    /** journal flush 间隔 (ms) */
    journalFlushIntervalMs: number;
    /** 全量存盘间隔 (ms) */
    fullSaveIntervalMs: number;
    /** 状态栏更新间隔 (ms) */
    statusBarUpdateIntervalMs: number;
    /** 是否启用 journal 崩溃保护（false 时不写 RingBuffer/journal） */
    journalEnabled: boolean;
}

export interface StatusBarDisplayData {
    totalMs: number;
    todayMs: number;
}

const MSG_STATUS_BAR_UPDATE_FAILED = 'Scheduler: status bar update tick failed';

export type StatusBarUpdateCallback = (data: StatusBarDisplayData) => void;

/** 周期全量存盘完成回调（用于跨工作区全局同步） */
export type FullSavedCallback = () => void | Promise<void>;

export class Scheduler {
    private readonly journal: JournalWriter;
    private readonly sessionManager: SessionManager;
    private options: SchedulerOptions;

    private fullSaveTimer: ReturnType<typeof setInterval> | null = null;
    private statusBarTimer: ReturnType<typeof setInterval> | null = null;
    private statusBarCallback: StatusBarUpdateCallback | null = null;
    private fullSavedCallback: FullSavedCallback | null = null;

    private _running: boolean = false;
    /** 全量存盘进行中标志与异步等待句柄 */
    private _saving: boolean = false;
    private _savingPromise: Promise<void> | null = null;
    /** journal flush 进行中标志 */
    private _flushing: boolean = false;
    /** 上次心跳时间戳（用于检测系统休眠/挂起恢复） */
    private _lastTickMs: number = Date.now();
    /** 当前日期字符串（用于检测跨午夜自然日更替） */
    private _currentDayStr: string = TimeAggregator.todayStr();

    constructor(
        journal: JournalWriter,
        sessionManager: SessionManager,
        options?: Partial<SchedulerOptions>,
    ) {
        this.journal = journal;
        this.sessionManager = sessionManager;
        this.options = {
            journalFlushIntervalMs: DEFAULT_JOURNAL_FLUSH_MS,
            fullSaveIntervalMs: MS_PER_MINUTE,
            statusBarUpdateIntervalMs: MS_PER_SECOND,
            journalEnabled: true,
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

    /** 注册周期全量存盘完成回调 */
    onFullSaved(cb: FullSavedCallback): void {
        this.fullSavedCallback = cb;
    }

    /** 原子更新 journal flush 间隔 */
    private updateJournalInterval(val?: number): boolean {
        if (val === undefined) return false;
        const clamped = sanitizeJournalFlushIntervalMs(val);
        if (clamped === this.options.journalFlushIntervalMs) return false;
        this.options.journalFlushIntervalMs = clamped;
        this.journal.updateFlushInterval(clamped);
        return true;
    }

    /** 原子更新全量存盘间隔 */
    private updateFullSaveInterval(val?: number): boolean {
        if (val === undefined) return false;
        const clamped = sanitizeFullSaveIntervalMs(val);
        if (clamped === this.options.fullSaveIntervalMs) return false;
        this.options.fullSaveIntervalMs = clamped;
        if (this._running) {
            if (this.fullSaveTimer) clearInterval(this.fullSaveTimer);
            this.fullSaveTimer = setInterval(() => void this.saveOnce(), clamped);
        }
        return true;
    }

    /**
     * 运行期热更新定时器调度间隔：
     * 分别原子化校验并应用 Journal 刷盘间隔与全量快照存盘间隔。
     *
     * @param patch - 包含目标调度周期的差异化配置片段
     */
    updateIntervals(patch: Partial<Pick<SchedulerOptions, 'journalFlushIntervalMs' | 'fullSaveIntervalMs'>>): void {
        const jChanged = this.updateJournalInterval(patch.journalFlushIntervalMs);
        const fChanged = this.updateFullSaveInterval(patch.fullSaveIntervalMs);

        if (jChanged || fChanged) {
            log(
                LogLevel.Debug,
                `Scheduler: intervals updated (journal=${this.options.journalFlushIntervalMs}ms, fullSave=${this.options.fullSaveIntervalMs}ms)`,
            );
        }
    }

    /** 启动所有周期任务 */
    start(): void {
        if (this._running) return;
        this._running = true;
        this._lastTickMs = Date.now();
        this._currentDayStr = TimeAggregator.todayStr();

        // 1. 全量存盘定时器
        this.fullSaveTimer = setInterval(() => void this.saveOnce(), this.options.fullSaveIntervalMs);

        // 2. 心跳定时器：每秒推入时间片 + 跨午夜与休眠检测 + 尝试 flush + 更新状态栏
        this.statusBarTimer = setInterval(() => {
            try {
                const now = Date.now();
                const deltaMs = now - this._lastTickMs;
                this._lastTickMs = now;

                // 休眠唤醒检测：真实时间跃迁超过心跳间隔 + 容差阈值
                if (deltaMs > SLEEP_DETECT_GAP_MS) {
                    const sleepStartMs = now - deltaMs;
                    void this.sessionManager.handleSystemResume(sleepStartMs, now);
                    this._currentDayStr = TimeAggregator.todayStr();
                    return;
                }

                // 跨午夜自然日更替检测
                const todayStr = TimeAggregator.todayStr();
                if (todayStr !== this._currentDayStr) {
                    this._currentDayStr = todayStr;
                    void this.sessionManager.rotateSessionAtMidnight();
                }

                // 仅在启用 journal 时推入切片与尝试 flush
                if (this.options.journalEnabled) {
                    this.journal.push({ timestamp: now, deltaMs: this.options.statusBarUpdateIntervalMs });
                    void this.flushOnce();
                }

                // 驱动状态栏更新
                if (this.statusBarCallback) {
                    const snap = this.sessionManager.snapshot;
                    this.statusBarCallback({
                        totalMs: snap.currentTotalMs,
                        todayMs: this.sessionManager.getTodayMs(),
                    });
                }
            } catch (err) {
                log(LogLevel.Error, MSG_STATUS_BAR_UPDATE_FAILED, err as Error);
            }
        }, this.options.statusBarUpdateIntervalMs);

        log(LogLevel.Info, 'Scheduler: started');
    }

    /** 单次 journal flush（带防重入守卫） */
    private async flushOnce(): Promise<void> {
        if (this._flushing) return;
        this._flushing = true;
        try {
            await this.journal.tryFlush();
        } catch (err) {
            log(LogLevel.Error, 'Scheduler: journal flush failed', err as Error);
        } finally {
            this._flushing = false;
        }
    }

    /** 单次全量存盘（带防重入守卫与 Promise 句柄跟踪） */
    private async saveOnce(): Promise<void> {
        if (this._saving) return;
        this._saving = true;

        this._savingPromise = (async () => {
            try {
                await this.sessionManager.saveCheckpoint();
                await this.fullSavedCallback?.();
            } catch (err) {
                log(LogLevel.Error, 'Scheduler: full save failed', err as Error);
            } finally {
                this._saving = false;
                this._savingPromise = null;
            }
        })();

        await this._savingPromise;
    }

    /** 停止所有周期任务，并优雅等待在途存盘完成 */
    async stop(): Promise<void> {
        this._running = false;

        if (this.fullSaveTimer) {
            clearInterval(this.fullSaveTimer);
            this.fullSaveTimer = null;
        }
        if (this.statusBarTimer) {
            clearInterval(this.statusBarTimer);
            this.statusBarTimer = null;
        }

        if (this._savingPromise) {
            await this._savingPromise;
        }

        log(LogLevel.Info, 'Scheduler: stopped');
    }
}
