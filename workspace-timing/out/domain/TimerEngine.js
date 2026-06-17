"use strict";
/**
 * TimerEngine — 计时核心
 *
 * 职责：start / stop / elapsed 计算
 * 边界：不关心存储、不关心 UI、不关心禁用策略
 * 依赖：仅依赖 models.ts
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TimerEngine = void 0;
const models_1 = require("./models");
class TimerEngine {
    constructor(data) {
        this._sessionStartMs = 0;
        this._running = false;
        this._data = data ?? (0, models_1.createEmptyTimingData)();
    }
    /** 获取内部数据（只读快照） */
    get data() {
        return this._data;
    }
    /** 是否正在运行 */
    get isRunning() {
        return this._running;
    }
    /** 开始计时 */
    start() {
        if (this._running)
            return;
        this._running = true;
        this._sessionStartMs = Date.now();
        this._data.currentSessionStartMs = this._sessionStartMs;
    }
    /** 停止计时，返回本次会话历时 (ms) */
    stop() {
        if (!this._running)
            return 0;
        this._running = false;
        const now = Date.now();
        const elapsed = now - this._sessionStartMs;
        // 累加到 total
        this._data.totalMs += elapsed;
        this._data.currentSessionStartMs = 0;
        this._data.lastSavedAtMs = now;
        // 记录会话
        this._data.sessions.push({
            startMs: this._sessionStartMs,
            endMs: now,
            durationMs: elapsed,
        });
        return elapsed;
    }
    /** 获取当前快照（不停止计时） */
    snapshot() {
        const sessionElapsed = this._running
            ? Date.now() - this._sessionStartMs
            : 0;
        return {
            totalMs: this._data.totalMs,
            sessionElapsedMs: sessionElapsed,
            currentTotalMs: this._data.totalMs + sessionElapsed,
        };
    }
    /** 替换内部数据（用于崩溃恢复后加载） */
    replaceData(data) {
        this._data = { ...data };
    }
    /** 重置所有计时数据 */
    reset() {
        this._data = (0, models_1.createEmptyTimingData)();
        this._sessionStartMs = 0;
        this._running = false;
    }
    /** 裁剪会话列表到最大数量 */
    trimSessions(maxSessions) {
        if (maxSessions <= 0)
            return;
        if (this._data.sessions.length > maxSessions) {
            this._data.sessions = this._data.sessions.slice(-maxSessions);
        }
    }
}
exports.TimerEngine = TimerEngine;
//# sourceMappingURL=TimerEngine.js.map