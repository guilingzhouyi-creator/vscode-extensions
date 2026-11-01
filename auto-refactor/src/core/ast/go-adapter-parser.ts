/**
 * Module: Core Engine — Go Language Adapter
 * File Path: src/core/ast/go-adapter-parser.ts
 * Architecture Role: LanguageAdapter implementation mapping Go (.go) source files into
 *   normalized AST (NormalizedNode) for multi-language analyzer traversal.
 * Dependencies & Triggers: multilang contracts (NodeKind, NormalizedNode, NormalizedAst,
 *   LanguageAdapter); routed by adapters.ts when a .go file is scanned.
 * Responsibilities: Parse package, import, struct, interface, func, methods, control flow,
 *   variables, constants, and literal declarations into NormalizedNode hierarchy.
 * Exit Semantics & Design Rationale: Synchronous and total for any input; empty or malformed
 *   text yields a SourceFile root so one bad Go file never aborts a scan. Dependency-free
 *   inductive parser ensures high-throughput scanning without requiring cgo or external tools.
 *   Uses line-level regex scanning (no tree-sitter dependency) to provide robust metrics
 *   collection including function count, complexity, literal detection, and nesting depth.
 */

import type { NormalizedNode } from './multilang';
import { NodeKind } from './multilang';
import { REGEX } from '../constants';

const MIN_SIGNIFICANT_STRING_LENGTH = 3;
const KEYWORD_STRUCT = 'struct';
const BLOCK_COMMENT_START = '/*';
const BLOCK_COMMENT_END = '*/';
const LINE_COMMENT_PREFIX = '//';
const EMPTY_NUMERIC_POSITION_SET: ReadonlySet<number> = Object.freeze(new Set<number>());

const CALL_KEYWORD_EXCLUSIONS = new Set([
    'if',
    'for',
    'switch',
    'select',
    'func',
    'return',
    'go',
    'defer',
    'case',
    'type',
    'var',
    'const',
    'package',
    'import',
    'range',
    'make',
    'new',
    'len',
    'cap',
    'append',
    'copy',
    'delete',
    'close',
    'panic',
    'recover',
]);

/** Struct field: `Name Type` inside a struct (detected by indentation context) */
const STRUCT_FIELD_RE = /^\s+([A-Za-z_][A-Za-z0-9_]*)\s+[A-Za-z_*]/;

/** Block start / end — brace tracking */
const OPEN_BRACE = '{';
const CLOSE_BRACE = '}';

/** Import declaration: `import "foo"` or `import ( ... )` */
const IMPORT_DECL_RE = /^import\s+/;

// --- Tolerated context detection ---

/** Contexts where numeric literals are tolerated (index access, array lengths). */
export const NUMERIC_TOLERATED_PARENTS = new Set(['index_expression', 'array_type', 'slice_type']);

/** Contexts where string literals are tolerated (import paths, tags). */
export const STRING_TOLERATED_PARENTS = new Set(['import_spec', 'struct_tag']);

/**
 * Parse struct or interface type definitions: `type Foo struct` or `type Bar interface`.
 *
 * @param trimmed - Trimmed current line.
 * @param line - Raw current line (for column computation).
 * @param lineNum - 1-based line number.
 * @returns NormalizedNode for the type, or null if not a type declaration.
 */
function parseTypeDeclaration(
    trimmed: string,
    line: string,
    lineNum: number,
): NormalizedNode | null {
    const match = REGEX.SYNTAX.GO_TYPE_DEF.exec(trimmed);
    if (!match) return null;
    const typeName = match[1];
    const isStruct = match[2] === KEYWORD_STRUCT;
    return {
        kind: isStruct ? NodeKind.Struct : NodeKind.Interface,
        name: typeName,
        isClassDefining: true,
        topLevel: true,
        exported: /^[A-Z]/.test(typeName),
        start: { line: lineNum, column: line.indexOf(typeName) + 1 },
        end: { line: lineNum, column: line.length + 1 },
        children: [],
    };
}

function findGoCloseParen(trimmed: string, openIdx: number): number {
    let depth = 1;
    for (let i = openIdx + 1; i < trimmed.length; i++) {
        const charStr = trimmed[i];
        if (charStr === '(' || charStr === '[' || charStr === '{') depth++;
        else if (charStr === ')' || charStr === ']' || charStr === '}') {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

function splitGoParamSegments(paramStr: string): string[] {
    const segments: string[] = [];
    let currentSegment = '';
    let pDepth = 0;
    for (let i = 0; i < paramStr.length; i++) {
        const charStr = paramStr[i];
        if (charStr === '(' || charStr === '[' || charStr === '{') {
            pDepth++;
            currentSegment += charStr;
        } else if (charStr === ')' || charStr === ']' || charStr === '}') {
            pDepth--;
            currentSegment += charStr;
        } else if (charStr === ',' && pDepth === 0) {
            segments.push(currentSegment.trim());
            currentSegment = '';
        } else {
            currentSegment += charStr;
        }
    }
    if (currentSegment.trim()) segments.push(currentSegment.trim());
    return segments;
}

function extractGoParams(trimmed: string, openIdx: number): string[] {
    const closeIdx = findGoCloseParen(trimmed, openIdx);
    if (closeIdx === -1) return [];
    const paramStr = trimmed.slice(openIdx + 1, closeIdx).trim();
    if (!paramStr) return [];

    const segments = splitGoParamSegments(paramStr);
    const names: string[] = [];
    for (const seg of segments) {
        const idMatch = seg.match(/^([A-Za-z_][A-Za-z0-9_]*)/);
        if (idMatch) names.push(idMatch[1]);
    }
    return names;
}

/**
 * Parse function or method declaration: `func Foo(...)` or `func (r *R) Method(...)`.
 *
 * @param trimmed - Trimmed current line.
 * @param line - Raw current line (for column computation).
 * @param lineNum - 1-based line number.
 * @returns NormalizedNode for the function/method, or null.
 */
function parseFuncOrMethod(trimmed: string, line: string, lineNum: number): NormalizedNode | null {
    const methodMatch = REGEX.SYNTAX.GO_METHOD_DECL.exec(trimmed);
    if (methodMatch) {
        const methodName = methodMatch[1];
        const openIdx = methodMatch.index + methodMatch[0].length - 1;
        const params = extractGoParams(trimmed, openIdx);
        return {
            kind: NodeKind.Method,
            name: methodName,
            functionLike: true,
            parameters: params,
            introducesBinding: true,
            bindingName: methodName,
            topLevel: true,
            exported: /^[A-Z]/.test(methodName),
            start: { line: lineNum, column: line.indexOf(methodName) + 1 },
            end: { line: lineNum, column: line.length + 1 },
            children: [],
        };
    }
    const funcMatch = REGEX.SYNTAX.GO_FUNC_DECL.exec(trimmed);
    if (funcMatch) {
        const funcName = funcMatch[1];
        const openIdx = funcMatch.index + funcMatch[0].length - 1;
        const params = extractGoParams(trimmed, openIdx);
        return {
            kind: NodeKind.Function,
            name: funcName,
            functionLike: true,
            parameters: params,
            introducesBinding: true,
            bindingName: funcName,
            topLevel: true,
            exported: /^[A-Z]/.test(funcName),
            start: { line: lineNum, column: line.indexOf(funcName) + 1 },
            end: { line: lineNum, column: line.length + 1 },
            children: [],
        };
    }
    return null;
}

/**
 * Parse `var` declarations.
 *
 * @param trimmed - Trimmed current line.
 * @param line - Raw current line.
 * @param lineNum - 1-based line number.
 * @returns NormalizedNode for the variable, or null.
 */
function parseVarDeclaration(
    trimmed: string,
    line: string,
    lineNum: number,
): NormalizedNode | null {
    const match = REGEX.SYNTAX.GO_VAR_DECL.exec(trimmed);
    if (!match) return null;
    const varName = match[1];
    return {
        kind: NodeKind.Variable,
        name: varName,
        introducesBinding: true,
        bindingName: varName,
        topLevel: true,
        exported: /^[A-Z]/.test(varName),
        start: { line: lineNum, column: line.indexOf(varName) + 1 },
        end: { line: lineNum, column: line.length + 1 },
        children: [],
    };
}

/**
 * Parse `const` declarations.
 *
 * @param trimmed - Trimmed current line.
 * @param line - Raw current line.
 * @param lineNum - 1-based line number.
 * @returns NormalizedNode for the constant, or null.
 */
function parseConstDeclaration(
    trimmed: string,
    line: string,
    lineNum: number,
): NormalizedNode | null {
    const match = REGEX.SYNTAX.GO_CONST_DECL.exec(trimmed);
    if (!match) return null;
    const constName = match[1];
    return {
        kind: NodeKind.Constant,
        name: constName,
        introducesBinding: true,
        bindingName: constName,
        isConstBound: true,
        topLevel: true,
        exported: /^[A-Z]/.test(constName),
        start: { line: lineNum, column: line.indexOf(constName) + 1 },
        end: { line: lineNum, column: line.length + 1 },
        children: [],
    };
}

/**
 * Parse entries inside `const ( ... )` or `var ( ... )` blocks.
 *
 * @param trimmed - Trimmed current line.
 * @param line - Raw current line.
 * @param lineNum - 1-based line number.
 * @param isConst - True for const block, false for var block.
 * @returns NormalizedNode for the entry, or null.
 */
function parseBlockEntry(
    trimmed: string,
    line: string,
    lineNum: number,
    isConst: boolean,
): NormalizedNode | null {
    // Skip closing paren and blank lines
    if (trimmed === ')' || trimmed === '') return null;
    // Skip comment lines
    if (trimmed.startsWith('//')) return null;

    const match = REGEX.SYNTAX.GO_BLOCK_ENTRY.exec(trimmed);
    if (!match) return null;
    const name = match[1];
    // Skip if it looks like a keyword or type name (heuristic: skip all-lowercase words
    // that are common type names like "type", "struct", etc.)
    if (/^(type|struct|interface|func|map|chan)$/.test(name)) return null;

    return {
        kind: isConst ? NodeKind.Constant : NodeKind.Variable,
        name,
        introducesBinding: true,
        bindingName: name,
        isConstBound: isConst,
        topLevel: true,
        exported: /^[A-Z]/.test(name),
        start: { line: lineNum, column: line.indexOf(name) + 1 },
        end: { line: lineNum, column: line.length + 1 },
        children: [],
    };
}

/**
 * Parse control flow statements (if/for/switch/select).
 *
 * @param trimmed - Trimmed current line.
 * @param line - Raw current line.
 * @param lineNum - 1-based line number.
 * @returns NormalizedNode for control flow, or null.
 */
function parseControlFlow(trimmed: string, line: string, lineNum: number): NormalizedNode | null {
    if (!REGEX.SYNTAX.GO_CONTROL_FLOW.test(trimmed)) return null;
    return {
        kind: NodeKind.ControlFlow,
        branchWeight: 1,
        increasesNesting: true,
        start: { line: lineNum, column: 1 },
        end: { line: lineNum, column: line.length + 1 },
        children: [],
    };
}

/**
 * Parse `case` / `default` labels inside switch/select (add branch weight).
 *
 * @param trimmed - Trimmed current line.
 * @param line - Raw current line.
 * @param lineNum - 1-based line number.
 * @param inSwitchSelect - Whether we are inside a switch/select block.
 * @returns NormalizedNode for the case label, or null.
 */
function parseCaseLabel(
    trimmed: string,
    line: string,
    lineNum: number,
    inSwitchSelect: boolean,
): NormalizedNode | null {
    if (!inSwitchSelect) return null;
    if (!REGEX.SYNTAX.GO_CASE_LABEL.test(trimmed)) return null;
    return {
        kind: NodeKind.ControlFlow,
        branchWeight: 1,
        start: { line: lineNum, column: 1 },
        end: { line: lineNum, column: line.length + 1 },
        children: [],
    };
}

/**
 * Parse simple statement nodes: go, defer, return.
 *
 * @param trimmed - Trimmed current line.
 * @param line - Raw current line.
 * @param lineNum - 1-based line number.
 * @returns NormalizedNode of kind Other, or null.
 */
function parseSimpleStatement(
    trimmed: string,
    line: string,
    lineNum: number,
): NormalizedNode | null {
    if (
        REGEX.SYNTAX.GO_STMT.test(trimmed) ||
        REGEX.SYNTAX.GO_DEFER_STMT.test(trimmed) ||
        REGEX.SYNTAX.GO_RETURN_STMT.test(trimmed)
    ) {
        return {
            kind: NodeKind.Other,
            start: { line: lineNum, column: 1 },
            end: { line: lineNum, column: line.length + 1 },
            children: [],
        };
    }
    return null;
}

/**
 * Detect numeric literals (integers and floats) on a line.
 *
 * @param codeOnly - Line with comments and strings stripped.
 * @param line - Raw current line.
 * @param lineNum - 1-based line number.
 * @param out - Output array to append nodes to.
 */
/**
 * Build an index lookup set of character positions occupied by float literals.
 *
 * @param floatMatches - Array of RegExp match objects for float literals on the line.
 * @returns Immutable ReadonlySet of 0-based character indices covered by float literals.
 */
function collectFloatOccupiedPositions(floatMatches: RegExpMatchArray[]): ReadonlySet<number> {
    if (floatMatches.length === 0) return EMPTY_NUMERIC_POSITION_SET;
    const occupied = new Set<number>();
    for (const floatMatch of floatMatches) {
        const start = floatMatch.index ?? 0;
        const end = start + (floatMatch[0]?.length ?? 0);
        for (let pos = start; pos < end; pos++) occupied.add(pos);
    }
    return occupied;
}

function parseNumericLiterals(
    codeOnly: string,
    line: string,
    lineNum: number,
    out: NormalizedNode[],
): void {
    // Find float literals first to avoid partial matches with int regex
    const floatMatches = [...codeOnly.matchAll(REGEX.SYNTAX.createFloatLiteralScanner())];
    for (const matchItem of floatMatches) {
        const idx = matchItem.index ?? 0;
        out.push({
            kind: NodeKind.NumericLiteral,
            text: matchItem[0],
            isNumeric: true,
            tolerated: false,
            start: { line: lineNum, column: idx + 1 },
            end: { line: lineNum, column: idx + matchItem[0].length + 1 },
        });
    }

    // Integer literals — skip positions that overlap with float matches
    const coveredPositions = collectFloatOccupiedPositions(floatMatches);
    const intMatches = [...codeOnly.matchAll(REGEX.SYNTAX.createIntLiteralScanner())];
    for (const matchItem of intMatches) {
        const idx = matchItem.index ?? 0;
        // Skip if this int overlaps with a float match
        if (coveredPositions.has(idx)) {
            continue;
        }
        out.push({
            kind: NodeKind.NumericLiteral,
            text: matchItem[0],
            isNumeric: true,
            tolerated: false,
            start: { line: lineNum, column: idx + 1 },
            end: { line: lineNum, column: idx + matchItem[0].length + 1 },
        });
    }
}

/**
 * Compute the 0-based column offset of a trimmed code segment within its raw source line.
 *
 * @param rawLine - Raw un-trimmed source line.
 * @param segment - Trimmed code segment to locate.
 * @returns 0-based starting character offset.
 */
function computeSegmentOffset(rawLine: string, segment: string): number {
    const directIdx = rawLine.indexOf(segment);
    if (directIdx >= 0) {
        return directIdx;
    }
    let lead = 0;
    while (lead < rawLine.length && (rawLine[lead] === ' ' || rawLine[lead] === '\t')) {
        lead++;
    }
    return lead;
}

interface StringLiteralScanOptions {
    trimmed: string;
    line: string;
    lineNum: number;
    out: NormalizedNode[];
    inImport: boolean;
}

/**
 * Detect string literals on a line.
 */
function parseStringLiterals(options: StringLiteralScanOptions): void {
    const { trimmed, line, lineNum, out, inImport } = options;
    const baseOffset = computeSegmentOffset(line, trimmed);
    const scanner = REGEX.SYNTAX.createStringLiteralScanner();
    let match: RegExpExecArray | null;
    while ((match = scanner.exec(trimmed)) !== null) {
        const rawVal = match[2];
        const colOffset = baseOffset + (match.index ?? 0);
        out.push({
            kind: NodeKind.StringLiteral,
            text: rawVal,
            isString: true,
            tolerated: inImport || rawVal.length < MIN_SIGNIFICANT_STRING_LENGTH,
            start: { line: lineNum, column: colOffset + 1 },
            end: { line: lineNum, column: colOffset + match[0].length },
        });
    }
}

/**
 * Detect named literals (true, false, nil, iota) on a line.
 *
 * @param codeOnly - Line with comments and strings stripped.
 * @param line - Raw current line.
 * @param lineNum - 1-based line number.
 * @param out - Output array to append nodes to.
 */
function parseNamedLiterals(
    codeOnly: string,
    line: string,
    lineNum: number,
    out: NormalizedNode[],
): void {
    const scanner = REGEX.SYNTAX.createGoNamedLiteralScanner();
    let match: RegExpExecArray | null;
    while ((match = scanner.exec(codeOnly)) !== null) {
        const idx = match.index ?? 0;
        out.push({
            kind: NodeKind.Literal,
            text: match[0],
            start: { line: lineNum, column: idx + 1 },
            end: { line: lineNum, column: idx + match[0].length + 1 },
        });
    }
}

/**
 * Detect call expressions on a line (heuristic: identifier followed by `(`).
 *
 * @param codeOnly - Line with comments and strings stripped.
 * @param line - Raw current line.
 * @param lineNum - 1-based line number.
 * @param out - Output array to append nodes to.
 */
function parseCallExpressions(
    codeOnly: string,
    line: string,
    lineNum: number,
    out: NormalizedNode[],
): void {
    const scanner = REGEX.SYNTAX.createGoCallExprScanner();
    let match: RegExpExecArray | null;
    while ((match = scanner.exec(codeOnly)) !== null) {
        const callName = match[1];
        // Skip Go keywords and built-in functions
        if (CALL_KEYWORD_EXCLUSIONS.has(callName)) continue;
        const idx = match.index ?? 0;
        out.push({
            kind: NodeKind.Call,
            name: callName,
            start: { line: lineNum, column: idx + 1 },
            end: { line: lineNum, column: idx + callName.length + 1 },
        });
    }
}

/**
 * Count open/close braces to detect block boundaries.
 *
 * @param codeOnly - Line with comments and strings stripped.
 * @returns Number of open braces minus close braces (net nesting change).
 */
function braceDelta(codeOnly: string): number {
    let opens = 0;
    let closes = 0;
    for (const charStr of codeOnly) {
        if (charStr === OPEN_BRACE) opens++;
        else if (charStr === CLOSE_BRACE) closes++;
    }
    return opens - closes;
}

/**
 * Strip line comments from a line and return the code-only portion.
 * Does NOT handle block comments (handled separately by state machine).
 *
 * @param trimmed - Trimmed line.
 * @returns Line with any `//` comment removed.
 */
function stripLineComment(trimmed: string): string {
    const idx = trimmed.indexOf(LINE_COMMENT_PREFIX);
    return idx === -1 ? trimmed : trimmed.slice(0, idx).trim();
}

/**
 * State machine context for multi-line constructs (block comments, struct bodies, etc.).
 */
export interface ParseContext {
    /** Inside a `/* ... *‍/` block comment. */
    inBlockComment: boolean;
    /** Current brace nesting depth (0 = top level). */
    braceDepth: number;
    /** Whether we are currently inside a struct type body. */
    inStruct: boolean;
    /** Whether we are inside an import block. */
    inImport: boolean;
    /** Whether we are inside a switch or select block. */
    inSwitchSelect: boolean;
    /** Whether we are inside a `const ( ... )` block. */
    inConstBlock: boolean;
    /** Whether we are inside a `var ( ... )` block. */
    inVarBlock: boolean;
    /** Stack of brace-entry kinds for proper pop behavior. */
    braceStack: Array<{
        depth: number;
        kind: 'struct' | 'switch' | 'select' | 'func' | 'const' | 'var' | 'other';
    }>;
}

interface GoLineContext {
    codeOnly: string;
    rawLine: string;
    lineNum: number;
    ctx: ParseContext;
    children: NormalizedNode[];
}

/**
 * Update brace depth, create Block nodes for open braces, and pop context stack
 * when closing braces. Called from every code path that contains braces so the
 * nesting state stays consistent regardless of statement type.
 */
function trackBraceDelta(lineCtx: GoLineContext): void {
    const { codeOnly, rawLine, lineNum, ctx, children } = lineCtx;
    const delta = braceDelta(codeOnly);
    if (delta === 0) return;
    // Push block nodes for each open brace
    for (let i = 0; i < Math.max(0, delta); i++) {
        children.push({
            kind: NodeKind.Block,
            increasesNesting: true,
            start: { line: lineNum, column: 1 },
            end: { line: lineNum, column: rawLine.length + 1 },
            children: [],
        });
    }
    ctx.braceDepth += delta;

    // Pop context stack when closing braces
    while (
        ctx.braceStack.length > 0 &&
        ctx.braceDepth <= ctx.braceStack[ctx.braceStack.length - 1].depth
    ) {
        const popped = ctx.braceStack.pop();
        if (popped?.kind === 'struct') ctx.inStruct = false;
        if (popped?.kind === 'switch' || popped?.kind === 'select') {
            ctx.inSwitchSelect = false;
        }
    }
}

/**
 * Handle block-comment and line-comment state for a single line.
 *
 * @param trimmed - Trimmed source line.
 * @param ctx - Parse context (mutated in place).
 * @returns True when the line is entirely a comment (caller should skip further processing).
 */
function handleCommentLine(trimmed: string, ctx: ParseContext): boolean {
    if (ctx.inBlockComment) {
        if (trimmed.includes(BLOCK_COMMENT_END)) {
            ctx.inBlockComment = false;
        }
        return true;
    }
    if (trimmed.startsWith(BLOCK_COMMENT_START)) {
        if (!trimmed.includes(BLOCK_COMMENT_END)) {
            ctx.inBlockComment = true;
        }
        return true;
    }
    return trimmed.startsWith(LINE_COMMENT_PREFIX);
}

/**
 * Handle top-level package and import declarations, tracking multi-line import blocks.
 *
 * @param codeOnly - Line with line comment stripped.
 * @param wasTopLevel - Whether the line is at top-level block scope.
 * @param ctx - Parse context (mutated in place).
 * @returns True when the line is a declaration (caller should skip further processing).
 */
function handlePackageAndImport(
    codeOnly: string,
    wasTopLevel: boolean,
    ctx: ParseContext,
): boolean {
    if (wasTopLevel && REGEX.SYNTAX.GO_PACKAGE.test(codeOnly)) return true;
    if (wasTopLevel && IMPORT_DECL_RE.test(codeOnly)) {
        if (codeOnly.includes('(')) ctx.inImport = true;
        return true;
    }
    if (ctx.inImport && codeOnly.startsWith(')')) {
        ctx.inImport = false;
        return true;
    }
    return false;
}

function handleTypeOrFunc(lineCtx: GoLineContext): boolean {
    const { codeOnly, rawLine, lineNum, ctx, children } = lineCtx;
    const typeNode = parseTypeDeclaration(codeOnly, rawLine, lineNum);
    if (typeNode) {
        children.push(typeNode);
        if (typeNode.kind === NodeKind.Struct && codeOnly.includes(OPEN_BRACE)) {
            ctx.inStruct = true;
            ctx.braceStack.push({ depth: ctx.braceDepth, kind: 'struct' });
        }
        trackBraceDelta(lineCtx);
        return true;
    }
    const funcNode = parseFuncOrMethod(codeOnly, rawLine, lineNum);
    if (funcNode) {
        children.push(funcNode);
        if (codeOnly.includes(OPEN_BRACE)) {
            ctx.braceStack.push({ depth: ctx.braceDepth, kind: 'func' });
        }
        trackBraceDelta(lineCtx);
        return true;
    }
    return false;
}

function handleVarOrConst(lineCtx: GoLineContext, wasTopLevel: boolean): boolean {
    const { codeOnly, rawLine, lineNum, ctx, children } = lineCtx;
    if (wasTopLevel && REGEX.SYNTAX.GO_VAR_BLOCK_START.test(codeOnly)) {
        ctx.inVarBlock = true;
        return true;
    }
    const varNode = parseVarDeclaration(codeOnly, rawLine, lineNum);
    if (varNode) {
        varNode.topLevel = wasTopLevel;
        children.push(varNode);
        trackBraceDelta(lineCtx);
        return true;
    }
    if (wasTopLevel && REGEX.SYNTAX.GO_CONST_BLOCK_START.test(codeOnly)) {
        ctx.inConstBlock = true;
        return true;
    }
    const constNode = parseConstDeclaration(codeOnly, rawLine, lineNum);
    if (constNode) {
        constNode.topLevel = wasTopLevel;
        children.push(constNode);
        trackBraceDelta(lineCtx);
        return true;
    }
    return false;
}

function handleBlockEntries(lineCtx: GoLineContext): boolean {
    const { codeOnly, rawLine, lineNum, ctx, children } = lineCtx;
    if (!ctx.inConstBlock && !ctx.inVarBlock) return false;
    if (codeOnly === ')') {
        ctx.inConstBlock = false;
        ctx.inVarBlock = false;
        return true;
    }
    const entryNode = parseBlockEntry(codeOnly, rawLine, lineNum, ctx.inConstBlock);
    if (entryNode) children.push(entryNode);
    return true;
}

function handleDeclarationLine(lineCtx: GoLineContext): boolean {
    const wasTopLevel = lineCtx.ctx.braceDepth === 0;
    return (
        handlePackageAndImport(lineCtx.codeOnly, wasTopLevel, lineCtx.ctx) ||
        handleTypeOrFunc(lineCtx) ||
        handleVarOrConst(lineCtx, wasTopLevel) ||
        handleBlockEntries(lineCtx)
    );
}

/**
 * Handle control-flow statements: if/for/switch/select and case/default labels.
 */
function handleControlFlowLine(lineCtx: GoLineContext): boolean {
    const { codeOnly, rawLine, lineNum, ctx, children } = lineCtx;
    const cfNode = parseControlFlow(codeOnly, rawLine, lineNum);
    if (!cfNode) return false;

    children.push(cfNode);
    const cfMatch = /^\s*(switch|select)\b/.exec(codeOnly);
    if (cfMatch && codeOnly.includes(OPEN_BRACE)) {
        ctx.inSwitchSelect = true;
        ctx.braceStack.push({
            depth: ctx.braceDepth,
            kind: cfMatch[1] as 'switch' | 'select',
        });
    }
    trackBraceDelta(lineCtx);
    parseCallExpressions(codeOnly, rawLine, lineNum, children);
    parseNumericLiterals(codeOnly, rawLine, lineNum, children);
    parseNamedLiterals(codeOnly, rawLine, lineNum, children);
    return true;
}

/**
 * Process a single line of Go source code, emitting detected nodes into children array.
 * Updates the parse context for multi-line constructs.
 *
 * @param rawLine - Raw source line.
 * @param lineNum - 1-based line number.
 * @param ctx - Parse context (mutated in place).
 * @param children - Output array to append nodes to.
 */
export function processGoLine(
    rawLine: string,
    lineNum: number,
    ctx: ParseContext,
    children: NormalizedNode[],
): void {
    const trimmed = rawLine.trim();
    if (!trimmed) return;

    // Comments: check and consume comment lines (no further processing if comment)
    if (handleCommentLine(trimmed, ctx)) return;

    const codeOnly = stripLineComment(trimmed);
    if (!codeOnly) return;

    const lineCtx: GoLineContext = { codeOnly, rawLine, lineNum, ctx, children };

    // Declarations: top-level declarations (package, import, type, func, var, const)
    if (handleDeclarationLine(lineCtx)) return;

    // Control flow: branch and loop constructs (if/for/switch/select)
    if (handleControlFlowLine(lineCtx)) return;

    // Statements: case labels, simple statements, and struct field definitions
    const caseNode = parseCaseLabel(codeOnly, rawLine, lineNum, ctx.inSwitchSelect);
    if (caseNode) children.push(caseNode);

    const stmtNode = parseSimpleStatement(codeOnly, rawLine, lineNum);
    if (stmtNode) children.push(stmtNode);

    // Struct fields (inside struct body, indented lines)
    const wasTopLevel = ctx.braceDepth === 0;
    if (ctx.inStruct && !wasTopLevel) {
        const fieldMatch = STRUCT_FIELD_RE.exec(rawLine);
        if (fieldMatch && !/^\s*\}/.test(rawLine)) {
            const fieldName = fieldMatch[1];
            children.push({
                kind: NodeKind.Field,
                name: fieldName,
                exported: /^[A-Z]/.test(fieldName),
                start: { line: lineNum, column: rawLine.indexOf(fieldName) + 1 },
                end: { line: lineNum, column: rawLine.length + 1 },
            });
        }
    }

    // Literals and calls: string/numeric/named literals and function invocations
    parseStringLiterals({
        trimmed: codeOnly,
        line: rawLine,
        lineNum,
        out: children,
        inImport: ctx.inImport,
    });
    parseNumericLiterals(codeOnly, rawLine, lineNum, children);
    parseNamedLiterals(codeOnly, rawLine, lineNum, children);
    parseCallExpressions(codeOnly, rawLine, lineNum, children);

    // Block nesting: brace depth tracking and block boundary management
    trackBraceDelta(lineCtx);
}

/**
 * GoAdapter — Lightweight, dependency-free language adapter for Go source files (.go).
 *
 * Maps packages, imports, struct/interface types, functions/methods, variables,
 * constants, control flow, fields, calls, and string/numeric/named literals to
 * uniform NormalizedNodes. Uses line-level regex scanning for high-throughput
 * metrics collection without requiring native tree-sitter bindings.
 *
 * Capabilities:
 * - Function/method detection with exported flag and binding info
 * - Struct/interface type detection with class-defining flag
 * - var/const declaration detection with binding info
 * - Control flow (if/for/switch/select) with branch weight and nesting
 * - Case/default labels with branch weight
 * - Struct field detection
 * - Call expression detection (heuristic)
 * - String, numeric (int/float), and named literal detection
 * - Block/nesting depth tracking via brace counting
 */
