/**
 * Module: Unit Test Suite — Empirical-Bayes Confidence Calibration
 * File Path: tests/unit/scoring/confidence-calibration.test.ts
 * Architecture Role: Pins the statistical contract of the calibration module and of the arbiter
 *   wiring that consumes it. These are the properties a future refactor is most likely to break
 *   silently: the direction the posterior moves, the shrinkage weight, the neutral prior, and
 *   the fact that an uncalibrated finding no longer lands on the actionable ceiling.
 * Dependencies & Triggers: Consumes src/core/scoring/confidence-calibration.ts and
 *   finding-confidence-arbiter.ts; run by vitest in `npm test`.
 * Responsibilities:
 *   1. Assert posterior direction, unit-interval containment and bound bracketing.
 *   2. Assert the shrinkage anchor keeps small samples near the analyzer's own score.
 *   3. Assert the un-observed rule is neutral, and non-finite input degrades downward.
 *   4. Assert ECE and Brier respond to over-confidence and to the empty set.
 *   5. Assert the arbiter supersession: uncalibrated < well-observed, and provenance is recorded.
 * Exit Semantics & Design Rationale: Deterministic pure assertions with zero external I/O and no
 *   clock or RNG dependency, so a failure always means the statistics changed rather than the
 *   environment did.
 */

import { describe, it, expect } from 'vitest';
import type { Issue } from '../../../src/core/types';
import {
    calibrateRuleConfidence,
    computeBrierScore,
    computeExpectedCalibrationError,
    computeMeanConfidence,
    computeObservedAccuracy,
    evaluateCalibrationHealth,
    indexRuleStats,
    clampUnit,
    CALIBRATION_SHRINKAGE_ANCHOR,
    JEFFREYS_PRIOR,
    SOURCE_CALIBRATED,
    SOURCE_UNCALIBRATED,
} from '../../../src/core/scoring/confidence-calibration';
import {
    FindingConfidenceArbiter,
    CONFIDENCE_ACTIONABLE_DEFAULT,
    CONFIDENCE_ACTIONABLE_FLOOR,
} from '../../../src/core/scoring/finding-confidence-arbiter';

/**
 * Builds a minimal Issue carrying a deterministic patch, so it lands in the Actionable tier.
 *
 * @param overrides - Fields to override on the default record.
 * @returns Issue that the arbiter classifies as Actionable.
 */
function createActionableIssue(overrides: Partial<Issue> = {}): Issue {
    return {
        id: 'constants:magic-number:src/a.ts:1',
        analyzer: 'constants',
        rule: 'magic-number',
        severity: 'warning',
        message: 'Magic number 42',
        location: { file: 'src/a.ts', start: { line: 1, column: 1 }, end: { line: 1, column: 9 } },
        detail: {},
        actionable: {
            action: 'extract_constant',
            code: 'AR:CONST:001',
            safeToAutomate: true,
            templateSnippet: 'const VALUE = 42;',
            rationale: 'extract the literal',
        },
        ...overrides,
    };
}

describe('Confidence Calibration — Posterior Behaviour', () => {
    it('raises confidence when outcomes were confirmed and lowers it when rejected', () => {
        const confirmed = calibrateRuleConfidence(0.5, {
            rule: 'demo',
            truePositives: 200,
            falsePositives: 0,
        });
        const rejected = calibrateRuleConfidence(0.5, {
            rule: 'demo',
            truePositives: 0,
            falsePositives: 200,
        });

        expect(confirmed.calibrated).toBeGreaterThan(0.5);
        expect(rejected.calibrated).toBeLessThan(0.5);
        expect(confirmed.source).toBe(SOURCE_CALIBRATED);
        expect(confirmed.isReliable).toBe(true);
    });

    it('brackets the posterior mean inside the credible interval and keeps the score in between', () => {
        const record = calibrateRuleConfidence(0.5, {
            rule: 'demo',
            truePositives: 120,
            falsePositives: 3,
        });

        expect(record.lowerBound).toBeLessThanOrEqual(record.posteriorMean);
        expect(record.posteriorMean).toBeLessThanOrEqual(record.upperBound);
        expect(record.calibrated).toBeGreaterThanOrEqual(
            Math.min(record.raw, record.posteriorMean) - 1e-9,
        );
        expect(record.calibrated).toBeLessThanOrEqual(
            Math.max(record.raw, record.posteriorMean) + 1e-9,
        );
    });

    it('tightens the credible interval as observations accumulate', () => {
        const sparse = calibrateRuleConfidence(0.5, {
            rule: 'demo',
            truePositives: 1,
            falsePositives: 1,
        });
        const dense = calibrateRuleConfidence(0.5, {
            rule: 'demo',
            truePositives: 400,
            falsePositives: 400,
        });

        expect(dense.upperBound - dense.lowerBound).toBeLessThan(
            sparse.upperBound - sparse.lowerBound,
        );
    });
});

describe('Confidence Calibration — Shrinkage Anchor', () => {
    it('keeps a two-observation rule close to the analyzer self-report', () => {
        const raw = 0.9;
        const tiny = calibrateRuleConfidence(raw, {
            rule: 'demo',
            truePositives: 1,
            falsePositives: 1,
        });

        expect(tiny.isReliable).toBe(false);
        expect(Math.abs(tiny.calibrated - raw)).toBeLessThan(0.15);
    });

    it('lets a large sample almost fully override the self-report', () => {
        const huge = calibrateRuleConfidence(0.9, {
            rule: 'demo',
            truePositives: 0,
            falsePositives: 1000,
        });

        expect(huge.calibrated).toBeLessThan(0.05);
        expect(huge.isReliable).toBe(true);
    });

    it('marks reliability exactly at the shrinkage anchor', () => {
        const justBelow = calibrateRuleConfidence(0.5, {
            rule: 'demo',
            truePositives: CALIBRATION_SHRINKAGE_ANCHOR - 1,
            falsePositives: 0,
        });
        const atAnchor = calibrateRuleConfidence(0.5, {
            rule: 'demo',
            truePositives: CALIBRATION_SHRINKAGE_ANCHOR,
            falsePositives: 0,
        });

        expect(justBelow.isReliable).toBe(false);
        expect(atAnchor.isReliable).toBe(true);
    });
});

describe('Confidence Calibration — Neutral Prior and Input Hardening', () => {
    it('leaves an un-observed rule exactly at its self-reported score', () => {
        const neutral = calibrateRuleConfidence(0.8);

        expect(neutral.calibrated).toBe(0.8);
        expect(neutral.sampleSize).toBe(0);
        expect(neutral.source).toBe(SOURCE_UNCALIBRATED);
        expect(neutral.isReliable).toBe(false);
        expect(neutral.alpha).toBe(JEFFREYS_PRIOR);
        expect(neutral.beta).toBe(JEFFREYS_PRIOR);
    });

    it('clamps out-of-range input and degrades NaN downward rather than guessing upward', () => {
        expect(calibrateRuleConfidence(5, undefined).calibrated).toBe(1);
        expect(calibrateRuleConfidence(-5, undefined).calibrated).toBe(0);
        expect(calibrateRuleConfidence(Number.NaN, undefined).calibrated).toBe(0);
        expect(clampUnit(Number.POSITIVE_INFINITY)).toBe(1);
        expect(clampUnit(Number.NEGATIVE_INFINITY)).toBe(0);
        expect(clampUnit(Number.NaN)).toBe(0);
    });

    it('treats negative observation counts as zero rather than corrupting the posterior', () => {
        const record = calibrateRuleConfidence(0.5, {
            rule: 'demo',
            truePositives: -10,
            falsePositives: -3,
        });

        expect(record.sampleSize).toBe(0);
        expect(record.alpha).toBe(JEFFREYS_PRIOR);
        expect(record.beta).toBe(JEFFREYS_PRIOR);
    });

    it('indexes statistics by rule id and ignores entries without one', () => {
        const index = indexRuleStats([
            { rule: 'magic-number', truePositives: 4, falsePositives: 1 },
            { rule: '', truePositives: 9, falsePositives: 9 },
        ]);

        expect(index.size).toBe(1);
        expect(index.get('magic-number')?.truePositives).toBe(4);
    });
});

describe('Confidence Calibration — Reliability Metrics', () => {
    const wellCalibrated = [
        { confidence: 1, outcome: 1 },
        { confidence: 0.9, outcome: 1 },
        { confidence: 0.9, outcome: 1 },
        { confidence: 0.9, outcome: 0 },
        { confidence: 0.1, outcome: 0 },
        { confidence: 0.1, outcome: 0 },
    ];

    it('reports zero error for an empty set instead of NaN', () => {
        expect(computeExpectedCalibrationError([])).toBe(0);
        expect(computeBrierScore([])).toBe(0);
        expect(computeMeanConfidence([])).toBe(0);
        expect(computeObservedAccuracy([])).toBe(0);
        expect(evaluateCalibrationHealth([]).sampleSize).toBe(0);
    });

    it('penalizes an over-confident adjudicator more than an honest one', () => {
        const overconfident = wellCalibrated.map((point) => ({ ...point, confidence: 0.99 }));

        expect(computeExpectedCalibrationError(overconfident)).toBeGreaterThan(
            computeExpectedCalibrationError(wellCalibrated),
        );
        expect(computeBrierScore(overconfident)).toBeGreaterThan(computeBrierScore(wellCalibrated));
    });

    it('reports positive optimism when confidence exceeds observed accuracy', () => {
        const overconfident = wellCalibrated.map((point) => ({ ...point, confidence: 0.95 }));
        const health = evaluateCalibrationHealth(overconfident);

        expect(health.optimism).toBeGreaterThan(0);
        expect(health.meanConfidence).toBeGreaterThan(health.observedAccuracy);
    });
});

describe('FindingConfidenceArbiter — Calibration Supersession', () => {
    it('scores an uncalibrated actionable finding below the ceiling it used to assume', () => {
        const finding = new FindingConfidenceArbiter().arbitrateFinding(createActionableIssue());

        expect(finding.confidence).toBeLessThan(CONFIDENCE_ACTIONABLE_DEFAULT);
        expect(finding.confidence).toBeGreaterThanOrEqual(CONFIDENCE_ACTIONABLE_FLOOR);
        expect(finding.confidenceSource).toBe(SOURCE_UNCALIBRATED);
        expect(finding.calibrationSampleSize).toBe(0);
        expect(finding.rationale).toContain('uncalibrated');
    });

    it('ranks a well-observed rule above an unobserved one and records the provenance', () => {
        const uncalibrated = new FindingConfidenceArbiter().arbitrateFinding(
            createActionableIssue(),
        );
        const calibrated = new FindingConfidenceArbiter({
            ruleCalibrationStats: [{ rule: 'magic-number', truePositives: 300, falsePositives: 1 }],
        }).arbitrateFinding(createActionableIssue());

        expect(calibrated.confidence).toBeGreaterThan(uncalibrated.confidence);
        expect(calibrated.confidenceSource).toBe(SOURCE_CALIBRATED);
        expect(calibrated.calibrationSampleSize).toBe(301);
    });

    it('does not promote a mostly-rejected rule above the uncalibrated floor', () => {
        const uncalibrated = new FindingConfidenceArbiter().arbitrateFinding(
            createActionableIssue(),
        );
        const rejected = new FindingConfidenceArbiter({
            ruleCalibrationStats: [{ rule: 'magic-number', truePositives: 1, falsePositives: 40 }],
        }).arbitrateFinding(createActionableIssue());

        expect(rejected.confidence).toBeLessThanOrEqual(uncalibrated.confidence);
    });

    it('keeps prescriptive findings at proof confidence regardless of calibration data', () => {
        const finding = new FindingConfidenceArbiter({
            ruleCalibrationStats: [
                { rule: 'high-complexity', truePositives: 1, falsePositives: 99 },
            ],
        }).arbitrateFinding(
            createActionableIssue({
                rule: 'high-complexity',
                severity: 'error',
                detail: { cyclomaticComplexity: 30 },
                actionable: undefined,
            }),
        );

        expect(finding.tier).toBe('prescriptive');
        expect(finding.mustBlock).toBe(true);
        expect(finding.confidence).toBe(1);
        expect(finding.confidenceSource).toBe('verified');
    });
});

describe('FindingConfidenceArbiter — Severity Floor', () => {
    it('refuses to drop an error claim just because the finding carries no patch', () => {
        const finding = new FindingConfidenceArbiter().arbitrateFinding(
            createActionableIssue({
                rule: 'VOL-ELOC-001',
                severity: 'error',
                actionable: undefined,
            }),
        );

        expect(finding.tier).toBe('prescriptive');
        expect(finding.mustBlock).toBe(true);
        expect(finding.confidence).toBe(1);
    });

    it('leaves warning-severity advisories non-blocking', () => {
        const finding = new FindingConfidenceArbiter().arbitrateFinding(
            createActionableIssue({
                rule: 'VOL-DOC-001',
                severity: 'warning',
                actionable: undefined,
            }),
        );

        expect(finding.tier).toBe('advisory');
        expect(finding.mustBlock).toBe(false);
    });

    it('lets an explicit lifecycle state revoke blocking authority, but nothing else', () => {
        const quarantined = new FindingConfidenceArbiter({
            ruleLifecycleMap: { 'VOL-ELOC-001': 'quarantined' },
        }).arbitrateFinding(
            createActionableIssue({
                rule: 'VOL-ELOC-001',
                severity: 'error',
                actionable: undefined,
            }),
        );

        expect(quarantined.mustBlock).toBe(false);
        expect(quarantined.isQuarantined).toBe(true);
    });
});
