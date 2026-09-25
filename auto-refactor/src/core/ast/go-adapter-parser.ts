/**
 * Module: Core Engine — Go Language Adapter
 * File Path: src/core/ast/go-adapter.ts
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

import type { NormalizedNode, NormalizedAst, LanguageAdapter } from './multilang';
import { NodeKind } from './multilang';

const MIN_SIGNIFICANT_STRING_LENGTH = 3;
const KEYWORD_STRUCT = 'struct';
const BLOCK_COMMENT_START = '/*';
const BLOCK_COMMENT_END = '*/';
const LINE_COMMENT_PREFIX = '//';

// --- Regex patterns for Go syntax detection ---

/** `type Foo struct` or `type Bar interface` or `type Baz int` */
const TYPE_DEF_RE = /^type\s+([A-Za-z_][A-Za-z0-9_]*)\s+(struct|interface)\b/;

/** Method declaration: `func (r *Receiver) MethodName(...)` */
const METHOD_DECL_RE = /^func\s+\((?:[^)]+)\)\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:\[[^\]]*\])?\s*\(/;

/** Function declaration: `func FuncName(...)` */
const FUNC_DECL_RE = /^func\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:\[[^\]]*\])?\s*\(/;

/** `var x type` or `var x, y type` or `var x = value` */
const VAR_DECL_RE = /^var\s+(?:\(\s*)?([A-Za-z_][A-Za-z0-9_]*)/;

/** `const x type = value` or `const ( x = 1 )` */
const CONST_DECL_RE = /^const\s+(?:\(\s*)?([A-Za-z_][A-Za-z0-9_]*)/;

/** `const (` — start of a multi-line const block */
const CONST_BLOCK_START_RE = /^const\s*\(/;

/** `var (` — start of a multi-line var block */
const VAR_BLOCK_START_RE = /^var\s*\(/;

/** Identifier at the start of a line inside a const/var block: `Name = value` or `Name type` */
const BLOCK_ENTRY_RE = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:=|\s+[A-Za-z_*])/;

/** Control flow keywords that increase nesting */
const CONTROL_FLOW_RE = /^\s*(if|for|switch|select)\b/;

/** `case` or `default` inside switch/select (adds branch weight) */
const CASE_LABEL_RE = /^\s*(case\b|default:)/;

/** Go statement: `go func()` */
const GO_STMT_RE = /^\s*go\s+/;

/** Defer statement: `defer foo()` */
const DEFER_STMT_RE = /^\s*defer\s+/;

/** Return statement: `return x, y` */
const RETURN_STMT_RE = /^\s*return\b/;

/** String literal: double-quoted or backtick-quoted */
const STRING_LITERAL_RE = /(["`])((?:\\.|(?!\1).)*)\1/g;

/** Integer literal: decimal, hex (0x), octal (0o), binary (0b), with optional underscores */
const INT_LITERAL_RE = /\b(?:0[xX][0-9a-fA-F_]+|0[oO][0-7_]+|0[bB][01_]+|[1-9][0-9_]*|0)\b/g;

/** Float literal: with decimal point or exponent */
const FLOAT_LITERAL_RE =
    /\b(?:(?:[0-9][0-9_]*\.[0-9_]*|[0-9][0-9_]*[eE][+-]?[0-9_]+|\.[0-9][0-9_]*)(?:[eE][+-]?[0-9_]+)?)\b/g;

/** Named literals: true, false, nil, iota */
const NAMED_LITERAL_RE = /\b(true|false|nil|iota)\b/g;

/** Function call expression: `name(` — heuristic, matches identifier followed by open paren */
const CALL_EXPR_RE = /([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\s*\(/g;

/** Keywords and builtins that look like calls but are not user-defined function calls. */
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

/** Package declaration: `package foo` */
const PACKAGE_DECL_RE = /^package\s+([A-Za-z_][A-Za-z0-9_]*)/;

/** Import declaration: `import "foo"` or `import ( ... )` */
const IMPORT_DECL_RE = /^import\s+/;

// --- Tolerated context detection ---

/** Contexts where numeric literals are tolerated (index access, array lengths). */
const NUMERIC_TOLERATED_PARENTS = new Set([
    'index_expression',
    'array_type',
    'slice_type',
]);

/** Contexts where string literals are tolerated (import paths, tags). */
const STRING_TOLERATED_PARENTS = new Set(['import_spec', 'struct_tag']);

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
    const match = TYPE_DEF_RE.exec(trimmed);
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

/**
 * Parse function or method declaration: `func Foo(...)` or `func (r *R) Method(...)`.
 *
 * @param trimmed - Trimmed current line.
 * @param line - Raw current line (for column computation).
 * @param lineNum - 1-based line number.
 * @returns NormalizedNode for the function/method, or null.
 */
function parseFuncOrMethod(trimmed: string, line: string, lineNum: number): NormalizedNode | null {
    const methodMatch = METHOD_DECL_RE.exec(trimmed);
    if (methodMatch) {
        const methodName = methodMatch[1];
        return {
            kind: NodeKind.Method,
            name: methodName,
            functionLike: true,
            introducesBinding: true,
            bindingName: methodName,
            topLevel: true,
            exported: /^[A-Z]/.test(methodName),
            start: { line: lineNum, column: line.indexOf(methodName) + 1 },
            end: { line: lineNum, column: line.length + 1 },
            children: [],
        };
    }
    const funcMatch = FUNC_DECL_RE.exec(trimmed);
    if (funcMatch) {
        const funcName = funcMatch[1];
        return {
            kind: NodeKind.Function,
            name: funcName,
            functionLike: true,
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
    const match = VAR_DECL_RE.exec(trimmed);
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
    const match = CONST_DECL_RE.exec(trimmed);
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

    const match = BLOCK_ENTRY_RE.exec(trimmed);
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
function parseControlFlow(
    trimmed: string,
    line: string,
    lineNum: number,
): NormalizedNode | null {
    if (!CONTROL_FLOW_RE.test(trimmed)) return null;
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
    if (!CASE_LABEL_RE.test(trimmed)) return null;
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
    if (GO_STMT_RE.test(trimmed) || DEFER_STMT_RE.test(trimmed) || RETURN_STMT_RE.test(trimmed)) {
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
function parseNumericLiterals(
    codeOnly: string,
    line: string,
    lineNum: number,
    out: NormalizedNode[],
): void {
    // Find float literals first to avoid partial matches with int regex
    const floatMatches = [...codeOnly.matchAll(FLOAT_LITERAL_RE)];
    for (const m of floatMatches) {
        const idx = m.index ?? 0;
        out.push({
            kind: NodeKind.NumericLiteral,
            text: m[0],
            isNumeric: true,
            tolerated: false,
            start: { line: lineNum, column: idx + 1 },
            end: { line: lineNum, column: idx + m[0].length + 1 },
        });
    }

    // Integer literals — skip positions that overlap with float matches
    const intMatches = [...codeOnly.matchAll(INT_LITERAL_RE)];
    for (const m of intMatches) {
        const idx = m.index ?? 0;
        // Skip if this int overlaps with a float match
        const overlaps = floatMatches.some(
            (fm) =>
                idx >= (fm.index ?? 0) &&
                idx < (fm.index ?? 0) + (fm[0]?.length ?? 0),
        );
        if (overlaps) continue;
        out.push({
            kind: NodeKind.NumericLiteral,
            text: m[0],
            isNumeric: true,
            tolerated: false,
            start: { line: lineNum, column: idx + 1 },
            end: { line: lineNum, column: idx + m[0].length + 1 },
        });
    }
}

/**
 * Detect string literals on a line.
 *
 * @param trimmed - Trimmed current line.
 * @param line - Raw current line.
 * @param lineNum - 1-based line number.
 * @param out - Output array to append nodes to.
 * @param inImport - Whether we are inside an import block (strings are tolerated).
 */
function parseStringLiterals(
    trimmed: string,
    line: string,
    lineNum: number,
    out: NormalizedNode[],
    inImport: boolean,
): void {
    STRING_LITERAL_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = STRING_LITERAL_RE.exec(trimmed)) !== null) {
        const rawVal = match[2];
        const colOffset = line.indexOf(match[0]);
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
    NAMED_LITERAL_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = NAMED_LITERAL_RE.exec(codeOnly)) !== null) {
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
    CALL_EXPR_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = CALL_EXPR_RE.exec(codeOnly)) !== null) {
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
    for (const ch of codeOnly) {
        if (ch === OPEN_BRACE) opens++;
        else if (ch === CLOSE_BRACE) closes++;
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
    braceStack: Array<{ depth: number; kind: 'struct' | 'switch' | 'select' | 'func' | 'const' | 'var' | 'other' }>;
}

/**
 * Update brace depth, create Block nodes for open braces, and pop context stack
 * when closing braces. Called from every code path that contains braces so the
 * nesting state stays consistent regardless of statement type.
 *
 * @param codeOnly - Line with comments stripped.
 * @param rawLine - Raw source line.
 * @param lineNum - 1-based line number.
 * @param ctx - Parse context (mutated in place).
 * @param children - Output array to append Block nodes to.
 */
function trackBraceDelta(
    codeOnly: string,
    rawLine: string,
    lineNum: number,
    ctx: ParseContext,
    children: NormalizedNode[],
): void {
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
    if (trimmed.startsWith(LINE_COMMENT_PREFIX)) {
        return true;
    }
    return false;
}

/**
 * Handle top-level declarations: package, import, type, func, var, const.
 * Also handles const/var block entries.
 *
 * @param codeOnly - Line with line comment stripped.
 * @param rawLine - Raw source line.
 * @param lineNum - 1-based line number.
 * @param ctx - Parse context (mutated in place).
 * @param children - Output array to append nodes to.
 * @returns True when the line is a declaration (caller should skip further processing).
 */
function handleDeclarationLine(
    codeOnly: string,
    rawLine: string,
    lineNum: number,
    ctx: ParseContext,
    children: NormalizedNode[],
): boolean {
    const wasTopLevel = ctx.braceDepth === 0;

    // Package declaration
    if (wasTopLevel && PACKAGE_DECL_RE.test(codeOnly)) {
        return true;
    }

    // Import declaration
    if (wasTopLevel && IMPORT_DECL_RE.test(codeOnly)) {
        if (codeOnly.includes('(')) {
            ctx.inImport = true;
        }
        return true;
    }
    if (ctx.inImport && codeOnly.startsWith(')')) {
        ctx.inImport = false;
        return true;
    }

    // Type declaration (struct / interface)
    const typeNode = parseTypeDeclaration(codeOnly, rawLine, lineNum);
    if (typeNode) {
        children.push(typeNode);
        if (typeNode.kind === NodeKind.Struct && codeOnly.includes(OPEN_BRACE)) {
            ctx.inStruct = true;
            ctx.braceStack.push({ depth: ctx.braceDepth, kind: 'struct' });
        }
        trackBraceDelta(codeOnly, rawLine, lineNum, ctx, children);
        return true;
    }

    // Function or method declaration
    const funcNode = parseFuncOrMethod(codeOnly, rawLine, lineNum);
    if (funcNode) {
        children.push(funcNode);
        if (codeOnly.includes(OPEN_BRACE)) {
            ctx.braceStack.push({ depth: ctx.braceDepth, kind: 'func' });
        }
        trackBraceDelta(codeOnly, rawLine, lineNum, ctx, children);
        return true;
    }

    // Var block start
    if (wasTopLevel && VAR_BLOCK_START_RE.test(codeOnly)) {
        ctx.inVarBlock = true;
        return true;
    }

    // Single-line var declaration
    const varNode = parseVarDeclaration(codeOnly, rawLine, lineNum);
    if (varNode) {
        varNode.topLevel = wasTopLevel;
        children.push(varNode);
        trackBraceDelta(codeOnly, rawLine, lineNum, ctx, children);
        return true;
    }

    // Const block start
    if (wasTopLevel && CONST_BLOCK_START_RE.test(codeOnly)) {
        ctx.inConstBlock = true;
        return true;
    }

    // Single-line const declaration
    const constNode = parseConstDeclaration(codeOnly, rawLine, lineNum);
    if (constNode) {
        constNode.topLevel = wasTopLevel;
        children.push(constNode);
        trackBraceDelta(codeOnly, rawLine, lineNum, ctx, children);
        return true;
    }

    // Inside const/var block: parse entries
    if (ctx.inConstBlock || ctx.inVarBlock) {
        if (codeOnly === ')') {
            ctx.inConstBlock = false;
            ctx.inVarBlock = false;
            return true;
        }
        const entryNode = parseBlockEntry(codeOnly, rawLine, lineNum, ctx.inConstBlock);
        if (entryNode) {
            children.push(entryNode);
        }
        return true;
    }

    return false;
}

/**
 * Handle control-flow statements: if/for/switch/select and case/default labels.
 *
 * @param codeOnly - Line with line comment stripped.
 * @param rawLine - Raw source line.
 * @param lineNum - 1-based line number.
 * @param ctx - Parse context (mutated in place).
 * @param children - Output array to append nodes to.
 * @returns True when the line is a control-flow statement that was fully handled.
 */
function handleControlFlowLine(
    codeOnly: string,
    rawLine: string,
    lineNum: number,
    ctx: ParseContext,
    children: NormalizedNode[],
): boolean {
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
    trackBraceDelta(codeOnly, rawLine, lineNum, ctx, children);
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

    // Phase 1: comment lines (always handled or not — no further processing if comment)
    if (handleCommentLine(trimmed, ctx)) return;

    const codeOnly = stripLineComment(trimmed);
    if (!codeOnly) return;

    // Phase 2: top-level declarations (package, import, type, func, var, const)
    if (handleDeclarationLine(codeOnly, rawLine, lineNum, ctx, children)) return;

    // Phase 3: control flow (if/for/switch/select)
    if (handleControlFlowLine(codeOnly, rawLine, lineNum, ctx, children)) return;

    // Phase 4: other statements and structural elements
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

    // Phase 5: literals and calls (scanned on every code line)
    parseStringLiterals(codeOnly, rawLine, lineNum, children, ctx.inImport);
    parseNumericLiterals(codeOnly, rawLine, lineNum, children);
    parseNamedLiterals(codeOnly, rawLine, lineNum, children);
    parseCallExpressions(codeOnly, rawLine, lineNum, children);

    // Phase 6: brace tracking for block nesting
    trackBraceDelta(codeOnly, rawLine, lineNum, ctx, children);
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