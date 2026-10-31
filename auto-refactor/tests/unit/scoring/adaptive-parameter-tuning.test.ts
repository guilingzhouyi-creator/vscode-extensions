/**
 * Module: Unit Test Suite — Adaptive Parameter Tuning & Online Calibration
 * File Path: tests/unit/scoring/adaptive-parameter-tuning.test.ts
 * Architecture Role: Verifies confidence-gated Empirical-Bayes parameter tuning, numerical
 *   corridor safety bounds, and online rule calibration harvesting from review outcomes.
 */

import { describe, it, expect } from 'vitest';
import {
    tuneParametersEmpiricalBayes,
    DEFAULT_TUNABLE_PRIORS,
    TUNABLE_BOUNDS,
    type RollingMeanDifferenceState,
} from '../../../src/core/scoring/rolling-sampling-governor';
import { harvestOnlineCalibrationCounts } from '../../../src/core/scoring/calibration-corpus';
import { resolveIssueConfidence } from '../../../src/core/pipeline/confidence-rework';
import type { Issue } from '../../../src/core/types';
import { SEVERITY_WARNING } from '../../../src/core/types';

describe('Adaptive Parameter Tuning & Online Calibration', () => {
    describe('tuneParametersEmpiricalBayes', () => {
        it('shrinks completely to baseline priors under low confidence or small sample count', () => {
            const coldStartState: RollingMeanDifferenceState = {
                fastMoments: { mean: 90, variance: 10, standardDeviation: 3.16, count: 1 },
                mesoMoments: { mean: 90, variance: 10, standardDeviation: 3.16, count: 1 },
                macroMoments: { mean: 90, variance: 10, standardDeviation: 3.16, count: 1 },
                deltaMean12: -15.0,
                standardError12: 5.0,
                studentizedZ12: -3.0,
                deltaMean23: 0,
                standardError23: 0,
                studentizedZ23: 0,
                isRegimeShift: false,
                stabilityFactor: 0.5,
                statisticalConfidence: 0.2, // Low confidence
                sampleCount: 1, // Cold start
            };

            const tuned = tuneParametersEmpiricalBayes(coldStartState);
            expect(tuned.saturationHalfpoint).toBe(DEFAULT_TUNABLE_PRIORS.saturationHalfpoint);
            expect(tuned.macroFileKneeScale).toBe(DEFAULT_TUNABLE_PRIORS.macroFileKneeScale);
            expect(tuned.scoringScaleFactor).toBe(DEFAULT_TUNABLE_PRIORS.scoringScaleFactor);
            expect(tuned.staticPlaneWeight).toBe(DEFAULT_TUNABLE_PRIORS.staticPlaneWeight);
            expect(tuned.dynamicPlaneWeight).toBe(DEFAULT_TUNABLE_PRIORS.dynamicPlaneWeight);
            expect(tuned.historicalPlaneWeight).toBe(DEFAULT_TUNABLE_PRIORS.historicalPlaneWeight);
        });

        it('adaptively updates parameters within corridor bounds when confidence and sample count are high', () => {
            const highConfidenceState: RollingMeanDifferenceState = {
                fastMoments: { mean: 75, variance: 25, standardDeviation: 5.0, count: 5 },
                mesoMoments: { mean: 88, variance: 16, standardDeviation: 4.0, count: 20 },
                macroMoments: { mean: 89, variance: 16, standardDeviation: 4.0, count: 50 },
                deltaMean12: -13.0, // Significant drop
                standardError12: 2.3,
                studentizedZ12: -5.65,
                deltaMean23: -1.0,
                standardError23: 1.2,
                studentizedZ23: -0.83,
                isRegimeShift: true,
                stabilityFactor: 0.85,
                statisticalConfidence: 0.95,
                sampleCount: 50,
            };

            const tuned = tuneParametersEmpiricalBayes(highConfidenceState);

            // Saturation halfpoint should gently expand to prevent floor collapse under dense code
            expect(tuned.saturationHalfpoint).toBeGreaterThan(DEFAULT_TUNABLE_PRIORS.saturationHalfpoint);
            expect(tuned.saturationHalfpoint).toBeLessThanOrEqual(TUNABLE_BOUNDS.saturationHalfpoint.max);

            // Safety corridor checks
            expect(tuned.macroFileKneeScale).toBeGreaterThanOrEqual(TUNABLE_BOUNDS.macroFileKneeScale.min);
            expect(tuned.macroFileKneeScale).toBeLessThanOrEqual(TUNABLE_BOUNDS.macroFileKneeScale.max);
            expect(tuned.scoringScaleFactor).toBeGreaterThanOrEqual(TUNABLE_BOUNDS.scoringScaleFactor.min);
            expect(tuned.scoringScaleFactor).toBeLessThanOrEqual(TUNABLE_BOUNDS.scoringScaleFactor.max);

            // Tri-plane weights sum to approximately 1.0
            const planeSum =
                tuned.staticPlaneWeight + tuned.dynamicPlaneWeight + tuned.historicalPlaneWeight;
            expect(planeSum).toBeCloseTo(1.0, 2);
        });
    });

    describe('harvestOnlineCalibrationCounts', () => {
        it('aggregates ReviewMemory fix outcomes and rework refutations into RuleCalibrationStats', () => {
            const fixMap = {
                'ARCH-001': { fixedCount: 5, regressionCount: 1 },
                'SEC-002': { fixedCount: 10, regressionCount: 0 },
            };
            const refuted = [
                { rule: 'ARCH-001' },
                { rule: 'CPX-003' },
            ];
            const existing = [
                { rule: 'SEC-002', truePositives: 2, falsePositives: 1 },
            ];

            const result = harvestOnlineCalibrationCounts(fixMap, refuted, existing);

            // Must be sorted by rule id
            expect(result.map((r) => r.rule)).toEqual(['ARCH-001', 'CPX-003', 'SEC-002']);

            // ARCH-001: 5 TP from fix, 1 FP from regressed, 1 FP from refuted => 5 TP, 2 FP
            const arch = result.find((r) => r.rule === 'ARCH-001')!;
            expect(arch.truePositives).toBe(5);
            expect(arch.falsePositives).toBe(2);

            // CPX-003: 0 TP, 1 FP from refuted => 0 TP, 1 FP
            const cpx = result.find((r) => r.rule === 'CPX-003')!;
            expect(cpx.truePositives).toBe(0);
            expect(cpx.falsePositives).toBe(1);

            // SEC-002: existing 2 TP, 1 FP + fixMap 10 TP, 0 FP => 12 TP, 1 FP
            const sec = result.find((r) => r.rule === 'SEC-002')!;
            expect(sec.truePositives).toBe(12);
            expect(sec.falsePositives).toBe(1);
        });
    });

    describe('resolveIssueConfidence with calibration map', () => {
        const dummyIssue: Issue = {
            id: 'test-1',
            analyzer: 'architecture',
            rule: 'ARCH-001',
            severity: SEVERITY_WARNING,
            message: 'test breach',
            location: { file: 'test.ts', start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
        };

        it('prioritizes calibrated rule confidence when present in map', () => {
            const calMap = new Map<string, number>([['ARCH-001', 0.92]]);
            const conf = resolveIssueConfidence(dummyIssue, calMap);
            expect(conf).toBe(0.92);
        });

        it('falls back to issue evidence confidence when not in calibration map', () => {
            const withEvidence: Issue = {
                ...dummyIssue,
                evidence: { confidence: 0.84 },
            };
            const calMap = new Map<string, number>();
            const conf = resolveIssueConfidence(withEvidence, calMap);
            expect(conf).toBe(0.84);
        });

        it('falls back to default neutral 0.5 when neither calibration nor evidence is provided', () => {
            const conf = resolveIssueConfidence(dummyIssue);
            expect(conf).toBe(0.5);
        });
    });
});
