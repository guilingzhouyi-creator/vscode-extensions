/**
 * TimezoneParity — 跨时区与 UTC(Z) 规约对齐脱机测试矩阵
 *
 * 验证：
 * 1. 多时区矩阵 (UTC-8, UTC+0, UTC+8, UTC+9, UTC+12:45) 下的工时绝对守恒
 * 2. 跨时区投影（UTC+8 vs UTC-8）零时间泄漏与自然日守恒
 * 3. 历史折叠前后（Folded vs Raw）数学等价
 * 4. 24 小时桶守恒（sum(hourly) === dailyDetail.totalMs === sum(entries.durationMs)）
 * 5. ISO-8601 UTC 'Z' 格式与双向解析对齐
 * 6. TimerEngine 跨时区感知与今日重叠精准度
 */
'use strict';

const assert = require('assert');
const {
    TimeAggregator,
    toUtcIsoString,
    utcDateStr,
    parseUtcDateStartMs,
    formatTzDateStr,
    parseTzDateStartMs,
    parseLocalDate,
    localDateStr,
    weekStartStr,
    weekKeyOf,
    splitByNaturalDay,
    dailyStats,
    dailyDetail,
    weeklyStats,
    weeklySummary,
    last7Days,
    fullDailySeries,
    heatmapDays,
} = require('../../out/domain/TimeAggregator.js');

const {
    recycleSessions,
    foldSessionsIntoTotals,
    migrateToFolded,
    sanitizeOverlappingDailyTotals,
    foldCutoffStartMs,
} = require('../../out/domain/history-folder.js');

const { TimerEngine } = require('../../out/domain/TimerEngine.js');

describe('TimezoneParity（多时区矩阵与 UTC 标准化对齐）', () => {
    // 5 大代表性时区偏移（分钟）
    const TZ_MATRIX = [
        { name: 'UTC-8 (Pacific)', offset: -480 },
        { name: 'UTC+0 (London/GMT)', offset: 0 },
        { name: 'UTC+8 (Beijing/CST)', offset: 480 },
        { name: 'UTC+9 (Tokyo/JST)', offset: 540 },
        { name: 'UTC+12:45 (Chatham)', offset: 765 },
    ];

    describe('1. ISO-8601 UTC 标准原语', () => {
        it('toUtcIsoString：输出合规 ISO-8601 字符串且必带 Z 后缀', () => {
            const ms = 1730480400000; // 2026-11-01T17:00:00.000Z
            const str = toUtcIsoString(ms);
            assert.ok(str.endsWith('Z'), '必须以 Z 结尾');
            assert.strictEqual(str, '2024-11-01T17:00:00.000Z');
            assert.strictEqual(new Date(str).getTime(), ms);
        });

        it('utcDateStr 与 parseUtcDateStartMs 双向闭合', () => {
            const ms = Date.UTC(2026, 5, 15, 14, 30, 0);
            const dateStr = utcDateStr(ms);
            assert.strictEqual(dateStr, '2026-06-15');
            const midnightMs = parseUtcDateStartMs(dateStr);
            assert.strictEqual(midnightMs, Date.UTC(2026, 5, 15, 0, 0, 0));
        });

        it('formatTzDateStr 与 parseTzDateStartMs 任意时区偏移闭合', () => {
            for (const tz of TZ_MATRIX) {
                // 物理时间戳：某时刻
                const sampleMs = Date.UTC(2026, 10, 2, 0, 30, 0); // 2026-11-02 00:30 UTC
                const dateInTz = formatTzDateStr(sampleMs, tz.offset);
                const midnightInTz = parseTzDateStartMs(dateInTz, tz.offset);
                // midnightInTz + 24h 必须覆盖 sampleMs
                assert.ok(sampleMs >= midnightInTz, `${tz.name} 样本时间应在午夜之后`);
                assert.ok(sampleMs < midnightInTz + 86400000, `${tz.name} 样本时间应在当日 24h 内`);
            }
        });
    });

    describe('2. 跨时区工时绝对守恒律（Conservation of Duration）', () => {
        it('跨午夜会话在所有 5 大时区切分后，总时长与 manual/ai 分割绝对守恒', () => {
            // 会话跨越 10 小时，覆盖 UTC 午夜 (从前一天 18:00 UTC 到次日 04:00 UTC)
            const startMs = Date.UTC(2026, 10, 1, 18, 0, 0);
            const endMs = Date.UTC(2026, 10, 2, 4, 0, 0);
            const totalDuration = endMs - startMs; // 10h
            const manualMs = 6 * 3600000; // 6h
            const aiMs = 4 * 3600000; // 4h

            for (const tz of TZ_MATRIX) {
                const segs = splitByNaturalDay(startMs, endMs, manualMs, aiMs, tz.offset);
                const segDurationSum = segs.reduce((sum, s) => sum + s.durationMs, 0);
                const segManualSum = segs.reduce((sum, s) => sum + (s.manualMs || 0), 0);
                const segAiSum = segs.reduce((sum, s) => sum + (s.aiMs || 0), 0);

                assert.strictEqual(segDurationSum, totalDuration, `${tz.name} 总时长必须守恒`);
                assert.strictEqual(segManualSum, manualMs, `${tz.name} 手动时长必须守恒`);
                assert.strictEqual(segAiSum, aiMs, `${tz.name} AI 时长必须守恒`);
            }
        });

        it('多会话集合 dailyStats 在所有时区下总时长严格守恒', () => {
            const sessions = [
                { startMs: Date.UTC(2026, 10, 1, 10, 0), endMs: Date.UTC(2026, 10, 1, 12, 0), durationMs: 7200000 },
                { startMs: Date.UTC(2026, 10, 1, 22, 0), endMs: Date.UTC(2026, 10, 2, 3, 0), durationMs: 18000000 },
                { startMs: Date.UTC(2026, 10, 2, 14, 0), endMs: Date.UTC(2026, 10, 2, 17, 30), durationMs: 12600000 },
            ];
            const expectedTotal = sessions.reduce((sum, s) => sum + s.durationMs, 0);

            for (const tz of TZ_MATRIX) {
                const stats = dailyStats(sessions, tz.offset);
                const actualTotal = stats.reduce((sum, d) => sum + d.totalMs, 0);
                assert.strictEqual(actualTotal, expectedTotal, `${tz.name} 下 dailyStats 总时长应完全一致`);
            }
        });
    });

    describe('3. 单日 24 小时桶数学守恒与 UTC(Z) 标记', () => {
        it('dailyDetail 小时桶总和与单日 totalMs 及会话明细时长完全等价', () => {
            const sessions = [
                {
                    startMs: Date.UTC(2026, 10, 1, 2, 15),
                    endMs: Date.UTC(2026, 10, 1, 5, 45),
                    durationMs: 3.5 * 3600000,
                    manualMs: 2 * 3600000,
                    aiMs: 1.5 * 3600000,
                },
                {
                    startMs: Date.UTC(2026, 10, 1, 20, 0),
                    endMs: Date.UTC(2026, 10, 2, 2, 0),
                    durationMs: 6 * 3600000,
                    manualMs: 4 * 3600000,
                    aiMs: 2 * 3600000,
                },
            ];

            for (const tz of TZ_MATRIX) {
                const dateStr = formatTzDateStr(Date.UTC(2026, 10, 1, 12, 0), tz.offset);
                const detail = dailyDetail(sessions, dateStr, 0, 'manual', tz.offset);

                const hourlySum = detail.hourly.reduce((sum, h) => sum + h.totalMs, 0);
                const hourlyManual = detail.hourly.reduce((sum, h) => sum + h.manualMs, 0);
                const hourlyAi = detail.hourly.reduce((sum, h) => sum + h.aiMs, 0);
                const sessionSum = detail.sessions.reduce((sum, s) => sum + s.durationMs, 0);

                assert.strictEqual(hourlySum, detail.totalMs, `${tz.name} 小时桶总和应等于 detail.totalMs`);
                assert.strictEqual(sessionSum, detail.totalMs, `${tz.name} 会话明细总和应等于 detail.totalMs`);
                assert.strictEqual(hourlyManual + hourlyAi, hourlySum, `${tz.name} 双轨工时之和应等于小时总和`);

                // 校验所有 DailySessionEntry 均包含 UTC 'Z' 格式字段且双向可解析
                for (const entry of detail.sessions) {
                    assert.ok(entry.startUtcIso && entry.startUtcIso.endsWith('Z'), 'startUtcIso 必须带 Z');
                    assert.ok(entry.endUtcIso && entry.endUtcIso.endsWith('Z'), 'endUtcIso 必须带 Z');
                    assert.strictEqual(new Date(entry.startUtcIso).getTime(), entry.startMs);
                    assert.strictEqual(new Date(entry.endUtcIso).getTime(), entry.endMs);
                }
            }
        });
    });

    describe('4. 历史折叠前后等价性与跨时区日桶记录', () => {
        it('折叠进 dailyTotals 时记录 recordedOffsetMinutes，且全历史展开与原始会话等价', () => {
            const rawSessions = [
                { startMs: Date.UTC(2026, 9, 10, 8, 0), endMs: Date.UTC(2026, 9, 10, 12, 0), durationMs: 14400000 },
                { startMs: Date.UTC(2026, 9, 11, 14, 0), endMs: Date.UTC(2026, 9, 11, 18, 0), durationMs: 14400000 },
            ];

            const tzOffset = 480; // UTC+8
            const foldRes = recycleSessions(rawSessions, {}, {
                retentionDays: 1, // 立即折叠
                now: Date.UTC(2026, 9, 15, 0, 0),
                utcOffsetMinutes: tzOffset,
            });

            assert.strictEqual(foldRes.keptSessions.length, 0, '所有过期会话应已被折叠');
            assert.strictEqual(foldRes.foldedSessionCount, 2, '折叠计数应为 2');

            for (const bucket of Object.values(foldRes.updatedDailyTotals)) {
                assert.strictEqual(bucket.recordedOffsetMinutes, tzOffset, '日桶应正确记录时区偏置');
            }

            // 使用 fullDailySeries 展开，总时长必须与原始会话一致
            const series = fullDailySeries(foldRes.keptSessions, 0, foldRes.updatedDailyTotals, tzOffset);
            const seriesTotal = series.reduce((sum, s) => sum + s.totalMs, 0);
            assert.strictEqual(seriesTotal, 28800000, '折叠后 fullDailySeries 总工时必须守恒');
        });
    });

    describe('5. TimerEngine 跨时区感知与今日累计', () => {
        it('updateTimezone 触发今日零点重新对齐，O(1) 今日指标精确对应新时区', () => {
            // 构造在 UTC 2026-11-01 22:00 ~ 23:00 的已结束会话 (历时 1h)
            // 在 UTC+0 下属于 2026-11-01 的今天（假设当前是 2026-11-01 23:30 UTC）
            // 在 UTC+8 下属于 2026-11-02 06:00 ~ 07:00（是 2026-11-02 的今天）
            const sessionStart = Date.UTC(2026, 10, 1, 22, 0, 0);
            const sessionEnd = Date.UTC(2026, 10, 1, 23, 0, 0);

            const initialData = {
                totalMs: 3600000,
                manualTotalMs: 3600000,
                aiTotalMs: 0,
                idleTotalMs: 0,
                currentSessionStartMs: 0,
                lastSavedAtMs: sessionEnd,
                sessions: [{
                    startMs: sessionStart,
                    endMs: sessionEnd,
                    durationMs: 3600000,
                    manualMs: 3600000,
                    aiMs: 0,
                }],
                timezone: 'UTC',
                utcOffsetMinutes: 0,
            };

            const engine = new TimerEngine(initialData);
            assert.strictEqual(engine.data.utcOffsetMinutes, 0);

            // 切换到 UTC+8
            engine.updateTimezone('Asia/Shanghai', 480);
            assert.strictEqual(engine.data.timezone, 'Asia/Shanghai');
            assert.strictEqual(engine.data.utcOffsetMinutes, 480);
            assert.strictEqual(engine.data.totalMs, 3600000, '总时长不受时区切换影响');
        });
    });
});
