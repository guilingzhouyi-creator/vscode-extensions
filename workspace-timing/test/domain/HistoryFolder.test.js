/**
 * HistoryFolder — 折叠引擎单测
 *
 * 核心不变量：折叠前后"日粒度聚合口径完全一致"
 * （dailyStats(kept) ∪ updatedDailyTotals ≡ dailyStats(original)）。
 */
'use strict';

const assert = require('assert');
const { foldExpiredSessions, migrateToFolded, foldCutoffStartMs } =
    require('../../out/domain/HistoryFolder.js');
const { TimeAggregator } = require('../../out/domain/TimeAggregator.js');
const { setLogLevel, LogLevel } = require('../../out/integration/Logger.js');

setLogLevel(LogLevel.None);

function localDateStr(ms) {
    const d = new Date(ms);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
}

/** 今天本地零点 */
function todayStart() {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function session(startMs, endMs) {
    return { startMs, endMs, durationMs: endMs - startMs };
}

describe('HistoryFolder（历史折叠引擎）', () => {
    const t0 = todayStart();
    const cutoff = t0; // 保留今天，折叠昨天及更早

    it('foldCutoffStartMs：retention<=0 返回 0（不折叠）；正数返回今天零点减 N 天', () => {
        assert.strictEqual(foldCutoffStartMs(0), 0);
        assert.strictEqual(foldCutoffStartMs(-1), 0);
        assert.strictEqual(foldCutoffStartMs(45), t0 - 45 * 86400000);
    });

    it('过期会话按自然日拆段入桶；跨午夜会话两段各归其日；计数记起始日', () => {
        // 昨天 23:30 → 今天 00:30：endMs >= cutoff → 保留（未整条过期）
        const crossing = session(t0 - 1800000, t0 + 1800000);
        // 前天 10:00 → 11:00：整条过期 → 入桶
        const old1 = session(t0 - 2 * 86400000 + 36000000, t0 - 2 * 86400000 + 39600000);
        // 大前天 22:00 → 昨天 02:00（4 小时）：整条过期，跨午夜 → 两桶
        const old2Start = t0 - 3 * 86400000 + 79200000;
        const old2 = session(old2Start, old2Start + 4 * 3600000);

        const res = foldExpiredSessions([crossing, old1, old2], undefined, cutoff);
        assert.deepStrictEqual(res.keptSessions, [crossing]);
        assert.strictEqual(res.foldedSessionCount, 2);

        const dMinus2 = localDateStr(t0 - 2 * 86400000);
        const dMinus3 = localDateStr(t0 - 3 * 86400000);
        // old1：前天 1 小时；old2 跨午夜的后半段（00:00-02:00 = 2 小时）也落在前天
        assert.strictEqual(res.updatedDailyTotals[dMinus2].totalMs, 10800000);
        // 计数归各会话【起始日】：old1 → 前天 +1；old2 → 大前天 +1（后半段不重复计数）
        assert.strictEqual(res.updatedDailyTotals[dMinus2].sessionCount, 1);
        assert.strictEqual(res.updatedDailyTotals[dMinus3].sessionCount, 1);
        // old2 的前半段（22:00-24:00 = 2 小时）落在大前天
        assert.strictEqual(res.updatedDailyTotals[dMinus3].totalMs, 7200000);
        assert.strictEqual(res.updatedDailyTotals[dMinus3].sessionCount, 1);
    });

    it('核心不变量：折叠后 kept∪buckets 的日聚合 ≡ 原始全量聚合', () => {
        const sessions = [
            session(t0 - 5 * 86400000 + 36000000, t0 - 5 * 86400000 + 7200000),
            session(t0 - 3 * 86400000, t0 - 3 * 86400000 + 1800000),
            crossingLike(t0),
            session(t0 + 36000000, t0 + 5400000 + 36000000),
        ];
        function crossingLike(anchor) { return session(anchor - 86400000 + 82800000, anchor + 900000); }

        const res = foldExpiredSessions(sessions, undefined, cutoff);

        // 原始口径
        const before = TimeAggregator.dailyStats(sessions);
        // 折叠口径：kept 计算 + 桶合并（桶优先于空、原始覆盖同日）
        const merged = new Map();
        for (const [d, v] of Object.entries(res.updatedDailyTotals)) merged.set(d, v.totalMs);
        for (const d of TimeAggregator.dailyStats(res.keptSessions)) merged.set(d.date, d.totalMs);
        for (const b of before) {
            assert.strictEqual(merged.get(b.date) ?? 0, b.totalMs,
                `日期 ${b.date} 折叠前后不一致`);
        }
        // 反向也不多出有值的日期
        for (const [d, ms] of merged) {
            const expect = before.find(x => x.date === d);
            if (!expect && ms !== 0) throw new Error(`多余日期 ${d}: ${ms}`);
        }
    });

    it('幂等：migrateToFolded 对同一数据重复执行结果一致', () => {
        const data = {
            sessions: [
                session(t0 - 100 * 86400000, t0 - 100 * 86400000 + 3600000),
                session(t0 + 3600000, t0 + 7200000),
            ],
        };
        const first = migrateToFolded(data, 45);
        const second = migrateToFolded(
            { sessions: first.sessions, dailyTotals: first.dailyTotals }, 45);
        assert.strictEqual(second.foldedSessionCount, 0);
        assert.deepStrictEqual(second.sessions, first.sessions);
        assert.deepStrictEqual(second.dailyTotals, first.dailyTotals);
    });

    it('retention=0 不折叠；脏数据（区间倒挂/非正起点）被清除', () => {
        const dirty = [
            session(t0 - 90 * 86400000, t0 - 89 * 86400000),
            { startMs: 5000, endMs: 1000, durationMs: -4000 },
            { startMs: 0, endMs: 999, durationMs: 999 },
        ];
        const resKeepAll = foldExpiredSessions(dirty.slice(0, 1), undefined, 0);
        assert.strictEqual(resKeepAll.keptSessions.length, 1, '不折叠时全部保留');

        const res = foldExpiredSessions(dirty, undefined, cutoff);
        assert.strictEqual(res.keptSessions.length, 0, '脏数据应被清除而非入桶');
        assert.strictEqual(res.foldedSessionCount, 1);
    });

    it('既有桶与新折叠增量正确合并（不互相覆盖）', () => {
        const existing = {};
        const existingKey = localDateStr(t0 - 200 * 86400000);
        existing[existingKey] = { totalMs: 123456, sessionCount: 9 };
        const expired = session(t0 - 90 * 86400000 + 36000000, t0 - 90 * 86400000 + 43200000); // 10:00-12:00
        const res = foldExpiredSessions([expired], existing, t0);
        assert.strictEqual(res.updatedDailyTotals[existingKey].totalMs, 123456);
        assert.strictEqual(res.foldedSessionCount, 1);
    });

    it('容量阈值（maxSessions）：超出上限的最旧会话按 FIFO 自动折叠进日桶', () => {
        const s1 = session(t0 + 1000, t0 + 2000);
        const s2 = session(t0 + 3000, t0 + 4000);
        const s3 = session(t0 + 5000, t0 + 6000);
        const s4 = session(t0 + 7000, t0 + 8000);
        const s5 = session(t0 + 9000, t0 + 10000);

        // cutoff = 0（不按时间折叠），maxSessions = 2
        const res = foldExpiredSessions([s1, s2, s3, s4, s5], undefined, 0, 2);
        assert.strictEqual(res.keptSessions.length, 2);
        assert.deepStrictEqual(res.keptSessions, [s4, s5]);
        assert.strictEqual(res.foldedSessionCount, 3);

        const todayKey = localDateStr(t0);
        assert.strictEqual(res.updatedDailyTotals[todayKey].sessionCount, 3);
        assert.strictEqual(res.updatedDailyTotals[todayKey].totalMs, 3000);
    });

    it('双阈值复合折叠（FoldOptions）：时间窗与条数上限复合触发，总时长与会话数严格守恒', () => {
        const old1 = session(t0 - 100 * 86400000 + 1000, t0 - 100 * 86400000 + 3000); // 2000ms
        const old2 = session(t0 - 50 * 86400000 + 1000, t0 - 50 * 86400000 + 4000);  // 3000ms
        const recent1 = session(t0 + 1000, t0 + 5000);                                  // 4000ms
        const recent2 = session(t0 + 6000, t0 + 11000);                                 // 5000ms
        const recent3 = session(t0 + 12000, t0 + 18000);                                // 6000ms

        const data = {
            sessions: [old1, old2, recent1, recent2, recent3],
            dailyTotals: {},
        };

        // 保留 30 天，且最多保留 2 条原始记录
        const res = migrateToFolded(data, { retentionDays: 30, maxSessions: 2, now: t0 });

        // old1, old2 因过期被折叠（2 条），recent1 因容量溢出被折叠（1 条），共折叠 3 条，保留 recent2, recent3
        assert.strictEqual(res.foldedSessionCount, 3);
        assert.strictEqual(res.sessions.length, 2);
        assert.deepStrictEqual(res.sessions, [recent2, recent3]);

        // 验证总时长与会话数完全守恒
        const foldedTotalMs = Object.values(res.dailyTotals).reduce((sum, b) => sum + b.totalMs, 0);
        const keptTotalMs = res.sessions.reduce((sum, s) => sum + s.durationMs, 0);
        const totalDuration = foldedTotalMs + keptTotalMs;
        assert.strictEqual(totalDuration, 2000 + 3000 + 4000 + 5000 + 6000);

        const foldedCount = Object.values(res.dailyTotals).reduce((sum, b) => sum + b.sessionCount, 0);
        const totalCount = foldedCount + res.sessions.length;
        assert.strictEqual(totalCount, 5);
    });
});
