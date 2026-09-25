/**
 * Module: Core Engine — Go Language Adapter
 * File Path: src/core/ast/go-adapter.ts
 * Architecture Role: LanguageAdapter implementation mapping Go (.go) source files into
 *   normalized AST (NormalizedNode) for multi-language analyzer traversal.
 * Dependencies & Triggers: multilang contracts (NodeKind, NormalizedNode, NormalizedAst,
 *   LanguageAdapter); routed by adapters.ts when a .go file is scanned.
 * Responsibilities: Adapter class that delegates line-level parsing to go-adapter-parser.
 * Exit Semantics & Design Rationale: Synchronous and total for any input; empty or malformed
 *   text yields a SourceFile root so one bad Go file never aborts a scan.
 */

import type { NormalizedNode, NormalizedAst, LanguageAdapter } from './multilang';
import { NodeKind } from './multilang';
import { processGoLine } from './go-adapter-parser';
import type { ParseContext } from './go-adapter-parser';

/**
 * GoAdapter — Lightweight, dependency-free language adapter for Go source files (.go).
 *
 * Maps packages, imports, struct/interface types, functions/methods, variables,
 * constants, control flow, fields, calls, and string/numeric/named literals to
 * uniform NormalizedNodes. Uses line-level regex scanning for high-throughput
 * metrics collection without requiring native tree-sitter bindings.
 *
 * Capabilities:
 * - Function/method detection with exported flag and binding info
 * - Struct/interface type detection with class-defining flag
 * - var/const declaration detection with binding info
 * - Control flow (if/for/switch/select) with branch weight and nesting
 * - Case/default labels with branch weight
 * - Struct field detection
 * - Call expression detection (heuristic)
 * - String, numeric (int/float), and named literal detection
 * - Block/nesting depth tracking via brace counting
 */
export class GoAdapter implements LanguageAdapter {
    public readonly id = 'go' as const;
    public readonly extensions = ['.go'];

    /**
     * Parse Go source text into a normalized AST.
     *
     * @param content - Raw Go source text.
     * @param _filePath - File path (accepted for interface symmetry, unused).
     * @returns Normalized AST with SourceFile root.
     */
    public parse(content: string, _filePath: string): NormalizedAst {
        const lines = content.split(/\r?\n/);
        const children: NormalizedNode[] = [];

        const ctx: ParseContext = {
            inBlockComment: false,
            braceDepth: 0,
            inStruct: false,
            inImport: false,
            inSwitchSelect: false,
            inConstBlock: false,
            inVarBlock: false,
            braceStack: [],
        };

        for (let i = 0; i < lines.length; i++) {
            processGoLine(lines[i], i + 1, ctx, children);
        }

        const rootNode: NormalizedNode = {
            kind: NodeKind.SourceFile,
            start: { line: 1, column: 1 },
            end: { line: Math.max(1, lines.length), column: 1 },
            children,
        };

        return { root: rootNode };
    }

    /**
     * Return the root node of a parsed Go AST.
     *
     * @param ast - Normalized AST produced by `parse`.
     * @returns The source-file root node.
     */
    public root(ast: NormalizedAst): NormalizedNode {
        return ast.root;
    }

    /**
     * Return the normalized children of a node.
     *
     * @param node - Any normalized node produced by this adapter.
     * @returns Child array in source order; leaves yield an empty array.
     */
    public children(node: NormalizedNode): NormalizedNode[] {
        return node.children || [];
    }
}
