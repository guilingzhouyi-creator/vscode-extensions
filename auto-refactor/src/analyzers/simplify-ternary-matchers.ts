/**
 * Module: Static Analysis Engine — Ternary Simplification Matchers
 * File Path: src/analyzers/simplify-ternary-matchers.ts
 * Architecture Role: Provides AST matching patterns for foldable if-else returns,
 *   assignments, and sequential returns into ternary expressions.
 * Dependencies & Triggers: TypeScript AST parser, core Issue and severity types, and simplify
 *   literals; invoked by simplify-ternary scanner on candidate if-else statements.
 * Responsibilities: Match return and assignment patterns across then/else branches, check
 *   side-effect purity, verify candidate line length, and emit standardized simplify issues.
 * Exit Semantics & Design Rationale: Pure inspection and match functions returning booleans;
 *   appends issues directly to caller-supplied array; bounds cyclomatic complexity to <= 12.
 */

import * as ts from 'typescript';
import type { Issue } from '../core/types';
import { SEVERITY_INFO } from '../core/types';
import { ANALYZER_SIMPLIFY } from '../core/scoring/dimensionLiterals';

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
export interface StatementPositionRange {
    start: ts.LineAndCharacter;
    end: ts.LineAndCharacter;
}

/** Rule identifier for ternary return and assignment simplifications. */
export const RULE_SIM_TRN = 'SIM-TRN-001';

const REWARD_BONUS_IMMUTABLE = 5;
const REWARD_BONUS_SHALLOW = 3;
const COGNITIVE_DELTA_IMMUTABLE = -REWARD_BONUS_IMMUTABLE;
const COGNITIVE_DELTA_SHALLOW = -REWARD_BONUS_SHALLOW;

const OPPORTUNITY_CONDITIONAL_RETURN = 'conditional-return';
/** Opportunity identifier for sequential returns folding into a ternary. */
export const OPPORTUNITY_SEQUENTIAL_RETURN = 'sequential-return';
/** Code prefix keyword for ternary return statements. */
export const PREFIX_RETURN = 'return ';

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
 * @param node - The AST node to inspect for purity and depth.
 * @returns True if the node is side-effect-free and shallow, false otherwise.
 */
export function isPureShallowExpression(node: ts.Node): boolean {
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
 * @param stmt - The statement or block to unwrap.
 * @returns The inner single statement, or null if the block has 0 or >1 statements.
 */
export function unwrapSingleStatement(stmt: ts.Statement): ts.Statement | null {
    if (ts.isBlock(stmt)) {
        return stmt.statements.length === 1 ? stmt.statements[0] : null;
    }
    return stmt;
}

/**
 * Helper to obtain the 0-based line/col range between two AST nodes.
 *
 * @param sf - The TypeScript SourceFile instance.
 * @param startNode - AST node defining the start position.
 * @param endNode - AST node defining the end position.
 * @returns Object containing 0-based start and end line/character positions.
 */
export function getStatementPositionRange(
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
 * @param prefix - Prefix statement code (e.g., 'return ' or 'const x = ').
 * @param condText - Conditional expression string.
 * @param trueExpr - Expression for the truthy branch.
 * @param falseExpr - Expression for the falsy branch.
 * @param sf - SourceFile used to extract expression texts.
 * @param maxLen - Maximum allowed character length for the candidate line.
 * @returns Formatted candidate statement string if within maxLen, or null.
 */
export function formatTernaryCandidate(
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
 * @param file - File path where the opportunity was discovered.
 * @param rule - Rule identifier (e.g., SIM-TRN-001 or SIM-IMM-001).
 * @param message - Human-readable diagnostic message.
 * @param suggestion - Concrete refactoring suggestion text.
 * @param pos - 0-based start and end line/character positions.
 * @param opportunity - Kind of opportunity (e.g. conditional-return).
 * @param canMakeImmutable - Whether the binding can be promoted to const.
 * @param candidate - Formatted suggested code candidate.
 * @returns Standardized Issue object ready for reporting.
 */
export function makeSimplifyIssue(
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
export interface TernaryBranchPair {
    trueExpr: ts.Expression;
    falseExpr: ts.Expression;
}

/**
 * Candidate folded ternary expression with statement position range.
 */
export interface FoldedCandidate {
    candidate: string;
    pos: StatementPositionRange;
}

/**
 * Attempt to fold expressions into a candidate ternary with position metadata.
 *
 * @param stmt - Surrounding statement for positioning.
 * @param prefix - Prefix statement code.
 * @param condText - Conditional expression string.
 * @param pair - True and false branch expressions.
 * @param sf - SourceFile used to extract expression texts.
 * @param maxLen - Maximum allowed character length.
 * @returns Folded candidate record or null if invalid or exceeding length.
 */
export function tryFoldTernaryCandidate(
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
 * @param stmt - If statement candidate.
 * @param thenStmt - Unwrapped statement from the then branch.
 * @param elseStmt - Unwrapped statement from the else branch.
 * @param condText - Text of the if condition expression.
 * @param ctx - Shared ternary matcher context.
 * @returns True if folded and issue registered, false otherwise.
 */
export function tryFoldReturnTernary(
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
