/**
 * Module: Review — Actual Semantic Adapter Completion Tests
 * File Path: tests/unit/quality/execution-coverage.test.ts
 * Architecture Role: Distinguish registration from completed asynchronous extraction.
 * Dependencies & Triggers: Vitest, semantic registry, graph, and the production Praxis SDK.
 * Responsibilities: Await real extraction, propagate rejection and retain unknown-language absence.
 * Exit Semantics & Design Rationale: A resolved review cannot race unfinished graph publication.
 */
import { setImmediate as yieldImmediate } from 'node:timers/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UnifiedLanguageAdapter } from '../../../src/core/semantic/adapters/base';
import { SemanticGraph } from '../../../src/core/semantic/semanticGraph';
import {
    SemanticAdapterRegistry, defaultSemanticAdapterRegistry,
} from '../../../src/core/semantic/adapters/registry';
import { PraxisReviewClient } from '../../../src/core/praxis/praxis-review-client';

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => { resolve = done; });
    return { promise, resolve };
}
class AsyncSemanticAdapter extends UnifiedLanguageAdapter {
    public readonly language = 'async-fixture';
    public readonly fileExtensions = ['.async-fixture'];
    public readonly ready = deferred();
    public readonly failure = new Error('async extraction failed');
    public shouldFail = false;

    public async extractToGraph(file: string, _content: string, graph: SemanticGraph) {
        await this.ready.promise;
        if (this.shouldFail) throw this.failure;
        graph.addNode(this.createModuleNode(file, 1));
    }
}
afterEach(() => vi.restoreAllMocks());

describe('actual semantic adapter execution', () => {
    it.each([
        ['a.ts', 'typescript', 'ast'], ['a.py', 'python', 'lexical'],
        ['a.rs', 'rust', 'lexical'], ['a.go', 'go', 'lexical'],
        ['a.gd', 'gdscript', 'lexical'],
    ])('declares the implemented graph precision for %s without claiming execution', (path, language, mode) => {
        const registry = new SemanticAdapterRegistry();
        const capabilities = registry.getCapabilitiesForFile(path);
        expect(capabilities).toMatchObject({
            language, graphExtraction: mode, version: language === 'typescript' ? '2' : '1',
            supportsSlice: false,
        });
        expect(capabilities).not.toHaveProperty('status');
        expect(Object.isFrozen(capabilities)).toBe(true);
        expect(Object.isFrozen(capabilities?.fileExtensions)).toBe(true);
    });

    it('keeps undeclared custom adapter capability and version unknown', () => {
        const registry = new SemanticAdapterRegistry();
        registry.register(new AsyncSemanticAdapter());
        expect(registry.getCapabilitiesForFile('a.async-fixture')).toMatchObject({
            graphExtraction: 'unspecified', version: null,
        });
        expect(registry.getCapabilitiesForFile('a.unknown-fixture')).toBeUndefined();
    });

    it('settles only after an async adapter publishes its graph', async () => {
        const registry = new SemanticAdapterRegistry();
        const adapter = new AsyncSemanticAdapter();
        registry.register(adapter);
        const graph = new SemanticGraph();
        const result = registry.extractFileToGraph('a.async-fixture', 'input', graph);
        try {
            expect(result).toBeInstanceOf(Promise);
            expect(graph.getAllNodes()).toHaveLength(0);
        } finally {
            adapter.ready.resolve();
        }
        await expect(result).resolves.toBe(true);
        expect(graph.getAllNodes()).toHaveLength(1);
    });

    it('propagates the original async failure instead of reporting successful extraction', async () => {
        const registry = new SemanticAdapterRegistry();
        const adapter = new AsyncSemanticAdapter();
        adapter.shouldFail = true;
        registry.register(adapter);
        adapter.ready.resolve();
        const result = registry.extractFileToGraph('a.async-fixture', '', new SemanticGraph());
        await expect(result).rejects.toBe(adapter.failure);
    });

    it('does not claim an extraction for an unregistered language', () => {
        const registry = new SemanticAdapterRegistry();
        expect(registry.extractFileToGraph('a.unknown-fixture', '', new SemanticGraph()))
            .toBe(false);
    });

    it('makes the SDK await extraction before consuming graph state', async () => {
        const adapter = new AsyncSemanticAdapter();
        vi.spyOn(defaultSemanticAdapterRegistry, 'getAdapterForFile').mockReturnValue(adapter);
        const client = new PraxisReviewClient();
        const graph = new SemanticGraph();
        let settled = false;
        const review = client.reviewFile('a.async-fixture', 'input', {
            graph, useSparseMoE: false,
        });
        void review.then(() => { settled = true; });
        try {
            await yieldImmediate();
            expect(settled).toBe(false);
            expect(graph.getAllNodes()).toHaveLength(0);
        } finally {
            adapter.ready.resolve();
            await review;
        }
        expect(graph.getAllNodes()).toHaveLength(1);
        const verdict = await review;
        expect(verdict.semanticCapabilities).toMatchObject({
            language: 'async-fixture', graphExtraction: 'unspecified', version: null,
        });
        expect(verdict.execution.status).not.toBe('complete');
    });
});
