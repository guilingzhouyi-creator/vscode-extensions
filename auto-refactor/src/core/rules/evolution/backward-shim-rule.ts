/**
 * Module: Core Rules — Backward Compatibility Shim Rule
 * File Path: src/core/rules/evolution/backward-shim-rule.ts
 * Architecture Role: Detects redundant backward compatibility shim functions and methods,
 *   auditing short forwarding bodies or explicit deprecation/shim tags and scoring them
 *   against the 4D Elastic Compatibility Arbiter to emit MOD-BWD-001 issues.
 * Dependencies & Triggers: Consumes typescript AST (ts.SourceFile) and elastic-compatibility-arbiter;
 *   invoked by scan pipeline and rule generalization orchestrators.
 * Responsibilities:
 *   1. Traverse ts.SourceFile AST for function declarations, method declarations, and arrow bindings;
 *   2. Detect short bodies (<= 4 lines / statements) performing transparent parameter forwarding;
 *   3. Parse JSDoc and comments for @deprecated, shim, or backward compat markers;
 *   4. Query ElasticCompatibilityArbiter with fanIn, isPerimeter, isHotPath, and sunset versions;
 *   5. Emit canonical MOD-BWD-001 issues with structured detail and actionable suggestions.
 * Exit Semantics & Design Rationale: Pure, deterministic function; returns Issue[] array with zero side effects.
 */

import * as ts from 'typescript';
import type { Issue } from '../../types';
import { loc } from '../../../utils/ast';
import { evaluateElasticEnvelope } from '../../scoring/elastic-compatibility-arbiter';
import { ANALYZER_GOVERNANCE } from '../../scoring/dimensionLiterals';
import { resolveProjectVersion } from '../../intelligence/dependency-provenance';

/** Canonical rule identifier for backward compatibility shims. */
export const MOD_BWD_RULE_ID = 'MOD-BWD-001';

const MAX_SHIM_BODY_STATEMENTS = 4;
const SHIM_MARKERS_RE = /@deprecated|shim|backward compat|forward compat|legacy wrapper/i;
const SUNSET_VERSION_RE = /sunset:?\s*v?([0-9]+\.[0-9]+(?:\.[0-9]+)?)/i;

/**
 * Discovers project version from nearest package.json manifest via intelligence cache.
 *
 * @param filePath - Repository relative or absolute file path.
 * @returns Discovered semver string or undefined.
 */
function inferProjectVersion(filePath: string): string | undefined {
    return resolveProjectVersion(filePath);
}


/**
 * Options for configuring backward compatibility shim audit.
 */
export interface BackwardShimOptions {
    /** Fan-in caller count map keyed by symbol name */
    fanInMap?: Record<string, number> | Map<string, number>;
    /** Fallback fan-in value when unmapped */
    defaultFanIn?: number;
    /** Whether target file is located at the architectural perimeter */
    isPerimeter?: boolean;
    /** Whether target file is located on a critical hotpath */
    isHotPath?: boolean;
    /** Current version of the system/module */
    currentVersion?: string;
}

/**
 * Extracts the single callee name from a return or expression statement call.
 *
 * @param stmt - Candidate AST statement.
 * @returns Callee text or null if not a simple call.
 */
function extractCallTarget(stmt: ts.Statement): string | null {
    let expr: ts.Expression | null = null;
    if (ts.isReturnStatement(stmt)) {
        expr = stmt.expression || null;
    } else if (ts.isExpressionStatement(stmt)) {
        expr = stmt.expression;
    }
    if (!expr || !ts.isCallExpression(expr)) return null;

    const callee = expr.expression;
    if (ts.isIdentifier(callee)) return callee.text;
    if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
    return null;
}

/**
 * Extracts sunset version string from leading comments or JSDoc of an AST node.
 *
 * @param sourceFile - Source file AST container.
 * @param node - Candidate AST declaration node.
 * @returns Sunset version string or undefined.
 */
function extractSunsetVersion(sourceFile: ts.SourceFile, node: ts.Node): string | undefined {
    const fullText = sourceFile.getFullText();
    const commentRanges = ts.getLeadingCommentRanges(fullText, node.getFullStart());
    if (!commentRanges || commentRanges.length === 0) return undefined;

    for (let i = 0; i < commentRanges.length; i++) {
        const cText = fullText.slice(commentRanges[i].pos, commentRanges[i].end);
        const match = cText.match(SUNSET_VERSION_RE);
        if (match && match[1]) return match[1];
    }
    return undefined;
}

/**
 * Checks whether an AST node has explicit deprecation or shim markers.
 *
 * @param sourceFile - Source file AST container.
 * @param node - Candidate AST declaration node.
 * @returns True if marker present.
 */
function hasShimMarker(sourceFile: ts.SourceFile, node: ts.Node): boolean {
    const fullText = sourceFile.getFullText();
    const commentRanges = ts.getLeadingCommentRanges(fullText, node.getFullStart());
    if (!commentRanges || commentRanges.length === 0) return false;

    for (let i = 0; i < commentRanges.length; i++) {
        const cText = fullText.slice(commentRanges[i].pos, commentRanges[i].end);
        if (SHIM_MARKERS_RE.test(cText)) return true;
    }
    return false;
}

/**
 * Resolves fan-in count for a given symbol from options or declaration modifiers.
 *
 * @param node - Declaration AST node.
 * @param symbolName - Identifier text.
 * @param options - Audit configuration options.
 * @returns Derived or configured fan-in integer.
 */
function resolveFanIn(
    node: ts.Node,
    symbolName: string,
    parent?: ts.Node,
    options?: BackwardShimOptions,
): number {
    if (options?.fanInMap) {
        const mapVal =
            options.fanInMap instanceof Map
                ? options.fanInMap.get(symbolName)
                : options.fanInMap[symbolName];
        if (typeof mapVal === 'number') return mapVal;
    }
    if (typeof options?.defaultFanIn === 'number') {
        return options.defaultFanIn;
    }

    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
    let isExported = modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    const isPrivate =
        modifiers?.some((m) => m.kind === ts.SyntaxKind.PrivateKeyword) ||
        symbolName.startsWith('_') ||
        symbolName.startsWith('#');

    if (isPrivate) return 1;

    // Public method or member inside an exported class/interface represents a public API contract
    if (!isExported && parent && ts.isClassDeclaration(parent)) {
        const parentModifiers = ts.canHaveModifiers(parent) ? ts.getModifiers(parent) : undefined;
        const parentExported = parentModifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
        const isExplicitPublic = modifiers?.some((m) => m.kind === ts.SyntaxKind.PublicKeyword);
        const isExplicitProtected = modifiers?.some((m) => m.kind === ts.SyntaxKind.ProtectedKeyword);
        if (parentExported && (isExplicitPublic || !isExplicitProtected)) {
            isExported = true;
        }
    }

    if (isExported) return 5;
    return 3;
}

/**
 * Inspects a function-like declaration for backward compatibility shim characteristics.
 *
 * @param node - Function, method, or arrow declaration.
 * @param name - Identifier string.
 * @param body - Function body block or expression.
 * @param sourceFile - Owning SourceFile AST.
 * @param filePath - Repository relative file path.
 * @param parent - Optional parent AST container.
 * @param options - Audit configuration options.
 * @returns Issue finding or null.
 */
/**
 * Extracts target call identifier and statement count from a candidate body.
 *
 * @param body - Function body block or expression.
 * @returns Struct with target call name and statement count.
 */
function extractBodyTargetCall(body: ts.Block | ts.Expression): { targetCall: string | null; count: number } {
    if (ts.isBlock(body)) {
        const count = body.statements.length;
        if (count === 0 || count > MAX_SHIM_BODY_STATEMENTS) return { targetCall: null, count };
        return { targetCall: extractCallTarget(body.statements[0]), count };
    }
    let targetCall: string | null = null;
    if (ts.isCallExpression(body)) {
        const callee = body.expression;
        if (ts.isIdentifier(callee)) targetCall = callee.text;
        else if (ts.isPropertyAccessExpression(callee)) targetCall = callee.name.text;
    }
    return { targetCall, count: 1 };
}

/**
 * Resolves candidate name and body from supported declaration forms.
 *
 * @param node - Candidate declaration AST node.
 * @returns Name and body struct or null if unsupported.
 */
function resolveCandidateDeclaration(
    node: ts.Node,
): { name: string; body: ts.Block | ts.Expression | undefined } | null {
    if (ts.isFunctionDeclaration(node) && node.name) {
        return { name: node.name.text, body: node.body };
    }
    if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) {
        return { name: node.name.text, body: node.body };
    }
    if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
        return { name: node.name.text, body: node.initializer.body };
    }
    return null;
}

/**
 * Inspects a function-like declaration for backward compatibility shim characteristics.
 *
 * @param node - Function, method, or arrow declaration.
 * @param name - Identifier string.
 * @param body - Function body block or expression.
 * @param sourceFile - Owning SourceFile AST.
 * @param filePath - Repository relative file path.
 * @param parent - Optional parent AST container.
 * @param options - Audit configuration options.
 * @returns Issue finding or null.
 */
function inspectShimDeclaration(
    node: ts.Node,
    name: string,
    body: ts.Block | ts.Expression | undefined,
    sourceFile: ts.SourceFile,
    filePath: string,
    parent?: ts.Node,
    options?: BackwardShimOptions,
): Issue | null {
    if (!body) return null;

    const { targetCall, count: statementCount } = extractBodyTargetCall(body);
    if (!targetCall || targetCall === name) return null;

    const isMarked = hasShimMarker(sourceFile, node);
    // Must be short passthrough or carry explicit deprecation/shim marker
    if (!isMarked && statementCount > 2) return null;

    const fanIn = resolveFanIn(node, name, parent, options);
    const sunsetVersion = extractSunsetVersion(sourceFile, node);

    const verdict = evaluateElasticEnvelope({
        fanIn,
        isPerimeter: options?.isPerimeter,
        isHotPath: options?.isHotPath,
        currentVersion: options?.currentVersion || inferProjectVersion(filePath),
        sunsetVersion,
        symbolName: name,
        ruleId: MOD_BWD_RULE_ID,
    });

    const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

    return {
        id: `${ANALYZER_GOVERNANCE}:${MOD_BWD_RULE_ID}:${filePath}:${line}`,
        analyzer: ANALYZER_GOVERNANCE,
        rule: MOD_BWD_RULE_ID,
        severity: verdict.severity,
        message: `Backward compatibility shim \`${name}\` forwards directly to \`${targetCall}\` [${verdict.envelope}: ${verdict.rationale}].`,
        location: loc(sourceFile, node),
        detail: {
            symbol: name,
            targetCall,
            envelope: verdict.envelope,
            penaltyMultiplier: verdict.penaltyMultiplier,
            fanIn,
            sunsetVersion: sunsetVersion || null,
            versionsUntilSunset: verdict.versionsUntilSunset,
        },
        suggestion: `Directly migrate callers to \`${targetCall}\` and sunset this compatibility forwarding shim.`,
    };
}

/**
 * Audits a TypeScript source file for redundant backward compatibility shims.
 *
 * @param sourceFile - Target source file AST.
 * @param filePath - Repository relative POSIX path.
 * @param options - Audit configuration options.
 * @returns Array of emitted MOD-BWD-001 issues.
 */
export function auditBackwardCompatibilityShims(
    sourceFile: ts.SourceFile,
    filePath: string,
    options?: BackwardShimOptions,
): Issue[] {
    const issues: Issue[] = [];

    const visit = (node: ts.Node, parent?: ts.Node): void => {
        const candidate = resolveCandidateDeclaration(node);
        if (candidate) {
            const issue = inspectShimDeclaration(
                node,
                candidate.name,
                candidate.body,
                sourceFile,
                filePath,
                parent,
                options,
            );
            if (issue) issues.push(issue);
        }

        ts.forEachChild(node, (child) => visit(child, node));
    };

    visit(sourceFile);
    return issues;
}
