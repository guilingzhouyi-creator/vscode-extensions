/**
 * Module: Core Engine — TypeScript and JavaScript Language Adapter
 * File Path: src/core/typescriptAdapter.ts
 * Architecture Role: default LanguageAdapter mapping the typescript compiler AST to the
 *   normalized tree; also owns the optional TsNodeProjector lazy fast-path source.
 * Dependencies & Triggers: typescript, ./multilang, ../utils/ast; selected by
 *   core/adapters.ts for .ts/.tsx/.js/.jsx/.mjs/.cjs when parser is 'typescript'; called by
 *   the engine/worker per file and by legacy analyzer paths.
 * Responsibilities: materialize normalized nodes/positions/literals/binding and scope flags
 *   with the exact pre-multilang predicates, skip tokens, reuse incremental function
 *   subtrees, and run Mode A/B projection via TsNodeProjector and its kind table.
 * Exit Semantics & Design Rationale: parse()/project() are synchronous and produce
 *   byte-identical results; exceptions propagate so tryCreateProjector can fall back to
 *   materialized parse(); lazy projection and fixed object shapes cut allocation only.
 */

import * as ts from 'typescript';
import type {
    NormalizedNode,
    NormalizedAst,
    Position,
    LanguageAdapter,
    NodeProjector,
    ProjectionPolicy,
    ProjectionSeed,
    ReusedSpan,
} from './multilang';
import { NodeKind } from './multilang';
import { createSourceFile, isFunctionLike } from '../utils/ast';
import { TsNodeProjector } from './tsProjector';
import {
    CONTROL_OR_BLOCK,
    isTopLevelDecl,
    hasExportModifier,
    introducesBinding,
    isSkippableToken,
    bindingName,
    kindOf,
    branchWeightOf,
    calleeNameOf,
    nameOf,
    isConstBoundOf,
    isToleratedOf,
    posOf,
} from './tsPredicates';

export { TsNodeProjector } from './tsProjector';
export * from './tsPredicates';

/**
 * Default LanguageAdapter for TypeScript and JavaScript family files.
 */
export class TypeScriptAdapter implements LanguageAdapter {
    /** Identifier used by the adapter registry. */
    id = 'typescript' as const;
    /** File extensions claimed by this adapter. */
    extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

    /**
     * Parse one file into the shared normalized AST contract.
     *
     * @param content - Full source text of the file.
     * @param filePath - Path used to determine ScriptTarget/ScriptKind.
     * @param seed - Optional incremental seed for function subtree reuse.
     * @returns Normalized AST whose root is the source-file node.
     */
    parse(content: string, filePath: string, seed?: ProjectionSeed): NormalizedAst {
        const sf = createSourceFile(filePath, content);
        const root = this.mapNode(sf, undefined, undefined, sf, seed);
        return { root };
    }

    /**
     * Build a lazy-projection source for a file.
     *
     * @param content - Full source text of the file.
     * @param filePath - Path used by createSourceFile.
     * @param policy - Projection policy describing required fields.
     * @returns A TsNodeProjector over the parsed source.
     */
    project(content: string, filePath: string, policy: ProjectionPolicy): NodeProjector | null {
        const sf = createSourceFile(filePath, content);
        return new TsNodeProjector(sf, policy);
    }

    /**
     * Return the root node of a parsed AST.
     *
     * @param ast - Normalized AST produced by parse.
     * @returns Normalized source-file node.
     */
    root(ast: NormalizedAst): NormalizedNode {
        return ast.root;
    }

    /**
     * Return the direct children of a normalized node.
     *
     * @param node - Normalized node.
     * @returns Direct children in source order.
     */
    children(node: NormalizedNode): NormalizedNode[] {
        return node.children || [];
    }

    private resolveNodePositions(
        n: ts.Node,
        isLiteral: boolean,
        fnLike: boolean,
        isCall: boolean,
        sf: ts.SourceFile,
    ): { start?: Position; end?: Position } {
        const needsPos = isLiteral || fnLike || n.kind === ts.SyntaxKind.FunctionKeyword || isCall;
        if (!needsPos) return {};
        return {
            start: posOf(n.getStart(sf), sf),
            end: posOf(n.getEnd(), sf),
        };
    }

    private resolveNodeName(
        n: ts.Node,
        isCall: boolean,
        fnLike: boolean,
        isClassDefining: boolean,
        isBinding: boolean,
        sf: ts.SourceFile,
    ): string | undefined {
        if (isCall) return calleeNameOf(n, sf) ?? undefined;
        if (fnLike || isClassDefining || isBinding) return nameOf(n, sf) ?? undefined;
        return undefined;
    }

    private buildNormalizedNode(
        n: ts.Node,
        kind: NodeKind,
        isLiteral: boolean,
        fnLike: boolean,
        isClassDefining: boolean,
        isBinding: boolean,
        isCall: boolean,
        sf: ts.SourceFile,
    ): NormalizedNode {
        const pos = this.resolveNodePositions(n, isLiteral, fnLike, isCall, sf);
        return {
            kind,
            rawKind: n.kind === ts.SyntaxKind.FunctionKeyword ? 'FunctionKeyword' : undefined,
            text: isLiteral ? n.getText(sf) : undefined,
            start: pos.start,
            end: pos.end,
            name: this.resolveNodeName(n, isCall, fnLike, isClassDefining, isBinding, sf),
            isNumeric: kind === NodeKind.NumericLiteral,
            isString: kind === NodeKind.StringLiteral,
            branchWeight: branchWeightOf(n),
            functionLike: fnLike,
            isClassDefining,
            introducesBinding: isBinding,
            bindingName: isBinding ? bindingName(n, sf) : null,
            hasFunctionInitializer: isBinding,
            increasesNesting: CONTROL_OR_BLOCK.has(n.kind),
            isConstructor: ts.isConstructorDeclaration(n),
        };
    }

    private applyNodeHierarchy(
        node: NormalizedNode,
        n: ts.Node,
        parentTs: ts.Node | undefined,
        grandparentTs: ts.Node | undefined,
        isLiteral: boolean,
        sf: ts.SourceFile,
    ): void {
        const topLevel = !!parentTs && ts.isSourceFile(parentTs) && isTopLevelDecl(n);
        node.topLevel = topLevel;
        node.exported =
            topLevel &&
            (hasExportModifier(n) || ts.isExportAssignment(n) || ts.isExportDeclaration(n));
        if (isLiteral) {
            node.isConstBound = isConstBoundOf(n, parentTs, grandparentTs);
            node.tolerated = isToleratedOf(n, parentTs, sf);
        }
    }

    private tryReuseSubtree(
        node: NormalizedNode,
        n: ts.Node,
        fnLike: boolean,
        sf: ts.SourceFile,
        seed?: ProjectionSeed,
    ): boolean {
        if (!seed || !fnLike) return false;
        const startPos = posOf(n.getStart(sf), sf);
        const span: ReusedSpan = {
            startLine: startPos.line,
            startColumn: startPos.column,
            startByte: n.getStart(sf),
            endByte: n.getEnd(),
            sourceText: n.getText(sf),
        };
        const reused = seed.reuseSubtree(span);
        if (reused) {
            node.children = reused;
            seed.cacheSubtree(span, reused);
            if (seed.markReused) seed.markReused(node, span);
            return true;
        }
        return false;
    }

    private recordSpanCache(
        seed: ProjectionSeed | undefined,
        fnLike: boolean,
        n: ts.Node,
        sf: ts.SourceFile,
        kids: NormalizedNode[] | undefined,
    ): void {
        if (!seed || !fnLike) return;
        const startPos = posOf(n.getStart(sf), sf);
        const span: ReusedSpan = {
            startLine: startPos.line,
            startColumn: startPos.column,
            startByte: n.getStart(sf),
            endByte: n.getEnd(),
            sourceText: n.getText(sf),
        };
        seed.cacheSubtree(span, kids || []);
    }

    private traverseChildren(
        n: ts.Node,
        parentTs: ts.Node | undefined,
        sf: ts.SourceFile,
        seed?: ProjectionSeed,
    ): NormalizedNode[] | undefined {
        let kids: NormalizedNode[] | undefined;
        ts.forEachChild(n, (c) => {
            if (isSkippableToken(c)) return;
            (kids ??= []).push(this.mapNode(c, n, parentTs, sf, seed));
        });
        return kids;
    }

    private mapNode(
        n: ts.Node,
        parentTs: ts.Node | undefined,
        grandparentTs: ts.Node | undefined,
        sf: ts.SourceFile,
        seed?: ProjectionSeed,
    ): NormalizedNode {
        const kind = kindOf(n);
        const isLiteral = kind === NodeKind.NumericLiteral || kind === NodeKind.StringLiteral;
        const fnLike = isFunctionLike(n);
        const isBinding = introducesBinding(n);
        const isClassDefining = ts.isClassDeclaration(n) || ts.isClassExpression(n);
        const isCall = kind === NodeKind.Call;

        const node = this.buildNormalizedNode(
            n,
            kind,
            isLiteral,
            fnLike,
            isClassDefining,
            isBinding,
            isCall,
            sf,
        );
        this.applyNodeHierarchy(node, n, parentTs, grandparentTs, isLiteral, sf);

        if (this.tryReuseSubtree(node, n, fnLike, sf, seed)) {
            return node;
        }

        const kids = this.traverseChildren(n, parentTs, sf, seed);
        node.children = kids;
        this.recordSpanCache(seed, fnLike, n, sf, kids);
        return node;
    }
}
