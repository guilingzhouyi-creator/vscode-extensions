/**
 * Module: Review — Immutable Source Snapshot Tests
 * File Path: tests/unit/quality/source-snapshot.test.ts
 * Architecture Role: Verify byte identity and explicit non-text outcomes before analysis.
 * Dependencies & Triggers: Vitest, Node crypto, and the snapshot capture boundary.
 * Responsibilities: Prove isolation from mutable inputs, confinement, budgets and blob identity.
 * Exit Semantics & Design Rationale: Missing input cannot become successful empty text.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { captureSourceSnapshot } from '../../../src/core/review/source-snapshot';

const tree = { algorithm: 'git-sha1' as const, value: 'b'.repeat(40) };
const descriptor = { repositoryId: 'repository-1', tree };
const budget = { maxEntries: 20, maxBlobBytes: 1024, maxTotalBytes: 4096 };
function entry(
    path: string,
    text: string | Uint8Array,
    mode: '100644' | '100755' | '120000' = '100644',
) {
    const bytes = typeof text === 'string' ? Buffer.from(text) : Buffer.from(text);
    const value = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    return {
        path, mode, bytes, byteLength: bytes.length,
        object: { algorithm: 'git-sha1' as const, value },
    };
}

describe('immutable source snapshot', () => {
    it('copies captured bytes and never obtains content from later mutable input', () => {
        const source = entry('src/a.ts', 'const a = 1;');
        const snapshot = captureSourceSnapshot(descriptor, [source], budget);
        source.bytes.fill(0);
        const first = snapshot.read('src/a.ts', source.object);
        expect(first.kind).toBe('text');
        if (first.kind !== 'text') throw new Error('expected text');
        expect(first.content).toBe('const a = 1;');
        first.bytes.fill(0);
        expect(snapshot.read('src/a.ts')).toMatchObject({
            kind: 'text', content: 'const a = 1;',
        });
        expect(Object.isFrozen(snapshot.identity)).toBe(true);
        expect(Object.isFrozen(snapshot.entries)).toBe(true);
    });

    it('preserves empty files, executable modes, UTF-8 BOM and line endings', () => {
        const snapshot = captureSourceSnapshot(descriptor, [
            entry('empty.ts', '', '100755'), entry('文本.ts', '\ufeffa\r\nb\n'),
        ], budget);
        expect(snapshot.read('empty.ts')).toMatchObject({
            kind: 'text', content: '', mode: '100755', lineEnding: 'none',
        });
        expect(snapshot.read('文本.ts')).toMatchObject({
            kind: 'text', content: '\ufeffa\r\nb\n', bom: true, lineEnding: 'mixed',
        });
    });

    it('reports deleted paths as absent and renamed content only at its manifest path', () => {
        const source = entry('new.ts', 'same content');
        const snapshot = captureSourceSnapshot(descriptor, [source], budget);
        expect(snapshot.read('old.ts')).toEqual({
            kind: 'missing', path: 'old.ts', source: 'immutable-snapshot',
        });
        expect(snapshot.read('new.ts', source.object).kind).toBe('text');
        expect(() => snapshot.read('old.ts', source.object)).toThrow(/missing/i);
    });

    it('preserves binary, symlink, submodule and invalid UTF-8 states', () => {
        const snapshot = captureSourceSnapshot(descriptor, [
            entry('data.bin', Buffer.from([0, 1])),
            entry('alias.ts', '../outside.ts', '120000'),
            entry('invalid.ts', Buffer.from([0xff])),
            { path: 'vendor', mode: '160000', object: tree },
        ], budget);
        expect(snapshot.read('data.bin').kind).toBe('binary');
        expect(snapshot.read('alias.ts').kind).toBe('symlink');
        expect(snapshot.read('vendor').kind).toBe('submodule');
        expect(snapshot.read('invalid.ts')).toMatchObject({
            kind: 'unsupported', reason: 'invalid-utf8',
        });
    });

    it('rejects wrong declared bytes, lengths, and requested object identities', () => {
        const source = entry('a.ts', 'original');
        expect(() => captureSourceSnapshot(
            descriptor, [{ ...source, bytes: Buffer.from('changed!') }], budget,
        )).toThrow(/identity/i);
        expect(() => captureSourceSnapshot(
            descriptor, [{ ...source, byteLength: 1 }], budget,
        )).toThrow(/length/i);
        const snapshot = captureSourceSnapshot(descriptor, [source], budget);
        expect(() => snapshot.read('a.ts', tree)).toThrow(/identity/i);
        const declared = {
            ...descriptor, manifestDigest: { algorithm: 'sm3' as const, value: '0'.repeat(64) },
        };
        expect(() => captureSourceSnapshot(declared, [source], budget)).toThrow(/manifest/i);
    });

    it.each([
        '../x', '/x', 'C:' + '/x', 'a\\x', 'a/../x', 'a//x', './x',
        'a/./x', 'x/', 'a\0x', 'x. ', 'e\u0301.ts', '\ud800.ts',
    ])('rejects ambiguous or escaping path %j', (path) => {
        expect(() => captureSourceSnapshot(descriptor, [entry(path, '')], budget))
            .toThrow(/path/i);
    });

    it('rejects case collisions and file/directory collisions across manifest entries', () => {
        expect(() => captureSourceSnapshot(
            descriptor, [entry('A.ts', ''), entry('a.ts', '')], budget,
        )).toThrow(/collision/i);
        expect(() => captureSourceSnapshot(
            descriptor, [entry('src', ''), entry('src/a.ts', '')], budget,
        )).toThrow(/collision/i);
        const snapshot = captureSourceSnapshot(descriptor, [entry('a.ts', '')], budget);
        expect(() => snapshot.read('../a.ts')).toThrow(/path/i);
    });

    it('rejects directory spelling conflicts and non-portable filename characters', () => {
        expect(() => captureSourceSnapshot(
            descriptor, [entry('Src/a.ts', ''), entry('src/b.ts', '')], budget,
        )).toThrow(/collision/i);
        for (const path of ['a?b.ts', 'a*b.ts', 'a<b.ts', 'x|y.ts', 'x"y.ts']) {
            expect(() => captureSourceSnapshot(descriptor, [entry(path, '')], budget))
                .toThrow(/path/i);
        }
        const snapshot = captureSourceSnapshot(descriptor, [entry('😀.ts', '')], budget);
        expect(snapshot.read('😀.ts').kind).toBe('text');
    });

    it('produces a deterministic manifest digest and binds modes and paths', () => {
        const inputs = [entry('b.ts', 'b'), entry('a.ts', 'a')];
        const first = captureSourceSnapshot(descriptor, inputs, budget);
        const reversed = captureSourceSnapshot(descriptor, [...inputs].reverse(), budget);
        expect(reversed.identity).toEqual(first.identity);
        const changed = [entry('b.ts', 'b', '100755'), inputs[1]];
        const modeChanged = captureSourceSnapshot(descriptor, changed, budget);
        expect(modeChanged.identity.manifestDigest).not.toEqual(first.identity.manifestDigest);
        const shortTree = { ...descriptor, tree: { ...tree, value: 'short' } };
        expect(() => captureSourceSnapshot(shortTree, [], budget)).toThrow(/identity/i);
    });

    it('requires finite explicit entry, blob and total memory budgets', () => {
        const sources = [entry('a.ts', '123'), entry('b.ts', '456')];
        expect(() => captureSourceSnapshot(
            descriptor, sources, { ...budget, maxEntries: 1 },
        )).toThrow(/budget/i);
        expect(() => captureSourceSnapshot(
            descriptor, sources, { ...budget, maxBlobBytes: 2 },
        )).toThrow(/budget/i);
        expect(() => captureSourceSnapshot(
            descriptor, sources, { ...budget, maxTotalBytes: 5 },
        )).toThrow(/budget/i);
        expect(() => captureSourceSnapshot(
            descriptor, [], { ...budget, maxEntries: Infinity },
        )).toThrow(/budget/i);
    });
});
