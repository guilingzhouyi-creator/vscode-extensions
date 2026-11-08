/**
 * Module: L1 journal publication invariants
 * File Path: tests/unit/quality/cache-l1-publication.test.ts
 * Architecture Role: Exercise valid nonempty persistence through real journal operations.
 * Dependencies & Triggers: Vitest, filesystem, frame replay, and the compiled checkpoint worker.
 * Responsibilities: Cover initialization, compaction, old empty WALs, and interrupted repairs.
 * Exit Semantics & Design Rationale: Empty logical state still requires a verifiable durable format.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Fingerprint } from '../../../src/core/cache';
import { L1Journal } from '../../../src/core/cache-l1-journal';
import { encodeL1Frame, replayL1Frames } from '../../../src/core/cache-l1-wal';
import { parseL1Line, serializeL1 } from '../../../src/core/cache-persistence';

let directory: string;
beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-l1-publication-'));
});
afterEach(() => {
    vi.restoreAllMocks();
    const relative = path.relative(os.tmpdir(), directory);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error('Invalid owned publication test directory');
    }
    fs.rmSync(directory, { recursive: true, force: true });
});

function assertDurableState(state: Map<string, Fingerprint>): void {
    const journal = new L1Journal(directory);
    const loaded = new Map<string, Fingerprint>();
    expect(journal.load(loaded)).toBe(true);
    expect(loaded).toEqual(state);
    const bytes = fs.readFileSync(journal.walPath);
    expect(bytes.length).toBeGreaterThan(0);
    const replay = replayL1Frames(bytes, new Map());
    expect(replay.truncatedTail).toBe(false);
    expect(replay.validBytes).toBe(bytes.length);
    expect(replay.sequence).toBeGreaterThan(0);
}

describe('nonempty L1 publication', () => {
    it.each(['sync', 'async'] as const)('initializes a valid %s WAL', async (mode) => {
        const journal = new L1Journal(directory);
        const state = new Map([['a.ts', { mtimeMs: 1, size: 1 }]]);
        if (mode === 'sync') journal.appendSync(state, state);
        else await journal.appendAsync(state, state);
        assertDurableState(state);
    });

    it('compacts empty state synchronously and accepts the next generation', () => {
        const journal = new L1Journal(directory);
        const state = new Map<string, Fingerprint>();
        journal.checkpointSync(state);
        assertDurableState(state);
        state.set('later.ts', { mtimeMs: 2, size: 2 });
        journal.appendSync(state, state);
        assertDurableState(state);
        journal.checkpointSync(state);
        assertDurableState(state);
    });

    it.each([false, true])('migrates an old empty WAL with a missing file: %s', async (missing) => {
        const state = new Map([['a.ts', { mtimeMs: 1, size: 1 }]]);
        fs.writeFileSync(path.join(directory, 'l1-checkpoint.arcp'), encodeL1Frame(5, state));
        if (!missing) fs.writeFileSync(path.join(directory, 'l1-delta.arwal'), '');
        const journal = new L1Journal(directory);
        expect(journal.load(new Map())).toBe(true);
        await journal.publishCheckpointAsync();
        assertDurableState(state);
    });

    it('keeps a valid horizon if appending after a torn first frame fails', async () => {
        const state = new Map([['a.ts', { mtimeMs: 1, size: 1 }]]);
        fs.writeFileSync(path.join(directory, 'l1-checkpoint.arcp'), encodeL1Frame(5, state));
        fs.writeFileSync(path.join(directory, 'l1-delta.arwal'), Buffer.from('L1'));
        const journal = new L1Journal(directory);
        expect(journal.load(new Map())).toBe(true);
        const failure = new Error('Append unavailable');
        vi.spyOn(fs.promises, 'appendFile').mockRejectedValueOnce(failure);
        state.set('b.ts', { mtimeMs: 2, size: 2 });
        const deltas = [['b.ts', state.get('b.ts')!]] as const;
        await expect(journal.appendAsync(deltas, state)).rejects.toBe(failure);
        assertDurableState(new Map([['a.ts', { mtimeMs: 1, size: 1 }]]));
        await journal.appendAsync(deltas, state);
        assertDurableState(state);
    });

    it('publishes an empty worker checkpoint without empty WAL or fallback files', async () => {
        const journal = new L1Journal(directory, {
            checkpointBytes: 1,
            workerFile: fileURLToPath(
                new URL('../../../dist/core/cache-l1-checkpoint-worker.js', import.meta.url),
            ),
        });
        const state = new Map([['a.ts', { mtimeMs: 1, size: 1 }]]);
        const legacy = path.join(directory, 'fingerprints.jsonl');
        fs.writeFileSync(legacy, serializeL1(state));
        await journal.appendAsync(state, state);
        state.clear();
        await journal.appendAsync([['a.ts', null]], state);
        await journal.waitForCheckpoint();
        await journal.publishCheckpointAsync();
        expect(journal.lastError).toBeUndefined();
        expect(fs.statSync(legacy).size).toBeGreaterThan(0);
        const fallback = new Map<string, Fingerprint>();
        for (const line of fs.readFileSync(legacy, 'utf8').split('\n')) {
            parseL1Line(line, fallback);
        }
        expect(fallback.size).toBe(0);
        assertDurableState(state);
    });

    it('rejects an uncommitted migration horizon instead of losing fallback state', async () => {
        const older = new Map([['a.ts', { mtimeMs: 1, size: 1 }]]);
        const state = new Map(older);
        state.set('b.ts', { mtimeMs: 2, size: 2 });
        fs.writeFileSync(path.join(directory, 'l1-checkpoint.arcp'), encodeL1Frame(5, older));
        fs.writeFileSync(path.join(directory, 'l1-delta.arwal'), Buffer.alloc(40));
        fs.writeFileSync(path.join(directory, 'fingerprints.jsonl'), serializeL1(state));
        const journal = new L1Journal(directory);
        expect(journal.load(new Map())).toBe(false);
        const rename = fs.promises.rename.bind(fs.promises);
        vi.spyOn(fs.promises, 'rename').mockImplementation(async (source, destination) => {
            if (String(destination) === journal.checkpointPath) {
                throw new Error('Checkpoint publication interrupted');
            }
            await rename(source, destination);
        });
        await expect(journal.appendAsync(state, state)).rejects.toThrow('publication interrupted');
        expect(new L1Journal(directory).load(new Map())).toBe(false);
        const fallback = new Map<string, Fingerprint>();
        for (const line of fs.readFileSync(path.join(directory, 'fingerprints.jsonl'), 'utf8').split('\n')) {
            parseL1Line(line, fallback);
        }
        expect(fallback).toEqual(state);
    });

    it('serializes empty fallback state as a format record without creating fingerprints', () => {
        const bytes = serializeL1(new Map());
        expect(bytes.length).toBeGreaterThan(0);
        expect(JSON.parse(bytes)).toEqual({ t: 'l1-empty', v: 1 });
        const loaded = new Map<string, Fingerprint>();
        parseL1Line(bytes, loaded);
        expect(loaded.size).toBe(0);
    });
});
