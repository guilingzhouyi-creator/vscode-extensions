/**
 * Module: Core Engine — Parser Adapters (oxc predicates)
 * File Path: src/core/ast/oxc-predicates.ts
 * Architecture Role: Pure AST mapping predicates and compensations shared by OxcAdapter and
 *   OxcProjector to ensure byte-equivalence with the TypeScript adapter.
 * Dependencies & Triggers: Imports types and constants from ./oxcTypes and NodeKind from
 *   ./multilang; invoked during AST materialization and projection walks.
 * Responsibilities: Map oxc node kinds to NodeKind; calculate cyclomatic branch weights;
 *   detect function bindings; resolve names and positions; evaluate const-bound and tolerated.
 * Exit Semantics & Design Rationale: Pure stateless functions with zero side effects; ensures
 *   100% byte-equivalence against TypeScript AST traversal.
 */

import { NodeKind, type Position } from './multilang';
import {
    type OxcNode,
    type Ctx,
    NODE_KIND_FUNCTION_DECLARATION,
    NODE_KIND_CLASS_DECLARATION,
    NODE_KIND_FUNCTION_EXPRESSION,
    NODE_KIND_METHOD_DEFINITION,
    NODE_KIND_PROPERTY,
    NODE_KIND_CLASS_EXPRESSION,
    NODE_KIND_ASSIGNMENT_EXPRESSION,
    NODE_KIND_MEMBER_EXPRESSION,
    NODE_KIND_CALL_EXPRESSION,
    TYPEOF_NUMBER,
    TYPEOF_STRING,
    FN_TYPES,
    TYPE_SKIP_TYPES,
} from './oxc-types';
import { isCallArgumentToleratedByPolicy } from '../policy/literal-policy-engine';

const NODE_TYPE_TEMPLATE_LITERAL = 'TemplateLiteral';

const NODE_IMPORT_DECL = 'ImportDeclaration';
const NODE_TS_IMPORT_EQUALS = 'TSImportEqualsDeclaration';
const NODE_THROW_STMT = 'ThrowStatement';
const NODE_BINARY_EXPR = 'BinaryExpression';
const NODE_NEW_EXPR = 'NewExpression';
const NODE_SWITCH_CASE = 'SwitchCase';
const NODE_JSX_ATTRIBUTE = 'JSXAttribute';
const NODE_JSX_ELEMENT = 'JSXElement';
const NODE_JSX_OPENING_ELEMENT = 'JSXOpeningElement';
const NODE_TS_ENUM_MEMBER = 'TSEnumMember';
const OP_PLUS = '+';

const DECL_KIND_MAP: Record<string, NodeKind> = {
    Program: NodeKind.SourceFile,
    FunctionDeclaration: NodeKind.Function,
    FunctionExpression: NodeKind.Function,
    ArrowFunctionExpression: NodeKind.Function,
    TSDeclareFunction: NodeKind.Function,
    MethodDefinition: NodeKind.Method,
    ClassDeclaration: NodeKind.Class,
    ClassExpression: NodeKind.Class,
    TSInterfaceDeclaration: NodeKind.Interface,
    VariableDeclaration: NodeKind.Variable,
};

/** Determine NodeKind for declaration-like oxc AST nodes. */
function oxcDeclarationKindOf(node: OxcNode): NodeKind | undefined {
    if (node.type === NODE_KIND_PROPERTY) return node.method ? NodeKind.Method : NodeKind.Other;
    return DECL_KIND_MAP[node.type];
}

const EXPRESSION_KIND_MAP: Record<string, NodeKind> = {
    CallExpression: NodeKind.Call,
    NewExpression: NodeKind.Call,
    BinaryExpression: NodeKind.BinaryExpr,
    LogicalExpression: NodeKind.BinaryExpr,
    AssignmentExpression: NodeKind.BinaryExpr,
};

/** Determine NodeKind for literal and expression oxc AST nodes. */
function oxcLiteralOrExpressionKindOf(node: OxcNode): NodeKind | undefined {
    if (node.type === 'Literal') {
        if (typeof node.value === TYPEOF_NUMBER) return NodeKind.NumericLiteral;
        if (typeof node.value === TYPEOF_STRING) return NodeKind.StringLiteral;
        return NodeKind.Other;
    }
    if (node.type === 'TemplateLiteral') {
        return (node.expressions || []).length === 0 ? NodeKind.StringLiteral : NodeKind.Other;
    }
    return EXPRESSION_KIND_MAP[node.type];
}

const COMMON_CONTROL_FLOW_TYPES = [
    'IfStatement',
    'ForStatement',
    'ForInStatement',
    'ForOfStatement',
    'WhileStatement',
    'DoWhileStatement',
    'SwitchStatement',
    'CatchClause',
];

const STATEMENT_CONTROL_FLOW_TYPES = new Set([
    ...COMMON_CONTROL_FLOW_TYPES,
    'SwitchCase',
    'TryStatement',
]);

/** Determine NodeKind for control-flow and block oxc AST nodes. */
function oxcStatementKindOf(node: OxcNode): NodeKind | undefined {
    if (STATEMENT_CONTROL_FLOW_TYPES.has(node.type)) return NodeKind.ControlFlow;
    return node.type === 'BlockStatement' ? NodeKind.Block : undefined;
}

/**
 * Map an oxc ESTree AST node to the unified engine NodeKind.
 *
 * @param node - Raw oxc AST node to classify.
 * @returns Mapped NodeKind classification enum value.
 */
export function oxcKindOf(node: OxcNode): NodeKind {
    return (
        oxcDeclarationKindOf(node) ??
        oxcLiteralOrExpressionKindOf(node) ??
        oxcStatementKindOf(node) ??
        NodeKind.Other
    );
}

const OXC_BRANCH_WEIGHT_TYPES = new Set([...COMMON_CONTROL_FLOW_TYPES, 'ConditionalExpression']);

const OXC_LOGICAL_OPS = new Set(['&&', '||', '??']);

/**
 * Calculate cyclomatic decision-point weight for an oxc node (SwitchCase default -> 0).
 *
 * @param node - Raw oxc AST node to evaluate.
 * @returns Decision point branch weight (0 or 1).
 */
export function oxcBranchWeightOf(node: OxcNode): number {
    if (OXC_BRANCH_WEIGHT_TYPES.has(node.type)) return 1;
    if (node.type === 'SwitchCase') return node.test ? 1 : 0;
    if (node.type === 'BinaryExpression' || node.type === 'LogicalExpression') {
        return OXC_LOGICAL_OPS.has(node.operator as string) ? 1 : 0;
    }
    return 0;
}

function oxcTargetFnNode(node: OxcNode): OxcNode | undefined {
    switch (node.type) {
        case 'VariableDeclarator':
            return node.init;
        case NODE_KIND_PROPERTY:
            return node.method ? undefined : node.value;
        case 'PropertyDefinition':
            return node.value;
        case NODE_KIND_ASSIGNMENT_EXPRESSION:
            return node.operator === '=' ? node.right : undefined;
        default:
            return undefined;
    }
}

/**
 * Determine if an oxc node introduces a variable or member binding with a function initializer.
 *
 * @param node - Raw oxc AST node to evaluate.
 * @returns True when node introduces a function-like binding.
 */
export function oxcIntroducesBinding(node: OxcNode): boolean {
    const target = oxcTargetFnNode(node);
    return target && target.type ? FN_TYPES.has(target.type) : false;
}

/** Extract text identifier from a property or method key node. */
function oxcKeyText(key: OxcNode, ctx: Ctx): string {
    if (typeof key.name === TYPEOF_STRING && key.name.length > 0) return key.name;
    return ctx.src.slice(key.start, key.end);
}

/**
 * Resolve the binding name for an assignment or declarator node.
 *
 * @param node - Raw oxc AST node.
 * @param ctx - Parser context containing source text.
 * @returns Extracted binding name, or null if not applicable.
 */
export function oxcBindingNameOf(node: OxcNode, ctx: Ctx): string | null {
    if (node.type === 'VariableDeclarator') {
        return node.id && typeof node.id.name === TYPEOF_STRING ? node.id.name : null;
    }
    if (node.type === NODE_KIND_PROPERTY || node.type === 'PropertyDefinition') {
        return node.key ? oxcKeyText(node.key, ctx) : null;
    }
    if (node.type === NODE_KIND_ASSIGNMENT_EXPRESSION) {
        if (
            node.left &&
            (node.left.type === NODE_KIND_MEMBER_EXPRESSION || node.left.type === 'Identifier')
        ) {
            return ctx.src.slice(node.left.start, node.left.end);
        }
        return null;
    }
    return null;
}

const NAMED_DECL_TYPES = new Set([
    NODE_KIND_FUNCTION_DECLARATION,
    NODE_KIND_FUNCTION_EXPRESSION,
    'TSDeclareFunction',
    NODE_KIND_CLASS_DECLARATION,
    NODE_KIND_CLASS_EXPRESSION,
]);

/**
 * Resolve display name for functions, methods, classes, and interfaces.
 *
 * @param node - Raw oxc AST node.
 * @param ctx - Parser context containing source text.
 * @returns Extracted display name, or null if anonymous/unnamed.
 */
export function oxcNameOf(node: OxcNode, ctx: Ctx): string | null {
    if (NAMED_DECL_TYPES.has(node.type)) {
        return node.id && typeof node.id.name === TYPEOF_STRING ? node.id.name : null;
    }
    if (node.type === 'ArrowFunctionExpression') return null;
    if (
        node.type === NODE_KIND_METHOD_DEFINITION ||
        (node.type === NODE_KIND_PROPERTY && node.method === true)
    ) {
        return node.key ? oxcKeyText(node.key, ctx) : null;
    }
    return null;
}

/** Regex matching common test suite, test case and assertion helper callees. */
const TEST_AND_ASSERT_CALLEES =
    /\b(describe|it|test|suite|context|beforeEach|afterEach|beforeAll|afterAll|assert|expect|should|equal|strictEqual|deepEqual|deepStrictEqual|ok|match|throws|rejects)\b/;

/** Regex matching error constructors and error factory calls. */
const ERROR_CONSTRUCTOR_CALLEES =
    /\b(?:createError|buildError|makeError|[A-Z][A-Za-z0-9_$]*(?:Error|Exception)|Error)\b/;

/** Regex matching logger and standard output call targets. */
const LOGGING_AND_OUTPUT_CALLEES =
    /\b(?:console|logger|logging|log)\.(?:log|info|warn|error|debug|trace|dir)\b|\bprocess\.(?:stdout|stderr)\.write\b|\bchalk\.\w+\b/;

const CALLABLE_OR_CAST_TYPES = new Set(['NewExpression', 'CallExpression', 'TSAsExpression']);

/**
 * Check whether a literal value is bound to a const declaration or enum member.
 *
 * @param node - Raw literal oxc node.
 * @param parent - Raw parent oxc node.
 * @param grandparent - Raw grandparent oxc node.
 * @returns True if literal is bound to a const declaration or enum member.
 */
export function oxcIsConstBoundOf(
    node: OxcNode,
    parent: OxcNode | undefined,
    grandparent: OxcNode | undefined,
): boolean {
    const isConstVar =
        parent?.type === 'VariableDeclarator' &&
        parent.init === node &&
        grandparent?.type === 'VariableDeclaration' &&
        grandparent.kind === 'const';
    if (isConstVar) return true;
    if (
        parent?.type === 'TSEnumMember' ||
        parent?.type === 'TSAsExpression' ||
        grandparent?.type === 'TSAsExpression'
    ) {
        return true;
    }
    return (
        parent?.type === 'ArrayExpression' &&
        Boolean(grandparent?.type && CALLABLE_OR_CAST_TYPES.has(grandparent.type))
    );
}

const OXC_TYPE_EXTRA = new Set(['TSLiteralType', 'TSTypeReference', 'TSTypeAnnotation']);

function oxcIsToleratedCallArg(node: OxcNode, parentNode: OxcNode, ctx?: Ctx): boolean {
    if (parentNode.type !== NODE_KIND_CALL_EXPRESSION || !ctx) return false;
    const callArgs = parentNode.arguments;
    if (!Array.isArray(callArgs)) return false;
    const argIdx = callArgs.indexOf(node);
    if (argIdx < 0) return false;
    const callee = parentNode.callee
        ? ctx.src.slice(parentNode.callee.start, parentNode.callee.end)
        : '';
    const numVal = Number(node.value ?? 0);
    return isCallArgumentToleratedByPolicy(callee, argIdx, numVal);
}

/** Check whether a numeric literal appears in a tolerated AST context. */
function oxcIsNumericTolerated(node: OxcNode, parentNode: OxcNode, ctx?: Ctx): boolean {
    if (parentNode.type === NODE_KIND_MEMBER_EXPRESSION) return true;
    if (parentNode.type === NODE_KIND_PROPERTY && parentNode.key === node) return true;
    if (parentNode.type === NODE_TS_ENUM_MEMBER) return true;
    if (TYPE_SKIP_TYPES.has(parentNode.type) || OXC_TYPE_EXTRA.has(parentNode.type)) return true;
    if (parentNode.type === NODE_SWITCH_CASE && parentNode.test === node) return true;
    return oxcIsToleratedCallArg(node, parentNode, ctx);
}

function oxcIsCallTolerated(caller: OxcNode, argumentNode: OxcNode, ctx: Ctx): boolean {
    if (caller.type !== NODE_KIND_CALL_EXPRESSION && caller.type !== NODE_NEW_EXPR) return false;
    if (!Array.isArray(caller.arguments) || !caller.arguments.includes(argumentNode)) return false;
    const callee = caller.callee ? ctx.src.slice(caller.callee.start, caller.callee.end) : '';
    return (
        /\b(t|i18n\.\w*|translate|fmt|formatMessage)\s*$/.test(callee) ||
        TEST_AND_ASSERT_CALLEES.test(callee) ||
        ERROR_CONSTRUCTOR_CALLEES.test(callee) ||
        LOGGING_AND_OUTPUT_CALLEES.test(callee)
    );
}

/** Check whether a string literal appears in a tolerated AST context. */
function oxcIsStringTolerated(
    node: OxcNode,
    parentNode: OxcNode,
    ctx: Ctx,
    grandparent?: OxcNode,
): boolean {
    const parentType = parentNode.type;
    if (parentType === NODE_IMPORT_DECL || parentType === NODE_TS_IMPORT_EQUALS) return true;
    if (parentType === NODE_THROW_STMT) return true;
    if (parentType === NODE_KIND_PROPERTY && parentNode.key === node) return true;
    if (parentType === NODE_KIND_MEMBER_EXPRESSION) return true;
    if (parentType === NODE_JSX_ATTRIBUTE && parentNode.name === node) return true;
    if (parentType === NODE_SWITCH_CASE && parentNode.test === node) return true;
    if (parentType === NODE_JSX_ELEMENT || parentType === NODE_JSX_OPENING_ELEMENT) return false;
    if (oxcIsCallTolerated(parentNode, node, ctx)) return true;
    if (grandparent && parentType === NODE_BINARY_EXPR && parentNode.operator === OP_PLUS) {
        return oxcIsCallTolerated(grandparent, parentNode, ctx);
    }
    return false;
}

/**
 * Test whether a literal node resides in a tolerated context (e.g. enum member, imports, i18n).
 *
 * @param node - Raw literal oxc node.
 * @param parentNode - Raw parent oxc node.
 * @param ctx - Parser context containing source text.
 * @param grandparent - Optional raw grandparent oxc node.
 * @returns True if literal should be tolerated by analyzers.
 */
export function oxcIsToleratedOf(
    node: OxcNode,
    parentNode: OxcNode | undefined,
    ctx: Ctx,
    grandparent?: OxcNode,
): boolean {
    if (!parentNode) return false;
    if (typeof node.value === TYPEOF_NUMBER) {
        return oxcIsNumericTolerated(node, parentNode, ctx);
    }
    return oxcIsStringTolerated(node, parentNode, ctx, grandparent);
}

/**
 * Test if an oxc node represents a function or method boundary.
 *
 * @param node - Raw oxc AST node.
 * @returns True if node is a function or method kind.
 */
export function oxcIsFnLikeNode(node: OxcNode): boolean {
    const kind = oxcKindOf(node);
    return kind === NodeKind.Function || kind === NodeKind.Method;
}

/**
 * Compute 1-based line/column position from UTF-16 offset via binary search over line starts.
 *
 * @param offset - UTF-16 character offset in source text.
 * @param ctx - Parser context with lineStarts table.
 * @returns 1-based line and column Position.
 */
export function oxcPosOf(offset: number, ctx: Ctx): Position {
    const lineStarts = ctx.lineStarts;
    let lowIndex = -1;
    let highIndex = lineStarts.length - 1;
    while (lowIndex < highIndex) {
        const midIndex = (lowIndex + highIndex + 1) >> 1;
        if (lineStarts[midIndex] <= offset) lowIndex = midIndex;
        else highIndex = midIndex - 1;
    }
    return { line: lowIndex + 2, column: offset - (lowIndex >= 0 ? lineStarts[lowIndex] : 0) + 1 };
}

/**
 * Retrieve raw literal text from an oxc node.
 *
 * @param node - Raw literal oxc node.
 * @param ctx - Parser context with source text.
 * @returns Literal string representation.
 */
export function oxcLiteralText(node: OxcNode, ctx: Ctx): string {
    if (node.type === NODE_TYPE_TEMPLATE_LITERAL) return ctx.src.slice(node.start, node.end);
    return node.raw != null ? String(node.raw) : ctx.src.slice(node.start, node.end);
}
