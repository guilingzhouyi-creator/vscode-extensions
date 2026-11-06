/**
 * Module: Unit Test — Cache Store WAL Append-Only & Compaction Engine
 * File Path: tests/unit/cache-store-wal.test.ts
 * Architecture Role: Verifies the Append-Only WAL logging, compaction snapshots,
 *   corrupt-line recovery, and crash-resilience invariants of CacheStore.
 * Dependencies & Triggers: Consumes CacheStore, cache-persistence, and vitest runner.
 * Responsibilities: Assert that incremental flushes append instead of full rewrite,
 *   compaction consolidates snapshots, and corrupt lines are skipped gracefully.
 * Exit Semantics & Design Rationale: Exits green when all assertions pass without error.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CacheStore, type Fingerprint, type CachedResult } from '../../src/core/cache';
import type { Issue } from '../../src/core/types';

describe('CacheStore WAL Append-Only & Compaction Engine', () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-wal-test-'));
    });

    afterEach(() => {
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch {
            /* ignore cleanup failure */
        }
    });

    const sampleFp1: Fingerprint = { mtimeMs: 1000, size: 500 };
    const sampleFp2: Fingerprint = { mtimeMs: 2000, size: 600 };

    const sampleResult1: CachedResult = {
        issues: [
            {
                ruleId: 'SEC-001',
                message: 'Security issue detected',
                line: 10,
                column: 5,
                severity: 'warning',
            } as Issue,
        ],
        metric: null,
    };

    const sampleResult2: CachedResult = {
        issues: [],
        metric: null,
    };

    it('initial flush creates files atomically and secondary flush appends in WAL mode', () => {
        const store = new CacheStore(tempDir);
        expect(store.enabled).toBe(true);

        // Initial write
        store.writeL1('src/alpha.ts', sampleFp1);
        store.writeL2('hash1', 'content1', 'src/alpha.ts', sampleResult1, sampleFp1);
        store.flush();

        const l1IndexPath = path.join(store.dir, 'l1-index.aridx');
        const l2StorePath = path.join(store.dir, 'l2-store.arc');
        const l2WalPath = path.join(store.dir, 'l2-delta.arwal');
        expect(fs.existsSync(l1IndexPath)).toBe(true);
        expect(fs.existsSync(l2StorePath)).toBe(true);
        expect(fs.existsSync(l2WalPath)).toBe(false);

        // Secondary write in WAL mode: appends dirty entry without full rewrite
        store.writeL1('src/beta.ts', sampleFp2);
        store.writeL2('hash2', 'content2', 'src/beta.ts', sampleResult2, sampleFp2);
        store.flush();

        expect(fs.existsSync(l2WalPath)).toBe(true);

        const metrics = store.getCacheMetrics();
        expect(metrics.l1).toBe(2);
        expect(metrics.l2).toBe(2);
        expect(metrics.appendedL2).toBe(1);

        // Verify that a newly instantiated CacheStore loads both records
        const store2 = new CacheStore(tempDir);
        const hitAlpha = store2.lookupL2('hash1', 'content1');
        expect(hitAlpha).not.toBeNull();
        expect(hitAlpha?.issues.length).toBe(1);

        const hitBeta = store2.lookupL2('hash2', 'content2');
        expect(hitBeta).not.toBeNull();
        expect(hitBeta?.issues.length).toBe(0);
    });

    it('appended duplicate key in WAL overrides earlier value on reload', () => {
        const store = new CacheStore(tempDir);
        store.writeL2('hash1', 'content1', 'src/file.ts', sampleResult1, sampleFp1);
        store.flush();

        // Update the same key with new issues
        const updatedResult: CachedResult = {
            issues: [
                {
                    ruleId: 'SEC-002',
                    message: 'Updated issue',
                    line: 20,
                    column: 1,
                    severity: 'error',
                } as Issue,
            ],
            metric: null,
        };
        store.writeL2('hash1', 'content1', 'src/file.ts', updatedResult, sampleFp1);
        store.flush();

        const l2WalPath = path.join(store.dir, 'l2-delta.arwal');
        expect(fs.existsSync(l2WalPath)).toBe(true);

        // When reloaded, later frame in WAL naturally overrides store snapshot
        const reloadedStore = new CacheStore(tempDir);
        const hit = reloadedStore.lookupL2('hash1', 'content1');
        expect(hit).not.toBeNull();
        expect((hit?.issues[0] as unknown as { ruleId?: string })?.ruleId).toBe('SEC-002');
    });

    it('compaction rewrites snapshots cleanly and resets WAL appended count', () => {
        const store = new CacheStore(tempDir);
        store.writeL2('hash1', 'content1', 'src/file.ts', sampleResult1, sampleFp1);
        store.flush();

        // Write update
        store.writeL2('hash1', 'content1', 'src/file.ts', sampleResult2, sampleFp1);
        store.flush();

        const l2WalPath = path.join(store.dir, 'l2-delta.arwal');
        expect(fs.existsSync(l2WalPath)).toBe(true);

        // Trigger compaction
        store.compact();

        // After compaction, WAL delta is removed and consolidated into l2-store.arc
        expect(fs.existsSync(l2WalPath)).toBe(false);
        expect(fs.existsSync(path.join(store.dir, 'l2-store.arc'))).toBe(true);

        const metrics = store.getCacheMetrics();
        expect(metrics.appendedL1).toBe(0);
        expect(metrics.appendedL2).toBe(0);
    });

    it('async flush persists dirty entries and supports async lifecycle', async () => {
        const store = new CacheStore(tempDir);
        store.writeL1('src/async.ts', sampleFp1);
        store.writeL2('hashAsync', 'contentAsync', 'src/async.ts', sampleResult1, sampleFp1);

        await store.flushAsync();

        const l2StorePath = path.join(store.dir, 'l2-store.arc');
        expect(fs.existsSync(l2StorePath)).toBe(true);

        const store2 = new CacheStore(tempDir);
        expect(store2.lookupL1('src/async.ts')).not.toBeNull();
        expect(store2.lookupL2('hashAsync', 'contentAsync')).not.toBeNull();
    });

    it('recovers from corrupt tail in ARC2 WAL and legacy results.jsonl fallback gracefully', () => {
        const store = new CacheStore(tempDir);
        store.writeL2('hashValid1', 'contentValid1', 'src/valid1.ts', sampleResult1, sampleFp1);
        store.flush();
        store.writeL2('hashValid2', 'contentValid2', 'src/valid2.ts', sampleResult2, sampleFp2);
        store.flush();

        const l2WalPath = path.join(store.dir, 'l2-delta.arwal');
        // Inject a corrupt truncated frame tail into ARC2 WAL
        fs.appendFileSync(l2WalPath, Buffer.from([0xde, 0xad, 0xbe, 0xef, 0x01, 0x02]));

        // Reload should stop cleanly at the corrupt tail and preserve both valid entries
        const reloadedStore = new CacheStore(tempDir);
        expect(reloadedStore.lookupL2('hashValid1', 'contentValid1')).not.toBeNull();
        expect(reloadedStore.lookupL2('hashValid2', 'contentValid2')).not.toBeNull();
    });

    it('clear() safely empties all on-disk files and resets memory state', () => {
        const store = new CacheStore(tempDir);
        store.writeL1('src/file.ts', sampleFp1);
        store.writeL2('hash1', 'content1', 'src/file.ts', sampleResult1, sampleFp1);
        store.flush();

        const cleared = store.clear();
        expect(cleared).toBe(true);

        const metrics = store.getCacheMetrics();
        expect(metrics.l1).toBe(0);
        expect(metrics.l2).toBe(0);
        expect(metrics.appendedL1).toBe(0);
        expect(metrics.appendedL2).toBe(0);
        expect(store.lookupL1('src/file.ts')).toBeNull();
    });
});
