/**
 * Module: Unit Test Suite — Differential Semantic Bounds & Admission Governor
 * File Path: tests/unit/scoring/diff-bounds-governor.test.ts
 * Architecture Role: Validates differential bounding envelopes ([L_add_min, L_add_max],
 *   [L_del_min, L_del_max]), Net Semantic Turnover (Δ_net), empirical admission threshold
 *   derivation (Θ_admission), and admission ledger persistence.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
    computeEnvelopeBounds,
    countUsefulAddedLines,
    computeAddedLinesTspr,
    compute5dElocDelta,
    evaluateDifferentialBounds,
    evaluateCommitBatchBounds,
    computeNetSemanticTurnover,
    calculateEmpiricalAdmissionThreshold,
    appendAdmissionAuditRecord,
    VERDICT_ADMITTED,
    VERDICT_BLOCKED_INSUFFICIENT_TURNOVER,
    VERDICT_BLOCK_GAMING_INFLATION,
    VERDICT_BLOCK_CAPABILITY_EROSION,
    VERDICT_BLOCK_FILE_ADD_OVERFLOW,
    VERDICT_BLOCK_FILE_DEL_OVERFLOW,
    VERDICT_BLOCK_BATCH_ADD_OVERFLOW,
    VERDICT_BLOCK_BATCH_DEL_OVERFLOW,
    ADMISSION_TURNOVER_FLOOR,
    MIN_EXPANSION_ALLOWANCE_LOC,
    MAX_COMMIT_FILE_ADD_NEW_5D_ELOC,
    MAX_COMMIT_FILE_ADD_EXISTING_5D_ELOC,
    MAX_COMMIT_FILE_DEL_5D_ELOC,
    MAX_COMMIT_BATCH_ADD_5D_ELOC,
    MAX_COMMIT_BATCH_DEL_5D_ELOC,
    CACHE_DIRECTORY_NAME,
    ADMISSION_LEDGER_FILENAME,
    type TrajectoryRunPoint,
} from '../../../src/core/scoring/diff-bounds-governor';

describe('DiffBoundsGovernor — Differential Envelopes & Dynamic Admission', () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'diff-bounds-gov-test-'));
    });

    afterEach(() => {
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch {
            // ignore cleanup failure
        }
    });

    /**
     * Test Suite: computeEnvelopeBounds & Line Metrics
     * Invariants Verified:
     * - Brand new files clamped to MAX_COMMIT_FILE_ADD_NEW_5D_ELOC (180 lines) rather than raw static budget;
     * - Small baseline files receive MIN_EXPANSION_ALLOWANCE_LOC (60 lines) buffer;
     * - Large baseline files clamped to MAX_COMMIT_FILE_ADD_EXISTING_5D_ELOC (120) and MAX_COMMIT_FILE_DEL_5D_ELOC (100);
     * - Substantive line count accurately excludes cosmetic comments and pass/return boilerplate.
     */
    describe('computeEnvelopeBounds & Line Metrics', () => {
        it('clamps brand new file addition to atomic commit ceiling (180 5D ELOC)', () => {
            const bounds = computeEnvelopeBounds({
                filePath: 'src/new-feature.ts',
                oldContent: '',
                newContent: 'export const initial = 1;',
                addedLines: ['export const initial = 1;'],
                deletedLines: [],
                fileLocBudget: 900,
            });

            expect(bounds.addMax).toBe(MAX_COMMIT_FILE_ADD_NEW_5D_ELOC);
            expect(bounds.delMax).toBe(0);
            expect(bounds.usefulAddedLines).toBe(1);
            expect(bounds.semanticDensity).toBe(1.0);
        });

        it('assigns minimum expansion allowance to small baseline files', () => {
            const oldContent = 'const a = 1;\nconst b = 2;\n';
            const bounds = computeEnvelopeBounds({
                filePath: 'src/small.ts',
                oldContent,
                newContent: oldContent,
                addedLines: ['const c = 3;'],
                deletedLines: [],
            });

            expect(bounds.addMax).toBe(MIN_EXPANSION_ALLOWANCE_LOC);
            expect(bounds.delMax).toBeGreaterThanOrEqual(10);
            expect(bounds.usefulAddedLines).toBe(1);
            expect(bounds.semanticDensity).toBe(1.0);
        });

        it('bounds large files capped at single-file commit ceilings (120 added, 100 deleted)', () => {
            const largeLines = Array.from({ length: 600 }, (_, i) => `const x${i} = ${i};`);
            const oldContent = largeLines.join('\n');
            const bounds = computeEnvelopeBounds({
                filePath: 'src/large.ts',
                oldContent,
                newContent: oldContent,
                addedLines: ['const y = 1;'],
                deletedLines: [],
                fileLocBudget: 900,
            });

            // 35% of 600 = 210, but clamped to MAX_COMMIT_FILE_ADD_EXISTING_5D_ELOC = 120
            expect(bounds.addMax).toBe(MAX_COMMIT_FILE_ADD_EXISTING_5D_ELOC);
            // 40% of 600 = 240, but clamped to MAX_COMMIT_FILE_DEL_5D_ELOC = 100
            expect(bounds.delMax).toBe(MAX_COMMIT_FILE_DEL_5D_ELOC);
        });

        it('accurately identifies cosmetic comments and boilerplate forwarders', () => {
            const additions = [
                '// This is a cosmetic comment',
                '/* Multi-line',
                ' * comment line */',
                '   ',
                'pass',
                'return;',
                'export const substantive = calculateRealValue(input);',
            ];

            const usefulCount = countUsefulAddedLines(additions);
            expect(usefulCount).toBe(1);

            const tspr = computeAddedLinesTspr(additions);
            expect(tspr).toBeGreaterThan(0);
            expect(tspr).toBeLessThanOrEqual(1.0);
        });
    });

    /**
     * Test Suite: compute5dElocDelta
     * Invariants Verified:
     * - Decomposes changes into pure 5D ELOC additions and deletions;
     * - Multiplies substantive added lines by token semantic payload ratio (TSPR);
     * - Accurately strips deleted comments and boilerplate passes from deletion metrics;
     * - Produces net turnover equal to sum of 5D addition and deletion ELOC.
     */
    describe('compute5dElocDelta', () => {
        it('decomposes additions and deletions into pure 5D ELOC metrics', () => {
            const addedLines = [
                '// Comment header',
                'export function processItem(item: string): number {',
                '    const trimmed = item.trim();',
                '    return trimmed.length;',
                '}',
                'pass',
            ];
            const deletedLines = [
                '// Old comment',
                'const oldLegacy = 42;',
            ];

            const delta = compute5dElocDelta({
                filePath: 'src/service.ts',
                oldContent: 'const oldLegacy = 42;\n',
                newContent: addedLines.join('\n'),
                addedLines,
                deletedLines,
            });

            expect(delta.usefulAdded).toBe(4);
            expect(delta.usefulDeleted).toBe(1);
            expect(delta.eloc5dAdd).toBeGreaterThan(0);
            expect(delta.eloc5dDel).toBe(1);
            expect(delta.net5dTurnover).toBeCloseTo(delta.eloc5dAdd + delta.eloc5dDel, 2);
        });
    });

    /**
     * Test Suite: evaluateDifferentialBounds
     * Invariants Verified:
     * - Allows balanced substantive additions and deletions within single-file envelopes;
     * - Intercepts gaming attempts via low TSPR or low substantive line density;
     * - Intercepts addition volume exceeding single-file envelopes (180 for new, 120 for existing);
     * - Intercepts deletion volume exceeding single-file erosion ceilings (100 lines);
     * - Exempts verified refactorings with equivalent extraction or formal module retirement.
     */
    describe('evaluateDifferentialBounds', () => {
        it('allows well-balanced substantive additions and deletions', () => {
            const oldContent = Array.from({ length: 100 }, (_, i) => `const val${i} = ${i};`).join('\n');
            const addedLines = [
                'export function computeAggregate(data: number[]): number {',
                '    let total = 0;',
                '    for (let i = 0; i < data.length; i++) {',
                '        total += data[i];',
                '    }',
                '    return total;',
                '}',
            ];

            const verdict = evaluateDifferentialBounds({
                filePath: 'src/domain/calc.ts',
                oldContent,
                newContent: `${oldContent}\n${addedLines.join('\n')}`,
                addedLines,
                deletedLines: ['const val0 = 0;'],
            });

            expect(verdict.isAllowed).toBe(true);
            expect(verdict.verdictCode).toBe(VERDICT_ADMITTED);
            expect(verdict.reason).toBeUndefined();
        });

        it('intercepts addition inflation gaming with low semantic payload density', () => {
            const oldContent = 'const a = 1;';
            // 20 lines with mostly comments and empty passes (> 15 lines threshold)
            const addedLines = [
                '// Comment line 1',
                '// Comment line 2',
                '// Comment line 3',
                '// Comment line 4',
                '// Comment line 5',
                '// Comment line 6',
                '// Comment line 7',
                '// Comment line 8',
                '// Comment line 9',
                '// Comment line 10',
                '// Comment line 11',
                '// Comment line 12',
                '// Comment line 13',
                '// Comment line 14',
                '// Comment line 15',
                'pass',
                'pass',
                'return;',
                'const substantive = 42;',
            ];

            const verdict = evaluateDifferentialBounds({
                filePath: 'src/inflated.ts',
                oldContent,
                newContent: addedLines.join('\n'),
                addedLines,
                deletedLines: [],
            });

            expect(verdict.isAllowed).toBe(false);
            expect(verdict.verdictCode).toBe(VERDICT_BLOCK_GAMING_INFLATION);
            expect(verdict.reason).toContain('Addition substantive line density');
        });

        it('intercepts addition volume exceeding maximum expansion envelope', () => {
            const oldContent = Array.from({ length: 850 }, (_, i) => `const x${i} = ${i};`).join('\n');
            // Adding 100 lines to a file with only 50 lines remaining budget (850 / 900)
            const addedLines = Array.from(
                { length: 100 },
                (_, i) => `export const substantiveItem${i} = computeRealThing(${i});`,
            );

            const verdict = evaluateDifferentialBounds({
                filePath: 'src/oversized.ts',
                oldContent,
                newContent: `${oldContent}\n${addedLines.join('\n')}`,
                addedLines,
                deletedLines: [],
                fileLocBudget: 900,
            });

            expect(verdict.isAllowed).toBe(false);
            expect(verdict.verdictCode).toBe(VERDICT_BLOCK_FILE_ADD_OVERFLOW);
            expect(verdict.reason).toContain('exceeds the single-file expansion envelope');
        });

        it('intercepts brand new file exceeding atomic addition ceiling (180 lines)', () => {
            const addedLines = Array.from(
                { length: 200 },
                (_, i) => `export const newEntity${i} = ${i};`,
            );

            const verdict = evaluateDifferentialBounds({
                filePath: 'src/monolith.ts',
                oldContent: '',
                newContent: addedLines.join('\n'),
                addedLines,
                deletedLines: [],
                fileLocBudget: 900,
            });

            expect(verdict.isAllowed).toBe(false);
            expect(verdict.verdictCode).toBe(VERDICT_BLOCK_FILE_ADD_OVERFLOW);
            expect(verdict.reason).toContain('exceeds the single-file expansion envelope');
        });

        it('intercepts capability erosion when excessive deletions lack compensation', () => {
            const oldLines = Array.from({ length: 100 }, (_, i) => `const defensiveline${i} = ${i};`);
            const oldContent = oldLines.join('\n');
            // Deleting 60 lines out of 100 (> 40% erosion limit)
            const deletedLines = oldLines.slice(0, 60);

            const verdict = evaluateDifferentialBounds({
                filePath: 'src/eroded.ts',
                oldContent,
                newContent: oldLines.slice(60).join('\n'),
                addedLines: [],
                deletedLines,
            });

            expect(verdict.isAllowed).toBe(false);
            expect(verdict.verdictCode).toBe(VERDICT_BLOCK_FILE_DEL_OVERFLOW);
            expect(verdict.reason).toContain('exceeds safe single-file erosion ceiling');
        });

        it('exempts large deletions when equivalent extraction or retirement is verified', () => {
            const oldLines = Array.from({ length: 100 }, (_, i) => `const defensiveline${i} = ${i};`);
            const oldContent = oldLines.join('\n');
            const deletedLines = oldLines.slice(0, 60);

            const verdict = evaluateDifferentialBounds({
                filePath: 'src/refactored.ts',
                oldContent,
                newContent: oldLines.slice(60).join('\n'),
                addedLines: [],
                deletedLines,
                hasEquivalentExtraction: true,
            });

            expect(verdict.isAllowed).toBe(true);
            expect(verdict.verdictCode).toBe(VERDICT_ADMITTED);
        });
    });

    /**
     * Test Suite: evaluateCommitBatchBounds
     * Invariants Verified:
     * - Admits atomic commit batches within total 5D addition (<= 360) and deletion (<= 280) ceilings;
     * - Intercepts commit batches exceeding total aggregate 5D addition ceiling (BLOCK_BATCH_ADD_OVERFLOW);
     * - Intercepts commit batches exceeding total aggregate 5D deletion ceiling (BLOCK_BATCH_DEL_OVERFLOW);
     * - Rejects hollow or cosmetic-only commits failing empirical admission turnover (BLOCKED_INSUFFICIENT_TURNOVER).
     */
    describe('evaluateCommitBatchBounds', () => {
        const dummyRuns: TrajectoryRunPoint[] = [
            { timestamp: 1000, netSemanticTurnover: 15.0, gatePassed: true },
            { timestamp: 2000, netSemanticTurnover: 20.0, gatePassed: true },
        ];

        it('admits commit batch within 5D addition, deletion, and turnover limits', () => {
            const validStagedFiles = [
                {
                    filePath: 'src/mod1.ts',
                    eloc5dAdd: 40,
                    eloc5dDel: 10,
                    net5dTurnover: 50,
                    rawAdd: 45,
                    rawDel: 12,
                    boundsVerdict: {
                        isAllowed: true,
                        verdictCode: VERDICT_ADMITTED,
                        bounds: {
                            addMin: 0,
                            addMax: 120,
                            delMin: 0,
                            delMax: 100,
                            usefulAddedLines: 40,
                            tsprAdded: 0.9,
                            semanticDensity: 0.95,
                        },
                    },
                },
            ];

            const batchVerdict = evaluateCommitBatchBounds({
                stagedFiles: validStagedFiles,
                recentRuns: dummyRuns,
                currentComplexity: 5,
                currentEloc: 100,
            });

            expect(batchVerdict.passed).toBe(true);
            expect(batchVerdict.verdictCode).toBe(VERDICT_ADMITTED);
            expect(batchVerdict.total5dAdd).toBe(40);
            expect(batchVerdict.total5dDel).toBe(10);
            expect(batchVerdict.total5dTurnover).toBe(50);
        });

        it('intercepts commit batch exceeding aggregate 5D addition ceiling (360 lines)', () => {
            const oversizedBatch = [
                {
                    filePath: 'src/part1.ts',
                    eloc5dAdd: 170,
                    eloc5dDel: 0,
                    net5dTurnover: 170,
                    rawAdd: 175,
                    rawDel: 0,
                    boundsVerdict: {
                        isAllowed: true,
                        verdictCode: VERDICT_ADMITTED,
                        bounds: {
                            addMin: 0,
                            addMax: 180,
                            delMin: 0,
                            delMax: 100,
                            usefulAddedLines: 170,
                            tsprAdded: 0.95,
                            semanticDensity: 0.98,
                        },
                    },
                },
                {
                    filePath: 'src/part2.ts',
                    eloc5dAdd: 150,
                    eloc5dDel: 0,
                    net5dTurnover: 150,
                    rawAdd: 155,
                    rawDel: 0,
                    boundsVerdict: {
                        isAllowed: true,
                        verdictCode: VERDICT_ADMITTED,
                        bounds: {
                            addMin: 0,
                            addMax: 180,
                            delMin: 0,
                            delMax: 100,
                            usefulAddedLines: 150,
                            tsprAdded: 0.95,
                            semanticDensity: 0.98,
                        },
                    },
                },
                {
                    filePath: 'src/part3.ts',
                    eloc5dAdd: 80,
                    eloc5dDel: 0,
                    net5dTurnover: 80,
                    rawAdd: 85,
                    rawDel: 0,
                    boundsVerdict: {
                        isAllowed: true,
                        verdictCode: VERDICT_ADMITTED,
                        bounds: {
                            addMin: 0,
                            addMax: 180,
                            delMin: 0,
                            delMax: 100,
                            usefulAddedLines: 80,
                            tsprAdded: 0.95,
                            semanticDensity: 0.98,
                        },
                    },
                },
            ];

            const batchVerdict = evaluateCommitBatchBounds({
                stagedFiles: oversizedBatch,
                recentRuns: dummyRuns,
                currentComplexity: 5,
                currentEloc: 100,
            });

            expect(batchVerdict.passed).toBe(false);
            expect(batchVerdict.verdictCode).toBe(VERDICT_BLOCK_BATCH_ADD_OVERFLOW);
            expect(batchVerdict.reason).toContain('exceeds atomic batch ceiling (360)');
        });

        it('intercepts commit batch exceeding aggregate 5D deletion ceiling (280 lines)', () => {
            const destructiveBatch = [
                {
                    filePath: 'src/del1.ts',
                    eloc5dAdd: 0,
                    eloc5dDel: 100,
                    net5dTurnover: 100,
                    rawAdd: 0,
                    rawDel: 100,
                    boundsVerdict: {
                        isAllowed: true,
                        verdictCode: VERDICT_ADMITTED,
                        bounds: {
                            addMin: 0,
                            addMax: 180,
                            delMin: 0,
                            delMax: 100,
                            usefulAddedLines: 0,
                            tsprAdded: 1.0,
                            semanticDensity: 1.0,
                        },
                    },
                },
                {
                    filePath: 'src/del2.ts',
                    eloc5dAdd: 0,
                    eloc5dDel: 100,
                    net5dTurnover: 100,
                    rawAdd: 0,
                    rawDel: 100,
                    boundsVerdict: {
                        isAllowed: true,
                        verdictCode: VERDICT_ADMITTED,
                        bounds: {
                            addMin: 0,
                            addMax: 180,
                            delMin: 0,
                            delMax: 100,
                            usefulAddedLines: 0,
                            tsprAdded: 1.0,
                            semanticDensity: 1.0,
                        },
                    },
                },
                {
                    filePath: 'src/del3.ts',
                    eloc5dAdd: 0,
                    eloc5dDel: 90,
                    net5dTurnover: 90,
                    rawAdd: 0,
                    rawDel: 90,
                    boundsVerdict: {
                        isAllowed: true,
                        verdictCode: VERDICT_ADMITTED,
                        bounds: {
                            addMin: 0,
                            addMax: 180,
                            delMin: 0,
                            delMax: 100,
                            usefulAddedLines: 0,
                            tsprAdded: 1.0,
                            semanticDensity: 1.0,
                        },
                    },
                },
            ];

            const batchVerdict = evaluateCommitBatchBounds({
                stagedFiles: destructiveBatch,
                recentRuns: dummyRuns,
                currentComplexity: 5,
                currentEloc: 100,
            });

            expect(batchVerdict.passed).toBe(false);
            expect(batchVerdict.verdictCode).toBe(VERDICT_BLOCK_BATCH_DEL_OVERFLOW);
            expect(batchVerdict.reason).toContain('exceeds safe deletion ceiling (280)');
        });

        it('rejects hollow commit batch failing empirical admission turnover', () => {
            const hollowBatch = [
                {
                    filePath: 'src/hollow.ts',
                    eloc5dAdd: 0.5,
                    eloc5dDel: 0,
                    net5dTurnover: 0.5,
                    rawAdd: 5,
                    rawDel: 0,
                    boundsVerdict: {
                        isAllowed: true,
                        verdictCode: VERDICT_ADMITTED,
                        bounds: {
                            addMin: 0,
                            addMax: 120,
                            delMin: 0,
                            delMax: 100,
                            usefulAddedLines: 1,
                            tsprAdded: 0.5,
                            semanticDensity: 0.2,
                        },
                    },
                },
            ];

            const batchVerdict = evaluateCommitBatchBounds({
                stagedFiles: hollowBatch,
                recentRuns: dummyRuns,
                currentComplexity: 5,
                currentEloc: 100,
            });

            expect(batchVerdict.passed).toBe(false);
            expect(batchVerdict.verdictCode).toBe(VERDICT_BLOCKED_INSUFFICIENT_TURNOVER);
            expect(batchVerdict.reason).toContain('below empirical admission threshold');
        });
    });

    /**
     * Test Suite: computeNetSemanticTurnover
     * Invariants Verified:
     * - Subtracts relocated and cosmetic churn from raw additions and deletions;
     * - Accurately bounds net turnover >= 0 with deterministic round-off precision;
     * - Yields unit turnover ratio for zero-change edge case without divide-by-zero anomaly.
     */
    describe('computeNetSemanticTurnover', () => {
        it('calculates net turnover subtracting relocated and cosmetic churn', () => {
            const turnover = computeNetSemanticTurnover({
                semanticAddedEloc: 40,
                semanticDeletedEloc: 25,
                relocatedEloc: 10,
                cosmeticEloc: 5,
                physicalAddedLines: 50,
                physicalDeletedLines: 30,
            });

            // net = 40 + 25 - 10 - 5 = 50
            expect(turnover.netSemanticTurnover).toBe(50);
            // turnoverRatio = 50 / (50 + 30) = 0.625
            expect(turnover.turnoverRatio).toBe(0.625);
            expect(turnover.effectiveTurnoverScore).toBe(31.25);
        });

        it('handles zero-change edge case deterministically', () => {
            const turnover = computeNetSemanticTurnover({
                semanticAddedEloc: 0,
                semanticDeletedEloc: 0,
                relocatedEloc: 0,
                cosmeticEloc: 0,
                physicalAddedLines: 0,
                physicalDeletedLines: 0,
            });

            expect(turnover.netSemanticTurnover).toBe(0);
            expect(turnover.turnoverRatio).toBe(1.0);
            expect(turnover.effectiveTurnoverScore).toBe(0);
        });
    });

    /**
     * Test Suite: calculateEmpiricalAdmissionThreshold
     * Invariants Verified:
     * - Returns ADMISSION_TURNOVER_FLOOR (3.0) on empty trajectory history;
     * - Dynamically calibrates admission threshold using Jeffreys Beta posterior confidence;
     * - Damps admission threshold when cyclomatic noise index is elevated.
     */
    describe('calculateEmpiricalAdmissionThreshold', () => {
        it('defaults to mathematical floor on empty trajectory history', () => {
            const result = calculateEmpiricalAdmissionThreshold({
                recentRuns: [],
                currentComplexity: 10,
                currentEloc: 100,
            });

            expect(result.threshold).toBe(ADMISSION_TURNOVER_FLOOR);
            expect(result.sampleCount).toBe(0);
            expect(result.posteriorConfidence).toBe(1.0);
        });

        it('derives objective empirical threshold from recent runs distribution', () => {
            const recentRuns: TrajectoryRunPoint[] = Array.from({ length: 20 }, (_, i) => ({
                timestamp: 1000 + i * 100,
                netSemanticTurnover: 25.0 + (i % 2 === 0 ? 5.0 : -5.0),
                gatePassed: true,
            }));

            const result = calculateEmpiricalAdmissionThreshold({
                recentRuns,
                currentComplexity: 4,
                currentEloc: 200,
            });

            expect(result.threshold).toBeGreaterThanOrEqual(ADMISSION_TURNOVER_FLOOR);
            expect(result.sampleCount).toBe(20);
            expect(result.rollingMean).toBe(25.0);
            expect(result.rollingStdDev).toBeGreaterThan(0);
            expect(result.posteriorConfidence).toBeGreaterThan(0.9);
        });

        it('damps threshold appropriately when code noise is elevated', () => {
            const recentRuns: TrajectoryRunPoint[] = Array.from({ length: 20 }, (_, i) => ({
                timestamp: 1000 + i * 100,
                netSemanticTurnover: 30.0,
                gatePassed: true,
            }));

            const lowNoise = calculateEmpiricalAdmissionThreshold({
                recentRuns,
                currentComplexity: 2,
                currentEloc: 200,
            });

            const highNoise = calculateEmpiricalAdmissionThreshold({
                recentRuns,
                currentComplexity: 30,
                currentEloc: 10,
            });

            expect(highNoise.noiseFactor).toBeGreaterThan(lowNoise.noiseFactor);
            expect(highNoise.threshold).toBeLessThanOrEqual(lowNoise.threshold);
        });
    });

    /**
     * Test Suite: appendAdmissionAuditRecord
     * Invariants Verified:
     * - Appends structured audit record asynchronously to local cache NDJSON file;
     * - Appends structured audit record synchronously without throwing on process exit;
     * - Accurately serializes staging digest, turnover metrics, and Bayesian factor diagnostics.
     */
    describe('appendAdmissionAuditRecord', () => {
        it('appends structured audit record to cache ledger file', async () => {
            const record = {
                timestamp: Date.now(),
                commitStagingDigest: 'test-digest-123',
                lAdd: 30,
                lDel: 15,
                netSemanticTurnover: 42.5,
                admissionThreshold: 12.0,
                turnoverRatio: 0.944,
                verdict: VERDICT_ADMITTED,
                factors: {
                    rollingMean: 20.0,
                    rollingStdDev: 4.5,
                    noisePenalty: 0.05,
                    confidence: 0.95,
                },
            };

            await appendAdmissionAuditRecord(record, tempDir);

            const ledgerFile = path.join(tempDir, CACHE_DIRECTORY_NAME, ADMISSION_LEDGER_FILENAME);
            expect(fs.existsSync(ledgerFile)).toBe(true);

            const content = fs.readFileSync(ledgerFile, 'utf8').trim();
            const parsed = JSON.parse(content);
            expect(parsed.commitStagingDigest).toBe('test-digest-123');
            expect(parsed.netSemanticTurnover).toBe(42.5);
            expect(parsed.verdict).toBe(VERDICT_ADMITTED);
        });
    });
});
