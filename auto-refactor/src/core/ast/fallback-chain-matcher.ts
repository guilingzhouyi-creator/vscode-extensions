/**
 * Module: Core AST — Fallback Chain Matcher
 * File Path: src/core/ast/fallback-chain-matcher.ts
 * Architecture Role: Detects redundant or transitional fallback chains (?? or || cascades) across
 *   generational identifiers (e.g., timeoutMs ?? legacyTimeout) in non-perimeter source code,
 *   emitting canonical MOD-FLB-001 issues.
 * Dependencies & Triggers: Consumes typescript AST (ts.SourceFile) and Issue types;
 *   invoked by scanning pipeline and modernity analyzers.
 * Responsibilities:
 *   1. Traverse AST for BinaryExpression nodes using NullishCoalescing (??) or LogicalOr (||);
 *   2. Detect chained fallback cascades of depth >= 2 (e.g., a ?? b ?? c);
 *   3. Identify cross-generational operands sharing root names (e.g., timeoutMs ?? legacyTimeout);
 *   4. Exclude safe constant default fallbacks (e.g., ?? 3000, ?? 'default', ?? false);
 *   5. Exclude perimeter files or perimeter function contexts when configured;
 *   6. Emit canonical MOD-FLB-001 issues with actionable modernization suggestions.
 * Exit Semantics & Design Rationale: Zero transient heap allocation in traversal;
 *   pure function returning Issue[] with flat guard clauses.
 */

import * as ts from 'typescript';
import type { Issue } from '../types';
import { SEVERITY_WARNING } from '../types';
import { loc } from '../../utils/ast';
import { ANALYZER_GOVERNANCE } from '../scoring/dimensionLiterals';

/** Canonical rule identifier for cross-generational fallback chains. */
export const MOD_FLB_RULE_ID = 'MOD-FLB-001';

const GENERATIONAL_STRIP_RE = /^(?:legacy|old|compat|deprecated|raw|prev|prior)_?|_?(?:v1|v2|old|legacy|fallback|prior|ms|sec)$/gi;

/**
 * Checks whether file path belongs to architectural perimeter (adapters, compat shims, gateways).
 *
 * @param filePath - Repository relative POSIX file path.
 * @returns True if path matches perimeter conventions.
 */
export function isPerimeterPath(filePath: string): boolean {
    const normalized = filePath.replace(/\\/g, '/').toLowerCase();
    return (
        normalized.includes('/adapter/') ||
        normalized.includes('/adapters/') ||
        normalized.includes('/compat/') ||
        normalized.includes('/shims/') ||
        normalized.includes('/perimeter/') ||
        normalized.includes('/gateway/') ||
        normalized.includes('/bridges/') ||
        normalized.endsWith('adapter.ts') ||
        normalized.endsWith('shim.ts')
    );
}

/**
 * Tests if an AST expression is a safe constant literal default.
 *
 * @param expr - Target expression AST node.
 * @returns True if expression is a literal default value.
 */
function isConstantLiteral(expr: ts.Expression): boolean {
    if (ts.isNumericLiteral(expr) || ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
        return true;
    }
    const k = expr.kind;
    if (
        k === ts.SyntaxKind.TrueKeyword ||
        k === ts.SyntaxKind.FalseKeyword ||
        k === ts.SyntaxKind.NullKeyword ||
        k === ts.SyntaxKind.UndefinedKeyword
    ) {
        return true;
    }
    if (ts.isArrayLiteralExpression(expr) && expr.elements.length === 0) return true;
    if (ts.isObjectLiteralExpression(expr) && expr.properties.length === 0) return true;
    return false;
}

/**
 * Flattens a nested binary expression tree of the same operator into a linear operand list.
 *
 * @param node - Root binary expression node.
 * @param targetOp - Target token kind (?? or ||).
 * @param out - Accumulator array for linear operands.
 */
function collectChainedOperands(
    node: ts.Expression,
    targetOp: ts.SyntaxKind,
    out: ts.Expression[],
): void {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === targetOp) {
        collectChainedOperands(node.left, targetOp, out);
        collectChainedOperands(node.right, targetOp, out);
    } else {
        out.push(node);
    }
}

/**
 * Extracts a normalized semantic stem by stripping generational tokens.
 *
 * @param identifier - Raw identifier string.
 * @returns Normalized stem text.
 */
function extractSemanticStem(identifier: string): string {
    const lower = identifier.toLowerCase();
    const stripped = lower.replace(GENERATIONAL_STRIP_RE, '');
    return stripped.length >= 3 ? stripped : lower;
}

/**
 * Checks whether two identifier strings exhibit cross-generational co-root traits.
 *
 * @param idA - First identifier.
 * @param idB - Second identifier.
 * @returns True if identifiers share semantic stem with generational variance.
 */
function isCrossGenerationalPair(idA: string, idB: string): boolean {
    if (idA === idB) return false;
    const stemA = extractSemanticStem(idA);
    const stemB = extractSemanticStem(idB);

    if (stemA === stemB) return true;
    if (stemA.includes(stemB) || stemB.includes(stemA)) return true;
    return false;
}

/**
 * Extracts identifier names from a sequence of chained fallback operands.
 *
 * @param operands - List of expression operands.
 * @param count - Upper limit count of operands to inspect.
 * @returns Array of symbol name strings.
 */
function extractOperandNames(operands: readonly ts.Expression[], count: number): string[] {
    const names: string[] = [];
    for (let i = 0; i < count; i++) {
        const op = operands[i];
        if (ts.isIdentifier(op)) {
            names.push(op.text);
        } else if (ts.isPropertyAccessExpression(op)) {
            names.push(op.name.text);
        }
    }
    return names;
}

/**
 * Checks whether any pair of names exhibits cross-generational co-root relationship.
 *
 * @param names - Array of symbol names.
 * @returns True if co-root pair detected.
 */
function hasGenerationalCoRoot(names: readonly string[]): boolean {
    for (let i = 0; i < names.length - 1; i++) {
        for (let j = i + 1; j < names.length; j++) {
            if (isCrossGenerationalPair(names[i], names[j])) {
                return true;
            }
        }
    }
    return false;
}

/**
 * Inspects a root binary expression for cross-generational fallback chains.
 *
 * @param rootNode - Root binary expression AST node.
 * @param sourceFile - Owning SourceFile AST container.
 * @param filePath - Target file path.
 * @returns Emitted issue finding or null.
 */
function inspectBinaryFallbackChain(
    rootNode: ts.BinaryExpression,
    sourceFile: ts.SourceFile,
    filePath: string,
): Issue | null {
    const opKind = rootNode.operatorToken.kind;
    if (
        opKind !== ts.SyntaxKind.QuestionQuestionToken &&
        opKind !== ts.SyntaxKind.BarBarToken
    ) {
        return null;
    }

    const operands: ts.Expression[] = [];
    collectChainedOperands(rootNode, opKind, operands);

    // Must be at least 2 layers of cascading fallback (>= 3 operands)
    if (operands.length < 3) return null;

    // Filter out trailing constant default (e.g. ?? 3000, ?? 'default')
    let nonConstantCount = operands.length;
    if (isConstantLiteral(operands[operands.length - 1])) {
        nonConstantCount--;
    }
    if (nonConstantCount < 2) return null;

    const names = extractOperandNames(operands, nonConstantCount);
    if (names.length < 2 || !hasGenerationalCoRoot(names)) return null;

    const opSymbol = opKind === ts.SyntaxKind.QuestionQuestionToken ? '??' : '||';
    const line = sourceFile.getLineAndCharacterOfPosition(rootNode.getStart(sourceFile)).line + 1;

    return {
        id: `${ANALYZER_GOVERNANCE}:${MOD_FLB_RULE_ID}:${filePath}:${line}`,
        analyzer: ANALYZER_GOVERNANCE,
        rule: MOD_FLB_RULE_ID,
        severity: SEVERITY_WARNING,
        message: `Transitional fallback chain across generational identifiers \`${names.join(` ${opSymbol} `)}\` detected in non-perimeter domain code.`,
        location: loc(sourceFile, rootNode),
        detail: {
            operands: names,
            operator: opSymbol,
            chainDepth: operands.length - 1,
        },
        suggestion: `Unify on the canonical modern identifier and eliminate transitional multi-tier fallback chains in domain core.`,
    };
}

/**
 * Audits a source file for transitional multi-layer fallback chains.
 *
 * @param sourceFile - Source file AST container.
 * @param filePath - Repository relative file path.
 * @returns Array of emitted MOD-FLB-001 issues.
 */
export function auditFallbackChains(
    sourceFile: ts.SourceFile,
    filePath: string,
): Issue[] {
    // Non-perimeter invariant: perimeter files are exempted
    if (isPerimeterPath(filePath)) {
        return [];
    }

    const issues: Issue[] = [];

    const visit = (node: ts.Node, parent?: ts.Node): void => {
        if (ts.isBinaryExpression(node)) {
            // Prevent sub-tree double counting: only evaluate top-level binary roots
            const isSubExpression =
                parent &&
                ts.isBinaryExpression(parent) &&
                parent.operatorToken.kind === node.operatorToken.kind;

            if (!isSubExpression) {
                const issue = inspectBinaryFallbackChain(node, sourceFile, filePath);
                if (issue) issues.push(issue);
            }
        }
        ts.forEachChild(node, (child) => visit(child, node));
    };

    visit(sourceFile);
    return issues;
}
