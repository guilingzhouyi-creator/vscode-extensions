/**
 * Module: Core Engine — Semantic Language Adapter Registry
 * File Path: src/core/semantic/adapters/registry.ts
 * Architecture Role: Central registry and dispatcher for multi-language semantic AST adapters,
 *   routing source files to their respective language extractors.
 * Dependencies & Triggers: Consumes UnifiedLanguageAdapter, TypeScriptSemanticAdapter,
 *   PythonSemanticAdapter, RustSemanticAdapter, GoSemanticAdapter, and GDScriptSemanticAdapter.
 * Responsibilities: Maintain extension-to-adapter resolution map, support dynamic registration,
 *   and execute graph population.
 * Exit Semantics & Design Rationale: Returns boolean on extraction attempt without throwing,
 *   guaranteeing engine resilience even when unknown file types are encountered.
 */

import type { SemanticGraph } from '../index';
import type { UnifiedLanguageAdapter } from './base';
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
     * Extracts a file into the target SemanticGraph using the matching language adapter.
     *
     * @returns true if an adapter was found and extracted; false otherwise.
     */
    public extractFileToGraph(filePath: string, content: string, graph: SemanticGraph): boolean {
        const adapter = this.getAdapterForFile(filePath);
        if (!adapter) {
            return false;
        }
        adapter.extractToGraph(filePath, content, graph);
        return true;
    }

    /**
     * Lists all supported languages currently registered.
     */
    public getSupportedLanguages(): string[] {
        return Array.from(new Set(this.adapters.map((a) => a.language)));
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
