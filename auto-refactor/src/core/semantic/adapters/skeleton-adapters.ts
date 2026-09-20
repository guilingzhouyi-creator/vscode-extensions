/**
 * Module: Core Engine — Multi-Language Semantic Adapter Skeletons
 * File Path: src/core/semantic/adapters/skeleton-adapters.ts
 * Architecture Role: Provides production-ready adapter implementations for Rust, Go,
 *   and GDScript, ensuring uniform topological extraction into the SemanticGraph.
 * Dependencies & Triggers: Extends UnifiedLanguageAdapter from ./base.
 * Responsibilities: Parse declarations and dependencies for systems, backend, and game
 *   scripting languages.
 * Exit Semantics & Design Rationale: Standardized inductive regex parsers allow instant
 *   graph generation without requiring platform-native compiler toolchains.
 */

import type { SemanticGraph } from '../index';
import { UnifiedLanguageAdapter } from './base';
import { buildCanonicalSymbolId, normalizeCanonicalPath } from './path-utils';

/**
 * Semantic adapter for Rust language source files (.rs).
 */
export class RustSemanticAdapter extends UnifiedLanguageAdapter {
    public readonly language = 'rust';
    public readonly fileExtensions = ['.rs'];

    public extractToGraph(filePath: string, content: string, graph: SemanticGraph): void {
        const canonicalFile = normalizeCanonicalPath(filePath);
        const lines = content.split(/\r?\n/);
        const moduleNode = this.createModuleNode(canonicalFile, lines.length);
        graph.addNode(moduleNode);

        for (let i = 0; i < lines.length; i++) {
            const lineNum = i + 1;
            const trimmed = lines[i].trim();

            // Match 'use crate::...' or 'use std::...'
            const useMatch = /^use\s+([A-Za-z0-9_:]+)/.exec(trimmed);
            if (useMatch) {
                const depMod = buildCanonicalSymbolId(this.language, useMatch[1], 'module');
                graph.addEdge(this.createDependencyEdge(moduleNode.id, depMod));
                continue;
            }

            // Match 'struct Foo'
            const structMatch = /^(?:pub\s+)?struct\s+([A-Za-z0-9_]+)/.exec(trimmed);
            if (structMatch) {
                const node = this.createTypeNode(canonicalFile, structMatch[1], {
                    file: canonicalFile,
                    start: { line: lineNum, column: 1 },
                    end: { line: lineNum, column: 1 },
                });
                graph.addNode(node);
                continue;
            }

            // Match 'fn bar(...)'
            const fnMatch = /^(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z0-9_]+)/.exec(trimmed);
            if (fnMatch) {
                const fnName = fnMatch[1];
                const isAsync = trimmed.includes('async fn');
                const node = this.createFunctionNode(
                    canonicalFile,
                    fnName,
                    fnName,
                    {
                        file: canonicalFile,
                        start: { line: lineNum, column: 1 },
                        end: { line: lineNum, column: 1 },
                    },
                    { isAsync },
                );
                graph.addNode(node);
            }
        }
    }
}

/**
 * Semantic adapter for Go language source files (.go).
 */
export class GoSemanticAdapter extends UnifiedLanguageAdapter {
    public readonly language = 'go';
    public readonly fileExtensions = ['.go'];

    public extractToGraph(filePath: string, content: string, graph: SemanticGraph): void {
        const canonicalFile = normalizeCanonicalPath(filePath);
        const lines = content.split(/\r?\n/);
        const moduleNode = this.createModuleNode(canonicalFile, lines.length);
        graph.addNode(moduleNode);

        for (let i = 0; i < lines.length; i++) {
            const lineNum = i + 1;
            const trimmed = lines[i].trim();

            // Match 'import "..."'
            const importMatch = /^import\s+"([^"]+)"/.exec(trimmed);
            if (importMatch) {
                const depMod = buildCanonicalSymbolId(this.language, importMatch[1], 'module');
                graph.addEdge(this.createDependencyEdge(moduleNode.id, depMod));
                continue;
            }

            // Match 'type Foo struct' or 'type Bar interface'
            const typeMatch = /^type\s+([A-Za-z0-9_]+)\s+(?:struct|interface)/.exec(trimmed);
            if (typeMatch) {
                const node = this.createTypeNode(canonicalFile, typeMatch[1], {
                    file: canonicalFile,
                    start: { line: lineNum, column: 1 },
                    end: { line: lineNum, column: 1 },
                });
                graph.addNode(node);
                continue;
            }

            // Match 'func Foo(...)' or 'func (r *Receiver) Bar(...)'
            const funcMatch = /^func\s+(?:\([^)]+\)\s+)?([A-Za-z0-9_]+)\s*\(/.exec(trimmed);
            if (funcMatch) {
                const fnName = funcMatch[1];
                const node = this.createFunctionNode(
                    canonicalFile,
                    fnName,
                    fnName,
                    {
                        file: canonicalFile,
                        start: { line: lineNum, column: 1 },
                        end: { line: lineNum, column: 1 },
                    },
                    { isExported: /^[A-Z]/.test(fnName) },
                );
                graph.addNode(node);
            }
        }
    }
}

/**
 * Semantic adapter for Godot GDScript language source files (.gd).
 */
export class GDScriptSemanticAdapter extends UnifiedLanguageAdapter {
    public readonly language = 'gdscript';
    public readonly fileExtensions = ['.gd'];

    public extractToGraph(filePath: string, content: string, graph: SemanticGraph): void {
        const canonicalFile = normalizeCanonicalPath(filePath);
        const lines = content.split(/\r?\n/);
        const moduleNode = this.createModuleNode(canonicalFile, lines.length);
        graph.addNode(moduleNode);

        for (let i = 0; i < lines.length; i++) {
            const lineNum = i + 1;
            const trimmed = lines[i].trim();

            // Match 'extends Node' or 'extends "res://..."'
            const extendsMatch = /^extends\s+([A-Za-z0-9_]+|"res:\/\/[^"]+")/.exec(trimmed);
            if (extendsMatch) {
                const baseId = buildCanonicalSymbolId(
                    this.language,
                    canonicalFile,
                    extendsMatch[1],
                );
                graph.addEdge({
                    id: `inherits:${moduleNode.id}->${baseId}`,
                    fromNodeId: moduleNode.id,
                    toNodeId: baseId,
                    kind: 'inherits',
                });
                continue;
            }

            // Match 'func _ready():' or 'func custom_logic(val: int):'
            const funcMatch = /^func\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)/.exec(trimmed);
            if (funcMatch) {
                const fnName = funcMatch[1];
                const params = funcMatch[2]
                    ? funcMatch[2].split(',').filter((p) => p.trim().length > 0)
                    : [];
                const node = this.createFunctionNode(
                    canonicalFile,
                    fnName,
                    fnName,
                    {
                        file: canonicalFile,
                        start: { line: lineNum, column: 1 },
                        end: { line: lineNum, column: 1 },
                    },
                    { visibility: fnName.startsWith('_') ? 'private' : 'public' },
                    { parameterCount: params.length },
                );
                graph.addNode(node);
            }
        }
    }
}
