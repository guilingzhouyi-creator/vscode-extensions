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

import type { SemanticGraph } from '../index';
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

    public constructor() {
        // Register default multi-language adapters in precedence order
        this.register(new TypeScriptSemanticAdapter());
        this.register(new PythonSemanticAdapter());
        this.register(new RustSemanticAdapter());
        this.register(new GoSemanticAdapter());
        this.register(new GDScriptSemanticAdapter());
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
            supportsSlice: false,
        });
    }

    /**
     * Extracts a file into the target SemanticGraph using the matching language adapter.
     *
     * @returns True after synchronous extraction, or a promise of completion for async adapters;
     *   false when no adapter is registered. Extraction failures retain their original errors.
     */
    public extractFileToGraph(
        filePath: string,
        content: string,
        graph: SemanticGraph,
    ): boolean | Promise<boolean> {
        const adapter = this.getAdapterForFile(filePath);
        if (!adapter) {
            return false;
        }
        const extraction = adapter.extractToGraph(filePath, content, graph);
        if (extraction) return extraction.then(() => true);
        return true;
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
