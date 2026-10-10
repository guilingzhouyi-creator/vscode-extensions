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

function capitalize(s: string): string {
    if (!s) return 'Helper';
    return s.charAt(0).toUpperCase() + s.slice(1);
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
    if (isDeclarationName(parent, id)) return false;
    if (isAssignmentTarget(parent, id)) return false;
    return true;
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

    function visit(n: ts.Node): void {
        if (ts.isTypeNode(n)) return;
        if (ts.isVariableDeclaration(n)) {
            collectBindingIdentifiers(n.name, writes);
        } else if (ts.isBinaryExpression(n) && isAssignmentOperator(n.operatorToken.kind)) {
            if (ts.isIdentifier(n.left)) {
                writes.add(n.left.text);
                if (n.operatorToken.kind !== ts.SyntaxKind.EqualsToken) {
                    reads.add(n.left.text);
                }
            }
        } else if (ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) {
            collectUnaryWrites(n, writes, reads);
        } else if (ts.isIdentifier(n) && isIdentifierRead(n)) {
            reads.add(n.text);
        }
        ts.forEachChild(n, visit);
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
    const paramList = inputs.map((v) => `${v}: any`).join(', ');
    let returnType = 'void';
    let returnStmt = '';
    let callSite = `${helperName}(${inputs.join(', ')});`;

    if (outputs.length === 1) {
        returnType = 'any';
        returnStmt = `    return ${outputs[0]};`;
        callSite = `const ${outputs[0]} = ${helperName}(${inputs.join(', ')});`;
    } else if (outputs.length > 1) {
        returnType = `{ ${outputs.map((v) => `${v}: any`).join(', ')} }`;
        returnStmt = `    return { ${outputs.join(', ')} };`;
        callSite = `const { ${outputs.join(', ')} } = ${helperName}(${inputs.join(', ')});`;
    }

    const signature = `function ${helperName}(${paramList}): ${returnType}`;
    const template = [
        `// Extracted helper:`,
        `${signature} {`,
        `    // ... extracted slice statements`,
        returnStmt,
        `}`,
        ``,
        `// Call site:`,
        callSite,
    ]
        .filter(Boolean)
        .join('\n');

    return { signature, template };
}

function resolveWritesBefore(
    i: number,
    stmtInfos: StatementVariableInfo[],
    prefixWrites?: Set<string>[],
): Set<string> {
    if (prefixWrites) return prefixWrites[i];
    const writesBefore = new Set<string>();
    for (let k = 0; k < i; k++) {
        for (const w of stmtInfos[k].writes) writesBefore.add(w);
    }
    return writesBefore;
}

function resolveReadsAfter(
    j: number,
    statementsLen: number,
    stmtInfos: StatementVariableInfo[],
    suffixReads?: Set<string>[],
): Set<string> {
    if (suffixReads) return suffixReads[j + 1];
    const readsAfter = new Set<string>();
    for (let k = j + 1; k < statementsLen; k++) {
        for (const r of stmtInfos[k].reads) readsAfter.add(r);
    }
    return readsAfter;
}

function resolveLineSpan(
    i: number,
    j: number,
    statements: readonly ts.Statement[],
    sf: ts.SourceFile,
    stmtStartLines?: Int32Array,
    stmtEndLines?: Int32Array,
): FunctionSliceRange {
    if (stmtStartLines && stmtEndLines) {
        return { startLine: stmtStartLines[i], endLine: stmtEndLines[j] };
    }
    const startPos = sf.getLineAndCharacterOfPosition(statements[i].getStart(sf));
    const endPos = sf.getLineAndCharacterOfPosition(statements[j].getEnd());
    return { startLine: startPos.line + 1, endLine: endPos.line + 1 };
}

function isSliceInputVariable(
    variable: string,
    paramNames: ReadonlySet<string>,
    writesBefore: ReadonlySet<string>,
    sliceWrites: ReadonlySet<string>,
): boolean {
    if (JS_GLOBALS.has(variable)) return false;
    if (paramNames.has(variable)) return true;
    if (writesBefore.has(variable)) return true;
    return !sliceWrites.has(variable);
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
    i: number,
    j: number,
    stmtInfos: StatementVariableInfo[],
    outReads: Set<string>,
    outWrites: Set<string>,
): void {
    for (let k = i; k <= j; k++) {
        for (const r of stmtInfos[k].reads) outReads.add(r);
        for (const w of stmtInfos[k].writes) outWrites.add(w);
    }
}

function evaluateSliceRange(
    statements: readonly ts.Statement[],
    i: number,
    j: number,
    sf: ts.SourceFile,
    paramNames: Set<string>,
    stmtInfos: StatementVariableInfo[],
    helperName: string,
    prefixWrites?: Set<string>[],
    suffixReads?: Set<string>[],
    stmtStartLines?: Int32Array,
    stmtEndLines?: Int32Array,
    scratchReads?: Set<string>,
    scratchWrites?: Set<string>,
): FunctionSliceCandidate {
    const sliceReads = scratchReads ?? new Set<string>();
    const sliceWrites = scratchWrites ?? new Set<string>();
    sliceReads.clear();
    sliceWrites.clear();

    populateSliceVariables(i, j, stmtInfos, sliceReads, sliceWrites);

    const writesBefore = resolveWritesBefore(i, stmtInfos, prefixWrites);
    const readsAfter = resolveReadsAfter(j, statements.length, stmtInfos, suffixReads);

    const inputVars = collectInputVariables(sliceReads, paramNames, writesBefore, sliceWrites);
    const outputVars = collectOutputVariables(sliceWrites, readsAfter);
    const dependencyCount = computeDependencyScore(inputVars.length, outputVars.length);
    const sliceRange = resolveLineSpan(i, j, statements, sf, stmtStartLines, stmtEndLines);
    const { signature, template } = buildExtractSignature(helperName, inputVars, outputVars);

    return {
        sliceRange,
        readVariables: Array.from(sliceReads),
        writtenVariables: Array.from(sliceWrites),
        extractSignature: signature,
        crossSliceDependencyCount: dependencyCount,
        inputVariables: inputVars,
        outputVariables: outputVars,
        templateSnippet: template,
        startIndex: i,
        endIndex: j,
    };
}

function copyAndExtendSet(base: ReadonlySet<string>, additions: ReadonlySet<string>): Set<string> {
    const next = new Set<string>(base);
    for (const item of additions) next.add(item);
    return next;
}

function precomputePrefixWrites(n: number, stmtInfos: StatementVariableInfo[]): Set<string>[] {
    const prefixWrites: Set<string>[] = new Array(n + 1);
    prefixWrites[0] = new Set<string>();
    for (let k = 0; k < n; k++) {
        if (stmtInfos[k].writes.size === 0) {
            prefixWrites[k + 1] = prefixWrites[k];
        } else {
            prefixWrites[k + 1] = copyAndExtendSet(prefixWrites[k], stmtInfos[k].writes);
        }
    }
    return prefixWrites;
}

function precomputeSuffixReads(n: number, stmtInfos: StatementVariableInfo[]): Set<string>[] {
    const suffixReads: Set<string>[] = new Array(n + 1);
    suffixReads[n] = new Set<string>();
    for (let k = n - 1; k >= 0; k--) {
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
    const result = Object.assign([...candidates], {
        sliceRange: recommended ? recommended.sliceRange : undefined,
        extractSignature: recommended ? recommended.extractSignature : undefined,
        readVariables: recommended ? recommended.readVariables : undefined,
        writtenVariables: recommended ? recommended.writtenVariables : undefined,
        candidates,
        recommendedSlice: recommended,
    }) as FunctionSliceAnalysis;
    return result;
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

    const fnName = node.name && ts.isIdentifier(node.name) ? node.name.text : 'Helper';
    const helperName = 'extract' + capitalize(fnName);
    const paramNames = collectFunctionParameterNames(node);
    const stmtInfos = statements.map((s) => collectVariablesInStatement(s));

    const candidates: FunctionSliceCandidate[] = [];
    const n = statements.length;

    // Precompute statement line spans ONCE to eliminate redundant AST position queries in loops
    const stmtStartLines = new Int32Array(n);
    const stmtEndLines = new Int32Array(n);
    for (let k = 0; k < n; k++) {
        stmtStartLines[k] = sf.getLineAndCharacterOfPosition(statements[k].getStart(sf)).line + 1;
        stmtEndLines[k] = sf.getLineAndCharacterOfPosition(statements[k].getEnd()).line + 1;
    }

    const prefixWrites = precomputePrefixWrites(n, stmtInfos);
    const suffixReads = precomputeSuffixReads(n, stmtInfos);
    const scratchReads = new Set<string>();
    const scratchWrites = new Set<string>();

    if (n === 1) {
        candidates.push(
            evaluateSliceRange(
                statements,
                0,
                0,
                sf,
                paramNames,
                stmtInfos,
                helperName,
                prefixWrites,
                suffixReads,
                stmtStartLines,
                stmtEndLines,
                scratchReads,
                scratchWrites,
            ),
        );
        return createSliceAnalysis(candidates);
    }

    const maxLen = Math.min(n - 1, 15);
    for (let len = 2; len <= maxLen; len++) {
        for (let i = 0; i <= n - len; i++) {
            const j = i + len - 1;
            candidates.push(
                evaluateSliceRange(
                    statements,
                    i,
                    j,
                    sf,
                    paramNames,
                    stmtInfos,
                    helperName,
                    prefixWrites,
                    suffixReads,
                    stmtStartLines,
                    stmtEndLines,
                    scratchReads,
                    scratchWrites,
                ),
            );
        }
    }

    if (candidates.length === 0) {
        candidates.push(
            evaluateSliceRange(
                statements,
                0,
                n - 1,
                sf,
                paramNames,
                stmtInfos,
                helperName,
                prefixWrites,
                suffixReads,
                stmtStartLines,
                stmtEndLines,
                scratchReads,
                scratchWrites,
            ),
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
    if (!node.body || !ts.isBlock(node.body)) return 'return;';
    const stmts = node.body.statements;
    for (let i = stmts.length - 1; i >= 0; i--) {
        const s = stmts[i];
        if (ts.isReturnStatement(s)) {
            return s.expression ? `return ${s.expression.getText(sf)};` : 'return;';
        }
    }
    return 'return;';
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
export function generateInvertedConditionSnippet(
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
    const typeName = `${capitalize(functionName)}Options`;
    const propLines = params.map((p) => `    ${p.name}: ${p.type || 'unknown'};`).join('\n');
    const paramNames = params.map((p) => p.name).join(', ');

    return [
        `export interface ${typeName} {`,
        propLines,
        `}`,
        ``,
        `function ${functionName || 'targetFunction'}(options: ${typeName}) {`,
        `    const { ${paramNames} } = options;`,
        `    // ... function body`,
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

    function walk(n: ts.Node): boolean | void {
        if (n.end < minPos || n.pos > maxPos) {
            return;
        }

        if (
            ts.isFunctionDeclaration(n) ||
            ts.isMethodDeclaration(n) ||
            ts.isArrowFunction(n) ||
            ts.isFunctionExpression(n)
        ) {
            const pos = sf.getLineAndCharacterOfPosition(n.getStart(sf));
            const line = pos.line + 1;
            const distance = Math.abs(line - targetLine);
            if (distance < minDistance && distance <= 2) {
                minDistance = distance;
                bestMatch = n;
                if (minDistance === 0) {
                    return true;
                }
            }
        }

        return ts.forEachChild(n, walk);
    }

    walk(sf);
    sfCache.set(targetLine, bestMatch);
    return bestMatch;
}
