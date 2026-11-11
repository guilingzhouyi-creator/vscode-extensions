/**
 * Module: Static Analysis Engine — Orphan Micro-Function Inlining Auditor
 * File Path: src/analyzers/simplify-inlining.ts
 * Architecture Role: Detects private, single-use micro-functions that have high semantic
 *   vector similarity with their sole caller and yield positive inlining utility (SIM-INL-001).
 * Dependencies & Triggers: Consumes TypeScript AST, token-entropy, and semantic-vector operators;
 *   invoked by SimplifyAnalyzer during TypeScript function structure audits.
 * Responsibilities: Identify non-exported micro-functions (ELOC <= 6, span <= 8), count file-local
 *   fan-in, extract caller-callee 3-gram feature vectors, evaluate algebraic inlining utility,
 *   and emit actionable SIM-INL-001 issues.
 * Exit Semantics & Design Rationale: Deterministic and non-throwing; preserves performance
 *   by early-filtering on function size and fan-in before computing vector distances.
 */

import * as ts from 'typescript';
import type { AnalyzerContext, Issue } from '../core/types';
import { SEVERITY_INFO } from '../core/types';
import { createLineIssue } from '../core/rules/diagnostic-catalog';
import { tokenizeCode } from '../core/intelligence/token-entropy';
import {
    extractTokenTrigrams,
    calculateTrigramCosineSimilarity,
    calculateInliningUtility,
} from '../core/intelligence/semantic-vector';
import type { SimplifyOptions } from './simplify';
import { isTestFilePath, isFixtureOrMockPath } from '../core/path';

const RULE_SIM_INL_001 = 'SIM-INL-001';
const CODE_AR_SIM_007 = 'AR:SIM:007';
const ACTION_COLLOCATE: import('../core/types').AgentActionType = 'replace_token';

const EXEMPT_NAMES = new Set<string>([
    'constructor',
    '_ready',
    '_process',
    '_physics_process',
    '_input',
    'activate',
    'deactivate',
    'dispose',
    'render',
    'visit',
    'leave',
    'finalize',
    'analyze',
    'toString',
    'toJSON',
    'valueOf',
]);

const MAX_ORPHAN_ELOC = 6;
const MAX_ORPHAN_LINE_SPAN = 8;
const MIN_INLINING_UTILITY = 0.7;
const MIN_COS_SIMILARITY = 0.25;

interface MicroCandidate {
    node: ts.FunctionDeclaration | ts.MethodDeclaration;
    name: string;
    startLine: number;
    endLine: number;
    childEloc: number;
    calleeText: string;
}

function isExportedNode(node: ts.Node): boolean {
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
    if (!modifiers) return false;
    return modifiers.some(
        (modifier: ts.ModifierLike) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    );
}

function findEnclosingFunction(node: ts.Node): ts.Node | null {
    let curr: ts.Node | undefined = node.parent;
    while (curr) {
        if (
            ts.isFunctionDeclaration(curr) ||
            ts.isMethodDeclaration(curr) ||
            ts.isArrowFunction(curr) ||
            ts.isFunctionExpression(curr) ||
            ts.isConstructorDeclaration(curr)
        ) {
            return curr;
        }
        curr = curr.parent;
    }
    return null;
}

function countEffectiveLines(text: string): number {
    let count = 0;
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (trimmed.length === 0 || trimmed.startsWith('//') || trimmed.startsWith('/*')) {
            continue;
        }
        count++;
    }
    return count;
}

function countSharedIdentifiers(
    calleeTokens: readonly string[],
    callerTokens: readonly string[],
    candName: string,
): number {
    const calleeIdentSet = new Set<string>();
    for (let i = 0; i < calleeTokens.length; i++) {
        const token = calleeTokens[i];
        if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(token) && token !== candName) {
            calleeIdentSet.add(token);
        }
    }
    let shared = 0;
    for (let i = 0; i < callerTokens.length; i++) {
        if (calleeIdentSet.has(callerTokens[i])) {
            shared++;
        }
    }
    return Math.min(shared, 10);
}

function isEligibleTargetNode(
    node: ts.Node,
): (ts.FunctionDeclaration | ts.MethodDeclaration) | null {
    if (!ts.isFunctionDeclaration(node) && !ts.isMethodDeclaration(node)) {
        return null;
    }
    const name = node.name && ts.isIdentifier(node.name) ? node.name.text : null;
    if (!name || EXEMPT_NAMES.has(name) || isExportedNode(node)) {
        return null;
    }
    return node;
}

function isEligibleOrphanSpan(
    sourceFile: ts.SourceFile,
    node: ts.Node,
): { start: number; end: number; childEloc: number; calleeText: string } | null {
    const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
    const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
    const span = end - start + 1;
    if (span > MAX_ORPHAN_LINE_SPAN || span < 2) {
        return null;
    }
    const calleeText = node.getText(sourceFile);
    const childEloc = countEffectiveLines(calleeText);
    if (childEloc > MAX_ORPHAN_ELOC || childEloc < 1) {
        return null;
    }
    return { start, end, childEloc, calleeText };
}

function tryExtractMicroCandidate(node: ts.Node, sourceFile: ts.SourceFile): MicroCandidate | null {
    const fnNode = isEligibleTargetNode(node);
    if (!fnNode || !fnNode.name || !ts.isIdentifier(fnNode.name)) {
        return null;
    }
    const spanInfo = isEligibleOrphanSpan(sourceFile, fnNode);
    if (!spanInfo) {
        return null;
    }
    return {
        node: fnNode,
        name: fnNode.name.text,
        startLine: spanInfo.start,
        endLine: spanInfo.end,
        childEloc: spanInfo.childEloc,
        calleeText: spanInfo.calleeText,
    };
}

function collectMicroCandidates(sourceFile: ts.SourceFile): MicroCandidate[] {
    const candidates: MicroCandidate[] = [];
    const walk = (node: ts.Node): void => {
        const candidate = tryExtractMicroCandidate(node, sourceFile);
        if (candidate) {
            candidates.push(candidate);
        }
        ts.forEachChild(node, walk);
    };
    walk(sourceFile);
    return candidates;
}

function matchPropAccessCall(parentNode: ts.Node): ts.Node | null {
    if (!ts.isPropertyAccessExpression(parentNode)) return null;
    const grandParent = parentNode.parent;
    return grandParent && ts.isCallExpression(grandParent) && grandParent.expression === parentNode
        ? grandParent
        : null;
}

function matchCallSite(node: ts.Node, targetName: string, targetNode: ts.Node): ts.Node | null {
    if (!ts.isIdentifier(node)) return null;
    if (node.text !== targetName || node === targetNode) return null;
    const parentNode = node.parent;
    if (!parentNode) return null;
    if (ts.isCallExpression(parentNode) && parentNode.expression === node) return parentNode;
    return matchPropAccessCall(parentNode);
}

function findSingleCallSite(
    sourceFile: ts.SourceFile,
    targetName: string,
    targetNode: ts.Node,
): ts.Node | null {
    const callSites: ts.Node[] = [];
    const findCalls = (node: ts.Node): void => {
        const site = matchCallSite(node, targetName, targetNode);
        if (site) {
            callSites.push(site);
        }
        ts.forEachChild(node, findCalls);
    };
    findCalls(sourceFile);
    return callSites.length === 1 ? callSites[0] : null;
}

function isTestOrFixturePath(filePath: string): boolean {
    return isTestFilePath(filePath) || isFixtureOrMockPath(filePath) || filePath.endsWith('.d.ts');
}

function evaluateCandidateInlining(
    cand: MicroCandidate,
    sourceFile: ts.SourceFile,
    filePath: string,
): Issue | null {
    const callSite = findSingleCallSite(sourceFile, cand.name, cand.node.name ?? cand.node);
    if (!callSite) return null;

    const callerNode = findEnclosingFunction(callSite);
    if (!callerNode || callerNode === cand.node) return null;

    const callerText = callerNode.getText(sourceFile);
    const callerTokens = tokenizeCode(callerText).rawTokens;
    const calleeTokens = tokenizeCode(cand.calleeText).rawTokens;

    if (callerTokens.length < 5 || calleeTokens.length < 3) return null;

    const vecA = extractTokenTrigrams(callerTokens);
    const vecB = extractTokenTrigrams(calleeTokens);
    const cosSim = calculateTrigramCosineSimilarity(vecA, vecB);
    if (cosSim < MIN_COS_SIMILARITY) return null;

    const sharedVars = countSharedIdentifiers(calleeTokens, callerTokens, cand.name);
    const inliningUtility = calculateInliningUtility({
        cosSim,
        childEloc: cand.childEloc,
        sharedScopeVarsCount: sharedVars,
        childParamCount: cand.node.parameters ? cand.node.parameters.length : 0,
    });

    if (inliningUtility < MIN_INLINING_UTILITY) return null;

    const issue = createLineIssue('simplify', filePath, {
        lineIdx: Math.max(0, cand.startLine - 1),
        rule: RULE_SIM_INL_001,
        severity: SEVERITY_INFO,
        message: `Single-use orphan function "${cand.name}" has high vector similarity (${cosSim.toFixed(2)}) with caller; inlining utility (${inliningUtility.toFixed(2)}) exceeds threshold (${MIN_INLINING_UTILITY.toFixed(2)}).`,
        detail: {
            function: cand.name,
            fanIn: 1,
            childEloc: cand.childEloc,
            cosSim,
            inliningUtility,
        },
        suggestion:
            'Collocate or inline single-use micro-fragments into caller to improve spatial locality.',
    });
    issue.location = {
        file: filePath,
        start: { line: cand.startLine, column: 1 },
        end: { line: cand.endLine, column: 1 },
    };
    issue.actionable = {
        action: ACTION_COLLOCATE,
        code: CODE_AR_SIM_007,
        safeToAutomate: false,
        targetSymbol: cand.name,
        templateSnippet:
            '// Inline micro-fragment directly into caller to preserve spatial locality',
    };
    return issue;
}

/**
 * Audits a TypeScript source file for single-use orphan micro-functions (SIM-INL-001).
 *
 * @param sourceFile - Materialized TypeScript SourceFile.
 * @param ctx - Active analyzer context.
 * @param _opts - Simplify analyzer options.
 * @param issues - Output issues collection.
 */
export function auditOrphanInlining(
    sourceFile: ts.SourceFile,
    ctx: AnalyzerContext,
    _opts: SimplifyOptions,
    issues: Issue[],
): void {
    const filePath = ctx.filePath.replace(/\\/g, '/');
    if (isTestOrFixturePath(filePath)) {
        return;
    }

    const candidates = collectMicroCandidates(sourceFile);
    if (candidates.length === 0) return;

    for (let cIdx = 0; cIdx < candidates.length; cIdx++) {
        const issue = evaluateCandidateInlining(candidates[cIdx], sourceFile, filePath);
        if (issue) {
            issues.push(issue);
        }
    }
}
