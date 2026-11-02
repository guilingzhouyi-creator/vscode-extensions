/**
 * Module: Unit Tests — Continuous Rule Sampling Sidecar
 * File Path: tests/unit/core/continuous-rule-sampler.test.ts
 * Architecture Role: Test suite verifying empirical Beta prior sampling, binary Shannon entropy,
 *   spatial co-occurrence topology, and fail-safe ledger persistence.
 * Test Type: Core Unit Test
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    ContinuousRuleSamplingSidecar,
    computeBinaryEntropy,
    computeJeffreysPosterior,
    computeFrequencyJaccardSimilarity,
    createSortedPairKey,
} from '../../../src/core/telemetry/continuous-rule-sampler';
import type { Issue } from '../../../src/core/types';

describe('ContinuousRuleSamplingSidecar', () => {
    let sampler: ContinuousRuleSamplingSidecar;
    let tempDir: string;

    beforeEach(() => {
        sampler = new ContinuousRuleSamplingSidecar();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-rule-sampler-test-'));
    });

    afterEach(() => {
        if (tempDir && fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    describe('Mathematical primitives', () => {
        it('computes binary entropy within [0, 1]', () => {
            expect(computeBinaryEntropy(0)).toBe(0);
            expect(computeBinaryEntropy(1)).toBe(0);
            expect(computeBinaryEntropy(-0.5)).toBe(0);
            expect(computeBinaryEntropy(1.5)).toBe(0);
            expect(computeBinaryEntropy(0.5)).toBeCloseTo(1.0, 4);
            expect(computeBinaryEntropy(0.1)).toBeGreaterThan(0);
            expect(computeBinaryEntropy(0.1)).toBeLessThan(1);
        });

        it('computes Jeffreys Beta(0.5, 0.5) posterior accurately', () => {
            const prior = computeJeffreysPosterior(0, 0);
            expect(prior.mean).toBe(0.5);
            expect(prior.entropy).toBe(1.0);
            expect(prior.lower95).toBeGreaterThanOrEqual(0);
            expect(prior.upper95).toBeLessThanOrEqual(1);

            const highHits = computeJeffreysPosterior(10, 10);
            expect(highHits.mean).toBeGreaterThan(0.9);
            expect(highHits.entropy).toBeLessThan(0.5);
        });

        it('creates canonical sorted pair keys', () => {
            const pair1 = createSortedPairKey('SIM-ARGS-001', 'GOV-DAT-001');
            const pair2 = createSortedPairKey('GOV-DAT-001', 'SIM-ARGS-001');
            expect(pair1.key).toBe('GOV-DAT-001::SIM-ARGS-001');
            expect(pair2.key).toBe('GOV-DAT-001::SIM-ARGS-001');
        });

        it('computes Jaccard similarity', () => {
            expect(computeFrequencyJaccardSimilarity(5, 5, 5)).toBe(1.0);
            expect(computeFrequencyJaccardSimilarity(0, 5, 5)).toBe(0);
            expect(computeFrequencyJaccardSimilarity(5, 10, 10)).toBeCloseTo(5 / 15, 4);
        });
    });

    describe('Scan ingestion and aggregation', () => {
        const createDummyIssue = (rule: string, file: string, suppressed = false): Issue => ({
            id: `iss-${Math.random()}`,
            rule,
            analyzer: 'simplify',
            severity: 'warning',
            message: `Issue for ${rule}`,
            location: { file, line: 10, column: 1 },
            suppression: suppressed ? { reason: 'test', kind: 'inline' } : undefined,
        });

        it('records scan and tracks rule hit frequencies and suppressions', () => {
            const issues: Issue[] = [
                createDummyIssue('SIM-ARGS-001', 'src/a.ts'),
                createDummyIssue('SIM-ARGS-001', 'src/b.ts'),
                createDummyIssue('SIM-ARGS-001', 'src/c.ts', true),
                createDummyIssue('SIM-LONG-001', 'src/a.ts'),
            ];

            sampler.recordScan({
                filesScanned: 5,
                issues,
            });

            const ledger = sampler.exportLedger();
            expect(ledger.totalScans).toBe(1);
            expect(ledger.totalFilesEvaluated).toBe(5);

            const argsRecord = ledger.rules['SIM-ARGS-001'];
            expect(argsRecord).toBeDefined();
            expect(argsRecord.totalHits).toBe(3);
            expect(argsRecord.suppressedHits).toBe(1);
            expect(argsRecord.totalEvaluations).toBe(5);
            expect(argsRecord.posteriorMean).toBeGreaterThan(0);
            expect(argsRecord.entropy).toBeGreaterThan(0);

            const longRecord = ledger.rules['SIM-LONG-001'];
            expect(longRecord).toBeDefined();
            expect(longRecord.totalHits).toBe(1);
            expect(longRecord.suppressedHits).toBe(0);
        });

        it('tracks co-occurrences and detects redundant candidates', () => {
            // Simulate 6 scans where ruleA and ruleB always appear together in src/foo.ts
            for (let i = 0; i < 6; i++) {
                sampler.recordScan({
                    filesScanned: 1,
                    issues: [
                        createDummyIssue('SIM-A', 'src/foo.ts'),
                        createDummyIssue('SIM-B', 'src/foo.ts'),
                    ],
                });
            }

            const ledger = sampler.exportLedger();
            const pairKey = 'SIM-A::SIM-B';
            const coRecord = ledger.coOccurrences[pairKey];

            expect(coRecord).toBeDefined();
            expect(coRecord.coHits).toBe(6);
            expect(coRecord.jaccardSimilarity).toBe(1.0);
            expect(coRecord.isRedundantCandidate).toBe(true);
        });

        it('exports deeply frozen ledger snapshot', () => {
            sampler.recordScan({
                filesScanned: 2,
                issues: [createDummyIssue('SIM-A', 'src/a.ts')],
            });

            const ledger = sampler.exportLedger();
            expect(Object.isFrozen(ledger)).toBe(true);
            expect(Object.isFrozen(ledger.rules)).toBe(true);
            expect(Object.isFrozen(ledger.coOccurrences)).toBe(true);
        });
    });

    describe('Persistence and fail-safe hydration', () => {
        it('saves and loads ledger file cleanly', async () => {
            const filePath = path.join(tempDir, 'sub', 'ledger.json');
            sampler.recordScan({
                filesScanned: 3,
                issues: [
                    {
                        id: 'iss-1',
                        rule: 'SIM-ELSE-001',
                        analyzer: 'simplify',
                        severity: 'info',
                        message: 'else',
                        location: { file: 'test.ts', line: 5, column: 1 },
                    },
                ],
            });

            await sampler.saveLedgerToFile(filePath);
            expect(fs.existsSync(filePath)).toBe(true);

            const newSampler = new ContinuousRuleSamplingSidecar();
            const loaded = await newSampler.loadLedgerFromFile(filePath);
            expect(loaded).toBe(true);

            const exported = newSampler.exportLedger();
            expect(exported.totalScans).toBe(1);
            expect(exported.totalFilesEvaluated).toBe(3);
            expect(exported.rules['SIM-ELSE-001']?.totalHits).toBe(1);
        });

        it('handles non-existent or corrupted files without throwing', async () => {
            const newSampler = new ContinuousRuleSamplingSidecar();
            const missing = await newSampler.loadLedgerFromFile('/non/existent/path/ledger.json');
            expect(missing).toBe(false);

            const corruptPath = path.join(tempDir, 'corrupt.json');
            fs.writeFileSync(corruptPath, '{ corrupt json');
            const corrupted = await newSampler.loadLedgerFromFile(corruptPath);
            expect(corrupted).toBe(false);
        });
    });
});
