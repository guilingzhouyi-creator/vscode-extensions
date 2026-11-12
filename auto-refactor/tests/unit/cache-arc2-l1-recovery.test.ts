/**
 * Module: Unit Test — ARC2 Torn-Tail Repair, Generation Isolation & L1 Fallback Compaction
 * File Path: tests/unit/cache-arc2-l1-recovery.test.ts
 * Architecture Role: Regression guard covering ARC2 crash-recovery invariants and L1 fallback
 *   compaction when worker threads fail or WAL size hits backpressure ceilings.
 * Dependencies & Triggers: Consumes CacheStore, L1Journal, loadArc2L2Container, cache-arc2-io,
 *   and L1_WAL_BACKPRESSURE_BYTES; runs in Vitest unit runs.
 * Responsibilities: Verify torn-tail truncation before ARC2 WAL append, elimination of stale-WAL
 *   resurrection after snapshot rewrite, and bounded L1 compaction recovery without error loops.
 * Exit Semantics & Design Rationale: Asserts persisted filesystem state across fresh CacheStore loads.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CacheStore, type CachedResult, type Fingerprint } from '../../src/core/cache';
import {
    loadArc2L2Container,
    serializeArc2L2Container,
    ARC2_KIND_WAL,
} from '../../src/core/cache-arc2';
import { L1Journal, WAL_BACKPRESSURE_BYTES } from '../../src/core/cache-l1-journal';

const SAMPLE_FP: Fingerprint = { mtimeMs: 1000, size: 120 };
const SAMPLE_FP_NEXT: Fingerprint = { mtimeMs: 2000, size: 240 };
const TORN_TAIL_BYTES = Buffer.from([0xde, 0xad, 0xbe, 0xef, 0x42]);
const CLEAN_RESULT: CachedResult = { issues: [], metric: null };

describe('ARC2 & L1 crash recovery hardening', () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc2-l1-recovery-'));
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('returns validBytes end offset from loadArc2L2Container and truncates torn WAL before append', async () => {
        const cacheDir = path.join(tempDir, 'cache');
        const store = new CacheStore(cacheDir, tempDir);
        store.writeL2('k1', 'h1', 'src/one.ts', CLEAN_RESULT, SAMPLE_FP);
        await store.flushAsync();
        store.writeL2('k2', 'h2', 'src/two.ts', CLEAN_RESULT, SAMPLE_FP);
        await store.flushAsync();

        const walPath = path.join(store.dir, 'l2-delta.arwal');
        const beforeTornBytes = fs.readFileSync(walPath);
        const beforeLoaded = loadArc2L2Container(beforeTornBytes, () => {}, true);
        expect(beforeLoaded).not.toBeNull();
        expect(beforeLoaded?.validBytes).toBe(beforeTornBytes.length);

        fs.appendFileSync(walPath, TORN_TAIL_BYTES);
        const corruptedBytes = fs.readFileSync(walPath);
        const truncatedLoaded = loadArc2L2Container(corruptedBytes, () => {}, true);
        expect(truncatedLoaded?.validBytes).toBe(beforeTornBytes.length);

        const recovered = new CacheStore(cacheDir, tempDir);
        recovered.writeL2('k3', 'h3', 'src/three.ts', CLEAN_RESULT, SAMPLE_FP_NEXT);
        await recovered.flushAsync();

        const afterAppend = fs.readFileSync(walPath);
        const afterLoaded = loadArc2L2Container(afterAppend, () => {}, true);
        expect(afterLoaded?.validBytes).toBe(afterAppend.length);

        const reloaded = new CacheStore(cacheDir, tempDir);
        expect(reloaded.lookupL2('k1', 'h1')).not.toBeNull();
        expect(reloaded.lookupL2('k2', 'h2')).not.toBeNull();
        expect(reloaded.lookupL2('k3', 'h3')).not.toBeNull();
    });

    it('prevents stale l2-delta.arwal from resurrecting deleted entries after snapshot replacement', async () => {
        const cacheDir = path.join(tempDir, 'cache');
        const store = new CacheStore(cacheDir, tempDir, { maxEntries: 1 });
        store.writeL2('kOld', 'hOld', 'src/old.ts', CLEAN_RESULT, SAMPLE_FP);
        await store.flushAsync();

        const staleWalSnapshot = serializeArc2L2Container(
            [{ k: 'v1:kOld:hOld', p: 'src/old.ts', issues: [], metric: null, ts: 1000 }],
            ARC2_KIND_WAL,
            { storeGeneration: 0 },
        );

        store.writeL2('kNew', 'hNew', 'src/new.ts', CLEAN_RESULT, SAMPLE_FP_NEXT);
        await store.flushAsync();
        expect(store.lookupL2('kOld', 'hOld')).toBeNull();

        // Simulate crash between l2-store.arc atomic replace and l2-delta.arwal unlink
        const walPath = path.join(store.dir, 'l2-delta.arwal');
        fs.writeFileSync(walPath, staleWalSnapshot);

        const afterCrash = new CacheStore(cacheDir, tempDir, { maxEntries: 1 });
        expect(afterCrash.lookupL2('kOld', 'hOld')).toBeNull();
        expect(afterCrash.lookupL2('kNew', 'hNew')).not.toBeNull();
    });

    it('recovers L1Journal via fallback compaction when checkpoint worker is unavailable', async () => {
        const journalDir = path.join(tempDir, 'journal');
        fs.mkdirSync(journalDir, { recursive: true });
        const journal = new L1Journal(journalDir, {
            checkpointBytes: 64,
            workerFile: path.join(tempDir, 'nonexistent-checkpoint-worker.js'),
        });

        const state = new Map<string, Fingerprint>();
        state.set('src/init.ts', SAMPLE_FP);
        await journal.appendAsync([['src/init.ts', SAMPLE_FP]], state);

        state.set('src/trigger-worker.ts', SAMPLE_FP);
        await journal.appendAsync([['src/trigger-worker.ts', SAMPLE_FP]], state);
        await journal.waitForCheckpoint();
        expect(journal.isWorkerUnavailable).toBe(true);
        expect(journal.lastError).toBeDefined();

        // Next flush degrades cleanly to in-process checkpoint compaction instead of throwing forever
        state.set('src/recovered.ts', SAMPLE_FP_NEXT);
        await journal.appendAsync([['src/recovered.ts', SAMPLE_FP_NEXT]], state);
        expect(journal.lastError).toBeUndefined();
        expect(journal.currentWalBytes).toBeLessThan(WAL_BACKPRESSURE_BYTES);
        expect(journal.currentWalBytes).toBeLessThan(64);

        const reloaded = new Map<string, Fingerprint>();
        expect(new L1Journal(journalDir).load(reloaded)).toBe(true);
        expect(reloaded.get('src/init.ts')).toEqual(SAMPLE_FP);
        expect(reloaded.get('src/trigger-worker.ts')).toEqual(SAMPLE_FP);
        expect(reloaded.get('src/recovered.ts')).toEqual(SAMPLE_FP_NEXT);
    });

    it('clears lastFlushError during CacheStore settleAsync via fallback compaction', async () => {
        const cacheDir = path.join(tempDir, 'cache');
        const store = new CacheStore(cacheDir, tempDir);
        store.writeL1('src/a.ts', SAMPLE_FP);
        await store.flushAsync();

        // Force workerUnavailable + error state via internal test injection on owned journal
        const internal = store as unknown as { l1Journal: L1Journal };
        internal.l1Journal = new L1Journal(store.dir, {
            checkpointBytes: 1,
            workerFile: path.join(tempDir, 'missing-worker.js'),
        });
        expect(internal.l1Journal.load(new Map([['src/a.ts', SAMPLE_FP]]))).toBe(true);

        store.writeL1('src/b.ts', SAMPLE_FP_NEXT);
        await store.settleAsync();

        expect(store.lastFlushError).toBeUndefined();
        const reloaded = new CacheStore(cacheDir, tempDir);
        expect(reloaded.lookupL1('src/a.ts')).toEqual(SAMPLE_FP);
        expect(reloaded.lookupL1('src/b.ts')).toEqual(SAMPLE_FP_NEXT);
    });
});
