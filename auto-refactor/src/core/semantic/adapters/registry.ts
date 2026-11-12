/**
 * Module: Core Engine — Semantic Language Adapter Registry
 * File Path: src/core/semantic/adapters/registry.ts
 * Architecture Role: Central registry and dispatcher for multi-language semantic AST adapters,
 *   routing source files to their respective language extractors.
 * Dependencies & Triggers: Consumes UnifiedLanguageAdapter, TypeScriptSemanticAdapter,
 *   PythonSemanticAdapter, RustSemanticAdapter, GoSemanticAdapter, and GDScriptSemanticAdapter.
 * Responsibilities: Maintain extension-to-adapter resolution map, support dynamic registration,
 *   and execute graph population.
 * Exit Semantics & Design Rationale: Unknown languages return false; async extraction is awaited
 *   by callers and original extraction failures propagate instead of claiming graph completion.
 */

import { SemanticGraph } from '../semanticGraph';
import { SemanticAssetCache } from '../semantic-asset-cache';
import type { SemanticAssetCacheOptions, SemanticAssetCacheStats } from '../semantic-asset-cache';
import type { SemanticAdapterCapabilities, UnifiedLanguageAdapter } from './base';
import { TypeScriptSemanticAdapter } from './typescript-adapter';
import { PythonSemanticAdapter } from './python-adapter';
import {
    GoSemanticAdapter,
    GDScriptSemanticAdapter,
    RustSemanticAdapter,
} from './skeleton-adapters';

/**
 * Registry managing language adapters for unified semantic graph ingestion.
 */
export class SemanticAdapterRegistry {
    private readonly adapters: UnifiedLanguageAdapter[] = [];
    private readonly extensionMap: Map<string, UnifiedLanguageAdapter> = new Map();
    private readonly assets: SemanticAssetCache;

    public constructor(options: SemanticAssetCacheOptions = {}) {
        this.assets = new SemanticAssetCache(options);
        // Register default multi-language adapters in precedence order
        this.register(new TypeScriptSemanticAdapter());
        this.register(new PythonSemanticAdapter());
        this.register(new RustSemanticAdapter());
        this.register(new GoSemanticAdapter());
        this.register(new GDScriptSemanticAdapter());
    }

    /** Actual extraction-asset retention and reuse; never a review completion counter. */
    public get assetCacheStats(): SemanticAssetCacheStats {
        return this.assets.stats;
    }

    /**
     * Registers a new or custom language adapter.
     */
    public register(adapter: UnifiedLanguageAdapter): void {
        this.adapters.push(adapter);
        for (const ext of adapter.fileExtensions) {
            this.extensionMap.set(ext.toLowerCase(), adapter);
        }
    }

    /**
     * Resolves the appropriate language adapter for a given file path.
     */
    public getAdapterForFile(filePath: string): UnifiedLanguageAdapter | undefined {
        const lower = filePath.toLowerCase();
        for (const [ext, adapter] of this.extensionMap.entries()) {
            if (lower.endsWith(ext)) {
                return adapter;
            }
        }
        return undefined;
    }

    /**
     * Describe the resolved implementation without claiming it ran for any review.
     *
     * @param filePath - Source path used by the same extension resolution as actual extraction.
     * @returns Frozen declarations, or undefined for a language with no registered adapter.
     */
    public getCapabilitiesForFile(filePath: string): SemanticAdapterCapabilities | undefined {
        const adapter = this.getAdapterForFile(filePath);
        if (!adapter) return undefined;
        return Object.freeze({
            language: adapter.language,
            version: adapter.version ?? null,
            fileExtensions: Object.freeze([...adapter.fileExtensions]),
            graphExtraction: adapter.graphExtraction,
            supportsSlice: Boolean(
                (adapter as unknown as { supportsSlice?: boolean }).supportsSlice,
            ) as false,
        });
    }

    /**
     * Extract source-local facts off-graph, then publish only the latest successful file update.
     * The reservation is taken at call time, so this entry point orders requests by invocation.
     * @param filePath - Source path used for adapter resolution and publication ownership.
     * @param content - Exact source content consumed by the adapter.
     * @param graph - Published repository graph, unchanged while extraction is pending or fails.
     * @returns True on publication; false for an unsupported file or superseded extraction.
     */
    public extractFileToGraph(
        filePath: string,
        content: string,
        graph: SemanticGraph,
    ): boolean | Promise<boolean> {
        if (!this.getAdapterForFile(filePath)) return false;
        return this.publishFileUpdate(filePath, content, graph, graph.beginFileUpdate(filePath));
    }

    /**
     * Extract into an isolated graph under a reservation the caller already holds.
     * Callers reserve synchronously at request entry so later input resolution cannot reorder them.
     * @param filePath - Source path used for adapter resolution and publication ownership.
     * @param content - Exact source content consumed by the adapter.
     * @param graph - Published repository graph; untouched unless this token is still current.
     * @param token - Reservation issued by the same graph before any asynchronous work started.
     * @returns True on publication; false for an unsupported file or superseded extraction.
     */
    public publishFileUpdate(
        filePath: string,
        content: string,
        graph: SemanticGraph,
        token: symbol,
    ): boolean | Promise<boolean> {
        const adapter = this.getAdapterForFile(filePath);
        if (!adapter) return false;
        try {
            const key = this.assets.key(adapter, filePath, content);
            const cached = key ? this.assets.read(key) : undefined;
            if (cached) return graph.completeFileUpdate(filePath, token, cached);
            const replacement = new SemanticGraph();
            const publish = (): boolean => {
                if (key) this.assets.write(key, replacement);
                return graph.completeFileUpdate(filePath, token, replacement);
            };
            const extraction = adapter.extractToGraph(filePath, content, replacement);
            if (extraction) {
                return extraction.then(publish).catch((error) => {
                    graph.cancelFileUpdate(filePath, token);
                    throw error;
                });
            }
            return publish();
        } catch (error) {
            graph.cancelFileUpdate(filePath, token);
            throw error;
        }
    }

    /**
     * Lists all supported languages currently registered.
     */
    public getSupportedLanguages(): string[] {
        return Array.from(new Set(this.adapters.map((adapter) => adapter.language)));
    }

    /**
     * Lists all claimed file extensions.
     */
    public getSupportedExtensions(): string[] {
        return Array.from(this.extensionMap.keys());
    }
}

/**
 * Singleton instance of the default semantic adapter registry.
 */
export const defaultSemanticAdapterRegistry = new SemanticAdapterRegistry();
