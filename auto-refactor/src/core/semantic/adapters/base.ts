/**
 * Module: Core Engine — Unified Language Adapter Base Contract
 * File Path: src/core/semantic/adapters/base.ts
 * Architecture Role: Abstract base class establishing contracts for mapping concrete
 *   programming language syntax trees to the language-agnostic SemanticGraph.
 * Dependencies & Triggers: Extends ./path-utils; consumes SemanticGraph, SemanticNode,
 *   and SemanticEdge from core/semantic.
 * Responsibilities: Provide file extension matching, canonical ID building, and standard
 *   node/edge factory helpers.
 * Exit Semantics & Design Rationale: Enforces strict separation between language-specific
 *   syntax extraction and universal topology construction, preventing dialect leakage.
 */

import type {
    EdgeContext,
    NodeAttributes,
    NodeLocation,
    NodeMetrics,
    SemanticEdge,
    SemanticNode,
} from '../types';
import type { SemanticGraph } from '../semanticGraph';
import { buildCanonicalSymbolId, normalizeCanonicalPath } from './path-utils';

/**
 * Universal contract for extracting language ASTs into the unified semantic graph.
 */
export abstract class UnifiedLanguageAdapter {
    /** Language family identifier (e.g. 'typescript', 'python', 'rust', 'go', 'gdscript') */
    public abstract readonly language: string;

    /** List of file extensions claimed by this adapter (e.g. ['.ts', '.tsx', '.js']) */
    public abstract readonly fileExtensions: string[];

    /**
     * Determines whether this adapter claims the given file path.
     */
    public supports(filePath: string): boolean {
        const lower = filePath.toLowerCase();
        return this.fileExtensions.some((ext) => lower.endsWith(ext));
    }

    /**
     * Parses the file content and populates the target semantic graph with nodes and edges.
     *
     * @param filePath - Normalized or relative file path.
     * @param content - UTF-8 text contents of the source file.
     * @param graph - Destination graph instance receiving nodes and edges.
     */
    public abstract extractToGraph(
        filePath: string,
        content: string,
        graph: SemanticGraph,
    ): Promise<void> | void;

    /**
     * Factory helper to create a canonical Module node.
     */
    protected createModuleNode(
        filePath: string,
        lineCount: number,
        attributes?: NodeAttributes,
    ): SemanticNode {
        const canonicalFile = normalizeCanonicalPath(filePath);
        return {
            id: buildCanonicalSymbolId(this.language, canonicalFile, 'module'),
            language: this.language,
            kind: 'module',
            name: canonicalFile.split('/').pop() || 'module',
            location: {
                file: canonicalFile,
                start: { line: 1, column: 1 },
                end: { line: Math.max(1, lineCount), column: 1 },
            },
            attributes,
            metrics: { lineCount },
        };
    }

    /**
     * Factory helper to create a canonical Function node.
     */
    protected createFunctionNode(
        filePath: string,
        symbolPath: string,
        name: string,
        location: NodeLocation,
        attributes?: NodeAttributes,
        metrics?: NodeMetrics,
    ): SemanticNode {
        return {
            id: buildCanonicalSymbolId(this.language, filePath, symbolPath),
            language: this.language,
            kind: 'function',
            name,
            scope: symbolPath.includes('.') ? symbolPath.split('.')[0] : undefined,
            location,
            attributes,
            metrics,
        };
    }

    /**
     * Factory helper to create a canonical Type/Class/Struct node.
     */
    protected createTypeNode(
        filePath: string,
        name: string,
        location: NodeLocation,
        attributes?: NodeAttributes,
    ): SemanticNode {
        return {
            id: buildCanonicalSymbolId(this.language, filePath, name),
            language: this.language,
            kind: 'type',
            name,
            location,
            attributes,
        };
    }

    /**
     * Factory helper to create a directed dependency edge.
     */
    protected createDependencyEdge(
        fromNodeId: string,
        toNodeId: string,
        context?: EdgeContext,
    ): SemanticEdge {
        return {
            id: `dep:${fromNodeId}->${toNodeId}`,
            fromNodeId,
            toNodeId,
            kind: 'depends_on',
            weight: 1,
            context,
        };
    }

    /**
     * Factory helper to create a directed call edge.
     */
    protected createCallEdge(
        callerId: string,
        calleeId: string,
        context?: EdgeContext,
    ): SemanticEdge {
        return {
            id: `call:${callerId}->${calleeId}`,
            fromNodeId: callerId,
            toNodeId: calleeId,
            kind: 'calls',
            weight: 1,
            context,
        };
    }
}
