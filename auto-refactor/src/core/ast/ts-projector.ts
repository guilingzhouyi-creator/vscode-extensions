/**
 * Module: Core Engine — TypeScript Lazy Node Projector
 * File Path: src/core/ast/ts-projector.ts
 * Architecture Role: Lazy NodeProjector for TypeScript-backed files, projecting raw ts.Node
 *   trees on demand and serving raw child sequences with Mode B subtree caching.
 * Dependencies & Triggers: typescript, ./multilang, ../utils/ast, and predicates from
 *   ./tsPredicates; instantiated by TypeScriptAdapter.project().
 * Responsibilities: Implement NodeProjector interface for lazy streaming descent; handle
 *   export classification, child reflection, and Mode B eager function subtree caching.
 * Exit Semantics & Design Rationale: Throws nothing during projection; non-observable nodes
 *   collapse to OTHER_PLACEHOLDER for maximum traversal performance.
 */

import * as ts from 'typescript';
import type { NormalizedNode, Position, NodeProjector, ProjectionPolicy } from './multilang';
import { NodeKind, OTHER_PLACEHOLDER } from './multilang';
import { isFunctionLike } from '../../utils/ast';
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
} from './ts-predicates';

/**
 * Cached syntactic characteristics for a TypeScript SyntaxKind.
 */
export interface TsKindInfo {
    kind: NodeKind;
    fnLike: boolean;
    /** branchWeight for kind-only cases; BinaryExpression is 0 here (operator checked at use). */
    branch: number;
    increasesNesting: boolean;
    isClassDefining: boolean;
    /** 0 = not a consumed literal, 1 = NumericLiteral, 2 = StringLiteral. */
    literal: 0 | 1 | 2;
    /**
     * Kind any consumer can observe
     * (literal/function/class/binding-source/scope/FunctionKeyword/top-level-decl).
     */
    special: boolean;
}

function maxSyntaxKind(): number {
    let max = 0;
    for (const v of Object.values(ts.SyntaxKind)) {
        if (typeof v === 'number' && v > max) max = v;
    }
    return max;
}

const TS_KIND_INFO_MAX = maxSyntaxKind() + 1;

const BINDING_SOURCE_KINDS = new Set<ts.SyntaxKind>([
    ts.SyntaxKind.VariableDeclaration,
    ts.SyntaxKind.PropertyAssignment,
    ts.SyntaxKind.PropertyDeclaration,
    ts.SyntaxKind.BinaryExpression,
]);

const TOP_LEVEL_DECL_KINDS = new Set<ts.SyntaxKind>([
    ts.SyntaxKind.FunctionDeclaration,
    ts.SyntaxKind.ClassDeclaration,
    ts.SyntaxKind.InterfaceDeclaration,
    ts.SyntaxKind.EnumDeclaration,
    ts.SyntaxKind.TypeAliasDeclaration,
    ts.SyntaxKind.ModuleDeclaration,
    ts.SyntaxKind.VariableStatement,
]);

function computeKindLiteralType(kindNum: ts.SyntaxKind): 0 | 1 | 2 {
    if (kindNum === ts.SyntaxKind.NumericLiteral) return 1;
    if (
        kindNum === ts.SyntaxKind.StringLiteral ||
        kindNum === ts.SyntaxKind.NoSubstitutionTemplateLiteral
    ) {
        return 2;
    }
    return 0;
}

function computeKindSpecialFlag(
    kindNum: ts.SyntaxKind,
    literal: number,
    isClassDefining: boolean,
): boolean {
    return (
        literal !== 0 ||
        isFunctionLike({ kind: kindNum } as ts.Node) ||
        isClassDefining ||
        CONTROL_OR_BLOCK.has(kindNum) ||
        kindNum === ts.SyntaxKind.FunctionKeyword ||
        BINDING_SOURCE_KINDS.has(kindNum) ||
        TOP_LEVEL_DECL_KINDS.has(kindNum)
    );
}

function buildKindInfo(kindNum: ts.SyntaxKind): TsKindInfo {
    const branch =
        kindNum === ts.SyntaxKind.BinaryExpression
            ? 0
            : branchWeightOf({ kind: kindNum } as ts.Node);
    const isClassDefining =
        ts.isClassDeclaration({ kind: kindNum } as ts.Node) ||
        ts.isClassExpression({ kind: kindNum } as ts.Node);
    const kind = kindOf({ kind: kindNum } as ts.Node);
    const literal = computeKindLiteralType(kindNum);
    const special = computeKindSpecialFlag(kindNum, literal, isClassDefining);
    return {
        kind,
        fnLike: isFunctionLike({ kind: kindNum } as ts.Node),
        branch,
        increasesNesting: CONTROL_OR_BLOCK.has(kindNum),
        isClassDefining,
        literal,
        special,
    };
}

const TS_KIND_INFO: TsKindInfo[] = (() => {
    const table: TsKindInfo[] = new Array(TS_KIND_INFO_MAX);
    for (let k = 0; k < TS_KIND_INFO_MAX; k++) {
        table[k] = buildKindInfo(k as ts.SyntaxKind);
    }
    return table;
})();

function kindInfoFor(astNode: ts.Node): TsKindInfo {
    const kindMeta = TS_KIND_INFO[astNode.kind];
    if (kindMeta) return kindMeta;
    const kindNum = astNode.kind;
    return {
        kind: kindOf(astNode),
        fnLike: isFunctionLike(astNode),
        branch: kindNum === ts.SyntaxKind.BinaryExpression ? 0 : branchWeightOf(astNode),
        increasesNesting: CONTROL_OR_BLOCK.has(kindNum),
        isClassDefining: ts.isClassDeclaration(astNode) || ts.isClassExpression(astNode),
        literal:
            kindNum === ts.SyntaxKind.NumericLiteral
                ? 1
                : kindNum === ts.SyntaxKind.StringLiteral ||
                    kindNum === ts.SyntaxKind.NoSubstitutionTemplateLiteral
                  ? 2
                  : 0,
        special: true,
    };
}

/**
 * Lazy projection source for TypeScript-family files.
 */
export class TsNodeProjector implements NodeProjector {
    readonly root: unknown;
    private readonly sf: ts.SourceFile;
    private readonly policy: ProjectionPolicy;
    private readonly functionSubtrees = new Map<ts.Node, ts.Node[]>();
    private readonly subtreeCache = new Map<ts.Node, NormalizedNode>();
    private readonly rawChildrenCache = new Map<ts.Node, ts.Node[]>();

    /**
     * Create a lazy projector wrapping one parsed source file.
     *
     * @param sf - Parsed TypeScript source file.
     * @param policy - Policy gating which normalized fields are constructed.
     */
    constructor(sf: ts.SourceFile, policy: ProjectionPolicy) {
        this.root = sf;
        this.sf = sf;
        this.policy = policy;
    }

    /**
     * Test whether a raw node is this projector's source file root.
     *
     * @param raw - Raw node to test.
     * @returns True only for a ts.SourceFile node.
     */
    isSourceFile(raw: unknown): boolean {
        return Boolean(raw) && (raw as ts.Node).kind === ts.SyntaxKind.SourceFile;
    }

    /**
     * Project one raw TypeScript node into its normalized (possibly placeholder) form.
     *
     * @param raw - Raw ts.Node to project.
     * @param parentRaw - Raw parent used to resolve top-level and literal-context flags.
     * @param grandparentRaw - Raw grandparent used to resolve const-bound literal flags.
     * @returns The normalized node, reusing a cached subtree projection when one exists.
     */
    project(
        raw: unknown,
        parentRaw: unknown | undefined,
        grandparentRaw: unknown | undefined,
    ): NormalizedNode {
        const rawNode = raw as ts.Node;
        const cached = this.subtreeCache.get(rawNode);
        if (cached) return cached;
        if (this.isSourceFile(rawNode)) return { kind: NodeKind.SourceFile };

        const kindMeta = kindInfoFor(rawNode);
        const fnLike = kindMeta.fnLike;
        const isLiteral = kindMeta.literal !== 0;
        const isScope = kindMeta.increasesNesting;
        const isFuncKw = rawNode.kind === ts.SyntaxKind.FunctionKeyword;
        const isClassDefining = kindMeta.isClassDefining;
        const isBinding = introducesBinding(rawNode);
        const topLevel = !!parentRaw && this.isSourceFile(parentRaw) && isTopLevelDecl(rawNode);
        const symbolCall = this.policy.needSymbols === true && kindMeta.kind === NodeKind.Call;
        const isObservable = this.isObservableSyntax(
            fnLike,
            isClassDefining,
            isBinding,
            isScope,
            symbolCall,
            isFuncKw,
            topLevel,
        );

        if (
            this.shouldCollapseToPlaceholder(kindMeta, isLiteral, isFuncKw, rawNode, isObservable)
        ) {
            return OTHER_PLACEHOLDER;
        }

        const node = this.buildProjectedNode(
            rawNode,
            kindMeta,
            fnLike,
            isLiteral,
            isScope,
            isFuncKw,
            isClassDefining,
            isBinding,
            topLevel,
        );
        this.applyProjectedMetadata(
            node,
            rawNode,
            parentRaw as ts.Node | undefined,
            grandparentRaw as ts.Node | undefined,
            isLiteral,
            fnLike,
        );
        return node;
    }

    private isObservableSyntax(
        fnLike: boolean,
        isClassDefining: boolean,
        isBinding: boolean,
        isScope: boolean,
        symbolCall: boolean,
        isFuncKw: boolean,
        topLevel: boolean,
    ): boolean {
        if (fnLike || isClassDefining || isBinding) return true;
        if (isScope || symbolCall || topLevel) return true;
        return isFuncKw && Boolean(this.policy.needComplexity);
    }

    private isPlaceholderFastPath(
        kindMeta: TsKindInfo,
        isLiteral: boolean,
        isFuncKw: boolean,
        astNode: ts.Node,
    ): boolean {
        if (!kindMeta.special) return true;
        if (isLiteral && !this.policy.needLiterals) return true;
        if (isFuncKw && !this.policy.needComplexity) return true;
        if (
            astNode.kind === ts.SyntaxKind.BinaryExpression &&
            (astNode as ts.BinaryExpression).operatorToken.kind !== ts.SyntaxKind.EqualsToken
        ) {
            return true;
        }
        return false;
    }

    private shouldCollapseToPlaceholder(
        kindMeta: TsKindInfo,
        isLiteral: boolean,
        isFuncKw: boolean,
        astNode: ts.Node,
        isObservable: boolean,
    ): boolean {
        if (this.isPlaceholderFastPath(kindMeta, isLiteral, isFuncKw, astNode)) return true;
        if (isLiteral) return false;
        return !isObservable;
    }

    private resolveProjectedPositions(
        astNode: ts.Node,
        isCall: boolean,
        isLiteral: boolean,
        fnLike: boolean,
        isFuncKw: boolean,
        wantsSymbols: boolean,
        declaration: boolean,
    ): { start?: Position; end?: Position } {
        const needsPos =
            isCall ||
            (this.policy.needPositions && (isLiteral || fnLike || isFuncKw)) ||
            (wantsSymbols && declaration);
        if (!needsPos) return {};
        return {
            start: posOf(astNode.getStart(this.sf), this.sf),
            end: posOf(astNode.getEnd(), this.sf),
        };
    }

    private resolveProjectedName(
        astNode: ts.Node,
        isCall: boolean,
        wantsSymbols: boolean,
        declaration: boolean,
    ): string | undefined {
        if (isCall) return calleeNameOf(astNode, this.sf) ?? undefined;
        const needsName = (this.policy.needNames || wantsSymbols) && declaration;
        if (needsName) return nameOf(astNode, this.sf) ?? undefined;
        return undefined;
    }

    private resolveProjectedBindingName(
        astNode: ts.Node,
        isBinding: boolean,
        wantsSymbols: boolean,
        declaration: boolean,
    ): string | undefined {
        if (!isBinding) return undefined;
        const needsName = (this.policy.needNames || wantsSymbols) && declaration;
        if (needsName) return bindingName(astNode, this.sf) ?? undefined;
        return undefined;
    }

    private buildProjectedNode(
        astNode: ts.Node,
        kindMeta: TsKindInfo,
        fnLike: boolean,
        isLiteral: boolean,
        isScope: boolean,
        isFuncKw: boolean,
        isClassDefining: boolean,
        isBinding: boolean,
        topLevel: boolean,
    ): NormalizedNode {
        const isCall = kindMeta.kind === NodeKind.Call;
        const wantsSymbols = this.policy.needSymbols === true;
        const declaration = fnLike || isClassDefining || isBinding;
        const pos = this.resolveProjectedPositions(
            astNode,
            isCall,
            isLiteral,
            fnLike,
            isFuncKw,
            wantsSymbols,
            declaration,
        );

        const node: NormalizedNode = {
            kind: kindMeta.kind,
            rawKind: isFuncKw && this.policy.needComplexity ? 'FunctionKeyword' : undefined,
            text: isLiteral && this.policy.needLiterals ? astNode.getText(this.sf) : undefined,
            start: pos.start,
            end: pos.end,
            name: this.resolveProjectedName(astNode, isCall, wantsSymbols, declaration),
            functionLike: fnLike,
            isClassDefining,
            introducesBinding: isBinding,
            bindingName: this.resolveProjectedBindingName(
                astNode,
                isBinding,
                wantsSymbols,
                declaration,
            ),
            increasesNesting: isScope,
            isConstructor:
                Boolean(this.policy.needComplexity) && ts.isConstructorDeclaration(astNode),
            parameters: fnLike ? this.extractFnParameters(astNode) : undefined,
            topLevel,
            exported:
                topLevel &&
                (hasExportModifier(astNode) ||
                    ts.isExportAssignment(astNode) ||
                    ts.isExportDeclaration(astNode)),
        };
        return node;
    }

    private extractFnParameters(n: ts.Node): string[] | undefined {
        if (
            !ts.isFunctionDeclaration(n) &&
            !ts.isMethodDeclaration(n) &&
            !ts.isFunctionExpression(n) &&
            !ts.isArrowFunction(n) &&
            !ts.isConstructorDeclaration(n)
        ) {
            return undefined;
        }
        if (!n.parameters) return [];
        return n.parameters.map((p) => p.name.getText(this.sf));
    }

    private applyProjectedMetadata(
        node: NormalizedNode,
        astNode: ts.Node,
        parentRaw: ts.Node | undefined,
        grandparentRaw: ts.Node | undefined,
        isLiteral: boolean,
        fnLike: boolean,
    ): void {
        if (isLiteral && this.policy.needLiterals) {
            node.isConstBound = isConstBoundOf(astNode, parentRaw, grandparentRaw);
            node.tolerated = isToleratedOf(astNode, parentRaw, this.sf, grandparentRaw);
        }
        if (this.policy.needComplexity && fnLike) {
            node.children = this.projectSubtree(astNode, parentRaw, grandparentRaw);
        }
    }

    /**
     * Iterate a raw node's children in materialized order.
     *
     * @param raw - Raw node whose children should be iterated.
     * @returns An iterable of non-skippable raw children in materialized order.
     */
    forEachChild(raw: unknown): Iterable<unknown> {
        const targetNode = raw as ts.Node;
        if (this.policy.needComplexity && isFunctionLike(targetNode)) {
            let kids = this.functionSubtrees.get(targetNode);
            if (!kids) {
                kids = [];
                ts.forEachChild(targetNode, (childNode) => {
                    if (!isSkippableToken(childNode)) kids!.push(childNode);
                });
                this.functionSubtrees.set(targetNode, kids);
            }
            return kids;
        }
        if (this.policy.needComplexity) {
            const cached = this.rawChildrenCache.get(targetNode);
            if (cached) return cached;
        }
        const kids: ts.Node[] = [];
        ts.forEachChild(targetNode, (childNode) => {
            if (!isSkippableToken(childNode)) kids.push(childNode);
        });
        return kids;
    }

    private projectSubtree(
        fn: ts.Node,
        parentRaw: ts.Node | undefined,
        _grandparentRaw: ts.Node | undefined,
    ): NormalizedNode[] {
        const rawChildren: ts.Node[] = [];
        const children = this.buildSubtree(fn, parentRaw, rawChildren);
        this.functionSubtrees.set(fn, rawChildren);
        return children;
    }

    private buildSubtree(
        fn: ts.Node,
        parentRaw: ts.Node | undefined,
        rawOut: ts.Node[] | null,
    ): NormalizedNode[] {
        const children: NormalizedNode[] = [];
        const rawChildren: ts.Node[] = [];
        ts.forEachChild(fn, (childNode) => {
            if (isSkippableToken(childNode)) return;
            rawChildren.push(childNode);
            if (rawOut) rawOut.push(childNode);
            const proj = this.cheapProject(childNode, fn, parentRaw);
            children.push(proj);
            if (!isFunctionLike(childNode)) {
                proj.children = this.buildSubtree(childNode, fn, null);
            }
        });
        if (rawChildren.length > 0) this.rawChildrenCache.set(fn, rawChildren);
        return children;
    }

    private applyCheapFunctionProps(node: NormalizedNode, astNode: ts.Node): void {
        if (this.policy.needNames) node.name = nameOf(astNode, this.sf);
        if (this.policy.needPositions) {
            node.start = posOf(astNode.getStart(this.sf), this.sf);
            node.end = posOf(astNode.getEnd(), this.sf);
        }
        if (this.policy.needComplexity) node.isConstructor = ts.isConstructorDeclaration(astNode);
    }

    private applyCheapLiteralProps(
        node: NormalizedNode,
        astNode: ts.Node,
        parentRaw: ts.Node | undefined,
        grandparentRaw: ts.Node | undefined,
    ): void {
        if (!this.policy.needLiterals) return;
        node.text = astNode.getText(this.sf);
        node.start = posOf(astNode.getStart(this.sf), this.sf);
        node.end = posOf(astNode.getEnd(), this.sf);
        node.isConstBound = isConstBoundOf(astNode, parentRaw, grandparentRaw);
        node.tolerated = isToleratedOf(astNode, parentRaw, this.sf, grandparentRaw);
    }

    private applyCheapNonFunctionProps(
        node: NormalizedNode,
        astNode: ts.Node,
        kindMeta: TsKindInfo,
        parentRaw: ts.Node | undefined,
        grandparentRaw: ts.Node | undefined,
        isLiteral: boolean,
    ): void {
        if (kindMeta.isClassDefining) {
            node.isClassDefining = true;
            if (this.policy.needNames) node.name = nameOf(astNode, this.sf);
        } else if (introducesBinding(astNode)) {
            node.introducesBinding = true;
            if (this.policy.needNames) node.bindingName = bindingName(astNode, this.sf);
        } else if (kindMeta.kind === NodeKind.Call) {
            node.name = calleeNameOf(astNode, this.sf) ?? undefined;
            node.start = posOf(astNode.getStart(this.sf), this.sf);
            node.end = posOf(astNode.getEnd(), this.sf);
        }
        if (isLiteral) {
            this.applyCheapLiteralProps(node, astNode, parentRaw, grandparentRaw);
        } else if (astNode.kind === ts.SyntaxKind.FunctionKeyword) {
            if (this.policy.needComplexity) node.rawKind = 'FunctionKeyword';
            if (this.policy.needPositions) {
                node.start = posOf(astNode.getStart(this.sf), this.sf);
                node.end = posOf(astNode.getEnd(), this.sf);
            }
        }
    }

    private cheapProject(
        astNode: ts.Node,
        parentRaw: ts.Node | undefined,
        grandparentRaw: ts.Node | undefined,
    ): NormalizedNode {
        const kindMeta = kindInfoFor(astNode);
        const kind = kindMeta.kind;
        const fnLike = kindMeta.fnLike;
        const isLiteral = kindMeta.literal !== 0;
        const isBinary = astNode.kind === ts.SyntaxKind.BinaryExpression;
        const branchWeight = isBinary ? branchWeightOf(astNode) : kindMeta.branch;

        const node: NormalizedNode = {
            kind,
            functionLike: fnLike,
            branchWeight,
            increasesNesting: kindMeta.increasesNesting,
            children: undefined,
        };

        if (fnLike) {
            this.applyCheapFunctionProps(node, astNode);
        } else {
            this.applyCheapNonFunctionProps(
                node,
                astNode,
                kindMeta,
                parentRaw,
                grandparentRaw,
                isLiteral,
            );
        }

        if (!fnLike) this.subtreeCache.set(astNode, node);
        return node;
    }
}
