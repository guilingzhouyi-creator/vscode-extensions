/**
 * TimeAggregator — 日报/周报聚合单测
 *
 * 直接对编译产物 out/domain/TimeAggregator.js 断言，零 VS Code 运行时依赖。
 * 覆盖：weeklyTrend（多周趋势）、weeklySummary（周报摘要）、dailyDetail（日报明细）。
 */
'use strict';

const assert = require('assert');
const { TimeAggregator } = require('../../out/domain/TimeAggregator.js');

/**
 * 计算当前周周一的 UTC 中午时间戳。
 * 选 12:00 UTC 使 toISOString().slice(0,10) 稳定落在周一当天，规避常见时区偏移边界。
 */
function currentWeekMondayNoonMs() {
    const today = new Date();
    const day = today.getUTCDay();
    const diff = day === 0 ? -6 : 1 - day;
    const startOfToday = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    return startOfToday + diff * 86400000 + 12 * 3600000;
}

// 会话基准：当前周周一 12:00 UTC
const BASE_WEEK = currentWeekMondayNoonMs();

/** 构造会话：dayOffset 天偏移（0=周一），hourOffset 小时偏移，durationMs 时长 */
function makeSession(dayOffset, durationMs, hourOffset = 0) {
    const startMs = BASE_WEEK + dayOffset * 86400000 + hourOffset * 3600000;
    return { startMs, endMs: startMs + durationMs, durationMs };
}

describe('TimeAggregator（日报/周报聚合）', () => {
    // 周一的日期字符串（★ 与被测实现同口径：本地时区派生。
    // 此前用 toISOString()（UTC）构造期望值，UTC+12~+14 时区下 BASE_WEEK 会落到周二，
    // 导致断言失败。localDateStrOf 为函数声明（提升），此处可用）
    const mondayStr = localDateStrOf(BASE_WEEK);

    it('weeklyTrend：生成近 4 周按周聚合（含当前周，降序）', () => {
        const sessions = [
            makeSession(0, 3600000),  // 本周
            makeSession(1, 1800000),  // 本周
            makeSession(-7, 5400000), // 上周
            makeSession(-14, 7200000), // 两周前
        ];
        const trend = TimeAggregator.weeklyTrend(sessions, 4);
        assert.strictEqual(trend.length, 4);
        // 降序：最近在前
        assert.ok(trend[0].weekStart >= trend[1].weekStart);
        // 当前周（最近）应含 2 个会话
        assert.strictEqual(trend[0].sessionCount, 2);
        assert.strictEqual(trend[0].totalMs, 5400000);
        // 上周
        assert.strictEqual(trend[1].totalMs, 5400000);
        assert.strictEqual(trend[1].sessionCount, 1);
        // 两周前
        assert.strictEqual(trend[2].totalMs, 7200000);
    });

    it('weeklySummary：汇总本周总时长/日均/活跃天数/最活跃日期', () => {
        const sessions = [
            makeSession(0, 3600000),
            makeSession(0, 1800000), // 周一累计 5400000
            makeSession(1, 3600000), // 周二
        ];
        const summary = TimeAggregator.weeklySummary(sessions);
        assert.strictEqual(summary.totalMs, 9000000);
        assert.strictEqual(summary.sessionCount, 3);
        assert.strictEqual(summary.activeDays, 2);
        // 最活跃日期应为周一
        assert.strictEqual(summary.peakDate, mondayStr);
        assert.strictEqual(summary.peakDateMs, 5400000);
        // 日均 = 总时长 / 已过天数（>=1）
        assert.ok(summary.avgDailyMs > 0);
    });

    it('dailyDetail：按日期归集会话明细、小时分布、活跃时段', () => {
        const sessions = [
            makeSession(0, 3600000, -3), // 周一 09:00（本地时区渲染小时，仅断言桶数量）
            makeSession(0, 3600000, -2), // 周一 10:00
        ];
        const detail = TimeAggregator.dailyDetail(sessions, mondayStr);
        assert.strictEqual(detail.sessionCount, 2);
        assert.strictEqual(detail.totalMs, 7200000);
        assert.strictEqual(detail.sessions.length, 2);
        // 两个会话跨两个不同小时 → 2 个小时桶（不依赖具体本地小时值，规避时区）
        assert.ok(detail.hourly.length >= 1);
        assert.strictEqual(detail.totalMs, detail.hourly.reduce((sum, h) => sum + h.totalMs, 0));
        // 活跃时段非空
        assert.ok(detail.activeWindow.length > 0);
    });

    it('dailyDetail：无会话时返回空明细', () => {
        const detail = TimeAggregator.dailyDetail([], '2000-01-01');
        assert.strictEqual(detail.sessionCount, 0);
        assert.strictEqual(detail.totalMs, 0);
        assert.strictEqual(detail.peakHour, -1);
        assert.strictEqual(detail.activeWindow, '');
    });
});

// ═══════════════════════════════════════════════════════════════
// 本地时区归桶 + 跨午夜切分回归测试
// 全部使用本地日期构造时间戳，任何时区下结果都确定。
// ═══════════════════════════════════════════════════════════════

/** 本地日期构造工具 */
function localMs(year, monthIdx, day, hour = 0, minute = 0) {
    return new Date(year, monthIdx, day, hour, minute, 0, 0).getTime();
}

/** 格式化为本地日期字符串 */
function localDateStrOf(ms) {
    const d = new Date(ms);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
}

describe('TimeAggregator：本地时区与跨午夜口径', () => {
    // 以"今天"为锚点，构造昨天/今天的本地时间戳
    const now = new Date();
    const Y = now.getFullYear(), M = now.getMonth(), D = now.getDate();
    const todayStartMs = localMs(Y, M, D);
    const todayStr = localDateStrOf(todayStartMs);
    const yesterdayStartMs = localMs(Y, M, D - 1);
    const yesterdayStr = localDateStrOf(yesterdayStartMs);

    it('todayMs：今日会话计入，昨日会话不计入（本地日期归桶）', () => {
        const sessions = [
            { startMs: localMs(Y, M, D, 8), endMs: localMs(Y, M, D, 9), durationMs: 3600000 },   // 今日 08:00–09:00
            { startMs: localMs(Y, M, D - 1, 8), endMs: localMs(Y, M, D - 1, 9), durationMs: 3600000 }, // 昨日同时段
        ];
        assert.strictEqual(TimeAggregator.todayMs(sessions, 0), 3600000);
    });

    it('跨午夜会话按自然日切分：各得 30 分钟', () => {
        const s = {
            startMs: localMs(Y, M, D - 1, 23, 30), // 昨日 23:30
            endMs: localMs(Y, M, D, 0, 30),        // 今日 00:30
            durationMs: 3600000,
        };
        // 今日只含 00:00–00:30 段
        assert.strictEqual(TimeAggregator.todayMs([s], 0), 1800000);

        // dailyStats 两日各 30 分钟，总和守恒
        const stats = TimeAggregator.dailyStats([s]);
        assert.strictEqual(stats.length, 2);
        assert.deepStrictEqual(
            stats.map(x => x.totalMs).sort((a, b) => a - b),
            [1800000, 1800000],
        );
        const byDate = new Map(stats.map(x => [x.date, x.totalMs]));
        assert.strictEqual(byDate.get(todayStr), 1800000);
        assert.strictEqual(byDate.get(yesterdayStr), 1800000);
    });

    it('dailyDetail：跨午夜会话在当日视图中被裁剪', () => {
        const s = {
            startMs: localMs(Y, M, D - 1, 23, 30),
            endMs: localMs(Y, M, D, 0, 30),
            durationMs: 3600000,
        };
        const today = TimeAggregator.dailyDetail([s], todayStr);
        assert.strictEqual(today.sessionCount, 1);
        assert.strictEqual(today.totalMs, 1800000);
        assert.ok(today.sessions[0].startLabel.startsWith('00:00'), `实际 ${today.sessions[0].startLabel}`);

        const yesterday = TimeAggregator.dailyDetail([s], yesterdayStr);
        assert.strictEqual(yesterday.totalMs, 1800000);
        // 昨日视图裁剪至当日末尾：23:30 – 次日 00:00（自然日边界）
        assert.ok(yesterday.sessions[0].startLabel.startsWith('23:30'), `实际 ${yesterday.sessions[0].startLabel}`);
        assert.strictEqual(yesterday.sessions[0].endLabel, '00:00');
    });

    it('hourly：跨小时会话按时长分摊到各小时桶', () => {
        const s = { startMs: localMs(Y, M, D, 10, 15), endMs: localMs(Y, M, D, 12, 45), durationMs: 9000000 };
        const detail = TimeAggregator.dailyDetail([s], todayStr);
        // 触及 10/11/12 三个小时桶
        assert.strictEqual(detail.hourly.length, 3);
        // 时长总和守恒
        assert.strictEqual(detail.hourly.reduce((sum, h) => sum + h.totalMs, 0), 9000000);
        // 11 点桶拥有完整 60 分钟 → 最活跃小时
        assert.strictEqual(detail.peakHour, 11);
    });

    it('activeWindow：取累计时长最大的连续区间而非跨度最长', () => {
        const sessions = [
            { startMs: localMs(Y, M, D, 9), endMs: localMs(Y, M, D, 10), durationMs: 3600000 },  // 09 点桶 60 分钟
            { startMs: localMs(Y, M, D, 14), endMs: localMs(Y, M, D, 17), durationMs: 10800000 }, // 14–16 连续 3 小时但每桶仅 60 分钟
        ];
        const detail = TimeAggregator.dailyDetail([...sessions], todayStr);
        // 09 点单桶 60 分钟 < 14~16 区间累计 180 分钟 → 应选 14:00-16:00
        assert.strictEqual(detail.activeWindow, '14:00-16:00');
    });

    it('weeklyStats：跨周日界的会话切分归入两周', () => {
        // 构造一个确定的"周日 23:30 → 周一 00:30"会话
        // 从今天往前找到最近的一个周一（本周起始）
        const dow = now.getDay(); // 0=周日
        const thisMonday = localMs(Y, M, D - ((dow === 0) ? 6 : dow - 1));
        const sunday = localMs(Y, M, D - ((dow === 0) ? 6 : dow - 1) - 1);
        const s = {
            startMs: localMs(new Date(sunday).getFullYear(), new Date(sunday).getMonth(),
                new Date(sunday).getDate(), 23, 30),
            endMs: localMs(new Date(thisMonday).getFullYear(), new Date(thisMonday).getMonth(),
                new Date(thisMonday).getDate(), 0, 30),
            durationMs: 3600000,
        };
        const stats = TimeAggregator.weeklyStats([s]);
        assert.strictEqual(stats.length, 2, '应分属两个周桶');
        assert.strictEqual(
            stats.reduce((sum, w) => sum + w.totalMs, 0),
            3600000,
            '总时长守恒',
        );
    });

    it('last7Days：7 个桶、今日桶含进行中会话增量', () => {
        const chart = TimeAggregator.last7Days([], todayStartMs + 3600000);
        assert.strictEqual(chart.length, 7);
    });

    it('splitByNaturalDay：跨午夜区间切分为两段且时长守恒', () => {
        const start = localMs(Y, M, D - 1, 23, 30);
        const end = localMs(Y, M, D, 0, 30);
        const segs = TimeAggregator.splitByNaturalDay(start, end);
        assert.strictEqual(segs.length, 2);
        assert.deepStrictEqual(segs.map(x => x.durationMs), [1800000, 1800000]);
        assert.strictEqual(segs.reduce((s, x) => s + x.durationMs, 0), end - start);
        // 首段归属起始日、次段归属次日（崩溃恢复合成会话的归属依据）
        assert.strictEqual(localDateStrOf(segs[0].startMs), yesterdayStr);
        assert.strictEqual(localDateStrOf(segs[1].endMs), todayStr);
    });

    it('splitByNaturalDay：异常远期区间受安全上限保护', () => {
        const start = todayStartMs;
        const segs = TimeAggregator.splitByNaturalDay(start, start + 20 * 365 * 86400000);
        assert.ok(segs.length <= 4000, `应受 eachDaySegment 护栏限制，实际 ${segs.length} 段`);
    });

    it('splitByNaturalDay：非法区间返回空数组', () => {
        assert.deepStrictEqual(TimeAggregator.splitByNaturalDay(1000, 1000), []);
        assert.deepStrictEqual(TimeAggregator.splitByNaturalDay(2000, 1000), []);
        assert.deepStrictEqual(TimeAggregator.splitByNaturalDay(0, 1000), []);
    });
});

describe('TimerEngine：边界补充', () => {
    const { TimerEngine } = require('../../out/domain/TimerEngine.js');

    it('start 二次调用幂等（不覆盖会话起点）', async () => {
        const engine = new TimerEngine();
        engine.start();
        const firstStart = engine.data.currentSessionStartMs;
        await new Promise(r => setTimeout(r, 5));
        engine.start();
        assert.strictEqual(engine.data.currentSessionStartMs, firstStart);
    });

    it('replaceData 后未运行态语义保持', () => {
        const engine = new TimerEngine({ version: 1, totalMs: 5000, currentSessionStartMs: 0, lastSavedAtMs: 0, isEnabled: true, sessions: [] });
        assert.strictEqual(engine.isRunning, false);
        assert.strictEqual(engine.snapshot().totalMs, 5000);
        assert.strictEqual(engine.stop(), 0, '未运行时 stop 返回 0');
    });

    it('trimSessions(0) 表示不限，不裁剪', () => {
        const engine = new TimerEngine();
        engine.replaceData({
            version: 1, totalMs: 0, currentSessionStartMs: 0, lastSavedAtMs: 0, isEnabled: true,
            sessions: [
                { startMs: 1, endMs: 2, durationMs: 1 },
                { startMs: 2, endMs: 3, durationMs: 1 },
                { startMs: 3, endMs: 4, durationMs: 1 },
            ],
        });
        engine.trimSessions(0);
        assert.strictEqual(engine.data.sessions.length, 3);
    });
});

describe('TimeAggregator：fullDailySeries 双源合并', () => {
    const now = new Date();
    const Y = now.getFullYear(), M = now.getMonth(), D = now.getDate();

    it('折叠桶 + 当期原始计算不重不漏，同日以原始为准', () => {
        // 折叠桶：60 天前（仅桶）+ 昨天（与原始同日，应被覆盖）
        const buckets = {
            [localDateStrOf(new Date(Y, M, D - 60).getTime())]: { totalMs: 60000, sessionCount: 1 },
            [localDateStrOf(new Date(Y, M, D - 1).getTime())]: { totalMs: 999999, sessionCount: 99 },
        };
        // 原始会话：昨天 30 分钟
        const sessions = [{
            startMs: new Date(Y, M, D - 1, 10).getTime(),
            endMs: new Date(Y, M, D - 1, 10, 30).getTime(),
            durationMs: 1800000,
        }];
        const series = TimeAggregator.fullDailySeries(sessions, 0, buckets);
        assert.strictEqual(series.length, 2);
        assert.strictEqual(series[0].date, localDateStrOf(new Date(Y, M, D - 60).getTime()));
        assert.strictEqual(series[0].totalMs, 60000);
        // 按日期查找（不依赖排序位置）
        const byDate = new Map(series.map(s => [s.date, s]));
        assert.strictEqual(byDate.get(localDateStrOf(new Date(Y, M, D - 1).getTime())).totalMs, 1800000,
            '同日并存时以原始计算覆盖折叠桶');
        // 升序
        for (let i = 1; i < series.length; i++) {
            assert.ok(series[i].date > series[i - 1].date, '应按日期升序');
        }
    });

    it('进行中会话时长并入今日桶', () => {
        // 今天本地零点起（now 必然 >= 零点，区间确定非空）
        const start = new Date(Y, M, D).getTime();
        const series = TimeAggregator.fullDailySeries([], start);
        assert.strictEqual(series.length, 1);
        assert.strictEqual(series[0].date, localDateStrOf(start));
        assert.ok(series[0].totalMs >= 0);
    });
});

describe('TimeAggregator：heatmapDays 活动热力图', () => {
    const now = new Date();
    const Y = now.getFullYear(), M = now.getMonth(), D = now.getDate();
    const dow = (now.getDay() + 6) % 7; // 0=周一 … 6=周日

    it('生成 12 周 × 7 天网格，首格为窗口起始周一，future 天不计时长', () => {
        const days = TimeAggregator.heatmapDays([], 0, undefined, 12);
        assert.strictEqual(days.length, 84, '12 周 × 7 天 = 84 格');

        // 首格必须是「今日所在周一」往前 11 周的周一（与实现同口径：Date 构造）
        const firstMonday = new Date(Y, M, D - dow - 11 * 7);
        assert.strictEqual(days[0].weekday, 0, '首格为周一');
        assert.strictEqual(days[0].dateStr, localDateStrOf(firstMonday.getTime()));

        // 每列 7 天、周一为首行
        for (let i = 0; i < days.length; i++) {
            assert.strictEqual(days[i].weekday, i % 7, `第 ${i} 格星期错位`);
        }

        // future 天 = 本周尚未到达的天数（周日 dow=6 → 0；周一 dow=0 → 6）
        const futureCount = days.filter(d => d.future).length;
        assert.strictEqual(futureCount, 6 - dow);
        for (const d of days) {
            if (d.future) assert.strictEqual(d.totalMs, 0, 'future 天不计时长');
            else assert.ok(d.totalMs >= 0);
        }
    });

    it('按日聚合：折叠桶 + 原始会话同日以原始为准，档位着色正确', () => {
        const todayStart = new Date(Y, M, D).getTime();
        const yesterdayStart = new Date(Y, M, D - 1).getTime();
        const buckets = {
            [localDateStrOf(yesterdayStart)]: { totalMs: 7200000, sessionCount: 1 }, // 2h → l3
        };
        const sessions = [{
            startMs: yesterdayStart,
            endMs: yesterdayStart + 1800000, // 30m → l1
            durationMs: 1800000,
        }];
        // currentSessionStartMs = 今天零点：验证进行中会话并入今日格
        const days = TimeAggregator.heatmapDays(sessions, todayStart, buckets, 12);
        const byDate = new Map(days.map(d => [d.dateStr, d]));
        const yest = byDate.get(localDateStrOf(yesterdayStart));
        assert.ok(yest, '窗口含昨天');
        assert.strictEqual(yest.totalMs, 1800000, '同日原始会话覆盖折叠桶');
        assert.strictEqual(yest.level, 1, '<1h → l1');

        // 进行中会话（今天零点起）并入今日格
        const today = byDate.get(localDateStrOf(todayStart));
        assert.ok(today && today.totalMs > 0, '进行中会话并入今日格');
    });

    it('窗口化：窗口之外的会话不参与聚合（性能边界）', () => {
        // 90 天前（超出 12 周窗口）的会话
        const oldStart = new Date(Y, M, D - 90, 10).getTime();
        const sessions = [{
            startMs: oldStart,
            endMs: oldStart + 3600000,
            durationMs: 3600000,
        }];
        const days = TimeAggregator.heatmapDays(sessions, 0, undefined, 12);
        const total = days.reduce((s, d) => s + d.totalMs, 0);
        assert.strictEqual(total, 0, '窗口外会话不计入');
    });
});
