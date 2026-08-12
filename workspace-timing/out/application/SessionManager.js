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
        // ★ 立即持久化进行中会话的起始边界（currentSessionStartMs）。
        //   即便在首个全量存盘（60s）前崩溃，recover() 也能凭此边界把会话收尾为
        //   finished TimeSession，而非依赖 journal 近似，从而避免「会话数归零 / 昨日时长丢失」。
        try {
            await this.saveCheckpoint();
        }
        catch (err) {
            (0, Logger_1.log)(Logger_1.LogLevel.Warn, 'SessionManager: initial boundary save failed', err);
        }
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
        await this.storage.save(finalData, true);
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
    /** 获取本周每日统计（自然周，本周一→今日，供「周报」柱状图）— 复用已结束会话缓存 */
    getDailyStats() {
        this.ensureFinishedCache();
        return TimeAggregator_1.TimeAggregator.weekDailyFromFinished(this._finishedByDate, this.timer.data.currentSessionStartMs, false);
    }
    /** 获取自然周每日明细（fullWeek=true 时含本周日至周日，供周报导出）— 复用已结束会话缓存 */
    getWeekDailyStats(fullWeek = false) {
        this.ensureFinishedCache();
        return TimeAggregator_1.TimeAggregator.weekDailyFromFinished(this._finishedByDate, this.timer.data.currentSessionStartMs, fullWeek);
    }
    /** 获取上一自然周累计时长 (ms) — 复用已结束会话缓存 */
    getLastWeekMs() {
        this.ensureFinishedCache();
        return TimeAggregator_1.TimeAggregator.lastWeekMsFromFinished(this._finishedByDate);
    }
    /** 获取本月累计时长 (ms) — 复用已结束会话缓存 */
    getThisMonthMs() {
        this.ensureFinishedCache();
        return TimeAggregator_1.TimeAggregator.thisMonthMsFromFinished(this._finishedByDate, this.timer.data.currentSessionStartMs);
    }
    /** 获取上一自然月累计时长 (ms) — 复用已结束会话缓存 */
    getLastMonthMs() {
        this.ensureFinishedCache();
        return TimeAggregator_1.TimeAggregator.lastMonthMsFromFinished(this._finishedByDate);
    }
    /** 获取自然月每日明细（本月 1 号起；fullMonth=true 含至月末）— 复用已结束会话缓存 */
    getMonthDailyStats(fullMonth = false) {
        this.ensureFinishedCache();
        return TimeAggregator_1.TimeAggregator.monthDailyFromFinished(this._finishedByDate, this.timer.data.currentSessionStartMs, fullMonth);
    }
    /** 活动时间线热力图（近 weeks 周，含本周）— 复用已结束会话缓存 */
    getHeatmap(weeks = 12) {
        this.ensureFinishedCache();
        return TimeAggregator_1.TimeAggregator.heatmapDays(this._finishedByDate, this.timer.data.currentSessionStartMs, weeks);
    }
    /**
     * 仅保存当前状态（不结束会话）
     * 由 Scheduler 周期性调用。
     *
     * ★ 设计约定（与 0.1.x 的零边界方案相反，但消除了重复计与归属丢失）：
     *   - totalMs 始终等于「已结束会话」的累加和（权威源），此处不做任何折叠；
     *   - currentSessionStartMs 原样保留，使进行中会话的真实起始日存续到磁盘；
     *   - 进行中会话由 TimeAggregator 在今日/本周交集计算时叠加，
     *     并由 recover() 在重载时收尾为 finished TimeSession。
     *   这样既不会与 recover 的边界补偿重复计（边界优先于 journal），
     *   又保证日报/周报能按真实自然日归并（含跨午夜自动切分）。
     */
    async saveCheckpoint() {
        // 跨午夜则先把进行中会话切分为当日独立段，使 sessions[] 含按日粒度记录
        this.splitActiveSessionAtMidnight();
        const data = {
            ...this.timer.data,
            lastSavedAtMs: Date.now(),
            // 创建数据副本，避免与计时器内部引用共享（stop() 累加逻辑据此独立）
            sessions: [...this.timer.data.sessions],
        };
        await this.storage.save(data);
        // ★ 全量存盘成功后截断 journal，防止文件无限增长
        //    journal 仅保留自上次全量存盘以来的增量数据，
        //    崩溃恢复时 replay 不会重复计入已持久化的时长
        await this.journal.truncate();
        (0, Logger_1.log)(Logger_1.LogLevel.Debug, `SessionManager: checkpoint saved, totalMs=${data.totalMs}, activeStart=${data.currentSessionStartMs}`);
    }
    /**
     * 若进行中会话跨越了自然日 00:00，则在午夜边界处将其切分为两段。
     * 供 saveCheckpoint 周期调用，确保每一个自然日都拥有独立 finished TimeSession，
     * 使日报/周报的每日柱子能精确反映当天时长。
     */
    splitActiveSessionAtMidnight() {
        if (!this._sessionActive)
            return;
        const start = this.timer.data.currentSessionStartMs;
        if (start <= 0)
            return;
        const now = Date.now();
        let boundary = (0, TimeAggregator_1.nextMidnightMs)(start);
        let guard = 0;
        while (boundary < now && guard++ < 400) {
            this.timer.splitAt(boundary);
            // splitAt 已把 currentSessionStartMs 推进到 boundary，继续向后找下一个午夜
            boundary = (0, TimeAggregator_1.nextMidnightMs)(boundary);
        }
        if (guard > 0) {
            this.invalidateFinishedCache();
        }
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