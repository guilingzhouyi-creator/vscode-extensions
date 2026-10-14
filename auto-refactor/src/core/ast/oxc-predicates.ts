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

const NODE_PROGRAM = 'Program';
const NODE_ARROW_FUNCTION_EXPR = 'ArrowFunctionExpression';
const NODE_TS_DECLARE_FUNCTION = 'TSDeclareFunction';
const NODE_TS_INTERFACE_DECL = 'TSInterfaceDeclaration';
const NODE_VARIABLE_DECL = 'VariableDeclaration';
const NODE_VARIABLE_DECLARATOR = 'VariableDeclarator';
const NODE_PROPERTY_DEFINITION = 'PropertyDefinition';
const NODE_IDENTIFIER = 'Identifier';
const NODE_LITERAL = 'Literal';
const NODE_TEMPLATE_LITERAL = 'TemplateLiteral';
const NODE_BLOCK_STATEMENT = 'BlockStatement';
const NODE_LOGICAL_EXPR = 'LogicalExpression';
const NODE_TS_AS_EXPR = 'TSAsExpression';
const NODE_ARRAY_EXPR = 'ArrayExpression';
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
const KIND_CONST = 'const';
const KEY_ARGUMENTS = 'arguments';
const OP_PLUS = '+';
const OP_ASSIGN = '=';
const CHAR_SPACE = ' ';

const DECL_KIND_MAP: ReadonlyMap<string, NodeKind> = new Map<string, NodeKind>([
    [NODE_PROGRAM, NodeKind.SourceFile],
    [NODE_KIND_FUNCTION_DECLARATION, NodeKind.Function],
    [NODE_KIND_FUNCTION_EXPRESSION, NodeKind.Function],
    [NODE_ARROW_FUNCTION_EXPR, NodeKind.Function],
    [NODE_TS_DECLARE_FUNCTION, NodeKind.Function],
    [NODE_KIND_METHOD_DEFINITION, NodeKind.Method],
    [NODE_KIND_CLASS_DECLARATION, NodeKind.Class],
    [NODE_KIND_CLASS_EXPRESSION, NodeKind.Class],
    [NODE_TS_INTERFACE_DECL, NodeKind.Interface],
    [NODE_VARIABLE_DECL, NodeKind.Variable],
]);

/** Determine NodeKind for declaration-like oxc AST nodes. */
function getOxcDeclarationKind(node: OxcNode): NodeKind | undefined {
    if (node.type === NODE_KIND_PROPERTY) {
        return node.method ? NodeKind.Method : NodeKind.Other;
    }
    return DECL_KIND_MAP.get(node.type);
}

const EXPRESSION_KIND_MAP: ReadonlyMap<string, NodeKind> = new Map<string, NodeKind>([
    [NODE_KIND_CALL_EXPRESSION, NodeKind.Call],
    [NODE_NEW_EXPR, NodeKind.Call],
    [NODE_BINARY_EXPR, NodeKind.BinaryExpr],
    [NODE_LOGICAL_EXPR, NodeKind.BinaryExpr],
    [NODE_KIND_ASSIGNMENT_EXPRESSION, NodeKind.BinaryExpr],
]);

/** Determine NodeKind for literal and expression oxc AST nodes. */
function getOxcLiteralKind(node: OxcNode): NodeKind | undefined {
    if (node.type === NODE_LITERAL) {
        if (typeof node.value === TYPEOF_NUMBER) return NodeKind.NumericLiteral;
        if (typeof node.value === TYPEOF_STRING) return NodeKind.StringLiteral;
        return NodeKind.Other;
    }
    if (node.type === NODE_TEMPLATE_LITERAL) {
        return (node.expressions || []).length === 0 ? NodeKind.StringLiteral : NodeKind.Other;
    }
    return EXPRESSION_KIND_MAP.get(node.type);
}

const RAW_COMMON_CONTROL_FLOW =
    'IfStatement ForStatement ForInStatement ForOfStatement WhileStatement DoWhileStatement SwitchStatement CatchClause';
const RAW_EXTRA_STMT_FLOW = 'SwitchCase TryStatement';
const RAW_CALLABLE_OR_CAST_TYPES = 'NewExpression CallExpression TSAsExpression';
const RAW_OXC_TYPE_EXTRA = 'TSLiteralType TSTypeReference TSTypeAnnotation';

const STATEMENT_CONTROL_FLOW_TYPES: ReadonlySet<string> = new Set([
    ...RAW_COMMON_CONTROL_FLOW.split(CHAR_SPACE),
    ...RAW_EXTRA_STMT_FLOW.split(CHAR_SPACE),
]);

const CALLABLE_OR_CAST_TYPES: ReadonlySet<string> = new Set(
    RAW_CALLABLE_OR_CAST_TYPES.split(CHAR_SPACE),
);

const OXC_TYPE_EXTRA: ReadonlySet<string> = new Set(RAW_OXC_TYPE_EXTRA.split(CHAR_SPACE));

/** Determine NodeKind for control-flow and block oxc AST nodes. */
function getOxcStatementKind(node: OxcNode): NodeKind | undefined {
    if (STATEMENT_CONTROL_FLOW_TYPES.has(node.type)) return NodeKind.ControlFlow;
    return node.type === NODE_BLOCK_STATEMENT ? NodeKind.Block : undefined;
}

/**
 * Map an oxc ESTree AST node to the unified engine NodeKind.
 *
 * @param node - Raw oxc AST node to classify.
 * @returns Mapped NodeKind classification enum value.
 */
export function getOxcKind(node: OxcNode): NodeKind {
    return (
        getOxcDeclarationKind(node) ??
        getOxcLiteralKind(node) ??
        getOxcStatementKind(node) ??
        NodeKind.Other
    );
}

const RAW_OXC_BRANCH_WEIGHT_TYPES = `${RAW_COMMON_CONTROL_FLOW} ConditionalExpression`;
const OXC_BRANCH_WEIGHT_TYPES: ReadonlySet<string> = new Set(
    RAW_OXC_BRANCH_WEIGHT_TYPES.split(CHAR_SPACE),
);

const RAW_OXC_LOGICAL_OPS = '&& || ??';
const OXC_LOGICAL_OPS: ReadonlySet<string> = new Set(RAW_OXC_LOGICAL_OPS.split(CHAR_SPACE));

/**
 * Calculate cyclomatic decision-point weight for an oxc node (SwitchCase default -> 0).
 *
 * @param node - Raw oxc AST node to evaluate.
 * @returns Decision point branch weight (0 or 1).
 */
export function getOxcBranchWeight(node: OxcNode): number {
    if (OXC_BRANCH_WEIGHT_TYPES.has(node.type)) return 1;
    if (node.type === NODE_SWITCH_CASE) return node.test ? 1 : 0;
    if (node.type === NODE_BINARY_EXPR || node.type === NODE_LOGICAL_EXPR) {
        return OXC_LOGICAL_OPS.has(node.operator as string) ? 1 : 0;
    }
    return 0;
}

function findOxcTargetFnNode(node: OxcNode): OxcNode | undefined {
    switch (node.type) {
        case NODE_VARIABLE_DECLARATOR:
            return node.init;
        case NODE_KIND_PROPERTY:
            return node.method ? undefined : node.value;
        case NODE_PROPERTY_DEFINITION:
            return node.value;
        case NODE_KIND_ASSIGNMENT_EXPRESSION:
            return node.operator === OP_ASSIGN ? node.right : undefined;
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
export function isOxcBindingIntroduced(node: OxcNode): boolean {
    const target = findOxcTargetFnNode(node);
    return Boolean(target && target.type && FN_TYPES.has(target.type));
}

/** Extract text identifier from a property or method key node. */
function getOxcKeyText(key: OxcNode, ctx: Ctx): string {
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
export function getOxcBindingName(node: OxcNode, ctx: Ctx): string | null {
    if (node.type === NODE_VARIABLE_DECLARATOR) {
        return node.id && typeof node.id.name === TYPEOF_STRING ? node.id.name : null;
    }
    if (node.type === NODE_KIND_PROPERTY || node.type === NODE_PROPERTY_DEFINITION) {
        return node.key ? getOxcKeyText(node.key, ctx) : null;
    }
    if (node.type === NODE_KIND_ASSIGNMENT_EXPRESSION) {
        if (
            node.left &&
            (node.left.type === NODE_KIND_MEMBER_EXPRESSION || node.left.type === NODE_IDENTIFIER)
        ) {
            return ctx.src.slice(node.left.start, node.left.end);
        }
        return null;
    }
    return null;
}

const NAMED_DECL_TYPES: ReadonlySet<string> = new Set([
    NODE_KIND_FUNCTION_DECLARATION,
    NODE_KIND_FUNCTION_EXPRESSION,
    NODE_TS_DECLARE_FUNCTION,
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
export function getOxcName(node: OxcNode, ctx: Ctx): string | null {
    if (NAMED_DECL_TYPES.has(node.type)) {
        return node.id && typeof node.id.name === TYPEOF_STRING ? node.id.name : null;
    }
    if (node.type === NODE_ARROW_FUNCTION_EXPR) return null;
    if (
        node.type === NODE_KIND_METHOD_DEFINITION ||
        (node.type === NODE_KIND_PROPERTY && node.method === true)
    ) {
        return node.key ? getOxcKeyText(node.key, ctx) : null;
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

/**
 * Check whether a literal value is bound to a const declaration or enum member.
 *
 * @param node - Raw literal oxc node.
 * @param parent - Raw parent oxc node.
 * @param grandparent - Raw grandparent oxc node.
 * @returns True if literal is bound to a const declaration or enum member.
 */
export function isOxcConstBound(
    node: OxcNode,
    parent: OxcNode | undefined,
    grandparent: OxcNode | undefined,
): boolean {
    const isConstVar =
        parent?.type === NODE_VARIABLE_DECLARATOR &&
        parent.init === node &&
        grandparent?.type === NODE_VARIABLE_DECL &&
        grandparent.kind === KIND_CONST;
    if (isConstVar) return true;
    if (
        parent?.type === NODE_TS_ENUM_MEMBER ||
        parent?.type === NODE_TS_AS_EXPR ||
        grandparent?.type === NODE_TS_AS_EXPR
    ) {
        return true;
    }
    return (
        parent?.type === NODE_ARRAY_EXPR &&
        Boolean(grandparent?.type && CALLABLE_OR_CAST_TYPES.has(grandparent.type))
    );
}

function isOxcToleratedCallArg(node: OxcNode, parentNode: OxcNode, ctx?: Ctx): boolean {
    if (parentNode.type !== NODE_KIND_CALL_EXPRESSION || !ctx) return false;
    const callArgs: unknown = parentNode[KEY_ARGUMENTS];
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
function isOxcNumericTolerated(node: OxcNode, parentNode: OxcNode, ctx?: Ctx): boolean {
    const isDirectTolerated =
        parentNode.type === NODE_KIND_MEMBER_EXPRESSION ||
        (parentNode.type === NODE_KIND_PROPERTY && parentNode.key === node) ||
        parentNode.type === NODE_TS_ENUM_MEMBER ||
        TYPE_SKIP_TYPES.has(parentNode.type) ||
        OXC_TYPE_EXTRA.has(parentNode.type) ||
        (parentNode.type === NODE_SWITCH_CASE && parentNode.test === node);
    return isDirectTolerated ? true : isOxcToleratedCallArg(node, parentNode, ctx);
}

function isOxcCallTolerated(caller: OxcNode, argumentNode: OxcNode, ctx: Ctx): boolean {
    if (caller.type !== NODE_KIND_CALL_EXPRESSION && caller.type !== NODE_NEW_EXPR) return false;
    const callArguments: unknown = caller[KEY_ARGUMENTS];
    if (!Array.isArray(callArguments) || !callArguments.includes(argumentNode)) return false;
    const callee = caller.callee ? ctx.src.slice(caller.callee.start, caller.callee.end) : '';
    return (
        /\b(t|i18n\.\w*|translate|fmt|formatMessage)\s*$/.test(callee) ||
        TEST_AND_ASSERT_CALLEES.test(callee) ||
        ERROR_CONSTRUCTOR_CALLEES.test(callee) ||
        LOGGING_AND_OUTPUT_CALLEES.test(callee)
    );
}

/** Check whether a string literal appears in a tolerated AST context. */
function isOxcStringTolerated(
    node: OxcNode,
    parentNode: OxcNode,
    ctx: Ctx,
    grandparent?: OxcNode,
): boolean {
    const parentType = parentNode.type;
    const isDirectStringTolerated =
        parentType === NODE_IMPORT_DECL ||
        parentType === NODE_TS_IMPORT_EQUALS ||
        parentType === NODE_THROW_STMT ||
        (parentType === NODE_KIND_PROPERTY && parentNode.key === node) ||
        parentType === NODE_KIND_MEMBER_EXPRESSION ||
        (parentType === NODE_JSX_ATTRIBUTE && parentNode.name === node) ||
        (parentType === NODE_SWITCH_CASE && parentNode.test === node);
    if (isDirectStringTolerated) return true;
    if (parentType === NODE_JSX_ELEMENT || parentType === NODE_JSX_OPENING_ELEMENT) return false;
    if (isOxcCallTolerated(parentNode, node, ctx)) return true;
    if (grandparent && parentType === NODE_BINARY_EXPR && parentNode.operator === OP_PLUS) {
        return isOxcCallTolerated(grandparent, parentNode, ctx);
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
export function isOxcTolerated(
    node: OxcNode,
    parentNode: OxcNode | undefined,
    ctx: Ctx,
    grandparent?: OxcNode,
): boolean {
    if (!parentNode) return false;
    if (typeof node.value === TYPEOF_NUMBER) {
        return isOxcNumericTolerated(node, parentNode, ctx);
    }
    return isOxcStringTolerated(node, parentNode, ctx, grandparent);
}

/**
 * Test if an oxc node represents a function or method boundary.
 *
 * @param node - Raw oxc AST node.
 * @returns True if node is a function or method kind.
 */
export function isOxcFnLikeNode(node: OxcNode): boolean {
    const kind = getOxcKind(node);
    return kind === NodeKind.Function || kind === NodeKind.Method;
}

/**
 * Compute 1-based line/column position from UTF-16 offset via binary search over line starts.
 *
 * @param offset - UTF-16 character offset in source text.
 * @param ctx - Parser context with lineStarts table.
 * @returns 1-based line and column Position.
 */
export function getOxcPos(offset: number, ctx: Ctx): Position {
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
export function getOxcLiteralText(node: OxcNode, ctx: Ctx): string {
    if (node.type === NODE_TEMPLATE_LITERAL) return ctx.src.slice(node.start, node.end);
    return node.raw != null ? String(node.raw) : ctx.src.slice(node.start, node.end);
}

export {
    getOxcKind as oxcKindOf,
    getOxcBranchWeight as oxcBranchWeightOf,
    isOxcBindingIntroduced as oxcIntroducesBinding,
    getOxcBindingName as oxcBindingNameOf,
    getOxcName as oxcNameOf,
    isOxcConstBound as oxcIsConstBoundOf,
    isOxcTolerated as oxcIsToleratedOf,
    isOxcFnLikeNode as oxcIsFnLikeNode,
    getOxcPos as oxcPosOf,
    getOxcLiteralText as oxcLiteralText,
};
