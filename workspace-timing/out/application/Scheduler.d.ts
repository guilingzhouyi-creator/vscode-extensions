/**
 * Scheduler — 周期任务调度器
 *
 * 职责：
 *   1. 每 journalFlushIntervalMs 从 RingBuffer flush 到 journal
 *   2. 每 fullSaveIntervalMs 执行全量存盘（checkpoint 只固化历史累计，不清 journal；
 *      journal 截断发生在会话结束/崩溃恢复路径）
 *   3. 每秒更新 StatusBar，并顺带推入 1 条时间片到 RingBuffer
 *
 * ⚠️ 显式契约：journal 时间片粒度 = statusBarUpdateIntervalMs（默认 1s），
 *    二者共用同一定时器属有意设计（减少定时器数量）。若未来允许单独配置
 *    状态栏刷新间隔，必须同步把切片推送拆为独立定时器。
 *
 * 所有间隔可通过 TimingConfig 配置。
 */
import { JournalWriter } from '../cache/JournalWriter';
import { SessionManager } from './SessionManager';
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
export declare class Scheduler {
    private readonly journal;
    private readonly sessionManager;
    private options;
    private journalTimer;
    private fullSaveTimer;
    private statusBarTimer;
    private statusBarCallback;
    private fullSavedCallback;
    private _running;
    /** 全量存盘进行中标志（防重入：上一轮未完成时跳过本轮） */
    private _saving;
    /** journal flush 进行中标志 */
    private _flushing;
    constructor(journal: JournalWriter, sessionManager: SessionManager, options?: Partial<SchedulerOptions>);
    /** 是否正在运行 */
    get isRunning(): boolean;
    /** 注册状态栏更新回调 */
    onStatusBarUpdate(cb: StatusBarUpdateCallback): void;
    /** 注册周期全量存盘完成回调 */
    onFullSaved(cb: FullSavedCallback): void;
    /**
     * 运行期热更新调度间隔（journalEnabled 不支持热切换，需重启）
     * 运行中会重建对应定时器使新间隔立即生效。
     */
    updateIntervals(patch: Partial<Pick<SchedulerOptions, 'journalFlushIntervalMs' | 'fullSaveIntervalMs'>>): void;
    /** 启动所有周期任务 */
    start(): void;
    /**
     * 单次 journal flush（带防重入守卫）
     */
    private flushOnce;
    /**
     * 单次全量存盘（带防重入守卫），完成后触发 onFullSaved 回调
     */
    private saveOnce;
    /** 停止所有周期任务 */
    stop(): void;
    /** 触发一次立即存盘 */
    saveNow(): Promise<void>;
}
