/**
 * Module: Review — Snapshot Scan Integration Tests
 * File Path: tests/unit/quality/snapshot-scan.test.ts
 * Architecture Role: Prove the production scanner consumes captured bytes without disk fallback.
 * Dependencies & Triggers: Vitest, the compiled scanner, and immutable source snapshots.
 * Responsibilities: Preserve source provenance and isolate snapshot runs from workspace state.
 * Exit Semantics & Design Rationale: Non-text and deleted entries remain explicit observations.
 */
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Scanner as ScannerType } from '../../../src/core/analyzer';
import { getDefaultConfig } from '../../../src/core/config/config';
import { CacheStore } from '../../../src/core/cache';
import { captureSourceSnapshot } from '../../../src/core/review/source-snapshot';

const { Scanner } = createRequire(import.meta.url)('../../../dist/core/analyzer.js') as {
    Scanner: typeof ScannerType;
};
const descriptor = {
    repositoryId: 'snapshot-scan',
    tree: { algorithm: 'git-sha1' as const, value: 'b'.repeat(40) },
};
const budget = { maxEntries: 20, maxBlobBytes: 4096, maxTotalBytes: 16384 };
function source(
    path: string,
    content: string | Uint8Array,
    mode: '100644' | '120000' = '100644',
) {
    const bytes = typeof content === 'string' ? Buffer.from(content) : Buffer.from(content);
    return {
        path, mode, bytes, byteLength: bytes.length,
        object: {
            algorithm: 'git-sha1' as const,
            value: createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'),
        },
    };
}
function scanner() {
    const config = getDefaultConfig();
    config.root = path.resolve('snapshot-root-that-does-not-exist');
    config.archetype = 'library';
    config.sparseRouting = false;
    config.cacheEnabled = false;
    config.analyzers = {};
    return new Scanner(config);
}
afterEach(() => vi.restoreAllMocks());

describe('snapshot scanner entry', () => {
    it('analyzes fixed content without discovery, disk reads or source fallback', async () => {
        const input = source('src/a.ts', 'export const answer = 42;');
        const snapshot = captureSourceSnapshot(descriptor, [input], budget);
        input.bytes.fill(0);
        const engine = scanner();
        const analysis = vi.spyOn(engine, 'runAnalyzers');
        const result = await engine.scanSnapshot(snapshot, ['src/a.ts', 'deleted.ts']);
        expect(analysis).toHaveBeenCalledWith('src/a.ts', 'export const answer = 42;', undefined, {
            observeExecution: true,
        });
        expect(result.execution).toMatchObject([{ path: 'src/a.ts' }]);
        expect(Object.isFrozen(result.execution)).toBe(true);
        expect(result.source).toBe('immutable-snapshot');
        expect(result.identity).toEqual(snapshot.identity);
        expect(result.inputs).toEqual([
            { path: 'src/a.ts', kind: 'text' },
            { path: 'deleted.ts', kind: 'missing' },
        ]);
        expect(result.fileMetrics.map((metric) => metric.file)).toEqual(['src/a.ts']);
    });

    it('reduces actual calls into snapshot-bound required file coverage', async () => {
        const snapshot = captureSourceSnapshot(descriptor, [source('src/a.ts', 'export const answer = 42;')], budget);
        const engine = scanner();
        engine.config.analyzers = { required: { enabled: true }, skipped: { enabled: true } };
        engine.config.bypassPreflight = true;
        const analyzer = { name: 'required', version: 1, analyze: () => [] };
        engine.plan = [{
            name: 'required', options: {}, instance: analyzer,
            factory: () => analyzer, modulePath: 'test-owned-analyzer',
        }];
        const result = await engine.scanSnapshot(snapshot);
        expect(result.coverage).toEqual([
            expect.objectContaining({
                path: 'src/a.ts', analyzer: 'required', required: true, capability: 'file-analysis',
                status: 'executed', observedVersion: 1, calls: 1,
            }),
            expect.objectContaining({
                path: 'src/a.ts', analyzer: 'skipped', required: true,
                status: 'supported', reason: 'analyzer-not-run', calls: 0,
            }),
        ]);
        expect(Object.isFrozen(result.coverage)).toBe(true);
        expect(Object.isFrozen(result.coverage[0])).toBe(true);
    });

    it('does not mutate policy declarations or activate disabled/undeclared analyzers', () => {
        const config = {
            ...getDefaultConfig(), root: process.cwd(), archetype: 'library',
            sparseRouting: true, cacheEnabled: false, logLevel: 'error' as const,
            analyzers: { constants: { enabled: false }, performance: { enabled: true } },
        };
        const declarations = structuredClone(config.analyzers);
        const engine = new Scanner(config);
        expect(config.analyzers).toEqual(declarations);
        expect(engine.plan.map((entry) => entry.name)).toEqual(['performance']);
    });

    it('retains requirements skipped by sparse routing', async () => {
        const config = {
            ...getDefaultConfig(), root: process.cwd(), archetype: 'library',
            sparseRouting: true, cacheEnabled: false, logLevel: 'error' as const,
        };
        config.analyzers['gdscript-game'] = { enabled: true };
        const requested = Object.entries(config.analyzers)
            .filter(([, declaration]) => declaration.enabled !== false).map(([name]) => name);
        const engine = new Scanner(config);
        const active = new Set(engine.plan.map((entry) => entry.name));
        const skipped = requested.filter((name) => !active.has(name));
        expect(skipped.length).toBeGreaterThan(0);
        const snapshot = captureSourceSnapshot(descriptor, [source('src/a.ts', 'export const answer = 42;')], budget);
        const result = await engine.scanSnapshot(snapshot);
        for (const analyzer of skipped) {
            expect(result.coverage).toContainEqual(expect.objectContaining({
                analyzer, required: true, status: 'supported', reason: 'analyzer-not-run', calls: 0,
            }));
        }
    });

    it('does not run text analyzers on non-text snapshot entries', async () => {
        const snapshot = captureSourceSnapshot(descriptor, [
            source('link.ts', '../outside.ts', '120000'),
            source('binary.ts', '\0binary'),
            source('invalid.ts', Buffer.from([0xff])),
            { path: 'vendor', mode: '160000', object: descriptor.tree },
        ], budget);
        const engine = scanner();
        const analysis = vi.spyOn(engine, 'runAnalyzers');
        const result = await engine.scanSnapshot(snapshot);
        expect(analysis).not.toHaveBeenCalled();
        expect(result.inputs.map((input) => input.kind).sort()).toEqual([
            'binary', 'submodule', 'symlink', 'unsupported',
        ]);
        expect(result.inputs.find((input) => input.kind === 'unsupported')).toMatchObject({
            reason: 'invalid-utf8',
        });
        expect(result.fileMetrics).toEqual([]);
    });

    it('requires a fresh scanner and blocks later mutable-workspace scans', async () => {
        const snapshot = captureSourceSnapshot(descriptor, [], budget);
        const engine = scanner();
        await engine.scanSnapshot(snapshot);
        await expect(engine.scanSnapshot(snapshot)).rejects.toThrow(/fresh/i);
        await expect(engine.scan()).rejects.toThrow(/snapshot/i);
        const cache = new CacheStore(undefined, undefined, { disabled: true });
        await expect(engine.scanWithCache({ cache })).rejects.toThrow(/snapshot/i);
        const diff = { cache, diffHints: new Map() };
        await expect(engine.scanWithDiff(diff)).rejects.toThrow(/snapshot/i);
        await expect(engine.runInProcess(['a.ts'], engine.config.root))
            .rejects.toThrow(/snapshot/i);
        const used = scanner();
        await used.runAnalyzers('old.ts', 'const old = 1;');
        await expect(used.scanSnapshot(snapshot)).rejects.toThrow(/fresh/i);
    });

    it('requires an explicit configuration with cache persistence disabled', async () => {
        const engine = scanner();
        engine.config.cacheEnabled = true;
        const snapshot = captureSourceSnapshot(descriptor, [], budget);
        await expect(engine.scanSnapshot(snapshot)).rejects.toThrow(/cache/i);
    });

    it('honors cancellation before analyzing any file and rejects duplicate scope', async () => {
        const snapshot = captureSourceSnapshot(descriptor, [
            source('a.ts', 'const a = 1;'),
        ], budget);
        const engine = scanner();
        const controller = new AbortController();
        controller.abort(new Error('cancelled snapshot'));
        engine.config.signal = controller.signal;
        await expect(engine.scanSnapshot(snapshot)).rejects.toThrow('cancelled snapshot');
        await expect(scanner().scanSnapshot(snapshot, ['a.ts', 'a.ts']))
            .rejects.toThrow(/duplicate/i);
    });
});
