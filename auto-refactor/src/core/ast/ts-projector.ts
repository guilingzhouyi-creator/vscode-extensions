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

const TS_KIND_INFO: TsKindInfo[] = (() => {
    const table: TsKindInfo[] = new Array(TS_KIND_INFO_MAX);
    for (let k = 0; k < TS_KIND_INFO_MAX; k++) {
        const kindNum = k as ts.SyntaxKind;
        const branch =
            kindNum === ts.SyntaxKind.BinaryExpression
                ? 0
                : branchWeightOf({ kind: kindNum } as ts.Node);
        const isClassDefining =
            ts.isClassDeclaration({ kind: kindNum } as ts.Node) ||
            ts.isClassExpression({ kind: kindNum } as ts.Node);
        const kind = kindOf({ kind: kindNum } as ts.Node);
        const literal =
            kindNum === ts.SyntaxKind.NumericLiteral
                ? 1
                : kindNum === ts.SyntaxKind.StringLiteral ||
                    kindNum === ts.SyntaxKind.NoSubstitutionTemplateLiteral
                  ? 2
                  : 0;
        const special =
            literal !== 0 ||
            isFunctionLike({ kind: kindNum } as ts.Node) ||
            isClassDefining ||
            CONTROL_OR_BLOCK.has(kindNum) ||
            kindNum === ts.SyntaxKind.FunctionKeyword ||
            BINDING_SOURCE_KINDS.has(kindNum) ||
            TOP_LEVEL_DECL_KINDS.has(kindNum);
        table[k] = {
            kind,
            fnLike: isFunctionLike({ kind: kindNum } as ts.Node),
            branch,
            increasesNesting: CONTROL_OR_BLOCK.has(kindNum),
            isClassDefining,
            literal,
            special,
        };
    }
    return table;
})();

function kindInfoFor(n: ts.Node): TsKindInfo {
    const info = TS_KIND_INFO[n.kind];
    if (info) return info;
    const kindNum = n.kind;
    return {
        kind: kindOf(n),
        fnLike: isFunctionLike(n),
        branch: kindNum === ts.SyntaxKind.BinaryExpression ? 0 : branchWeightOf(n),
        increasesNesting: CONTROL_OR_BLOCK.has(kindNum),
        isClassDefining: ts.isClassDeclaration(n) || ts.isClassExpression(n),
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
        const n = raw as ts.Node;
        const cached = this.subtreeCache.get(n);
        if (cached) return cached;
        if (this.isSourceFile(n)) return { kind: NodeKind.SourceFile };

        const info = kindInfoFor(n);
        const fnLike = info.fnLike;
        const isLiteral = info.literal !== 0;
        const isScope = info.increasesNesting;
        const isFuncKw = n.kind === ts.SyntaxKind.FunctionKeyword;
        const isClassDefining = info.isClassDefining;
        const isBinding = introducesBinding(n);
        const topLevel = !!parentRaw && this.isSourceFile(parentRaw) && isTopLevelDecl(n);
        const symbolCall = this.policy.needSymbols === true && info.kind === NodeKind.Call;
        const isObservable = this.isObservableSyntax(
            fnLike,
            isClassDefining,
            isBinding,
            isScope,
            symbolCall,
            isFuncKw,
            topLevel,
        );

        if (this.shouldCollapseToPlaceholder(info, isLiteral, isFuncKw, n, isObservable)) {
            return OTHER_PLACEHOLDER;
        }

        const node = this.buildProjectedNode(
            n,
            info,
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
            n,
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
        info: TsKindInfo,
        isLiteral: boolean,
        isFuncKw: boolean,
        n: ts.Node,
    ): boolean {
        if (!info.special) return true;
        if (isLiteral && !this.policy.needLiterals) return true;
        if (isFuncKw && !this.policy.needComplexity) return true;
        if (
            n.kind === ts.SyntaxKind.BinaryExpression &&
            (n as ts.BinaryExpression).operatorToken.kind !== ts.SyntaxKind.EqualsToken
        ) {
            return true;
        }
        return false;
    }

    private shouldCollapseToPlaceholder(
        info: TsKindInfo,
        isLiteral: boolean,
        isFuncKw: boolean,
        n: ts.Node,
        isObservable: boolean,
    ): boolean {
        if (this.isPlaceholderFastPath(info, isLiteral, isFuncKw, n)) return true;
        if (isLiteral) return false;
        return !isObservable;
    }

    private resolveProjectedPositions(
        n: ts.Node,
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
            start: posOf(n.getStart(this.sf), this.sf),
            end: posOf(n.getEnd(), this.sf),
        };
    }

    private resolveProjectedName(
        n: ts.Node,
        isCall: boolean,
        wantsSymbols: boolean,
        declaration: boolean,
    ): string | undefined {
        if (isCall) return calleeNameOf(n, this.sf) ?? undefined;
        const needsName = (this.policy.needNames || wantsSymbols) && declaration;
        if (needsName) return nameOf(n, this.sf) ?? undefined;
        return undefined;
    }

    private resolveProjectedBindingName(
        n: ts.Node,
        isBinding: boolean,
        wantsSymbols: boolean,
        declaration: boolean,
    ): string | undefined {
        if (!isBinding) return undefined;
        const needsName = (this.policy.needNames || wantsSymbols) && declaration;
        if (needsName) return bindingName(n, this.sf) ?? undefined;
        return undefined;
    }

    private buildProjectedNode(
        n: ts.Node,
        info: TsKindInfo,
        fnLike: boolean,
        isLiteral: boolean,
        isScope: boolean,
        isFuncKw: boolean,
        isClassDefining: boolean,
        isBinding: boolean,
        topLevel: boolean,
    ): NormalizedNode {
        const isCall = info.kind === NodeKind.Call;
        const wantsSymbols = this.policy.needSymbols === true;
        const declaration = fnLike || isClassDefining || isBinding;
        const pos = this.resolveProjectedPositions(
            n,
            isCall,
            isLiteral,
            fnLike,
            isFuncKw,
            wantsSymbols,
            declaration,
        );

        const node: NormalizedNode = {
            kind: info.kind,
            rawKind: isFuncKw && this.policy.needComplexity ? 'FunctionKeyword' : undefined,
            text: isLiteral && this.policy.needLiterals ? n.getText(this.sf) : undefined,
            start: pos.start,
            end: pos.end,
            name: this.resolveProjectedName(n, isCall, wantsSymbols, declaration),
            functionLike: fnLike,
            isClassDefining,
            introducesBinding: isBinding,
            bindingName: this.resolveProjectedBindingName(n, isBinding, wantsSymbols, declaration),
            increasesNesting: isScope,
            isConstructor: Boolean(this.policy.needComplexity) && ts.isConstructorDeclaration(n),
            topLevel,
            exported:
                topLevel &&
                (hasExportModifier(n) || ts.isExportAssignment(n) || ts.isExportDeclaration(n)),
        };
        return node;
    }

    private applyProjectedMetadata(
        node: NormalizedNode,
        n: ts.Node,
        parentRaw: ts.Node | undefined,
        grandparentRaw: ts.Node | undefined,
        isLiteral: boolean,
        fnLike: boolean,
    ): void {
        if (isLiteral && this.policy.needLiterals) {
            node.isConstBound = isConstBoundOf(n, parentRaw, grandparentRaw);
            node.tolerated = isToleratedOf(n, parentRaw, this.sf);
        }
        if (this.policy.needComplexity && fnLike) {
            node.children = this.projectSubtree(n, parentRaw, grandparentRaw);
        }
    }

    /**
     * Iterate a raw node's children in materialized order.
     *
     * @param raw - Raw node whose children should be iterated.
     * @returns An iterable of non-skippable raw children in materialized order.
     */
    forEachChild(raw: unknown): Iterable<unknown> {
        const n = raw as ts.Node;
        if (this.policy.needComplexity && isFunctionLike(n)) {
            let kids = this.functionSubtrees.get(n);
            if (!kids) {
                kids = [];
                ts.forEachChild(n, (c) => {
                    if (!isSkippableToken(c)) kids!.push(c);
                });
                this.functionSubtrees.set(n, kids);
            }
            return kids;
        }
        if (this.policy.needComplexity) {
            const cached = this.rawChildrenCache.get(n);
            if (cached) return cached;
        }
        const kids: ts.Node[] = [];
        ts.forEachChild(n, (c) => {
            if (!isSkippableToken(c)) kids.push(c);
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
        ts.forEachChild(fn, (c) => {
            if (isSkippableToken(c)) return;
            rawChildren.push(c);
            if (rawOut) rawOut.push(c);
            const proj = this.cheapProject(c, fn, parentRaw);
            children.push(proj);
            if (!isFunctionLike(c)) {
                proj.children = this.buildSubtree(c, fn, null);
            }
        });
        if (rawChildren.length > 0) this.rawChildrenCache.set(fn, rawChildren);
        return children;
    }

    private applyCheapFunctionProps(node: NormalizedNode, n: ts.Node): void {
        if (this.policy.needNames) node.name = nameOf(n, this.sf);
        if (this.policy.needPositions) {
            node.start = posOf(n.getStart(this.sf), this.sf);
            node.end = posOf(n.getEnd(), this.sf);
        }
        if (this.policy.needComplexity) node.isConstructor = ts.isConstructorDeclaration(n);
    }

    private applyCheapNonFunctionProps(
        node: NormalizedNode,
        n: ts.Node,
        info: TsKindInfo,
        parentRaw: ts.Node | undefined,
        grandparentRaw: ts.Node | undefined,
        isLiteral: boolean,
    ): void {
        if (info.isClassDefining) {
            node.isClassDefining = true;
            if (this.policy.needNames) node.name = nameOf(n, this.sf);
        } else if (introducesBinding(n)) {
            node.introducesBinding = true;
            if (this.policy.needNames) node.bindingName = bindingName(n, this.sf);
        } else if (info.kind === NodeKind.Call) {
            node.name = calleeNameOf(n, this.sf) ?? undefined;
            node.start = posOf(n.getStart(this.sf), this.sf);
            node.end = posOf(n.getEnd(), this.sf);
        }
        if (isLiteral) {
            if (this.policy.needLiterals) {
                node.text = n.getText(this.sf);
                node.start = posOf(n.getStart(this.sf), this.sf);
                node.end = posOf(n.getEnd(), this.sf);
                node.isConstBound = isConstBoundOf(n, parentRaw, grandparentRaw);
                node.tolerated = isToleratedOf(n, parentRaw, this.sf);
            }
        } else if (n.kind === ts.SyntaxKind.FunctionKeyword) {
            if (this.policy.needComplexity) node.rawKind = 'FunctionKeyword';
            if (this.policy.needPositions) {
                node.start = posOf(n.getStart(this.sf), this.sf);
                node.end = posOf(n.getEnd(), this.sf);
            }
        }
    }

    private cheapProject(
        n: ts.Node,
        parentRaw: ts.Node | undefined,
        grandparentRaw: ts.Node | undefined,
    ): NormalizedNode {
        const info = kindInfoFor(n);
        const kind = info.kind;
        const fnLike = info.fnLike;
        const isLiteral = info.literal !== 0;
        const branchWeight =
            n.kind === ts.SyntaxKind.BinaryExpression ? branchWeightOf(n) : info.branch;

        const node: NormalizedNode = {
            kind,
            functionLike: fnLike,
            branchWeight,
            increasesNesting: info.increasesNesting,
            children: undefined,
        };

        if (fnLike) {
            this.applyCheapFunctionProps(node, n);
        } else {
            this.applyCheapNonFunctionProps(node, n, info, parentRaw, grandparentRaw, isLiteral);
        }

        if (!fnLike) this.subtreeCache.set(n, node);
        return node;
    }
}
