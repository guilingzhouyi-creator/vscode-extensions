/**
 * Module: Core Engine — Python Language Adapter
 * File Path: src/core/ast/python-adapter.ts
 * Architecture Role: LanguageAdapter implementation that translates a tree-sitter-python
 *     CST into the normalized AST consumed by the shared single-pass traversal.
 * Dependencies & Triggers: imports the NodeKind / NormalizedNode / NormalizedAst /
 *     LanguageAdapter contracts from ./multilang; lazily requires tree-sitter and
 *     tree-sitter-python inside parse(); triggered when a .py file is routed to the Python
 *     adapter in-process or in a worker.
 * Responsibilities: Map tree-sitter node types to NodeKind; precompute semantic flags
 *     (functionLike, class definitions, method-vs-function, topLevel/exported, binding,
 *     nesting, branch weight, const-bound and tolerated literals); carry literal text and
 *     build normalized children arrays.
 * Exit Semantics & Design Rationale: `parse` is synchronous and throws when the native
 *     binding cannot be loaded; the lazy require keeps this module importable and confines
 *     grammar failures to Python scans. A syntax-only CST is sufficient because every
 *     built-in analyzer is syntax-level; docstring/decorator/subscript/dict-key literals are
 *     tolerated so the constants analyzer reports real magic values instead of prose.
 */

import type { NormalizedNode, NormalizedAst, LanguageAdapter } from './multilang';
import { NodeKind } from './multilang';
import type { TreeSitterNode, TreeSitterParser } from './tree-sitter-types';
import {
    type MapContext,
    NESTING_TYPES,
    PY_ASSIGNMENT,
    branchWeightOf,
    callNameOf,
    introducesBinding,
    isAtomLiteral,
    isConstTarget,
    isPrivateName,
    isToleratedOf,
    isTopLevel,
    kindOfPythonNode,
    nameOf,
} from './python-adapter-helpers';

// Lazily-initialized shared parser (safe: parse is synchronous, workers get their own copy).
let parser: TreeSitterParser | null = null;

/**
 * Lazily initialize and return the shared tree-sitter-python parser.
 *
 * @returns The cached Parser configured with the Python grammar; the first call requires the
 *     native bindings, later calls reuse the same instance.
 */
function pythonParser(): TreeSitterParser {
    if (!parser) {
        const Parser = require('tree-sitter');
        const Python = require('tree-sitter-python');
        const p = new Parser();
        p.setLanguage(Python);
        parser = p as TreeSitterParser;
    }
    return parser;
}

/**
 * Python LanguageAdapter translating a tree-sitter-python CST into the shared normalized AST.
 *
 * Contract: `id` is `'python'` and `extensions` is `['.py']`, so the adapter registry routes
 * `.py` files here; `parse` materializes the whole tree eagerly and `root` / `children`
 * expose it to the shared single-pass traversal without any further parsing.
 */
function isPythonLiteralNode(kind: NodeKind, sn: TreeSitterNode): boolean {
    return (
        kind === NodeKind.NumericLiteral ||
        kind === NodeKind.StringLiteral ||
        (kind === NodeKind.Literal && isAtomLiteral(sn))
    );
}

function resolvePythonNodeName(
    sn: TreeSitterNode,
    kind: NodeKind,
    fnLike: boolean,
    isClassDefining: boolean,
    isBinding: boolean,
): string | undefined {
    if (sn.type === 'call') return callNameOf(sn) ?? undefined;
    const shouldName =
        fnLike ||
        isClassDefining ||
        isBinding ||
        kind === NodeKind.Variable ||
        kind === NodeKind.Constant;
    return shouldName ? (nameOf(sn) ?? undefined) : undefined;
}

function resolveChildMapContext(ctx: MapContext, sn: TreeSitterNode): MapContext {
    return {
        constBound: ctx.constBound || (sn.type === PY_ASSIGNMENT && isConstTarget(sn)),
    };
}

export class PythonAdapter implements LanguageAdapter {
    id = 'python' as const;
    extensions = ['.py'];

    /**
     * Parse Python source text into a fully materialized normalized AST.
     *
     * @param content - Raw Python source text; CST positions become 1-based line/column pairs.
     * @param _filePath - Accepted for LanguageAdapter symmetry; diagnostics carry the caller path.
     * @returns The normalized AST whose root is the synthetic module (source-file) node.
     * @throws Error when the lazy `tree-sitter` / `tree-sitter-python` require fails.
     */
    parse(content: string, _filePath: string): NormalizedAst {
        const tree = pythonParser().parse(content);
        return { root: this.mapNode(tree.rootNode, undefined, { constBound: false }) };
    }

    /**
     * Return the root node of a parsed Python AST.
     *
     * @param ast - Normalized AST produced by `parse`.
     * @returns The module node owning every top-level statement.
     */
    root(ast: NormalizedAst): NormalizedNode {
        return ast.root;
    }

    /**
     * Return the normalized children of a node.
     *
     * @param node - Any normalized node produced by this adapter.
     * @returns Child array in source order; leaves yield an empty array.
     */
    children(node: NormalizedNode): NormalizedNode[] {
        return node.children || [];
    }

    // ------------------------------------------------------------------ mapping

    /**
     * Recursively materialize one tree-sitter node and its named children.
     *
     * @param sn - Raw tree-sitter node to map.
     * @param parent - Raw parent used for literal-context and tolerated-context flags.
     * @param ctx - Inheritance context propagated from enclosing declarations.
     * @returns The normalized node with the exact field shape the analyzers consume.
     */
    private mapNode(
        sn: TreeSitterNode,
        parent: TreeSitterNode | undefined,
        ctx: MapContext,
    ): NormalizedNode {
        const kind = kindOfPythonNode(sn);
        const isLiteral = isPythonLiteralNode(kind, sn);
        const fnLike = kind === NodeKind.Function || kind === NodeKind.Method;
        const isClassDefining = kind === NodeKind.Class;
        const isBinding = introducesBinding(sn);
        const name = resolvePythonNodeName(sn, kind, fnLike, isClassDefining, isBinding);

        const node: NormalizedNode = {
            kind,
            rawKind: sn.type,
            // Literals carry their raw source text (constants analyzer reads it as the value).
            text: isLiteral ? sn.text : undefined,
            start: { line: sn.startPosition.row + 1, column: sn.startPosition.column + 1 },
            end: { line: sn.endPosition.row + 1, column: sn.endPosition.column + 1 },
            name,
            isNumeric: kind === NodeKind.NumericLiteral,
            isString: kind === NodeKind.StringLiteral,
            branchWeight: branchWeightOf(sn),
            functionLike: fnLike,
            isClassDefining,
            introducesBinding: isBinding,
            bindingName: isBinding ? (name ?? null) : null,
            hasFunctionInitializer: isBinding,
            increasesNesting: NESTING_TYPES.has(sn.type),
            // Python has no constructor keyword; `__init__` stays a plain Method so complexity
            // reports the idiomatic `Class.__init__` name instead of a synthetic "constructor".
            isConstructor: false,
        };

        const topLevel = isTopLevel(sn);
        node.topLevel = topLevel;
        node.exported = topLevel && !isPrivateName(nameOf(sn));

        if (isLiteral) {
            node.isConstBound = ctx.constBound || parent?.type === PY_ASSIGNMENT;
            node.tolerated = isToleratedOf(sn, parent);
        }

        const childCtx = resolveChildMapContext(ctx, sn);
        let kids: NormalizedNode[] | undefined;
        for (const c of sn.namedChildren || []) {
            const kid = this.mapNode(c, sn, childCtx);
            (kids ??= []).push(kid);
        }
        node.children = kids;
        return node;
    }
}
