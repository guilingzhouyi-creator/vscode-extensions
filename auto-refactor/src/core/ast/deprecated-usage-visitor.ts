/**
 * Module: Core AST — Deprecated Usage Visitor
 * File Path: src/core/ast/deprecated-usage-visitor.ts
 * Architecture Role: Detects invocations or property accesses of deprecated symbols in internal
 *   production source code (excluding test files), emitting canonical MOD-DEP-001 issues.
 * Dependencies & Triggers: Consumes typescript AST (ts.SourceFile) and optional TypeChecker;
 *   invoked by scanning pipeline and modernity analyzers.
 * Responsibilities:
 *   1. Verify file is internal production source (filter out test files and spec directories);
 *   2. Traverse AST for CallExpression, PropertyAccessExpression, and Identifier usages;
 *   3. Detect references to symbols marked with @deprecated in JSDoc or type definition;
 *   4. Support both AST-local JSDoc deprecation tracking and ts.TypeChecker symbol inspection;
 *   5. Emit canonical MOD-DEP-001 issues with migration guidance.
 * Exit Semantics & Design Rationale: Pure, low-overhead AST traversal; skips test files early
 *   and operates gracefully without TypeChecker (using local symbol table and JSDoc index).
 */

import * as ts from 'typescript';
import type { Issue } from '../types';
import { SEVERITY_WARNING } from '../types';
import { loc } from '../../utils/ast';
import { ANALYZER_GOVERNANCE } from '../scoring/dimensionLiterals';

/** Canonical rule identifier for deprecated usage in production code. */
export const MOD_DEP_RULE_ID = 'MOD-DEP-001';

/**
 * Checks whether a file path represents unit, integration, or spec test code.
 *
 * @param filePath - Repository relative POSIX file path.
 * @returns True if path matches test conventions.
 */
export function isTestFile(filePath: string): boolean {
    const normalized = filePath.replace(/\\/g, '/').toLowerCase();
    return (
        normalized.includes('/tests/') ||
        normalized.includes('/test/') ||
        normalized.includes('/__tests__/') ||
        normalized.endsWith('.test.ts') ||
        normalized.endsWith('.spec.ts') ||
        normalized.endsWith('.test.js') ||
        normalized.endsWith('.spec.js')
    );
}

/**
 * Inspects leading comments and JSDoc of an AST node for @deprecated tags.
 *
 * @param sourceFile - Owning SourceFile AST container.
 * @param node - Candidate declaration AST node.
 * @returns Deprecation rationale text or null if not deprecated.
 */
function extractDeprecationMessage(sourceFile: ts.SourceFile, node: ts.Node): string | null {
    const fullText = sourceFile.getFullText();
    const commentRanges = ts.getLeadingCommentRanges(fullText, node.getFullStart());
    if (!commentRanges || commentRanges.length === 0) return null;

    for (let i = 0; i < commentRanges.length; i++) {
        const cText = fullText.slice(commentRanges[i].pos, commentRanges[i].end);
        if (/@deprecated/i.test(cText)) {
            const match = cText.match(/@deprecated\s+([^*\r\n]+)/i);
            return match && match[1] ? match[1].trim() : 'Marked as deprecated';
        }
    }
    return null;
}

/**
 * Collects locally declared deprecated symbols within a SourceFile.
 *
 * @param sourceFile - SourceFile AST container.
 * @returns Map from identifier name to deprecation reason.
 */
/**
 * Extracts declared symbol name from a declaration AST node.
 *
 * @param node - Candidate declaration AST node.
 * @returns Symbol identifier text or null.
 */
function extractDeclarationName(node: ts.Node): string | null {
    if (
        (ts.isFunctionDeclaration(node) ||
            ts.isClassDeclaration(node) ||
            ts.isInterfaceDeclaration(node) ||
            ts.isTypeAliasDeclaration(node)) &&
        node.name
    ) {
        return node.name.text;
    }
    if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) {
        return node.name.text;
    }
    if (ts.isVariableStatement(node)) {
        const decl = node.declarationList.declarations[0];
        if (decl && ts.isIdentifier(decl.name)) {
            return decl.name.text;
        }
    }
    return null;
}

/**
 * Collects locally declared deprecated symbols within a SourceFile.
 *
 * @param sourceFile - SourceFile AST container.
 * @returns Map from identifier name to deprecation reason.
 */
function collectLocalDeprecatedSymbols(sourceFile: ts.SourceFile): Map<string, string> {
    const deprecatedMap = new Map<string, string>();

    const indexVisit = (node: ts.Node): void => {
        const symName = extractDeclarationName(node);
        if (symName) {
            const reason = extractDeprecationMessage(sourceFile, node);
            if (reason) {
                deprecatedMap.set(symName, reason);
            }
        }
        ts.forEachChild(node, indexVisit);
    };

    indexVisit(sourceFile);
    return deprecatedMap;
}

/**
 * Resolves target identifier being called or accessed as a property.
 *
 * @param node - AST candidate node.
 * @param parent - Optional parent node.
 * @returns Target identifier or null.
 */
function resolveTargetIdentifier(node: ts.Node, parent?: ts.Node): ts.Identifier | null {
    if (ts.isCallExpression(node)) {
        if (ts.isIdentifier(node.expression)) {
            return node.expression;
        }
        if (ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.name)) {
            return node.expression.name;
        }
        return null;
    }
    if (ts.isPropertyAccessExpression(node) && (!parent || !ts.isCallExpression(parent))) {
        return ts.isIdentifier(node.name) ? node.name : null;
    }
    return null;
}

/**
 * Checks whether an identifier is located directly at its own declaration site.
 *
 * @param parent - AST parent node.
 * @param identifier - Target identifier.
 * @returns True if parent node declares this identifier.
 */
function isDeclarationSite(parent: ts.Node | undefined, identifier: ts.Identifier): boolean {
    if (!parent) return false;
    if (ts.isFunctionDeclaration(parent) || ts.isMethodDeclaration(parent) || ts.isVariableDeclaration(parent)) {
        return parent.name === identifier;
    }
    return false;
}

/**
 * Queries TypeChecker for JSDoc @deprecated tags on target symbol.
 *
 * @param checker - Optional TypeChecker.
 * @param identifier - Target identifier.
 * @returns Deprecation reason or null.
 */
function resolveCheckerDeprecation(
    checker: ts.TypeChecker | undefined,
    identifier: ts.Identifier,
): string | null {
    if (!checker) return null;
    try {
        const symbol = checker.getSymbolAtLocation(identifier);
        if (!symbol) return null;
        const tags = symbol.getJsDocTags();
        const depTag = tags.find((t) => t.name === 'deprecated');
        if (!depTag) return null;
        return depTag.text && depTag.text.length > 0
            ? depTag.text.map((t) => t.text).join('')
            : 'Deprecated symbol';
    } catch (err) {
        // Defensive: fall back to local AST index when TypeChecker boundaries fail
        void err;
        return null;
    }
}

/**
 * Builds canonical MOD-DEP-001 issue object.
 *
 * @param sourceFile - Owning SourceFile AST.
 * @param identifier - Target identifier.
 * @param filePath - Posix file path.
 * @param reason - Deprecation reason.
 * @returns Structured Issue object.
 */
function buildDeprecatedIssue(
    sourceFile: ts.SourceFile,
    identifier: ts.Identifier,
    filePath: string,
    reason: string,
): Issue {
    const name = identifier.text;
    const line = sourceFile.getLineAndCharacterOfPosition(identifier.getStart(sourceFile)).line + 1;
    return {
        id: `${ANALYZER_GOVERNANCE}:${MOD_DEP_RULE_ID}:${filePath}:${line}`,
        analyzer: ANALYZER_GOVERNANCE,
        rule: MOD_DEP_RULE_ID,
        severity: SEVERITY_WARNING,
        message: `Direct invocation or access of deprecated symbol \`${name}\` in production code: ${reason}.`,
        location: loc(sourceFile, identifier),
        detail: {
            symbol: name,
            deprecationReason: reason,
        },
        suggestion: `Migrate to the active replacement API and decommission references to deprecated \`${name}\`.`,
    };
}

/**
 * Audits production source code for direct usages of deprecated symbols.
 *
 * @param sourceFile - Source file AST container.
 * @param filePath - Repository relative POSIX file path.
 * @param checker - Optional TypeScript compiler TypeChecker.
 * @returns Array of emitted MOD-DEP-001 issues.
 */
export function auditDeprecatedUsages(
    sourceFile: ts.SourceFile,
    filePath: string,
    checker?: ts.TypeChecker,
): Issue[] {
    // Exclusion: tests are legitimate consumers of deprecated APIs for backward-compatibility verification
    if (isTestFile(filePath)) {
        return [];
    }

    const issues: Issue[] = [];
    const localDeprecated = collectLocalDeprecatedSymbols(sourceFile);

    const visit = (node: ts.Node, parent?: ts.Node): void => {
        const targetIdentifier = resolveTargetIdentifier(node, parent);
        if (targetIdentifier && !isDeclarationSite(parent, targetIdentifier)) {
            const reason =
                resolveCheckerDeprecation(checker, targetIdentifier) ||
                localDeprecated.get(targetIdentifier.text) ||
                null;
            if (reason) {
                issues.push(buildDeprecatedIssue(sourceFile, targetIdentifier, filePath, reason));
            }
        }
        ts.forEachChild(node, (child) => visit(child, node));
    };

    visit(sourceFile);
    return issues;
}
