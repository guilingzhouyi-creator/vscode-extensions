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
import { createRequire } from 'node:module';
import { OxcProjector } from './oxc-projector';

export { OxcProjector } from './oxc-projector';

const dynamicRequire = createRequire(__filename);

const MODULE_OXC_PARSER = 'oxc-parser';
const EXT_DTS = '.d.ts';
const LANG_TSX = 'tsx';
const LANG_JSX = 'jsx';
const LANG_DTS = 'dts';
const SOURCE_TYPE_UNAMBIGUOUS = 'unambiguous';
const KIND_STATIC_BLOCK = 'StaticBlock';
const KIND_CONSTRUCTOR = 'constructor';
const KIND_PROGRAM = 'Program';
const KIND_TS_EXPORT_ASSIGNMENT = 'TSExportAssignment';
const KIND_EXPORT_ALL_DECLARATION = 'ExportAllDeclaration';
const KIND_TS_ENUM_BODY = 'TSEnumBody';
const KIND_LITERAL = 'Literal';
const PROP_EXPORTED = '__exported';

// oxc-parser is ESM-only; load lazily so the default TypeScript path never requires it.
let _parseSync: ParseSyncFn | null = null;

function parseSyncSafe(
    filename: string,
    sourceText: string,
    options: Parameters<ParseSyncFn>[2],
): OxcParseResult {
    if (!_parseSync) {
        const oxcModule = dynamicRequire(MODULE_OXC_PARSER) as { parseSync: ParseSyncFn };
        _parseSync = oxcModule.parseSync;
    }
    return _parseSync(filename, sourceText, options);
}

function resolveOxcLang(filePath: string): 'dts' | 'tsx' | 'jsx' | 'ts' | 'js' {
    if (filePath.endsWith(EXT_DTS)) return LANG_DTS;
    if (/\.tsx$/i.test(filePath)) return LANG_TSX;
    if (/\.ts$/i.test(filePath)) return OXC_LANGUAGE_TS;
    return /\.jsx$/i.test(filePath) ? LANG_JSX : OXC_LANGUAGE_JS;
}

function executeOxcParse(filePath: string, content: string): OxcParseResult {
    const lang = resolveOxcLang(filePath);
    return parseSyncSafe(filePath, content, {
        lang,
        sourceType: SOURCE_TYPE_UNAMBIGUOUS,
        preserveParens: true,
    });
}

interface ParseContext {
    readonly ctx: Ctx;
    readonly seed?: ProjectionSeed;
}

interface NodeClassification {
    readonly rawNode: OxcNode;
    readonly kind: NodeKind;
    readonly isFunctionLike: boolean;
    readonly isLiteral: boolean;
    readonly isClassDefining: boolean;
    readonly introducesBinding: boolean;
    readonly startOffset: number;
}

interface NodeHierarchyContext {
    readonly targetNode: NormalizedNode;
    readonly rawNode: OxcNode;
    readonly parent?: OxcNode;
    readonly grandparent?: OxcNode;
    readonly isLiteral: boolean;
    readonly ctx: Ctx;
}

interface ChildDispatchConfig {
    readonly oxcParent: OxcNode;
    readonly oxcGrandparent?: OxcNode;
    readonly inlineFnValue: boolean;
}

interface ChildTraversalOptions {
    readonly targetNode: NormalizedNode;
    readonly rawNode: OxcNode;
    readonly oxcParent?: OxcNode;
    readonly isMethodSource: boolean;
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
        const parseResult = executeOxcParse(filePath, content);
        const ctx: Ctx = { src: content, lineStarts: computeLineStarts(content) };
        const program = parseResult.program;
        const parseContext: ParseContext = { ctx, seed };
        const root = this.mapNode(program, {}, parseContext);
        const children: NormalizedNode[] = [];
        if (Array.isArray(program.body)) {
            for (const stmt of program.body) {
                const mapped = this.mapTopStatement(stmt, program, parseContext);
                if (mapped) children.push(mapped);
            }
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
        const parseResult = executeOxcParse(filePath, content);
        return new OxcProjector(parseResult.program, content, policy);
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
        parseContext: ParseContext,
    ): NormalizedNode | null {
        if (
            (stmt.type === NODE_KIND_EXPORT_NAMED_DECLARATION ||
                stmt.type === NODE_KIND_EXPORT_DEFAULT_DECLARATION) &&
            stmt.declaration
        ) {
            stmt.declaration[PROP_EXPORTED] = true;
            return this.mapNode(
                stmt.declaration,
                { parent: program, exportWrapper: stmt },
                parseContext,
            );
        }
        return this.mapNode(stmt, { parent: program }, parseContext);
    }

    private resolveStartOffset(
        rawNode: OxcNode,
        isFunctionLike: boolean,
        isClassDefining: boolean,
        exportWrapper?: OxcNode,
    ): number {
        if ((isFunctionLike || isClassDefining) && rawNode[PROP_EXPORTED] && exportWrapper) {
            return exportWrapper.start;
        }
        return rawNode.start;
    }

    private resolveNodePositions(
        rawNode: OxcNode,
        classification: NodeClassification,
        ctx: Ctx,
    ): { start?: Position; end?: Position } {
        const { kind, isLiteral, isFunctionLike, startOffset } = classification;
        const needsPos =
            isLiteral || isFunctionLike || kind === NodeKind.SourceFile || kind === NodeKind.Class;
        if (!needsPos) return {};
        return {
            start: oxcPosOf(startOffset, ctx),
            end: oxcPosOf(rawNode.end, ctx),
        };
    }

    private resolveNodeName(
        rawNode: OxcNode,
        classification: NodeClassification,
        ctx: Ctx,
    ): string | undefined {
        const { kind, isFunctionLike, isClassDefining, introducesBinding } = classification;
        if (isFunctionLike || isClassDefining || introducesBinding) {
            return oxcNameOf(rawNode, ctx) ?? undefined;
        }
        if (kind === NodeKind.Variable || kind === NodeKind.Constant) {
            return oxcNameOf(rawNode, ctx) ?? undefined;
        }
        return undefined;
    }

    private buildNormalizedNode(classification: NodeClassification, ctx: Ctx): NormalizedNode {
        const { rawNode, kind, isFunctionLike, isLiteral, isClassDefining, introducesBinding } =
            classification;
        const rawType = rawNode.type;
        const pos = this.resolveNodePositions(rawNode, classification, ctx);
        const node: NormalizedNode = {
            kind,
            rawKind: rawType,
            text: isLiteral ? oxcLiteralText(rawNode, ctx) : undefined,
            start: pos.start,
            end: pos.end,
            name: this.resolveNodeName(rawNode, classification, ctx),
            isNumeric: kind === NodeKind.NumericLiteral,
            isString: kind === NodeKind.StringLiteral,
            branchWeight: oxcBranchWeightOf(rawNode),
            functionLike: isFunctionLike,
            isClassDefining,
            introducesBinding,
            bindingName: introducesBinding ? oxcBindingNameOf(rawNode, ctx) : null,
            hasFunctionInitializer: introducesBinding,
            increasesNesting: CONTROL_OR_BLOCK.has(rawType) || rawType === KIND_STATIC_BLOCK,
            isConstructor:
                rawType === NODE_KIND_METHOD_DEFINITION && rawNode.kind === KIND_CONSTRUCTOR,
            children: [],
        };
        return node;
    }

    private applyNodeHierarchy(context: NodeHierarchyContext): void {
        const { targetNode, rawNode, parent, grandparent, isLiteral, ctx } = context;
        const isTopLevel =
            Boolean(parent) && parent!.type === KIND_PROGRAM && TOP_LEVEL_DECL.has(rawNode.type);
        targetNode.topLevel = isTopLevel;
        targetNode.exported =
            isTopLevel &&
            (Boolean(rawNode[PROP_EXPORTED]) || rawNode.type === KIND_TS_EXPORT_ASSIGNMENT);
        if (isLiteral) {
            targetNode.isConstBound = oxcIsConstBoundOf(rawNode, parent, grandparent);
            targetNode.tolerated = oxcIsToleratedOf(rawNode, parent, ctx, grandparent);
        }
    }

    private computeReusedSpan(rawNode: OxcNode, ctx: Ctx): ReusedSpan {
        const startPos = oxcPosOf(rawNode.start, ctx);
        return {
            startLine: startPos.line,
            startColumn: startPos.column,
            startByte: rawNode.start,
            endByte: rawNode.end,
            sourceText: ctx.src.slice(rawNode.start, rawNode.end),
        };
    }

    private tryReuseSubtree(
        targetNode: NormalizedNode,
        rawNode: OxcNode,
        isFunctionLike: boolean,
        parseContext: ParseContext,
    ): boolean {
        const { ctx, seed } = parseContext;
        if (!seed || !isFunctionLike) return false;
        const span = this.computeReusedSpan(rawNode, ctx);
        const reused = seed.reuseSubtree(span);
        if (reused) {
            targetNode.children = reused;
            seed.cacheSubtree(span, reused);
            if (seed.markReused) seed.markReused(targetNode, span);
            return true;
        }
        return false;
    }

    private recordSpanCache(
        parseContext: ParseContext,
        isFunctionLike: boolean,
        rawNode: OxcNode,
        children: NormalizedNode[],
    ): void {
        const { ctx, seed } = parseContext;
        if (!seed || !isFunctionLike) return;
        const span = this.computeReusedSpan(rawNode, ctx);
        seed.cacheSubtree(span, children);
    }

    private traverseOxcChildren(options: ChildTraversalOptions, parseContext: ParseContext): void {
        const { targetNode, rawNode, oxcParent, isMethodSource } = options;
        for (const propKey of Object.keys(rawNode)) {
            if (OXC_META_KEYS.has(propKey) || propKey === PROP_EXPORTED) continue;
            const propertyValue = rawNode[propKey];
            if (propertyValue == null) continue;
            const dispatchConfig: ChildDispatchConfig = {
                oxcParent: rawNode,
                oxcGrandparent: oxcParent,
                inlineFnValue: isMethodSource,
            };
            if (Array.isArray(propertyValue)) {
                for (const childNode of propertyValue) {
                    this.pushChild(targetNode, childNode, dispatchConfig, parseContext);
                }
            } else if (
                typeof propertyValue === TYPEOF_OBJECT &&
                typeof (propertyValue as OxcNode).type === TYPEOF_STRING
            ) {
                this.pushChild(targetNode, propertyValue as OxcNode, dispatchConfig, parseContext);
            }
        }
    }

    private mapNode(
        rawNode: OxcNode,
        hierarchy: { parent?: OxcNode; grandparent?: OxcNode; exportWrapper?: OxcNode },
        parseContext: ParseContext,
    ): NormalizedNode {
        const rawType = rawNode.type;
        const isMethodSource =
            rawType === NODE_KIND_METHOD_DEFINITION ||
            (rawType === NODE_KIND_PROPERTY && rawNode.method === true);
        const kind = oxcKindOf(rawNode);
        const isFunctionLike = kind === NodeKind.Function || kind === NodeKind.Method;
        const isLiteral = kind === NodeKind.NumericLiteral || kind === NodeKind.StringLiteral;
        const isClassDefining =
            rawType === NODE_KIND_CLASS_DECLARATION || rawType === NODE_KIND_CLASS_EXPRESSION;
        const introducesBinding = oxcIntroducesBinding(rawNode);

        const startOffset = this.resolveStartOffset(
            rawNode,
            isFunctionLike,
            isClassDefining,
            hierarchy.exportWrapper,
        );
        const classification: NodeClassification = {
            rawNode,
            kind,
            isFunctionLike,
            isLiteral,
            isClassDefining,
            introducesBinding,
            startOffset,
        };

        const targetNode = this.buildNormalizedNode(classification, parseContext.ctx);
        const hierarchyContext: NodeHierarchyContext = {
            targetNode,
            rawNode,
            parent: hierarchy.parent,
            grandparent: hierarchy.grandparent,
            isLiteral,
            ctx: parseContext.ctx,
        };
        this.applyNodeHierarchy(hierarchyContext);

        if (this.tryReuseSubtree(targetNode, rawNode, isFunctionLike, parseContext)) {
            return targetNode;
        }

        const traversalOptions: ChildTraversalOptions = {
            targetNode,
            rawNode,
            oxcParent: hierarchy.parent,
            isMethodSource,
        };
        this.traverseOxcChildren(traversalOptions, parseContext);
        this.recordSpanCache(parseContext, isFunctionLike, rawNode, targetNode.children || []);
        return targetNode;
    }

    pushMethodFunctionValue(
        targetNode: NormalizedNode,
        oxcChildNode: OxcNode,
        oxcParent: OxcNode,
        parseContext: ParseContext,
    ): void {
        const dispatchConfig: ChildDispatchConfig = {
            oxcParent: oxcChildNode,
            oxcGrandparent: oxcParent,
            inlineFnValue: false,
        };
        for (const propKey of Object.keys(oxcChildNode)) {
            if (OXC_META_KEYS.has(propKey)) continue;
            const propertyValue = oxcChildNode[propKey];
            if (propertyValue == null) continue;
            if (Array.isArray(propertyValue)) {
                for (const subChildNode of propertyValue) {
                    this.pushChild(targetNode, subChildNode, dispatchConfig, parseContext);
                }
            } else if (
                typeof propertyValue === TYPEOF_OBJECT &&
                typeof (propertyValue as OxcNode).type === TYPEOF_STRING
            ) {
                this.pushChild(targetNode, propertyValue as OxcNode, dispatchConfig, parseContext);
            }
        }
    }

    pushChild(
        targetNode: NormalizedNode,
        oxcChildNode: OxcNode | null | undefined,
        config: ChildDispatchConfig,
        parseContext: ParseContext,
    ): void {
        if (oxcChildNode == null) return;
        if (this.tryHandleSpecialChild(targetNode, oxcChildNode, config, parseContext)) {
            return;
        }
        const child = this.mapNode(
            oxcChildNode,
            { parent: config.oxcParent, grandparent: config.oxcGrandparent },
            parseContext,
        );
        targetNode.children!.push(child);
    }

    private tryHandleExportChild(
        targetNode: NormalizedNode,
        oxcChildNode: OxcNode,
        config: ChildDispatchConfig,
        parseContext: ParseContext,
    ): boolean {
        const hierarchy = {
            parent: config.oxcParent,
            grandparent: config.oxcGrandparent,
            exportWrapper: oxcChildNode,
        };
        if (oxcChildNode.type === KIND_EXPORT_ALL_DECLARATION) {
            if (oxcChildNode.source) {
                targetNode.children!.push(
                    this.mapNode(oxcChildNode.source, hierarchy, parseContext),
                );
            }
            return true;
        }
        if (
            oxcChildNode.type === NODE_KIND_EXPORT_NAMED_DECLARATION ||
            oxcChildNode.type === NODE_KIND_EXPORT_DEFAULT_DECLARATION
        ) {
            if (oxcChildNode.declaration) {
                oxcChildNode.declaration[PROP_EXPORTED] = true;
                targetNode.children!.push(
                    this.mapNode(oxcChildNode.declaration, hierarchy, parseContext),
                );
            }
            return true;
        }
        return false;
    }

    private tryHandleSpecialChild(
        targetNode: NormalizedNode,
        oxcChildNode: OxcNode,
        config: ChildDispatchConfig,
        parseContext: ParseContext,
    ): boolean {
        if (config.inlineFnValue && oxcChildNode.type === NODE_KIND_FUNCTION_EXPRESSION) {
            this.pushMethodFunctionValue(targetNode, oxcChildNode, config.oxcParent, parseContext);
            return true;
        }
        if (TYPE_SKIP_TYPES.has(oxcChildNode.type)) {
            this.collectLiteralsInType(oxcChildNode, targetNode, parseContext.ctx);
            return true;
        }
        if (SKIP_TYPES.has(oxcChildNode.type)) return true;
        if (this.tryHandleExportChild(targetNode, oxcChildNode, config, parseContext)) {
            return true;
        }
        if (oxcChildNode.type === KIND_TS_ENUM_BODY) {
            if (Array.isArray(oxcChildNode.members)) {
                for (const enumMember of oxcChildNode.members) {
                    this.pushChild(targetNode, enumMember, config, parseContext);
                }
            }
            return true;
        }
        return false;
    }

    private tryCollectLiteralInType(
        rawNode: OxcNode,
        container: NormalizedNode,
        ctx: Ctx,
    ): boolean {
        if (rawNode.type !== KIND_LITERAL) return false;
        const kind =
            typeof rawNode.value === TYPEOF_STRING
                ? NodeKind.StringLiteral
                : typeof rawNode.value === TYPEOF_NUMBER
                  ? NodeKind.NumericLiteral
                  : NodeKind.Other;
        if (kind !== NodeKind.Other) {
            container.children!.push({
                kind,
                rawKind: KIND_LITERAL,
                text: oxcLiteralText(rawNode, ctx),
                start: oxcPosOf(rawNode.start, ctx),
                end: oxcPosOf(rawNode.end, ctx),
                isNumeric: kind === NodeKind.NumericLiteral,
                isString: kind === NodeKind.StringLiteral,
                branchWeight: 0,
                isConstBound: false,
                tolerated: kind === NodeKind.NumericLiteral,
                children: [],
            });
        }
        return true;
    }

    private pushOxcChildrenToStack(rawNode: OxcNode, stack: OxcNode[]): void {
        const children: OxcNode[] = [];
        for (const propKey of Object.keys(rawNode)) {
            if (OXC_META_KEYS.has(propKey)) continue;
            const propertyValue = rawNode[propKey];
            if (propertyValue == null) continue;
            if (Array.isArray(propertyValue)) {
                for (const arrayElement of propertyValue) {
                    if (arrayElement && typeof arrayElement === TYPEOF_OBJECT) {
                        children.push(arrayElement as OxcNode);
                    }
                }
            } else if (typeof propertyValue === TYPEOF_OBJECT) {
                children.push(propertyValue as OxcNode);
            }
        }
        for (let index = children.length - 1; index >= 0; index--) {
            stack.push(children[index]);
        }
    }

    collectLiteralsInType(typeNode: OxcNode, container: NormalizedNode, ctx: Ctx): void {
        const stack: OxcNode[] = [typeNode];
        while (stack.length) {
            const currentItem = stack.pop();
            if (currentItem == null) continue;
            if (this.tryCollectLiteralInType(currentItem, container, ctx)) continue;
            this.pushOxcChildrenToStack(currentItem, stack);
        }
    }
}
