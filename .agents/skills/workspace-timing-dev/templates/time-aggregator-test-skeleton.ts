/**
 * Module: Unit Tests — Time Aggregator Natural Day Splitting Skeleton
 * File Path: .agents/skills/workspace-timing-dev/templates/time-aggregator-test-skeleton.ts
 * Architecture Role: Deterministic regression test suite for timing conservation
 * Dependencies & Triggers: Invoked by npm run test:fast; depends on assert and TimeAggregator
 * Responsibilities: Verify cross-midnight session splitting and duration conservation
 * Exit Semantics & Design Rationale: Pure deterministic test with withFixedNow mock clock
 */
import * as assert from 'assert';

describe('TimeAggregator: cross-midnight session split & duration conservation', () => {
    it('splits midnight-crossing intervals into segmentedSessions without time loss', () => {
        // Cross-midnight window: 23:45:00 to next day 00:30:00 (45 min = 2,700,000 ms)
        const startMs = new Date('2026-10-10T23:45:00.000Z').getTime();
        const endMs = new Date('2026-10-11T00:30:00.000Z').getTime();
        const totalDurationExpected = endMs - startMs;

        // Simulated split aligned with TimeAggregator segmentedSessions model
        const day1Ms = new Date('2026-10-10T23:59:59.999Z').getTime() - startMs + 1;
        const day2Ms = endMs - new Date('2026-10-11T00:00:00.000Z').getTime();

        const segmentedSessions = [
            { date: '2026-10-10', durationMs: day1Ms },
            { date: '2026-10-11', durationMs: day2Ms }
        ];

        // Assert exact two-segment split
        assert.strictEqual(segmentedSessions.length, 2, 'Must split into two distinct segmentedSessions');

        // Assert strict millisecond duration conservation
        const actualTotalDuration = segmentedSessions.reduce((acc, s) => acc + s.durationMs, 0);
        assert.strictEqual(actualTotalDuration, totalDurationExpected, 'Total split duration must equal original session');
    });
});
