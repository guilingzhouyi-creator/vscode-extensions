/**
 * Module: Review — Semantic Asset Reuse Tests
 * File Path: tests/unit/quality/semantic-asset-cache.test.ts
 * Architecture Role: Exercise bounded reuse through the production semantic registry.
 * Dependencies & Triggers: Vitest, real TypeScript extraction and isolated file publications.
 * Responsibilities: Reject cross-version reuse, shared mutation, failed assets and unbounded retention.
 * Exit Semantics & Design Rationale: Structural reuse establishes no review or graph coverage claim.
 */
import { describe, expect, it, vi } from 'vitest';
import { SemanticAdapterRegistry } from '../../../src/core/semantic/adapters/registry';
import { UnifiedLanguageAdapter } from '../../../src/core/semantic/adapters/base';
import { SemanticGraph } from '../../../src/core/semantic/semanticGraph';

const source = 'export function oldName() { return 1; }';
async function extractFile(registry: SemanticAdapterRegistry, path: string, text: string) {
    const graph = new SemanticGraph();
    await registry.extractFileToGraph(path, text, graph);
    return graph;
}
class MutableFixture extends UnifiedLanguageAdapter {
    readonly language = 'asset-fixture';
    readonly fileExtensions = ['.asset-fixture'];
    override version: string | undefined = '1';
    override assetGeneration: string | undefined = 'fixture-assets-v1';
    calls = 0;
    fail = false;
    extractToGraph(file: string, content: string, graph: SemanticGraph): void {
        this.calls++;
        graph.addNode({ id: `${file}:${content}`, kind: 'module', language: this.language,
            name: content, location: { file, start: { line: 1, column: 0 },
                end: { line: 1, column: content.length } }, metrics: {}, attributes: {} });
        if (this.fail) throw new Error('asset extraction failed');
    }
}

describe('semantic extraction assets', () => {
    it('reuses actual extraction while keeping every publication detached', async () => {
        const registry = new SemanticAdapterRegistry();
        const adapter = registry.getAdapterForFile('src/a.ts')!;
        const extract = vi.spyOn(adapter, 'extractToGraph');
        const first = (await extractFile(registry, 'src/a.ts', source))!;
        const firstData = structuredClone(first.toJSON());
        const second = (await extractFile(registry, 'src/a.ts', source))!;
        expect(extract).toHaveBeenCalledTimes(1);
        expect(second.toJSON()).toEqual(firstData);
        first.getAllNodes().forEach(node => { node.name = 'caller mutation'; });
        first.removeFile('src/a.ts');
        const third = (await extractFile(registry, 'src/a.ts', source))!;
        expect(third.toJSON()).toEqual(firstData);
        expect(second.toJSON()).toEqual(firstData);
        expect(registry.assetCacheStats).toMatchObject({ entries: 1, hits: 2, misses: 1 });
        extract.mockRestore();
    });

    it('separates paths, exact content, adapter identity and declared extraction version', async () => {
        const registry = new SemanticAdapterRegistry();
        const first = new MutableFixture();
        registry.register(first);
        await extractFile(registry, 'a.asset-fixture', 'Aa');
        await extractFile(registry, 'a.asset-fixture', 'BB');
        await extractFile(registry, 'b.asset-fixture', 'Aa');
        first.version = '2';
        await extractFile(registry, 'a.asset-fixture', 'Aa');
        expect(first.calls).toBe(4);
        const replacement = new MutableFixture();
        registry.register(replacement);
        await extractFile(registry, 'a.asset-fixture', 'Aa');
        expect(replacement.calls).toBe(1);
        replacement.version = undefined;
        await extractFile(registry, 'a.asset-fixture', 'Aa');
        await extractFile(registry, 'a.asset-fixture', 'Aa');
        expect(replacement.calls).toBe(3);
    });

    it('requires a dependency generation and invalidates assets when that generation changes', async () => {
        const registry = new SemanticAdapterRegistry();
        const adapter = new MutableFixture();
        adapter.assetGeneration = undefined;
        registry.register(adapter);
        await extractFile(registry, 'a.asset-fixture', 'same');
        await extractFile(registry, 'a.asset-fixture', 'same');
        expect(adapter.calls).toBe(2);
        adapter.assetGeneration = 'config-v1';
        await extractFile(registry, 'a.asset-fixture', 'same');
        await extractFile(registry, 'a.asset-fixture', 'same');
        expect(adapter.calls).toBe(3);
        adapter.assetGeneration = 'config-v2';
        await extractFile(registry, 'a.asset-fixture', 'same');
        expect(adapter.calls).toBe(4);
        expect(registry.assetCacheStats.hits).toBe(1);
    });

    it('evicts least recently used assets and does not cache failed extraction', async () => {
        const registry = new SemanticAdapterRegistry({ maxEntries: 2, maxBytes: 16384 });
        const adapter = new MutableFixture();
        registry.register(adapter);
        for (const content of ['a', 'b', 'a', 'c', 'b']) {
            await extractFile(registry, 'a.asset-fixture', content);
        }
        expect(adapter.calls).toBe(4);
        expect(registry.assetCacheStats).toMatchObject({ entries: 2, hits: 1, evictions: 2 });
        adapter.fail = true;
        await expect(extractFile(registry, 'a.asset-fixture', 'failed')).rejects.toThrow(
            'asset extraction failed',
        );
        adapter.fail = false;
        await extractFile(registry, 'a.asset-fixture', 'failed');
        expect(adapter.calls).toBe(6);
    });

    it('keeps a cached newer publication when an older async extraction finishes late', async () => {
        const registry = new SemanticAdapterRegistry();
        const adapter = new MutableFixture();
        let release!: () => void;
        const pending = new Promise<void>(resolve => { release = resolve; });
        const original = adapter.extractToGraph.bind(adapter);
        vi.spyOn(adapter, 'extractToGraph').mockImplementation((file, text, graph) => {
            original(file, text, graph);
            if (text === 'slow') return pending;
        });
        registry.register(adapter);
        const graph = new SemanticGraph();
        await registry.extractFileToGraph('a.asset-fixture', 'cached', graph);
        const older = registry.extractFileToGraph('a.asset-fixture', 'slow', graph);
        expect(registry.extractFileToGraph('a.asset-fixture', 'cached', graph)).toBe(true);
        const version = graph.getFileVersion('a.asset-fixture')!;
        release();
        expect(await older).toBe(false);
        expect(graph.isFileVersionCurrent('a.asset-fixture', version)).toBe(true);
        expect(graph.getAllNodes().map(node => node.name)).toEqual(['cached']);
        expect(adapter.calls).toBe(2);
        expect(registry.assetCacheStats.hits).toBe(1);
    });

    it('distinguishes unpaired UTF-16 surrogates that UTF-8 replacement would merge', async () => {
        const registry = new SemanticAdapterRegistry();
        const adapter = new MutableFixture();
        registry.register(adapter);
        for (const text of ['\ud800', '\ud801', '\ud800']) {
            const graph = await extractFile(registry, 'a.asset-fixture', text);
            expect(graph.getAllNodes()[0].name).toBe(text);
        }
        expect(adapter.calls).toBe(2);
        expect(registry.assetCacheStats.hits).toBe(1);
    });

    it('evicts by byte budget even when the entry budget has room', async () => {
        const probe = new SemanticAdapterRegistry();
        probe.register(new MutableFixture());
        await extractFile(probe, 'a.asset-fixture', 'a');
        const budget = probe.assetCacheStats.bytes;
        const registry = new SemanticAdapterRegistry({ maxEntries: 10, maxBytes: budget });
        const adapter = new MutableFixture();
        registry.register(adapter);
        for (const text of ['a', 'b', 'b']) await extractFile(registry, 'a.asset-fixture', text);
        expect(adapter.calls).toBe(2);
        expect(registry.assetCacheStats).toMatchObject({ entries: 1, evictions: 1, hits: 1 });
        expect(registry.assetCacheStats.bytes).toBeLessThanOrEqual(budget);
        await extractFile(registry, 'a.asset-fixture', 'a');
        expect(adapter.calls).toBe(3);
    });

    it('bounds serialized asset bytes and retains no oversized asset', async () => {
        const registry = new SemanticAdapterRegistry({ maxEntries: 2, maxBytes: 1 });
        const adapter = new MutableFixture();
        registry.register(adapter);
        await extractFile(registry, 'a.asset-fixture', 'a');
        await extractFile(registry, 'a.asset-fixture', 'a');
        expect(adapter.calls).toBe(2);
        expect(registry.assetCacheStats).toMatchObject({ entries: 0, bytes: 0, hits: 0 });
    });
});
