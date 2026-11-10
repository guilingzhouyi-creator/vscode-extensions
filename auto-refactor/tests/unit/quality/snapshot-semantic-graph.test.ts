/**
 * Module: Review — Snapshot Semantic Graph Tests
 * File Path: tests/unit/quality/snapshot-semantic-graph.test.ts
 * Architecture Role: Falsify cross-snapshot graph mutation and missing-input impact claims.
 * Dependencies & Triggers: Real immutable executor, semantic extraction, SDK and scanner.
 * Responsibilities: Bind exact source and configuration, retain old readers and resolve local imports.
 * Exit Semantics & Design Rationale: Partial structural observations never establish zero impact.
 */
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDefaultConfig } from '../../../src/core/config/config';
import { captureSourceSnapshot } from '../../../src/core/review/source-snapshot';
import type { Scanner as ScannerType } from '../../../src/core/analyzer';
import type * as Executor from '../../../src/core/review/review-executor';

const require = createRequire(import.meta.url);
const { Scanner } = require('../../../dist/core/analyzer.js') as { Scanner: typeof ScannerType };
const { executeReview: executeCapturedReview } = require(
    '../../../dist/core/review/review-executor.js',
) as typeof Executor;
function executeReview(
    source: Parameters<typeof Executor.executeReview>[1],
    request: Parameters<typeof Executor.executeReview>[0],
    active: Executor.ReviewRuntime,
) {
    return executeCapturedReview(request, source, active);
}
const { PraxisReviewClient } = require('../../../dist/core/praxis/praxis-review-client.js');
function snapshot(files: Record<string, string>) {
    return captureSourceSnapshot({ repositoryId: 'semantic-snapshot',
        tree: { algorithm: 'git-sha1', value: 'b'.repeat(40) } },
    Object.entries(files).map(([path, content]) => {
        const bytes = Buffer.from(content);
        return { path, mode: '100644' as const, bytes, byteLength: bytes.length,
            object: { algorithm: 'git-sha1' as const,
                value: createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') } };
    }), { maxEntries: 16, maxBlobBytes: 65536, maxTotalBytes: 65536 });
}
function runtime() {
    const config = { ...getDefaultConfig(process.cwd()), root: process.cwd(), sparseRouting: false,
        bypassPreflight: true };
    config.cacheEnabled = false;
    config.archetype = 'library';
    config.workers = 1;
    config.analyzers = { performance: { enabled: true } };
    return { scanner: new Scanner(config), options: { forceFull: true } };
}
const files = {
    'src/a.ts': 'import { value } from "./b"; export function use() { return value; }',
    'src/b.ts': 'export const value = 1;',
};

afterEach(() => vi.restoreAllMocks());

describe('snapshot semantic graph generation', () => {
    it('binds graph to source and actual configuration and observes incoming module impact', async () => {
        const source = snapshot(files);
        const result = await executeReview(source, { requestId: 'graph-identity' }, runtime());
        expect(result.semanticGraph).toBeDefined();
        const graph = result.semanticGraph;
        expect(Object.isFrozen(graph)).toBe(true);
        expect(Reflect.set(graph, 'identity', { snapshot: 'forged' })).toBe(false);
        expect(graph.identity.snapshot).toEqual(source.identity);
        expect(graph.identity.configuration.status).toBe('bound');
        expect(graph.getFileImpact('src/b.ts')).toMatchObject({
            status: 'partial', files: ['src/a.ts', 'src/b.ts'],
        });
        expect(graph.coverage.status).toBe('partial');
    });

    it('preserves a local edge beside a bare package with the same normalized symbol', async () => {
        const result = await executeReview(snapshot({
            'src/a.ts': 'import { value } from "./b"; import { other } from "b";',
            'src/b.ts': 'export const value = 1;',
        }), { requestId: 'mixed-imports' }, runtime());
        expect(result.semanticGraph.getFileImpact('src/b.ts').files).toContain('src/a.ts');
        expect(result.semanticGraph.coverage.unresolvedEdges).toBeGreaterThan(0);
    });

    it('does not turn a bare package spelling into an existing local file', async () => {
        const result = await executeReview(snapshot({
            'src/a.ts': 'import { value } from "src/b.ts";',
            'src/b.ts': 'export const value = 1;',
        }), { requestId: 'bare-import' }, runtime());
        expect(result.semanticGraph.getFileImpact('src/b.ts').files).not.toContain('src/a.ts');
        expect(result.semanticGraph.coverage.unresolvedEdges).toBeGreaterThan(0);
    });

    it('retains a complete old view after deletion and rename in a later snapshot', async () => {
        const first = await executeReview(snapshot(files), { requestId: 'old' }, runtime());
        const oldNodes = first.semanticGraph.getNodesByFile('src/b.ts');
        const second = await executeReview(snapshot({
            'src/a.ts': 'import { value } from "./renamed"; export const use = value;',
            'src/renamed.ts': files['src/b.ts'],
        }), { requestId: 'new' }, runtime());
        expect(second.semanticGraph.identity.snapshot).not.toEqual(first.semanticGraph.identity.snapshot);
        expect(second.semanticGraph.getNodesByFile('src/b.ts')).toEqual([]);
        expect(second.semanticGraph.getFileImpact('src/renamed.ts').files).toContain('src/a.ts');
        expect(first.semanticGraph.getNodesByFile('src/b.ts')).toEqual(oldNodes);
        expect(first.semanticGraph.getFileImpact('src/b.ts').files).toContain('src/a.ts');
        const mutable = oldNodes[0];
        mutable.name = 'caller mutation';
        expect(first.semanticGraph.getNodesByFile('src/b.ts')[0].name).not.toBe('caller mutation');
    });

    it('keeps concurrent configuration generations and publication data isolated', async () => {
        const firstRuntime = runtime();
        const secondRuntime = runtime();
        secondRuntime.scanner.config.thresholds.complexityFail = 2;
        const source = snapshot(files);
        const [first, second] = await Promise.all([
            executeReview(source, { requestId: 'config-a' }, firstRuntime),
            executeReview(source, { requestId: 'config-b' }, secondRuntime),
        ]);
        expect(first.semanticGraph.identity.configuration).not.toEqual(
            second.semanticGraph.identity.configuration,
        );
        const copy = first.semanticGraph.createMutableGraph();
        copy.removeFile('src/a.ts');
        expect(first.semanticGraph.getNodesByFile('src/a.ts').length).toBeGreaterThan(0);
        expect(second.semanticGraph.getNodesByFile('src/a.ts').length).toBeGreaterThan(0);
    });

    it('reports configuration mutation during execution as superseded', async () => {
        const activeRuntime = runtime();
        const pending = executeReview(snapshot(files), { requestId: 'config-drift' }, activeRuntime);
        activeRuntime.scanner.config.thresholds.complexityFail = 1;
        const result = await pending;
        expect(result.completion.status).toBe('superseded');
        expect(result.semanticGraph.coverage.reason).toBe('configuration-changed');
    });

    it('keeps missing graph coverage unknown and bounded scopes explicitly partial', async () => {
        const source = snapshot(files);
        const result = await executeReview(source, {
            requestId: 'scoped', scope: ['src/a.ts'],
        }, runtime());
        expect(result.semanticGraph.getFileImpact('src/b.ts')).toMatchObject({
            status: 'unknown', files: [],
        });
        expect(result.semanticGraph.coverage).toMatchObject({ status: 'partial', reason: 'partial-scope' });
        const unsupported = await executeReview(snapshot({ 'readme.txt': 'plain text' }), {
            requestId: 'no-adapter', requirements: [],
        }, runtime());
        expect(unsupported.semanticGraph.getFileImpact('readme.txt').status).toBe('unknown');
    });

    it('keeps a newer SDK graph when an older snapshot finishes after it', async () => {
        const { defaultSemanticAdapterRegistry } = require(
            '../../../dist/core/semantic/adapters/registry.js',
        );
        const original = defaultSemanticAdapterRegistry.extractFileToGraph.bind(
            defaultSemanticAdapterRegistry,
        );
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        vi.spyOn(defaultSemanticAdapterRegistry, 'extractFileToGraph').mockImplementationOnce(
            async (...args) => { await gate; return original(...args); },
        );
        const client = new PraxisReviewClient({ root: process.cwd(), enableMoE: false });
        const older = client.reviewSnapshot({ requestId: 'sdk-old' }, snapshot(files),
            runtime().scanner.config);
        await client.reviewSnapshot({ requestId: 'sdk-new' }, snapshot({
            'src/latest.ts': 'export const latest = 1;',
        }), runtime().scanner.config);
        release();
        await older;
        expect(client.semanticGraph.getNodesByFile('src/latest.ts').length).toBeGreaterThan(0);
        expect(client.semanticGraph.getNodesByFile('src/b.ts')).toEqual([]);
    });

    it('publishes SDK snapshot graphs by replacement and keeps existing readers intact', async () => {
        const client = new PraxisReviewClient({ root: process.cwd(), enableMoE: false });
        const first = await client.reviewSnapshot(
            { requestId: 'sdk-first' }, snapshot(files), runtime().scanner.config,
        );
        const reader = client.semanticGraph;
        expect(reader.getNodesByFile('src/b.ts').length).toBeGreaterThan(0);
        await client.reviewSnapshot({ requestId: 'sdk-next' }, snapshot({
            'src/new.ts': 'export const next = 1;',
        }), runtime().scanner.config);
        expect(client.semanticGraph.getNodesByFile('src/b.ts')).toEqual([]);
        expect(client.semanticGraph.getNodesByFile('src/new.ts').length).toBeGreaterThan(0);
        expect(reader.getNodesByFile('src/b.ts').length).toBeGreaterThan(0);
        expect(first.semanticGraph.getNodesByFile('src/b.ts').length).toBeGreaterThan(0);
    });
});
