/**
 * Module: Static Analysis Engine — Ternary Simplification & Immutable Folding
 * File Path: src/analyzers/simplify-ternary.ts
 * Architecture Role: Traverses AST blocks to detect redundant if-else branches that can
 *   be folded into pure shallow ternary expressions or immutable const bindings.
 * Dependencies & Triggers: TypeScript AST parser, core issue types, and simplify options;
 *   invoked by SimplifyAnalyzer when analyzing TypeScript and JavaScript sources.
 * Responsibilities: Scan statement lists and sibling statement pairs to invoke matchers for
 *   conditional returns, assignments, and immutable declaration promotions.
 * Exit Semantics & Design Rationale: Stateless and deterministic traversal; never mutates input
 *   AST nodes; accumulates standardized Issue records without side-effects.
 */

import * as ts from 'typescript';
import type { AnalyzerContext, Issue } from '../core/types';
import type { SimplifyOptions } from './simplify';
import {
    type TernaryMatcherContext,
    type StatementPositionRange,
    tryFoldReturnTernary,
    tryFoldTernaryCandidate,
    unwrapSingleStatement,
    isPureShallowExpression,
    formatTernaryCandidate,
    getStatementPositionRange,
    makeSimplifyIssue,
    RULE_SIM_TRN,
    OPPORTUNITY_SEQUENTIAL_RETURN,
    PREFIX_RETURN,
} from './simplify-ternary-matchers';

const DEFAULT_MAX_TERNARY_LENGTH = 80;
const RULE_SIM_IMM = 'SIM-IMM-001';
const OPPORTUNITY_CONDITIONAL_ASSIGNMENT_IMMUTABLE = 'conditional-assignment-immutable';
const OPPORTUNITY_CONDITIONAL_ASSIGNMENT = 'conditional-assignment';

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
                `Mutable \`let ${targetName}\` with conditional initialization can be folded into an immutable \`const\` binding.`,
                `Fold mutable binding into immutable const declaration: \`${candidate}\``,
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
            `Conditional assignment to \`${targetName}\` can be folded into a shallow ternary expression.`,
            `Fold into shallow ternary expression: \`${candidate}\``,
            pos,
            OPPORTUNITY_CONDITIONAL_ASSIGNMENT,
            canMakeImmutable,
            candidate,
        ),
    );
}

function tryFoldAssignmentTernary(
    stmt: ts.IfStatement,
    prevStmt: ts.Statement | undefined,
    thenStmt: ts.Statement,
    elseStmt: ts.Statement,
    condText: string,
    ctx: TernaryMatcherContext,
): boolean {
    const pair = matchAssignmentBranchPair(thenStmt, elseStmt);
    if (!pair) {
        return false;
    }

    const canMakeImmutable = isPrecedingLetDeclaration(prevStmt, pair.targetName);
    const prefix = canMakeImmutable ? `const ${pair.targetName} = ` : `${pair.targetName} = `;
    const folded = tryFoldTernaryCandidate(stmt, prefix, condText, pair, ctx.sf, ctx.maxLen);
    if (!folded) {
        return false;
    }

    emitAssignmentTernaryIssues(
        pair.targetName,
        folded.candidate,
        canMakeImmutable,
        folded.pos,
        ctx,
    );
    return true;
}

/**
 * Check and emit ternary simplification opportunities for an if statement with else.
 */
function checkIfElseTernary(
    stmt: ts.IfStatement,
    prevStmt: ts.Statement | undefined,
    ctx: TernaryMatcherContext,
): void {
    if (!stmt.elseStatement || ts.isIfStatement(stmt.elseStatement)) {
        return;
    }

    const thenStmt = unwrapSingleStatement(stmt.thenStatement);
    const elseStmt = unwrapSingleStatement(stmt.elseStatement);
    if (!thenStmt || !elseStmt) {
        return;
    }

    const cond = stmt.expression;
    if (!isPureShallowExpression(cond)) {
        return;
    }
    const condText = cond.getText(ctx.sf).trim();

    if (tryFoldReturnTernary(stmt, thenStmt, elseStmt, condText, ctx)) {
        return;
    }
    tryFoldAssignmentTernary(stmt, prevStmt, thenStmt, elseStmt, condText, ctx);
}

/**
 * Check whether statements match a sequential return pattern.
 */
function isSequentialReturnCandidate(
    stmt: ts.IfStatement,
    nextStmt: ts.Statement | undefined,
    thenStmt: ts.Statement | null,
): boolean {
    if (stmt.elseStatement || !nextStmt || !ts.isReturnStatement(nextStmt)) {
        return false;
    }
    if (!thenStmt || !ts.isReturnStatement(thenStmt)) {
        return false;
    }
    return Boolean(thenStmt.expression && nextStmt.expression);
}

/**
 * Check consecutive statements for: if (c) return a; return b;
 */
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

/**
 * Scan a list of sibling statements within a block, function, or source file.
 *
 * @param statements - Sequence of sibling statements.
 * @param sf - Source file.
 * @param file - Normalized file path.
 * @param maxLen - Maximum allowable line length.
 * @param issues - Issues accumulator.
 */
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

/**
 * Traverse an AST node recursively and inspect all statement sequences.
 *
 * @param node - AST node.
 * @param sf - Source file.
 * @param file - Normalized file path.
 * @param maxLen - Maximum allowable line length.
 * @param issues - Issues accumulator.
 */
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
