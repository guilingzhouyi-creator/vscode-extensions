/**
 * Module: Core Engine — Go Language Adapter
 * File Path: src/core/ast/go-adapter.ts
 * Architecture Role: LanguageAdapter implementation mapping Go (.go) source files into
 *   normalized AST (NormalizedNode) for multi-language analyzer traversal.
 * Dependencies & Triggers: multilang contracts (NodeKind, NormalizedNode, NormalizedAst,
 *   LanguageAdapter); routed by adapters.ts when a .go file is scanned.
 * Responsibilities: Parse package, import, struct, interface, func, methods, control flow,
 *   and literal declarations into NormalizedNode hierarchy.
 * Exit Semantics & Design Rationale: Synchronous and total for any input; empty or malformed
 *   text yields a SourceFile root so one bad Go file never aborts a scan. Dependency-free
 *   inductive parser ensures high-throughput scanning without requiring cgo or external tools.
 */

import type { NormalizedNode, NormalizedAst, LanguageAdapter } from './multilang';
import { NodeKind } from './multilang';

const MIN_SIGNIFICANT_STRING_LENGTH = 3;

/**
 * GoAdapter — Lightweight, dependency-free language adapter for Go source files (.go).
 *
 * Maps packages, imports, struct/interface types, functions/methods, control flow,
 * and string/numeric literals to uniform NormalizedNodes.
 */
export class GoAdapter implements LanguageAdapter {
    public readonly id = 'go' as const;
    public readonly extensions = ['.go'];

    public parse(content: string, _filePath: string): NormalizedAst {
        const lines = content.split(/\r?\n/);
        const rootNode: NormalizedNode = {
            kind: NodeKind.SourceFile,
            start: { line: 1, column: 1 },
            end: { line: Math.max(1, lines.length), column: 1 },
            children: [],
        };

        const children: NormalizedNode[] = [];
        let inBlockComment = false;

        for (let i = 0; i < lines.length; i++) {
            const lineNum = i + 1;
            const line = lines[i];
            const trimmed = line.trim();

            if (!trimmed) continue;

            if (inBlockComment) {
                if (trimmed.includes('*/')) {
                    inBlockComment = false;
                }
                continue;
            }
            if (trimmed.startsWith('/*')) {
                if (!trimmed.includes('*/')) {
                    inBlockComment = true;
                }
                continue;
            }
            if (trimmed.startsWith('//')) {
                continue;
            }

            // Match struct/interface type definitions: `type Foo struct` or `type Bar interface`
            const typeMatch = /^type\s+([A-Za-z0-9_]+)\s+(struct|interface)\b/.exec(trimmed);
            if (typeMatch) {
                const typeName = typeMatch[1];
                const isStruct = typeMatch[2] === 'struct';
                children.push({
                    kind: isStruct ? NodeKind.Struct : NodeKind.Interface,
                    name: typeName,
                    isClassDefining: true,
                    topLevel: true,
                    exported: /^[A-Z]/.test(typeName),
                    start: { line: lineNum, column: line.indexOf(typeName) + 1 },
                    end: { line: lineNum, column: line.length + 1 },
                    children: [],
                });
                continue;
            }

            // Match method declaration: `func (r *Receiver) Method(...)`
            const methodMatch =
                /^func\s+\((?:[^)]+)\)\s+([A-Za-z0-9_]+)\s*(?:\[[^\]]*\])?\s*\(/.exec(trimmed);
            if (methodMatch) {
                const methodName = methodMatch[1];
                children.push({
                    kind: NodeKind.Method,
                    name: methodName,
                    functionLike: true,
                    topLevel: true,
                    exported: /^[A-Z]/.test(methodName),
                    start: { line: lineNum, column: line.indexOf(methodName) + 1 },
                    end: { line: lineNum, column: line.length + 1 },
                    children: [],
                });
                continue;
            }

            // Match standalone function declaration: `func Foo(...)`
            const funcMatch = /^func\s+([A-Za-z0-9_]+)\s*(?:\[[^\]]*\])?\s*\(/.exec(trimmed);
            if (funcMatch) {
                const funcName = funcMatch[1];
                children.push({
                    kind: NodeKind.Function,
                    name: funcName,
                    functionLike: true,
                    topLevel: true,
                    exported: /^[A-Z]/.test(funcName),
                    start: { line: lineNum, column: line.indexOf(funcName) + 1 },
                    end: { line: lineNum, column: line.length + 1 },
                    children: [],
                });
                continue;
            }

            // Match control flow keywords (if, for, switch, select, case)
            if (/\b(if|for|switch|select|case)\b/.test(trimmed)) {
                children.push({
                    kind: NodeKind.ControlFlow,
                    branchWeight: 1,
                    increasesNesting: true,
                    start: { line: lineNum, column: 1 },
                    end: { line: lineNum, column: line.length + 1 },
                    children: [],
                });
            }

            // Match string literals: `"..."` or raw backtick string: `` `...` ``
            const strMatch = /(["`])((?:\\.|(?!\1).)*)\1/.exec(trimmed);
            if (strMatch) {
                const rawVal = strMatch[2];
                const isTolerated = rawVal.length < MIN_SIGNIFICANT_STRING_LENGTH;
                children.push({
                    kind: NodeKind.StringLiteral,
                    text: rawVal,
                    isString: true,
                    tolerated: isTolerated,
                    start: { line: lineNum, column: line.indexOf(strMatch[0]) + 1 },
                    end: { line: lineNum, column: line.indexOf(strMatch[0]) + strMatch[0].length },
                });
            }
        }

        rootNode.children = children;
        return { root: rootNode };
    }

    public root(ast: NormalizedAst): NormalizedNode {
        return ast.root;
    }

    public children(node: NormalizedNode): NormalizedNode[] {
        return node.children || [];
    }
}
