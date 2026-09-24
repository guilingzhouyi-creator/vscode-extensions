/**
 * Module: Core Engine — Python Language Adapter Helpers
 * File Path: src/core/ast/python-adapter-helpers.ts
 * Architecture Role: Classification constants and AST node inspection helpers for PythonAdapter.
 * Dependencies & Triggers: Consumes TreeSitterNode and NodeKind; called exclusively by
 *     PythonAdapter.
 * Responsibilities: Resolve node kinds, branch weights, bindings, top-level flags, and
 *     tolerated contexts.
 * Exit Semantics & Design Rationale: Pure stateless functions with zero side-effects; extracted
 *     to maintain physical line boundaries (< 400 lines) and avoid naked any in CST traversal.
 */

import { NodeKind } from './multilang';
import type { TreeSitterNode } from './tree-sitter-types';

/** Branch constructs that each add one to a function's cyclomatic complexity. */
export const BRANCH_TYPES = new Set([
    'if_statement',
    'elif_clause',
    'for_statement',
    'while_statement',
    'except_clause',
    'case_clause',
    'conditional_expression',
    'boolean_operator',
    'for_in_clause',
    'if_clause',
]);

/** Control/block nodes whose children sit one nesting level deeper. */
export const NESTING_TYPES = new Set([
    'block',
    'if_statement',
    'elif_clause',
    'else_clause',
    'for_statement',
    'while_statement',
    'try_statement',
    'except_clause',
    'finally_clause',
    'with_statement',
    'match_statement',
    'case_clause',
]);

/** tree-sitter-python AST node type for assignment statements. */
export const PY_ASSIGNMENT = 'assignment';

const PY_CLASS_DEFINITION = 'class_definition';
const PY_IDENTIFIER = 'identifier';
const PY_FUNCTION_DEF = 'function_definition';
const PY_DECORATED_DEF = 'decorated_definition';
const PY_BLOCK = 'block';
const PY_MODULE = 'module';
const PY_EXPR_STMT = 'expression_statement';
const PY_LAMBDA = 'lambda';
const PY_TRUE = 'true';
const PY_FALSE = 'false';
const PY_NONE = 'none';
const PY_INTEGER = 'integer';
const PY_FLOAT = 'float';
const PY_STRING = 'string';
const PY_CONCAT_STRING = 'concatenated_string';
const PY_CALL = 'call';
const PY_BINARY_OP = 'binary_operator';
const PY_DECORATOR = 'decorator';
const PY_SUBSCRIPT = 'subscript';
const PY_PAIR = 'pair';

const FIELD_NAME = 'name';
const FIELD_LEFT = 'left';
const FIELD_RIGHT = 'right';
const FIELD_FUNCTION = 'function';
const FIELD_KEY = 'key';

/** Declaration node types that count as a top-level symbol when they sit at module scope. */
const TOP_LEVEL_TYPES = new Set([
    PY_FUNCTION_DEF,
    PY_CLASS_DEFINITION,
    PY_DECORATED_DEF,
    'if_statement',
    'type_alias_statement',
]);

/** `MAX_RETRIES`-style names: Python's conventional module-level constant shape. */
export const CONSTANT_NAME_RE = /^[A-Z][A-Z0-9_]*$/;

/** Inheritance context carried down the recursion while mapping one file. */
export interface MapContext {
    /** True inside a module-level constant assignment (literal values are const-bound). */
    constBound: boolean;
}

/**
 * Compute the cyclomatic branch weight of a node.
 *
 * @param sn - Raw tree-sitter node.
 * @returns `1` for branch constructs, otherwise `0`.
 */
export function branchWeightOf(sn: TreeSitterNode): number {
    return BRANCH_TYPES.has(sn.type) ? 1 : 0;
}

/**
 * Resolve whether a function is a direct member of a class body.
 *
 * @param sn - Raw `function_definition` node.
 * @returns `true` when the nearest enclosing declaration is a class definition.
 */
export function isClassMember(sn: TreeSitterNode): boolean {
    let p = sn.parent;
    while (p && (p.type === PY_DECORATED_DEF || p.type === PY_BLOCK)) {
        p = p.parent;
    }
    return Boolean(p && p.type === PY_CLASS_DEFINITION);
}

/**
 * Resolve whether a node is a module-scope declaration.
 *
 * @param sn - Raw tree-sitter node.
 * @returns `true` for declarations directly under the module.
 */
export function isTopLevel(sn: TreeSitterNode): boolean {
    const p = sn.parent;
    if (!p || p.type !== PY_MODULE) return false;
    if (TOP_LEVEL_TYPES.has(sn.type)) return true;
    return (
        sn.type === PY_EXPR_STMT && Boolean(sn.namedChildren?.some((c) => c.type === PY_ASSIGNMENT))
    );
}

/**
 * Resolve whether an assignment targets a module-level constant name.
 *
 * @param sn - Raw `assignment` node.
 * @returns `true` when the left-hand side is a single `UPPER_SNAKE_CASE` identifier.
 */
export function isConstTarget(sn: TreeSitterNode): boolean {
    const left = sn.childForFieldName ? sn.childForFieldName(FIELD_LEFT) : null;
    return Boolean(
        left && left.type === PY_IDENTIFIER && left.text && CONSTANT_NAME_RE.test(left.text),
    );
}

/**
 * Callee name of a tree-sitter `call` node, reduced to its final segment.
 *
 * @param sn - `call` syntax node.
 * @returns Callee text (final segment for attribute access), or null when absent.
 */
export function callNameOf(sn: TreeSitterNode): string | null {
    const fn =
        typeof sn.childForFieldName === 'function' ? sn.childForFieldName(FIELD_FUNCTION) : null;
    const text = fn && typeof fn.text === 'string' ? fn.text : null;
    if (!text) return null;
    const dot = text.lastIndexOf('.');
    return dot >= 0 ? text.slice(dot + 1) : text;
}

/**
 * Resolve name from decorated definition.
 *
 * @param sn - Decorated definition node.
 * @returns Extracted inner definition name, or null.
 */
function resolveDecoratedName(sn: TreeSitterNode): string | null {
    const inner = sn.namedChildren?.find(
        (c) => c.type === PY_FUNCTION_DEF || c.type === PY_CLASS_DEFINITION,
    );
    return inner ? nameOf(inner) : null;
}

/**
 * Resolve name from assignment left-hand side.
 *
 * @param sn - Assignment node.
 * @returns Identifier text, or null.
 */
function resolveAssignmentName(sn: TreeSitterNode): string | null {
    const left = sn.childForFieldName ? sn.childForFieldName(FIELD_LEFT) : null;
    if (!left) return null;
    if (left.type === PY_IDENTIFIER) return left.text ?? null;
    const id = left.namedChildren?.find((c) => c.type === PY_IDENTIFIER);
    return id?.text ?? null;
}

/**
 * Resolve the declared name of a node for naming consumers.
 *
 * @param sn - Raw tree-sitter node.
 * @returns The resolved non-empty name, or null when the node has none.
 */
export function nameOf(sn: TreeSitterNode): string | null {
    if (sn.type === PY_DECORATED_DEF) return resolveDecoratedName(sn);
    if (sn.type === PY_EXPR_STMT) {
        const inner = sn.namedChildren?.find((c) => c.type === PY_ASSIGNMENT);
        return inner ? nameOf(inner) : null;
    }
    const name = sn.childForFieldName ? sn.childForFieldName(FIELD_NAME) : null;
    if (name && name.type === PY_IDENTIFIER) return name.text ?? null;
    if (sn.type === PY_ASSIGNMENT) return resolveAssignmentName(sn);
    return null;
}

/**
 * Report whether a name is private by Python convention.
 *
 * @param name - Resolved symbol name, or null when the node has none.
 * @returns `true` for underscore-prefixed names.
 */
export function isPrivateName(name: string | null): boolean {
    return Boolean(name && name.startsWith('_'));
}

/**
 * Report whether a `lambda` is bound to a name by its assignment.
 *
 * @param sn - Raw tree-sitter node.
 * @returns `true` for `handler = lambda ...`.
 */
export function introducesBinding(sn: TreeSitterNode): boolean {
    if (sn.type !== PY_ASSIGNMENT) return false;
    const right = sn.childForFieldName ? sn.childForFieldName(FIELD_RIGHT) : null;
    return Boolean(right && right.type === PY_LAMBDA);
}

/**
 * Report whether a `true`/`false`/`none` node is a real atom literal.
 *
 * @param sn - Raw tree-sitter node.
 * @returns Always true for primitive atom literals.
 */
export function isAtomLiteral(sn: TreeSitterNode): boolean {
    return sn.type === PY_TRUE || sn.type === PY_FALSE || sn.type === PY_NONE;
}

/**
 * Resolve whether a literal sits in a tolerated context.
 *
 * @param sn - Literal node to classify.
 * @param parent - Raw parent; undefined means the literal has no parent context.
 * @returns `true` for docstrings/bare expressions, decorator arguments, subscript indices,
 *     and dictionary keys.
 */
export function isToleratedOf(sn: TreeSitterNode, parent?: TreeSitterNode): boolean {
    if (!parent) return false;
    if (parent.type === PY_EXPR_STMT) return true;
    if (parent.type === PY_DECORATOR) return true;
    if (parent.type === PY_SUBSCRIPT) return true;
    if (parent.type === PY_PAIR) {
        const key = parent.childForFieldName ? parent.childForFieldName(FIELD_KEY) : null;
        return Boolean(key && key.startIndex === sn.startIndex);
    }
    return false;
}

/** Static lookup table mapping AST node types to normalized kinds. */
const STATIC_NODE_KIND_MAP = new Map<string, NodeKind>([
    [PY_MODULE, NodeKind.SourceFile],
    [PY_LAMBDA, NodeKind.Function],
    [PY_CLASS_DEFINITION, NodeKind.Class],
    [PY_INTEGER, NodeKind.NumericLiteral],
    [PY_FLOAT, NodeKind.NumericLiteral],
    [PY_STRING, NodeKind.StringLiteral],
    [PY_CONCAT_STRING, NodeKind.StringLiteral],
    [PY_TRUE, NodeKind.Literal],
    [PY_FALSE, NodeKind.Literal],
    [PY_NONE, NodeKind.Literal],
    [PY_CALL, NodeKind.Call],
    [PY_BINARY_OP, NodeKind.BinaryExpr],
    [PY_BLOCK, NodeKind.Block],
]);

/**
 * Map a tree-sitter node type to the normalized NodeKind.
 *
 * @param sn - Raw tree-sitter node.
 * @returns The normalized kind; branch types map to ControlFlow, unknown types to Other.
 */
export function kindOfPythonNode(sn: TreeSitterNode): NodeKind {
    const staticKind = STATIC_NODE_KIND_MAP.get(sn.type);
    if (staticKind !== undefined) return staticKind;
    if (sn.type === PY_FUNCTION_DEF) {
        return isClassMember(sn) ? NodeKind.Method : NodeKind.Function;
    }
    if (sn.type === PY_ASSIGNMENT) {
        return isConstTarget(sn) ? NodeKind.Constant : NodeKind.Variable;
    }
    if (BRANCH_TYPES.has(sn.type)) return NodeKind.ControlFlow;
    return NodeKind.Other;
}
