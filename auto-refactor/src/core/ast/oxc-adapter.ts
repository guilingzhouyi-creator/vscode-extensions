/**
 * Module: Core Engine — Parser Adapters (oxc fast path)
 * File Path: src/core/ast/oxc-adapter.ts
 * Architecture Role: Materializing LanguageAdapter plus lazy NodeProjector that map Rust
 *   oxc-parser ESTree nodes onto the shared NormalizedNode contract.
 * Dependencies & Triggers: Imports ./multilang, ./oxcTypes, ./oxcPredicates, ./oxcProjector,
 *   and lazy require('oxc-parser'); selected by parser:'oxc' / fast-path routing.
 * Responsibilities: Parse TS/TSX/JS/JSX/MJS/CJS and .d.ts files; map kinds, branch weights
 *   and semantic flags; apply export/method/binding compensations; serve lazy projection.
 * Exit Semantics & Design Rationale: Parse diagnostics are ignored so an AST is always
 *   returned; loads oxc-parser ESM module lazily to avoid overhead when unused.
 */

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
import type { OxcNode, Ctx, ParseSyncFn, OxcParseResult } from './oxc-types';
import {
    computeLineStarts,
    NODE_KIND_CLASS_DECLARATION,
    NODE_KIND_FUNCTION_EXPRESSION,
    NODE_KIND_METHOD_DEFINITION,
    NODE_KIND_PROPERTY,
    NODE_KIND_CLASS_EXPRESSION,
    NODE_KIND_EXPORT_NAMED_DECLARATION,
    NODE_KIND_EXPORT_DEFAULT_DECLARATION,
    TYPEOF_NUMBER,
    TYPEOF_STRING,
    TYPEOF_OBJECT,
    OXC_META_KEYS,
    OXC_LANGUAGE_JS,
    OXC_LANGUAGE_TS,
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
    oxcPosOf,
    oxcLiteralText,
} from './oxc-predicates';
import { OxcProjector } from './oxc-projector';

export { OxcProjector } from './oxc-projector';

// oxc-parser is ESM-only; load lazily so the default TypeScript path never requires it.
let _parseSync: ParseSyncFn | null = null;

function parseSyncSafe(
    filename: string,
    sourceText: string,
    options: Parameters<ParseSyncFn>[2],
): OxcParseResult {
    if (!_parseSync) {
        const mod = require('oxc-parser') as { parseSync: ParseSyncFn };
        _parseSync = mod.parseSync;
    }
    return _parseSync(filename, sourceText, options);
}

function resolveOxcLang(filePath: string): 'dts' | 'tsx' | 'jsx' | 'ts' | 'js' {
    if (filePath.endsWith('.d.ts')) return 'dts';
    if (/\.tsx$/i.test(filePath)) return 'tsx';
    if (/\.ts$/i.test(filePath)) return OXC_LANGUAGE_TS;
    if (/\.jsx$/i.test(filePath)) return 'jsx';
    return OXC_LANGUAGE_JS;
}

/**
 * Materializing oxc-backed `LanguageAdapter` for TS/TSX/JS/JSX/MJS/CJS and `.d.ts` files.
 *
 * The adapter holds no per-file state, so one instance can serve concurrent scans and worker
 * threads: every parse derives its own context and normalized tree. Parsing is synchronous and
 * returns an AST even when oxc reports diagnostics, mirroring `ts.createSourceFile`; an optional
 * incremental `ProjectionSeed` enables reuse of unchanged function subtrees.
 */
export class OxcAdapter implements LanguageAdapter {
    /** Adapter id used by the parser registry and config keys. */
    id = 'oxc' as const;
    /** Lowercase file extensions claimed by this adapter. */
    extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

    /**
     * Parse one file synchronously with oxc into the shared normalized AST contract.
     *
     * Parse diagnostics are intentionally ignored so the caller always receives an AST;
     * malformed input degrades to node kinds rather than throwing.
     *
     * @param content - Full source text of the file.
     * @param filePath - Path that selects the oxc language mode (`.d.ts`, tsx, ts, jsx, js).
     * @param seed - Optional incremental seed: when supplied, unchanged function subtrees may
     *   be reused and built subtrees are recorded for the next scan.
     * @returns Normalized AST whose root is the source-file node.
     */
    parse(content: string, filePath: string, seed?: ProjectionSeed): NormalizedAst {
        const lang = resolveOxcLang(filePath);
        const res = parseSyncSafe(filePath, content, {
            lang,
            sourceType: 'unambiguous',
            preserveParens: true,
        });
        const ctx: Ctx = { src: content, lineStarts: computeLineStarts(content) };
        const program = res.program;
        const root = this.mapNode(program, undefined, undefined, undefined, ctx, seed);
        const children: NormalizedNode[] = [];
        for (const stmt of program.body || []) {
            const mapped = this.mapTopStatement(stmt, program, ctx, seed);
            if (mapped) children.push(mapped);
        }
        root.children = children;
        return { root };
    }

    /**
     * Build a lazy-projection source for a file: parses ONCE with oxc (the ESTree
     * deserialization cannot be skipped) but does NOT materialize the normalized tree — the
     * OxcProjector projects nodes on demand and yields raw children lazily.
     *
     * @param content - Full source text of the file.
     * @param filePath - Path that selects the oxc language mode.
     * @param policy - Projection policy describing which normalized fields analyzers consume.
     * @returns An `OxcProjector` over the raw program; never `null` for supported extensions.
     */
    project(content: string, filePath: string, policy: ProjectionPolicy): NodeProjector | null {
        const lang = resolveOxcLang(filePath);
        const res = parseSyncSafe(filePath, content, {
            lang,
            sourceType: 'unambiguous',
            preserveParens: true,
        });
        return new OxcProjector(res.program, content, policy);
    }

    /**
     * Return the root node of a parsed AST.
     *
     * @param ast - Normalized AST produced by `parse`.
     * @returns The normalized source-file node at the top of the tree.
     */
    root(ast: NormalizedAst): NormalizedNode {
        return ast.root;
    }

    /**
     * Return the node's direct children for the engine's single-pass descent.
     *
     * @param node - Normalized node whose children are requested.
     * @returns Direct children in source order; nodes without children yield an empty array.
     */
    children(node: NormalizedNode): NormalizedNode[] {
        return node.children || [];
    }

    private mapTopStatement(
        stmt: OxcNode,
        program: OxcNode,
        ctx: Ctx,
        seed?: ProjectionSeed,
    ): NormalizedNode | null {
        if (
            (stmt.type === NODE_KIND_EXPORT_NAMED_DECLARATION ||
                stmt.type === NODE_KIND_EXPORT_DEFAULT_DECLARATION) &&
            stmt.declaration
        ) {
            stmt.declaration.__exported = true;
            return this.mapNode(stmt.declaration, program, undefined, stmt, ctx, seed);
        }
        return this.mapNode(stmt, program, undefined, undefined, ctx, seed);
    }

    private resolveStartOffset(
        n: OxcNode,
        fnLike: boolean,
        isClassDefining: boolean,
        exportWrapper: OxcNode | undefined,
    ): number {
        if ((fnLike || isClassDefining) && n.__exported && exportWrapper) {
            return exportWrapper.start;
        }
        return n.start;
    }

    private resolveNodePositions(
        n: OxcNode,
        startOff: number,
        isLiteral: boolean,
        fnLike: boolean,
        ctx: Ctx,
    ): { start?: Position; end?: Position } {
        if (!isLiteral && !fnLike) return {};
        return {
            start: oxcPosOf(startOff, ctx),
            end: oxcPosOf(n.end, ctx),
        };
    }

    private resolveNodeName(
        n: OxcNode,
        fnLike: boolean,
        isClassDefining: boolean,
        isBinding: boolean,
        ctx: Ctx,
    ): string | undefined {
        if (fnLike || isClassDefining || isBinding) {
            return oxcNameOf(n, ctx) ?? undefined;
        }
        return undefined;
    }

    private buildNormalizedNode(
        n: OxcNode,
        kind: NodeKind,
        fnLike: boolean,
        isLiteral: boolean,
        isClassDefining: boolean,
        isBinding: boolean,
        startOff: number,
        ctx: Ctx,
    ): NormalizedNode {
        const t = n.type;
        const pos = this.resolveNodePositions(n, startOff, isLiteral, fnLike, ctx);
        const node: NormalizedNode = {
            kind,
            rawKind: t,
            text: isLiteral ? oxcLiteralText(n, ctx) : undefined,
            start: pos.start,
            end: pos.end,
            name: this.resolveNodeName(n, fnLike, isClassDefining, isBinding, ctx),
            isNumeric: kind === NodeKind.NumericLiteral,
            isString: kind === NodeKind.StringLiteral,
            branchWeight: oxcBranchWeightOf(n),
            functionLike: fnLike,
            isClassDefining,
            introducesBinding: isBinding,
            bindingName: isBinding ? oxcBindingNameOf(n, ctx) : null,
            hasFunctionInitializer: isBinding,
            increasesNesting: CONTROL_OR_BLOCK.has(t) || t === 'StaticBlock',
            isConstructor: t === NODE_KIND_METHOD_DEFINITION && n.kind === 'constructor',
            children: [],
        };
        return node;
    }

    private applyNodeHierarchy(
        node: NormalizedNode,
        n: OxcNode,
        parent: OxcNode | undefined,
        grandparent: OxcNode | undefined,
        isLiteral: boolean,
        ctx: Ctx,
    ): void {
        const topLevel =
            Boolean(parent) && parent!.type === 'Program' && TOP_LEVEL_DECL.has(n.type);
        node.topLevel = topLevel;
        node.exported = topLevel && (Boolean(n.__exported) || n.type === 'TSExportAssignment');
        if (isLiteral) {
            node.isConstBound = oxcIsConstBoundOf(n, parent, grandparent);
            node.tolerated = oxcIsToleratedOf(n, parent, ctx);
        }
    }

    private tryReuseSubtree(
        node: NormalizedNode,
        n: OxcNode,
        fnLike: boolean,
        ctx: Ctx,
        seed?: ProjectionSeed,
    ): boolean {
        if (!seed || !fnLike) return false;
        const startPos = oxcPosOf(n.start, ctx);
        const span: ReusedSpan = {
            startLine: startPos.line,
            startColumn: startPos.column,
            startByte: n.start,
            endByte: n.end,
            sourceText: ctx.src.slice(n.start, n.end),
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
        n: OxcNode,
        ctx: Ctx,
        children: NormalizedNode[],
    ): void {
        if (!seed || !fnLike) return;
        const startPos = oxcPosOf(n.start, ctx);
        const span: ReusedSpan = {
            startLine: startPos.line,
            startColumn: startPos.column,
            startByte: n.start,
            endByte: n.end,
            sourceText: ctx.src.slice(n.start, n.end),
        };
        seed.cacheSubtree(span, children);
    }

    private traverseOxcChildren(
        node: NormalizedNode,
        n: OxcNode,
        parent: OxcNode | undefined,
        isMethodSource: boolean,
        ctx: Ctx,
        seed?: ProjectionSeed,
    ): void {
        for (const key of Object.keys(n)) {
            if (OXC_META_KEYS.has(key) || key === '__exported') continue;
            const v = n[key];
            if (v == null) continue;
            if (Array.isArray(v)) {
                for (const item of v) {
                    this.pushChild(node, item, n, parent, isMethodSource, ctx, seed);
                }
            } else if (typeof v === TYPEOF_OBJECT && typeof (v as OxcNode).type === TYPEOF_STRING) {
                this.pushChild(node, v as OxcNode, n, parent, isMethodSource, ctx, seed);
            }
        }
    }

    private mapNode(
        n: OxcNode,
        parent: OxcNode | undefined,
        grandparent: OxcNode | undefined,
        exportWrapper: OxcNode | undefined,
        ctx: Ctx,
        seed?: ProjectionSeed,
    ): NormalizedNode {
        const t = n.type;
        const isMethodSource =
            t === NODE_KIND_METHOD_DEFINITION || (t === NODE_KIND_PROPERTY && n.method === true);
        const kind = oxcKindOf(n);
        const fnLike = kind === NodeKind.Function || kind === NodeKind.Method;
        const isLiteral = kind === NodeKind.NumericLiteral || kind === NodeKind.StringLiteral;
        const isClassDefining =
            t === NODE_KIND_CLASS_DECLARATION || t === NODE_KIND_CLASS_EXPRESSION;
        const isBinding = oxcIntroducesBinding(n);

        const startOff = this.resolveStartOffset(n, fnLike, isClassDefining, exportWrapper);
        const node = this.buildNormalizedNode(
            n,
            kind,
            fnLike,
            isLiteral,
            isClassDefining,
            isBinding,
            startOff,
            ctx,
        );
        this.applyNodeHierarchy(node, n, parent, grandparent, isLiteral, ctx);

        if (this.tryReuseSubtree(node, n, fnLike, ctx, seed)) {
            return node;
        }

        this.traverseOxcChildren(node, n, parent, isMethodSource, ctx, seed);
        this.recordSpanCache(seed, fnLike, n, ctx, node.children || []);
        return node;
    }

    private pushMethodFunctionValue(
        node: NormalizedNode,
        item: OxcNode,
        oxcParent: OxcNode,
        ctx: Ctx,
        seed?: ProjectionSeed,
    ): void {
        for (const key of Object.keys(item)) {
            if (OXC_META_KEYS.has(key)) continue;
            const v = item[key];
            if (v == null) continue;
            if (Array.isArray(v)) {
                for (const sub of v) {
                    this.pushChild(node, sub, item, oxcParent, false, ctx, seed);
                }
            } else if (typeof v === TYPEOF_OBJECT && typeof (v as OxcNode).type === TYPEOF_STRING) {
                this.pushChild(node, v as OxcNode, item, oxcParent, false, ctx, seed);
            }
        }
    }

    private pushChild(
        node: NormalizedNode,
        item: OxcNode | null | undefined,
        oxcParent: OxcNode,
        oxcGrandparent: OxcNode | undefined,
        inlineFnValue: boolean,
        ctx: Ctx,
        seed?: ProjectionSeed,
    ): void {
        if (item == null) return;
        if (inlineFnValue && item.type === NODE_KIND_FUNCTION_EXPRESSION) {
            this.pushMethodFunctionValue(node, item, oxcParent, ctx, seed);
            return;
        }
        if (TYPE_SKIP_TYPES.has(item.type)) {
            this.collectLiteralsInType(item, node, ctx);
            return;
        }
        if (SKIP_TYPES.has(item.type)) return;
        if (item.type === 'ExportAllDeclaration') {
            if (item.source) {
                node.children!.push(
                    this.mapNode(item.source, oxcParent, oxcGrandparent, item, ctx, seed),
                );
            }
            return;
        }
        if (
            item.type === NODE_KIND_EXPORT_NAMED_DECLARATION ||
            item.type === NODE_KIND_EXPORT_DEFAULT_DECLARATION
        ) {
            if (item.declaration) {
                item.declaration.__exported = true;
                node.children!.push(
                    this.mapNode(item.declaration, oxcParent, oxcGrandparent, item, ctx, seed),
                );
            }
            return;
        }
        if (item.type === 'TSEnumBody') {
            for (const m of item.members || []) {
                this.pushChild(node, m, oxcParent, oxcGrandparent, false, ctx, seed);
            }
            return;
        }
        const child = this.mapNode(item, oxcParent, oxcGrandparent, undefined, ctx, seed);
        node.children!.push(child);
    }

    private collectLiteralsInType(typeNode: OxcNode, container: NormalizedNode, ctx: Ctx): void {
        const stack: OxcNode[] = [typeNode];
        while (stack.length) {
            const cur = stack.pop();
            if (cur == null) continue;
            if (cur.type === 'Literal') {
                const kind =
                    typeof cur.value === TYPEOF_STRING
                        ? NodeKind.StringLiteral
                        : typeof cur.value === TYPEOF_NUMBER
                          ? NodeKind.NumericLiteral
                          : NodeKind.Other;
                if (kind !== NodeKind.Other) {
                    container.children!.push({
                        kind,
                        rawKind: 'Literal',
                        text: oxcLiteralText(cur, ctx),
                        start: oxcPosOf(cur.start, ctx),
                        end: oxcPosOf(cur.end, ctx),
                        isNumeric: kind === NodeKind.NumericLiteral,
                        isString: kind === NodeKind.StringLiteral,
                        branchWeight: 0,
                        isConstBound: false,
                        tolerated: kind === NodeKind.NumericLiteral,
                        children: [],
                    });
                }
                continue;
            }
            const children: OxcNode[] = [];
            for (const k of Object.keys(cur)) {
                if (OXC_META_KEYS.has(k)) continue;
                const v = cur[k];
                if (v == null) continue;
                if (Array.isArray(v)) {
                    for (const x of v) {
                        if (x && typeof x === TYPEOF_OBJECT) children.push(x as OxcNode);
                    }
                } else if (typeof v === TYPEOF_OBJECT) {
                    children.push(v as OxcNode);
                }
            }
            for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
        }
    }
}
