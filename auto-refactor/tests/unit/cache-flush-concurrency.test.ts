/**
 * Module: Cache flush concurrency regressions
 * File Path: tests/unit/cache-flush-concurrency.test.ts
 * Architecture Role: Verify persisted results across asynchronous writer interleavings.
 * Dependencies & Triggers: Vitest, real filesystem, CacheStore, and cache persistence.
 * Responsibilities: Preserve updates submitted during writes and serialize overlapping flushes.
 * Exit Semantics & Design Rationale: Reloaded public state proves durability beyond memory.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Issue } from '../../src/core/types';
import { CacheStore } from '../../src/core/cache';
import * as persistence from '../../src/core/cache-persistence';

function deferred(): { promise: Promise<void>; resolve: () => void } {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

describe('cache flush generations', () => {
    let directory: string;
    beforeEach(() => {
        directory = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-cache-generation-'));
    });
    afterEach(() => {
        vi.restoreAllMocks();
        const relative = path.relative(os.tmpdir(), directory);
        if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
            throw new Error('Invalid owned cache test directory');
        }
        fs.rmSync(directory, { recursive: true, force: true });
    });

    function store(): CacheStore {
        return new CacheStore(path.join(directory, 'cache'), directory);
    }

    it.each([false, true])(
        'persists L1 updates during a write, synchronous request=%s',
        async (syncDuringWrite) => {
            const cache = store();
            cache.writeL1('src/a.ts', { mtimeMs: 1, size: 1 });
            const entered = deferred();
            const resume = deferred();
            const rename = fs.promises.rename.bind(fs.promises);
            vi.spyOn(fs.promises, 'rename').mockImplementation(async (source, destination) => {
                if (path.basename(String(destination)) === 'l1-index.aridx') {
                    entered.resolve();
                    await resume.promise;
                }
                await rename(source, destination);
            });
            const first = cache.flushAsync();
            await entered.promise;
            expect(cache.clear()).toBe(false);
            expect(() => cache.runCompactCache()).toThrow(/active|busy/i);
            cache.writeL1('src/a.ts', { mtimeMs: 2, size: 2 });
            cache.writeL1('src/b.ts', { mtimeMs: 3, size: 3 });
            if (syncDuringWrite) cache.flush();
            resume.resolve();
            await first;
            expect(cache.lastFlushError).toBeUndefined();
            if (!syncDuringWrite) await cache.flushAsync();
            const reloaded = store();
            expect(reloaded.lookupL1('src/a.ts')).toMatchObject({ mtimeMs: 2, size: 2 });
            expect(reloaded.lookupL1('src/b.ts')).toMatchObject({ mtimeMs: 3, size: 3 });
        },
    );

    it('preserves a newer L1 value after an interrupted write and retry', async () => {
        const cache = store();
        cache.writeL1('src/a.ts', { mtimeMs: 1, size: 1 });
        const entered = deferred();
        const resume = deferred();
        vi.spyOn(persistence, 'writeFileAtomicAsync').mockImplementationOnce(async () => {
            entered.resolve();
            await resume.promise;
            throw new Error('injected disk failure');
        });
        const flush = cache.flushAsync();
        await entered.promise;
        cache.writeL1('src/a.ts', { mtimeMs: 2, size: 2 });
        resume.resolve();
        await flush;
        expect(cache.lastFlushError).toBeInstanceOf(Error);
        await cache.flushAsync();
        expect(cache.lastFlushError).toBeUndefined();
        expect(store().lookupL1('src/a.ts')).toMatchObject({ mtimeMs: 2, size: 2 });
    });

    it('persists L2 replacements arriving after the snapshot was encoded', async () => {
        const cache = store();
        cache.writeL2('config', 'hash', 'src/a.ts', { issues: [] });
        const entered = deferred();
        const resume = deferred();
        const rename = fs.promises.rename.bind(fs.promises);
        vi.spyOn(fs.promises, 'rename').mockImplementation(async (source, destination) => {
            if (path.basename(String(destination)) === 'l2-store.arc') {
                entered.resolve();
                await resume.promise;
            }
            await rename(source, destination);
        });
        const first = cache.flushAsync();
        await entered.promise;
        cache.writeL2('config', 'hash', 'src/new.ts', { issues: [] });
        cache.writeL2('config', 'other', 'src/b.ts', { issues: [] });
        resume.resolve();
        await first;
        await cache.flushAsync();
        expect(store().lookupL2('config', 'hash')?.p).toBe('src/new.ts');
        expect(store().lookupL2('config', 'other')?.p).toBe('src/b.ts');
    });

    it.each([false, true])('persists L2 eviction, synchronous=%s', async (synchronous) => {
        const cache = new CacheStore(path.join(directory, 'cache'), directory, { maxEntries: 1 });
        cache.writeL2('config', 'old', 'src/old.ts', { issues: [] });
        await cache.flushAsync();
        cache.writeL2('config', 'new', 'src/new.ts', { issues: [] });
        if (synchronous) cache.flush();
        else await cache.flushAsync();
        expect(cache.lookupL2('config', 'old')).toBeNull();
        const reloaded = store();
        expect(reloaded.lookupL2('config', 'old')).toBeNull();
        expect(reloaded.lookupL2('config', 'new')?.p).toBe('src/new.ts');
    });

    it.each([false, true])(
        'keeps eviction during an active writer, fail-first=%s',
        async (failFirst) => {
            const cache = new CacheStore(path.join(directory, 'cache'), directory, {
                maxEntries: 1,
            });
            cache.writeL2('config', 'old', 'src/old.ts', { issues: [] });
            const entered = deferred();
            const resume = deferred();
            const rename = fs.promises.rename.bind(fs.promises);
            let paused = false;
            vi.spyOn(fs.promises, 'rename').mockImplementation(async (source, destination) => {
                if (!paused && path.basename(String(destination)) === 'l2-store.arc') {
                    paused = true;
                    entered.resolve();
                    await resume.promise;
                    if (failFirst) throw new Error('injected L2 publication failure');
                }
                await rename(source, destination);
            });
            const first = cache.flushAsync();
            await entered.promise;
            cache.writeL2('config', 'new', 'src/new.ts', { issues: [] });
            cache.cleanupIfNeeded();
            resume.resolve();
            await first;
            await cache.flushAsync();
            expect(cache.lastFlushError).toBeUndefined();
            const reloaded = store();
            expect(reloaded.lookupL2('config', 'old')).toBeNull();
            expect(reloaded.lookupL2('config', 'new')?.p).toBe('src/new.ts');
        },
    );

    it('preserves undecoded diagnostic payloads in the eviction compatibility snapshot', async () => {
        const issue: Issue = {
            id: 'diagnostic-preserved',
            analyzer: 'example',
            rule: 'example',
            severity: 'warning',
            message: 'preserved diagnostic',
            detail: { sample: 123 },
            location: {
                file: 'src/keep.ts',
                start: { line: 1, column: 1 },
                end: { line: 1, column: 2 },
            },
        };
        const first = store();
        first.writeL2('config', 'old', 'src/old.ts', { issues: [] });
        first.writeL2('config', 'keep', 'src/keep.ts', { issues: [issue] });
        await first.flushAsync();
        const cache = new CacheStore(path.join(directory, 'cache'), directory, { maxEntries: 2 });
        cache.writeL2('config', 'new', 'src/new.ts', { issues: [] });
        await cache.flushAsync();
        expect(cache.lastFlushError).toBeUndefined();
        fs.writeFileSync(path.join(directory, 'cache', 'l2-store.arc'), 'invalid binary cache');
        expect(store().lookupL2('config', 'keep')?.issues).toEqual([issue]);
    });

    it('does not run overlapping asynchronous writers', async () => {
        const cache = store();
        cache.writeL1('src/a.ts', { mtimeMs: 1, size: 1 });
        const entered = deferred();
        const resume = deferred();
        const write = persistence.writeFileAtomicAsync;
        let active = 0;
        let peak = 0;
        vi.spyOn(persistence, 'writeFileAtomicAsync').mockImplementation(async (...args) => {
            active++;
            peak = Math.max(peak, active);
            entered.resolve();
            await resume.promise;
            try {
                await write(...args);
            } finally {
                active--;
            }
        });
        const first = cache.flushAsync();
        await entered.promise;
        cache.writeL1('src/b.ts', { mtimeMs: 2, size: 2 });
        const second = cache.flushAsync();
        resume.resolve();
        await Promise.all([first, second]);
        expect(peak).toBe(1);
        expect(store().lookupL1('src/b.ts')).toMatchObject({ mtimeMs: 2, size: 2 });
    });
});
