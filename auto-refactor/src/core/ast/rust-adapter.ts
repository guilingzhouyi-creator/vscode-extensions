import type { NormalizedNode, NormalizedAst, LanguageAdapter } from './multilang';
import { NodeKind } from './multilang';
import type { TreeSitterNode, TreeSitterParser } from './tree-sitter-types';

/**
 * Module: Core Engine — Rust Language Adapter
 * File Path: src/core/ast/rust-adapter.ts
 * Architecture Role: LanguageAdapter implementation that translates a tree-sitter-rust CST
 *   into the normalized AST consumed by the shared single-pass traversal.
 * Dependencies & Triggers: imports the NodeKind / NormalizedNode / NormalizedAst /
 *   LanguageAdapter contracts from ./multilang; lazily requires tree-sitter and
 *   tree-sitter-rust inside parse(); triggered when a .rs file is routed to the Rust adapter
 *   in-process or in a worker.
 * Responsibilities: map tree-sitter node types to NodeKind; precompute semantic flags
 *   (functionLike, impl/struct/trait class definitions, topLevel, exported, binding,
 *   nesting, branch weight, constructor); carry literal text plus const-bound/tolerated
 *   flags; build normalized children arrays.
 * Exit Semantics & Design Rationale: parse is synchronous and throws if the native parser
 *   binding is unavailable; the lazy require keeps this module importable and confines Rust
 *   failures to Rust scans. A syntax-only CST is sufficient because the built-in analyzers
 *   are syntax-level, and the documented closure/macro tolerations mirror the TS adapter.
 */

// Lazily-initialized shared parser (safe: parse is synchronous, workers get their own copy).
let parser: TreeSitterParser | null = null;

/**
 * Lazily-initialize and return the shared tree-sitter-rust parser.
 *
 * Safe because `parse` is synchronous and every worker gets its own module copy.
 *
 * @returns the cached Parser instance; the first call requires the native bindings and
 * configures the Rust grammar, while later calls reuse the cached instance.
 */
function rustParser(): TreeSitterParser {
    if (!parser) {
        const Parser = require('tree-sitter');

        const Rust = require('tree-sitter-rust');
        const p = new Parser();
        p.setLanguage(Rust);
        parser = p as TreeSitterParser;
    }
    return parser;
}

/** tree-sitter-rust node type of an `impl` block (`impl Foo { ... }`). */
const NODE_KIND_IMPL_ITEM = 'impl_item';

const TOP_LEVEL_TYPES = new Set([
    'function_item',
    'struct_item',
    'enum_item',
    NODE_KIND_IMPL_ITEM,
    'trait_item',
    'const_item',
    'static_item',
    'use_declaration',
    'mod_item',
    'type_item',
    'union_item',
]);

const BRANCH_TYPES = new Set([
    'if_expression',
    'while_expression',
    'for_expression',
    'loop_expression',
    'match_expression',
    'match_arm',
]);

const NESTING_TYPES = new Set([
    'block',
    'if_expression',
    'while_expression',
    'for_expression',
    'loop_expression',
    'match_expression',
]);

const RUST_NODE_KIND_MAP: Readonly<Record<string, NodeKind>> = {
    source_file: NodeKind.SourceFile,
    closure_expression: NodeKind.Function,
    struct_item: NodeKind.Struct,
    [NODE_KIND_IMPL_ITEM]: NodeKind.Impl,
    trait_item: NodeKind.Trait,
    let_declaration: NodeKind.Variable,
    static_item: NodeKind.Variable,
    const_item: NodeKind.Constant,
    integer_literal: NodeKind.NumericLiteral,
    float_literal: NodeKind.NumericLiteral,
    string_literal: NodeKind.StringLiteral,
    char_literal: NodeKind.Literal,
    boolean_literal: NodeKind.Literal,
    call_expression: NodeKind.Call,
    binary_expression: NodeKind.BinaryExpr,
    block: NodeKind.Block,
};

const NUMERIC_TOLERATED_PARENTS = new Set(['index_expression', 'tuple_index_expression']);
const STRING_TOLERATED_PARENTS = new Set([
    'macro_invocation',
    'token_tree',
    'attribute_item',
    'attribute',
    'use_declaration',
    'use_wildcard',
]);
const CONST_BOUND_PARENTS = new Set(['const_item', 'static_item', 'enum_variant']);

/**
 * Rust LanguageAdapter translating a tree-sitter-rust CST into the shared normalized AST.
 *
 * Contract: `id` is `'rust'` and `extensions` is `['.rs']`, so the adapter registry routes
 * `.rs` files here; `parse` materializes the whole tree eagerly and `root` / `children`
 * expose it to the shared single-pass traversal without any further parsing.
 *
 * Failure semantics: `parse` is synchronous and throws when the native tree-sitter /
 * tree-sitter-rust binding cannot be loaded; the require is lazy, so importing this module
 * stays side-effect free and Rust binding failures are confined to Rust scans.
 */
export class RustAdapter implements LanguageAdapter {
    id = 'rust' as const;
    extensions = ['.rs'];

    /**
     * Parse Rust source text into a fully materialized normalized AST.
     *
     * @param content - raw Rust source text; CST positions are converted to 1-based
     * line/column coordinates for every node.
     * @param _filePath - accepted for LanguageAdapter symmetry and intentionally unused;
     * diagnostics carry the caller-supplied path instead of this argument.
     * @returns the normalized AST whose root is the synthetic source-file node.
     * @throws Error when the lazy `tree-sitter` / `tree-sitter-rust` require fails, for
     * example because the native binding is not installed; the parser cache stays unset so
     * a later call retries the require.
     */
    parse(content: string, _filePath: string): NormalizedAst {
        const tree = rustParser().parse(content);
        return { root: this.mapNode(tree.rootNode, undefined) };
    }

    /**
     * Return the root node of a parsed Rust AST.
     *
     * @param ast - normalized AST produced by `parse`.
     * @returns the source-file node that owns every top-level item.
     */
    root(ast: NormalizedAst): NormalizedNode {
        return ast.root;
    }

    /**
     * Return the normalized children of a node.
     *
     * @param node - any normalized node produced by this adapter.
     * @returns the child array in source order, or an empty array for leaves (whose
     * `children` field is intentionally left undefined to save allocations).
     */
    children(node: NormalizedNode): NormalizedNode[] {
        return node.children || [];
    }

    // ------------------------------------------------------------------ mapping

    /**
     * Recursively materialize one tree-sitter node and its named children.
     *
     * @param sn - raw tree-sitter node to map.
     * @param parent - raw parent used for top-level/export and literal-context flags.
     * @returns the normalized node with the exact field shape the analyzers consume,
     * including the precomputed binding and branching flags.
     */
    private mapNode(sn: TreeSitterNode, parent: TreeSitterNode | undefined): NormalizedNode {
        const kind = this.kindOf(sn, parent);
        const isLiteral = kind === NodeKind.NumericLiteral || kind === NodeKind.StringLiteral;
        const fnLike = kind === NodeKind.Function || kind === NodeKind.Method;
        const isClassDefining =
            kind === NodeKind.Impl || kind === NodeKind.Struct || kind === NodeKind.Trait;
        // The expensive introducesBinding predicate (a childForFieldName lookup) is computed
        // ONCE and reused by the three fields below, replacing three calls per node; `name`
        // is only materialized for the node classes the analyzers/engine consume.
        const isBinding = this.introducesBinding(sn);
        const name = fnLike || isClassDefining || isBinding ? this.nameOf(sn) : undefined;

        const node: NormalizedNode = {
            kind,
            rawKind: sn.type,
            // Literals carry their text (constants analyzer); other nodes skip it (lazy).
            text: isLiteral ? sn.text : undefined,
            start: { line: sn.startPosition.row + 1, column: sn.startPosition.column + 1 },
            end: { line: sn.endPosition.row + 1, column: sn.endPosition.column + 1 },
            name,
            isNumeric: kind === NodeKind.NumericLiteral,
            isString: kind === NodeKind.StringLiteral,
            branchWeight: this.branchWeightOf(sn),
            functionLike: fnLike,
            isClassDefining,
            introducesBinding: isBinding,
            bindingName: isBinding ? (name ?? null) : null,
            hasFunctionInitializer: isBinding,
            increasesNesting: NESTING_TYPES.has(sn.type),
            // Rust has no constructor keyword — every node is definitively not a constructor.
            // Written explicitly (not left absent) so rust nodes share the same property
            // insertion order / hidden class as the TS and oxc adapters, keeping a uniform
            // node shape across all adapters.
            isConstructor: false,
        };

        const topLevel = Boolean(
            parent && parent.type === 'source_file' && TOP_LEVEL_TYPES.has(sn.type),
        );
        node.topLevel = topLevel;
        node.exported =
            topLevel &&
            Boolean(
                sn.namedChildren?.some(
                    (c) => c.type === 'visibility_modifier' && Boolean(c.text?.startsWith('pub')),
                ),
            );

        if (isLiteral) {
            node.isConstBound = this.isConstBoundOf(sn, parent);
            node.tolerated = this.isToleratedOf(sn, parent);
        }

        // Only allocate a children array when the node has named children (leaves —
        // identifiers, literals, punctuation — keep `children` undefined), because the
        // engine and analyzers already consume via `node.children || []`.
        let kids: NormalizedNode[] | undefined;
        for (const c of sn.namedChildren || []) {
            (kids ??= []).push(this.mapNode(c, sn));
        }
        node.children = kids;
        return node;
    }

    /**
     * Map a tree-sitter node type to the normalized NodeKind.
     *
     * @param sn - raw tree-sitter node.
     * @param parent - raw parent; a function inside an impl/trait block becomes a method.
     * @returns the normalized kind, defaulting to `NodeKind.Other` for unmapped types and
     * to `NodeKind.ControlFlow` for the branch types listed in BRANCH_TYPES.
     */
    private kindOf(sn: TreeSitterNode, parent: TreeSitterNode | undefined): NodeKind {
        if (sn.type === 'function_item') {
            return parent && (parent.type === NODE_KIND_IMPL_ITEM || parent.type === 'trait_item')
                ? NodeKind.Method
                : NodeKind.Function;
        }
        const mapped = RUST_NODE_KIND_MAP[sn.type];
        if (mapped !== undefined) {
            return mapped;
        }
        if (BRANCH_TYPES.has(sn.type)) return NodeKind.ControlFlow;
        return NodeKind.Other;
    }

    /**
     * Compute the cyclomatic branch weight of a node.
     *
     * @param sn - raw tree-sitter node.
     * @returns `1` for branch constructs, the `?` operator and short-circuit `&&`/`||`
     * operators, otherwise `0`.
     */
    private branchWeightOf(sn: TreeSitterNode): number {
        if (BRANCH_TYPES.has(sn.type)) return 1;
        if (sn.type === 'try_expression') return 1; // `?` operator
        if (sn.type === 'binary_expression') {
            const op = sn.childForFieldName ? sn.childForFieldName('operator') : null;
            if (op && (op.text === '&&' || op.text === '||')) return 1;
        }
        return 0;
    }

    /**
     * Resolves binding identifier name from a let declaration pattern.
     *
     * @param sn - let declaration node.
     * @returns identifier text or null.
     */
    private resolveLetPatternName(sn: TreeSitterNode): string | null {
        const pat = sn.childForFieldName ? sn.childForFieldName('pattern') : null;
        if (!pat) return null;
        if (pat.type === 'identifier') return pat.text ?? null;
        const id = pat.namedChildren?.find((c) => c.type === 'identifier');
        return id?.text ?? null;
    }

    /**
     * Resolve the declared name of a node for naming consumers.
     *
     * Handles function/struct/trait names, `let` patterns and the implemented type of an
     * `impl` block.
     *
     * @param sn - raw tree-sitter node.
     * @returns the resolved non-empty name, or `null` when the node has no name.
     */
    private nameOf(sn: TreeSitterNode): string | null {
        const name = sn.childForFieldName ? sn.childForFieldName('name') : null;
        if (name && name.type === 'identifier') return name.text ?? null;
        if (sn.type === 'let_declaration') {
            return this.resolveLetPatternName(sn);
        }
        if (sn.type === NODE_KIND_IMPL_ITEM) {
            const ty = sn.childForFieldName ? sn.childForFieldName('type') : null;
            if (ty) return ty.text ?? null;
        }
        return null;
    }

    /**
     * `let x = |..| ...` — a closure bound to a name (mirrors TS `const x = () => ...`).
     *
     * @param sn - raw tree-sitter node.
     * @returns `true` when the node is a `let` declaration whose value is a closure.
     */
    private introducesBinding(sn: TreeSitterNode): boolean {
        if (sn.type !== 'let_declaration') return false;
        const val = sn.childForFieldName ? sn.childForFieldName('value') : null;
        return Boolean(val && val.type === 'closure_expression');
    }

    /**
     * Resolve whether a literal is const-bound.
     *
     * @param _sn - literal node to classify.
     * @param parent - raw parent; `undefined` means the literal has no parent context.
     * @returns `true` for literals under `const` / `static` items or enum variants.
     */
    private isConstBoundOf(_sn: TreeSitterNode, parent: TreeSitterNode | undefined): boolean {
        if (!parent) return false;
        return CONST_BOUND_PARENTS.has(parent.type);
    }

    /**
     * Resolve whether a literal sits in a tolerated context.
     *
     * @param sn - literal node to classify.
     * @param parent - raw parent; `undefined` means the literal has no parent context.
     * @returns `true` for index/tuple indices and macro/attribute/use contexts where the
     * constants analyzer must not report the literal.
     */
    private isToleratedOf(sn: TreeSitterNode, parent: TreeSitterNode | undefined): boolean {
        if (!parent) return false;
        if (sn.type === 'integer_literal' || sn.type === 'float_literal') {
            return NUMERIC_TOLERATED_PARENTS.has(parent.type);
        }
        return STRING_TOLERATED_PARENTS.has(parent.type);
    }
}
