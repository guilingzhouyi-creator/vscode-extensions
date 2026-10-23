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

/** tree-sitter-python AST node type for assignment statements. */
export const PY_ASSIGNMENT = 'assignment';
const PY_IF_STMT = 'if_statement';
const PY_ELIF_CLAUSE = 'elif_clause';
const PY_ELSE_CLAUSE = 'else_clause';
const PY_FOR_STMT = 'for_statement';
const PY_WHILE_STMT = 'while_statement';
const PY_TRY_STMT = 'try_statement';
const PY_EXCEPT_CLAUSE = 'except_clause';
const PY_FINALLY_CLAUSE = 'finally_clause';
const PY_WITH_STMT = 'with_statement';
const PY_MATCH_STMT = 'match_statement';
const PY_CASE_CLAUSE = 'case_clause';
const PY_CONDITIONAL_EXPR = 'conditional_expression';
const PY_BOOLEAN_OP = 'boolean_operator';
const PY_FOR_IN_CLAUSE = 'for_in_clause';
const PY_IF_CLAUSE = 'if_clause';
const PY_TYPE_ALIAS_STMT = 'type_alias_statement';
const PY_KEYWORD_ARGUMENT = 'keyword_argument';
const PY_COMPARISON_OP = 'comparison_operator';
const PY_ARGUMENT_LIST = 'argument_list';
const PY_INTERPOLATION = 'interpolation';
const PY_FORMAT_SPECIFIER = 'format_specifier';
const SPECIAL_MODULE_MAIN = '__main__';

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

/** Branch constructs that each add one to a function's cyclomatic complexity. */
export const BRANCH_TYPES = new Set([
    PY_IF_STMT,
    PY_ELIF_CLAUSE,
    PY_FOR_STMT,
    PY_WHILE_STMT,
    PY_EXCEPT_CLAUSE,
    PY_CASE_CLAUSE,
    PY_CONDITIONAL_EXPR,
    PY_BOOLEAN_OP,
    PY_FOR_IN_CLAUSE,
    PY_IF_CLAUSE,
]);

/** Control/block nodes whose children sit one nesting level deeper. */
export const NESTING_TYPES = new Set([
    PY_BLOCK,
    PY_IF_STMT,
    PY_ELIF_CLAUSE,
    PY_ELSE_CLAUSE,
    PY_FOR_STMT,
    PY_WHILE_STMT,
    PY_TRY_STMT,
    PY_EXCEPT_CLAUSE,
    PY_FINALLY_CLAUSE,
    PY_WITH_STMT,
    PY_MATCH_STMT,
    PY_CASE_CLAUSE,
]);

/** Declaration node types that count as a top-level symbol when they sit at module scope. */
const TOP_LEVEL_TYPES = new Set([
    PY_FUNCTION_DEF,
    PY_CLASS_DEFINITION,
    PY_DECORATED_DEF,
    PY_IF_STMT,
    PY_TYPE_ALIAS_STMT,
]);

/** `MAX_RETRIES`-style names: Python's conventional module-level constant shape. */
export const CONSTANT_NAME_RE = /^[A-Z][A-Z0-9_]*$/;

/** Inheritance context carried down the recursion while mapping one file. */
export interface MapContext {
    /** True inside a module-level constant assignment (literal values are const-bound). */
    constBound: boolean;
    /** True inside a unit test or self-assertion function. */
    isTestFunction?: boolean;
}

/**
 * Compute the cyclomatic branch weight of a node.
 *
 * @param syntaxNode - Raw tree-sitter node.
 * @returns `1` for branch constructs, otherwise `0`.
 */
export function computePythonBranchWeight(syntaxNode: TreeSitterNode): number {
    return BRANCH_TYPES.has(syntaxNode.type) ? 1 : 0;
}

/** Backward-compatible alias for computePythonBranchWeight. */
export const branchWeightOf = computePythonBranchWeight;

/**
 * Resolve whether a function is a direct member of a class body.
 *
 * @param syntaxNode - Raw `function_definition` node.
 * @returns `true` when the nearest enclosing declaration is a class definition.
 */
export function isClassMember(syntaxNode: TreeSitterNode): boolean {
    let currentParent = syntaxNode.parent;
    while (currentParent && (currentParent.type === PY_DECORATED_DEF || currentParent.type === PY_BLOCK)) {
        currentParent = currentParent.parent;
    }
    return Boolean(currentParent && currentParent.type === PY_CLASS_DEFINITION);
}

/**
 * Resolve whether a node is a module-scope declaration.
 *
 * @param syntaxNode - Raw tree-sitter node.
 * @returns `true` for declarations directly under the module.
 */
export function isTopLevel(syntaxNode: TreeSitterNode): boolean {
    const parentNode = syntaxNode.parent;
    if (!parentNode || parentNode.type !== PY_MODULE) return false;
    if (TOP_LEVEL_TYPES.has(syntaxNode.type)) return true;
    return (
        syntaxNode.type === PY_EXPR_STMT &&
        Boolean(syntaxNode.namedChildren?.some((child) => child.type === PY_ASSIGNMENT))
    );
}

/**
 * Resolve whether an assignment targets a module-level constant name.
 *
 * @param syntaxNode - Raw `assignment` node.
 * @returns `true` when the left-hand side is a single `UPPER_SNAKE_CASE` identifier.
 */
export function isConstTarget(syntaxNode: TreeSitterNode): boolean {
    const leftChild = syntaxNode.childForFieldName ? syntaxNode.childForFieldName(FIELD_LEFT) : null;
    return Boolean(
        leftChild &&
            leftChild.type === PY_IDENTIFIER &&
            leftChild.text &&
            CONSTANT_NAME_RE.test(leftChild.text),
    );
}

/**
 * Callee name of a tree-sitter `call` node, reduced to its final segment.
 *
 * @param syntaxNode - `call` syntax node.
 * @returns Callee text (final segment for attribute access), or null when absent.
 */
export function callNameOf(syntaxNode: TreeSitterNode): string | null {
    const fnNode =
        typeof syntaxNode.childForFieldName === 'function'
            ? syntaxNode.childForFieldName(FIELD_FUNCTION)
            : null;
    const textValue = fnNode && typeof fnNode.text === 'string' ? fnNode.text : null;
    if (!textValue) return null;
    const dotIndex = textValue.lastIndexOf('.');
    return dotIndex >= 0 ? textValue.slice(dotIndex + 1) : textValue;
}

/**
 * Resolve name from decorated definition.
 *
 * @param syntaxNode - Decorated definition node.
 * @returns Extracted inner definition name, or null.
 */
function resolveDecoratedName(syntaxNode: TreeSitterNode): string | null {
    const innerDefinition = syntaxNode.namedChildren?.find(
        (child) => child.type === PY_FUNCTION_DEF || child.type === PY_CLASS_DEFINITION,
    );
    return innerDefinition ? nameOf(innerDefinition) : null;
}

/**
 * Resolve name from assignment left-hand side.
 *
 * @param syntaxNode - Assignment node.
 * @returns Identifier text, or null.
 */
function resolveAssignmentName(syntaxNode: TreeSitterNode): string | null {
    const leftChild = syntaxNode.childForFieldName ? syntaxNode.childForFieldName(FIELD_LEFT) : null;
    if (!leftChild) return null;
    if (leftChild.type === PY_IDENTIFIER) return leftChild.text ?? null;
    const identifierChild = leftChild.namedChildren?.find((child) => child.type === PY_IDENTIFIER);
    return identifierChild?.text ?? null;
}

/**
 * Resolve the declared name of a node for naming consumers.
 *
 * @param syntaxNode - Raw tree-sitter node.
 * @returns The resolved non-empty name, or null when the node has none.
 */
export function getPythonNodeName(syntaxNode: TreeSitterNode): string | null {
    if (syntaxNode.type === PY_DECORATED_DEF) return resolveDecoratedName(syntaxNode);
    if (syntaxNode.type === PY_EXPR_STMT) {
        const innerAssignment = syntaxNode.namedChildren?.find((child) => child.type === PY_ASSIGNMENT);
        return innerAssignment ? getPythonNodeName(innerAssignment) : null;
    }
    const nameChild = syntaxNode.childForFieldName ? syntaxNode.childForFieldName(FIELD_NAME) : null;
    if (nameChild && nameChild.type === PY_IDENTIFIER) return nameChild.text ?? null;
    if (syntaxNode.type === PY_ASSIGNMENT) return resolveAssignmentName(syntaxNode);
    return null;
}

/** Backward-compatible alias for getPythonNodeName. */
export const nameOf = getPythonNodeName;

/**
 * Report whether a name is private by Python convention.
 *
 * @param symbolName - Resolved symbol name, or null when the node has none.
 * @returns `true` for underscore-prefixed names.
 */
export function isPrivateName(symbolName: string | null): boolean {
    return Boolean(symbolName && symbolName.startsWith('_'));
}

/**
 * Report whether a `lambda` is bound to a name by its assignment.
 *
 * @param syntaxNode - Raw tree-sitter node.
 * @returns `true` for `handler = lambda ...`.
 */
export function introducesBinding(syntaxNode: TreeSitterNode): boolean {
    if (syntaxNode.type !== PY_ASSIGNMENT) return false;
    const rightChild = syntaxNode.childForFieldName ? syntaxNode.childForFieldName(FIELD_RIGHT) : null;
    return Boolean(rightChild && rightChild.type === PY_LAMBDA);
}

/**
 * Report whether a `true`/`false`/`none` node is a real atom literal.
 *
 * @param syntaxNode - Raw tree-sitter node.
 * @returns Always true for primitive atom literals.
 */
export function isAtomLiteral(syntaxNode: TreeSitterNode): boolean {
    return (
        syntaxNode.type === PY_TRUE ||
        syntaxNode.type === PY_FALSE ||
        syntaxNode.type === PY_NONE
    );
}

const CLI_FLAG_PATTERN = /^--?[a-zA-Z0-9_.-]+$/;
const SYSTEM_ARG_NAME_PATTERN =
    /^(?:encoding|mode|errors|action|default|dest|help|type|format|sep|end|file|flush|shell|cwd|env|stdout|stderr|check|timeout|nargs|const|choices|metavar|required|prefix|suffix|dir|delete|rule_id|severity|message|suggestion|desc|description|file_path|line)$/i;
const SYSTEM_CALL_NAME_PATTERN =
    /^(?:print|log|info|warn|warning|error|debug|trace|fatal|critical|write|exception|exit|assert|format|compile|match|search|findall|sub|split|startswith|endswith|replace|get|getenv|join|append|extend|add|add_argument|add_parser|add_subparsers|set_defaults|open|update|loads|dumps|load|dump|read_text|write_text|mkdir|exists|glob|rglob|run|popen|check_output|encode|decode|strip|lstrip|rstrip|lower|upper|auditfinding|finding|violation|issue|diagnostic)$/i;

/**
 * Report whether the enclosing call is a known system/IO/logging API.
 *
 * @param ancestorNode - Node whose parent chain should contain the `call`.
 * @returns `true` when the nearest `call` ancestor resolves to a tolerated callee.
 */
function isSystemCallAncestor(ancestorNode: TreeSitterNode | null | undefined): boolean {
    if (!ancestorNode || ancestorNode.type !== PY_CALL) return false;
    const fnName = callNameOf(ancestorNode);
    return Boolean(fnName && SYSTEM_CALL_NAME_PATTERN.test(fnName));
}

/**
 * Report whether a keyword argument carries a CLI flag or a system-level parameter name.
 *
 * @param syntaxNode - Literal node under inspection.
 * @param parentNode - Raw `keyword_argument` node.
 * @returns `true` for `--flag` values and for parameters of known system APIs.
 */
function isKeywordArgumentTolerated(
    syntaxNode: TreeSitterNode,
    parentNode: TreeSitterNode,
): boolean {
    if (parentNode.type !== PY_KEYWORD_ARGUMENT) return false;
    const rawText = syntaxNode.text ? syntaxNode.text.replace(/^['"]|['"]$/g, '') : '';
    if (rawText && CLI_FLAG_PATTERN.test(rawText)) return true;
    const argNameNode = parentNode.childForFieldName
        ? parentNode.childForFieldName(FIELD_NAME)
        : null;
    const nameText = argNameNode?.text || parentNode.namedChildren?.[0]?.text;
    if (nameText && SYSTEM_ARG_NAME_PATTERN.test(nameText)) return true;
    return isSystemCallAncestor(parentNode.parent?.parent);
}

function isComparisonTolerated(syntaxNode: TreeSitterNode, parentNode: TreeSitterNode): boolean {
    if (parentNode.type !== PY_COMPARISON_OP) return false;
    const textValue = syntaxNode.text ? syntaxNode.text.replace(/^['"]|['"]$/g, '') : '';
    return textValue === SPECIAL_MODULE_MAIN || textValue === '';
}

function isArgumentListTolerated(
    syntaxNode: TreeSitterNode,
    parentNode: TreeSitterNode,
): boolean {
    if (parentNode.type !== PY_ARGUMENT_LIST) return false;
    const textValue = syntaxNode.text ? syntaxNode.text.replace(/^['"]|['"]$/g, '') : '';
    if (textValue && CLI_FLAG_PATTERN.test(textValue)) return true;
    return isSystemCallAncestor(parentNode.parent);
}

/**
 * Resolve whether a literal sits in a tolerated context.
 *
 * @param syntaxNode - Literal node to classify.
 * @param parentNode - Raw parent; undefined means the literal has no parent context.
 * @param ctx - Optional map context carrying the enclosing test-function scope.
 * @returns `true` for docstrings/bare expressions, decorator arguments, subscript indices,
 *     keyword arguments, CLI flags, standard comparisons, and dictionary keys.
 */
export function isToleratedOf(
    syntaxNode: TreeSitterNode,
    parentNode?: TreeSitterNode,
    ctx?: MapContext,
): boolean {
    if (ctx?.isTestFunction) return true;
    if (!parentNode) return false;
    if (
        parentNode.type === PY_EXPR_STMT ||
        parentNode.type === PY_DECORATOR ||
        parentNode.type === PY_SUBSCRIPT
    ) {
        return true;
    }
    if (isKeywordArgumentTolerated(syntaxNode, parentNode)) return true;
    if (isComparisonTolerated(syntaxNode, parentNode)) return true;
    if (parentNode.type === PY_PAIR) {
        const keyNode = parentNode.childForFieldName
            ? parentNode.childForFieldName(FIELD_KEY)
            : null;
        return Boolean(keyNode && keyNode.startIndex === syntaxNode.startIndex);
    }
    if (parentNode.type === PY_BINARY_OP) {
        const slashOperator = parentNode.children?.find((child) => child.type === '/' || child.text === '/');
        if (slashOperator) return true;
    }
    if (parentNode.type === PY_INTERPOLATION || parentNode.type === PY_FORMAT_SPECIFIER) {
        return true;
    }
    return isArgumentListTolerated(syntaxNode, parentNode);
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
 * @param syntaxNode - Raw tree-sitter node.
 * @returns The normalized kind; branch types map to ControlFlow, unknown types to Other.
 */
export function getPythonNodeKind(syntaxNode: TreeSitterNode): NodeKind {
    const staticKind = STATIC_NODE_KIND_MAP.get(syntaxNode.type);
    if (staticKind !== undefined) return staticKind;
    if (syntaxNode.type === PY_FUNCTION_DEF) {
        return isClassMember(syntaxNode) ? NodeKind.Method : NodeKind.Function;
    }
    if (syntaxNode.type === PY_ASSIGNMENT) {
        return isConstTarget(syntaxNode) ? NodeKind.Constant : NodeKind.Variable;
    }
    return BRANCH_TYPES.has(syntaxNode.type) ? NodeKind.ControlFlow : NodeKind.Other;
}

/**
 * Backward compatibility alias for getPythonNodeKind.
 */
export const kindOfPythonNode = getPythonNodeKind;
