/**
 * Module: Semantic — Bounded File Extraction Assets
 * File Path: src/core/semantic/semantic-asset-cache.ts
 * Architecture Role: Reuse language extraction without sharing mutable graph publications.
 * Dependencies & Triggers: Semantic graph data, Node crypto and versioned registry adapters.
 * Responsibilities: Bind exact text, path and extractor identity; enforce entry and byte budgets.
 * Exit Semantics & Design Rationale: Assets are structural IR, never findings, complete workspace
 *     coverage, Git object identities or configuration-bound review evidence.
 */
import { createHash, randomUUID } from 'node:crypto';
import { SemanticGraph } from './semanticGraph';
import type { SemanticEdge, SemanticNode } from './types';
import type { UnifiedLanguageAdapter } from './adapters/base';

const DEFAULT_MAX_ENTRIES = 128;
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;

/** Hard bounds for retained extraction assets; zero disables retention. */
export interface SemanticAssetCacheOptions {
    readonly maxEntries?: number;
    /** UTF-8 serialized IR bytes, not a claim about total process heap usage. */
    readonly maxBytes?: number;
}
/** Runtime observations of actual asset reuse and retained serialized data. */
export interface SemanticAssetCacheStats {
    readonly entries: number;
    readonly bytes: number;
    readonly hits: number;
    readonly misses: number;
    readonly evictions: number;
}
interface Asset {
    readonly nodes: SemanticNode[];
    readonly edges: SemanticEdge[];
    readonly bytes: number;
}

/** Owns detached extraction data; every successful read constructs a new graph instance. */
export class SemanticAssetCache {
    private readonly entries = new Map<string, Asset>();
    private readonly identities = new WeakMap<UnifiedLanguageAdapter, string>();
    private readonly maxEntries: number;
    private readonly maxBytes: number;
    private bytes = 0;
    private hits = 0;
    private misses = 0;
    private evictions = 0;

    constructor(options: SemanticAssetCacheOptions = {}) {
        this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
        this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
        if (
            !Number.isSafeInteger(this.maxEntries) ||
            this.maxEntries < 0 ||
            !Number.isSafeInteger(this.maxBytes) ||
            this.maxBytes < 0
        ) {
            throw new RangeError('Semantic asset budgets must be non-negative safe integers');
        }
    }

    /**
     * Bind exact input to an extractor that explicitly versions all extraction dependencies.
     * @param adapter - Registered implementation; absent dependency generations disable reuse.
     * @param path - Exact extraction path, since symbol identities depend on it.
     * @param content - Exact JavaScript string, including unpaired UTF-16 surrogates.
     * @returns Opaque in-process key, or undefined when retention is disabled or unversioned.
     */
    key(adapter: UnifiedLanguageAdapter, path: string, content: string): string | undefined {
        if (
            !adapter.version ||
            !adapter.assetGeneration ||
            this.maxEntries === 0 ||
            this.maxBytes === 0
        )
            return undefined;
        let identity = this.identities.get(adapter);
        if (!identity) {
            identity = randomUUID();
            this.identities.set(adapter, identity);
        }
        return createHash('sha256')
            .update(
                JSON.stringify([
                    identity,
                    adapter.version,
                    adapter.assetGeneration,
                    adapter.language,
                    adapter.graphExtraction,
                    path,
                ]),
            )
            .update('\0')
            .update(content, 'utf16le')
            .digest('hex');
    }

    /**
     * Restore detached graph data and promote a real LRU hit.
     * @param key - Captured versioned extraction identity.
     * @returns A fresh graph, or undefined when no reusable asset exists.
     */
    read(key: string): SemanticGraph | undefined {
        const asset = this.entries.get(key);
        if (!asset) {
            this.misses++;
            return undefined;
        }
        this.entries.delete(key);
        this.entries.set(key, asset);
        this.hits++;
        const graph = new SemanticGraph();
        const data = structuredClone({ nodes: asset.nodes, edges: asset.edges });
        for (const node of data.nodes) graph.addNode(node);
        for (const edge of data.edges) graph.addEdge(edge);
        return graph;
    }

    /**
     * Retain successful extraction only, with entry and serialized-byte LRU limits.
     * @param key - Captured versioned extraction identity.
     * @param graph - Completed off-publication extraction graph.
     */
    write(key: string, graph: SemanticGraph): void {
        const source = graph.toJSON();
        const bytes = Buffer.byteLength(JSON.stringify(source), 'utf8');
        if (bytes > this.maxBytes) return;
        const data = structuredClone(source);
        const previous = this.entries.get(key);
        if (previous) {
            this.bytes -= previous.bytes;
            this.entries.delete(key);
        }
        this.entries.set(key, { ...data, bytes });
        this.bytes += bytes;
        while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes) {
            const oldest = this.entries.entries().next().value;
            if (!oldest) break;
            this.entries.delete(oldest[0]);
            this.bytes -= oldest[1].bytes;
            this.evictions++;
        }
    }

    /** Detached counters; reading telemetry neither changes recency nor exposes cached objects. */
    get stats(): SemanticAssetCacheStats {
        return Object.freeze({
            entries: this.entries.size,
            bytes: this.bytes,
            hits: this.hits,
            misses: this.misses,
            evictions: this.evictions,
        });
    }
}
