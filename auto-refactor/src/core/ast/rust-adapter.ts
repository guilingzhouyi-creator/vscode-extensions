import type { NormalizedNode, NormalizedAst, LanguageAdapter, ProjectionSeed } from './multilang';
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

const MODULE_TREE_SITTER = 'tree-sitter';
const MODULE_TREE_SITTER_RUST = 'tree-sitter-rust';

const _ADAPTER_ID_RUST = 'rust';
const EXTENSION_RS = '.rs';

const FIELD_OPERATOR = 'operator';
const FIELD_PATTERN = 'pattern';
const FIELD_NAME = 'name';
const FIELD_TYPE = 'type';
const FIELD_VALUE = 'value';

const TYPE_SOURCE_FILE = 'source_file';
const TYPE_CLOSURE_EXPRESSION = 'closure_expression';
const TYPE_STRUCT_ITEM = 'struct_item';
const TYPE_TRAIT_ITEM = 'trait_item';
const TYPE_FUNCTION_ITEM = 'function_item';
const TYPE_LET_DECLARATION = 'let_declaration';
const TYPE_TRY_EXPRESSION = 'try_expression';
const TYPE_BINARY_EXPRESSION = 'binary_expression';
const TYPE_INTEGER_LITERAL = 'integer_literal';
const TYPE_FLOAT_LITERAL = 'float_literal';
const TYPE_IDENTIFIER = 'identifier';
const TYPE_VISIBILITY_MODIFIER = 'visibility_modifier';

const PREFIX_PUB = 'pub';
const OP_LOGICAL_AND = '&&';
const OP_LOGICAL_OR = '||';

/**
 * Lazily-initialize and return the shared tree-sitter-rust parser.
 *
 * Safe because `parse` is synchronous and every worker gets its own module copy.
 *
 * @returns the cached Parser instance; the first call requires the native bindings and
 * configures the Rust grammar, while later calls reuse the cached instance.
 */
function getRustParser(): TreeSitterParser {
    if (!parser) {
        const Parser = require(MODULE_TREE_SITTER);
        const Rust = require(MODULE_TREE_SITTER_RUST);
        const parserInstance = new Parser();
        parserInstance.setLanguage(Rust);
        parser = parserInstance as TreeSitterParser;
    }
    return parser;
}

/** tree-sitter-rust node type of an `impl` block (`impl Foo { ... }`). */
const NODE_KIND_IMPL_ITEM = 'impl_item';

const TOP_LEVEL_TYPES: ReadonlySet<string> = new Set([
    TYPE_FUNCTION_ITEM,
    TYPE_STRUCT_ITEM,
    'enum_item',
    NODE_KIND_IMPL_ITEM,
    TYPE_TRAIT_ITEM,
    'const_item',
    'static_item',
    'use_declaration',
    'mod_item',
    'type_item',
    'union_item',
]);

const BRANCH_TYPES: ReadonlySet<string> = new Set([
    'if_expression',
    'while_expression',
    'for_expression',
    'loop_expression',
    'match_expression',
    'match_arm',
]);

const NESTING_TYPES: ReadonlySet<string> = new Set([
    'block',
    'if_expression',
    'while_expression',
    'for_expression',
    'loop_expression',
    'match_expression',
]);

const RUST_NODE_KIND_MAP: ReadonlyMap<string, NodeKind> = new Map<string, NodeKind>([
    [TYPE_SOURCE_FILE, NodeKind.SourceFile],
    [TYPE_CLOSURE_EXPRESSION, NodeKind.Function],
    [TYPE_STRUCT_ITEM, NodeKind.Struct],
    [NODE_KIND_IMPL_ITEM, NodeKind.Impl],
    [TYPE_TRAIT_ITEM, NodeKind.Trait],
    [TYPE_LET_DECLARATION, NodeKind.Variable],
    ['static_item', NodeKind.Variable],
    ['const_item', NodeKind.Constant],
    [TYPE_INTEGER_LITERAL, NodeKind.NumericLiteral],
    [TYPE_FLOAT_LITERAL, NodeKind.NumericLiteral],
    ['string_literal', NodeKind.StringLiteral],
    ['char_literal', NodeKind.Literal],
    ['boolean_literal', NodeKind.Literal],
    ['call_expression', NodeKind.Call],
    [TYPE_BINARY_EXPRESSION, NodeKind.BinaryExpr],
    ['block', NodeKind.Block],
]);

const NUMERIC_TOLERATED_PARENTS: ReadonlySet<string> = new Set([
    'index_expression',
    'tuple_index_expression',
]);
const STRING_TOLERATED_PARENTS: ReadonlySet<string> = new Set([
    'macro_invocation',
    'token_tree',
    'attribute_item',
    'attribute',
    'use_declaration',
    'use_wildcard',
]);
const CONST_BOUND_PARENTS: ReadonlySet<string> = new Set([
    'const_item',
    'static_item',
    'enum_variant',
]);

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
    extensions = [EXTENSION_RS];

    parse(content: string, _filePath: string, _seed?: ProjectionSeed): NormalizedAst {
        const tree = getRustParser().parse(content);
        return { root: this.mapNode(tree.rootNode, undefined) };
    }

    root(ast: NormalizedAst): NormalizedNode {
        return ast.root;
    }

    children(node: NormalizedNode): NormalizedNode[] {
        return node.children || [];
    }

    // ------------------------------------------------------------------ mapping

    /**
     * Recursively materialize one tree-sitter node and its named children.
     *
     * @param syntaxNode - raw tree-sitter node to map.
     * @param parent - raw parent used for top-level/export and literal-context flags.
     * @returns the normalized node with the exact field shape the analyzers consume,
     * including the precomputed binding and branching flags.
     */
    private mapNode(
        syntaxNode: TreeSitterNode,
        parent: TreeSitterNode | undefined,
    ): NormalizedNode {
        const kind = this.getSyntaxNodeKind(syntaxNode, parent);
        const isLiteral = kind === NodeKind.NumericLiteral || kind === NodeKind.StringLiteral;
        const fnLike = kind === NodeKind.Function || kind === NodeKind.Method;
        const isClassDefining =
            kind === NodeKind.Impl || kind === NodeKind.Struct || kind === NodeKind.Trait;
        // The expensive introducesBinding predicate (a childForFieldName lookup) is computed
        // ONCE and reused by the three fields below, replacing three calls per node; `name`
        // is only materialized for the node classes the analyzers/engine consume.
        const isBinding = this.hasBindingIntroduction(syntaxNode);
        const name =
            fnLike || isClassDefining || isBinding ? this.getSyntaxNodeName(syntaxNode) : undefined;

        const node: NormalizedNode = {
            kind,
            rawKind: syntaxNode.type,
            // Literals carry their text (constants analyzer); other nodes skip it (lazy).
            text: isLiteral ? syntaxNode.text : undefined,
            start: {
                line: syntaxNode.startPosition.row + 1,
                column: syntaxNode.startPosition.column + 1,
            },
            end: {
                line: syntaxNode.endPosition.row + 1,
                column: syntaxNode.endPosition.column + 1,
            },
            name,
            isNumeric: kind === NodeKind.NumericLiteral,
            isString: kind === NodeKind.StringLiteral,
            branchWeight: this.getBranchWeight(syntaxNode),
            functionLike: fnLike,
            isClassDefining,
            introducesBinding: isBinding,
            bindingName: isBinding ? (name ?? null) : null,
            hasFunctionInitializer: isBinding,
            increasesNesting: NESTING_TYPES.has(syntaxNode.type),
            // Rust has no constructor keyword — every node is definitively not a constructor.
            // Written explicitly (not left absent) so rust nodes share the same property
            // insertion order / hidden class as the TS and oxc adapters, keeping a uniform
            // node shape across all adapters.
            isConstructor: false,
            parameters: fnLike ? extractRustParameters(syntaxNode) : undefined,
        };

        const exportStatus = checkRustExported(syntaxNode, parent);
        node.topLevel = exportStatus.topLevel;
        node.exported = exportStatus.exported;

        if (isLiteral) {
            node.isConstBound = this.isConstBound(syntaxNode, parent);
            node.tolerated = this.isToleratedContext(syntaxNode, parent);
        }

        node.children = this.mapChildren(syntaxNode);
        return node;
    }

    private mapChildren(syntaxNode: TreeSitterNode): NormalizedNode[] | undefined {
        const namedChildren = syntaxNode.namedChildren;
        if (!namedChildren || namedChildren.length === 0) {
            return undefined;
        }
        const childCount = namedChildren.length;
        const kids: NormalizedNode[] = [];
        for (let i = 0; i < childCount; i++) {
            kids.push(this.mapNode(namedChildren[i], syntaxNode));
        }
        return kids;
    }

    /**
     * Map a tree-sitter node type to the normalized NodeKind.
     *
     * @param syntaxNode - raw tree-sitter node.
     * @param parent - raw parent; a function inside an impl/trait block becomes a method.
     * @returns the normalized kind, defaulting to `NodeKind.Other` for unmapped types and
     * to `NodeKind.ControlFlow` for the branch types listed in BRANCH_TYPES.
     */
    private getSyntaxNodeKind(
        syntaxNode: TreeSitterNode,
        parent: TreeSitterNode | undefined,
    ): NodeKind {
        if (syntaxNode.type === TYPE_FUNCTION_ITEM) {
            const isMethod = Boolean(
                parent && (parent.type === NODE_KIND_IMPL_ITEM || parent.type === TYPE_TRAIT_ITEM),
            );
            return isMethod ? NodeKind.Method : NodeKind.Function;
        }
        const mapped = RUST_NODE_KIND_MAP.get(syntaxNode.type);
        if (mapped !== undefined) {
            return mapped;
        }
        return BRANCH_TYPES.has(syntaxNode.type) ? NodeKind.ControlFlow : NodeKind.Other;
    }

    /**
     * Compute the cyclomatic branch weight of a node.
     *
     * @param syntaxNode - raw tree-sitter node.
     * @returns `1` for branch constructs, the `?` operator and short-circuit `&&`/`||`
     * operators, otherwise `0`.
     */
    private getBranchWeight(syntaxNode: TreeSitterNode): number {
        if (BRANCH_TYPES.has(syntaxNode.type)) return 1;
        if (syntaxNode.type === TYPE_TRY_EXPRESSION) return 1; // `?` operator
        if (syntaxNode.type === TYPE_BINARY_EXPRESSION) {
            const operatorNode = syntaxNode.childForFieldName
                ? syntaxNode.childForFieldName(FIELD_OPERATOR)
                : null;
            if (
                operatorNode &&
                (operatorNode.text === OP_LOGICAL_AND || operatorNode.text === OP_LOGICAL_OR)
            ) {
                return 1;
            }
        }
        return 0;
    }

    /**
     * Resolves binding identifier name from a let declaration pattern.
     *
     * @param syntaxNode - let declaration node.
     * @returns identifier text or null.
     */
    private resolveLetPatternName(syntaxNode: TreeSitterNode): string | null {
        const patternNode = syntaxNode.childForFieldName
            ? syntaxNode.childForFieldName(FIELD_PATTERN)
            : null;
        if (!patternNode) return null;
        if (patternNode.type === TYPE_IDENTIFIER) return patternNode.text ?? null;
        const identifierNode = patternNode.namedChildren?.find(
            (child) => child.type === TYPE_IDENTIFIER,
        );
        return identifierNode?.text ?? null;
    }

    /**
     * Resolve the declared name of a node for naming consumers.
     *
     * Handles function/struct/trait names, `let` patterns and the implemented type of an
     * `impl` block.
     *
     * @param syntaxNode - raw tree-sitter node.
     * @returns the resolved non-empty name, or `null` when the node has no name.
     */
    private getSyntaxNodeName(syntaxNode: TreeSitterNode): string | null {
        const nameNode = syntaxNode.childForFieldName
            ? syntaxNode.childForFieldName(FIELD_NAME)
            : null;
        if (nameNode && nameNode.type === TYPE_IDENTIFIER) return nameNode.text ?? null;
        if (syntaxNode.type === TYPE_LET_DECLARATION) {
            return this.resolveLetPatternName(syntaxNode);
        }
        if (syntaxNode.type === NODE_KIND_IMPL_ITEM) {
            const syntaxType = syntaxNode.childForFieldName
                ? syntaxNode.childForFieldName(FIELD_TYPE)
                : null;
            if (syntaxType) return syntaxType.text ?? null;
        }
        return null;
    }

    /**
     * `let x = |..| ...` — a closure bound to a name (mirrors TS `const x = () => ...`).
     *
     * @param syntaxNode - raw tree-sitter node.
     * @returns `true` when the node is a `let` declaration whose value is a closure.
     */
    private hasBindingIntroduction(syntaxNode: TreeSitterNode): boolean {
        if (syntaxNode.type !== TYPE_LET_DECLARATION) return false;
        const bindingToken = syntaxNode.childForFieldName
            ? syntaxNode.childForFieldName(FIELD_VALUE)
            : null;
        return Boolean(bindingToken && bindingToken.type === TYPE_CLOSURE_EXPRESSION);
    }

    /**
     * Resolve whether a literal is const-bound.
     *
     * @param _syntaxNode - literal node to classify.
     * @param parent - raw parent; `undefined` means the literal has no parent context.
     * @returns `true` for literals under `const` / `static` items or enum variants.
     */
    private isConstBound(_syntaxNode: TreeSitterNode, parent: TreeSitterNode | undefined): boolean {
        return parent ? CONST_BOUND_PARENTS.has(parent.type) : false;
    }

    /**
     * Resolve whether a literal sits in a tolerated context.
     *
     * @param syntaxNode - literal node to classify.
     * @param parent - raw parent; `undefined` means the literal has no parent context.
     * @returns `true` for index/tuple indices and macro/attribute/use contexts where the
     * constants analyzer must not report the literal.
     */
    private isToleratedContext(
        syntaxNode: TreeSitterNode,
        parent: TreeSitterNode | undefined,
    ): boolean {
        if (!parent) return false;
        if (syntaxNode.type === TYPE_INTEGER_LITERAL || syntaxNode.type === TYPE_FLOAT_LITERAL) {
            return NUMERIC_TOLERATED_PARENTS.has(parent.type);
        }
        return STRING_TOLERATED_PARENTS.has(parent.type);
    }
}

/** Architectural alias preserving contract parity across naming conventions. */
export { RustAdapter as RustAstAdapter };

function checkRustExported(
    syntaxNode: TreeSitterNode,
    parent: TreeSitterNode | undefined,
): { topLevel: boolean; exported: boolean } {
    if (!parent || parent.type !== TYPE_SOURCE_FILE || !TOP_LEVEL_TYPES.has(syntaxNode.type)) {
        return { topLevel: false, exported: false };
    }
    const namedChildren = syntaxNode.namedChildren;
    if (!namedChildren || namedChildren.length === 0) {
        return { topLevel: true, exported: false };
    }
    for (let i = 0; i < namedChildren.length; i++) {
        const childNode = namedChildren[i];
        if (
            childNode.type === TYPE_VISIBILITY_MODIFIER &&
            childNode.text &&
            childNode.text.startsWith(PREFIX_PUB)
        ) {
            return { topLevel: true, exported: true };
        }
    }
    return { topLevel: true, exported: false };
}

function extractRustParamName(child: TreeSitterNode): string | undefined {
    const pat = child.childForFieldName ? child.childForFieldName('pattern') : null;
    if (pat?.text) {
        return pat.text;
    }
    const idNode = child.namedChildren?.find((c) => c.type === 'identifier');
    if (idNode?.text) {
        return idNode.text;
    }
    if (child.text) {
        return child.text.split(':')[0].trim();
    }
    return undefined;
}

function extractSingleRustParam(child: TreeSitterNode): string | undefined {
    if (child.type === 'self_parameter') {
        return 'self';
    }
    if (child.type === 'parameter') {
        return extractRustParamName(child);
    }
    return undefined;
}

function extractRustParameters(syntaxNode: TreeSitterNode): string[] | undefined {
    const paramsNode = syntaxNode.childForFieldName
        ? syntaxNode.childForFieldName('parameters')
        : syntaxNode.namedChildren?.find((c) => c.type === 'parameters');
    if (!paramsNode) return undefined;
    const names: string[] = [];
    const children = paramsNode.namedChildren || [];
    for (let i = 0; i < children.length; i++) {
        const paramName = extractSingleRustParam(children[i]);
        if (paramName) {
            names.push(paramName);
        }
    }
    return names;
}
