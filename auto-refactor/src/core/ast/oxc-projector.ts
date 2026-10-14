/**
 * Module: Core Engine — Parser Adapters (oxc lazy projector)
 * File Path: src/core/ast/oxc-projector.ts
 * Architecture Role: Lazy NodeProjector for oxc-backed files, projecting raw ESTree nodes on
 *   demand and serving raw child sequences to the engine with Mode B subtree caching.
 * Dependencies & Triggers: Imports multilang contracts from ./multilang, node types from
 *   ./oxcTypes, and predicates from ./oxcPredicates; instantiated by OxcAdapter.project().
 * Responsibilities: Implement NodeProjector interface for lazy streaming descent; handle
 *   export flattening, child reflection, and Mode B eager function subtree caching.
 * Exit Semantics & Design Rationale: Throws nothing during projection; unsupported or non-
 *   observable nodes collapse to OTHER_PLACEHOLDER for maximum traversal performance.
 */

import type { NormalizedNode, Position, NodeProjector, ProjectionPolicy } from './multilang';
import { NodeKind, OTHER_PLACEHOLDER } from './multilang';
import type { OxcNode, Ctx } from './oxc-types';
import {
    computeLineStarts,
    NODE_KIND_CLASS_DECLARATION,
    NODE_KIND_CLASS_EXPRESSION,
    NODE_KIND_METHOD_DEFINITION,
    NODE_KIND_EXPORT_NAMED_DECLARATION,
    NODE_KIND_EXPORT_DEFAULT_DECLARATION,
    NODE_KIND_ASSIGNMENT_EXPRESSION,
    NODE_KIND_PROPERTY,
    NODE_KIND_FUNCTION_EXPRESSION,
    TYPEOF_NUMBER,
    TYPEOF_STRING,
    TYPEOF_OBJECT,
    OXC_META_KEYS,
    CONTROL_OR_BLOCK,
    TOP_LEVEL_DECL,
    SKIP_TYPES,
    TYPE_SKIP_TYPES,
} from './oxc-types';
import {
    oxcKindOf,
    oxcBranchWeightOf,
    oxcIntroducesBinding,
    oxcBindingNameOf,
    oxcNameOf,
    oxcIsConstBoundOf,
    oxcIsToleratedOf,
    oxcIsFnLikeNode,
    oxcPosOf,
    oxcLiteralText,
} from './oxc-predicates';

/** AST node type representing the root file program. */
const AST_NODE_PROGRAM = 'Program';

/** AST node type for static class initialization blocks. */
const AST_NODE_STATIC_BLOCK = 'StaticBlock';

/** AST node type representing binary expression operations. */
const AST_NODE_BINARY_EXPRESSION = 'BinaryExpression';

/** AST node type representing logical short-circuiting expressions. */
const AST_NODE_LOGICAL_EXPRESSION = 'LogicalExpression';

/** AST node type representing TypeScript export assignment syntax. */
const AST_NODE_TS_EXPORT_ASSIGNMENT = 'TSExportAssignment';

/** AST node type representing wildcard export declarations. */
const AST_NODE_EXPORT_ALL_DECLARATION = 'ExportAllDeclaration';

/** AST node type representing TypeScript enum body collections. */
const AST_NODE_TS_ENUM_BODY = 'TSEnumBody';

/** Special method kind identifier designating class constructors. */
const METHOD_KIND_CONSTRUCTOR = 'constructor';

/** Assignment operator symbol for standard value assignment. */
const ASSIGNMENT_OPERATOR_EQUAL = '=';

/** Internal metadata property tagging hoisted export status. */
const PROP_EXPORTED = '__exported';

/** Internal metadata property storing hoisted export start offset. */
const PROP_EXPORT_START = '__exportStart';

/** Structured parameter package for projecting normalized nodes. */
interface NodeProjectionContext {
    readonly rawNode: OxcNode;
    readonly kind: NodeKind;
    readonly fnLike: boolean;
    readonly isClassDefining: boolean;
    readonly isBinding: boolean;
    readonly isScope: boolean;
    readonly startOffset: number;
    readonly topLevel: boolean;
}

/** Structured context holding parent ancestry and classification flags for metadata projection. */
interface ProjectedMetadataOptions {
    readonly parentRaw?: OxcNode;
    readonly grandparentRaw?: OxcNode;
    readonly isLiteral: boolean;
    readonly fnLike: boolean;
}

/** Lineage context for cheap non-function node property assignment. */
interface NonFunctionLineage {
    readonly parentRaw?: OxcNode;
    readonly grandparentRaw?: OxcNode;
    readonly isLiteral: boolean;
}

/** Evaluation parameters for observable syntax detection. */
interface ObservableSyntaxFlags {
    readonly fnLike: boolean;
    readonly isClassDefining: boolean;
    readonly isBinding: boolean;
    readonly isScope: boolean;
    readonly topLevel: boolean;
}

/**
 * Lazy `NodeProjector` for oxc-backed files: projects raw ESTree nodes on demand and serves
 * raw child sequences to the engine, including Mode B subtree sharing with complexity.
 */
export class OxcProjector implements NodeProjector {
    /** Raw oxc Program node that roots every projection and child walk. */
    readonly root: unknown;
    private readonly ctx: Ctx;
    private readonly policy: ProjectionPolicy;
    /** Mode B: function raw node -> its direct non-skippable RAW children (engine descent). */
    private readonly functionSubtrees = new Map<OxcNode, OxcNode[]>();
    /** Mode B: raw subtree node -> projected subtree node (non-functionLike; engine + X share). */
    private readonly subtreeCache = new Map<OxcNode, NormalizedNode>();
    /** Mode B: raw subtree node -> its non-skippable RAW children (built once by buildSubtree). */
    private readonly rawChildrenCache = new Map<OxcNode, OxcNode[]>();

    /**
     * Wrap one raw oxc program in a lazy projector; no normalized tree is built here.\n     *
     * @param program - Raw oxc Program node produced by `parseSync`.
     * @param content - Source text used for line-start lookup and raw text slices.
     * @param policy - Projection policy that gates which normalized fields are constructed.
     */
    constructor(program: OxcNode, content: string, policy: ProjectionPolicy) {
        this.root = program;
        this.ctx = { src: content, lineStarts: computeLineStarts(content) };
        this.policy = policy;
    }

    /**
     * Test whether a raw node is this projector's program root.
     *
     * @param rawNode - Raw parser node to test.
     * @returns `true` only for the root Program node, `false` for nested nodes or `null`.
     */
    isSourceFile(rawNode: unknown): boolean {
        return Boolean(rawNode) && (rawNode as OxcNode).type === AST_NODE_PROGRAM;
    }

    /**
     * Project one raw oxc node on demand, consulting the Mode B subtree cache first.
     *
     * @param raw - Raw oxc node to project; it must belong to this projector's program tree.
     * @param parentRaw - Raw parent threaded by the engine, or `undefined` for the root.
     * @param grandparentRaw - Raw grandparent threaded by the engine, or `undefined` near the
     *   root; the engine's ancestry order is required for tolerated/const-bound predicates.
     * @returns The projected normalized node, possibly the shared `OTHER_PLACEHOLDER` singleton
     *   when the policy or node kind leaves no consumer-observable fields.
     */
    project(
        raw: unknown,
        parentRaw: unknown | undefined,
        grandparentRaw: unknown | undefined,
    ): NormalizedNode {
        const rawNode = raw as OxcNode;
        const cached = this.subtreeCache.get(rawNode);
        if (cached) return cached;
        if (this.isSourceFile(rawNode)) return { kind: NodeKind.SourceFile };

        const nodeType = rawNode.type;
        const kind = oxcKindOf(rawNode);
        const fnLike = kind === NodeKind.Function || kind === NodeKind.Method;
        const isLiteral = kind === NodeKind.NumericLiteral || kind === NodeKind.StringLiteral;
        const isClassDefining =
            nodeType === NODE_KIND_CLASS_DECLARATION || nodeType === NODE_KIND_CLASS_EXPRESSION;
        const isBinding = oxcIntroducesBinding(rawNode);
        const isScope = CONTROL_OR_BLOCK.has(nodeType) || nodeType === AST_NODE_STATIC_BLOCK;
        const topLevel =
            Boolean(parentRaw) && this.isSourceFile(parentRaw) && TOP_LEVEL_DECL.has(nodeType);
        const isObservable = this.isObservableSyntax({
            fnLike,
            isClassDefining,
            isBinding,
            isScope,
            topLevel,
        });

        if (this.shouldCollapseToPlaceholder(nodeType, isLiteral, isObservable, rawNode)) {
            return OTHER_PLACEHOLDER;
        }

        const startOffset = this.resolveProjectorStartOffset(rawNode, fnLike, isClassDefining);
        const normalizedTarget = this.buildProjectedNode({
            rawNode,
            kind,
            fnLike,
            isClassDefining,
            isBinding,
            isScope,
            startOffset,
            topLevel,
        });
        this.applyProjectedMetadata(normalizedTarget, rawNode, {
            parentRaw: parentRaw as OxcNode | undefined,
            grandparentRaw: grandparentRaw as OxcNode | undefined,
            isLiteral,
            fnLike,
        });
        return normalizedTarget;
    }

    private isObservableSyntax(flags: ObservableSyntaxFlags): boolean {
        const { fnLike, isClassDefining, isBinding, isScope, topLevel } = flags;
        return fnLike || isClassDefining || isBinding ? true : isScope || topLevel;
    }

    private shouldCollapseToPlaceholder(
        nodeType: string,
        isLiteral: boolean,
        isObservable: boolean,
        rawNode: OxcNode,
    ): boolean {
        if (isLiteral) return !this.policy.needLiterals;
        if (nodeType === AST_NODE_BINARY_EXPRESSION || nodeType === AST_NODE_LOGICAL_EXPRESSION) {
            return true;
        }
        if (nodeType === NODE_KIND_ASSIGNMENT_EXPRESSION) {
            return rawNode.operator !== ASSIGNMENT_OPERATOR_EQUAL;
        }
        return !isObservable;
    }

    private resolveProjectorStartOffset(
        rawNode: OxcNode,
        fnLike: boolean,
        isClassDefining: boolean,
    ): number {
        if (!fnLike && !isClassDefining) return rawNode.start;
        const hasExportedOffset =
            Boolean(rawNode[PROP_EXPORTED]) && typeof rawNode[PROP_EXPORT_START] === TYPEOF_NUMBER;
        return hasExportedOffset ? (rawNode[PROP_EXPORT_START] as number) : rawNode.start;
    }

    private resolveProjectedName(
        rawNode: OxcNode,
        fnLike: boolean,
        isClassDefining: boolean,
        isBinding: boolean,
    ): string | undefined {
        if (!this.policy.needNames) return undefined;
        if (fnLike || isClassDefining || isBinding) {
            return oxcNameOf(rawNode, this.ctx) ?? undefined;
        }
        return undefined;
    }

    private resolveProjectedBindingName(rawNode: OxcNode, isBinding: boolean): string | undefined {
        if (!this.policy.needNames || !isBinding) return undefined;
        return oxcBindingNameOf(rawNode, this.ctx) ?? undefined;
    }

    private resolveProjectedPositions(
        rawNode: OxcNode,
        startOffset: number,
        isLiteral: boolean,
        fnLike: boolean,
    ): { start?: Position; end?: Position } {
        if (!this.policy.needPositions) return {};
        if (!isLiteral && !fnLike) return {};
        return {
            start: oxcPosOf(startOffset, this.ctx),
            end: oxcPosOf(rawNode.end, this.ctx),
        };
    }

    private isConstructorMethod(rawNode: OxcNode): boolean {
        return (
            this.policy.needComplexity &&
            rawNode.type === NODE_KIND_METHOD_DEFINITION &&
            rawNode.kind === METHOD_KIND_CONSTRUCTOR
        );
    }

    private buildProjectedNode(ctx: NodeProjectionContext): NormalizedNode {
        const isLiteral =
            ctx.kind === NodeKind.NumericLiteral || ctx.kind === NodeKind.StringLiteral;
        const pos = this.resolveProjectedPositions(
            ctx.rawNode,
            ctx.startOffset,
            isLiteral,
            ctx.fnLike,
        );
        return {
            kind: ctx.kind,
            text:
                isLiteral && this.policy.needLiterals
                    ? oxcLiteralText(ctx.rawNode, this.ctx)
                    : undefined,
            start: pos.start,
            end: pos.end,
            name: this.resolveProjectedName(
                ctx.rawNode,
                ctx.fnLike,
                ctx.isClassDefining,
                ctx.isBinding,
            ),
            branchWeight: oxcBranchWeightOf(ctx.rawNode),
            functionLike: ctx.fnLike,
            isClassDefining: ctx.isClassDefining,
            introducesBinding: ctx.isBinding,
            bindingName: this.resolveProjectedBindingName(ctx.rawNode, ctx.isBinding),
            increasesNesting: ctx.isScope,
            isConstructor: this.isConstructorMethod(ctx.rawNode),
            topLevel: ctx.topLevel,
            exported:
                ctx.topLevel &&
                (Boolean(ctx.rawNode[PROP_EXPORTED]) ||
                    ctx.rawNode.type === AST_NODE_TS_EXPORT_ASSIGNMENT),
        };
    }

    private applyConstBoundAndTolerated(
        targetNode: NormalizedNode,
        rawNode: OxcNode,
        parentRaw?: OxcNode,
        grandparentRaw?: OxcNode,
    ): void {
        targetNode.isConstBound = oxcIsConstBoundOf(rawNode, parentRaw, grandparentRaw);
        targetNode.tolerated = oxcIsToleratedOf(rawNode, parentRaw, this.ctx, grandparentRaw);
    }

    private applyProjectedMetadata(
        projectedNode: NormalizedNode,
        rawNode: OxcNode,
        metaOpts: ProjectedMetadataOptions,
    ): void {
        const { parentRaw, grandparentRaw, isLiteral, fnLike } = metaOpts;
        if (isLiteral && this.policy.needLiterals) {
            this.applyConstBoundAndTolerated(projectedNode, rawNode, parentRaw, grandparentRaw);
        }
        if (this.policy.needComplexity && fnLike) {
            projectedNode.children = this.projectSubtree(rawNode, parentRaw, grandparentRaw);
        }
    }

    private flattenTopLevelExports(rawProgramNode: OxcNode): OxcNode[] {
        const outStatements: OxcNode[] = [];
        if (Array.isArray(rawProgramNode.body)) {
            for (const stmt of rawProgramNode.body) {
                if (
                    (stmt.type === NODE_KIND_EXPORT_NAMED_DECLARATION ||
                        stmt.type === NODE_KIND_EXPORT_DEFAULT_DECLARATION) &&
                    stmt.declaration
                ) {
                    stmt.declaration[PROP_EXPORTED] = true;
                    stmt.declaration[PROP_EXPORT_START] = stmt.start;
                    outStatements.push(stmt.declaration);
                } else {
                    outStatements.push(stmt);
                }
            }
        }
        return outStatements;
    }

    private resolveFunctionChildren(fnNode: OxcNode): OxcNode[] {
        let childNodes = this.functionSubtrees.get(fnNode);
        if (!childNodes) {
            childNodes = this.collectRawChildrenOf(fnNode);
            this.functionSubtrees.set(fnNode, childNodes);
        }
        return childNodes;
    }

    /**
     * Iterate a raw node's children in materialized order.
     *
     * @param raw - Raw parser node whose children the engine should descend next.
     * @returns Raw children in materialized source order.
     */
    forEachChild(raw: unknown): Iterable<unknown> {
        const rawNode = raw as OxcNode;
        if (this.isSourceFile(rawNode)) {
            return this.flattenTopLevelExports(rawNode);
        }
        if (this.policy.needComplexity && oxcIsFnLikeNode(rawNode)) {
            return this.resolveFunctionChildren(rawNode);
        }
        if (this.policy.needComplexity) {
            const cached = this.rawChildrenCache.get(rawNode);
            if (cached) return cached;
        }
        const childNodes = this.collectRawChildrenOf(rawNode);
        if (this.policy.needComplexity && childNodes.length > 0) {
            this.rawChildrenCache.set(rawNode, childNodes);
        }
        return childNodes;
    }

    private collectRawChildrenOf(rawNode: OxcNode): OxcNode[] {
        const childNodes: OxcNode[] = [];
        this.collectInto(rawNode, childNodes);
        return childNodes;
    }

    private collectNodeValue(
        outNodes: OxcNode[],
        childValue: unknown,
        isMethodSource: boolean,
    ): void {
        if (Array.isArray(childValue)) {
            for (const rawChildNode of childValue) {
                this.pushRaw(outNodes, rawChildNode, isMethodSource);
            }
        } else if (
            typeof childValue === TYPEOF_OBJECT &&
            typeof (childValue as OxcNode).type === TYPEOF_STRING
        ) {
            this.pushRaw(outNodes, childValue as OxcNode, isMethodSource);
        }
    }

    private collectInto(rawNode: OxcNode, outNodes: OxcNode[]): void {
        const isMethodSource =
            rawNode.type === NODE_KIND_METHOD_DEFINITION ||
            (rawNode.type === NODE_KIND_PROPERTY && rawNode.method === true);
        for (const metaKey of Object.keys(rawNode)) {
            if (
                OXC_META_KEYS.has(metaKey) ||
                metaKey === PROP_EXPORTED ||
                metaKey === PROP_EXPORT_START
            ) {
                continue;
            }
            const propValue = rawNode[metaKey];
            if (propValue != null) {
                this.collectNodeValue(outNodes, propValue, isMethodSource);
            }
        }
    }

    private tryHandleRawExport(outNodes: OxcNode[], rawExportNode: OxcNode): boolean {
        if (rawExportNode.type === AST_NODE_EXPORT_ALL_DECLARATION) {
            if (rawExportNode.source) outNodes.push(rawExportNode.source);
            return true;
        }
        if (
            rawExportNode.type === NODE_KIND_EXPORT_NAMED_DECLARATION ||
            rawExportNode.type === NODE_KIND_EXPORT_DEFAULT_DECLARATION
        ) {
            if (rawExportNode.declaration) {
                rawExportNode.declaration[PROP_EXPORTED] = true;
                rawExportNode.declaration[PROP_EXPORT_START] = rawExportNode.start;
                outNodes.push(rawExportNode.declaration);
            }
            return true;
        }
        return false;
    }

    private tryHandleRawSpecial(
        outNodes: OxcNode[],
        rawCandidateNode: OxcNode,
        inlineFnValue: boolean,
    ): boolean {
        if (inlineFnValue && rawCandidateNode.type === NODE_KIND_FUNCTION_EXPRESSION) {
            this.collectInto(rawCandidateNode, outNodes);
            return true;
        }
        if (TYPE_SKIP_TYPES.has(rawCandidateNode.type)) {
            outNodes.push(rawCandidateNode);
            return true;
        }
        if (SKIP_TYPES.has(rawCandidateNode.type)) return true;
        if (this.tryHandleRawExport(outNodes, rawCandidateNode)) return true;
        if (rawCandidateNode.type === AST_NODE_TS_ENUM_BODY) {
            if (Array.isArray(rawCandidateNode.members)) {
                for (const enumMember of rawCandidateNode.members) {
                    this.pushRaw(outNodes, enumMember, false);
                }
            }
            return true;
        }
        return false;
    }

    private pushRaw(
        outNodes: OxcNode[],
        rawCandidateNode: OxcNode | null | undefined,
        inlineFnValue: boolean,
    ): void {
        if (rawCandidateNode == null) return;
        if (this.tryHandleRawSpecial(outNodes, rawCandidateNode, inlineFnValue)) return;
        outNodes.push(rawCandidateNode);
    }

    private projectSubtree(
        fnNode: OxcNode,
        parentRaw: OxcNode | undefined,
        _grandparentRaw: OxcNode | undefined,
    ): NormalizedNode[] {
        const rawChildren: OxcNode[] = [];
        const children = this.buildSubtree(fnNode, parentRaw, rawChildren);
        this.functionSubtrees.set(fnNode, rawChildren);
        return children;
    }

    private buildSubtree(
        fnNode: OxcNode,
        parentRaw: OxcNode | undefined,
        rawOut: OxcNode[] | null,
    ): NormalizedNode[] {
        const projectedChildren: NormalizedNode[] = [];
        const rawChildren: OxcNode[] = [];
        for (const rawChild of this.collectRawChildrenOf(fnNode)) {
            rawChildren.push(rawChild);
            if (rawOut) rawOut.push(rawChild);
            const projectedChild = this.buildCheapProjectedNode(rawChild, fnNode, parentRaw);
            projectedChildren.push(projectedChild);
            if (!oxcIsFnLikeNode(rawChild)) {
                projectedChild.children = this.buildSubtree(rawChild, fnNode, null);
            }
        }
        if (rawChildren.length > 0) this.rawChildrenCache.set(fnNode, rawChildren);
        return projectedChildren;
    }

    private applyCheapFunctionProps(projectedNode: NormalizedNode, fnNode: OxcNode): void {
        if (this.policy.needNames) projectedNode.name = oxcNameOf(fnNode, this.ctx) ?? undefined;
        if (this.policy.needPositions) {
            projectedNode.start = oxcPosOf(fnNode.start, this.ctx);
            projectedNode.end = oxcPosOf(fnNode.end, this.ctx);
        }
        if (this.policy.needComplexity) {
            projectedNode.isConstructor =
                fnNode.type === NODE_KIND_METHOD_DEFINITION &&
                fnNode.kind === METHOD_KIND_CONSTRUCTOR;
        }
    }

    private applyNonFunctionProps(
        projectedNode: NormalizedNode,
        rawNode: OxcNode,
        lineage: NonFunctionLineage,
    ): void {
        const { parentRaw, grandparentRaw, isLiteral } = lineage;
        const nodeType = rawNode.type;
        if (nodeType === NODE_KIND_CLASS_DECLARATION || nodeType === NODE_KIND_CLASS_EXPRESSION) {
            projectedNode.isClassDefining = true;
            if (this.policy.needNames) {
                projectedNode.name = oxcNameOf(rawNode, this.ctx) ?? undefined;
            }
        } else if (oxcIntroducesBinding(rawNode)) {
            projectedNode.introducesBinding = true;
            if (this.policy.needNames) {
                projectedNode.bindingName = oxcBindingNameOf(rawNode, this.ctx) ?? undefined;
            }
        }
        if (isLiteral && this.policy.needLiterals) {
            projectedNode.text = oxcLiteralText(rawNode, this.ctx);
            projectedNode.start = oxcPosOf(rawNode.start, this.ctx);
            projectedNode.end = oxcPosOf(rawNode.end, this.ctx);
            this.applyConstBoundAndTolerated(projectedNode, rawNode, parentRaw, grandparentRaw);
        }
    }

    private buildCheapProjectedNode(
        rawNode: OxcNode,
        parentRaw: OxcNode | undefined,
        grandparentRaw: OxcNode | undefined,
    ): NormalizedNode {
        const nodeType = rawNode.type;
        const kind = oxcKindOf(rawNode);
        const fnLike = kind === NodeKind.Function || kind === NodeKind.Method;
        const isLiteral = kind === NodeKind.NumericLiteral || kind === NodeKind.StringLiteral;

        const cheapTarget: NormalizedNode = {
            kind,
            functionLike: fnLike,
            branchWeight: oxcBranchWeightOf(rawNode),
            increasesNesting: CONTROL_OR_BLOCK.has(nodeType) || nodeType === AST_NODE_STATIC_BLOCK,
            children: undefined,
        };

        if (fnLike) {
            this.applyCheapFunctionProps(cheapTarget, rawNode);
        } else {
            this.applyNonFunctionProps(cheapTarget, rawNode, {
                parentRaw,
                grandparentRaw,
                isLiteral,
            });
        }

        if (!fnLike) this.subtreeCache.set(rawNode, cheapTarget);
        return cheapTarget;
    }
}
