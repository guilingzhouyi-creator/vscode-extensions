/**
 * DataValidator — 还原校验器单测
 * 结构非法 → 拒绝；条目级脏数据 → 过滤；正常数据 → 通过且字段净化。
 */
'use strict';

const assert = require('assert');
const { validateTimingData } = require('../../out/persistence/DataValidator.js');

function validFile(overrides = {}) {
    return Object.assign({
        version: 1,
        totalMs: 1000,
        currentSessionStartMs: 0,
        isEnabled: true,
        sessions: [{ startMs: 100, endMs: 200, durationMs: 100 }],
    }, overrides);
}

describe('DataValidator（还原校验器）', () => {
    it('合法文件通过并补齐 version/lastSavedAtMs', () => {
        const r = validateTimingData(validFile({ version: 1 }));
        assert.ok(r.ok);
        assert.strictEqual(r.data.version, 2, '应标准化为 LATEST_VERSION');
        assert.strictEqual(r.data.totalMs, 1000);
        assert.strictEqual(r.data.currentSessionStartMs, 0, '还原后强制从干净状态开始');
        assert.ok(typeof r.data.lastSavedAtMs === 'number');
    });

    it('整体结构非法：非对象 / 缺 sessions / 负 totalMs', () => {
        assert.strictEqual(validateTimingData(null).ok, false);
        assert.strictEqual(validateTimingData([1, 2]).ok, false);
        assert.strictEqual(validateTimingData({ totalMs: 0 }).ok, false, '缺 sessions');
        const r = validateTimingData(validFile({ totalMs: -5 }));
        assert.strictEqual(r.ok, false);
        assert.match(r.error, /totalMs/);
    });

    it('条目级脏会话被过滤而非整体拒绝', () => {
        const r = validateTimingData(validFile({
            sessions: [
                { startMs: 100, endMs: 200, durationMs: 100 },   // 合法
                { startMs: 500, endMs: 300, durationMs: -200 },  // 倒挂
                { startMs: 0, endMs: 10, durationMs: 10 },       // 非正起点
                { startMs: 'x', endMs: 1, durationMs: 1 },       // 非数字
                null,
            ],
        }));
        assert.ok(r.ok);
        assert.strictEqual(r.data.sessions.length, 1);
    });

    it('dailyTotals：合法桶保留，坏 key/坏值跳过；缺失时输出无该字段', () => {
        const withBuckets = validateTimingData(validFile({
            dailyTotals: {
                '2026-01-02': { totalMs: 50, sessionCount: 1 },
                'bad-key': { totalMs: 1, sessionCount: 1 },
                '2026-01-03': { totalMs: -1, sessionCount: 0 },
            },
        }));
        assert.ok(withBuckets.ok);
        assert.deepStrictEqual(withBuckets.data.dailyTotals['2026-01-02'],
            { totalMs: 50, sessionCount: 1 });
        assert.strictEqual(withBuckets.data.dailyTotals['bad-key'], undefined);

        const without = validateTimingData(validFile());
        assert.ok(without.ok && without.data.dailyTotals === undefined);
    });
});
