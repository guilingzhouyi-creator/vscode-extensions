/**
 * Module: L1 delta journal format regressions
 * File Path: tests/unit/quality/cache-l1-wal.test.ts
 * Architecture Role: Exercise replay, corruption, and checkpoint generation boundaries.
 * Dependencies & Triggers: Vitest and the L1 journal codec.
 * Responsibilities: Verify bounded delta encoding, tombstones, and crash-prefix recovery.
 * Exit Semantics & Design Rationale: Invalid frames cannot silently become cache observations.
 */
import { describe, expect, it } from 'vitest';
import { encodeL1Frame, replayL1Frames } from '../../../src/core/cache-l1-wal';
import { computeBufferChecksum } from '../../../src/core/cache-arc2';
import type { Fingerprint } from '../../../src/core/cache';

const first: Fingerprint = { mtimeMs: 1, size: 10 };
const second: Fingerprint = { mtimeMs: 2, size: 20 };

describe('L1 delta journal framing', () => {
    it('distinguishes a versioned horizon from an ordinary empty batch', () => {
        const marker = encodeL1Frame(5, [], 'horizon');
        expect(marker.readUInt32LE(4)).toBe(2);
        expect(() => replayL1Frames(marker, new Map(), 4)).toThrow('horizon');
        expect(replayL1Frames(marker, new Map(), 5).sequence).toBe(5);
        const emptyBatch = encodeL1Frame(6, []);
        expect(emptyBatch.readUInt32LE(4)).toBe(1);
        expect(replayL1Frames(emptyBatch, new Map(), 5).sequence).toBe(6);
    });

    it('rejects a state-bearing horizon or a horizon after a batch', () => {
        expect(() => encodeL1Frame(2, [['a.ts', first]], 'horizon')).toThrow('horizon');
        const bytes = Buffer.concat([
            encodeL1Frame(1, [['a.ts', first]]), encodeL1Frame(2, [], 'horizon'),
        ]);
        const state = new Map<string, Fingerprint>();
        expect(() => replayL1Frames(bytes, state)).toThrow('horizon');
        expect(state.size).toBe(0);
    });

    it('replays ordered updates and tombstones after the checkpoint horizon', () => {
        const state = new Map([['src/a.ts', first]]);
        const bytes = Buffer.concat([
            encodeL1Frame(1, [['src/a.ts', first]]),
            encodeL1Frame(2, [
                ['src/a.ts', second],
                ['src/b.ts', first],
            ]),
            encodeL1Frame(3, [['src/b.ts', null]]),
        ]);
        const replay = replayL1Frames(bytes, state, 1);
        expect([...state]).toEqual([['src/a.ts', second]]);
        expect(replay.sequence).toBe(3);
        expect(replay.validBytes).toBe(bytes.length);
        expect(replay.truncatedTail).toBe(false);
    });

    it('keeps only complete batches after every possible torn-tail boundary', () => {
        const prefix = encodeL1Frame(1, [['a.ts', first]]);
        const tail = encodeL1Frame(2, [['b.ts', second]]);
        for (let count = 1; count < tail.length; count++) {
            const state = new Map<string, Fingerprint>();
            const replay = replayL1Frames(Buffer.concat([prefix, tail.subarray(0, count)]), state);
            expect([...state]).toEqual([['a.ts', first]]);
            expect(replay.validBytes).toBe(prefix.length);
            expect(replay.truncatedTail).toBe(true);
        }
    });

    it('rejects corrupt complete frames without partially applying the journal', () => {
        const state = new Map([['existing.ts', first]]);
        const prefix = encodeL1Frame(1, [['a.ts', first]]);
        const corrupt = encodeL1Frame(2, [['b.ts', second]]);
        corrupt[corrupt.length - 1] ^= 1;
        expect(() => replayL1Frames(Buffer.concat([prefix, corrupt]), state)).toThrow(/checksum/i);
        expect([...state]).toEqual([['existing.ts', first]]);
    });

    it('rejects reordered and duplicated journal generations', () => {
        const frame = encodeL1Frame(2, [['a.ts', first]]);
        expect(() => replayL1Frames(Buffer.concat([frame, frame]), new Map())).toThrow(/sequence/i);
        expect(() =>
            replayL1Frames(Buffer.concat([frame, encodeL1Frame(1, [['a.ts', second]])]), new Map()),
        ).toThrow(/sequence/i);
    });

    it('encodes a single delta without traversing the unchanged state', () => {
        let visits = 0;
        const delta: Iterable<readonly [string, Fingerprint | null]> = {
            *[Symbol.iterator]() {
                visits++;
                yield ['a.ts', second] as const;
            },
        };
        const bytes = encodeL1Frame(1, delta);
        expect(visits).toBe(1);
        expect(bytes.length).toBeLessThan(256);
    });

    it.each([NaN, Infinity, -1, 1.5])('rejects invalid generation %s', (sequence) => {
        expect(() => encodeL1Frame(sequence, [['a.ts', first]])).toThrow(/sequence/i);
    });

    it('rejects a corrupted length header instead of mistaking it for a torn tail', () => {
        const frame = encodeL1Frame(1, [['a.ts', first]]);
        frame.writeUInt32LE(frame.length + 100, 16);
        const state = new Map<string, Fingerprint>();
        expect(() => replayL1Frames(frame, state)).toThrow(/header|checksum/i);
        expect(state.size).toBe(0);
    });

    it('rejects malformed fingerprints and unsafe frame lengths', () => {
        expect(() => encodeL1Frame(1, [['a.ts', { mtimeMs: NaN, size: 1 }]])).toThrow();
        const bytes = encodeL1Frame(1, [['a.ts', first]]);
        bytes.writeUInt32LE(0xffffffff, 16);
        bytes.writeUInt32LE(computeBufferChecksum(bytes, 0, 24), 24);
        expect(() => replayL1Frames(bytes, new Map())).toThrow(/length|size/i);
    });
});
