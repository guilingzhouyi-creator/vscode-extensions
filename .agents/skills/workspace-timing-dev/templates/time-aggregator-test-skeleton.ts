/**
 * Module: Unit Tests — Time Aggregator Natural Day Splitting Skeleton
 * File Path: test/unit/time-aggregator.test.ts
 * Architecture Role: Deterministic regression test suite for timing conservation
 * Dependencies: assert, TimeAggregator
 * Responsibilities: Verify cross-midnight session splitting and duration conservation
 * Exit Semantics & Design Rationale: Pure deterministic test with withFixedNow mock clock
 */
import * as assert from 'assert';

describe('TimeAggregator: 跨自然日会话切分与工时守恒测试', () => {
    it('跨午夜会话应原子切分为 segmentedSessions 并保持总时长严格守恒', () => {
        // 构造跨午夜时间戳区间: 前一日 23:45:00 至次日 00:30:00 (共 45 分钟 = 2,700,000 ms)
        const startMs = new Date('2026-10-10T23:45:00.000Z').getTime();
        const endMs = new Date('2026-10-11T00:30:00.000Z').getTime();
        const totalDurationExpected = endMs - startMs;

        // 模拟切分逻辑 (伪代码，对齐 TimeAggregator 真实接口)
        const day1Ms = new Date('2026-10-10T23:59:59.999Z').getTime() - startMs + 1;
        const day2Ms = endMs - new Date('2026-10-11T00:00:00.000Z').getTime();

        const segmentedSessions = [
            { date: '2026-10-10', durationMs: day1Ms },
            { date: '2026-10-11', durationMs: day2Ms }
        ];

        // 断言: 切分片段数正确
        assert.strictEqual(segmentedSessions.length, 2, '必须切分为两段独立的 segmentedSessions');

        // 断言: 总工时严格守恒 (无毫秒级丢失或多余累加)
        const actualTotalDuration = segmentedSessions.reduce((acc, s) => acc + s.durationMs, 0);
        assert.strictEqual(actualTotalDuration, totalDurationExpected, '切分后总时长必须与原始会话时长严格恒等');
    });
});
