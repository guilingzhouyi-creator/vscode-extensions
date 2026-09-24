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
import { isCallArgumentToleratedByPolicy } from '../literal-policy-engine';

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
function oxcDeclarationKindOf(n: OxcNode): NodeKind | undefined {
    if (n.type === NODE_KIND_PROPERTY) return n.method ? NodeKind.Method : NodeKind.Other;
    return DECL_KIND_MAP[n.type];
}

const EXPRESSION_KIND_MAP: Record<string, NodeKind> = {
    CallExpression: NodeKind.Call,
    NewExpression: NodeKind.Call,
    BinaryExpression: NodeKind.BinaryExpr,
    LogicalExpression: NodeKind.BinaryExpr,
    AssignmentExpression: NodeKind.BinaryExpr,
};

/** Determine NodeKind for literal and expression oxc AST nodes. */
function oxcLiteralOrExpressionKindOf(n: OxcNode): NodeKind | undefined {
    if (n.type === 'Literal') {
        if (typeof n.value === TYPEOF_NUMBER) return NodeKind.NumericLiteral;
        if (typeof n.value === TYPEOF_STRING) return NodeKind.StringLiteral;
        return NodeKind.Other;
    }
    if (n.type === 'TemplateLiteral') {
        return (n.expressions || []).length === 0 ? NodeKind.StringLiteral : NodeKind.Other;
    }
    return EXPRESSION_KIND_MAP[n.type];
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
function oxcStatementKindOf(n: OxcNode): NodeKind | undefined {
    if (STATEMENT_CONTROL_FLOW_TYPES.has(n.type)) return NodeKind.ControlFlow;
    return n.type === 'BlockStatement' ? NodeKind.Block : undefined;
}

/**
 * Map an oxc ESTree AST node to the unified engine NodeKind.
 *
 * @param n - Raw oxc AST node to classify.
 * @returns Mapped NodeKind classification enum value.
 */
export function oxcKindOf(n: OxcNode): NodeKind {
    return (
        oxcDeclarationKindOf(n) ??
        oxcLiteralOrExpressionKindOf(n) ??
        oxcStatementKindOf(n) ??
        NodeKind.Other
    );
}

const OXC_BRANCH_WEIGHT_TYPES = new Set([...COMMON_CONTROL_FLOW_TYPES, 'ConditionalExpression']);

const OXC_LOGICAL_OPS = new Set(['&&', '||', '??']);

/**
 * Calculate cyclomatic decision-point weight for an oxc node (SwitchCase default -> 0).
 *
 * @param n - Raw oxc AST node to evaluate.
 * @returns Decision point branch weight (0 or 1).
 */
export function oxcBranchWeightOf(n: OxcNode): number {
    if (OXC_BRANCH_WEIGHT_TYPES.has(n.type)) return 1;
    if (n.type === 'SwitchCase') return n.test ? 1 : 0;
    if (n.type === 'BinaryExpression' || n.type === 'LogicalExpression') {
        return OXC_LOGICAL_OPS.has(n.operator as string) ? 1 : 0;
    }
    return 0;
}

function oxcTargetFnNode(n: OxcNode): OxcNode | undefined {
    switch (n.type) {
        case 'VariableDeclarator':
            return n.init;
        case NODE_KIND_PROPERTY:
            return n.method ? undefined : n.value;
        case 'PropertyDefinition':
            return n.value;
        case NODE_KIND_ASSIGNMENT_EXPRESSION:
            return n.operator === '=' ? n.right : undefined;
        default:
            return undefined;
    }
}

/**
 * Determine if an oxc node introduces a variable or member binding with a function initializer.
 *
 * @param n - Raw oxc AST node to evaluate.
 * @returns True when node introduces a function-like binding.
 */
export function oxcIntroducesBinding(n: OxcNode): boolean {
    const target = oxcTargetFnNode(n);
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
 * @param n - Raw oxc AST node.
 * @param ctx - Parser context containing source text.
 * @returns Extracted binding name, or null if not applicable.
 */
export function oxcBindingNameOf(n: OxcNode, ctx: Ctx): string | null {
    if (n.type === 'VariableDeclarator') {
        return n.id && typeof n.id.name === TYPEOF_STRING ? n.id.name : null;
    }
    if (n.type === NODE_KIND_PROPERTY || n.type === 'PropertyDefinition') {
        return n.key ? oxcKeyText(n.key, ctx) : null;
    }
    if (n.type === NODE_KIND_ASSIGNMENT_EXPRESSION) {
        if (
            n.left &&
            (n.left.type === NODE_KIND_MEMBER_EXPRESSION || n.left.type === 'Identifier')
        ) {
            return ctx.src.slice(n.left.start, n.left.end);
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
 * @param n - Raw oxc AST node.
 * @param ctx - Parser context containing source text.
 * @returns Extracted display name, or null if anonymous/unnamed.
 */
export function oxcNameOf(n: OxcNode, ctx: Ctx): string | null {
    if (NAMED_DECL_TYPES.has(n.type)) {
        return n.id && typeof n.id.name === TYPEOF_STRING ? n.id.name : null;
    }
    if (n.type === 'ArrowFunctionExpression') return null;
    if (
        n.type === NODE_KIND_METHOD_DEFINITION ||
        (n.type === NODE_KIND_PROPERTY && n.method === true)
    ) {
        return n.key ? oxcKeyText(n.key, ctx) : null;
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

function oxcIsToleratedCallArg(node: OxcNode, p: OxcNode, ctx?: Ctx): boolean {
    if (p.type !== NODE_KIND_CALL_EXPRESSION || !ctx) return false;
    const args = p.arguments;
    if (!Array.isArray(args)) return false;
    const argIdx = args.indexOf(node);
    if (argIdx < 0) return false;
    const callee = p.callee ? ctx.src.slice(p.callee.start, p.callee.end) : '';
    const numVal = Number(node.value ?? 0);
    return isCallArgumentToleratedByPolicy(callee, argIdx, numVal);
}

/** Check whether a numeric literal appears in a tolerated AST context. */
function oxcIsNumericTolerated(node: OxcNode, p: OxcNode, ctx?: Ctx): boolean {
    if (p.type === NODE_KIND_MEMBER_EXPRESSION) return true;
    if (p.type === NODE_KIND_PROPERTY && p.key === node) return true;
    if (p.type === NODE_TS_ENUM_MEMBER) return true;
    if (TYPE_SKIP_TYPES.has(p.type) || OXC_TYPE_EXTRA.has(p.type)) return true;
    if (p.type === NODE_SWITCH_CASE && p.test === node) return true;
    return oxcIsToleratedCallArg(node, p, ctx);
}

function oxcIsCallTolerated(caller: OxcNode, arg: OxcNode, ctx: Ctx): boolean {
    if (caller.type !== NODE_KIND_CALL_EXPRESSION && caller.type !== NODE_NEW_EXPR) return false;
    if (!Array.isArray(caller.arguments) || !caller.arguments.includes(arg)) return false;
    const callee = caller.callee ? ctx.src.slice(caller.callee.start, caller.callee.end) : '';
    return (
        /\b(t|i18n\.\w*|translate|fmt|formatMessage)\s*$/.test(callee) ||
        TEST_AND_ASSERT_CALLEES.test(callee) ||
        ERROR_CONSTRUCTOR_CALLEES.test(callee) ||
        LOGGING_AND_OUTPUT_CALLEES.test(callee)
    );
}

/** Check whether a string literal appears in a tolerated AST context. */
function oxcIsStringTolerated(node: OxcNode, p: OxcNode, ctx: Ctx, grandparent?: OxcNode): boolean {
    if (p.type === NODE_IMPORT_DECL || p.type === NODE_TS_IMPORT_EQUALS) return true;
    if (p.type === NODE_THROW_STMT) return true;
    if (p.type === NODE_KIND_PROPERTY && p.key === node) return true;
    if (p.type === NODE_KIND_MEMBER_EXPRESSION) return true;
    if (p.type === NODE_JSX_ATTRIBUTE && p.name === node) return true;
    if (p.type === NODE_SWITCH_CASE && p.test === node) return true;
    if (p.type === NODE_JSX_ELEMENT || p.type === NODE_JSX_OPENING_ELEMENT) return false;
    if (oxcIsCallTolerated(p, node, ctx)) return true;
    if (grandparent && p.type === NODE_BINARY_EXPR && p.operator === OP_PLUS) {
        return oxcIsCallTolerated(grandparent, p, ctx);
    }
    return false;
}

/**
 * Test whether a literal node resides in a tolerated context (e.g. enum member, imports, i18n).
 *
 * @param node - Raw literal oxc node.
 * @param p - Raw parent oxc node.
 * @param ctx - Parser context containing source text.
 * @param grandparent - Optional raw grandparent oxc node.
 * @returns True if literal should be tolerated by analyzers.
 */
export function oxcIsToleratedOf(
    node: OxcNode,
    p: OxcNode | undefined,
    ctx: Ctx,
    grandparent?: OxcNode,
): boolean {
    if (!p) return false;
    if (typeof node.value === TYPEOF_NUMBER) {
        return oxcIsNumericTolerated(node, p, ctx);
    }
    return oxcIsStringTolerated(node, p, ctx, grandparent);
}

/**
 * Test if an oxc node represents a function or method boundary.
 *
 * @param n - Raw oxc AST node.
 * @returns True if node is a function or method kind.
 */
export function oxcIsFnLikeNode(n: OxcNode): boolean {
    const kind = oxcKindOf(n);
    return kind === NodeKind.Function || kind === NodeKind.Method;
}

/**
 * Compute 1-based line/column position from UTF-16 offset via binary search over line starts.
 *
 * @param off - UTF-16 character offset in source text.
 * @param ctx - Parser context with lineStarts table.
 * @returns 1-based line and column Position.
 */
export function oxcPosOf(off: number, ctx: Ctx): Position {
    const ls = ctx.lineStarts;
    let lo = -1;
    let hi = ls.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (ls[mid] <= off) lo = mid;
        else hi = mid - 1;
    }
    return { line: lo + 2, column: off - (lo >= 0 ? ls[lo] : 0) + 1 };
}

/**
 * Retrieve raw literal text from an oxc node.
 *
 * @param n - Raw literal oxc node.
 * @param ctx - Parser context with source text.
 * @returns Literal string representation.
 */
export function oxcLiteralText(n: OxcNode, ctx: Ctx): string {
    if (n.type === NODE_TYPE_TEMPLATE_LITERAL) return ctx.src.slice(n.start, n.end);
    return n.raw != null ? String(n.raw) : ctx.src.slice(n.start, n.end);
}
