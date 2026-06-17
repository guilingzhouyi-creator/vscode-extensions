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
export declare class Scheduler {
    private readonly journal;
    private readonly sessionManager;
    private readonly options;
    private journalTimer;
    private fullSaveTimer;
    private statusBarTimer;
    private statusBarCallback;
    private _running;
    constructor(journal: JournalWriter, sessionManager: SessionManager, options?: Partial<SchedulerOptions>);
    /** 是否正在运行 */
    get isRunning(): boolean;
    /** 注册状态栏更新回调 */
    onStatusBarUpdate(cb: StatusBarUpdateCallback): void;
    /** 启动所有周期任务 */
    start(): void;
    /** 停止所有周期任务 */
    stop(): void;
    /** 触发一次立即存盘 */
    saveNow(): Promise<void>;
}
