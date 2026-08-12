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
export declare class Scheduler {
    private readonly journal;
    private readonly sessionManager;
    private options;
    private journalTimer;
    private fullSaveTimer;
    private heartbeatTimer;
    private statusBarTimer;
    private statusBarCallback;
    private fullSaveCallback;
    private heartbeatCallback;
    private _running;
    constructor(journal: JournalWriter, sessionManager: SessionManager, options?: Partial<SchedulerOptions>);
    /** 是否正在运行 */
    get isRunning(): boolean;
    /** 注册状态栏更新回调 */
    onStatusBarUpdate(cb: StatusBarUpdateCallback): void;
    /** 注册全量存盘后回调 */
    onFullSave(cb: FullSaveCallback): void;
    /** 注册心跳回调（每秒）*/
    onHeartbeat(cb: HeartbeatCallback): void;
    /**
     * ★ 配置热更新 — 仅重启间隔发生变化的定时器。
     * 无变化的定时器保持原相位，避免无关配置变更引起的抖动。
     */
    updateIntervals(partial: Partial<SchedulerOptions>): void;
    /** 启动所有周期任务 */
    start(): void;
    private startJournalTimer;
    private startFullSaveTimer;
    private startHeartbeatTimer;
    private startStatusBarTimer;
    private restartJournalTimer;
    private restartFullSaveTimer;
    private restartHeartbeatTimer;
    private restartStatusBarTimer;
    /** 停止所有周期任务 */
    stop(): void;
    private clearAllTimers;
    /** 触发一次立即存盘 */
    saveNow(): Promise<void>;
}
