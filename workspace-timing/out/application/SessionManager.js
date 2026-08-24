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
    constructor(timer, storage, journal, maxSessions = 1000) {
        this._sessionActive = false;
        this._todayCacheAt = 0;
        this._todayCacheValue = 0;
        this.timer = timer;
        this.storage = storage;
        this.journal = journal;
        this.maxSessions = maxSessions;
    }
    /** 是否处于活跃会话中 */
    get isSessionActive() {
        return this._sessionActive;
    }
    /** 运行期热更新会话历史上限（0 = 不限） */
    setMaxSessions(maxSessions) {
        this.maxSessions = maxSessions;
    }
    /**
     * 使今日累计缓存失效。
     * reset/newPeriod/崩溃恢复等数据清空或替换场景必须调用，
     * 否则 3s TTL 内 getTodayMs 会返回基于旧 sessions 的过期值。
     */
    invalidateTodayCache() {
        this._todayCacheAt = 0;
        this._todayCacheValue = 0;
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
        // 数据被恢复结果整体替换，今日缓存必须失效
        this.invalidateTodayCache();
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
        // 3. 裁剪会话列表（使用用户配置的 maxSessions，0=不限）
        this.timer.trimSessions(this.maxSessions);
        // 4. 全量存盘（数据已由 timer.stop() 更新，创建副本避免引用问题；会话结束属关键事件，强制 JSON 备份）
        const finalData = {
            ...this.timer.data,
            sessions: [...this.timer.data.sessions],
        };
        await this.storage.save(finalData, true);
        // 5. 清空 journal（await 确保退出路径上 truncate 落盘）
        await this.journal.truncate();
        const result = {
            elapsedMs: elapsed,
            totalMs: this.timer.data.totalMs,
            sessionCount: this.timer.data.sessions.length,
        };
        (0, Logger_1.log)(Logger_1.LogLevel.Info, `SessionManager: session ended, elapsed=${elapsed}ms, total=${this.timer.data.totalMs}ms`);
        return result;
    }
    /**
     * 获取今日累计时长 (ms)
     * 带 3s TTL 缓存：跨午夜时缓存值最多滞后 3 秒自然切换（对秒级展示无感知）。
     */
    getTodayMs() {
        const now = Date.now();
        if (now - this._todayCacheAt >= SessionManager.TODAY_CACHE_TTL_MS) {
            this._todayCacheValue = TimeAggregator_1.TimeAggregator.todayMs(this.timer.data.sessions, this.timer.data.currentSessionStartMs);
            this._todayCacheAt = now;
        }
        return this._todayCacheValue;
    }
    /**
     * 仅保存当前状态（不结束会话）
     * 由 Scheduler 周期性调用。
     *
     * ⚠️ 必须创建数据副本，不能修改计时器内部 totalMs，
     *    否则会与 stop() 中的累加逻辑产生重复计时。
     *
     * ⚠️ 崩溃恢复"三重计数"修复：主存储的 totalMs 只固化**已结束会话的累计**
     *   （snap.totalMs，不含进行中会话的实时时长）。进行中会话的时长由 journal 增量
     *   完整记录（checkpoint 不清空 journal），崩溃恢复时通过回放 journal 重建；
     *   journal 无有效回放时才用"补偿未完成会话"兜底。
     *   这避免了原实现（固化 currentTotalMs + journal 回放 + 补偿三者叠加）对同一
     *   会话时段重复累计的缺陷。
     */
    async saveCheckpoint() {
        const snap = this.timer.snapshot();
        // 周期性裁剪会话历史（此前仅在 endSession 时裁剪，长期不结束会话会无限增长）
        this.timer.trimSessions(this.maxSessions);
        const data = {
            ...this.timer.data,
            totalMs: snap.totalMs,
            lastSavedAtMs: Date.now(),
            sessions: [...this.timer.data.sessions],
        };
        // 进行中会话增量保留在 journal（供崩溃恢复回放），这里不清空
        await this.storage.save(data);
        (0, Logger_1.log)(Logger_1.LogLevel.Debug, `SessionManager: checkpoint saved, totalMs=${snap.totalMs}`);
    }
}
exports.SessionManager = SessionManager;
/** 今日累计缓存的刷新间隔：状态栏每秒读取，聚合为 O(全部会话) 扫描，用短 TTL 抑制重复计算 */
SessionManager.TODAY_CACHE_TTL_MS = 3000;
//# sourceMappingURL=SessionManager.js.map