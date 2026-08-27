/**
 * Scheduler — 周期任务调度器
 *
 * 职责：
 *   1. 每秒心跳：推入 1 条时间片到 RingBuffer + 尝试 journal flush + 更新状态栏
 *      —— flush 只是"尝试"，是否真正落盘由 JournalWriter 的缓存策略（时间/容量）
 *      裁决，避免调度器与策略双重控流；
 *   2. 每 fullSaveIntervalMs 执行全量存盘（checkpoint 只固化历史累计，不清 journal；
 *      journal 截断发生在会话结束/崩溃恢复路径）；
 *
 * ⚠️ 显式契约：journal 时间片粒度 = statusBarUpdateIntervalMs（默认 1s），
 *    二者共用同一定时器属有意设计（减少定时器数量）。若未来允许单独配置
 *    状态栏刷新间隔，必须同步把切片推送拆为独立定时器。
 *    心跳频率（1s）恒小于等于 flush 间隔（≥1s），策略裁决不会失效。
 *
 * 所有间隔可通过 TimingConfig 配置。
 */

import { JournalWriter } from '../cache/JournalWriter';
import { SessionManager } from './SessionManager';
import { LogLevel, log } from '../integration/Logger';
import {
    DEFAULT_JOURNAL_FLUSH_MS,
    DEFAULT_FULL_SAVE_MS,
    MS_PER_SECOND,
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
    /** 全量存盘进行中标志（防重入：上一轮未完成时跳过本轮） */
    private _saving: boolean = false;
    /** journal flush 进行中标志 */
    private _flushing: boolean = false;

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

    /**
     * 运行期热更新调度间隔（journalEnabled 不支持热切换，需重启）
     * 运行中会重建对应定时器使新间隔立即生效。
     *
     * ★ 间隔钳制下限 1000ms：面板/配置写入 0 或负数时，
     *   setInterval 会以 ~1ms 触发，全量存盘变成 CPU+I/O 热点。
     *   journal flush 间隔经 JournalWriter.updateFlushInterval 同步给缓存策略。
     */
    updateIntervals(patch: Partial<Pick<SchedulerOptions, 'journalFlushIntervalMs' | 'fullSaveIntervalMs'>>): void {
        const MIN_INTERVAL_MS = 1000;
        const clamped = {
            ...(patch.journalFlushIntervalMs !== undefined
                ? { journalFlushIntervalMs: Math.max(MIN_INTERVAL_MS, patch.journalFlushIntervalMs) }
                : {}),
            ...(patch.fullSaveIntervalMs !== undefined
                ? { fullSaveIntervalMs: Math.max(MIN_INTERVAL_MS, patch.fullSaveIntervalMs) }
                : {}),
        };

        const journalChanged = clamped.journalFlushIntervalMs !== undefined
            && clamped.journalFlushIntervalMs !== this.options.journalFlushIntervalMs;
        const fullSaveChanged = clamped.fullSaveIntervalMs !== undefined
            && clamped.fullSaveIntervalMs !== this.options.fullSaveIntervalMs;

        if (!journalChanged && !fullSaveChanged) return;

        this.options = { ...this.options, ...clamped };

        if (journalChanged) {
            // 无独立 flush 定时器：新间隔直接同步给缓存策略，心跳尝试时按新节奏落盘
            this.journal.updateFlushInterval(this.options.journalFlushIntervalMs);
        }
        if (fullSaveChanged && this._running) {
            if (this.fullSaveTimer) clearInterval(this.fullSaveTimer);
            this.fullSaveTimer = setInterval(() => void this.saveOnce(), this.options.fullSaveIntervalMs);
        }

        log(LogLevel.Debug, `Scheduler: intervals updated (journal=${this.options.journalFlushIntervalMs}ms, fullSave=${this.options.fullSaveIntervalMs}ms)`);
    }

    /** 启动所有周期任务 */
    start(): void {
        if (this._running) return;
        this._running = true;

        // 1. 全量存盘定时器
        this.fullSaveTimer = setInterval(() => void this.saveOnce(), this.options.fullSaveIntervalMs);

        // 2. 心跳定时器：每秒推入时间片 + 尝试 flush（落盘节奏由缓存策略裁决）+ 更新状态栏
        this.statusBarTimer = setInterval(() => {
            try {
                // 推入时间片到 RingBuffer（仅当 journal 启用时）
                if (this.options.journalEnabled) {
                    this.journal.push({
                        timestamp: Date.now(),
                        deltaMs: this.options.statusBarUpdateIntervalMs, // 1000ms = 1s
                    });
                    // 尝试 flush：策略未到时间/无数据时为空操作，I/O 零成本
                    void this.flushOnce();
                }

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

    /**
     * 单次 journal flush（带防重入守卫）
     */
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

    /**
     * 单次全量存盘（带防重入守卫），完成后触发 onFullSaved 回调
     */
    private async saveOnce(): Promise<void> {
        if (this._saving) return;
        this._saving = true;
        try {
            await this.sessionManager.saveCheckpoint();
            await this.fullSavedCallback?.();
        } catch (err) {
            log(LogLevel.Error, 'Scheduler: full save failed', err as Error);
        } finally {
            this._saving = false;
        }
    }

    /** 停止所有周期任务 */
    stop(): void {
        this._running = false;

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
            await this.journal.flushAll();
            await this.sessionManager.saveCheckpoint();
            log(LogLevel.Debug, 'Scheduler: manual save completed');
        } catch (err) {
            log(LogLevel.Error, 'Scheduler: manual save failed', err as Error);
        }
    }
}
