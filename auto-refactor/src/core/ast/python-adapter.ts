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

import { BaseAstAdapter, NodeKind, type NormalizedNode, type NormalizedAst } from './multilang';
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
    if (parser !== null) return parser;
    const Parser = require('tree-sitter'); // @lazy deferred load of optional native binding
    const Python = require('tree-sitter-python'); // @lazy deferred load of Python grammar
    const tsParser = new Parser();
    tsParser.setLanguage(Python);
    parser = tsParser as TreeSitterParser;
    return parser;
}

/**
 * Python LanguageAdapter translating a tree-sitter-python CST into the shared normalized AST.
 *
 * Contract: `id` is `'python'` and `extensions` is `['.py']`, so the adapter registry routes
 * `.py` files here; `parse` materializes the whole tree eagerly and `root` / `children`
 * expose it to the shared single-pass traversal without any further parsing.
 */
function isPythonLiteralNode(kind: NodeKind, sitterNode: TreeSitterNode): boolean {
    return (
        kind === NodeKind.NumericLiteral ||
        kind === NodeKind.StringLiteral ||
        (kind === NodeKind.Literal && isAtomLiteral(sitterNode))
    );
}

interface PythonNodeNameOptions {
    sitterNode: TreeSitterNode;
    kind: NodeKind;
    fnLike: boolean;
    isClassDefining: boolean;
    isBinding: boolean;
}

function resolvePythonNodeName(options: PythonNodeNameOptions): string | undefined {
    const { sitterNode, kind, fnLike, isClassDefining, isBinding } = options;
    if (sitterNode.type === 'call') return callNameOf(sitterNode) ?? undefined;
    const shouldName =
        fnLike ||
        isClassDefining ||
        isBinding ||
        kind === NodeKind.Variable ||
        kind === NodeKind.Constant;
    return shouldName ? (nameOf(sitterNode) ?? undefined) : undefined;
}

function resolveChildMapContext(ctx: MapContext, sitterNode: TreeSitterNode): MapContext {
    const fnLike = sitterNode.type === 'function_definition';
    const name = fnLike ? nameOf(sitterNode) : null;
    const isTestFn =
        ctx.isTestFunction ||
        Boolean(name && /^(?:test_|_assert_|assert_|selftest|_test)/i.test(name));
    return {
        constBound:
            ctx.constBound || (sitterNode.type === PY_ASSIGNMENT && isConstTarget(sitterNode)),
        isTestFunction: isTestFn,
    };
}

const PARAM_PATTERN_TYPES = new Set([
    'typed_parameter',
    'default_parameter',
    'typed_default_parameter',
]);

const SPLAT_PATTERN_TYPES = new Set(['list_splat_pattern', 'dictionary_splat_pattern']);

function extractTypedOrDefaultPythonParam(child: TreeSitterNode): string | undefined {
    const idNode = child.childForFieldName
        ? child.childForFieldName('name')
        : child.namedChildren?.find((childNode) => childNode.type === 'identifier');
    if (idNode?.text) return idNode.text;
    if (child.text) return child.text.split(/[:=]/)[0].trim();
    return undefined;
}

function extractSinglePythonParam(child: TreeSitterNode): string | undefined {
    if (child.type === 'identifier') {
        return child.text || undefined;
    }
    if (PARAM_PATTERN_TYPES.has(child.type)) {
        return extractTypedOrDefaultPythonParam(child);
    }
    if (SPLAT_PATTERN_TYPES.has(child.type)) {
        return child.text || undefined;
    }
    return undefined;
}

function extractPythonParameters(sitterNode: TreeSitterNode): string[] | undefined {
    const paramsNode = sitterNode.childForFieldName
        ? sitterNode.childForFieldName('parameters')
        : null;
    const resolvedParamsNode =
        paramsNode ??
        sitterNode.namedChildren?.find((childNode) => childNode.type === 'parameters');
    if (!resolvedParamsNode) return undefined;

    const extractedParams: string[] = [];
    const children = resolvedParamsNode.namedChildren || [];
    for (let i = 0; i < children.length; i++) {
        const paramName = extractSinglePythonParam(children[i]);
        if (paramName) extractedParams.push(paramName);
    }
    return extractedParams;
}

/**
 * Language adapter projecting Python syntax into normalized
 * language-agnostic AST using Tree-sitter.
 */
export class PythonAdapter extends BaseAstAdapter {
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

    // ------------------------------------------------------------------ mapping

    /**
     * Recursively materialize one tree-sitter node and its named children.
     *
     * @param sitterNode - Raw tree-sitter node to map.
     * @param parent - Raw parent used for literal-context and tolerated-context flags.
     * @param ctx - Inheritance context propagated from enclosing declarations.
     * @returns The normalized node with the exact field shape the analyzers consume.
     */
    private mapNode(
        sitterNode: TreeSitterNode,
        parent: TreeSitterNode | undefined,
        ctx: MapContext,
    ): NormalizedNode {
        const kind = kindOfPythonNode(sitterNode);
        const isLiteral = isPythonLiteralNode(kind, sitterNode);
        const fnLike = kind === NodeKind.Function || kind === NodeKind.Method;
        const isClassDefining = kind === NodeKind.Class;
        const isBinding = introducesBinding(sitterNode);
        const name = resolvePythonNodeName({ sitterNode, kind, fnLike, isClassDefining, isBinding });

        const node: NormalizedNode = {
            kind,
            rawKind: sitterNode.type,
            // Literals carry their raw source text (constants analyzer reads it as the value).
            text: isLiteral ? sitterNode.text : undefined,
            start: {
                line: sitterNode.startPosition.row + 1,
                column: sitterNode.startPosition.column + 1,
            },
            end: {
                line: sitterNode.endPosition.row + 1,
                column: sitterNode.endPosition.column + 1,
            },
            name,
            isNumeric: kind === NodeKind.NumericLiteral,
            isString: kind === NodeKind.StringLiteral,
            branchWeight: branchWeightOf(sitterNode),
            functionLike: fnLike,
            isClassDefining,
            introducesBinding: isBinding,
            bindingName: isBinding ? (name ?? null) : null,
            hasFunctionInitializer: isBinding,
            increasesNesting: NESTING_TYPES.has(sitterNode.type),
            // Python has no constructor keyword; `__init__` stays a plain Method so complexity
            // reports the idiomatic `Class.__init__` name instead of a synthetic "constructor".
            isConstructor: false,
            parameters: fnLike ? extractPythonParameters(sitterNode) : undefined,
        };

        const topLevel = isTopLevel(sitterNode);
        node.topLevel = topLevel;
        node.exported = topLevel && !isPrivateName(nameOf(sitterNode));

        if (isLiteral) {
            node.isConstBound = ctx.constBound || parent?.type === PY_ASSIGNMENT;
            node.tolerated = isToleratedOf(sitterNode, parent, ctx);
        }

        const childCtx = resolveChildMapContext(ctx, sitterNode);
        const namedChildren = sitterNode.namedChildren;
        if (namedChildren && namedChildren.length > 0) {
            const kids: NormalizedNode[] = [];
            for (let i = 0; i < namedChildren.length; i++) {
                kids.push(this.mapNode(namedChildren[i], sitterNode, childCtx));
            }
            node.children = kids;
        }
        return node;
    }
}
