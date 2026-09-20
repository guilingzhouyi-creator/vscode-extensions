/**
 * Module: Core Engine — Python Semantic Adapter
 * File Path: src/core/semantic/adapters/python-adapter.ts
 * Architecture Role: Maps Python source syntax into canonical SemanticNode and SemanticEdge
 *   topology models within the unified SemanticGraph.
 * Dependencies & Triggers: Consumes ./base and ./path-utils.
 * Responsibilities: Parse Python imports, class blocks, synchronous and asynchronous
 *   function definitions, method bindings, and function invocation expressions.
 * Exit Semantics & Design Rationale: Uses deterministic line-by-line inductive parsing
 *   with indentation tracking to ensure native-dependency-free execution and robust fallback.
 */

import type { SemanticGraph } from '../index';
import { UnifiedLanguageAdapter } from './base';
import { buildCanonicalSymbolId, normalizeCanonicalPath } from './path-utils';

/**
 * Concrete adapter translating Python files into SemanticGraph representations.
 */
export class PythonSemanticAdapter extends UnifiedLanguageAdapter {
    public readonly language = 'python';
    public readonly fileExtensions = ['.py', '.pyi'];

    /**
     * Extracts symbols and dependency topology from Python code.
     */
    public extractToGraph(filePath: string, content: string, graph: SemanticGraph): void {
        const canonicalFile = normalizeCanonicalPath(filePath);
        const lines = content.split(/\r?\n/);
        const totalLines = lines.length;

        // 1. Create root Module node
        const moduleNode = this.createModuleNode(canonicalFile, totalLines);
        graph.addNode(moduleNode);

        // 2. Parse lines with scope stack
        let currentClass: string | null = null;
        let currentClassIndent = -1;
        let currentFunc: string | null = null;
        let currentFuncIndent = -1;

        for (let i = 0; i < lines.length; i++) {
            const lineNum = i + 1;
            const rawLine = lines[i];
            const trimmed = rawLine.trim();

            if (!trimmed || trimmed.startsWith('#')) {
                continue;
            }

            const indent = rawLine.search(/\S/);

            // Pop class/func scope if indent unindented
            if (currentFunc !== null && indent <= currentFuncIndent) {
                currentFunc = null;
                currentFuncIndent = -1;
            }
            if (currentClass !== null && indent <= currentClassIndent) {
                currentClass = null;
                currentClassIndent = -1;
            }

            // Check declarations
            if (this.matchImport(trimmed, canonicalFile, graph, moduleNode.id)) {
                continue;
            }

            const classMatch = /^class\s+([A-Za-z0-9_]+)(?:\(([^)]*)\))?:/.exec(trimmed);
            if (classMatch) {
                currentClass = classMatch[1];
                currentClassIndent = indent;
                this.handleClass(canonicalFile, currentClass, classMatch[2], lineNum, graph);
                continue;
            }

            const funcMatch = /^(?:async\s+)?def\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)/.exec(trimmed);
            if (funcMatch) {
                const funcName = funcMatch[1];
                const isAsync = trimmed.startsWith('async');
                const params = funcMatch[2]
                    ? funcMatch[2].split(',').filter((p) => p.trim().length > 0)
                    : [];
                currentFunc = currentClass ? `${currentClass}.${funcName}` : funcName;
                currentFuncIndent = indent;

                this.handleFunction(
                    canonicalFile,
                    currentFunc,
                    funcName,
                    isAsync,
                    params.length,
                    lineNum,
                    graph,
                );
                continue;
            }

            // Check calls within active function
            if (currentFunc) {
                this.matchCalls(trimmed, currentFunc, canonicalFile, graph);
            }
        }
    }

    /**
     * Detects import and from-import statements, adding dependency edges.
     */
    private matchImport(
        trimmed: string,
        filePath: string,
        graph: SemanticGraph,
        moduleId: string,
    ): boolean {
        const fromMatch = /^from\s+([A-Za-z0-9_.]+)\s+import/.exec(trimmed);
        if (fromMatch) {
            const targetMod = buildCanonicalSymbolId(this.language, fromMatch[1], 'module');
            graph.addEdge(this.createDependencyEdge(moduleId, targetMod));
            return true;
        }

        const importMatch = /^import\s+([A-Za-z0-9_.]+)/.exec(trimmed);
        if (importMatch) {
            const targetMod = buildCanonicalSymbolId(this.language, importMatch[1], 'module');
            graph.addEdge(this.createDependencyEdge(moduleId, targetMod));
            return true;
        }

        return false;
    }

    /**
     * Registers a Python class node and potential inheritance edge.
     */
    private handleClass(
        filePath: string,
        className: string,
        superClass: string | undefined,
        lineNum: number,
        graph: SemanticGraph,
    ): void {
        const classNode = this.createTypeNode(filePath, className, {
            file: filePath,
            start: { line: lineNum, column: 1 },
            end: { line: lineNum, column: 1 },
        });
        graph.addNode(classNode);

        if (superClass) {
            const firstBase = superClass.split(',')[0].trim();
            if (firstBase && firstBase !== 'object') {
                const baseId = buildCanonicalSymbolId(this.language, filePath, firstBase);
                graph.addEdge({
                    id: `inherits:${classNode.id}->${baseId}`,
                    fromNodeId: classNode.id,
                    toNodeId: baseId,
                    kind: 'inherits',
                });
            }
        }
    }

    /**
     * Registers a Python function or method node.
     */
    private handleFunction(
        filePath: string,
        symbolPath: string,
        name: string,
        isAsync: boolean,
        paramCount: number,
        lineNum: number,
        graph: SemanticGraph,
    ): void {
        const funcNode = this.createFunctionNode(
            filePath,
            symbolPath,
            name,
            {
                file: filePath,
                start: { line: lineNum, column: 1 },
                end: { line: lineNum, column: 1 },
            },
            { isAsync },
            { parameterCount: paramCount },
        );
        graph.addNode(funcNode);
    }

    /**
     * Identifies potential callee invocations within a statement.
     */
    private matchCalls(
        trimmed: string,
        callerSymbol: string,
        filePath: string,
        graph: SemanticGraph,
    ): void {
        const callRegex = /([A-Za-z0-9_]+)\s*\(/g;
        let match: RegExpExecArray | null;
        const callerId = buildCanonicalSymbolId(this.language, filePath, callerSymbol);

        while ((match = callRegex.exec(trimmed)) !== null) {
            const callee = match[1];
            // Filter keywords that look like function calls
            if (['if', 'while', 'for', 'elif', 'with', 'assert', 'return'].includes(callee)) {
                continue;
            }
            const calleeId = buildCanonicalSymbolId(this.language, filePath, callee);
            graph.addEdge(this.createCallEdge(callerId, calleeId));
        }
    }
}
