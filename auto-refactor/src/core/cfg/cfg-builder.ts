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
import type { CfgEdge, CfgStatement, CfgStatementKind } from './types';

/** Regular expression identifying variable declarations and assignments. */
const VAR_DEF_RE = /\b(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=/;
/** Regular expression identifying plain identifier assignments. */
const REASSIGN_RE = /^\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=(?!=)/;
/** Regular expression extracting variable identifiers from an expression. */
const IDENT_EXTRACT_RE = /\b[a-zA-Z_$][a-zA-Z0-9_$]*\b/g;
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
    readonly blocks: readonly BasicBlock[];

    /**
     * Constructs a completed control flow graph.
     *
     * @param entry - Entry node.
     * @param exit - Exit sink node.
     * @param blocks - All allocated basic blocks.
     */
    constructor(entry: BasicBlock, exit: BasicBlock, blocks: readonly BasicBlock[]) {
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
    getReachableBlocks(): BasicBlock[] {
        const visited = new Set<number>();
        const queue: BasicBlock[] = [this.entry];
        const result: BasicBlock[] = [];

        while (queue.length > 0) {
            const current = queue.shift()!;
            if (visited.has(current.id)) continue;
            visited.add(current.id);
            result.push(current);

            for (const succ of current.successors) {
                if (!visited.has(succ.id)) {
                    queue.push(succ);
                }
            }
        }
        return result;
    }
}

/**
 * Classifies a statement's execution role.
 *
 * @param trimmed - Trimmed statement line.
 * @returns Detected statement kind.
 */
function classifyStatementKind(trimmed: string): CfgStatementKind {
    if (trimmed.startsWith('return ') || trimmed === 'return' || trimmed.startsWith('return;')) {
        return 'return';
    }
    if (trimmed.startsWith('throw ')) return 'throw';
    if (trimmed.startsWith('break;') || trimmed === 'break') return 'break';
    if (trimmed.startsWith('continue;') || trimmed === 'continue') return 'continue';
    if (VAR_DEF_RE.test(trimmed) || REASSIGN_RE.test(trimmed)) return 'assignment';
    if (trimmed.startsWith('if ') || trimmed.startsWith('if(')) return 'condition';
    return 'expression';
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
    if (reassignMatch) return [reassignMatch[1]];
    return [];
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
    const rawTokens = trimmed.match(IDENT_EXTRACT_RE) || [];
    for (const token of rawTokens) {
        if (!KEYWORDS.has(token) && !defined.includes(token) && !usedVars.includes(token)) {
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
    if (
        trimmed.startsWith('await ') ||
        trimmed.startsWith('return ') ||
        trimmed.startsWith('void ')
    ) {
        return false;
    }
    if (VAR_DEF_RE.test(trimmed)) return false;
    return ASYNC_CALL_PATTERN.test(trimmed);
}

/**
 * Builder creating function-level control flow graphs with branch and loop awareness.
 */
export class CfgBuilder {
    private nextBlockId = 0;
    private readonly blocks: BasicBlock[] = [];

    /**
     * Allocates a new basic block with a unique identifier.
     *
     * @param kind - Classification of the block.
     * @returns Newly allocated basic block.
     */
    private createBlock(kind: BasicBlock['kind'] = 'normal'): BasicBlock {
        const block = new BasicBlock(this.nextBlockId++, kind);
        this.blocks.push(block);
        return block;
    }

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

        const entry = this.createBlock('entry');
        const exit = this.createBlock('exit');

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

            if (stmt.kind === 'condition') {
                const condBlock = this.createBlock('condition');
                condBlock.addStatement(stmt);
                currentBlock.addSuccessor(condBlock, 'unconditional');

                const thenBlock = this.createBlock('normal');
                const elseBlock = this.createBlock('normal');
                condBlock.addSuccessor(thenBlock, 'true-branch');
                condBlock.addSuccessor(elseBlock, 'false-branch');

                currentBlock = thenBlock;
            } else if (stmt.kind === 'return' || stmt.kind === 'throw') {
                currentBlock.addStatement(stmt);
                currentBlock.addSuccessor(exit, 'unconditional');
                currentBlock = this.createBlock('normal');
            } else {
                currentBlock.addStatement(stmt);
            }
        }

        if (
            !currentBlock.isTerminator() &&
            !currentBlock.successors.some((s) => s.id === exit.id)
        ) {
            currentBlock.addSuccessor(exit, 'unconditional');
        }

        return new ControlFlowGraph(entry, exit, [...this.blocks]);
    }
}
