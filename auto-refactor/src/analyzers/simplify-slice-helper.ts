/**
 * Module: Static Analysis Engine — Function Slice Boundary Analysis Helper
 * File Path: src/analyzers/simplify-slice-helper.ts
 * Architecture Role: Provides AST-based statement slice boundary detection, variable read/write
 *   dependency analysis, and automated function extraction candidate suggestions.
 * Dependencies & Triggers: Consumed by SimplifyAnalyzer for over-long function refactoring
 *   and control flow flattening; depends on typescript compiler API.
 * Responsibilities:
 *   1. Analyze statements in function bodies to extract read and written variable sets.
 *   2. Identify optimal slice boundaries with minimal cross-slice state dependencies.
 *   3. Generate extraction signatures and line ranges for candidate helper functions.
 *   4. Generate inverted condition guard clauses for deeply nested control flow.
 *   5. Generate parameter object encapsulation templates for wide parameter lists.
 * Exit Semantics & Design Rationale: Pure analysis helper; never mutates AST; returns structured
 *   slice candidates or null when slice calculation is infeasible.
 */

import * as ts from 'typescript';
import type { NormalizedNode } from '../core/ast/multilang';
import { NodeKind } from '../core/ast/multilang';
import type { Issue } from '../core/types';

/** Recommended line span for an extracted function slice. */
export interface FunctionSliceRange {
    startLine: number;
    endLine: number;
}

/** Evaluated candidate slice within a function body. */
export interface FunctionSliceCandidate {
    sliceRange: FunctionSliceRange;
    readVariables: string[];
    writtenVariables: string[];
    extractSignature: string;
    crossSliceDependencyCount: number;
    inputVariables: string[];
    outputVariables: string[];
    templateSnippet?: string;
    startIndex: number;
    endIndex: number;
}

/** Result shape supporting both array iteration and direct property lookups. */
export interface FunctionSliceAnalysis extends Array<FunctionSliceCandidate> {
    sliceRange?: FunctionSliceRange;
    extractSignature?: string;
    readVariables?: string[];
    writtenVariables?: string[];
    candidates: FunctionSliceCandidate[];
    recommendedSlice?: FunctionSliceCandidate;
}

interface StatementVariableInfo {
    reads: Set<string>;
    writes: Set<string>;
}

const JS_GLOBALS = new Set([
    'console',
    'Math',
    'JSON',
    'Object',
    'Array',
    'Promise',
    'Error',
    'String',
    'Number',
    'Boolean',
    'Date',
    'RegExp',
    'Map',
    'Set',
    'WeakMap',
    'WeakSet',
    'Symbol',
    'Proxy',
    'Reflect',
    'process',
    'window',
    'document',
    'globalThis',
    'Buffer',
    'setTimeout',
    'clearTimeout',
    'setInterval',
    'clearInterval',
    'require',
    'exports',
    'module',
]);

const DEFAULT_HELPER_SUFFIX = 'Helper';
const RETURN_TYPE_VOID = 'void';
const COMMENT_EXTRACTED_HELPER = '// Extracted helper:';
const COMMENT_SLICE_BODY = '    // ... extracted slice statements';
const COMMENT_CALL_SITE = '// Call site:';
const DEFAULT_EMPTY_RETURN = 'return;';
const DEFAULT_TARGET_FUNCTION = 'targetFunction';
const COMMENT_FUNCTION_BODY = '    // ... function body';
const MAX_SLICE_STATEMENT_WINDOW = 15;
const PREFIX_EXTRACT = 'extract';
const DEFAULT_FUNCTION_NAME = 'Helper';

function formatCapitalizedText(text: string): string {
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : DEFAULT_HELPER_SUFFIX;
}

function collectBindingIdentifiers(binding: ts.BindingName, target: Set<string>): void {
    if (ts.isIdentifier(binding)) {
        target.add(binding.text);
        return;
    }
    if (ts.isObjectBindingPattern(binding) || ts.isArrayBindingPattern(binding)) {
        for (const element of binding.elements) {
            if (ts.isBindingElement(element)) {
                collectBindingIdentifiers(element.name, target);
            }
        }
    }
}

const LITERAL_IDENTIFIERS = new Set(['undefined', 'null', 'true', 'false', 'arguments']);

const NON_READ_DECLARATION_KINDS = new Set([
    ts.SyntaxKind.PropertyAccessExpression,
    ts.SyntaxKind.PropertyAssignment,
    ts.SyntaxKind.VariableDeclaration,
    ts.SyntaxKind.Parameter,
    ts.SyntaxKind.FunctionDeclaration,
    ts.SyntaxKind.MethodDeclaration,
    ts.SyntaxKind.ClassDeclaration,
]);

function isDeclarationName(parent: ts.Node, id: ts.Identifier): boolean {
    if (!NON_READ_DECLARATION_KINDS.has(parent.kind)) return false;
    return (parent as { name?: ts.Node }).name === id;
}

function isAssignmentTarget(parent: ts.Node, id: ts.Identifier): boolean {
    if (!ts.isBinaryExpression(parent)) return false;
    return parent.left === id && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken;
}

function isIdentifierRead(id: ts.Identifier): boolean {
    if (LITERAL_IDENTIFIERS.has(id.text)) return false;
    const parent = id.parent;
    if (!parent) return true;
    if (ts.isTypeNode(parent) || ts.isTypeReferenceNode(parent)) return false;
    return !isDeclarationName(parent, id) && !isAssignmentTarget(parent, id);
}

function isAssignmentOperator(kind: ts.SyntaxKind): boolean {
    return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
}

function collectUnaryWrites(
    node: ts.PrefixUnaryExpression | ts.PostfixUnaryExpression,
    writes: Set<string>,
    reads: Set<string>,
): void {
    const op = node.operator;
    if (op === ts.SyntaxKind.PlusPlusToken || op === ts.SyntaxKind.MinusMinusToken) {
        if (ts.isIdentifier(node.operand)) {
            writes.add(node.operand.text);
            reads.add(node.operand.text);
        }
    }
}

function collectVariablesInStatement(stmt: ts.Statement): StatementVariableInfo {
    const reads = new Set<string>();
    const writes = new Set<string>();

    function visit(astNode: ts.Node): void {
        if (ts.isTypeNode(astNode)) return;
        if (ts.isVariableDeclaration(astNode)) {
            collectBindingIdentifiers(astNode.name, writes);
        } else if (
            ts.isBinaryExpression(astNode) &&
            isAssignmentOperator(astNode.operatorToken.kind)
        ) {
            if (ts.isIdentifier(astNode.left)) {
                writes.add(astNode.left.text);
                if (astNode.operatorToken.kind !== ts.SyntaxKind.EqualsToken) {
                    reads.add(astNode.left.text);
                }
            }
        } else if (ts.isPrefixUnaryExpression(astNode) || ts.isPostfixUnaryExpression(astNode)) {
            collectUnaryWrites(astNode, writes, reads);
        } else if (ts.isIdentifier(astNode) && isIdentifierRead(astNode)) {
            reads.add(astNode.text);
        }
        ts.forEachChild(astNode, visit);
    }

    ts.forEachChild(stmt, visit);
    return { reads, writes };
}

function collectFunctionParameterNames(
    node: ts.FunctionDeclaration | ts.MethodDeclaration | ts.ArrowFunction | ts.FunctionExpression,
): Set<string> {
    const names = new Set<string>();
    for (const p of node.parameters) {
        collectBindingIdentifiers(p.name, names);
    }
    return names;
}

function buildExtractSignature(
    helperName: string,
    inputs: string[],
    outputs: string[],
): { signature: string; template: string } {
    const paramList = inputs.map((v) => `${v}: unknown`).join(', ');
    let returnType = RETURN_TYPE_VOID;
    let returnStmt = '';
    let callSite = `${helperName}(${inputs.join(', ')});`;

    if (outputs.length === 1) {
        returnType = 'unknown';
        returnStmt = `    return ${outputs[0]};`;
        callSite = `const ${outputs[0]} = ${helperName}(${inputs.join(', ')});`;
    } else if (outputs.length > 1) {
        returnType = `{ ${outputs.map((v) => `${v}: unknown`).join(', ')} }`;
        returnStmt = `    return { ${outputs.join(', ')} };`;
        callSite = `const { ${outputs.join(', ')} } = ${helperName}(${inputs.join(', ')});`;
    }

    const signature = `function ${helperName}(${paramList}): ${returnType}`;
    const template = [
        COMMENT_EXTRACTED_HELPER,
        `${signature} {`,
        COMMENT_SLICE_BODY,
        returnStmt,
        `}`,
        ``,
        COMMENT_CALL_SITE,
        callSite,
    ]
        .filter(Boolean)
        .join('\n');

    return { signature, template };
}

function resolveWritesBefore(
    startIndex: number,
    stmtInfos: StatementVariableInfo[],
    prefixWrites?: Set<string>[],
): Set<string> {
    if (prefixWrites) return prefixWrites[startIndex];
    const writesBefore = new Set<string>();
    for (let k = 0; k < startIndex; k++) {
        stmtInfos[k].writes.forEach((writtenVar) => writesBefore.add(writtenVar));
    }
    return writesBefore;
}

function resolveReadsAfter(
    endIndex: number,
    statementsLen: number,
    stmtInfos: StatementVariableInfo[],
    suffixReads?: Set<string>[],
): Set<string> {
    if (suffixReads) return suffixReads[endIndex + 1];
    const readsAfter = new Set<string>();
    for (let k = endIndex + 1; k < statementsLen; k++) {
        stmtInfos[k].reads.forEach((readVar) => readsAfter.add(readVar));
    }
    return readsAfter;
}

interface LineSpanRangeIndices {
    readonly startIndex: number;
    readonly endIndex: number;
}

function resolveLineSpan(
    range: LineSpanRangeIndices,
    statements: readonly ts.Statement[],
    sf: ts.SourceFile,
    cachedLines?: { starts?: Int32Array; ends?: Int32Array },
): FunctionSliceRange {
    if (cachedLines?.starts && cachedLines?.ends) {
        return {
            startLine: cachedLines.starts[range.startIndex],
            endLine: cachedLines.ends[range.endIndex],
        };
    }
    const startPos = sf.getLineAndCharacterOfPosition(statements[range.startIndex].getStart(sf));
    const endPos = sf.getLineAndCharacterOfPosition(statements[range.endIndex].getEnd());
    return { startLine: startPos.line + 1, endLine: endPos.line + 1 };
}

function isSliceInputVariable(
    variable: string,
    paramNames: ReadonlySet<string>,
    writesBefore: ReadonlySet<string>,
    sliceWrites: ReadonlySet<string>,
): boolean {
    if (JS_GLOBALS.has(variable)) return false;
    return paramNames.has(variable) || writesBefore.has(variable) || !sliceWrites.has(variable);
}

function collectInputVariables(
    sliceReads: ReadonlySet<string>,
    paramNames: ReadonlySet<string>,
    writesBefore: ReadonlySet<string>,
    sliceWrites: ReadonlySet<string>,
): string[] {
    const inputs: string[] = [];
    for (const varName of sliceReads) {
        if (isSliceInputVariable(varName, paramNames, writesBefore, sliceWrites)) {
            inputs.push(varName);
        }
    }
    return inputs;
}

function collectOutputVariables(
    sliceWrites: ReadonlySet<string>,
    readsAfter: ReadonlySet<string>,
): string[] {
    const outputs: string[] = [];
    for (const varName of sliceWrites) {
        if (readsAfter.has(varName)) {
            outputs.push(varName);
        }
    }
    return outputs;
}

function computeDependencyScore(inputCount: number, outputCount: number): number {
    return inputCount + (outputCount > 1 ? outputCount * 2 : outputCount);
}

function populateSliceVariables(
    range: LineSpanRangeIndices,
    stmtInfos: StatementVariableInfo[],
    buffers: { reads: Set<string>; writes: Set<string> },
): void {
    for (let k = range.startIndex; k <= range.endIndex; k++) {
        stmtInfos[k].reads.forEach((r) => buffers.reads.add(r));
        stmtInfos[k].writes.forEach((w) => buffers.writes.add(w));
    }
}

interface SliceEvaluationContext {
    readonly statements: readonly ts.Statement[];
    readonly sf: ts.SourceFile;
    readonly paramNames: ReadonlySet<string>;
    readonly stmtInfos: StatementVariableInfo[];
    readonly helperName: string;
    readonly prefixWrites?: Set<string>[];
    readonly suffixReads?: Set<string>[];
    readonly cachedLines?: { starts?: Int32Array; ends?: Int32Array };
    readonly buffers?: { reads: Set<string>; writes: Set<string> };
}

function evaluateSliceRange(
    range: LineSpanRangeIndices,
    context: SliceEvaluationContext,
): FunctionSliceCandidate {
    const { startIndex, endIndex } = range;
    const sliceReads = context.buffers?.reads ?? new Set<string>();
    const sliceWrites = context.buffers?.writes ?? new Set<string>();
    sliceReads.clear();
    sliceWrites.clear();

    populateSliceVariables(range, context.stmtInfos, { reads: sliceReads, writes: sliceWrites });

    const writesBefore = resolveWritesBefore(startIndex, context.stmtInfos, context.prefixWrites);
    const readsAfter = resolveReadsAfter(
        endIndex,
        context.statements.length,
        context.stmtInfos,
        context.suffixReads,
    );

    const inputVars = collectInputVariables(
        sliceReads,
        context.paramNames,
        writesBefore,
        sliceWrites,
    );
    const outputVars = collectOutputVariables(sliceWrites, readsAfter);
    const dependencyCount = computeDependencyScore(inputVars.length, outputVars.length);
    const sliceRange = resolveLineSpan(range, context.statements, context.sf, context.cachedLines);
    const { signature, template } = buildExtractSignature(
        context.helperName,
        inputVars,
        outputVars,
    );

    return {
        sliceRange,
        readVariables: Array.from(sliceReads),
        writtenVariables: Array.from(sliceWrites),
        extractSignature: signature,
        crossSliceDependencyCount: dependencyCount,
        inputVariables: inputVars,
        outputVariables: outputVars,
        templateSnippet: template,
        startIndex,
        endIndex,
    };
}

function copyAndExtendSet(base: ReadonlySet<string>, additions: ReadonlySet<string>): Set<string> {
    const next = new Set<string>(base);
    additions.forEach((item) => next.add(item));
    return next;
}

function precomputePrefixWrites(
    statementCount: number,
    stmtInfos: StatementVariableInfo[],
): Set<string>[] {
    const prefixWrites: Set<string>[] = Array.from({ length: statementCount + 1 });
    prefixWrites[0] = new Set<string>();
    for (let k = 0; k < statementCount; k++) {
        if (stmtInfos[k].writes.size === 0) {
            prefixWrites[k + 1] = prefixWrites[k];
        } else {
            prefixWrites[k + 1] = copyAndExtendSet(prefixWrites[k], stmtInfos[k].writes);
        }
    }
    return prefixWrites;
}

function precomputeSuffixReads(
    statementCount: number,
    stmtInfos: StatementVariableInfo[],
): Set<string>[] {
    const suffixReads: Set<string>[] = Array.from({ length: statementCount + 1 });
    suffixReads[statementCount] = new Set<string>();
    for (let k = statementCount - 1; k >= 0; k--) {
        if (stmtInfos[k].reads.size === 0) {
            suffixReads[k] = suffixReads[k + 1];
        } else {
            suffixReads[k] = copyAndExtendSet(suffixReads[k + 1], stmtInfos[k].reads);
        }
    }
    return suffixReads;
}

function createSliceAnalysis(candidates: FunctionSliceCandidate[]): FunctionSliceAnalysis {
    const recommended = candidates[0];
    const analysisPayload = Object.assign([...candidates], {
        sliceRange: recommended ? recommended.sliceRange : undefined,
        extractSignature: recommended ? recommended.extractSignature : undefined,
        readVariables: recommended ? recommended.readVariables : undefined,
        writtenVariables: recommended ? recommended.writtenVariables : undefined,
        candidates,
        recommendedSlice: recommended,
    }) as FunctionSliceAnalysis;
    return analysisPayload;
}

/**
 * Computes contiguous statement slice boundaries with minimal cross-slice state coupling.
 *
 * @param node - Function AST node to analyze.
 * @param sf - Enclosing SourceFile for position lookups.
 * @returns Candidate slices ranked by minimal dependency count, or null when non-sliceable.
 */
export function computeFunctionSlices(
    node: ts.FunctionDeclaration | ts.MethodDeclaration | ts.ArrowFunction | ts.FunctionExpression,
    sf: ts.SourceFile,
): FunctionSliceAnalysis | null {
    if (!node.body || !ts.isBlock(node.body)) return null;
    const statements = node.body.statements;
    if (statements.length === 0) return null;

    const fnName = node.name && ts.isIdentifier(node.name) ? node.name.text : DEFAULT_FUNCTION_NAME;
    const helperName = PREFIX_EXTRACT + formatCapitalizedText(fnName);
    const paramNames = collectFunctionParameterNames(node);
    const stmtInfos = statements.map((s) => collectVariablesInStatement(s));

    const candidates: FunctionSliceCandidate[] = [];
    const statementCount = statements.length;

    // Precompute statement line spans ONCE to eliminate redundant AST position queries in loops
    const stmtStartLines = new Int32Array(statementCount);
    const stmtEndLines = new Int32Array(statementCount);
    for (let k = 0; k < statementCount; k++) {
        stmtStartLines[k] = sf.getLineAndCharacterOfPosition(statements[k].getStart(sf)).line + 1;
        stmtEndLines[k] = sf.getLineAndCharacterOfPosition(statements[k].getEnd()).line + 1;
    }

    const prefixWrites = precomputePrefixWrites(statementCount, stmtInfos);
    const suffixReads = precomputeSuffixReads(statementCount, stmtInfos);
    const scratchReads = new Set<string>();
    const scratchWrites = new Set<string>();
    const sliceContext: SliceEvaluationContext = {
        statements,
        sf,
        paramNames,
        stmtInfos,
        helperName,
        prefixWrites,
        suffixReads,
        cachedLines: { starts: stmtStartLines, ends: stmtEndLines },
        buffers: { reads: scratchReads, writes: scratchWrites },
    };

    if (statementCount === 1) {
        candidates.push(evaluateSliceRange({ startIndex: 0, endIndex: 0 }, sliceContext));
        return createSliceAnalysis(candidates);
    }

    const maxLen = Math.min(statementCount - 1, MAX_SLICE_STATEMENT_WINDOW);
    for (let len = 2; len <= maxLen; len++) {
        for (let i = 0; i <= statementCount - len; i++) {
            const j = i + len - 1;
            candidates.push(evaluateSliceRange({ startIndex: i, endIndex: j }, sliceContext));
        }
    }

    if (candidates.length === 0) {
        candidates.push(
            evaluateSliceRange({ startIndex: 0, endIndex: statementCount - 1 }, sliceContext),
        );
    }

    candidates.sort((a, b) => {
        if (a.crossSliceDependencyCount !== b.crossSliceDependencyCount) {
            return a.crossSliceDependencyCount - b.crossSliceDependencyCount;
        }
        const aLen = a.endIndex - a.startIndex + 1;
        const bLen = b.endIndex - b.startIndex + 1;
        return bLen - aLen;
    });

    return createSliceAnalysis(candidates);
}

function invertBinaryOperator(kind: ts.SyntaxKind): string | null {
    switch (kind) {
        case ts.SyntaxKind.EqualsEqualsEqualsToken:
            return '!==';
        case ts.SyntaxKind.ExclamationEqualsEqualsToken:
            return '===';
        case ts.SyntaxKind.EqualsEqualsToken:
            return '!=';
        case ts.SyntaxKind.ExclamationEqualsToken:
            return '==';
        case ts.SyntaxKind.GreaterThanToken:
            return '<=';
        case ts.SyntaxKind.GreaterThanEqualsToken:
            return '<';
        case ts.SyntaxKind.LessThanToken:
            return '>=';
        case ts.SyntaxKind.LessThanEqualsToken:
            return '>';
        default:
            return null;
    }
}

/**
 * Invert a conditional expression into its complementary guard form.
 *
 * @param expr - Expression AST node to invert.
 * @param sf - Source file providing text tokens.
 * @returns Inverted conditional code snippet string.
 */
export function invertConditionExpression(expr: ts.Expression, sf: ts.SourceFile): string {
    if (ts.isBinaryExpression(expr)) {
        const invOp = invertBinaryOperator(expr.operatorToken.kind);
        if (invOp) {
            return `${expr.left.getText(sf)} ${invOp} ${expr.right.getText(sf)}`;
        }
        return `!(${expr.getText(sf)})`;
    }
    if (ts.isPrefixUnaryExpression(expr) && expr.operator === ts.SyntaxKind.ExclamationToken) {
        return expr.operand.getText(sf);
    }
    if (ts.isParenthesizedExpression(expr)) {
        return invertConditionExpression(expr.expression, sf);
    }
    if (ts.isIdentifier(expr)) {
        return `!${expr.getText(sf)}`;
    }
    return `!(${expr.getText(sf)})`;
}

function findFallbackReturn(
    node: ts.FunctionDeclaration | ts.MethodDeclaration | ts.ArrowFunction | ts.FunctionExpression,
    sf: ts.SourceFile,
): string {
    if (!node.body || !ts.isBlock(node.body)) return DEFAULT_EMPTY_RETURN;
    const stmts = node.body.statements;
    for (let i = stmts.length - 1; i >= 0; i--) {
        const s = stmts[i];
        if (ts.isReturnStatement(s)) {
            return s.expression ? `return ${s.expression.getText(sf)};` : DEFAULT_EMPTY_RETURN;
        }
    }
    return DEFAULT_EMPTY_RETURN;
}

function collectNestedIfConditions(
    stmt: ts.Statement,
    conds: ts.Expression[],
    deepestBody: { stmt: ts.Statement | null },
): void {
    if (!ts.isIfStatement(stmt)) return;
    conds.push(stmt.expression);

    const thenStmt = stmt.thenStatement;
    if (ts.isBlock(thenStmt)) {
        if (thenStmt.statements.length === 1 && ts.isIfStatement(thenStmt.statements[0])) {
            collectNestedIfConditions(thenStmt.statements[0], conds, deepestBody);
        } else if (thenStmt.statements.length > 0) {
            deepestBody.stmt = thenStmt.statements[0];
        }
    } else if (ts.isIfStatement(thenStmt)) {
        collectNestedIfConditions(thenStmt, conds, deepestBody);
    } else {
        deepestBody.stmt = thenStmt;
    }
}

/**
 * Generate flattened early-return guard clauses from deeply nested if conditions.
 *
 * @param node - Target function AST node.
 * @param sf - Source file providing syntax text.
 * @returns Flattened early-return guard clause string, or null if not applicable.
 */
export function getInvertedGuardSnippet(
    node: ts.FunctionDeclaration | ts.MethodDeclaration | ts.ArrowFunction | ts.FunctionExpression,
    sf: ts.SourceFile,
): string | null {
    if (!node.body || !ts.isBlock(node.body)) return null;
    const statements = node.body.statements;
    if (statements.length === 0) return null;

    let outerIf: ts.IfStatement | null = null;
    for (const s of statements) {
        if (ts.isIfStatement(s)) {
            outerIf = s;
            break;
        }
    }
    if (!outerIf) return null;

    const conds: ts.Expression[] = [];
    const deepestBody: { stmt: ts.Statement | null } = { stmt: null };
    collectNestedIfConditions(outerIf, conds, deepestBody);
    if (conds.length === 0) return null;

    const fallbackReturn = findFallbackReturn(node, sf);
    const clauses = conds.map((c) => `if (${invertConditionExpression(c, sf)}) ${fallbackReturn}`);

    if (deepestBody.stmt) {
        clauses.push(deepestBody.stmt.getText(sf));
    }

    return clauses.join('\n');
}

/** Backward compatibility alias */
export const generateInvertedConditionSnippet = getInvertedGuardSnippet;

/**
 * Generate a refactoring template encapsulating multiple parameters into a typed options object.
 *
 * @param functionName - Name of the function being refactored.
 * @param params - Array of parameter descriptor objects.
 * @returns Refactoring snippet code string.
 */
export function generateParameterObjectSnippet(
    functionName: string,
    params: Array<{ name: string; type?: string }>,
): string {
    const typeName = `${formatCapitalizedText(functionName)}Options`;
    const propLines = params.map((p) => `    ${p.name}: ${p.type || 'unknown'};`).join('\n');
    const paramNames = params.map((p) => p.name).join(', ');

    return [
        `export interface ${typeName} {`,
        propLines,
        `}`,
        ``,
        `function ${functionName || DEFAULT_TARGET_FUNCTION}(options: ${typeName}) {`,
        `    const { ${paramNames} } = options;`,
        COMMENT_FUNCTION_BODY,
        `}`,
    ].join('\n');
}

const functionLineCache = new WeakMap<
    ts.SourceFile,
    Map<
        number,
        | ts.FunctionDeclaration
        | ts.MethodDeclaration
        | ts.ArrowFunction
        | ts.FunctionExpression
        | null
    >
>();

/**
 * Find the function-like AST node located closest to a specified line number.
 *
 * @param sf - Source file to inspect.
 * @param targetLine - 1-based target line number.
 * @returns Function-like AST node or null if none found.
 */
export function findTsFunctionAtLine(
    sf: ts.SourceFile,
    targetLine: number,
): ts.FunctionDeclaration | ts.MethodDeclaration | ts.ArrowFunction | ts.FunctionExpression | null {
    let sfCache = functionLineCache.get(sf);
    if (!sfCache) {
        sfCache = new Map();
        functionLineCache.set(sf, sfCache);
    } else if (sfCache.has(targetLine)) {
        return sfCache.get(targetLine)!;
    }

    let bestMatch:
        | ts.FunctionDeclaration
        | ts.MethodDeclaration
        | ts.ArrowFunction
        | ts.FunctionExpression
        | null = null;
    let minDistance = Infinity;

    const lineStarts = sf.getLineStarts();
    const minLine = Math.max(1, targetLine - 2);
    const minPos = minLine <= lineStarts.length ? lineStarts[minLine - 1] : sf.end;
    const maxLineIdx = targetLine + 2;
    const maxPos = maxLineIdx < lineStarts.length ? lineStarts[maxLineIdx] : sf.end;

    function walk(astNode: ts.Node): boolean | void {
        if (astNode.end < minPos || astNode.pos > maxPos) {
            return;
        }

        if (
            ts.isFunctionDeclaration(astNode) ||
            ts.isMethodDeclaration(astNode) ||
            ts.isArrowFunction(astNode) ||
            ts.isFunctionExpression(astNode)
        ) {
            const pos = sf.getLineAndCharacterOfPosition(astNode.getStart(sf));
            const line = pos.line + 1;
            const distance = Math.abs(line - targetLine);
            if (distance < minDistance && distance <= 2) {
                minDistance = distance;
                bestMatch = astNode;
                if (minDistance === 0) {
                    return true;
                }
            }
        }

        return ts.forEachChild(astNode, walk);
    }

    walk(sf);
    sfCache.set(targetLine, bestMatch);
    return bestMatch;
}

/**
 * Type guard testing whether an AST node conforms to the NormalizedNode multilang schema.
 *
 * @param node - Candidate node object from analyzer traversal.
 * @returns True if node is non-null and possesses normalized kind and children.
 */
export function isNormalizedNode(node: unknown): node is NormalizedNode {
    return (
        typeof node === 'object' &&
        node !== null &&
        'kind' in node &&
        typeof (node as { kind: unknown }).kind === 'string'
    );
}

/**
 * Recursively visits all nodes in a normalized AST tree in pre-order depth-first sequence.
 *
 * @param node - Root normalized node to begin traversal.
 * @param visitor - Consumer callback invoked for each node.
 */
export function walkNormalizedTree(
    node: NormalizedNode,
    visitor: (n: NormalizedNode) => void,
): void {
    visitor(node);
    const children = node.children;
    if (children) {
        for (let i = 0; i < children.length; i++) {
            walkNormalizedTree(children[i], visitor);
        }
    }
}

/**
 * Determines whether a normalized AST node introduces an additional nesting indentation layer.
 *
 * @param node - Node to inspect.
 * @returns True if the node is control flow and not a transparent block container.
 */
function isNestingNode(node: NormalizedNode): boolean {
    return (
        node.kind === NodeKind.ControlFlow ||
        (Boolean(node.increasesNesting) && node.kind !== NodeKind.Block)
    );
}

/**
 * Pushes non-function children to the traversal stack for depth calculation.
 *
 * @param children - Child normalized nodes.
 * @param baseDepth - Current nesting depth at the parent.
 * @param nodeStack - Explicit node evaluation stack.
 * @param depthStack - Parallel depth stack matching nodeStack.
 */
function pushNonFunctionChildren(
    children: NormalizedNode[] | undefined,
    baseDepth: number,
    nodeStack: NormalizedNode[],
    depthStack: number[],
): void {
    if (!children) return;
    for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (!child.functionLike) {
            nodeStack.push(child);
            depthStack.push(baseDepth + (isNestingNode(child) ? 1 : 0));
        }
    }
}

/**
 * Computes maximum control flow nesting depth within a function node using explicit stack.
 *
 * Invariant: Functions declared inside nested scopes are not counted towards the parent nesting depth.
 *
 * @param rootNode - Normalized root function node.
 * @returns Maximum control flow nesting level (0 if no branching).
 */
export function computeControlFlowNesting(rootNode: NormalizedNode): number {
    const rootChildren = rootNode.children;
    if (!rootChildren || rootChildren.length === 0) return 0;

    let max = 0;
    const nodeStack: NormalizedNode[] = [];
    const depthStack: number[] = [];

    pushNonFunctionChildren(rootChildren, 0, nodeStack, depthStack);

    while (nodeStack.length > 0) {
        const currentNode = nodeStack.pop()!;
        const currentDepth = depthStack.pop()!;
        if (currentDepth > max) max = currentDepth;
        pushNonFunctionChildren(currentNode.children, currentDepth, nodeStack, depthStack);
    }
    return max;
}

/**
 * Resolves source function node at a given line number in a TypeScript source file.
 *
 * @param sf - Optional parsed TypeScript source file.
 * @param startLine - Target 1-based start line.
 * @returns Found function-like node or null.
 */
export function findSourceFunction(
    sf: ts.SourceFile | null | undefined,
    startLine: number,
): ReturnType<typeof findTsFunctionAtLine> {
    return sf ? findTsFunctionAtLine(sf, startLine) : null;
}

/**
 * Invokes an enricher callback if a matching TypeScript function is found at the given line.
 *
 * @param sf - Parsed source file.
 * @param startLine - 1-based line number of the target function.
 * @param enricher - Callback that attaches AST slices or annotations.
 */
export function attachAstEnrichment(
    sf: ts.SourceFile | null | undefined,
    startLine: number,
    enricher: (
        targetFunction: NonNullable<ReturnType<typeof findTsFunctionAtLine>>,
        source: ts.SourceFile,
    ) => void,
): void {
    const tsFn = findSourceFunction(sf, startLine);
    if (!tsFn || !sf) return;
    enricher(tsFn, sf);
}

/**
 * Computes and attaches optimal function slice boundaries to an issue and its actionable.
 *
 * @param issue - Finding to enrich with function extraction candidates.
 * @param sf - Optional parsed source file.
 * @param startLine - 1-based start line of the function.
 */
export function attachFunctionLengthSlices(
    issue: Issue,
    sf: ts.SourceFile | null | undefined,
    startLine: number,
): void {
    attachAstEnrichment(sf, startLine, (targetFunction, source) => {
        const slices = computeFunctionSlices(targetFunction, source);
        const best = slices ? (slices.recommendedSlice ?? slices[0]) : null;
        if (!best) return;

        issue.detail = {
            ...issue.detail,
            sliceRange: best.sliceRange,
            extractSignature: best.extractSignature,
        };
        if (issue.actionable) {
            issue.actionable.templateSnippet = best.templateSnippet;
            (issue.actionable as unknown as Record<string, unknown>).detail = {
                sliceRange: best.sliceRange,
                extractSignature: best.extractSignature,
                readVariables: best.readVariables,
                writtenVariables: best.writtenVariables,
                crossSliceDependencies: best.crossSliceDependencyCount,
            };
            issue.actionable.targetArguments = {
                sliceRange: best.sliceRange,
                extractSignature: best.extractSignature,
            };
        }
    });
}

/**
 * Computes and attaches guard clause condition inversion snippet to an issue and its actionable.
 *
 * @param issue - Finding to enrich with inverted condition snippet.
 * @param sf - Optional parsed source file.
 * @param startLine - 1-based start line of the target control flow.
 */
export function attachGuardClauseInversion(
    issue: Issue,
    sf: ts.SourceFile | null | undefined,
    startLine: number,
): void {
    attachAstEnrichment(sf, startLine, (targetFunction, source) => {
        const invertedSnippet = generateInvertedConditionSnippet(targetFunction, source);
        if (!invertedSnippet) return;

        if (issue.actionable) {
            issue.actionable.templateSnippet = invertedSnippet;
            (issue.actionable as unknown as Record<string, unknown>).invertedConditionSnippet =
                invertedSnippet;
            (issue.actionable as unknown as Record<string, unknown>).detail = {
                invertedConditionSnippet: invertedSnippet,
            };
        }
        issue.detail = {
            ...issue.detail,
            invertedConditionSnippet: invertedSnippet,
        };
    });
}
