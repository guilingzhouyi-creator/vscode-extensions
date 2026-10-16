/**
 * Module: Static Analysis Engine — Ternary Simplification & Immutable Folding
 * File Path: src/analyzers/simplify-ternary.ts
 * Architecture Role: High-cohesion AST traversal and pattern matcher detecting redundant if-else
 *   branches that can be folded into pure shallow ternary expressions or immutable const bindings.
 * Dependencies & Triggers: TypeScript AST parser, core issue types, and simplify options;
 *   invoked by SimplifyAnalyzer when analyzing TypeScript and JavaScript sources.
 * Responsibilities:
 *   1. Inspect statement lists and sibling pairs for foldable return and assignment branches;
 *   2. Check side-effect purity and shallow depth on candidate conditional branches;
 *   3. Enforce maximum line length constraints (default 80 characters);
 *   4. Emit standardized Issue records with cognitive delta and reward metrics.
 * Exit Semantics & Design Rationale: Stateless and deterministic traversal; never mutates input
 *   AST nodes; consolidates pattern matchers and traversals into a single cohesive module.
 */

import * as ts from 'typescript';
import type { AnalyzerContext, Issue } from '../core/types';
import { SEVERITY_INFO } from '../core/types';
import { ANALYZER_SIMPLIFY } from '../core/scoring/dimensionLiterals';
import type { SimplifyOptions } from './simplify';

/**
 * Shared context for ternary matching and opportunity registration.
 */
export interface TernaryMatcherContext {
    sf: ts.SourceFile;
    file: string;
    maxLen: number;
    issues: Issue[];
}

/**
 * 0-based character and line range of an AST node statement span.
 */
interface StatementPositionRange {
    start: ts.LineAndCharacter;
    end: ts.LineAndCharacter;
}

/** Rule identifier for ternary return and assignment simplifications. */
export const RULE_SIM_TRN = 'SIM-TRN-001';
/** Rule identifier for immutable const promotion simplifications. */
export const RULE_SIM_IMM = 'SIM-IMM-001';

const DEFAULT_MAX_TERNARY_LENGTH = 80;
const REWARD_BONUS_IMMUTABLE = 5;
const REWARD_BONUS_SHALLOW = 3;
const COGNITIVE_DELTA_IMMUTABLE = -REWARD_BONUS_IMMUTABLE;
const COGNITIVE_DELTA_SHALLOW = -REWARD_BONUS_SHALLOW;

const OPPORTUNITY_CONDITIONAL_RETURN = 'conditional-return';
const OPPORTUNITY_SEQUENTIAL_RETURN = 'sequential-return';
const OPPORTUNITY_CONDITIONAL_ASSIGNMENT_IMMUTABLE = 'conditional-assignment-immutable';
const OPPORTUNITY_CONDITIONAL_ASSIGNMENT = 'conditional-assignment';
const PREFIX_RETURN = 'return ';

/**
 * Check if a node is an increment or decrement expression.
 */
function isIncrementOrDecrement(n: ts.Node): boolean {
    return (
        (ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) &&
        (n.operator === ts.SyntaxKind.PlusPlusToken || n.operator === ts.SyntaxKind.MinusMinusToken)
    );
}

/**
 * Check whether an AST node introduces side-effects or multi-level nesting.
 */
function isImpureNode(n: ts.Node): boolean {
    if (ts.isConditionalExpression(n) || ts.isAwaitExpression(n) || ts.isYieldExpression(n)) {
        return true;
    }
    if (isIncrementOrDecrement(n)) {
        return true;
    }
    return (
        ts.isBinaryExpression(n) &&
        n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        n.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    );
}

/**
 * Check whether an AST node is a pure, side-effect-free, and shallow expression.
 *
 * @param node - AST node to inspect.
 * @returns True if the node and its descendants are pure and shallow.
 */
function isPureShallowExpression(node: ts.Node): boolean {
    let pure = true;

    function walk(n: ts.Node): void {
        if (!pure) {
            return;
        }
        if (isImpureNode(n)) {
            pure = false;
            return;
        }
        ts.forEachChild(n, walk);
    }

    walk(node);
    return pure;
}

/**
 * Unwrap a single statement from a statement or a 1-statement block.
 *
 * @param stmt - Statement or block to unwrap.
 * @returns Inner statement, or null if empty or multi-statement.
 */
function unwrapSingleStatement(stmt: ts.Statement): ts.Statement | null {
    if (ts.isBlock(stmt)) {
        return stmt.statements.length === 1 ? stmt.statements[0] : null;
    }
    return stmt;
}

/**
 * Helper to obtain the 0-based line/col range between two AST nodes.
 *
 * @param sf - Source file for position translation.
 * @param startNode - AST node defining range start.
 * @param endNode - AST node defining range end.
 * @returns 0-based start and end position range.
 */
function getStatementPositionRange(
    sf: ts.SourceFile,
    startNode: ts.Node,
    endNode: ts.Node,
): StatementPositionRange {
    return {
        start: sf.getLineAndCharacterOfPosition(startNode.getStart(sf)),
        end: sf.getLineAndCharacterOfPosition(endNode.getEnd()),
    };
}

/**
 * Format a ternary statement candidate and verify line length constraints.
 *
 * @param prefix - Prefix statement text (e.g. `return ` or `x = `).
 * @param condText - Evaluated condition expression text.
 * @param trueExpr - Expression for true branch.
 * @param falseExpr - Expression for false branch.
 * @param sf - Source file for expression text extraction.
 * @param maxLen - Maximum line length threshold.
 * @returns Formatted statement string if within maxLen, else null.
 */
function formatTernaryCandidate(
    prefix: string,
    condText: string,
    trueExpr: ts.Expression,
    falseExpr: ts.Expression,
    sf: ts.SourceFile,
    maxLen: number,
): string | null {
    const text = `${prefix}${condText} ? ${trueExpr.getText(sf).trim()} : ${falseExpr.getText(sf).trim()};`;
    return text.length <= maxLen ? text : null;
}

/**
 * Construct a standardized simplify issue with cognitive and reward scoring metrics.
 *
 * @param file - Relative file path.
 * @param rule - Rule identifier.
 * @param message - Descriptive issue message.
 * @param suggestion - Remediation advice.
 * @param pos - Statement position range.
 * @param opportunity - Descriptive refactoring opportunity tag.
 * @param canMakeImmutable - Whether refactoring allows const declaration.
 * @param candidate - Formatted suggested replacement code.
 * @returns Standardized simplify issue record.
 */
function makeSimplifyIssue(
    file: string,
    rule: string,
    message: string,
    suggestion: string,
    pos: StatementPositionRange,
    opportunity: string,
    canMakeImmutable: boolean,
    candidate: string,
): Issue {
    const start = { line: pos.start.line + 1, column: pos.start.character + 1 };
    const end = { line: pos.end.line + 1, column: pos.end.character + 1 };
    return {
        id: `simplify:${rule}:${file}:${start.line}`,
        analyzer: ANALYZER_SIMPLIFY,
        rule,
        severity: SEVERITY_INFO,
        message,
        location: { file, start, end },
        detail: {
            opportunity,
            canMakeImmutable,
            cognitiveDelta: canMakeImmutable ? COGNITIVE_DELTA_IMMUTABLE : COGNITIVE_DELTA_SHALLOW,
            rewardBonus: canMakeImmutable ? REWARD_BONUS_IMMUTABLE : REWARD_BONUS_SHALLOW,
            suggestedCode: candidate,
        },
        suggestion,
    };
}

/**
 * True and false branch expression pair.
 */
interface TernaryBranchPair {
    trueExpr: ts.Expression;
    falseExpr: ts.Expression;
}

/**
 * Candidate folded ternary expression with statement position range.
 */
interface FoldedCandidate {
    candidate: string;
    pos: StatementPositionRange;
}

/**
 * Attempt to fold expressions into a candidate ternary with position metadata.
 *
 * @param stmt - Enclosing if-statement node.
 * @param prefix - Target assignment or return prefix.
 * @param condText - Condition expression string.
 * @param pair - True and false branch expression pair.
 * @param sf - Source file for formatting.
 * @param maxLen - Maximum line length threshold.
 * @returns Folded candidate record, or null if impure or exceeds length.
 */
function tryFoldTernaryCandidate(
    stmt: ts.IfStatement,
    prefix: string,
    condText: string,
    pair: TernaryBranchPair,
    sf: ts.SourceFile,
    maxLen: number,
): FoldedCandidate | null {
    if (!isPureShallowExpression(pair.trueExpr) || !isPureShallowExpression(pair.falseExpr)) {
        return null;
    }
    const candidate = formatTernaryCandidate(
        prefix,
        condText,
        pair.trueExpr,
        pair.falseExpr,
        sf,
        maxLen,
    );
    if (!candidate) {
        return null;
    }
    return { candidate, pos: getStatementPositionRange(sf, stmt, stmt) };
}

/**
 * Attempt to fold if (c) return a; else return b; into a ternary return.
 *
 * @param stmt - Parent if statement node.
 * @param thenStmt - Then branch statement.
 * @param elseStmt - Else branch statement.
 * @param condText - Condition expression text.
 * @param ctx - Context carrying analysis options and issue accumulator.
 * @returns True if successfully matched and recorded finding.
 */
function tryFoldReturnTernary(
    stmt: ts.IfStatement,
    thenStmt: ts.Statement,
    elseStmt: ts.Statement,
    condText: string,
    ctx: TernaryMatcherContext,
): boolean {
    if (!ts.isReturnStatement(thenStmt) || !ts.isReturnStatement(elseStmt)) {
        return false;
    }
    if (!thenStmt.expression || !elseStmt.expression) {
        return false;
    }

    const folded = tryFoldTernaryCandidate(
        stmt,
        PREFIX_RETURN,
        condText,
        { trueExpr: thenStmt.expression, falseExpr: elseStmt.expression },
        ctx.sf,
        ctx.maxLen,
    );
    if (!folded) {
        return false;
    }

    ctx.issues.push(
        makeSimplifyIssue(
            ctx.file,
            RULE_SIM_TRN,
            'Conditional return can be simplified to a shallow ternary return.',
            `Fold into shallow ternary return: \`${folded.candidate}\``,
            folded.pos,
            OPPORTUNITY_CONDITIONAL_RETURN,
            false,
            folded.candidate,
        ),
    );
    return true;
}

/**
 * Check if a preceding statement is an uninitialized or default let declaration.
 */
function isPrecedingLetDeclaration(
    prevStmt: ts.Statement | undefined,
    targetName: string,
): boolean {
    if (!prevStmt || !ts.isVariableStatement(prevStmt)) {
        return false;
    }
    const declList = prevStmt.declarationList;
    if (declList.flags & ts.NodeFlags.Const) {
        return false;
    }
    for (const decl of declList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.name.text === targetName) {
            return true;
        }
    }
    return false;
}

interface AssignmentBranchPair {
    targetName: string;
    trueExpr: ts.Expression;
    falseExpr: ts.Expression;
}

function matchAssignmentBranchPair(
    thenStmt: ts.Statement,
    elseStmt: ts.Statement,
): AssignmentBranchPair | null {
    if (!ts.isExpressionStatement(thenStmt) || !ts.isExpressionStatement(elseStmt)) {
        return null;
    }
    const t = thenStmt.expression;
    const e = elseStmt.expression;
    if (
        !ts.isBinaryExpression(t) ||
        t.operatorToken.kind !== ts.SyntaxKind.EqualsToken ||
        !ts.isIdentifier(t.left)
    ) {
        return null;
    }
    if (
        !ts.isBinaryExpression(e) ||
        e.operatorToken.kind !== ts.SyntaxKind.EqualsToken ||
        !ts.isIdentifier(e.left)
    ) {
        return null;
    }
    if (t.left.text !== e.left.text) {
        return null;
    }
    return { targetName: t.left.text, trueExpr: t.right, falseExpr: e.right };
}

function emitAssignmentTernaryIssues(
    targetName: string,
    candidate: string,
    canMakeImmutable: boolean,
    pos: StatementPositionRange,
    ctx: TernaryMatcherContext,
): void {
    if (canMakeImmutable) {
        ctx.issues.push(
            makeSimplifyIssue(
                ctx.file,
                RULE_SIM_IMM,
                `Conditional assignment to '${targetName}' can be folded into an immutable const declaration with a ternary.`,
                `Fold into const declaration: \`${candidate}\``,
                pos,
                OPPORTUNITY_CONDITIONAL_ASSIGNMENT_IMMUTABLE,
                true,
                candidate,
            ),
        );
    }

    ctx.issues.push(
        makeSimplifyIssue(
            ctx.file,
            RULE_SIM_TRN,
            `Conditional assignment to '${targetName}' can be simplified to a shallow ternary assignment.`,
            `Fold into ternary assignment: \`${candidate}\``,
            pos,
            OPPORTUNITY_CONDITIONAL_ASSIGNMENT,
            false,
            candidate,
        ),
    );
}

function tryFoldAssignmentTernary(
    stmt: ts.IfStatement,
    thenStmt: ts.Statement,
    elseStmt: ts.Statement,
    prevStmt: ts.Statement | undefined,
    condText: string,
    ctx: TernaryMatcherContext,
): boolean {
    const pair = matchAssignmentBranchPair(thenStmt, elseStmt);
    if (!pair) {
        return false;
    }

    const canMakeImmutable = isPrecedingLetDeclaration(prevStmt, pair.targetName);
    const prefix = canMakeImmutable ? `const ${pair.targetName} = ` : `${pair.targetName} = `;

    const folded = tryFoldTernaryCandidate(
        stmt,
        prefix,
        condText,
        { trueExpr: pair.trueExpr, falseExpr: pair.falseExpr },
        ctx.sf,
        ctx.maxLen,
    );
    if (!folded) {
        return false;
    }

    const pos =
        canMakeImmutable && prevStmt
            ? getStatementPositionRange(ctx.sf, prevStmt, stmt)
            : folded.pos;

    emitAssignmentTernaryIssues(pair.targetName, folded.candidate, canMakeImmutable, pos, ctx);
    return true;
}

function checkIfElseTernary(
    stmt: ts.IfStatement,
    prevStmt: ts.Statement | undefined,
    ctx: TernaryMatcherContext,
): void {
    if (!stmt.elseStatement) {
        return;
    }

    const cond = stmt.expression;
    if (!isPureShallowExpression(cond)) {
        return;
    }

    const thenStmt = unwrapSingleStatement(stmt.thenStatement);
    const elseStmt = unwrapSingleStatement(stmt.elseStatement);
    if (!thenStmt || !elseStmt) {
        return;
    }

    const condText = cond.getText(ctx.sf).trim();
    if (tryFoldReturnTernary(stmt, thenStmt, elseStmt, condText, ctx)) {
        return;
    }

    tryFoldAssignmentTernary(stmt, thenStmt, elseStmt, prevStmt, condText, ctx);
}

function isSequentialReturnCandidate(
    stmt: ts.IfStatement,
    nextStmt: ts.Statement | undefined,
    thenStmt: ts.Statement | null,
): boolean {
    if (stmt.elseStatement) {
        return false;
    }
    if (!nextStmt || !ts.isReturnStatement(nextStmt)) {
        return false;
    }
    if (!thenStmt || !ts.isReturnStatement(thenStmt)) {
        return false;
    }
    return Boolean(thenStmt.expression && nextStmt.expression);
}

function checkSequentialReturnTernary(
    stmt: ts.IfStatement,
    nextStmt: ts.Statement | undefined,
    ctx: TernaryMatcherContext,
): void {
    const thenStmt = unwrapSingleStatement(stmt.thenStatement);
    if (!isSequentialReturnCandidate(stmt, nextStmt, thenStmt)) {
        return;
    }

    const returnThen = thenStmt as ts.ReturnStatement;
    const returnNext = nextStmt as ts.ReturnStatement;
    const cond = stmt.expression;
    if (
        !isPureShallowExpression(cond) ||
        !isPureShallowExpression(returnThen.expression!) ||
        !isPureShallowExpression(returnNext.expression!)
    ) {
        return;
    }

    const candidate = formatTernaryCandidate(
        PREFIX_RETURN,
        cond.getText(ctx.sf).trim(),
        returnThen.expression!,
        returnNext.expression!,
        ctx.sf,
        ctx.maxLen,
    );
    if (!candidate) {
        return;
    }

    const pos = getStatementPositionRange(ctx.sf, stmt, returnNext);
    ctx.issues.push(
        makeSimplifyIssue(
            ctx.file,
            RULE_SIM_TRN,
            'Guard conditional return followed by fallthrough return can be simplified to a shallow ternary return.',
            `Fold into shallow ternary return: \`${candidate}\``,
            pos,
            OPPORTUNITY_SEQUENTIAL_RETURN,
            false,
            candidate,
        ),
    );
}

function scanStatements(
    statements: readonly ts.Statement[],
    sf: ts.SourceFile,
    file: string,
    maxLen: number,
    issues: Issue[],
): void {
    const ctx: TernaryMatcherContext = { sf, file, maxLen, issues };
    for (let i = 0; i < statements.length; i++) {
        const stmt = statements[i];
        if (ts.isIfStatement(stmt)) {
            const prevStmt = i > 0 ? statements[i - 1] : undefined;
            const nextStmt = i + 1 < statements.length ? statements[i + 1] : undefined;

            checkIfElseTernary(stmt, prevStmt, ctx);
            checkSequentialReturnTernary(stmt, nextStmt, ctx);
        }
    }
}

function walkNode(
    node: ts.Node,
    sf: ts.SourceFile,
    file: string,
    maxLen: number,
    issues: Issue[],
): void {
    if (ts.isBlock(node) || ts.isSourceFile(node) || ts.isModuleBlock(node)) {
        scanStatements(node.statements, sf, file, maxLen, issues);
    } else if (ts.isCaseClause(node) || ts.isDefaultClause(node)) {
        scanStatements(node.statements, sf, file, maxLen, issues);
    }

    ts.forEachChild(node, (child) => walkNode(child, sf, file, maxLen, issues));
}

/**
 * Detect ternary simplification and immutable folding opportunities in a TypeScript AST.
 *
 * @param sf - Parsed TypeScript source file.
 * @param ctx - Analyzer context.
 * @param opts - Merged simplify options.
 * @param issues - Target issue accumulator.
 */
export function detectTernaryOpportunities(
    sf: ts.SourceFile,
    ctx: AnalyzerContext,
    opts: SimplifyOptions,
    issues: Issue[],
): void {
    if (opts.checkTernarySimplification === false) return;
    const maxLen = opts.maxTernaryLength ?? DEFAULT_MAX_TERNARY_LENGTH;
    const file = ctx.filePath.replace(/\\/g, '/');
    walkNode(sf, sf, file, maxLen, issues);
}
