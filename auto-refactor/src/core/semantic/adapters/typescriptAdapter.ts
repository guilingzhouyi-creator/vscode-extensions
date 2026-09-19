/**
 * Module: Core Engine — TypeScript & JavaScript Semantic Adapter
 * File Path: src/core/semantic/adapters/typescriptAdapter.ts
 * Architecture Role: Maps TypeScript and JavaScript compiler AST constructs into canonical
 *   SemanticNode entities and SemanticEdge topological relations.
 * Dependencies & Triggers: Consumes typescript, ./base, and ./pathUtils.
 * Responsibilities: Extract modules, import statements, classes, interfaces, functions,
 *   methods, parameter counts, async boundaries, and call expressions.
 * Exit Semantics & Design Rationale: Graceful degradation on syntax parse anomalies ensures
 *   partial analysis without runtime crash.
 */

import * as ts from 'typescript';
import type { NodeLocation, SemanticGraph } from '../index';
import { UnifiedLanguageAdapter } from './base';
import { buildCanonicalSymbolId, normalizeCanonicalPath } from './pathUtils';

/**
 * Concrete adapter translating TypeScript and JavaScript files into SemanticGraph representations.
 */
export class TypeScriptSemanticAdapter extends UnifiedLanguageAdapter {
    public readonly language = 'typescript';
    public readonly fileExtensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

    /**
     * Extracts symbols and calls from a TypeScript/JavaScript source file into the graph.
     */
    public extractToGraph(filePath: string, content: string, graph: SemanticGraph): void {
        const canonicalFile = normalizeCanonicalPath(filePath);
        const sourceFile = ts.createSourceFile(
            canonicalFile,
            content,
            ts.ScriptTarget.Latest,
            true,
            ts.ScriptKind.TSX,
        );

        const lineStarts = sourceFile.getLineStarts();
        const totalLines = lineStarts.length;

        // 1. Create root Module node
        const moduleNode = this.createModuleNode(canonicalFile, totalLines);
        graph.addNode(moduleNode);

        // 2. Scan AST declarations
        this.scanStatements(sourceFile, sourceFile, canonicalFile, graph, moduleNode.id);
    }

    /**
     * Iterates through top-level source statements and extracts nodes and edges.
     */
    private scanStatements(
        node: ts.Node,
        sourceFile: ts.SourceFile,
        filePath: string,
        graph: SemanticGraph,
        currentScopeId: string,
    ): void {
        ts.forEachChild(node, (child) => {
            if (ts.isImportDeclaration(child)) {
                this.handleImport(child, filePath, graph, currentScopeId);
            } else if (ts.isClassDeclaration(child) || ts.isInterfaceDeclaration(child)) {
                this.handleTypeDeclaration(child, sourceFile, filePath, graph, currentScopeId);
            } else if (ts.isFunctionDeclaration(child)) {
                this.handleFunctionDeclaration(child, sourceFile, filePath, graph);
            } else if (ts.isVariableStatement(child)) {
                this.handleVariableStatement(child, sourceFile, filePath, graph);
            }
        });
    }

    /**
     * Extracts import dependencies and binds module-level depends_on edges.
     */
    private handleImport(
        decl: ts.ImportDeclaration,
        filePath: string,
        graph: SemanticGraph,
        moduleNodeId: string,
    ): void {
        if (!ts.isStringLiteral(decl.moduleSpecifier)) {
            return;
        }
        const specifier = decl.moduleSpecifier.text;
        const targetId = buildCanonicalSymbolId(this.language, specifier, 'module');
        graph.addEdge(this.createDependencyEdge(moduleNodeId, targetId));
    }

    /**
     * Extracts class and interface structures, indexing their members and inheritance.
     */
    private handleTypeDeclaration(
        decl: ts.ClassDeclaration | ts.InterfaceDeclaration,
        sourceFile: ts.SourceFile,
        filePath: string,
        graph: SemanticGraph,
        moduleNodeId: string,
    ): void {
        const typeName = decl.name ? decl.name.text : 'AnonymousType';
        const loc = this.computeLocation(decl, sourceFile, filePath);
        const typeNode = this.createTypeNode(filePath, typeName, loc, {
            isExported: this.hasExportModifier(decl),
        });
        graph.addNode(typeNode);
        graph.addEdge(this.createDependencyEdge(moduleNodeId, typeNode.id));

        // Scan methods inside class
        if (ts.isClassDeclaration(decl)) {
            for (const member of decl.members) {
                if (ts.isMethodDeclaration(member)) {
                    this.handleMethodDeclaration(member, typeName, sourceFile, filePath, graph);
                }
            }
        }
    }

    /**
     * Extracts standalone function declarations and discovers nested call edges.
     */
    private handleFunctionDeclaration(
        decl: ts.FunctionDeclaration,
        sourceFile: ts.SourceFile,
        filePath: string,
        graph: SemanticGraph,
    ): void {
        const funcName = decl.name ? decl.name.text : 'anonymousFunction';
        const loc = this.computeLocation(decl, sourceFile, filePath);
        const isAsync = this.checkModifier(decl, ts.SyntaxKind.AsyncKeyword);
        const paramCount = decl.parameters.length;

        const funcNode = this.createFunctionNode(
            filePath,
            funcName,
            funcName,
            loc,
            { isAsync, isExported: this.hasExportModifier(decl) },
            {
                parameterCount: paramCount,
                lineCount: loc.end.line - loc.start.line + 1,
            },
        );
        graph.addNode(funcNode);

        if (decl.body) {
            this.scanCallExpressions(decl.body, funcNode.id, filePath, graph);
        }
    }

    /**
     * Extracts methods inside classes.
     */
    private handleMethodDeclaration(
        decl: ts.MethodDeclaration,
        parentTypeName: string,
        sourceFile: ts.SourceFile,
        filePath: string,
        graph: SemanticGraph,
    ): void {
        const methodName = decl.name.getText(sourceFile) || 'anonymousMethod';
        const symbolPath = `${parentTypeName}.${methodName}`;
        const loc = this.computeLocation(decl, sourceFile, filePath);
        const isAsync = this.checkModifier(decl, ts.SyntaxKind.AsyncKeyword);

        const methodNode = this.createFunctionNode(
            filePath,
            symbolPath,
            methodName,
            loc,
            { isAsync },
            {
                parameterCount: decl.parameters.length,
                lineCount: loc.end.line - loc.start.line + 1,
            },
        );
        graph.addNode(methodNode);

        if (decl.body) {
            this.scanCallExpressions(decl.body, methodNode.id, filePath, graph);
        }
    }

    /**
     * Inspects variable declarations for arrow functions.
     */
    private handleVariableStatement(
        stmt: ts.VariableStatement,
        sourceFile: ts.SourceFile,
        filePath: string,
        graph: SemanticGraph,
    ): void {
        for (const decl of stmt.declarationList.declarations) {
            if (
                decl.initializer &&
                (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))
            ) {
                const varName = decl.name.getText(sourceFile);
                const loc = this.computeLocation(decl, sourceFile, filePath);
                const isAsync = this.checkModifier(decl.initializer, ts.SyntaxKind.AsyncKeyword);
                const node = this.createFunctionNode(
                    filePath,
                    varName,
                    varName,
                    loc,
                    { isAsync },
                    { parameterCount: decl.initializer.parameters.length },
                );
                graph.addNode(node);
                if (decl.initializer.body) {
                    this.scanCallExpressions(decl.initializer.body, node.id, filePath, graph);
                }
            }
        }
    }

    /**
     * Scans a function body for nested call expressions.
     */
    private scanCallExpressions(
        root: ts.Node,
        callerId: string,
        filePath: string,
        graph: SemanticGraph,
    ): void {
        const walk = (n: ts.Node): void => {
            if (ts.isCallExpression(n)) {
                const calleeText = n.expression.getText();
                const calleeId = buildCanonicalSymbolId(this.language, filePath, calleeText);
                graph.addEdge(this.createCallEdge(callerId, calleeId));
            }
            ts.forEachChild(n, walk);
        };
        walk(root);
    }

    /**
     * Converts a TypeScript AST node into physical line/column coordinates.
     */
    private computeLocation(
        node: ts.Node,
        sourceFile: ts.SourceFile,
        filePath: string,
    ): NodeLocation {
        const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
        return {
            file: filePath,
            start: { line: start.line + 1, column: start.character + 1 },
            end: { line: end.line + 1, column: end.character + 1 },
        };
    }

    /**
     * Checks whether a declaration has the export modifier.
     */
    private hasExportModifier(node: ts.Node): boolean {
        return this.checkModifier(node, ts.SyntaxKind.ExportKeyword);
    }

    /**
     * Helper to safely query modifier lists across TypeScript versions.
     */
    private checkModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
        const canHave = ts.canHaveModifiers(node);
        if (!canHave) {
            return false;
        }
        const modifiers = ts.getModifiers(node);
        return Boolean(modifiers?.some((m) => m.kind === kind));
    }
}
