/**
 * ConfigBounds — 配置边界单一真源单测
 *
 * 对编译产物 out/domain/models.js 的净化器断言，零 VS Code 运行时依赖。
 * 契约：所有数值净化器对非法输入（非数字/NaN/Infinity）回退默认值，
 * 合法输入钳制到与 package.json contributes 完全一致的合法域
 * （ringBuffer [64,65536]、journalFlush [1000,300000]、fullSave [5000,600000]、
 *  retention [0,3650]、maxSessions ≥0、weeklyLimit [1,168]）；
 * 枚举净化器对手写漂移值回退默认。
 */
'use strict';

const assert = require('assert');
const m = require('../../out/domain/models.js');

describe('ConfigBounds（配置边界单一真源）', () => {
    it('ringBufferCapacity：钳制到 [64, 65536]', () => {
        assert.strictEqual(m.sanitizeRingBufferCapacity(1024), 1024, '域内值原样保留');
        assert.strictEqual(m.sanitizeRingBufferCapacity(1), m.MIN_RING_BUFFER_CAPACITY, '下界钳制');
        assert.strictEqual(m.sanitizeRingBufferCapacity(-5), m.MIN_RING_BUFFER_CAPACITY, '负值钳到最小');
        assert.strictEqual(m.sanitizeRingBufferCapacity(999999), m.MAX_RING_BUFFER_CAPACITY, '上界钳制');
        assert.strictEqual(m.sanitizeRingBufferCapacity(64.7), 65, '四舍五入取整');
    });

    it('journalFlushIntervalMs：钳制到 [1000, 300000]', () => {
        assert.strictEqual(m.sanitizeJournalFlushIntervalMs(10000), 10000, '域内值原样保留');
        assert.strictEqual(m.sanitizeJournalFlushIntervalMs(0), m.MIN_JOURNAL_FLUSH_MS, '0 钳到最小');
        assert.strictEqual(m.sanitizeJournalFlushIntervalMs(999999), m.MAX_JOURNAL_FLUSH_MS, '上界钳制');
    });

    it('fullSaveIntervalMs：钳制到 [5000, 600000]', () => {
        assert.strictEqual(m.sanitizeFullSaveIntervalMs(60000), 60000, '域内值原样保留');
        assert.strictEqual(m.sanitizeFullSaveIntervalMs(-5), m.MIN_FULL_SAVE_MS, '负值钳到最小');
        assert.strictEqual(m.sanitizeFullSaveIntervalMs(1000), m.MIN_FULL_SAVE_MS, '低于 UI 下限 5000 一律钳回');
        assert.strictEqual(m.sanitizeFullSaveIntervalMs(900000), m.MAX_FULL_SAVE_MS, '上界钳制');
    });

    it('historyRawRetentionDays：钳制到 [0, 3650]', () => {
        assert.strictEqual(m.sanitizeHistoryRawRetentionDays(45), 45, '域内值原样保留');
        assert.strictEqual(m.sanitizeHistoryRawRetentionDays(-1), 0, '负值钳到 0（不折叠）');
        assert.strictEqual(m.sanitizeHistoryRawRetentionDays(5000), m.MAX_RAW_RETENTION_DAYS, '上界钳制');
    });

    it('maxSessions：非负钳制，0 保留（不限）', () => {
        assert.strictEqual(m.sanitizeMaxSessions(5000), 5000, '域内值原样保留');
        assert.strictEqual(m.sanitizeMaxSessions(0), 0, '0 = 不限，原样保留');
        assert.strictEqual(m.sanitizeMaxSessions(-10), 0, '负值钳到 0');
    });

    it('非法输入（NaN/Infinity/字符串垃圾）一律回退默认值', () => {
        const cases = [
            [m.sanitizeRingBufferCapacity, m.DEFAULT_RING_BUFFER_CAP],
            [m.sanitizeJournalFlushIntervalMs, m.DEFAULT_JOURNAL_FLUSH_MS],
            [m.sanitizeFullSaveIntervalMs, m.MS_PER_MINUTE],
            [m.sanitizeHistoryRawRetentionDays, m.DEFAULT_RAW_RETENTION_DAYS],
            [m.sanitizeMaxSessions, m.DEFAULT_MAX_SESSIONS],
        ];
        for (const [fn, fallback] of cases) {
            assert.strictEqual(fn(NaN), fallback, 'NaN 回退默认');
            assert.strictEqual(fn(Infinity), fallback, 'Infinity 回退默认');
            assert.strictEqual(fn('abc'), fallback, '非数字字符串回退默认');
            assert.strictEqual(fn(undefined), fallback, '空值回退默认');
            assert.strictEqual(fn(null), fallback, 'null 回退默认');
        }
    });

    it('数字字符串可解析（面板手写 JSON 场景）', () => {
        assert.strictEqual(m.sanitizeRingBufferCapacity('2048'), 2048, '数字字符串解析');
        assert.strictEqual(m.sanitizeFullSaveIntervalMs('abc'), m.MS_PER_MINUTE, '垃圾字符串回退');
    });

    it('weeklyLimitHours：钳制到 [1, 168]', () => {
        assert.strictEqual(m.sanitizeWeeklyLimitHours(40), 40, '域内值原样保留');
        assert.strictEqual(m.sanitizeWeeklyLimitHours(0), m.MIN_WEEKLY_LIMIT_HOURS, '0 钳到 1');
        assert.strictEqual(m.sanitizeWeeklyLimitHours(200), m.MAX_WEEKLY_LIMIT_HOURS, '上界钳制');
        assert.strictEqual(m.sanitizeWeeklyLimitHours(NaN), m.DEFAULT_WEEKLY_LIMIT_HOURS, 'NaN 回退默认');
        assert.strictEqual(m.sanitizeWeeklyLimitHours('75'), 75, '数字字符串解析');
    });

    it('statusBarMode：非枚举值回退 today-total', () => {
        assert.strictEqual(m.sanitizeStatusBarMode('compact'), 'compact', '合法枚举保留');
        assert.strictEqual(m.sanitizeStatusBarMode('total-today'), 'total-today', '合法枚举保留');
        assert.strictEqual(m.sanitizeStatusBarMode('hacker-mode'), 'today-total', '手写漂移回退默认');
        assert.strictEqual(m.sanitizeStatusBarMode(42), 'today-total', '非字符串回退默认');
    });

    it('locale：非枚举值回退 auto', () => {
        assert.strictEqual(m.sanitizeLocale('zh-CN'), 'zh-CN', '合法枚举保留');
        assert.strictEqual(m.sanitizeLocale('en'), 'en', '合法枚举保留');
        assert.strictEqual(m.sanitizeLocale('fr'), 'auto', '手写漂移回退默认');
        assert.strictEqual(m.sanitizeLocale(null), 'auto', '空值回退默认');
    });

    it('边界常量与 package.json contributes 三方一致（防双真源漂移回归）', () => {
        const pkg = require('../../package.json');
        const props = pkg.contributes.configuration.properties;
        const bounds = {
            'workspaceTiming.storage.ringBufferCapacity': [m.MIN_RING_BUFFER_CAPACITY, m.MAX_RING_BUFFER_CAPACITY],
            'workspaceTiming.storage.journalFlushInterval': [m.MIN_JOURNAL_FLUSH_MS, m.MAX_JOURNAL_FLUSH_MS],
            'workspaceTiming.storage.fullSaveInterval': [m.MIN_FULL_SAVE_MS, m.MAX_FULL_SAVE_MS],
            'workspaceTiming.storage.historyRawRetentionDays': [0, m.MAX_RAW_RETENTION_DAYS],
            'workspaceTiming.weeklyLimit.hours': [m.MIN_WEEKLY_LIMIT_HOURS, m.MAX_WEEKLY_LIMIT_HOURS],
        };
        for (const [key, [min, max]] of Object.entries(bounds)) {
            assert.strictEqual(props[key].minimum, min, `${key} 下界与领域常量一致`);
            if (max !== Number.MAX_SAFE_INTEGER) {
                assert.strictEqual(props[key].maximum, max, `${key} 上界与领域常量一致`);
            }
        }
        assert.strictEqual(props['workspaceTiming.storage.maxSessions'].minimum, 0, 'maxSessions 下界为 0');
    });
});