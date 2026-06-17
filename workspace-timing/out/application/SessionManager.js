"use strict";
/**
 * SessionManager — 会话生命周期管理
 *
 * 职责：开始/结束会话、持久化、崩溃恢复入口协调
 * 边界：不关心禁用策略，由 TimerOrchestrator 控制调用时机
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionManager = void 0;
const TimeAggregator_1 = require("../domain/TimeAggregator");
const Logger_1 = require("../integration/Logger");
class SessionManager {
    constructor(timer, storage, journal) {
        this._sessionActive = false;
        this.timer = timer;
        this.storage = storage;
        this.journal = journal;
    }
    /** 是否处于活跃会话中 */
    get isSessionActive() {
        return this._sessionActive;
    }
    /** 获取计时器快照 */
    get snapshot() {
        return this.timer.snapshot();
    }
    /**
     * 执行崩溃恢复并开始新会话
     * 这是启动路径的核心方法
     */
    async startSession() {
        (0, Logger_1.log)(Logger_1.LogLevel.Info, 'SessionManager: starting session');
        // 1. 崩溃恢复
        const data = await this.storage.recover();
        // 2. 替换计时器数据
        this.timer.replaceData(data);
        // 3. 开始计时
        this.timer.start();
        this._sessionActive = true;
        (0, Logger_1.log)(Logger_1.LogLevel.Info, `SessionManager: session started, base totalMs=${data.totalMs}`);
        return data;
    }
    /**
     * 结束当前会话
     * 执行最终存盘并清空 journal
     */
    async endSession() {
        if (!this._sessionActive) {
            return { elapsedMs: 0, totalMs: this.timer.data.totalMs, sessionCount: 0 };
        }
        (0, Logger_1.log)(Logger_1.LogLevel.Info, 'SessionManager: ending session');
        // 1. 强制 flush 所有缓存数据到 journal
        const flushedCount = await this.journal.flushAll();
        if (flushedCount > 0) {
            (0, Logger_1.log)(Logger_1.LogLevel.Debug, `SessionManager: flushed ${flushedCount} slices before stop`);
        }
        // 2. 停止计时器
        const elapsed = this.timer.stop();
        this._sessionActive = false;
        // 3. 裁剪会话列表
        const maxSessions = 1000; // 可通过 config 传入
        this.timer.trimSessions(maxSessions);
        // 4. 全量存盘（数据已由 timer.stop() 更新，创建副本避免引用问题）
        const finalData = {
            ...this.timer.data,
            sessions: [...this.timer.data.sessions],
        };
        await this.storage.save(finalData);
        // 5. 清空 journal
        this.journal.truncate();
        const result = {
            elapsedMs: elapsed,
            totalMs: this.timer.data.totalMs,
            sessionCount: this.timer.data.sessions.length,
        };
        (0, Logger_1.log)(Logger_1.LogLevel.Info, `SessionManager: session ended, elapsed=${elapsed}ms, total=${this.timer.data.totalMs}ms`);
        return result;
    }
    /** 获取今日累计时长 (ms) */
    getTodayMs() {
        return TimeAggregator_1.TimeAggregator.todayMs(this.timer.data.sessions, this.timer.data.currentSessionStartMs);
    }
    /**
     * 仅保存当前状态（不结束会话）
     * 由 Scheduler 周期性调用。
     *
     * ⚠️ 必须创建数据副本，不能修改计时器内部 totalMs，
     *    否则会与 stop() 中的累加逻辑产生重复计时。
     */
    async saveCheckpoint() {
        const snap = this.timer.snapshot();
        const data = {
            ...this.timer.data,
            totalMs: snap.currentTotalMs,
            lastSavedAtMs: Date.now(),
            sessions: [...this.timer.data.sessions],
        };
        await this.storage.save(data);
        (0, Logger_1.log)(Logger_1.LogLevel.Debug, `SessionManager: checkpoint saved, totalMs=${snap.currentTotalMs}`);
    }
}
exports.SessionManager = SessionManager;
//# sourceMappingURL=SessionManager.js.map