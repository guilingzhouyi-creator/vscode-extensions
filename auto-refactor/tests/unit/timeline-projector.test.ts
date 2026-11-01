/**
 * Module: Trajectory Timeline Projector Unit Tests
 * File Path: tests/unit/timeline-projector.test.ts
 * Architecture Role: Unit test suite for timeline-projector.ts covering dual-tier reverse reading,
 *   relative window bucketing, hybrid score folding, and adaptive idle interval compression.
 * Dependencies & Triggers: Vitest; timeline-projector.ts.
 * Responsibilities: Prove that cutoff early-exit works, malformed lines are isolated gracefully,
 *   hybrid weighted scores match mathematical expectations, and idle buckets are folded.
 * Exit Semantics & Design Rationale: Deterministic, clean tmpdir lifecycle, 100% assertions pass.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
    parseDurationToMs,
    readRecordsTieredReverse,
    projectTimelineReport,
    DEFAULT_SINCE_DURATION_MS,
} from '../../src/core/trajectory/timeline-projector';
import { trajectoryCommand } from '../../src/cli/trajectory-cmd';
import type { CompactTrajectoryRecord } from '../../src/core/trajectory/eloc-types';

describe('Timeline Projector Unit Tests', () => {
    let tempDirectory: string;

    beforeEach(async () => {
        tempDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'traj-test-'));
    });

    afterEach(async () => {
        try {
            await fs.promises.rm(tempDirectory, { recursive: true, force: true });
        } catch {
            // Ignore cleanup errors
        }
    });

    describe('parseDurationToMs', () => {
        it('should correctly parse standard duration units', () => {
            expect(parseDurationToMs('30m')).toBe(30 * 60 * 1000);
            expect(parseDurationToMs('1h')).toBe(3600 * 1000);
            expect(parseDurationToMs('24h')).toBe(24 * 3600 * 1000);
            expect(parseDurationToMs('7d')).toBe(7 * 24 * 3600 * 1000);
            expect(parseDurationToMs('2weeks')).toBe(14 * 24 * 3600 * 1000);
        });

        it('should correctly parse fractional floating durations', () => {
            expect(parseDurationToMs('1.5h')).toBe(Math.round(1.5 * 3600 * 1000));
            expect(parseDurationToMs('0.5d')).toBe(Math.round(0.5 * 24 * 3600 * 1000));
            expect(parseDurationToMs('90s')).toBe(90 * 1000);
        });

        it('should handle raw millisecond numbers or fall back gracefully', () => {
            expect(parseDurationToMs(5000)).toBe(5000);
            expect(parseDurationToMs('')).toBe(DEFAULT_SINCE_DURATION_MS);
            expect(parseDurationToMs('invalid-time')).toBe(DEFAULT_SINCE_DURATION_MS);
        });
    });

    describe('readRecordsTieredReverse', () => {
        it('should early-exit when timestamp is below cutoff and isolate malformed lines', async () => {
            const currentTimestamp = 1000000;
            const firstRecord: CompactTrajectoryRecord = {
                t: currentTimestamp - 1000,
                rev: 'rev001',
                id: 'run-1',
                mod: 'core',
                agent: 'agent-a',
                eloc: { proc: 100, uniq: 80, chg: 10, sem: 8, reloc: 0, cosm: 0 },
                score: { bef: 90, aft: 95, vec: [], qed: 0.1 },
                debt: { add: 0, res: 5, reg: 0 },
                gate: { pass: true },
            };
            const secondRecord: CompactTrajectoryRecord = {
                t: currentTimestamp - 500,
                rev: 'rev002',
                id: 'run-2',
                mod: 'core',
                agent: 'agent-b',
                eloc: { proc: 200, uniq: 160, chg: 20, sem: 16, reloc: 0, cosm: 0 },
                score: { bef: 95, aft: 98, vec: [], qed: 0.2 },
                debt: { add: 1, res: 10, reg: 0 },
                gate: { pass: true },
            };
            const ancientRecord: CompactTrajectoryRecord = {
                t: currentTimestamp - 50000,
                rev: 'rev-ancient',
                id: 'run-0',
                mod: 'core',
                agent: 'agent-a',
                eloc: { proc: 50, uniq: 40, chg: 5, sem: 4, reloc: 0, cosm: 0 },
                score: { bef: 80, aft: 85, vec: [], qed: 0 },
                debt: { add: 0, res: 0, reg: 0 },
                gate: { pass: true },
            };

            const activePath = path.join(tempDirectory, 'active-runs.ndjson');
            const lines = [
                JSON.stringify(ancientRecord),
                '{ malformed half json',
                JSON.stringify(firstRecord),
                JSON.stringify(secondRecord),
            ].join('\n');
            await fs.promises.writeFile(activePath, lines, 'utf8');

            const cutoffTimestamp = currentTimestamp - 2000;
            const { records, malformedCount } = await readRecordsTieredReverse(tempDirectory, cutoffTimestamp);

            expect(malformedCount).toBe(1);
            expect(records.length).toBe(2);
            expect(records[0].rev).toBe('rev001');
            expect(records[1].rev).toBe('rev002');
        });
    });

    describe('projectTimelineReport', () => {
        it('should aggregate relative hours and fold idle gaps', async () => {
            const currentTimestamp = 20000000;
            const millisecondsPerHour = 3600000;

            const recentRecord: CompactTrajectoryRecord = {
                t: currentTimestamp - 1000,
                rev: 'revRecent',
                id: 'r1',
                mod: 'core',
                agent: 'agent-x',
                eloc: { proc: 1000, uniq: 800, chg: 100, sem: 80, reloc: 0, cosm: 0 },
                score: { bef: 90, aft: 96, vec: [], qed: 0 },
                debt: { add: 0, res: 10, reg: 0 },
                gate: { pass: true },
            };

            const olderRecord: CompactTrajectoryRecord = {
                t: currentTimestamp - 5 * millisecondsPerHour - 1000,
                rev: 'revOlder',
                id: 'r2',
                mod: 'core',
                agent: 'agent-y',
                eloc: { proc: 500, uniq: 400, chg: 50, sem: 40, reloc: 0, cosm: 0 },
                score: { bef: 88, aft: 92, vec: [], qed: 0 },
                debt: { add: 2, res: 5, reg: 1 },
                gate: { pass: false },
            };

            const activePath = path.join(tempDirectory, 'active-runs.ndjson');
            await fs.promises.writeFile(
                activePath,
                `${JSON.stringify(olderRecord)}\n${JSON.stringify(recentRecord)}\n`,
                'utf8',
            );

            const report = await projectTimelineReport({
                ledgerDir: tempDirectory,
                since: '10h',
                bucket: 'hour',
                referenceNowMs: currentTimestamp,
            });

            expect(report.totalSampledRuns).toBe(2);
            expect(report.bucketType).toBe('hour');
            expect(report.buckets.length).toBeGreaterThanOrEqual(3);

            const firstBucket = report.buckets[0];
            expect(firstBucket.bucketId).toBe('-1h');
            expect(firstBucket.runsCount).toBe(1);
            expect(firstBucket.latestScore).toBe(96);
            expect(firstBucket.weightedMeanScore).toBe(96);
            expect(firstBucket.gatePassRate).toBe(100);

            const idleBucket = report.buckets.find((bucket) => bucket.isIdleFold);
            expect(idleBucket).toBeDefined();
            expect(idleBucket?.bucketId).toContain('idle gap');
        });

        it('should correctly calculate hybrid weighted mean score', async () => {
            const currentTimestamp = 30000000;

            const smallChangeRecord: CompactTrajectoryRecord = {
                t: currentTimestamp - 2000,
                rev: 'c1',
                id: 'r1',
                mod: 'core',
                agent: 'agent-x',
                eloc: { proc: 100, uniq: 80, chg: 10, sem: 10, reloc: 0, cosm: 0 },
                score: { bef: 90, aft: 90, vec: [], qed: 0 },
                debt: { add: 0, res: 0, reg: 0 },
                gate: { pass: true },
            };

            const bigChangeRecord: CompactTrajectoryRecord = {
                t: currentTimestamp - 1000,
                rev: 'c1',
                id: 'r2',
                mod: 'core',
                agent: 'agent-x',
                eloc: { proc: 900, uniq: 720, chg: 90, sem: 90, reloc: 0, cosm: 0 },
                score: { bef: 90, aft: 100, vec: [], qed: 0 },
                debt: { add: 0, res: 10, reg: 0 },
                gate: { pass: true },
            };

            const activePath = path.join(tempDirectory, 'active-runs.ndjson');
            await fs.promises.writeFile(
                activePath,
                `${JSON.stringify(smallChangeRecord)}\n${JSON.stringify(bigChangeRecord)}\n`,
                'utf8',
            );

            const report = await projectTimelineReport({
                ledgerDir: tempDirectory,
                since: '1h',
                bucket: 'commit',
                referenceNowMs: currentTimestamp,
            });

            expect(report.buckets.length).toBe(1);
            const bucketSnapshot = report.buckets[0];
            expect(bucketSnapshot.bucketId).toBe('c1');
            expect(bucketSnapshot.runsCount).toBe(2);
            expect(bucketSnapshot.latestScore).toBe(100);
            expect(bucketSnapshot.weightedMeanScore).toBe(99);
            expect(bucketSnapshot.scoreFloor).toBe(90);
            expect(bucketSnapshot.scoreCeiling).toBe(100);
        });

        it('should support semantic grouping by agent', async () => {
            const currentTimestamp = 40000000;
            const primaryAgentRecord: CompactTrajectoryRecord = {
                t: currentTimestamp - 1000,
                rev: 'c1',
                id: 'r1',
                mod: 'core',
                agent: 'agent-alpha',
                eloc: { proc: 100, uniq: 80, chg: 10, sem: 10, reloc: 0, cosm: 0 },
                score: { bef: 90, aft: 95, vec: [], qed: 0 },
                debt: { add: 0, res: 5, reg: 0 },
                gate: { pass: true },
            };

            const secondaryAgentRecord: CompactTrajectoryRecord = {
                t: currentTimestamp - 500,
                rev: 'c2',
                id: 'r2',
                mod: 'core',
                agent: 'agent-beta',
                eloc: { proc: 200, uniq: 160, chg: 20, sem: 20, reloc: 0, cosm: 0 },
                score: { bef: 95, aft: 98, vec: [], qed: 0 },
                debt: { add: 0, res: 10, reg: 0 },
                gate: { pass: true },
            };

            const activePath = path.join(tempDirectory, 'active-runs.ndjson');
            await fs.promises.writeFile(
                activePath,
                `${JSON.stringify(primaryAgentRecord)}\n${JSON.stringify(secondaryAgentRecord)}\n`,
                'utf8',
            );

            const report = await projectTimelineReport({
                ledgerDir: tempDirectory,
                since: '1h',
                bucket: 'agent',
                referenceNowMs: currentTimestamp,
            });

            expect(report.buckets.length).toBe(2);
            const agentIds = report.buckets.map((bucket) => bucket.bucketId);
            expect(agentIds).toContain('agent-alpha');
            expect(agentIds).toContain('agent-beta');
        });
    });

    describe('readRecordsTieredReverse archive multi-chunk boundary', () => {
        it('should correctly stream and reconstruct records across 64KB reverse chunk boundaries', async () => {
            const currentTimestamp = 50000000;
            const recordsCount = 400;
            const archiveLines: string[] = [];

            for (let index = 0; index < recordsCount; index++) {
                const syntheticRecord: CompactTrajectoryRecord = {
                    t: currentTimestamp - (recordsCount - index) * 1000,
                    rev: `rev-${String(index).padStart(4, '0')}`,
                    id: `run-archive-${index}`,
                    mod: 'core',
                    agent: 'agent-stress',
                    eloc: { proc: 120, uniq: 90, chg: 15, sem: 12, reloc: 0, cosm: 0 },
                    score: { bef: 90, aft: 95, vec: [], qed: 0 },
                    debt: { add: 0, res: 2, reg: 0 },
                    gate: { pass: true },
                };
                archiveLines.push(JSON.stringify(syntheticRecord));
            }

            const archivePath = path.join(tempDirectory, 'archive-runs.ndjson');
            await fs.promises.writeFile(archivePath, archiveLines.join('\n') + '\n', 'utf8');

            const archiveStats = await fs.promises.stat(archivePath);
            expect(archiveStats.size).toBeGreaterThan(64 * 1024);

            const cutoffTimestamp = currentTimestamp - 200 * 1000;
            const { records, malformedCount } = await readRecordsTieredReverse(
                tempDirectory,
                cutoffTimestamp,
                1000,
            );

            expect(malformedCount).toBe(0);
            expect(records.length).toBe(200);
            expect(records[0].rev).toBe('rev-0200');
            expect(records[records.length - 1].rev).toBe('rev-0399');
        });
    });

    describe('trajectoryCommand CLI Controller', () => {
        it('should render unified dashboard as JSON and text', async () => {
            const ledgerDirectory = path.join(tempDirectory, '.refactor-trajectory');
            await fs.promises.mkdir(ledgerDirectory, { recursive: true });

            const sampleRecord: CompactTrajectoryRecord = {
                t: Date.now() - 5000,
                rev: 'rev-cli-001',
                id: 'run-cli-1',
                mod: 'core',
                agent: 'agent-cli',
                eloc: { proc: 300, uniq: 250, chg: 30, sem: 25, reloc: 0, cosm: 0 },
                score: { bef: 92, aft: 96, vec: [], qed: 0.1 },
                debt: { add: 0, res: 4, reg: 0 },
                gate: { pass: true },
            };

            await fs.promises.writeFile(
                path.join(ledgerDirectory, 'active-runs.ndjson'),
                JSON.stringify(sampleRecord) + '\n',
                'utf8',
            );

            const jsonOutcome = await trajectoryCommand([
                'trajectory',
                '--root',
                tempDirectory,
                '--format',
                'json',
            ]);
            expect(jsonOutcome.code).toBe(0);
            const parsedReport = JSON.parse(jsonOutcome.text);
            expect(parsedReport.timeline).toBeDefined();
            expect(parsedReport.timeline.totalSampledRuns).toBe(1);

            const textOutcome = await trajectoryCommand(['trajectory', '--root', tempDirectory]);
            expect(textOutcome.code).toBe(0);
            expect(textOutcome.text).toContain('AUTO-REFACTOR INTEGRATED TRAJECTORY TELEMETRY');
            expect(textOutcome.text).toContain('VIRTUAL TIMELINE PROJECTION');
        });

        it('should support --summary to condense view and --out to persist report', async () => {
            const ledgerDirectory = path.join(tempDirectory, '.refactor-trajectory');
            await fs.promises.mkdir(ledgerDirectory, { recursive: true });

            const sampleRecord: CompactTrajectoryRecord = {
                t: Date.now() - 10000,
                rev: 'rev-summary-001',
                id: 'run-summary-1',
                mod: 'core',
                agent: 'agent-summary',
                eloc: { proc: 100, uniq: 80, chg: 10, sem: 8, reloc: 0, cosm: 0 },
                score: { bef: 90, aft: 94, vec: [], qed: 0 },
                debt: { add: 0, res: 1, reg: 0 },
                gate: { pass: true },
            };

            await fs.promises.writeFile(
                path.join(ledgerDirectory, 'active-runs.ndjson'),
                JSON.stringify(sampleRecord) + '\n',
                'utf8',
            );

            const summaryOutcome = await trajectoryCommand([
                'trajectory',
                '--root',
                tempDirectory,
                '--summary',
            ]);
            expect(summaryOutcome.code).toBe(0);
            expect(summaryOutcome.text).toContain('AUTO-REFACTOR INTEGRATED TRAJECTORY TELEMETRY');
            expect(summaryOutcome.text).not.toContain('VIRTUAL TIMELINE PROJECTION');

            const destinationFilePath = path.join(tempDirectory, 'nested', 'report.txt');
            const fileOutcome = await trajectoryCommand([
                'trajectory',
                '--root',
                tempDirectory,
                '--out',
                destinationFilePath,
            ]);
            expect(fileOutcome.code).toBe(0);
            expect(fileOutcome.text).toContain('[Trajectory report written to');

            const fileContent = await fs.promises.readFile(destinationFilePath, 'utf8');
            expect(fileContent).toContain('AUTO-REFACTOR INTEGRATED TRAJECTORY TELEMETRY');
        });
    });
});
