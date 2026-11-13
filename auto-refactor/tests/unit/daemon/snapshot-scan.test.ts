/**
 * Module: Unit Test — Immutable Snapshot Validation & Client Fallback
 * File Path: tests/unit/daemon/snapshot-scan.test.ts
 * Architecture Role: Verify `handleSnapshotScan` telemetry generation, fail-closed validation,
 *   and disconnected fallback contracts for `trySnapshotScan` / `trySliceAudit`.
 * Dependencies & Triggers: Vitest, DaemonClient, handleSnapshotScan, trySnapshotScan, trySliceAudit.
 * Responsibilities: Prove snapshot scans compute full 10D/SQALE/ADR-Q/AAS payloads without
 *   reading disk trees and fail closed on missing/invalid archetype, bad paths, or SHA mismatches.
 * Exit Semantics & Design Rationale: Deterministic unit tests without child processes.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DaemonIndexModule from '../../../src/daemon/index';

const REQUIRE_DAEMON = createRequire(import.meta.url);
const {
    DaemonClient,
    handleSnapshotScan,
    trySliceAudit,
    trySnapshotScan,
} = REQUIRE_DAEMON('../../../dist/daemon/index.js') as typeof DaemonIndexModule;

describe('Daemon immutable snapshot validation & client fallback', () => {
    let scratchRoot: string;

    beforeEach(() => {
        scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-snap-valid-'));
    });

    afterEach(() => {
        vi.restoreAllMocks();
        fs.rmSync(scratchRoot, { recursive: true, force: true });
    });

    it('computes 10D, SQALE, ADR-Q, and AAS telemetry for an immutable snapshot', async () => {
        const sampleCode =
            'export function addNumbers(a: number, b: number): number {\n    return a + b;\n}\n';
        const snapOutcome = await handleSnapshotScan(
            { root: scratchRoot, archetype: 'library' },
            [{ path: 'src/math-helper.ts', content: sampleCode }],
            { repositoryId: 'unit-snap-repo' },
        );

        expect(snapOutcome.report.qualityScore?.indices).toBeDefined();
        expect(Object.keys(snapOutcome.report.qualityScore?.indices ?? {})).toHaveLength(10);
        expect(snapOutcome.report.qualityScore?.compositeScore).toBeGreaterThan(0);
        expect(snapOutcome.report.qualityScore?.technicalDebt).toBeDefined();
        expect(snapOutcome.stats.daemonUsed).toBe(true);
        expect(snapOutcome.stats.snapshotEntries).toBe(1);
        expect(String(snapOutcome.stats.manifestDigest)).toMatch(/^[0-9a-f]{64}$/);
        expect(snapOutcome.stats.aas).toBeDefined();
    });

    it('fails closed on missing archetype, bad archetype, bad paths, and SHA mismatches', async () => {
        const entries = [{ path: 'src/index.ts', content: 'export const x = 1;\n' }];
        await expect(handleSnapshotScan({ root: scratchRoot }, entries)).rejects.toThrow(
            /MISSING_ARCHETYPE/,
        );
        await expect(
            handleSnapshotScan({ root: scratchRoot, archetype: 'nonexistent-type' }, entries),
        ).rejects.toThrow(/INVALID_ARCHETYPE/);
        await expect(
            handleSnapshotScan({ root: scratchRoot, archetype: 'library' }, [
                { path: '../escape.ts', content: 'export const a = 1;\n' },
            ]),
        ).rejects.toThrow(/Ambiguous snapshot path/);
        await expect(
            handleSnapshotScan({ root: scratchRoot, archetype: 'library' }, [
                { path: '.git/config', content: '[core]\n' },
            ]),
        ).rejects.toThrow(/Ambiguous snapshot path/);
        await expect(
            handleSnapshotScan({ root: scratchRoot, archetype: 'library' }, [
                { path: 'src/index.ts', content: 'export const x = 1;\n', gitSha1: '0'.repeat(40) },
            ]),
        ).rejects.toThrow(/SNAPSHOT_SHA_MISMATCH/);
    });

    it('exposes trySnapshotScan/trySliceAudit fallback on disconnected client', async () => {
        const client = new DaemonClient(scratchRoot);
        expect(client.hasSnapshotCap()).toBe(false);
        expect(client.hasSliceCap()).toBe(false);
        expect(
            await trySnapshotScan({
                root: scratchRoot,
                config: { root: scratchRoot, archetype: 'library' },
                entries: [{ path: 'src/a.ts', content: 'export const a = 1;\n' }],
            }),
        ).toBeNull();
        expect(
            await trySliceAudit({
                root: scratchRoot,
                filePath: 'src/a.ts',
                oldContent: 'a',
                newContent: 'b',
            }),
        ).toBeNull();
    });
});
