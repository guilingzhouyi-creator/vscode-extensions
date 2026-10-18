/**
 * Module: Core Engine — Declarative Structural Pattern Rewrite Engine
 * File Path: src/core/pattern/structural-pattern-engine.ts
 * Architecture Role: High-cohesion engine executing declarative structural pattern matching
 *   and template-based rewriting inspired by GritQL and ast-grep principles.
 * Dependencies & Triggers: TypeScript compiler API (ts) for AST traversal; pure functions.
 * Responsibilities:
 *   1. Parse pattern specifications and target source code into unified AST structures;
 *   2. Execute recursive structural matching with metavariable binding and constraints;
 *   3. Synthesize template replacements and compute unified diffs and actionable patches.
 * Exit Semantics & Design Rationale: Completely pure functions with no side effects;
 *   flat guard clauses (CC <= 15, Depth <= 4) and zero-allocation hot paths.
 */

import * as ts from 'typescript';
import type {
    ActionablePatch,
    MatchAndRewriteOptions,
    MetavariableBinding,
    MetavariableConstraint,
    PatchEdit,
    PatternKind,
    PatternSpec,
    RewriteResult,
    SourceRange,
    StructuralMatch,
} from './types';

/**
 * Compiled representation of a pattern rule containing parsed AST root.
 */
export interface CompiledPatternRule {
    /** Originating declarative pattern specification. */
    readonly spec: PatternSpec;
    /** Parsed root pattern node used for structural comparisons. */
    readonly patternNode: ts.Node;
    /** Source file container housing the pattern AST. */
    readonly patternSf: ts.SourceFile;
}

/**
 * Checks whether an identifier represents an AST metavariable ($VAR, $COND, $_, etc.).
 *
 * @param text - Candidate identifier text.
 * @returns True if text adheres to metavariable naming syntax.
 */
export function isMetavariableName(text: string): boolean {
    if (text.length < 2 || text.charCodeAt(0) !== 36) {
        return false;
    }
    for (let i = 1; i < text.length; i++) {
        const code = text.charCodeAt(i);
        const isUpper = code >= 65 && code <= 90;
        const isLower = code >= 97 && code <= 122;
        const isDigit = code >= 48 && code <= 57;
        const isUnderscore = code === 95;
        if (!isUpper && !isLower && !isDigit && !isUnderscore) {
            return false;
        }
    }
    return true;
}

/**
 * Normalizes code text by collapsing whitespace sequences for equivalence comparison.
 *
 * @param text - Raw source text.
 * @returns Whitespace-collapsed normalized string.
 */
export function normalizeCode(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
}

/**
 * Computes exact 1-indexed source coordinates for an AST node.
 *
 * @param node - Target AST node.
 * @param sourceFile - Containing source file.
 * @returns Coordinate range with offsets and line/column numbers.
 */
export function computeRange(node: ts.Node, sourceFile: ts.SourceFile): SourceRange {
    const start = node.getStart(sourceFile);
    const end = node.getEnd();
    const startPos = sourceFile.getLineAndCharacterOfPosition(start);
    const endPos = sourceFile.getLineAndCharacterOfPosition(end);
    return {
        start,
        end,
        startLine: startPos.line + 1,
        startCol: startPos.character + 1,
        endLine: endPos.line + 1,
        endCol: endPos.character + 1,
    };
}

/**
 * Strips outer grouping parentheses from an expression node.
 *
 * @param node - Candidate AST node.
 * @returns Unwrapped innermost expression node.
 */
export function unwrapParentheses(node: ts.Node): ts.Node {
    let current = node;
    while (ts.isParenthesizedExpression(current)) {
        current = current.expression;
    }
    return current;
}

/**
 * Parses pattern source code into a compiled pattern rule object.
 *
 * @param spec - Declarative pattern specification.
 * @returns Compiled pattern structure with root AST node.
 */
export function compilePattern(spec: PatternSpec): CompiledPatternRule {
    const patternSf = ts.createSourceFile(
        '__pattern__.tsx',
        spec.pattern,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
    );
    if (patternSf.statements.length === 0) {
        throw new Error(`Pattern yielded no valid AST nodes: "${spec.pattern}"`);
    }

    const firstStmt = patternSf.statements[0];
    let rootNode: ts.Node = firstStmt;
    const kind: PatternKind = spec.kind ?? 'auto';

    if (kind === 'expression' && ts.isExpressionStatement(firstStmt)) {
        rootNode = firstStmt.expression;
    } else if (
        kind === 'auto' &&
        patternSf.statements.length === 1 &&
        ts.isExpressionStatement(firstStmt)
    ) {
        rootNode = firstStmt.expression;
    }

    return { spec, patternNode: rootNode, patternSf };
}

/**
 * Matches metavariable identifier against candidate target AST node.
 */
function matchMetavariable(
    pNode: ts.Identifier,
    targetNode: ts.Node,
    targetSf: ts.SourceFile,
    bindings: Map<string, MetavariableBinding>,
): boolean {
    const name = pNode.text;
    if (name === '$_') {
        return true;
    }

    const targetText = targetNode.getText(targetSf).trim();
    const existing = bindings.get(name);
    if (existing !== undefined) {
        return normalizeCode(existing.value) === normalizeCode(targetText);
    }

    bindings.set(name, {
        name,
        value: targetText,
        nodeKind: ts.SyntaxKind[targetNode.kind],
        range: computeRange(targetNode, targetSf),
    });
    return true;
}

/**
 * Matches literal expressions and keywords for textual equivalence.
 */
function matchLiteralsAndIdentifiers(
    pNode: ts.Node,
    tNode: ts.Node,
    patternSf: ts.SourceFile,
    targetSf: ts.SourceFile,
): boolean {
    if (ts.isIdentifier(pNode)) {
        return ts.isIdentifier(tNode) && pNode.text === tNode.text;
    }

    if (ts.isStringLiteral(pNode) || ts.isNumericLiteral(pNode)) {
        return (
            tNode.kind === pNode.kind &&
            (tNode as ts.LiteralExpression).text === (pNode as ts.LiteralExpression).text
        );
    }

    return pNode.getText(patternSf).trim() === tNode.getText(targetSf).trim();
}

/**
 * Matches binary expressions comparing operator kind and sub-expressions.
 */
function matchBinaryExpression(
    pNode: ts.BinaryExpression,
    tNode: ts.Node,
    patternSf: ts.SourceFile,
    targetSf: ts.SourceFile,
    bindings: Map<string, MetavariableBinding>,
): boolean {
    if (!ts.isBinaryExpression(tNode)) {
        return false;
    }
    if (pNode.operatorToken.kind !== tNode.operatorToken.kind) {
        return false;
    }
    if (!matchNode(pNode.left, tNode.left, patternSf, targetSf, bindings)) {
        return false;
    }
    return matchNode(pNode.right, tNode.right, patternSf, targetSf, bindings);
}

/**
 * Matches conditional expressions (ternary operators).
 */
function matchConditionalExpression(
    pNode: ts.ConditionalExpression,
    tNode: ts.Node,
    patternSf: ts.SourceFile,
    targetSf: ts.SourceFile,
    bindings: Map<string, MetavariableBinding>,
): boolean {
    if (!ts.isConditionalExpression(tNode)) {
        return false;
    }
    if (!matchNode(pNode.condition, tNode.condition, patternSf, targetSf, bindings)) {
        return false;
    }
    if (!matchNode(pNode.whenTrue, tNode.whenTrue, patternSf, targetSf, bindings)) {
        return false;
    }
    return matchNode(pNode.whenFalse, tNode.whenFalse, patternSf, targetSf, bindings);
}

/**
 * Matches prefix unary expressions (such as negation `!`).
 */
function matchPrefixUnaryExpression(
    pNode: ts.PrefixUnaryExpression,
    tNode: ts.Node,
    patternSf: ts.SourceFile,
    targetSf: ts.SourceFile,
    bindings: Map<string, MetavariableBinding>,
): boolean {
    if (!ts.isPrefixUnaryExpression(tNode)) {
        return false;
    }
    if (pNode.operator !== tNode.operator) {
        return false;
    }
    return matchNode(pNode.operand, tNode.operand, patternSf, targetSf, bindings);
}

/**
 * Fallback matcher recursively traversing child AST nodes in deterministic order.
 */
function matchGeneralChildren(
    pNode: ts.Node,
    tNode: ts.Node,
    patternSf: ts.SourceFile,
    targetSf: ts.SourceFile,
    bindings: Map<string, MetavariableBinding>,
): boolean {
    const pChildren: ts.Node[] = [];
    ts.forEachChild(pNode, (child) => {
        pChildren.push(child);
    });

    const tChildren: ts.Node[] = [];
    ts.forEachChild(tNode, (child) => {
        tChildren.push(child);
    });

    if (pChildren.length === 0 && tChildren.length === 0) {
        return matchLiteralsAndIdentifiers(pNode, tNode, patternSf, targetSf);
    }
    if (pChildren.length !== tChildren.length) {
        return false;
    }

    for (let i = 0; i < pChildren.length; i++) {
        if (!matchNode(pChildren[i], tChildren[i], patternSf, targetSf, bindings)) {
            return false;
        }
    }
    return true;
}

/**
 * Core recursive structural pattern matcher comparing pattern AST against candidate target AST.
 *
 * @param patternNode - Pattern AST node.
 * @param targetNode - Candidate target AST node.
 * @param patternSf - Pattern source file context.
 * @param targetSf - Target document source file context.
 * @param bindings - Mutable binding accumulator map.
 * @returns True if candidate structurally matches pattern.
 */
function tryMatchSingleStatementBlock(
    pNode: ts.Node,
    tNode: ts.Node,
    patternSf: ts.SourceFile,
    targetSf: ts.SourceFile,
    bindings: Map<string, MetavariableBinding>,
): boolean | undefined {
    if (ts.isBlock(pNode) && pNode.statements.length === 1 && !ts.isBlock(tNode)) {
        return matchNode(pNode.statements[0], tNode, patternSf, targetSf, bindings);
    }
    if (!ts.isBlock(pNode) && ts.isBlock(tNode) && tNode.statements.length === 1) {
        return matchNode(pNode, tNode.statements[0], patternSf, targetSf, bindings);
    }
    return undefined;
}

function matchSpecializedExpression(
    pNode: ts.Node,
    tNode: ts.Node,
    patternSf: ts.SourceFile,
    targetSf: ts.SourceFile,
    bindings: Map<string, MetavariableBinding>,
): boolean | undefined {
    if (ts.isBinaryExpression(pNode)) {
        return matchBinaryExpression(pNode, tNode, patternSf, targetSf, bindings);
    }
    if (ts.isConditionalExpression(pNode)) {
        return matchConditionalExpression(pNode, tNode, patternSf, targetSf, bindings);
    }
    if (ts.isPrefixUnaryExpression(pNode)) {
        return matchPrefixUnaryExpression(pNode, tNode, patternSf, targetSf, bindings);
    }
    return undefined;
}

export function matchNode(
    patternNode: ts.Node,
    targetNode: ts.Node,
    patternSf: ts.SourceFile,
    targetSf: ts.SourceFile,
    bindings: Map<string, MetavariableBinding>,
): boolean {
    if (ts.isIdentifier(patternNode) && isMetavariableName(patternNode.text)) {
        return matchMetavariable(patternNode, targetNode, targetSf, bindings);
    }

    const pNode = unwrapParentheses(patternNode);
    const tNode = unwrapParentheses(targetNode);

    const blockMatch = tryMatchSingleStatementBlock(pNode, tNode, patternSf, targetSf, bindings);
    if (blockMatch !== undefined) {
        return blockMatch;
    }

    if (pNode.kind !== tNode.kind) {
        return false;
    }

    const specialized = matchSpecializedExpression(pNode, tNode, patternSf, targetSf, bindings);
    if (specialized !== undefined) {
        return specialized;
    }

    return matchGeneralChildren(pNode, tNode, patternSf, targetSf, bindings);
}

/**
 * Validates individual metavariable constraint rules against captured binding.
 */
function checkSingleConstraint(
    binding: MetavariableBinding,
    constraint: MetavariableConstraint,
): boolean {
    if (constraint.kind !== undefined && binding.nodeKind !== constraint.kind) {
        return false;
    }
    if (constraint.notEquals !== undefined && binding.value === constraint.notEquals) {
        return false;
    }
    if (constraint.regex !== undefined) {
        const re =
            typeof constraint.regex === 'string' ? new RegExp(constraint.regex) : constraint.regex;
        if (!re.test(binding.value)) {
            return false;
        }
    }
    if (constraint.predicate !== undefined && !constraint.predicate(binding)) {
        return false;
    }
    return true;
}

/**
 * Evaluates where-clause constraints on captured metavariable bindings.
 *
 * @param where - Record of metavariable constraints.
 * @param bindings - Map of captured metavariable bindings.
 * @returns True if all constraints are satisfied.
 */
export function evaluateConstraints(
    where: Readonly<Record<string, MetavariableConstraint>> | undefined,
    bindings: Map<string, MetavariableBinding>,
): boolean {
    if (!where) {
        return true;
    }
    for (const [varName, constraint] of Object.entries(where)) {
        const key = varName.startsWith('$') ? varName : `$${varName}`;
        const binding = bindings.get(key);
        if (!binding) {
            return false;
        }
        if (!checkSingleConstraint(binding, constraint)) {
            return false;
        }
    }
    return true;
}

/**
 * Synthesizes replacement text by interpolating captured metavariable values into rewrite template.
 *
 * @param template - Rewrite template string with metavariables.
 * @param bindings - Map of captured metavariable bindings.
 * @returns Fully substituted replacement string.
 */
export function synthesizeRewrite(
    template: string,
    bindings: Map<string, MetavariableBinding>,
): string {
    return template.replace(/\$([A-Za-z0-9_]+)/g, (fullMatch) => {
        const binding = bindings.get(fullMatch);
        return binding !== undefined ? binding.value : fullMatch;
    });
}

function buildBindingsRecord(bindings: Map<string, MetavariableBinding>): Record<string, MetavariableBinding> {
    const bindingsRecord: Record<string, MetavariableBinding> = {};
    for (const [key, value] of bindings.entries()) {
        bindingsRecord[key] = value;
    }
    return Object.freeze(bindingsRecord);
}

function createStructuralMatch(
    rule: CompiledPatternRule,
    node: ts.Node,
    targetSf: ts.SourceFile,
    bindings: Map<string, MetavariableBinding>,
): StructuralMatch {
    const range = computeRange(node, targetSf);
    const matchedText = targetSf.text.substring(range.start, range.end);
    const replacementText = synthesizeRewrite(rule.spec.rewrite, bindings);
    const bindingsRecord = buildBindingsRecord(bindings);

    return {
        ruleId: rule.spec.id,
        range,
        matchedText,
        bindings: bindingsRecord,
        replacementText,
    };
}

/**
 * Discovers non-overlapping structural matches across target AST.
 *
 * @param rootNode - Document root AST node.
 * @param targetSf - Document source file.
 * @param rules - Compiled pattern rewrite rules.
 * @param maxReplacements - Cap on number of matches collected.
 * @returns Array of discovered structural matches.
 */
export function findMatches(
    rootNode: ts.Node,
    targetSf: ts.SourceFile,
    rules: readonly CompiledPatternRule[],
    maxReplacements: number,
): StructuralMatch[] {
    const matches: StructuralMatch[] = [];
    const scratchBindings = new Map<string, MetavariableBinding>();

    function visit(node: ts.Node): void {
        if (matches.length >= maxReplacements) {
            return;
        }

        for (let i = 0; i < rules.length; i++) {
            const rule = rules[i];
            scratchBindings.clear();
            const matched = matchNode(rule.patternNode, node, rule.patternSf, targetSf, scratchBindings);

            if (matched && evaluateConstraints(rule.spec.where, scratchBindings)) {
                matches.push(createStructuralMatch(rule, node, targetSf, scratchBindings));
                return;
            }
        }

        ts.forEachChild(node, visit);
    }

    visit(rootNode);
    return matches;
}

/**
 * Generates standard unified diff between original source and modified text.
 *
 * @param filePath - Path identifier used in diff headers.
 * @param originalText - Text prior to transformation.
 * @param modifiedText - Text after transformation.
 * @returns Unified diff formatted string, or empty string if unchanged.
 */
export function generateUnifiedDiff(
    filePath: string,
    originalText: string,
    modifiedText: string,
): string {
    if (originalText === modifiedText) {
        return '';
    }

    const oldLines = originalText.split(/\r?\n/);
    const newLines = modifiedText.split(/\r?\n/);

    let start = 0;
    while (
        start < oldLines.length &&
        start < newLines.length &&
        oldLines[start] === newLines[start]
    ) {
        start++;
    }

    let oldEnd = oldLines.length - 1;
    let newEnd = newLines.length - 1;
    while (oldEnd >= start && newEnd >= start && oldLines[oldEnd] === newLines[newEnd]) {
        oldEnd--;
        newEnd--;
    }

    const ctxStart = Math.max(0, start - 3);
    const oldCtxEnd = Math.min(oldLines.length, oldEnd + 4);
    const newCtxEnd = Math.min(newLines.length, newEnd + 4);

    const diffLines: string[] = [];
    for (let i = ctxStart; i < start; i++) {
        diffLines.push(` ${oldLines[i]}`);
    }
    for (let i = start; i <= oldEnd; i++) {
        diffLines.push(`-${oldLines[i]}`);
    }
    for (let i = start; i <= newEnd; i++) {
        diffLines.push(`+${newLines[i]}`);
    }

    const trailingOld = oldCtxEnd - (oldEnd + 1);
    const trailingNew = newCtxEnd - (newEnd + 1);
    const trailingLen = Math.max(trailingOld, trailingNew);
    for (let i = 0; i < trailingLen; i++) {
        const line = oldLines[oldEnd + 1 + i];
        if (line !== undefined) {
            diffLines.push(` ${line}`);
        }
    }

    const oldCount = Math.max(1, oldEnd - ctxStart + 1 + trailingLen);
    const newCount = Math.max(1, newEnd - ctxStart + 1 + trailingLen);
    const normalized = filePath.replace(/\\/g, '/');

    return (
        `--- a/${normalized}\n` +
        `+++ b/${normalized}\n` +
        `@@ -${ctxStart + 1},${oldCount} +${ctxStart + 1},${newCount} @@\n` +
        diffLines.join('\n') +
        '\n'
    );
}

function createNoopRewriteResult(
    sourceCode: string,
    rawRules: readonly PatternSpec[],
): RewriteResult {
    const emptyPatch: ActionablePatch = Object.freeze({
        ruleId: rawRules[0]?.id ?? 'noop',
        title: rawRules[0]?.description ?? rawRules[0]?.id ?? 'No matches',
        edits: Object.freeze([]),
        unifiedPatch: '',
    });
    return Object.freeze({
        hasChanged: false,
        originalSource: sourceCode,
        rewrittenSource: sourceCode,
        matches: Object.freeze([]),
        patch: emptyPatch,
        unifiedDiff: '',
        roundsApplied: 0,
    });
}

/**
 * Pure declarative structural matching and rewriting engine.
 * Inspects sourceCode with ruleSpec, captures metavariables, applies safe non-overlapping
 * replacements, and produces unified diff with actionable patch payloads.
 *
 * @param sourceCode - Target TypeScript or JavaScript source code.
 * @param ruleSpec - Single pattern rule or collection of declarative pattern rules.
 * @param options - Tuning options controlling diff path and replacement limits.
 * @returns Fully deterministic rewrite result.
 */
export function matchAndRewrite(
    sourceCode: string,
    ruleSpec: PatternSpec | readonly PatternSpec[],
    options?: MatchAndRewriteOptions,
): RewriteResult {
    const rawRules = Array.isArray(ruleSpec) ? ruleSpec : [ruleSpec];
    if (rawRules.length === 0) {
        throw new Error('matchAndRewrite requires at least one PatternSpec rule');
    }

    const compiledRules: CompiledPatternRule[] = [];
    for (let i = 0; i < rawRules.length; i++) {
        compiledRules.push(compilePattern(rawRules[i]));
    }

    const targetSf = ts.createSourceFile(
        '__target__.tsx',
        sourceCode,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
    );

    const maxReplacements = options?.maxReplacements ?? 1000;
    const matches = findMatches(targetSf, targetSf, compiledRules, maxReplacements);

    if (matches.length === 0) {
        return createNoopRewriteResult(sourceCode, rawRules);
    }

    const sortedMatches = [...matches].sort((a, b) => b.range.start - a.range.start);
    let transformed = sourceCode;
    for (let i = 0; i < sortedMatches.length; i++) {
        const m = sortedMatches[i];
        transformed =
            transformed.substring(0, m.range.start) +
            m.replacementText +
            transformed.substring(m.range.end);
    }

    const edits: PatchEdit[] = matches.map((m) => ({
        range: {
            startLine: m.range.startLine,
            startCol: m.range.startCol,
            endLine: m.range.endLine,
            endCol: m.range.endCol,
        },
        newText: m.replacementText,
    }));

    const filePath = options?.filePath ?? 'source.ts';
    const unifiedDiff = generateUnifiedDiff(filePath, sourceCode, transformed);

    const actionablePatch: ActionablePatch = Object.freeze({
        ruleId: rawRules[0].id,
        title: rawRules[0].description ?? rawRules[0].id,
        edits: Object.freeze(edits),
        unifiedPatch: unifiedDiff,
    });

    return Object.freeze({
        hasChanged: true,
        originalSource: sourceCode,
        rewrittenSource: transformed,
        matches: Object.freeze(matches),
        patch: actionablePatch,
        unifiedDiff,
        roundsApplied: 1,
    });
}

/**
 * Iteratively applies declarative structural pattern rewrites until a fixpoint is reached
 * or the maximum allowed rounds (capped at 5) is exhausted.
 *
 * @param sourceCode - Target TypeScript or JavaScript source code.
 * @param ruleSpec - Declarative pattern specification or array of specifications.
 * @param options - Transformation options including maxRounds and maxReplacements.
 * @returns Comprehensive RewriteResult describing cumulative transformations.
 */
export function rewriteUntilFixpoint(
    sourceCode: string,
    ruleSpec: PatternSpec | readonly PatternSpec[],
    options?: MatchAndRewriteOptions,
): RewriteResult {
    const rawRules = Array.isArray(ruleSpec) ? ruleSpec : [ruleSpec];
    if (!sourceCode || rawRules.length === 0) {
        return createNoopRewriteResult(sourceCode, rawRules);
    }

    const maxRounds = Math.min(5, Math.max(1, options?.maxRounds ?? 5));
    let currentSource = sourceCode;
    let rounds = 0;
    const accumulatedMatches: StructuralMatch[] = [];

    while (rounds < maxRounds) {
        const passResult = matchAndRewrite(currentSource, ruleSpec, options);
        if (!passResult.hasChanged || passResult.rewrittenSource === currentSource) {
            break;
        }
        for (let i = 0; i < passResult.matches.length; i++) {
            accumulatedMatches.push(passResult.matches[i]);
        }
        currentSource = passResult.rewrittenSource;
        rounds++;
    }

    if (rounds === 0 || currentSource === sourceCode) {
        return createNoopRewriteResult(sourceCode, rawRules);
    }

    const filePath = options?.filePath ?? 'source.ts';
    const unifiedDiff = generateUnifiedDiff(filePath, sourceCode, currentSource);

    const actionablePatch: ActionablePatch = Object.freeze({
        ruleId: rawRules[0]?.id ?? 'fixpoint-rewrite',
        title: rawRules[0]?.description ?? 'Cumulative fixpoint structural rewrite',
        edits: Object.freeze([]),
        unifiedPatch: unifiedDiff,
    });

    return Object.freeze({
        hasChanged: true,
        originalSource: sourceCode,
        rewrittenSource: currentSource,
        matches: Object.freeze(accumulatedMatches),
        patch: actionablePatch,
        unifiedDiff,
        roundsApplied: rounds,
    });
}

/**
 * Structural pattern matching pure search utility without applying modifications.
 *
 * @param sourceCode - Target TypeScript or JavaScript source code.
 * @param ruleSpec - Pattern rule or rules to match against.
 * @param maxMatches - Upper bound on returned matches.
 * @returns Readonly array of structural AST matches.
 */
export function matchPattern(
    sourceCode: string,
    ruleSpec: PatternSpec | readonly PatternSpec[],
    maxMatches: number = 1000,
): readonly StructuralMatch[] {
    const rawRules = Array.isArray(ruleSpec) ? ruleSpec : [ruleSpec];
    const compiledRules: CompiledPatternRule[] = [];
    for (let i = 0; i < rawRules.length; i++) {
        compiledRules.push(compilePattern(rawRules[i]));
    }

    const targetSf = ts.createSourceFile(
        '__target__.tsx',
        sourceCode,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
    );

    return Object.freeze(findMatches(targetSf, targetSf, compiledRules, maxMatches));
}

/**
 * High-cohesion namespace encapsulating declarative structural pattern operations.
 */
export const StructuralPatternEngine = Object.freeze({
    compilePattern,
    isMetavariableName,
    normalizeCode,
    computeRange,
    unwrapParentheses,
    matchNode,
    evaluateConstraints,
    synthesizeRewrite,
    generateUnifiedDiff,
    matchAndRewrite,
    rewriteUntilFixpoint,
    matchPattern,
});
