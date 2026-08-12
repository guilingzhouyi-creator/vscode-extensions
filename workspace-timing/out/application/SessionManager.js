"use strict";
/**
 * SessionManager — 会话生命周期管理
 *
 * 职责：开始/结束会话、持久化、崩溃恢复入口协调
 * 边界：不关心禁用策略，由 TimerOrchestrator 控制调用时机
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionManager = void 0;
const models_1 = require("../domain/models");
const TimeAggregator_1 = require("../domain/TimeAggregator");
const Logger_1 = require("../integration/Logger");
class SessionManager {
    constructor(timer, storage, journal) {
        this._sessionActive = false;
        /**
         * 已结束会话的「按日分桶」结果缓存。
         * 仅在会话列表发生变化（结束会话 / 裁剪 / 恢复 / 重置）时重建，
         * 避免状态栏与面板每次刷新重复扫描全量会话（O(n)）。
         */
        this._finishedCacheKey = '';
        this._finishedByDate = new Map();
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
        this.invalidateFinishedCache();
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
        // 3. 裁剪会话列表（会话列表变化 → 缓存失效）
        this.timer.trimSessions(models_1.DEFAULT_MAX_SESSIONS);
        this.invalidateFinishedCache();
        // 4. 全量存盘（数据已由 timer.stop() 更新，创建副本避免引用问题）
        const finalData = {
            ...this.timer.data,
            sessions: [...this.timer.data.sessions],
        };
        await this.storage.save(finalData);
        // 5. 清空 journal
        await this.journal.truncate();
        const result = {
            elapsedMs: elapsed,
            totalMs: this.timer.data.totalMs,
            sessionCount: this.timer.data.sessions.length,
        };
        (0, Logger_1.log)(Logger_1.LogLevel.Info, `SessionManager: session ended, elapsed=${elapsed}ms, total=${this.timer.data.totalMs}ms`);
        return result;
    }
    /** 获取今日累计时长 (ms) — 复用已结束会话缓存 */
    getTodayMs() {
        this.ensureFinishedCache();
        return TimeAggregator_1.TimeAggregator.todayMsFromFinished(this._finishedByDate, this.timer.data.currentSessionStartMs);
    }
    /** 获取本周累计时长 (ms) — 复用已结束会话缓存 */
    getThisWeekMs() {
        this.ensureFinishedCache();
        return TimeAggregator_1.TimeAggregator.thisWeekMsFromFinished(this._finishedByDate, this.timer.data.currentSessionStartMs);
    }
    /** 获取近 7 天每日统计（供柱状图）— 复用已结束会话缓存 */
    getDailyStats() {
        this.ensureFinishedCache();
        return TimeAggregator_1.TimeAggregator.last7DaysFromFinished(this._finishedByDate, this.timer.data.currentSessionStartMs);
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
            // ★ 置零 currentSessionStartMs，防止崩溃恢复时 Step 3 重复补偿
            //    totalMs 已包含截至此刻的会话时长，journal 覆盖增量间隙，
            //    再次补偿会导致计时翻倍
            currentSessionStartMs: 0,
            sessions: [...this.timer.data.sessions],
        };
        await this.storage.save(data);
        // ★ 全量存盘成功后截断 journal，防止文件无限增长
        //    journal 仅保留自上次全量存盘以来的增量数据，
        //    崩溃恢复时 replay 不会重复计入已持久化的时长
        await this.journal.truncate();
        (0, Logger_1.log)(Logger_1.LogLevel.Debug, `SessionManager: checkpoint saved, totalMs=${snap.currentTotalMs}`);
    }
    // ─── 已结束会话缓存 ────────────────────────────────
    /** 标记缓存失效（会话列表变化时调用） */
    invalidateFinishedCache() {
        this._finishedCacheKey = '';
        this._finishedByDate.clear();
    }
    /**
     * 惰性重建已结束会话的分桶缓存。
     * 键由「会话数量 + 首/尾会话时间戳」构成：新增/裁剪/恢复/重置都会改变键，
     * 从而自然失效；运行中的活跃会话变化不会影响键，因此高频刷新时命中缓存。
     */
    ensureFinishedCache() {
        const sessions = this.timer.data.sessions;
        const key = sessions.length === 0
            ? 'empty'
            : `${sessions.length}:${sessions[0].startMs}:${sessions[sessions.length - 1].endMs}`;
        if (key === this._finishedCacheKey)
            return;
        this._finishedCacheKey = key;
        this._finishedByDate = (0, TimeAggregator_1.finishedSessionsByDate)(sessions);
    }
}
exports.SessionManager = SessionManager;
//# sourceMappingURL=SessionManager.js.map