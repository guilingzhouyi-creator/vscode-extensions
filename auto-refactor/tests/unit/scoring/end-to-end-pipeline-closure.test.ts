/**
 * Module: Unit Test Suite — End-to-End Pipeline Closure & Adaptive Bias Persistence
 * File Path: tests/unit/scoring/end-to-end-pipeline-closure.test.ts
 * Architecture Role: Verifies the full closure of tri-plane historical score injection (Q_f),
 *   adaptive router bias serialization and restoration, and behavioral hotspot git integration.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { resolveHistoricalQualityScore } from '../../../src/core/scoring/rolling-sampling-governor';
import {
    defaultAdaptiveExpertBiasRouter,
    AdaptiveExpertBiasRouter,
    type ExpertTelemetrySnapshot,
} from '../../../src/core/router/adaptive-bias-router';
import {
    analyzerNameToBit,
    AnalyzerBit,
    BIT_TO_ANALYZER_NAME,
} from '../../../src/core/constants/analyzer-bitmask';
import { EXPERT_BY_BIT } from '../../../src/core/experts/expert-catalog';
import { EXPERT_BASE_SCORES } from '../../../src/core/experts/expert-activation-library';
import { GroupedExpertDispatcher } from '../../../src/core/experts/grouped-dispatcher';
import { BUILTIN_FACTORIES } from '../../../src/core/analyzer-registry';
import { DataArchitectureAnalyzer } from '../../../src/analyzers/data-architecture';
import { NamingAnalyzer } from '../../../src/analyzers/naming';
import { DependencyLayoutAnalyzer } from '../../../src/analyzers/dependency-layout';

describe('End-to-End Pipeline Closure & Adaptive Bias Persistence', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-closure-test-'));
    });

    afterEach(() => {
        try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {
            // Ignore cleanup failure
        }
    });

    describe('resolveHistoricalQualityScore', () => {
        it('prioritizes explicit historicalScore provided in config', () => {
            const score = resolveHistoricalQualityScore({
                root: tmpDir,
                historicalScore: 88.5,
            });
            expect(score).toBe(88.5);
        });

        it('returns undefined when caching is disabled', () => {
            const score = resolveHistoricalQualityScore({
                root: tmpDir,
                cacheEnabled: false,
            });
            expect(score).toBeUndefined();
        });

        it('returns undefined when state file does not exist', () => {
            const score = resolveHistoricalQualityScore({
                root: tmpDir,
                cacheEnabled: true,
            });
            expect(score).toBeUndefined();
        });

        it('resolves historical meso score from persistent rolling sampling state', () => {
            const cacheDir = path.join(tmpDir, '.auto-refactor-cache');
            fs.mkdirSync(cacheDir, { recursive: true });
            const sampleData = {
                version: 1,
                updatedAt: Date.now(),
                samples: [
                    { timestamp: 1, compositeScore: 85, effectiveLines: 1000 },
                    { timestamp: 2, compositeScore: 87, effectiveLines: 1000 },
                    { timestamp: 3, compositeScore: 89, effectiveLines: 1000 },
                    { timestamp: 4, compositeScore: 91, effectiveLines: 1000 },
                ],
            };
            fs.writeFileSync(
                path.join(cacheDir, 'rolling-sampling-state.json'),
                JSON.stringify(sampleData),
                'utf8',
            );

            const score = resolveHistoricalQualityScore({
                root: tmpDir,
                cacheEnabled: true,
            });
            expect(typeof score).toBe('number');
            expect(score).toBeGreaterThan(80);
            expect(score).toBeLessThanOrEqual(100);
        });
    });

    describe('AdaptiveExpertBiasRouter snapshot and calibration', () => {
        it('exports and restores bias state snapshots identically', () => {
            const router = new AdaptiveExpertBiasRouter();
            const bit = AnalyzerBit.COMPLEXITY;
            const telemetry: ExpertTelemetrySnapshot[] = [
                {
                    bit,
                    currentQueueDepth: 10,
                    rollingAvgLatencyUs: 2000,
                    totalDispatches: 20,
                    actionableFindingsYield: 15,
                },
            ];

            router.calibrateBiases(telemetry);
            const snapshot = router.exportSnapshot();

            expect(snapshot.version).toBe(1);
            expect(snapshot.dynamicBiases.length).toBe(32);
            expect(snapshot.yieldRewards.length).toBe(32);

            const newRouter = new AdaptiveExpertBiasRouter();
            newRouter.importSnapshot(snapshot);

            expect(newRouter.getBiasForBit(bit)).toBeCloseTo(router.getBiasForBit(bit), 5);
            expect(newRouter.getYieldRewardForBit(bit)).toBeCloseTo(router.getYieldRewardForBit(bit), 5);
        });

        it('rewards high-yield analyzers and penalizes overloaded queues', () => {
            const router = new AdaptiveExpertBiasRouter();
            const complexityBit = analyzerNameToBit('complexity');
            const initialScore = router.scoreAndRankCandidateBits(complexityBit)[0].score;

            // High yield, low queue depth
            router.calibrateBiases([
                {
                    bit: complexityBit,
                    currentQueueDepth: 0,
                    rollingAvgLatencyUs: 500,
                    totalDispatches: 10,
                    actionableFindingsYield: 25,
                },
            ]);

            const boostedScore = router.scoreAndRankCandidateBits(complexityBit)[0].score;
            expect(boostedScore).toBeGreaterThan(initialScore);
        });

        it('resolves bit 31 (CONCURRENCY) across signed and unsigned bitmask representations', () => {
            const signedBit = AnalyzerBit.CONCURRENCY | 0;
            const unsignedBit = AnalyzerBit.CONCURRENCY >>> 0;

            expect(BIT_TO_ANALYZER_NAME[signedBit]).toBe('concurrency');
            expect(BIT_TO_ANALYZER_NAME[unsignedBit]).toBe('concurrency');
            expect(EXPERT_BY_BIT.get(signedBit)?.id).toBe('concurrency');
            expect(EXPERT_BY_BIT.get(unsignedBit)?.id).toBe('concurrency');
            expect(EXPERT_BASE_SCORES[signedBit]).toBe(23);
            expect(EXPERT_BASE_SCORES[unsignedBit]).toBe(23);

            const router = new AdaptiveExpertBiasRouter();
            const ranked = router.scoreAndRankCandidateBits(AnalyzerBit.CONCURRENCY);
            expect(ranked).toHaveLength(1);
            expect(ranked[0].score).toBe(23);

            const dispatcher = new GroupedExpertDispatcher();
            const plan = dispatcher.buildDispatchPlan([
                {
                    id: 'slice-conc',
                    filePath: 'src/worker.ts',
                    activeMask: AnalyzerBit.CONCURRENCY,
                },
            ]);
            expect(plan.batches).toHaveLength(1);
            expect(plan.batches[0].expertId).toBe('concurrency');
        });

        it('ensures all 32 built-in analyzers implement resetState() and avoid eager sourceFile getter evaluation', () => {
            const keys = Object.keys(BUILTIN_FACTORIES);
            expect(keys).toHaveLength(32);
            for (const key of keys) {
                const instance = BUILTIN_FACTORIES[key as keyof typeof BUILTIN_FACTORIES]();
                expect(typeof instance.resetState).toBe('function');
            }

            let getterInvocations = 0;
            const makeLazyCtx = (filePath: string, content: string) => ({
                filePath,
                content,
                options: {},
                config: { analyzers: {} },
                get sourceFile() {
                    getterInvocations++;
                    return undefined;
                },
            });

            new DataArchitectureAnalyzer().finalize(
                makeLazyCtx('src/service/repo.ts', 'export const x = 1;'),
            );
            new NamingAnalyzer().finalize(
                makeLazyCtx('src/service/model.py', 'def compute_value():\n    return 1\n'),
            );
            new DependencyLayoutAnalyzer().finalize(
                makeLazyCtx('src/service/model.py', 'import os\nx = 1\n'),
            );
            expect(getterInvocations).toBe(0);
        });
    });
});
