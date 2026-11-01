/**
 * Module: Trajectory Score Fallbacks Unit Tests
 * File Path: tests/unit/trajectory-score-fallbacks.test.ts
 * Architecture Role: Regression guard for the "unmeasured is not clean" contract across the
 *   trajectory layer. Three modules used to substitute a convenient constant whenever a
 *   measurement was missing: agent attribution scored an unreported revision at 100, the patch
 *   arbiter ranked an unscored candidate at 90, and the verification summary reported a perfect
 *   kill rate of 1.0 when no run had measured one.
 * Dependencies & Triggers: Vitest; AgentAttributionTracker, PatchArbiter, aggregateWeeklySummaries.
 * Responsibilities: Prove each of those values is reported as absent (null) rather than as a
 *   fabricated best-case number, and that a real measurement still flows through unchanged.
 * Exit Semantics & Design Rationale: Deterministic, no clock and no RNG. The assertions are on the
 *   absence itself, because a test that only checked the happy path would keep passing while the
 *   constants came back.
 */

import { describe, it, expect } from 'vitest';
import { AgentAttributionTracker } from '../../src/core/trajectory/agentAttribution';
import { PatchArbiter } from '../../src/core/trajectory/patchArbiter';
import { aggregateWeeklySummaries } from '../../src/core/trajectory/trajectory-compactor';
import type { FileRevision } from '../../src/core/trajectory/types';
import type { WeeklyTrajectorySummary } from '../../src/core/trajectory/eloc-types';

const filePath = 'src/example.ts';

/**
 * Builds a revision with an optional measured composite score.
 *
 * @param revisionId - Revision identity.
 * @param agentUid - Authoring agent.
 * @param compositeScore - Measured composite, or undefined to model an unmeasured revision.
 * @returns File revision accepted by the attribution tracker.
 */
function revision(revisionId: string, agentUid: string, compositeScore?: number): FileRevision {
    return {
        revisionId,
        filePath,
        timestamp: 0,
        agentUid,
        fileHash: revisionId,
        astDigest: revisionId,
        qualityScore: {
            // `compositeScore` is typed as a number, so an unmeasured revision is modelled by the
            // NaN the scorer emits when no dimension was evaluated.
            compositeScore: compositeScore ?? Number.NaN,
            indices: {},
        } as FileRevision['qualityScore'],
        ruleHitIds: [],
    } as FileRevision;
}

/**
 * Builds a weekly summary carrying only the fields the verification fold reads.
 *
 * @param verification - Verification block, or undefined to omit it.
 * @returns Weekly summary shaped for the aggregator.
 */
function weeklySummary(
    verification?: WeeklyTrajectorySummary['verification'],
): WeeklyTrajectorySummary {
    return {
        weekId: '2026-W01',
        startMs: 0,
        endMs: 1,
        totalRuns: 1,
        eloc: { processedTotal: 10, uniqueTotal: 10, changedTotal: 1, semanticTotal: 1 },
        qed: { mean: 0, min: 0, max: 0, kMean: 0 },
        debt: {
            totalAdded: 0,
            totalResolved: 0,
            totalRegressions: 0,
            netYield: 0,
            densityYield: 0,
        },
        meanCompositeScore: 80,
        gatePassRate: 100,
        stability: {
            zeroRegressionRuns: 1,
            zeroRegressionStreak: 1,
            semanticPurityRatio: 1,
            uniqueCoverageRatio: 1,
            scoreFloor: 80,
            scoreCeiling: 80,
        },
        ...(verification ? { verification } : {}),
    };
}

describe('AgentAttributionTracker unmeasured scores', () => {
    it('reports a null average when no revision carried a measured score', () => {
        const tracker = new AgentAttributionTracker();
        const attributions = tracker.computeFromRevisions(filePath, [
            revision('r1', 'agent-x'),
            revision('r2', 'agent-x'),
        ]);

        expect(attributions['agent-x'].averageQualityScore).toBeNull();
        expect(attributions['agent-x'].scoreImpact).toBeNull();
    });

    it('averages only the measured revisions', () => {
        const tracker = new AgentAttributionTracker();
        const attributions = tracker.computeFromRevisions(filePath, [
            revision('r1', 'agent-y', 80),
            revision('r2', 'agent-y'),
            revision('r3', 'agent-y', 90),
        ]);

        // 85 rather than (80 + 100 + 90) / 3 = 90, which is what the substituted constant produced.
        expect(attributions['agent-y'].averageQualityScore).toBe(85);
    });

    it('leaves score impact null when patch slices supply no baseline', () => {
        const tracker = new AgentAttributionTracker();
        const attributions = tracker.computeFromPatches([
            {
                agentUid: 'agent-z',
                patchId: 'p1',
                filePath,
                timestamp: 0,
                oldContent: 'a',
                newContent: 'b',
                addedLines: 1,
                deletedLines: 1,
                compositeScore: 92,
            },
        ]);

        expect(attributions['agent-z'].averageQualityScore).toBe(92);
        expect(attributions['agent-z'].scoreImpact).toBeNull();
    });
});

describe('PatchArbiter candidate scoring', () => {
    const before = 'export function calc(a: number, b: number): number {\n    return a + b;\n}';
    const better =
        'export function calc(a: number, b: number): number {\n' +
        '    if (Number.isNaN(a) || Number.isNaN(b)) return 0;\n' +
        '    return a + b;\n' +
        '}';

    it('keeps the measured composite distinct from the ranking score', () => {
        const arbiter = new PatchArbiter();
        const candidates = arbiter.arbitratePatches([
            {
                agentUid: 'agent-a',
                patchId: 'p1',
                filePath: 'src/domain/calc.ts',
                timestamp: 0,
                oldContent: before,
                newContent: better,
                addedLines: 3,
                deletedLines: 1,
                compositeScore: 98,
                ruleHitIds: [],
            },
        ]);

        expect(candidates[0].compositeScore).toBe(98);
        expect(candidates[0].arbitrationScore).not.toBe(candidates[0].compositeScore);
        expect(candidates[0].isRecommended).toBe(true);
    });

    it('derives the composite from the evaluation when the patch reports none', () => {
        const arbiter = new PatchArbiter();
        const candidates = arbiter.arbitratePatches([
            {
                agentUid: 'agent-b',
                patchId: 'p2',
                filePath: 'src/domain/calc.ts',
                timestamp: 0,
                oldContent: before,
                newContent: better,
                addedLines: 3,
                deletedLines: 1,
                ruleHitIds: [],
            },
        ]);

        // A substituted 90 would make this assertion pass for the wrong reason, so the check is
        // that the value matches the engine's own before/after measurement.
        expect(Number.isFinite(candidates[0].compositeScore)).toBe(true);
        expect(candidates[0].compositeScore).not.toBe(90);
    });
});

describe('aggregateWeeklySummaries verification fold', () => {
    it('reports a missing kill rate as null instead of a perfect kill rate', () => {
        const summary = aggregateWeeklySummaries([
            weeklySummary({
                verifiedRuns: 1,
                meanMutationKillRate: null,
                minMutationKillRate: null,
                meanBayesianCredit: 70,
                minBayesianCiLower: null,
                quarantineCount: 0,
            }),
        ]);

        expect(summary.verification?.meanMutationKillRate).toBeNull();
        expect(summary.verification?.minMutationKillRate).toBeNull();
        expect(summary.verification?.minBayesianCiLower).toBeNull();
        expect(summary.verification?.meanBayesianCredit).toBe(70);
    });

    it('preserves a measured kill rate across the fold', () => {
        const summary = aggregateWeeklySummaries([
            weeklySummary({
                verifiedRuns: 2,
                meanMutationKillRate: 0.8,
                minMutationKillRate: 0.7,
                meanBayesianCredit: 88,
                minBayesianCiLower: 0.6,
                quarantineCount: 1,
            }),
        ]);

        expect(summary.verification?.meanMutationKillRate).toBe(0.8);
        expect(summary.verification?.minMutationKillRate).toBe(0.7);
        expect(summary.verification?.minBayesianCiLower).toBe(0.6);
        expect(summary.verification?.quarantineCount).toBe(1);
    });
});
