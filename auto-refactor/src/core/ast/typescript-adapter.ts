/**
 * Module: Core Engine — TypeScript and JavaScript Language Adapter
 * File Path: src/core/ast/typescript-adapter.ts
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
import {
    BaseAstAdapter,
    NodeKind,
    type NormalizedNode,
    type NormalizedAst,
    type Position,
    type NodeProjector,
    type ProjectionPolicy,
    type ProjectionSeed,
    type ReusedSpan,
} from './multilang';
import { createSourceFile, isFunctionLike } from '../../utils/ast';
import { TsNodeProjector } from './ts-projector';
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
    calleeReceiverOf,
    nameOf,
    isConstBoundOf,
    isToleratedOf,
    posOf,
} from './ts-predicates';

export { TsNodeProjector } from './ts-projector';
export * from './ts-predicates';

/**
 * Default LanguageAdapter for TypeScript and JavaScript family files.
 */
export class TypeScriptAdapter extends BaseAstAdapter {
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
        const sourceFile = createSourceFile(filePath, content);
        const root = this.mapNode(sourceFile, undefined, undefined, undefined, sourceFile, seed);
        return { root, sourceFile };
    }

    /**
     * Build a lazy-projection source for a file.
     *
     * @param content - Full source text of the file.
     * @param filePath - Path used by createSourceFile.
     * @param policy - Projection policy describing required fields.
     * @returns A TsNodeProjector over the parsed source.
     */
    override project(
        content: string,
        filePath: string,
        policy: ProjectionPolicy,
    ): NodeProjector | null {
        const sourceFile = createSourceFile(filePath, content);
        return new TsNodeProjector(sourceFile, policy);
    }

    private resolveNodePositions(
        tsNode: ts.Node,
        isLiteral: boolean,
        fnLike: boolean,
        isCall: boolean,
        sourceFile: ts.SourceFile,
    ): { start?: Position; end?: Position } {
        const needsPos =
            isLiteral ||
            fnLike ||
            isCall ||
            tsNode.kind === ts.SyntaxKind.FunctionKeyword ||
            tsNode.kind === ts.SyntaxKind.SourceFile ||
            ts.isClassDeclaration(tsNode) ||
            ts.isClassExpression(tsNode) ||
            ts.isVariableDeclaration(tsNode) ||
            ts.isParameter(tsNode);
        if (!needsPos) return {};
        return {
            start: posOf(tsNode.getStart(sourceFile), sourceFile),
            end: posOf(tsNode.getEnd(), sourceFile),
        };
    }

    private resolveNodeName(
        tsNode: ts.Node,
        kind: NodeKind,
        isCall: boolean,
        fnLike: boolean,
        isClassDefining: boolean,
        isBinding: boolean,
        sourceFile: ts.SourceFile,
    ): string | undefined {
        if (isCall) return calleeNameOf(tsNode, sourceFile) ?? undefined;
        if (fnLike || isClassDefining || isBinding) return nameOf(tsNode, sourceFile) ?? undefined;
        if (kind === NodeKind.Variable || kind === NodeKind.Constant) {
            return nameOf(tsNode, sourceFile) ?? undefined;
        }
        return undefined;
    }

    private buildNormalizedNode(
        tsNode: ts.Node,
        kind: NodeKind,
        isLiteral: boolean,
        fnLike: boolean,
        isClassDefining: boolean,
        isBinding: boolean,
        isCall: boolean,
        sourceFile: ts.SourceFile,
    ): NormalizedNode {
        const pos = this.resolveNodePositions(tsNode, isLiteral, fnLike, isCall, sourceFile);
        return {
            kind,
            rawKind: tsNode.kind === ts.SyntaxKind.FunctionKeyword ? 'FunctionKeyword' : undefined,
            text: isLiteral ? tsNode.getText(sourceFile) : undefined,
            start: pos.start,
            end: pos.end,
            name: this.resolveNodeName(
                tsNode,
                kind,
                isCall,
                fnLike,
                isClassDefining,
                isBinding,
                sourceFile,
            ),
            calleeReceiver: isCall
                ? (calleeReceiverOf(tsNode, sourceFile) ?? undefined)
                : undefined,
            isNumeric: kind === NodeKind.NumericLiteral,
            isString: kind === NodeKind.StringLiteral,
            branchWeight: branchWeightOf(tsNode),
            functionLike: fnLike,
            isClassDefining,
            introducesBinding: isBinding,
            bindingName: isBinding ? bindingName(tsNode, sourceFile) : null,
            hasFunctionInitializer: isBinding,
            increasesNesting: CONTROL_OR_BLOCK.has(tsNode.kind),
            isConstructor: ts.isConstructorDeclaration(tsNode),
            parameters: fnLike ? this.extractFnParameters(tsNode, sourceFile) : undefined,
        };
    }

    private extractFnParameters(tsNode: ts.Node, sourceFile: ts.SourceFile): string[] | undefined {
        if (
            !ts.isFunctionDeclaration(tsNode) &&
            !ts.isMethodDeclaration(tsNode) &&
            !ts.isFunctionExpression(tsNode) &&
            !ts.isArrowFunction(tsNode) &&
            !ts.isConstructorDeclaration(tsNode)
        ) {
            return undefined;
        }
        if (!tsNode.parameters) return [];
        return tsNode.parameters.map((paramNode) => paramNode.name.getText(sourceFile));
    }

    private applyNodeHierarchy(
        node: NormalizedNode,
        tsNode: ts.Node,
        parentTs: ts.Node | undefined,
        grandparentTs: ts.Node | undefined,
        greatGrandparentTs: ts.Node | undefined,
        isLiteral: boolean,
        sourceFile: ts.SourceFile,
    ): void {
        const topLevel = !!parentTs && ts.isSourceFile(parentTs) && isTopLevelDecl(tsNode);
        node.topLevel = topLevel;
        node.exported =
            topLevel &&
            (hasExportModifier(tsNode) ||
                ts.isExportAssignment(tsNode) ||
                ts.isExportDeclaration(tsNode));
        if (isLiteral) {
            node.isConstBound = isConstBoundOf(tsNode, parentTs, grandparentTs, greatGrandparentTs);
            node.tolerated = isToleratedOf(tsNode, parentTs, sourceFile, grandparentTs);
        }
    }

    private tryReuseSubtree(
        node: NormalizedNode,
        tsNode: ts.Node,
        fnLike: boolean,
        sourceFile: ts.SourceFile,
        seed?: ProjectionSeed,
    ): boolean {
        if (!seed || !fnLike) return false;
        const startPos = posOf(tsNode.getStart(sourceFile), sourceFile);
        const span: ReusedSpan = {
            startLine: startPos.line,
            startColumn: startPos.column,
            startByte: tsNode.getStart(sourceFile),
            endByte: tsNode.getEnd(),
            sourceText: tsNode.getText(sourceFile),
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
        tsNode: ts.Node,
        sourceFile: ts.SourceFile,
        kids: NormalizedNode[] | undefined,
    ): void {
        if (!seed || !fnLike) return;
        const startPos = posOf(tsNode.getStart(sourceFile), sourceFile);
        const span: ReusedSpan = {
            startLine: startPos.line,
            startColumn: startPos.column,
            startByte: tsNode.getStart(sourceFile),
            endByte: tsNode.getEnd(),
            sourceText: tsNode.getText(sourceFile),
        };
        seed.cacheSubtree(span, kids || []);
    }

    private traverseChildren(
        tsNode: ts.Node,
        parentTs: ts.Node | undefined,
        grandparentTs: ts.Node | undefined,
        sourceFile: ts.SourceFile,
        seed?: ProjectionSeed,
    ): NormalizedNode[] | undefined {
        let kids: NormalizedNode[] | undefined;
        ts.forEachChild(tsNode, (childTs) => {
            if (isSkippableToken(childTs)) return;
            (kids ??= []).push(
                this.mapNode(childTs, tsNode, parentTs, grandparentTs, sourceFile, seed),
            );
        });
        return kids;
    }

    private mapNode(
        tsNode: ts.Node,
        parentTs: ts.Node | undefined,
        grandparentTs: ts.Node | undefined,
        greatGrandparentTs: ts.Node | undefined,
        sourceFile: ts.SourceFile,
        seed?: ProjectionSeed,
    ): NormalizedNode {
        const kind = kindOf(tsNode);
        const isLiteral = kind === NodeKind.NumericLiteral || kind === NodeKind.StringLiteral;
        const fnLike = isFunctionLike(tsNode);
        const isBinding = introducesBinding(tsNode);
        const isClassDefining = ts.isClassDeclaration(tsNode) || ts.isClassExpression(tsNode);
        const isCall = kind === NodeKind.Call;

        const node = this.buildNormalizedNode(
            tsNode,
            kind,
            isLiteral,
            fnLike,
            isClassDefining,
            isBinding,
            isCall,
            sourceFile,
        );
        this.applyNodeHierarchy(
            node,
            tsNode,
            parentTs,
            grandparentTs,
            greatGrandparentTs,
            isLiteral,
            sourceFile,
        );

        if (this.tryReuseSubtree(node, tsNode, fnLike, sourceFile, seed)) {
            return node;
        }

        const kids = this.traverseChildren(tsNode, parentTs, grandparentTs, sourceFile, seed);
        node.children = kids;
        this.recordSpanCache(seed, fnLike, tsNode, sourceFile, kids);
        return node;
    }
}
