/**
 * Module: Review — Semantic File Publication Tests
 * File Path: tests/unit/quality/semantic-generation.test.ts
 * Architecture Role: Exercise actual registry extraction and shared graph publication boundaries.
 * Dependencies & Triggers: Vitest, semantic adapters, graph and the production SDK.
 * Responsibilities: Reject stale symbols, partial publication and late superseded extraction.
 * Exit Semantics & Design Rationale: A failed extraction cannot replace previously published facts.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fileInput from '../../../src/core/praxis/praxis-file-input';
import { UnifiedLanguageAdapter } from '../../../src/core/semantic/adapters/base';
import {
    SemanticAdapterRegistry, defaultSemanticAdapterRegistry,
} from '../../../src/core/semantic/adapters/registry';
import { SemanticGraph } from '../../../src/core/semantic/semanticGraph';
import { PraxisReviewClient } from '../../../src/core/praxis/praxis-review-client';

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    return { promise, resolve };
}
class DeferredAdapter extends UnifiedLanguageAdapter {
    readonly language = 'generation-fixture';
    readonly fileExtensions = ['.generation-fixture'];
    readonly first = deferred();
    readonly second = deferred();
    readonly failure = new Error('generation extraction failed');
    async extractToGraph(file: string, content: string, graph: SemanticGraph): Promise<void> {
        graph.addNode({
            id: `${file}:${content}`, language: this.language, kind: 'function', name: content,
            location: { file, start: { line: 1, column: 1 }, end: { line: 1, column: 2 } },
        });
        await (content === 'first' ? this.first.promise : this.second.promise);
        if (content === 'fail') throw this.failure;
    }
}
function fixture() {
    const registry = new SemanticAdapterRegistry();
    const adapter = new DeferredAdapter();
    registry.register(adapter);
    return { registry, adapter, graph: new SemanticGraph() };
}
afterEach(() => vi.restoreAllMocks());
describe('semantic file publication', () => {
    it('releases a failed input reservation while preserving the previous publication', async () => {
        const client = new PraxisReviewClient({ enableMoE: false });
        await client.reviewFile('src/a.ts', 'export function stable() {}', { useSparseMoE: false });
        const graph = client.semanticGraph;
        const version = graph.getFileVersion('src/a.ts')!;
        const failure = new Error('source read failed');
        vi.spyOn(fileInput, 'readPraxisFileContent').mockRejectedValueOnce(failure);
        await expect(client.reviewFile('src/a.ts', undefined, { useSparseMoE: false })).rejects.toBe(failure);
        expect(graph.isFileVersionCurrent('src/a.ts', version)).toBe(true);
        expect(graph.getNodesByFile('src/a.ts').some(node => node.name === 'stable')).toBe(true);
    });

    it('a failed older input cannot cancel a newer extraction reservation', async () => {
        const client = new PraxisReviewClient({ enableMoE: false });
        const slow = deferred();
        const original = fileInput.readPraxisFileContent;
        const failure = new Error('older source read failed');
        vi.spyOn(fileInput, 'readPraxisFileContent').mockImplementation(async (file, content, root) => {
            if (content === 'failure') { await slow.promise; throw failure; }
            return original(file, content, root);
        });
        const older = client.reviewFile('src/a.ts', 'failure', { useSparseMoE: false });
        const rejection = expect(older).rejects.toBe(failure);
        await client.reviewFile('src/a.ts', 'export function latest() {}', { useSparseMoE: false });
        const graph = client.semanticGraph;
        const version = graph.getFileVersion('src/a.ts')!;
        slow.resolve();
        await rejection;
        expect(graph.isFileVersionCurrent('src/a.ts', version)).toBe(true);
        expect(graph.getNodesByFile('src/a.ts').some(node => node.name === 'latest')).toBe(true);
    });

    it('orders SDK requests before asynchronous input resolution can reorder them', async () => {
        const slow = deferred();
        const original = fileInput.readPraxisFileContent;
        vi.spyOn(fileInput, 'readPraxisFileContent').mockImplementation(async (file, content, root) => {
            if (content?.includes('before')) await slow.promise;
            return original(file, content, root);
        });
        const client = new PraxisReviewClient({ enableMoE: false });
        const older = client.reviewFile('src/a.ts', 'export function before() {}', { useSparseMoE: false });
        await client.reviewFile('src/a.ts', 'export function after() {}', { useSparseMoE: false });
        slow.resolve();
        expect((await older).execution.status).toBe('superseded');
        expect(client.semanticGraph.getAllNodes().some(node => node.name === 'before')).toBe(false);
        expect(client.semanticGraph.getAllNodes().some(node => node.name === 'after')).toBe(true);
    });
    it('replaces old declarations and outgoing edges when a file is extracted again', async () => {
        const registry = new SemanticAdapterRegistry();
        const graph = new SemanticGraph();
        await registry.extractFileToGraph('src/a.ts',
            'import { target } from "./b"; export function removed() { target(); }', graph);
        expect(graph.getAllNodes().some(node => node.name === 'removed')).toBe(true);
        expect(graph.getAllEdges().length).toBeGreaterThan(0);
        await registry.extractFileToGraph('src/a.ts', 'export function current() {}', graph);
        expect(graph.getAllNodes().some(node => node.name === 'removed')).toBe(false);
        expect(graph.getAllNodes().some(node => node.name === 'current')).toBe(true);
        expect(graph.getAllEdges()).toEqual([]);
    });
    it('keeps inbound edges to retained symbols while removing edges to deleted symbols', async () => {
        const registry = new SemanticAdapterRegistry();
        const graph = new SemanticGraph();
        await registry.extractFileToGraph('src/a.ts',
            'export function keep() {} export function remove() {}', graph);
        const keep = graph.getAllNodes().find(node => node.name === 'keep')!;
        const remove = graph.getAllNodes().find(node => node.name === 'remove')!;
        graph.addEdge({ id: 'external-keep', fromNodeId: 'external', toNodeId: keep.id, kind: 'calls' });
        graph.addEdge({ id: 'external-remove', fromNodeId: 'external', toNodeId: remove.id, kind: 'calls' });
        await registry.extractFileToGraph('src/a.ts', 'export function keep() { return 1; }', graph);
        expect(graph.getIncomingEdges(keep.id).map(edge => edge.id)).toEqual(['external-keep']);
        expect(graph.getOutgoingEdges('external').map(edge => edge.id)).toEqual(['external-keep']);
    });
    it('does not expose partial writes while asynchronous extraction is still pending', async () => {
        const { registry, adapter, graph } = fixture();
        const pending = registry.extractFileToGraph('a.generation-fixture', 'first', graph);
        expect(graph.getAllNodes()).toEqual([]);
        adapter.first.resolve();
        expect(await pending).toBe(true);
        expect(graph.getAllNodes().map(node => node.name)).toEqual(['first']);
    });
    it('retains the latest requested version when an older extraction completes last', async () => {
        const { registry, adapter, graph } = fixture();
        const older = registry.extractFileToGraph('a.generation-fixture', 'first', graph);
        const newer = registry.extractFileToGraph('a.generation-fixture', 'second', graph);
        adapter.second.resolve();
        expect(await newer).toBe(true);
        adapter.first.resolve();
        expect(await older).toBe(false);
        expect(graph.getAllNodes().map(node => node.name)).toEqual(['second']);
    });
    it('keeps published data unchanged when an adapter writes and then rejects', async () => {
        const { registry, adapter, graph } = fixture();
        const first = registry.extractFileToGraph('a.generation-fixture', 'first', graph);
        adapter.first.resolve();
        await first;
        const failure = registry.extractFileToGraph('a.generation-fixture', 'fail', graph);
        adapter.second.resolve();
        await expect(failure).rejects.toBe(adapter.failure);
        expect(graph.getAllNodes().map(node => node.name)).toEqual(['first']);
    });
    it('prevents an extraction started before clear from repopulating the graph', async () => {
        const { registry, adapter, graph } = fixture();
        const pending = registry.extractFileToGraph('a.generation-fixture', 'first', graph);
        graph.clear();
        adapter.first.resolve();
        expect(await pending).toBe(false);
        expect(graph.getAllNodes()).toEqual([]);
    });
    it('removes a deleted file and invalidates its unfinished replacement', async () => {
        const { registry, adapter, graph } = fixture();
        const first = registry.extractFileToGraph('a.generation-fixture', 'first', graph);
        adapter.first.resolve();
        await first;
        const replacement = registry.extractFileToGraph('a.generation-fixture', 'second', graph);
        graph.removeFile('a.generation-fixture');
        adapter.second.resolve();
        expect(await replacement).toBe(false);
        expect(graph.getAllNodes()).toEqual([]);
    });
    it('clears old SDK declarations when the new file content is explicitly empty', async () => {
        const client = new PraxisReviewClient({ enableMoE: false });
        await client.reviewFile('src/a.ts', 'export function removed() {}', { useSparseMoE: false });
        await client.reviewFile('src/a.ts', '', { useSparseMoE: false });
        expect(client.semanticGraph.getAllNodes().some(node => node.name === 'removed')).toBe(false);
    });
    it('marks a late SDK result superseded instead of passing the current graph as its own', async () => {
        const adapter = new DeferredAdapter();
        defaultSemanticAdapterRegistry.register(adapter);
        const client = new PraxisReviewClient({ enableMoE: false });
        const first = client.reviewFile('a.generation-fixture', 'first', { useSparseMoE: false });
        // File input resolution yields once before extraction reserves its publication token.
        await Promise.resolve();
        const second = client.reviewFile('a.generation-fixture', 'second', { useSparseMoE: false });
        await Promise.resolve();
        adapter.second.resolve();
        await second;
        adapter.first.resolve();
        const older = await first;
        expect(older.execution.status).toBe('superseded');
        expect(older.status).toBe('blocked');
        expect(client.semanticGraph.getAllNodes().map(node => node.name)).toEqual(['second']);
    });
    it('updates the default SDK graph after declarations are renamed', async () => {
        const client = new PraxisReviewClient({ enableMoE: false });
        await client.reviewFile('src/a.ts', 'export function before() {}', { useSparseMoE: false });
        await client.reviewFile('src/a.ts', 'export function after() {}', { useSparseMoE: false });
        expect(client.semanticGraph.getAllNodes().some(node => node.name === 'before')).toBe(false);
        expect(client.semanticGraph.getAllNodes().some(node => node.name === 'after')).toBe(true);
    });
});
