/**
 * Module: L1 journal persistence regressions
 * File Path: tests/unit/quality/cache-l1-journal.test.ts
 * Architecture Role: Validate CacheStore migration and incremental persistence through public APIs.
 * Dependencies & Triggers: Vitest, real filesystem, CacheStore.
 * Responsibilities: Prove bounded writes, legacy loading, and torn-tail recovery after reload.
 * Exit Semantics & Design Rationale: Assertions compare persisted state rather than private maps.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CacheStore } from '../../../src/core/cache';
import { L1Journal } from '../../../src/core/cache-l1-journal';
import { serializeL1 } from '../../../src/core/cache-persistence';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const { CacheStore: BuiltCacheStore } = createRequire(import.meta.url)(
    '../../../dist/core/cache.js',
) as {
    CacheStore: typeof CacheStore;
};

let directory: string;
beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-l1-journal-'));
});
afterEach(() => {
    const relative = path.relative(os.tmpdir(), directory);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error('Invalid owned L1 journal test directory');
    }
    fs.rmSync(directory, { recursive: true, force: true });
});
function store(): CacheStore {
    return new CacheStore(path.join(directory, 'cache'), directory);
}

describe('incremental L1 persistence', () => {
    it('drains a background checkpoint with no additional dirty writes in the built runtime', async () => {
        const cache = new BuiltCacheStore(path.join(directory, 'built'), directory);
        cache.writeL1('initial.ts', { mtimeMs: 1, size: 1 });
        await cache.flushAsync();
        for (let index = 0; index < 20_000; index++) {
            cache.writeL1(`src/${index}-${'x'.repeat(50)}.ts`, { mtimeMs: index + 1, size: 1 });
        }
        await cache.flushAsync();
        await cache.settleAsync();
        expect(cache.lastFlushError).toBeUndefined();
        expect(fs.statSync(path.join(cache.dir, 'l1-delta.arwal')).size).toBeGreaterThan(0);
        expect(
            new BuiltCacheStore(path.join(directory, 'built'), directory).lookupL1('initial.ts'),
        ).toMatchObject({ mtimeMs: 1, size: 1 });
    });

    it('publishes a worker checkpoint without dropping later WAL generations', async () => {
        const journal = new L1Journal(directory, {
            checkpointBytes: 1,
            workerFile: fileURLToPath(
                new URL('../../../dist/core/cache-l1-checkpoint-worker.js', import.meta.url),
            ),
        });
        const state = new Map([['a.ts', { mtimeMs: 1, size: 1 }]]);
        const legacy = path.join(directory, 'fingerprints.jsonl');
        fs.writeFileSync(legacy, serializeL1(state).repeat(1000));
        await journal.appendAsync(state, state);
        state.set('b.ts', { mtimeMs: 2, size: 2 });
        fs.appendFileSync(legacy, serializeL1(new Map([['b.ts', state.get('b.ts')!]])));
        await journal.appendAsync([['b.ts', state.get('b.ts')!]], state);
        state.set('c.ts', { mtimeMs: 3, size: 3 });
        fs.appendFileSync(legacy, serializeL1(new Map([['c.ts', state.get('c.ts')!]])));
        await journal.appendAsync([['c.ts', state.get('c.ts')!]], state);
        await journal.waitForCheckpoint();
        const beforePublication = fs.readFileSync(journal.walPath);
        await journal.publishCheckpointAsync();
        expect(journal.lastError).toBeUndefined();
        const loaded = new Map();
        expect(new L1Journal(directory).load(loaded)).toBe(true);
        expect([...loaded]).toEqual([...state]);
        const legacyRows = fs
            .readFileSync(legacy, 'utf8')
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line));
        expect(legacyRows).toHaveLength(3);
        expect(legacyRows.map((row) => row.p).sort()).toEqual(['a.ts', 'b.ts', 'c.ts']);
        fs.writeFileSync(journal.walPath, beforePublication);
        const afterCrash = new Map();
        expect(new L1Journal(directory).load(afterCrash)).toBe(true);
        expect([...afterCrash]).toEqual([...state]);
    });

    it('keeps durable evidence when the checkpoint worker cannot start', async () => {
        const journal = new L1Journal(directory, {
            checkpointBytes: 1,
            workerFile: path.join(directory, 'absent-checkpoint-worker.js'),
        });
        const state = new Map([['a.ts', { mtimeMs: 1, size: 1 }]]);
        await journal.appendAsync(state, state);
        const checkpoint = fs.readFileSync(journal.checkpointPath);
        state.set('b.ts', { mtimeMs: 2, size: 2 });
        await journal.appendAsync([['b.ts', state.get('b.ts')!]], state);
        await journal.waitForCheckpoint();
        expect(journal.lastError).toBeDefined();
        expect(journal.busy).toBe(false);
        expect(fs.readFileSync(journal.checkpointPath)).toEqual(checkpoint);
        const loaded = new Map();
        expect(new L1Journal(directory).load(loaded)).toBe(true);
        expect([...loaded]).toEqual([...state]);
    });

    it('writes a single delta without replacing the complete checkpoint', async () => {
        const cache = store();
        for (let index = 0; index < 10_000; index++) {
            cache.writeL1(`src/${index}.ts`, { mtimeMs: index, size: 10 });
        }
        await cache.flushAsync();
        const checkpoint = path.join(cache.dir, 'l1-checkpoint.arcp');
        const before = fs.readFileSync(checkpoint);
        cache.writeL1('src/1.ts', { mtimeMs: 100_000, size: 20 });
        await cache.flushAsync();
        expect(fs.readFileSync(checkpoint)).toEqual(before);
        expect(fs.statSync(path.join(cache.dir, 'l1-delta.arwal')).size).toBeLessThan(256);
        const reloaded = store();
        expect(reloaded.lookupL1('src/1.ts')).toMatchObject({ mtimeMs: 100_000, size: 20 });
        expect(reloaded.lookupL1('src/9999.ts')).toMatchObject({ mtimeMs: 9999, size: 10 });
    });

    it('repairs a torn WAL tail before appending another generation', async () => {
        const cache = store();
        cache.writeL1('a.ts', { mtimeMs: 1, size: 1 });
        await cache.flushAsync();
        cache.writeL1('b.ts', { mtimeMs: 2, size: 2 });
        await cache.flushAsync();
        fs.appendFileSync(path.join(cache.dir, 'l1-delta.arwal'), Buffer.from([1, 2, 3]));
        const recovered = store();
        expect(recovered.lookupL1('b.ts')).toMatchObject({ mtimeMs: 2, size: 2 });
        recovered.writeL1('c.ts', { mtimeMs: 3, size: 3 });
        await recovered.flushAsync();
        expect(store().lookupL1('c.ts')).toMatchObject({ mtimeMs: 3, size: 3 });
    });
});
