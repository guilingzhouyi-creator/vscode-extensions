/**
 * Module: Unit Test Suite — Multi-Pass Objective Rolling Sampling Governor
 * File Path: tests/unit/scoring/rolling-sampling-governor.test.ts
 * Architecture Role: Validates 3-tier rolling windows, Welch studentized mean-difference metrics,
 *   CUSUM / regime shift identification, and stability-weighted statistical confidence.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
    RollingSamplingGovernor,
    WINDOW_FAST_SIZE,
    WINDOW_MESO_SIZE,
    WINDOW_MACRO_SIZE,
} from '../../../src/core/scoring/rolling-sampling-governor';
import { calculateConfidenceFromVolume } from '../../../src/core/scoring/scorer-formulas';

describe('RollingSamplingGovernor — Multi-Pass Mean-Difference & Confidence', () => {
    let tempDir: string;
    let stateFile: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rolling-gov-test-'));
        stateFile = path.join(tempDir, '.auto-refactor-cache', 'rolling-sampling-state.json');
    });

    afterEach(() => {
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch {
            // Ignore cleanup failure
        }
    });

    it('initializes empty and computes safe baseline state', () => {
        const gov = new RollingSamplingGovernor({ stateFilePath: stateFile });
        const state = gov.evaluateState();

        expect(state.sampleCount).toBe(0);
        expect(state.fastMoments.count).toBe(0);
        expect(state.mesoMoments.count).toBe(0);
        expect(state.macroMoments.count).toBe(0);
        expect(state.deltaMean12).toBe(0);
        expect(state.isRegimeShift).toBe(false);
        expect(state.statisticalConfidence).toBeGreaterThanOrEqual(0.1);
        expect(state.statisticalConfidence).toBeLessThanOrEqual(1.0);
    });

    it('maintains 3-tiered rolling windows and caps at macro size (W3 = 60)', () => {
        const gov = new RollingSamplingGovernor({ stateFilePath: stateFile });

        // Feed 70 samples with score 90.0
        for (let i = 1; i <= 70; i++) {
            gov.recordSample({
                timestamp: 1000 + i * 10,
                compositeScore: 90.0,
                effectiveLines: 5000,
                runId: `run-${i}`,
            });
        }

        const state = gov.evaluateState();
        expect(state.sampleCount).toBe(WINDOW_MACRO_SIZE);
        expect(state.fastMoments.count).toBe(WINDOW_FAST_SIZE);
        expect(state.mesoMoments.count).toBe(WINDOW_MESO_SIZE);
        expect(state.macroMoments.count).toBe(WINDOW_MACRO_SIZE);
        expect(state.fastMoments.mean).toBe(90.0);
        expect(state.mesoMoments.mean).toBe(90.0);
        expect(state.macroMoments.mean).toBe(90.0);
        expect(state.deltaMean12).toBe(0.0);
    });

    it('detects statistically significant regime shifts when mean shifts significantly', () => {
        const gov = new RollingSamplingGovernor({ stateFilePath: stateFile });

        // Establish stable meso baseline of 20 runs at 95.0 with low variance
        for (let i = 1; i <= 20; i++) {
            gov.recordSample({
                timestamp: 1000 + i * 10,
                compositeScore: 95.0 + (i % 2 === 0 ? 0.2 : -0.2),
                effectiveLines: 10000,
                runId: `baseline-${i}`,
            });
        }

        // Fast recent 5 runs experience dramatic quality drop down to 60.0
        for (let j = 1; j <= 5; j++) {
            gov.recordSample({
                timestamp: 2000 + j * 10,
                compositeScore: 60.0,
                effectiveLines: 10000,
                runId: `drop-${j}`,
            });
        }

        const state = gov.evaluateState();
        expect(state.deltaMean12).toBeLessThan(-20.0);
        expect(state.studentizedZ12).toBeLessThan(-5.0);
        expect(state.isRegimeShift).toBe(true);
    });

    it('suppresses false alarms on localized small-sample noise', () => {
        const gov = new RollingSamplingGovernor({ stateFilePath: stateFile });

        // Only 2 samples recorded
        gov.recordSample({ timestamp: 1000, compositeScore: 90.0, effectiveLines: 5000 });
        gov.recordSample({ timestamp: 1010, compositeScore: 60.0, effectiveLines: 5000 });

        const state = gov.evaluateState();
        // Under minimum sample count for fast/meso, isRegimeShift should be false
        expect(state.isRegimeShift).toBe(false);
    });

    it('persists and restores state across multiple governor instances', () => {
        const gov1 = new RollingSamplingGovernor({ stateFilePath: stateFile });
        gov1.recordSample({ timestamp: 1000, compositeScore: 92.5, effectiveLines: 6000, runId: 'r1' });
        gov1.recordSample({ timestamp: 2000, compositeScore: 94.0, effectiveLines: 6200, runId: 'r2' });

        expect(fs.existsSync(stateFile)).toBe(true);

        const gov2 = new RollingSamplingGovernor({ stateFilePath: stateFile });
        const samples = gov2.getSamples();
        expect(samples.length).toBe(2);
        expect(samples[0].compositeScore).toBe(92.5);
        expect(samples[1].compositeScore).toBe(94.0);
        expect(samples[1].runId).toBe('r2');
    });

    it('adjusts statistical confidence in calculateConfidenceFromVolume with stability factor', () => {
        const fullLines = 15000;
        const coverage = 1.0;

        // High stability (factor = 1.0) -> high confidence
        const confStable = calculateConfidenceFromVolume(fullLines, coverage, 'project', 1.0);
        expect(confStable).toBe(1.0);

        // Low stability due to high rolling variance (factor = 0.4) -> penalized confidence
        const confVolatile = calculateConfidenceFromVolume(fullLines, coverage, 'project', 0.4);
        expect(confVolatile).toBeLessThan(confStable);
        expect(confVolatile).toBeCloseTo(0.4, 1);
    });
});
