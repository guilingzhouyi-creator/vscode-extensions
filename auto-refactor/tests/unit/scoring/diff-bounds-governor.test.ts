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
    evaluateDifferentialBounds,
    computeNetSemanticTurnover,
    calculateEmpiricalAdmissionThreshold,
    appendAdmissionAuditRecord,
    VERDICT_ADMITTED,
    VERDICT_BLOCK_GAMING_INFLATION,
    VERDICT_BLOCK_CAPABILITY_EROSION,
    ADMISSION_TURNOVER_FLOOR,
    MIN_EXPANSION_ALLOWANCE_LOC,
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

    describe('computeEnvelopeBounds & Line Metrics', () => {
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

        it('bounds large files by 35% expansion ratio and remaining LOC budget', () => {
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

            // 35% of 600 = 210, remaining budget = 900 - 600 = 300, min is 210
            expect(bounds.addMax).toBe(210);
            // 40% of 600 = 240
            expect(bounds.delMax).toBe(240);
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
            expect(verdict.reason).toContain('Addition semantic line density');
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
            expect(verdict.verdictCode).toBe(VERDICT_BLOCK_GAMING_INFLATION);
            expect(verdict.reason).toContain('exceeds maximum single-module expansion envelope');
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
            expect(verdict.verdictCode).toBe(VERDICT_BLOCK_CAPABILITY_EROSION);
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
