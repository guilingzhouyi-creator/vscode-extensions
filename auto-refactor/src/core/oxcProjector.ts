/**
 * Module: Core Engine — Parser Adapters (oxc lazy projector)
 * File Path: src/core/oxcProjector.ts
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
import type { OxcNode, Ctx } from './oxcTypes';
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
} from './oxcTypes';
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
} from './oxcPredicates';

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
     * Wrap one raw oxc program in a lazy projector; no normalized tree is built here.
     *
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
     * @param raw - Raw parser node to test.
     * @returns `true` only for the root Program node, `false` for nested nodes or `null`.
     */
    isSourceFile(raw: unknown): boolean {
        return Boolean(raw) && (raw as OxcNode).type === 'Program';
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
        const n = raw as OxcNode;
        const cached = this.subtreeCache.get(n);
        if (cached) return cached;
        if (this.isSourceFile(n)) return { kind: NodeKind.SourceFile };

        const t = n.type;
        const kind = oxcKindOf(n);
        const fnLike = kind === NodeKind.Function || kind === NodeKind.Method;
        const isLiteral = kind === NodeKind.NumericLiteral || kind === NodeKind.StringLiteral;
        const isClassDefining =
            t === NODE_KIND_CLASS_DECLARATION || t === NODE_KIND_CLASS_EXPRESSION;
        const isBinding = oxcIntroducesBinding(n);
        const isScope = CONTROL_OR_BLOCK.has(t) || t === 'StaticBlock';
        const topLevel =
            Boolean(parentRaw) && this.isSourceFile(parentRaw) && TOP_LEVEL_DECL.has(t);
        const isObservable = this.isObservableSyntax(
            fnLike,
            isClassDefining,
            isBinding,
            isScope,
            topLevel,
        );

        if (this.shouldCollapseToPlaceholder(t, isLiteral, isObservable, n)) {
            return OTHER_PLACEHOLDER;
        }

        const startOff = this.resolveProjectorStartOffset(n, fnLike, isClassDefining);
        const node = this.buildProjectedNode(
            n,
            kind,
            fnLike,
            isClassDefining,
            isBinding,
            isScope,
            startOff,
            topLevel,
        );
        this.applyProjectedMetadata(
            node,
            n,
            parentRaw as OxcNode | undefined,
            grandparentRaw as OxcNode | undefined,
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
        topLevel: boolean,
    ): boolean {
        if (fnLike || isClassDefining || isBinding) return true;
        return isScope || topLevel;
    }

    private shouldCollapseToPlaceholder(
        t: string,
        isLiteral: boolean,
        isObservable: boolean,
        n: OxcNode,
    ): boolean {
        if (isLiteral) return !this.policy.needLiterals;
        if (t === 'BinaryExpression' || t === 'LogicalExpression') return true;
        if (t === NODE_KIND_ASSIGNMENT_EXPRESSION) return n.operator !== '=';
        return !isObservable;
    }

    private resolveProjectorStartOffset(
        n: OxcNode,
        fnLike: boolean,
        isClassDefining: boolean,
    ): number {
        if (!fnLike && !isClassDefining) return n.start;
        if (n.__exported && typeof n.__exportStart === TYPEOF_NUMBER) {
            return n.__exportStart;
        }
        return n.start;
    }

    private resolveProjectedName(
        n: OxcNode,
        fnLike: boolean,
        isClassDefining: boolean,
        isBinding: boolean,
    ): string | undefined {
        if (!this.policy.needNames) return undefined;
        if (fnLike || isClassDefining || isBinding) {
            return oxcNameOf(n, this.ctx) ?? undefined;
        }
        return undefined;
    }

    private resolveProjectedBindingName(n: OxcNode, isBinding: boolean): string | undefined {
        if (!this.policy.needNames || !isBinding) return undefined;
        return oxcBindingNameOf(n, this.ctx) ?? undefined;
    }

    private resolveProjectedPositions(
        n: OxcNode,
        startOff: number,
        isLiteral: boolean,
        fnLike: boolean,
    ): { start?: Position; end?: Position } {
        if (!this.policy.needPositions) return {};
        if (!isLiteral && !fnLike) return {};
        return {
            start: oxcPosOf(startOff, this.ctx),
            end: oxcPosOf(n.end, this.ctx),
        };
    }

    private isConstructorMethod(n: OxcNode): boolean {
        return (
            this.policy.needComplexity &&
            n.type === NODE_KIND_METHOD_DEFINITION &&
            n.kind === 'constructor'
        );
    }

    private buildProjectedNode(
        n: OxcNode,
        kind: NodeKind,
        fnLike: boolean,
        isClassDefining: boolean,
        isBinding: boolean,
        isScope: boolean,
        startOff: number,
        topLevel: boolean,
    ): NormalizedNode {
        const isLiteral = kind === NodeKind.NumericLiteral || kind === NodeKind.StringLiteral;
        const pos = this.resolveProjectedPositions(n, startOff, isLiteral, fnLike);
        const node: NormalizedNode = {
            kind,
            text: isLiteral && this.policy.needLiterals ? oxcLiteralText(n, this.ctx) : undefined,
            start: pos.start,
            end: pos.end,
            name: this.resolveProjectedName(n, fnLike, isClassDefining, isBinding),
            branchWeight: oxcBranchWeightOf(n),
            functionLike: fnLike,
            isClassDefining,
            introducesBinding: isBinding,
            bindingName: this.resolveProjectedBindingName(n, isBinding),
            increasesNesting: isScope,
            isConstructor: this.isConstructorMethod(n),
            topLevel,
            exported: topLevel && (Boolean(n.__exported) || n.type === 'TSExportAssignment'),
        };
        return node;
    }

    private applyProjectedMetadata(
        node: NormalizedNode,
        n: OxcNode,
        parentRaw: OxcNode | undefined,
        grandparentRaw: OxcNode | undefined,
        isLiteral: boolean,
        fnLike: boolean,
    ): void {
        if (isLiteral && this.policy.needLiterals) {
            node.isConstBound = oxcIsConstBoundOf(n, parentRaw, grandparentRaw);
            node.tolerated = oxcIsToleratedOf(n, parentRaw, this.ctx);
        }
        if (this.policy.needComplexity && fnLike) {
            node.children = this.projectSubtree(n, parentRaw, grandparentRaw);
        }
    }

    private flattenTopLevelExports(n: OxcNode): OxcNode[] {
        const out: OxcNode[] = [];
        for (const stmt of n.body || []) {
            if (
                (stmt.type === NODE_KIND_EXPORT_NAMED_DECLARATION ||
                    stmt.type === NODE_KIND_EXPORT_DEFAULT_DECLARATION) &&
                stmt.declaration
            ) {
                stmt.declaration.__exported = true;
                stmt.declaration.__exportStart = stmt.start;
                out.push(stmt.declaration);
            } else {
                out.push(stmt);
            }
        }
        return out;
    }

    private resolveFunctionSubtreeKids(n: OxcNode): OxcNode[] {
        let kids = this.functionSubtrees.get(n);
        if (!kids) {
            kids = this.rawChildrenOf(n);
            this.functionSubtrees.set(n, kids);
        }
        return kids;
    }

    /**
     * Iterate a raw node's children in materialized order.
     *
     * @param raw - Raw parser node whose children the engine should descend next.
     * @returns Raw children in materialized source order.
     */
    forEachChild(raw: unknown): Iterable<unknown> {
        const n = raw as OxcNode;
        if (this.isSourceFile(n)) {
            return this.flattenTopLevelExports(n);
        }
        if (this.policy.needComplexity && oxcIsFnLikeNode(n)) {
            return this.resolveFunctionSubtreeKids(n);
        }
        if (this.policy.needComplexity) {
            const cached = this.rawChildrenCache.get(n);
            if (cached) return cached;
        }
        const kids = this.rawChildrenOf(n);
        if (this.policy.needComplexity && kids.length > 0) this.rawChildrenCache.set(n, kids);
        return kids;
    }

    private rawChildrenOf(n: OxcNode): OxcNode[] {
        const out: OxcNode[] = [];
        this.collectInto(n, out);
        return out;
    }

    private collectInto(n: OxcNode, out: OxcNode[]): void {
        const isMethodSource =
            n.type === NODE_KIND_METHOD_DEFINITION ||
            (n.type === NODE_KIND_PROPERTY && n.method === true);
        for (const key of Object.keys(n)) {
            if (OXC_META_KEYS.has(key) || key === '__exported' || key === '__exportStart') continue;
            const v = n[key];
            if (v == null) continue;
            if (Array.isArray(v)) {
                for (const item of v) this.pushRaw(out, item, isMethodSource);
            } else if (typeof v === TYPEOF_OBJECT && typeof (v as OxcNode).type === TYPEOF_STRING) {
                this.pushRaw(out, v as OxcNode, isMethodSource);
            }
        }
    }

    private pushRaw(
        out: OxcNode[],
        item: OxcNode | null | undefined,
        inlineFnValue: boolean,
    ): void {
        if (item == null) return;
        if (inlineFnValue && item.type === NODE_KIND_FUNCTION_EXPRESSION) {
            this.collectInto(item, out);
            return;
        }
        if (TYPE_SKIP_TYPES.has(item.type)) {
            out.push(item);
            return;
        }
        if (SKIP_TYPES.has(item.type)) return;
        if (item.type === 'ExportAllDeclaration') {
            if (item.source) out.push(item.source);
            return;
        }
        if (
            item.type === NODE_KIND_EXPORT_NAMED_DECLARATION ||
            item.type === NODE_KIND_EXPORT_DEFAULT_DECLARATION
        ) {
            if (item.declaration) {
                item.declaration.__exported = true;
                item.declaration.__exportStart = item.start;
                out.push(item.declaration);
            }
            return;
        }
        if (item.type === 'TSEnumBody') {
            for (const m of item.members || []) this.pushRaw(out, m, false);
            return;
        }
        out.push(item);
    }

    private projectSubtree(
        fn: OxcNode,
        parentRaw: OxcNode | undefined,
        _grandparentRaw: OxcNode | undefined,
    ): NormalizedNode[] {
        const rawChildren: OxcNode[] = [];
        const children = this.buildSubtree(fn, parentRaw, rawChildren);
        this.functionSubtrees.set(fn, rawChildren);
        return children;
    }

    private buildSubtree(
        fn: OxcNode,
        parentRaw: OxcNode | undefined,
        rawOut: OxcNode[] | null,
    ): NormalizedNode[] {
        const children: NormalizedNode[] = [];
        const rawChildren: OxcNode[] = [];
        for (const c of this.rawChildrenOf(fn)) {
            rawChildren.push(c);
            if (rawOut) rawOut.push(c);
            const proj = this.cheapProject(c, fn, parentRaw);
            children.push(proj);
            if (!oxcIsFnLikeNode(c)) {
                proj.children = this.buildSubtree(c, fn, null);
            }
        }
        if (rawChildren.length > 0) this.rawChildrenCache.set(fn, rawChildren);
        return children;
    }

    private applyCheapFunctionProps(node: NormalizedNode, n: OxcNode): void {
        if (this.policy.needNames) node.name = oxcNameOf(n, this.ctx) ?? undefined;
        if (this.policy.needPositions) {
            node.start = oxcPosOf(n.start, this.ctx);
            node.end = oxcPosOf(n.end, this.ctx);
        }
        if (this.policy.needComplexity) {
            node.isConstructor = n.type === NODE_KIND_METHOD_DEFINITION && n.kind === 'constructor';
        }
    }

    private applyCheapNonFunctionProps(
        node: NormalizedNode,
        n: OxcNode,
        parentRaw: OxcNode | undefined,
        grandparentRaw: OxcNode | undefined,
        isLiteral: boolean,
    ): void {
        const t = n.type;
        if (t === NODE_KIND_CLASS_DECLARATION || t === NODE_KIND_CLASS_EXPRESSION) {
            node.isClassDefining = true;
            if (this.policy.needNames) node.name = oxcNameOf(n, this.ctx) ?? undefined;
        } else if (oxcIntroducesBinding(n)) {
            node.introducesBinding = true;
            if (this.policy.needNames)
                node.bindingName = oxcBindingNameOf(n, this.ctx) ?? undefined;
        }
        if (isLiteral && this.policy.needLiterals) {
            node.text = oxcLiteralText(n, this.ctx);
            node.start = oxcPosOf(n.start, this.ctx);
            node.end = oxcPosOf(n.end, this.ctx);
            node.isConstBound = oxcIsConstBoundOf(n, parentRaw, grandparentRaw);
            node.tolerated = oxcIsToleratedOf(n, parentRaw, this.ctx);
        }
    }

    private cheapProject(
        n: OxcNode,
        parentRaw: OxcNode | undefined,
        grandparentRaw: OxcNode | undefined,
    ): NormalizedNode {
        const t = n.type;
        const kind = oxcKindOf(n);
        const fnLike = kind === NodeKind.Function || kind === NodeKind.Method;
        const isLiteral = kind === NodeKind.NumericLiteral || kind === NodeKind.StringLiteral;

        const node: NormalizedNode = {
            kind,
            functionLike: fnLike,
            branchWeight: oxcBranchWeightOf(n),
            increasesNesting: CONTROL_OR_BLOCK.has(t) || t === 'StaticBlock',
            children: undefined,
        };

        if (fnLike) {
            this.applyCheapFunctionProps(node, n);
        } else {
            this.applyCheapNonFunctionProps(node, n, parentRaw, grandparentRaw, isLiteral);
        }

        if (!fnLike) this.subtreeCache.set(n, node);
        return node;
    }
}
