"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.Scheduler = void 0;
const Logger_1 = require("../integration/Logger");
class Scheduler {
    constructor(journal, sessionManager, options) {
        this.journalTimer = null;
        this.fullSaveTimer = null;
        this.statusBarTimer = null;
        this.statusBarCallback = null;
        this._running = false;
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
    get isRunning() {
        return this._running;
    }
    /** 注册状态栏更新回调 */
    onStatusBarUpdate(cb) {
        this.statusBarCallback = cb;
    }
    /** 启动所有周期任务 */
    start() {
        if (this._running)
            return;
        this._running = true;
        // 1. Journal flush 定时器
        this.journalTimer = setInterval(async () => {
            try {
                await this.journal.tryFlush();
            }
            catch (err) {
                (0, Logger_1.log)(Logger_1.LogLevel.Error, 'Scheduler: journal flush failed', err);
            }
        }, this.options.journalFlushIntervalMs);
        // 2. 全量存盘定时器
        this.fullSaveTimer = setInterval(() => {
            try {
                this.sessionManager.saveCheckpoint();
            }
            catch (err) {
                (0, Logger_1.log)(Logger_1.LogLevel.Error, 'Scheduler: full save failed', err);
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
            }
            catch {
                // 状态栏更新失败不抛异常
            }
        }, this.options.statusBarUpdateIntervalMs);
        (0, Logger_1.log)(Logger_1.LogLevel.Info, 'Scheduler: started');
    }
    /** 停止所有周期任务 */
    stop() {
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
        (0, Logger_1.log)(Logger_1.LogLevel.Info, 'Scheduler: stopped');
    }
    /** 触发一次立即存盘 */
    async saveNow() {
        try {
            this.journal.flushAll();
            await this.sessionManager.saveCheckpoint();
            (0, Logger_1.log)(Logger_1.LogLevel.Debug, 'Scheduler: manual save completed');
        }
        catch (err) {
            (0, Logger_1.log)(Logger_1.LogLevel.Error, 'Scheduler: manual save failed', err);
        }
    }
}
exports.Scheduler = Scheduler;
//# sourceMappingURL=Scheduler.js.map