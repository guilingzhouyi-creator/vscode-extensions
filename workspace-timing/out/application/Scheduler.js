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
 *
 * ★ 修复（0.3.2）：updateIntervals 此前会「无脑重建全部 4 个定时器」，
 *   即便只是改了 enabled 这类与间隔无关的配置，也会打断所有定时器的相位并重建。
 *   现改为仅重启「间隔确实发生变化」的定时器，避免无谓的定时器抖动。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.Scheduler = void 0;
const Logger_1 = require("../integration/Logger");
const models_1 = require("../domain/models");
class Scheduler {
    constructor(journal, sessionManager, options) {
        this.journalTimer = null;
        this.fullSaveTimer = null;
        this.heartbeatTimer = null;
        this.statusBarTimer = null;
        this.statusBarCallback = null;
        this.fullSaveCallback = null;
        this.heartbeatCallback = null;
        this._running = false;
        this.journal = journal;
        this.sessionManager = sessionManager;
        this.options = {
            journalFlushIntervalMs: models_1.DEFAULT_JOURNAL_FLUSH_MS,
            fullSaveIntervalMs: models_1.DEFAULT_FULL_SAVE_MS,
            heartbeatIntervalMs: models_1.DEFAULT_HEARTBEAT_MS,
            statusBarUpdateIntervalMs: models_1.DEFAULT_STATUS_BAR_MS,
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
    /** 注册全量存盘后回调 */
    onFullSave(cb) {
        this.fullSaveCallback = cb;
    }
    /** 注册心跳回调（每秒）*/
    onHeartbeat(cb) {
        this.heartbeatCallback = cb;
    }
    /**
     * ★ 配置热更新 — 仅重启间隔发生变化的定时器。
     * 无变化的定时器保持原相位，避免无关配置变更引起的抖动。
     */
    updateIntervals(partial) {
        const prev = this.options;
        const next = { ...prev, ...partial };
        const changed = {
            journal: next.journalFlushIntervalMs !== prev.journalFlushIntervalMs,
            fullSave: next.fullSaveIntervalMs !== prev.fullSaveIntervalMs,
            heartbeat: next.heartbeatIntervalMs !== prev.heartbeatIntervalMs,
            statusBar: next.statusBarUpdateIntervalMs !== prev.statusBarUpdateIntervalMs,
        };
        const anyChanged = changed.journal || changed.fullSave || changed.heartbeat || changed.statusBar;
        this.options = next;
        if (!anyChanged)
            return;
        if (!this._running)
            return; // 未运行则仅更新配置，待 start() 时生效
        if (changed.journal)
            this.restartJournalTimer();
        if (changed.fullSave)
            this.restartFullSaveTimer();
        if (changed.heartbeat)
            this.restartHeartbeatTimer();
        if (changed.statusBar)
            this.restartStatusBarTimer();
    }
    /** 启动所有周期任务 */
    start() {
        if (this._running)
            return;
        this._running = true;
        this.startJournalTimer();
        this.startFullSaveTimer();
        this.startHeartbeatTimer();
        this.startStatusBarTimer();
        (0, Logger_1.log)(Logger_1.LogLevel.Info, 'Scheduler: started');
    }
    startJournalTimer() {
        this.journalTimer = setInterval(async () => {
            try {
                await this.journal.tryFlush();
            }
            catch (err) {
                (0, Logger_1.log)(Logger_1.LogLevel.Error, 'Scheduler: journal flush failed', err);
            }
        }, this.options.journalFlushIntervalMs);
    }
    startFullSaveTimer() {
        this.fullSaveTimer = setInterval(async () => {
            try {
                await this.sessionManager.saveCheckpoint();
                await this.fullSaveCallback?.();
            }
            catch (err) {
                (0, Logger_1.log)(Logger_1.LogLevel.Error, 'Scheduler: full save failed', err);
            }
        }, this.options.fullSaveIntervalMs);
    }
    startHeartbeatTimer() {
        this.heartbeatTimer = setInterval(() => {
            this.journal.push({
                timestamp: Date.now(),
                deltaMs: this.options.heartbeatIntervalMs,
            });
            this.heartbeatCallback?.();
        }, this.options.heartbeatIntervalMs);
    }
    startStatusBarTimer() {
        this.statusBarTimer = setInterval(() => {
            try {
                if (this.statusBarCallback) {
                    const snap = this.sessionManager.snapshot;
                    const todayMs = this.sessionManager.getTodayMs();
                    this.statusBarCallback({ totalMs: snap.currentTotalMs, todayMs });
                }
            }
            catch {
                // no-op
            }
        }, this.options.statusBarUpdateIntervalMs);
    }
    restartJournalTimer() {
        if (this.journalTimer) {
            clearInterval(this.journalTimer);
            this.journalTimer = null;
        }
        this.startJournalTimer();
    }
    restartFullSaveTimer() {
        if (this.fullSaveTimer) {
            clearInterval(this.fullSaveTimer);
            this.fullSaveTimer = null;
        }
        this.startFullSaveTimer();
    }
    restartHeartbeatTimer() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
        this.startHeartbeatTimer();
    }
    restartStatusBarTimer() {
        if (this.statusBarTimer) {
            clearInterval(this.statusBarTimer);
            this.statusBarTimer = null;
        }
        this.startStatusBarTimer();
    }
    /** 停止所有周期任务 */
    stop() {
        this._running = false;
        this.clearAllTimers();
        (0, Logger_1.log)(Logger_1.LogLevel.Info, 'Scheduler: stopped');
    }
    clearAllTimers() {
        if (this.journalTimer) {
            clearInterval(this.journalTimer);
            this.journalTimer = null;
        }
        if (this.fullSaveTimer) {
            clearInterval(this.fullSaveTimer);
            this.fullSaveTimer = null;
        }
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
        if (this.statusBarTimer) {
            clearInterval(this.statusBarTimer);
            this.statusBarTimer = null;
        }
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