/**
 * Module: Unit Tests — Retained Source Store
 * File Path: tests/unit/scanner/retained-source.test.ts
 * Architecture Role: Contract test for the bounded side store the scanner uses to hand already-read
 *   source text to the post-scan scoring pass.
 * Dependencies & Triggers: Imports `RetainedSourceStore`; vitest unit lane of `npm test`.
 * Responsibilities:
 *   1. Pin that retained text is readable by relative path.
 *   2. Pin that the ceiling seals the store and clears it — all-or-nothing, never a partial set.
 *   3. Pin that a sealed store keeps refusing new entries instead of silently resuming.
 * Exit Semantics & Design Rationale: No I/O and no timing, so the assertions describe the contract
 *   rather than the machine. The sealing case is the one that matters operationally: a partial
 *   retention set would make the caller's disk-read rate depend on file traversal order.
 */
import { describe, it, expect } from 'vitest';
import { RetainedSourceStore } from '../../../src/core/scanner/retained-source';

describe('RetainedSourceStore — retention', () => {
    it('returns what was retained, keyed by relative path', () => {
        const store = new RetainedSourceStore(1024);
        store.retain('src/a.ts', 'const a = 1;');
        expect(store.snapshot().get('src/a.ts')).toBe('const a = 1;');
        expect(store.snapshot().size).toBe(1);
    });

    it('reports the configured ceiling', () => {
        expect(new RetainedSourceStore(4096).capacityBytes()).toBe(4096);
    });

    it('starts unsealed and keeps every entry that fits', () => {
        const store = new RetainedSourceStore(1024);
        store.retain('a', 'x'.repeat(100));
        store.retain('b', 'y'.repeat(100));
        expect(store.isSealed()).toBe(false);
        expect(store.snapshot().size).toBe(2);
    });
});

describe('RetainedSourceStore — sealing at the ceiling', () => {
    it('clears the store instead of keeping a partial set', () => {
        const store = new RetainedSourceStore(100);
        store.retain('a', 'x'.repeat(60));
        const kept = store.retain('b', 'y'.repeat(60));
        expect(kept).toBe(false);
        expect(store.isSealed()).toBe(true);
        // All-or-nothing: the earlier entry is dropped too, so the caller sees a uniform "empty map"
        // signal rather than a hit rate that depends on traversal order.
        expect(store.snapshot().size).toBe(0);
    });

    it('refuses further entries once sealed', () => {
        const store = new RetainedSourceStore(100);
        store.retain('a', 'x'.repeat(200));
        expect(store.retain('c', 'small')).toBe(false);
        expect(store.snapshot().size).toBe(0);
        expect(store.isSealed()).toBe(true);
    });

    it('admits an entry that exactly fills the ceiling', () => {
        const store = new RetainedSourceStore(10);
        expect(store.retain('a', 'x'.repeat(10))).toBe(true);
        expect(store.isSealed()).toBe(false);
        expect(store.snapshot().get('a')).toBe('x'.repeat(10));
    });
});
