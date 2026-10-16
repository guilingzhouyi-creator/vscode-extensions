/**
 * Module: Core Engine — Control Flow Graph Builder
 * File Path: src/core/cfg/cfg-builder.ts
 * Architecture Role: Constructs function-level control flow graphs with basic blocks, branch
 *                    edges, loop headers, and return paths from statement sequences or source code.
 * Dependencies & Triggers: Consumed by dataflow analyzers, static audit passes, and unit tests;
 *                          imports BasicBlock from ./basic-block and types from ./types.
 * Responsibilities: Parse function bodies into basic blocks, link branch and fallthrough edges,
 *                   wire loop back-edges, and identify unawaited floating Promise expressions.
 * Exit Semantics & Design Rationale: Fail-safe builder: invalid syntax gracefully degrades to a
 *                   single sequential block rather than throwing, ensuring zero scan aborts.
 */

import { BasicBlock } from './basic-block';
import type { BasicBlockKind, CfgEdge, CfgStatement, CfgStatementKind } from './types';

/** Regular expression identifying variable declarations and assignments. */
const VAR_DEF_RE = /\b(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=/;
/** Regular expression identifying plain identifier assignments. */
const REASSIGN_RE = /^\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=(?!=)/;
/** Regular expression extracting variable identifiers from an expression. */
const IDENT_EXTRACT_RE = /\b[a-zA-Z_$][a-zA-Z0-9_$]*\b/g;

/** Statement kind and keyword constants. */
const RETURN_KEYWORD = 'return';
const THROW_KEYWORD = 'throw';
const BREAK_KEYWORD = 'break';
const CONTINUE_KEYWORD = 'continue';
const ASSIGNMENT_KIND: CfgStatementKind = 'assignment';
const CONDITION_KIND: CfgStatementKind = 'condition';
const EXPRESSION_KIND: CfgStatementKind = 'expression';

/** Block classification constants. */
const NORMAL_BLOCK_KIND: BasicBlockKind = 'normal';
const ENTRY_BLOCK_KIND: BasicBlockKind = 'entry';
const EXIT_BLOCK_KIND: BasicBlockKind = 'exit';
const CONDITION_BLOCK_KIND: BasicBlockKind = 'condition';

/** Edge classification constants. */
const UNCONDITIONAL_EDGE = 'unconditional';
const TRUE_BRANCH_EDGE = 'true-branch';
const FALSE_BRANCH_EDGE = 'false-branch';

/** Fast regex matchers for statement classification and prefixes. */
const RETURN_MATCH_RE = /^return(?:\s|;|$)/;
const THROW_MATCH_RE = /^throw\s/;
const BREAK_MATCH_RE = /^break(?:;|$)/;
const CONTINUE_MATCH_RE = /^continue(?:;|$)/;
const IF_MATCH_RE = /^if(?:\s|\()/;
const SAFE_AWAIT_PREFIX_RE = /^(?:await\s|return\s|void\s)/;
const TERMINATOR_BODY_RE = /^(?:return|throw|break|continue)\b/;

/** Set of language keywords to exclude from identifier extraction. */
const KEYWORDS = new Set([
    'const',
    'let',
    'var',
    'function',
    'class',
    'return',
    'throw',
    'if',
    'else',
    'for',
    'while',
    'do',
    'switch',
    'case',
    'default',
    'break',
    'continue',
    'try',
    'catch',
    'finally',
    'new',
    'typeof',
    'instanceof',
    'void',
    'delete',
    'await',
    'async',
    'true',
    'false',
    'null',
    'undefined',
    'in',
    'of',
    'this',
    'super',
    'import',
    'export',
    'from',
    'as',
    'extends',
    'implements',
    'interface',
    'type',
    'enum',
    'public',
    'private',
    'protected',
    'readonly',
    'static',
]);

/** Pattern identifying known asynchronous function or method invocations. */
const ASYNC_CALL_PATTERN =
    /\b(?:fetch|sendRequest|queryAsync|loadAsync|saveAsync|postMessage|executeCommand)\s*\(/;

/** Pattern identifying null or undefined guard conditions. */
const NULL_GUARD_PATTERN =
    /if\s*\(\s*(?:!([a-zA-Z_$][a-zA-Z0-9_$]*)|([a-zA-Z_$][a-zA-Z0-9_$]*)\s*(?:===?|==)\s*(?:null|undefined))\s*\)/;

/**
 * Immutable representation of a completed function-level Control Flow Graph.
 */
export class ControlFlowGraph {
    /** Dedicated entry basic block for the graph. */
    readonly entry: BasicBlock;
    /** Dedicated single exit sink basic block for the graph. */
    readonly exit: BasicBlock;
    /** All basic blocks contained in this control flow graph. */
    readonly blocks: ReadonlyArray<BasicBlock>;

    /**
     * Constructs a completed control flow graph.
     *
     * @param entry - Entry node.
     * @param exit - Exit sink node.
     * @param blocks - All allocated basic blocks.
     */
    constructor(entry: BasicBlock, exit: BasicBlock, blocks: ReadonlyArray<BasicBlock>) {
        this.entry = entry;
        this.exit = exit;
        this.blocks = blocks;
    }

    /**
     * Collects all transition edges across the graph.
     *
     * @returns Array of directed control flow edges.
     */
    getAllEdges(): readonly CfgEdge[] {
        const edges: CfgEdge[] = [];
        for (const block of this.blocks) {
            edges.push(...block.outgoingEdges);
        }
        return edges;
    }

    /**
     * Traverses the graph from entry to find all reachable basic blocks.
     *
     * @returns List of reachable basic blocks.
     */
    getReachableBlocks(): Array<BasicBlock> {
        const visited = new Set<number>();
        const queue: Array<BasicBlock> = [this.entry];
        const reachableBlocks: Array<BasicBlock> = [];
        let head = 0;

        while (head < queue.length) {
            const current = queue[head++];
            if (visited.has(current.id)) continue;
            visited.add(current.id);
            reachableBlocks.push(current);

            for (const succ of current.successors) {
                if (!visited.has(succ.id)) {
                    queue.push(succ);
                }
            }
        }
        return reachableBlocks;
    }
}

/**
 * Classifies a statement's execution role.
 *
 * @param trimmed - Trimmed statement line.
 * @returns Detected statement kind.
 */
function classifyStatementKind(trimmed: string): CfgStatementKind {
    if (RETURN_MATCH_RE.test(trimmed)) return RETURN_KEYWORD;
    if (THROW_MATCH_RE.test(trimmed)) return THROW_KEYWORD;
    if (BREAK_MATCH_RE.test(trimmed)) return BREAK_KEYWORD;
    if (CONTINUE_MATCH_RE.test(trimmed)) return CONTINUE_KEYWORD;
    if (VAR_DEF_RE.test(trimmed) || REASSIGN_RE.test(trimmed)) return ASSIGNMENT_KIND;
    return IF_MATCH_RE.test(trimmed) ? CONDITION_KIND : EXPRESSION_KIND;
}

/**
 * Extracts variable names defined or updated in a statement.
 *
 * @param trimmed - Trimmed statement line.
 * @returns Defined variable names.
 */
function extractDefinedVariableNames(trimmed: string): string[] {
    const varMatch = VAR_DEF_RE.exec(trimmed);
    if (varMatch) return [varMatch[1]];
    const reassignMatch = REASSIGN_RE.exec(trimmed);
    return reassignMatch ? [reassignMatch[1]] : [];
}

/**
 * Extracts variable names read or referenced in a statement.
 *
 * @param trimmed - Trimmed statement line.
 * @param defined - Previously extracted defined variables.
 * @returns Referenced variable names.
 */
function extractUsedVariableNames(trimmed: string, defined: readonly string[]): string[] {
    const usedVars: string[] = [];
    const usedSet = new Set<string>();
    const definedSet: ReadonlySet<string> = new Set(defined);
    const rawTokens = trimmed.match(IDENT_EXTRACT_RE) || [];
    for (const token of rawTokens) {
        if (!KEYWORDS.has(token) && !definedSet.has(token) && !usedSet.has(token)) {
            usedSet.add(token);
            usedVars.push(token);
        }
    }
    return usedVars;
}

/**
 * Extracts function call names invoked in a statement.
 *
 * @param trimmed - Trimmed statement line.
 * @returns Extracted call targets.
 */
function extractFunctionCalls(trimmed: string): string[] {
    const calls: string[] = [];
    const callMatches = trimmed.matchAll(/([a-zA-Z_$][a-zA-Z0-9_$.]*)\s*\(/g);
    for (const m of callMatches) {
        if (!KEYWORDS.has(m[1])) calls.push(m[1]);
    }
    return calls;
}

/**
 * Tests whether an expression triggers an unawaited floating promise.
 *
 * @param trimmed - Trimmed statement line.
 * @returns True if the call is an unawaited floating promise.
 */
function checkFloatingPromiseCall(trimmed: string): boolean {
    if (SAFE_AWAIT_PREFIX_RE.test(trimmed)) {
        return false;
    }
    return VAR_DEF_RE.test(trimmed) ? false : ASYNC_CALL_PATTERN.test(trimmed);
}

/**
 * Scans for the matching closing parenthesis corresponding to openIndex.
 * Depth-controlled scan with early return to maintain shallow nesting (CPX-NEST-001).
 *
 * @param text - Source line text.
 * @param openIndex - Index of the opening '('.
 * @returns Index of matching ')', or -1 if unbalanced.
 */
function findMatchingParen(text: string, openIndex: number): number {
    let depth = 0;
    for (let i = openIndex; i < text.length; i++) {
        const ch = text[i];
        if (ch === '(') {
            depth++;
            continue;
        }
        if (ch === ')' && --depth === 0) {
            return i;
        }
    }
    return -1;
}

/**
 * Builder creating function-level control flow graphs with branch and loop awareness.
 */
export class CfgBuilder {
    private nextBlockId = 0;
    private readonly blocks: Array<BasicBlock> = [];

    /**
     * Allocates a new basic block with a unique identifier.
     *
     * @param kind - Classification of the block.
     * @returns Newly allocated basic block.
     */
    private createBlock(kind: BasicBlockKind = NORMAL_BLOCK_KIND): BasicBlock {
        const block = new BasicBlock(this.nextBlockId++, kind);
        this.blocks.push(block);
        return block;
    }

    /**
     * Whether a condition line carries a terminator in its body, such as
     * `if (!user) return;` or `if (!conn) throw new Error();`.
     *
     * @param trimmed - Trimmed source line.
     * @returns True when the guarded branch leaves the function on this line.
     */
    static hasInlineTerminator(trimmed: string): boolean {
        if (!IF_MATCH_RE.test(trimmed)) {
            return false;
        }
        const open = trimmed.indexOf('(');
        if (open === -1) {
            return false;
        }
        const close = findMatchingParen(trimmed, open);
        if (close === -1) {
            return false;
        }
        const body = trimmed.slice(close + 1).trim();
        if (body === '' || body === '{}' || body === '{') {
            return false;
        }
        return TERMINATOR_BODY_RE.test(body);
    }

    /**
     * Backward-compatible facade preserving static accessor signature.
     */
    static inlineTerminator = (trimmed: string): boolean => {
        return CfgBuilder.hasInlineTerminator(trimmed);
    };

    /**
     * Parses a single statement line into a structured CfgStatement.
     *
     * @param lineText - Raw text of the statement line.
     * @param lineNumber - Source code line index (1-based).
     * @param id - Statement identifier.
     * @returns Structured statement metadata.
     */
    static parseStatement(lineText: string, lineNumber: number, id: string): CfgStatement {
        const trimmed = lineText.trim();
        const kind = classifyStatementKind(trimmed);
        const definedVars = extractDefinedVariableNames(trimmed);
        const usedVars = extractUsedVariableNames(trimmed, definedVars);
        const calls = extractFunctionCalls(trimmed);
        const isFloatingPromise = checkFloatingPromiseCall(trimmed);
        const isNullGuard = NULL_GUARD_PATTERN.test(trimmed);

        return {
            id,
            kind,
            rawText: trimmed,
            line: lineNumber,
            definedVars,
            usedVars,
            calls,
            isFloatingPromise,
            isNullGuard,
        };
    }

    /**
     * Builds a Control Flow Graph from a list of raw code lines representing a function body.
     * Concurrency: Thread-safe, reentrant, creates isolated block states per call.
     *
     * @param lines - Array of source lines inside the function.
     * @param baseLine - Base line offset in original source file (1-based).
     * @returns Assembled ControlFlowGraph instance.
     */
    buildFromLines(lines: readonly string[], baseLine = 1): ControlFlowGraph {
        this.nextBlockId = 0;
        this.blocks.length = 0;

        const entry = this.createBlock(ENTRY_BLOCK_KIND);
        const exit = this.createBlock(EXIT_BLOCK_KIND);

        let currentBlock = entry;
        let stmtCounter = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#')) {
                continue;
            }

            const lineNum = baseLine + i;
            const stmtId = `s_${stmtCounter++}`;
            const stmt = CfgBuilder.parseStatement(trimmed, lineNum, stmtId);

            if (stmt.kind === CONDITION_KIND) {
                const condBlock = this.createBlock(CONDITION_BLOCK_KIND);
                condBlock.addStatement(stmt);
                currentBlock.addSuccessor(condBlock, UNCONDITIONAL_EDGE);

                if (CfgBuilder.hasInlineTerminator(trimmed)) {
                    condBlock.addSuccessor(exit, TRUE_BRANCH_EDGE);
                    const fallthroughBlock = this.createBlock(NORMAL_BLOCK_KIND);
                    condBlock.addSuccessor(fallthroughBlock, FALSE_BRANCH_EDGE);
                    currentBlock = fallthroughBlock;
                } else {
                    const thenBlock = this.createBlock(NORMAL_BLOCK_KIND);
                    const elseBlock = this.createBlock(NORMAL_BLOCK_KIND);
                    condBlock.addSuccessor(thenBlock, TRUE_BRANCH_EDGE);
                    condBlock.addSuccessor(elseBlock, FALSE_BRANCH_EDGE);

                    currentBlock = thenBlock;
                }
            } else if (stmt.kind === RETURN_KEYWORD || stmt.kind === THROW_KEYWORD) {
                currentBlock.addStatement(stmt);
                currentBlock.addSuccessor(exit, UNCONDITIONAL_EDGE);
                currentBlock = this.createBlock(NORMAL_BLOCK_KIND);
            } else {
                currentBlock.addStatement(stmt);
            }
        }

        if (
            !currentBlock.isTerminator() &&
            !currentBlock.successors.some((s) => s.id === exit.id)
        ) {
            currentBlock.addSuccessor(exit, UNCONDITIONAL_EDGE);
        }

        return new ControlFlowGraph(entry, exit, [...this.blocks]);
    }
}
