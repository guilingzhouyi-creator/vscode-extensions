/**
 * Module: Core Engine — TypeScript AST Predicates and Classifiers
 * File Path: src/core/ast/ts-predicates.ts
 * Architecture Role: Pure predicates and syntactic classification functions for TypeScript AST
 *   nodes, shared across eager materialization and lazy streaming projection.
 * Dependencies & Triggers: typescript, ./multilang, ../utils/ast; imported by
 *   typescriptAdapter.ts and tsProjector.ts to prevent circular module evaluation.
 * Responsibilities: Map TypeScript SyntaxKind to normalized NodeKind, determine branch
 *   weights, extract binding/callee names, evaluate const/tolerated flags, and calculate line/col.
 * Exit Semantics & Design Rationale: All functions are pure, synchronous, and non-throwing;
 *   separating predicates into this leaf module establishes an acyclic module dependency graph.
 */

import * as ts from 'typescript';
import type { Position } from './multilang';
import { NodeKind } from './multilang';
import { isFunctionLike } from '../../utils/ast';
import { isCallArgumentToleratedByPolicy } from '../policy/literal-policy-engine';

const LOOP_AND_COND_KINDS = [
    ts.SyntaxKind.IfStatement,
    ts.SyntaxKind.ForStatement,
    ts.SyntaxKind.ForInStatement,
    ts.SyntaxKind.ForOfStatement,
    ts.SyntaxKind.WhileStatement,
    ts.SyntaxKind.DoStatement,
    ts.SyntaxKind.SwitchStatement,
];

/** Set of TypeScript syntax kinds that represent control flow or block scopes. */
export const CONTROL_OR_BLOCK = new Set<ts.SyntaxKind>([
    ts.SyntaxKind.Block,
    ts.SyntaxKind.TryStatement,
    ...LOOP_AND_COND_KINDS,
]);

/**
 * Test whether a node is a top-level declaration statement.
 *
 * @param node - TypeScript node to classify.
 * @returns True when node is one of the top-level declaration statement kinds.
 */
export function isTopLevelDecl(node: ts.Node): boolean {
    return (
        ts.isFunctionDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isInterfaceDeclaration(node) ||
        ts.isEnumDeclaration(node) ||
        ts.isTypeAliasDeclaration(node) ||
        ts.isModuleDeclaration(node) ||
        ts.isVariableStatement(node)
    );
}

/**
 * Test whether a node carries the export modifier.
 *
 * @param node - TypeScript node to inspect.
 * @returns True when the node's modifier list contains the export keyword.
 */
export function hasExportModifier(node: ts.Node): boolean {
    const list = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
    return Boolean(list?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword));
}

/**
 * Test whether a node introduces a variable or member binding with a function initializer.
 *
 * @param node - TypeScript node to classify.
 * @returns True for the four binding-source shapes.
 */
export function introducesBinding(node: ts.Node): boolean {
    if (ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node)) {
        return Boolean(node.initializer && isFunctionLike(node.initializer));
    }
    if (ts.isPropertyAssignment(node)) return isFunctionLike(node.initializer);
    return (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        isFunctionLike(node.right)
    );
}

/** Literal node kinds the analyzers consume (constants reads their text as the value). */
const LITERAL_KINDS = new Set<ts.SyntaxKind>([
    ts.SyntaxKind.NumericLiteral,
    ts.SyntaxKind.BigIntLiteral,
    ts.SyntaxKind.StringLiteral,
    ts.SyntaxKind.RegularExpressionLiteral,
    ts.SyntaxKind.NoSubstitutionTemplateLiteral,
]);

/**
 * Test whether a token carries no semantic value for analyzers and should be skipped.
 *
 * @param node - TypeScript node to test.
 * @returns True when the node is a punctuation, keyword, or identifier token to skip.
 */
export function isSkippableToken(node: ts.Node): boolean {
    return (
        ts.isToken(node) &&
        !LITERAL_KINDS.has(node.kind) &&
        node.kind !== ts.SyntaxKind.FunctionKeyword &&
        !ts.isModifier(node)
    );
}

/**
 * Resolve the bound identifier or property name for an assignment or declaration.
 *
 * @param node - Candidate binding-source node.
 * @param sf - Source file used to resolve identifier and property text.
 * @returns The bound name, or null when the node is not a binding source.
 */
export function bindingName(node: ts.Node, sf: ts.SourceFile): string | null {
    if (ts.isVariableDeclaration(node) && node.initializer && isFunctionLike(node.initializer)) {
        return (node.name as ts.Identifier)?.getText?.(sf) ?? null;
    }
    const isProp = ts.isPropertyAssignment(node) || ts.isPropertyDeclaration(node);
    if (isProp && node.initializer && isFunctionLike(node.initializer)) {
        return node.name.getText(sf);
    }
    const isAssign =
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        isFunctionLike(node.right);
    if (isAssign && (ts.isPropertyAccessExpression(node.left) || ts.isIdentifier(node.left))) {
        return node.left.getText(sf);
    }
    return null;
}

const COMMON_BRANCH_KINDS = [
    ...LOOP_AND_COND_KINDS,
    ts.SyntaxKind.CaseClause,
    ts.SyntaxKind.CatchClause,
];

const CONTROL_FLOW_KINDS = new Set<ts.SyntaxKind>([
    ...COMMON_BRANCH_KINDS,
    ts.SyntaxKind.TryStatement,
]);

const KIND_MAP = new Map<ts.SyntaxKind, NodeKind>([
    [ts.SyntaxKind.SourceFile, NodeKind.SourceFile],
    [ts.SyntaxKind.FunctionDeclaration, NodeKind.Function],
    [ts.SyntaxKind.FunctionExpression, NodeKind.Function],
    [ts.SyntaxKind.ArrowFunction, NodeKind.Function],
    [ts.SyntaxKind.MethodDeclaration, NodeKind.Method],
    [ts.SyntaxKind.GetAccessor, NodeKind.Method],
    [ts.SyntaxKind.SetAccessor, NodeKind.Method],
    [ts.SyntaxKind.Constructor, NodeKind.Method],
    [ts.SyntaxKind.ClassDeclaration, NodeKind.Class],
    [ts.SyntaxKind.ClassExpression, NodeKind.Class],
    [ts.SyntaxKind.InterfaceDeclaration, NodeKind.Interface],
    [ts.SyntaxKind.VariableDeclaration, NodeKind.Variable],
    [ts.SyntaxKind.NumericLiteral, NodeKind.NumericLiteral],
    [ts.SyntaxKind.StringLiteral, NodeKind.StringLiteral],
    [ts.SyntaxKind.NoSubstitutionTemplateLiteral, NodeKind.StringLiteral],
    [ts.SyntaxKind.CallExpression, NodeKind.Call],
    [ts.SyntaxKind.NewExpression, NodeKind.Call],
    [ts.SyntaxKind.BinaryExpression, NodeKind.BinaryExpr],
    [ts.SyntaxKind.Block, NodeKind.Block],
]);

/**
 * Map a raw TypeScript SyntaxKind to the normalized NodeKind consumed by analyzers.
 *
 * @param node - Raw TypeScript node.
 * @returns The normalized NodeKind enum value.
 */
export function kindOf(node: ts.Node): NodeKind {
    if (CONTROL_FLOW_KINDS.has(node.kind)) return NodeKind.ControlFlow;
    return KIND_MAP.get(node.kind) ?? NodeKind.Other;
}

const BRANCH_WEIGHT_KINDS = new Set<ts.SyntaxKind>([
    ...COMMON_BRANCH_KINDS,
    ts.SyntaxKind.ConditionalExpression,
]);

/**
 * Calculate cyclomatic decision-point weight for a TypeScript node.
 *
 * @param node - Raw TypeScript node.
 * @returns Decision point weight (0 or 1).
 */
export function branchWeightOf(node: ts.Node): number {
    if (BRANCH_WEIGHT_KINDS.has(node.kind)) return 1;
    if (node.kind === ts.SyntaxKind.BinaryExpression) {
        const op = (node as ts.BinaryExpression).operatorToken.kind;
        if (
            op === ts.SyntaxKind.AmpersandAmpersandToken ||
            op === ts.SyntaxKind.BarBarToken ||
            op === ts.SyntaxKind.QuestionQuestionToken
        ) {
            return 1;
        }
    }
    return 0;
}

/**
 * Callee name of a call expression, reduced to its final segment.
 *
 * @param node - Candidate node.
 * @param sf - Owning source file, used for text extraction.
 * @returns The callee name, or null when not a call expression.
 */
export function calleeNameOf(node: ts.Node, sf: ts.SourceFile): string | null {
    if (!ts.isCallExpression(node)) return null;
    const text = node.expression.getText(sf);
    if (text.length === 0) return null;
    const dot = text.lastIndexOf('.');
    return dot >= 0 ? text.slice(dot + 1) : text;
}

/**
 * Resolve the declared name of a node for consumers that need it.
 *
 * @param node - Raw TypeScript node that may carry a name field.
 * @param sf - Source file used to extract name text.
 * @returns The non-empty name text, or null if unnamed.
 */
export function nameOf(node: ts.Node, sf: ts.SourceFile): string | null {
    const nameText = (node as ts.NamedDeclaration).name?.getText(sf);
    return typeof nameText === 'string' && nameText.length > 0 ? nameText : null;
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

const KEYWORD_CONST = 'const';

function isAsConst(node: ts.Node | undefined): boolean {
    if (!node) return false;
    if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
        const typeNode = node.type;
        return Boolean(
            ts.isTypeReferenceNode(typeNode) &&
            ts.isIdentifier(typeNode.typeName) &&
            typeNode.typeName.text === KEYWORD_CONST,
        );
    }
    return false;
}

function isFreezeCall(node: ts.Node | undefined): boolean {
    if (!node || !ts.isCallExpression(node)) return false;
    const expr = node.expression;
    if (ts.isIdentifier(expr) && (expr.text === 'deepFreeze' || expr.text === 'freeze')) {
        return true;
    }
    if (
        ts.isPropertyAccessExpression(expr) &&
        ts.isIdentifier(expr.expression) &&
        expr.expression.text === 'Object' &&
        expr.name.text === 'freeze'
    ) {
        return true;
    }
    return false;
}

/**
 * Test whether a node resides inside an `as const` expression or a const collection constructor.
 *
 * @param parent - Immediate parent node.
 * @param grandparent - Grandparent node.
 * @param greatGrandparent - Great-grandparent node.
 * @returns True when the literal is enclosed within a declared const structure.
 */
function isEnclosedInConstDeclaration(
    parent: ts.Node | undefined,
    grandparent?: ts.Node | undefined,
    greatGrandparent?: ts.Node | undefined,
): boolean {
    if (isAsConst(parent) || isAsConst(grandparent) || isAsConst(greatGrandparent)) return true;
    for (const candidateNode of [parent, grandparent, greatGrandparent]) {
        if (!candidateNode) continue;
        if (ts.isNewExpression(candidateNode) && ts.isIdentifier(candidateNode.expression)) {
            if (candidateNode.expression.text === 'Set' || candidateNode.expression.text === 'Map')
                return true;
        }
        if (isFreezeCall(candidateNode)) return true;
    }
    return false;
}

/**
 * Check whether a literal is bound to a const declaration or enum member.
 *
 * @param node - Literal node whose const-bound status is being resolved.
 * @param parent - Raw parent node.
 * @param grandparent - Raw grandparent node.
 * @param greatGrandparent - Optional raw great-grandparent node.
 * @returns True when the literal is the initializer of a const declaration or enum member.
 */
export function isConstBoundOf(
    node: ts.Node,
    parent: ts.Node | undefined,
    grandparent: ts.Node | undefined,
    greatGrandparent?: ts.Node | undefined,
): boolean {
    const isConstVar =
        parent &&
        ts.isVariableDeclaration(parent) &&
        parent.initializer === node &&
        grandparent &&
        ts.isVariableDeclarationList(grandparent) &&
        (grandparent.flags & ts.NodeFlags.Const) !== 0;
    if (isConstVar || (parent && ts.isEnumMember(parent))) return true;
    return isEnclosedInConstDeclaration(parent, grandparent, greatGrandparent);
}

function tsIsCallTolerated(caller: ts.Node, argumentNode: ts.Node, sf: ts.SourceFile): boolean {
    if (!ts.isCallExpression(caller) && !ts.isNewExpression(caller)) return false;
    if (!caller.arguments?.includes(argumentNode as ts.Expression)) return false;
    const callee = caller.expression.getText(sf);
    return (
        /\b(t|i18n\.\w*|translate|fmt|formatMessage)\s*$/.test(callee) ||
        TEST_AND_ASSERT_CALLEES.test(callee) ||
        ERROR_CONSTRUCTOR_CALLEES.test(callee) ||
        LOGGING_AND_OUTPUT_CALLEES.test(callee)
    );
}

const TOLERATED_STRING_PARENT_KINDS = new Set<ts.SyntaxKind>([
    ts.SyntaxKind.ImportDeclaration,
    ts.SyntaxKind.ImportEqualsDeclaration,
    ts.SyntaxKind.ExportDeclaration,
    ts.SyntaxKind.PropertyAccessExpression,
    ts.SyntaxKind.CaseClause,
    ts.SyntaxKind.ThrowStatement,
]);

const JSX_ELEMENT_KINDS = new Set<ts.SyntaxKind>([
    ts.SyntaxKind.JsxElement,
    ts.SyntaxKind.JsxSelfClosingElement,
]);

function isTypeContext(parentNode: ts.Node, grandparent?: ts.Node): boolean {
    if (ts.isTypeNode(parentNode)) return true;
    if (grandparent && ts.isTypeNode(grandparent)) return true;
    return false;
}

function isNamedPropertyContext(parentNode: ts.Node, node: ts.Node): boolean {
    if (ts.isPropertyAssignment(parentNode)) return parentNode.name === node;
    if (ts.isJsxAttribute(parentNode)) return parentNode.name === node;
    return false;
}

function isStringConcatTolerated(
    parentNode: ts.Node,
    sf: ts.SourceFile,
    grandparent?: ts.Node,
): boolean {
    if (!grandparent) return false;
    if (!ts.isBinaryExpression(parentNode)) return false;
    if (parentNode.operatorToken.kind !== ts.SyntaxKind.PlusToken) return false;
    return tsIsCallTolerated(grandparent, parentNode, sf);
}

function isToleratedString(
    node: ts.Node,
    parentNode: ts.Node,
    sf: ts.SourceFile,
    grandparent?: ts.Node,
): boolean {
    if (isTypeContext(parentNode, grandparent)) return true;
    if (TOLERATED_STRING_PARENT_KINDS.has(parentNode.kind)) return true;
    if (isNamedPropertyContext(parentNode, node)) return true;
    if (ts.isElementAccessExpression(parentNode)) return parentNode.argumentExpression === node;
    if (JSX_ELEMENT_KINDS.has(parentNode.kind)) return false;
    if (tsIsCallTolerated(parentNode, node, sf)) return true;
    return isStringConcatTolerated(parentNode, sf, grandparent);
}

function isToleratedCallArg(node: ts.Node, parentNode: ts.Node, sf?: ts.SourceFile): boolean {
    if (!ts.isCallExpression(parentNode) || !sf) return false;
    const args = parentNode.arguments;
    const argIdx = args.indexOf(node as ts.Expression);
    if (argIdx < 0) return false;
    const callee = parentNode.expression.getText(sf);
    const numVal = Number((node as ts.NumericLiteral).text ?? node.getText(sf));
    return isCallArgumentToleratedByPolicy(callee, argIdx, numVal);
}

function isToleratedNumeric(node: ts.Node, parentNode: ts.Node, sf?: ts.SourceFile): boolean {
    const isAccess =
        (ts.isElementAccessExpression(parentNode) && parentNode.argumentExpression === node) ||
        (ts.isPropertyAssignment(parentNode) && parentNode.name === node);
    if (isAccess || ts.isPropertyAccessExpression(parentNode) || ts.isEnumMember(parentNode))
        return true;
    if (ts.isTypeNode(parentNode) || ts.isCaseClause(parentNode)) return true;
    return isToleratedCallArg(node, parentNode, sf);
}

/**
 * Test whether a literal node resides in a tolerated context (e.g. imports, i18n).
 *
 * @param node - Literal node to classify.
 * @param parentNode - Raw parent node.
 * @param sf - Source file used to print call callees for the i18n heuristic.
 * @param grandparent - Optional raw grandparent node for compound expressions.
 * @returns True when the literal sits in a tolerated context.
 */
export function isToleratedOf(
    node: ts.Node,
    parentNode: ts.Node | undefined,
    sf: ts.SourceFile,
    grandparent?: ts.Node,
): boolean {
    if (!parentNode) return false;
    if (ts.isNumericLiteral(node)) return isToleratedNumeric(node, parentNode, sf);
    return isToleratedString(node, parentNode, sf, grandparent);
}

/**
 * Convert a character offset into a 1-based line/column position.
 *
 * @param pos - Absolute character offset inside the source file.
 * @param sf - Source file providing the line map.
 * @returns The normalized position with 1-based line and column numbers.
 */
export function posOf(pos: number, sf: ts.SourceFile): Position {
    const lineChar = sf.getLineAndCharacterOfPosition(pos);
    return { line: lineChar.line + 1, column: lineChar.character + 1 };
}
