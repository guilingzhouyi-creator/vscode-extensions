/**
 * Module: Core Engine — Control Flow Basic Block
 * File Path: src/core/cfg/basic-block.ts
 * Architecture Role: Primary node structure in the control flow graph encapsulating a
 *                    straight-line sequence of execution statements without internal branching.
 * Dependencies & Triggers: Consumed by CfgBuilder, DefUseAnalyzer, and CFG traversal operators;
 *                          imports types from ./types.
 * Responsibilities: Maintain statement list, predecessor and successor block links, edge
 *                   annotations, and variable def/use extraction for local dataflow.
 * Exit Semantics & Design Rationale: Mutable during graph construction, immutable once finalized;
 *                   provides deterministic traversal ordering and zero cyclic serializations.
 */

import type { BasicBlockKind, CfgEdge, CfgEdgeKind, CfgStatement } from './types';

/**
 * Basic block representation in a function-level control flow graph.
 * A basic block is a maximal sequence of straight-line instructions with one entry point
 * (the first statement) and one exit point (the last statement).
 */
export class BasicBlock {
    /** Numeric identifier unique within the owning control flow graph. */
    readonly id: number;
    /** Structural classification of the basic block. */
    kind: BasicBlockKind;
    /** Statements contained within the basic block executed in sequence. */
    readonly statements: CfgStatement[] = [];
    /** Incoming predecessor blocks. */
    readonly predecessors: BasicBlock[] = [];
    /** Outgoing successor blocks. */
    readonly successors: BasicBlock[] = [];
    /** Outgoing edge descriptors recording transition semantics. */
    readonly outgoingEdges: CfgEdge[] = [];

    /**
     * Initializes a new basic block.
     *
     * @param id - Unique numeric identifier.
     * @param kind - Initial classification of this block.
     */
    constructor(id: number, kind: BasicBlockKind = 'normal') {
        this.id = id;
        this.kind = kind;
    }

    /**
     * Appends a statement to the end of this basic block.
     *
     * @param stmt - Statement to append.
     */
    addStatement(stmt: CfgStatement): void {
        this.statements.push(stmt);
    }

    /**
     * Connects an outgoing edge from this block to a successor block.
     *
     * @param target - Target successor basic block.
     * @param kind - Edge transition condition classification.
     */
    addSuccessor(target: BasicBlock, kind: CfgEdgeKind = 'unconditional'): void {
        if (!this.successors.some((b) => b.id === target.id)) {
            this.successors.push(target);
            this.outgoingEdges.push({
                fromId: this.id,
                toId: target.id,
                kind,
            });
        }
        if (!target.predecessors.some((b) => b.id === this.id)) {
            target.predecessors.push(this);
        }
    }

    /**
     * Checks whether this basic block terminates with an unconditional jump or return.
     *
     * @returns True if the block terminates control flow (return or throw).
     */
    isTerminator(): boolean {
        if (this.statements.length === 0) return false;
        const last = this.statements[this.statements.length - 1];
        return last.kind === 'return' || last.kind === 'throw';
    }

    /**
     * Returns the terminating statement if present in the block.
     *
     * @returns Last statement if it terminates execution, otherwise undefined.
     */
    getTerminator(): CfgStatement | undefined {
        if (this.statements.length === 0) return undefined;
        const last = this.statements[this.statements.length - 1];
        return last.kind === 'return' || last.kind === 'throw' ? last : undefined;
    }

    /**
     * Computes the set of variable names defined or updated within this block.
     *
     * @returns Set of variable names defined in this block.
     */
    collectDefinedVars(): Set<string> {
        const result = new Set<string>();
        for (const stmt of this.statements) {
            for (const v of stmt.definedVars) {
                result.add(v);
            }
        }
        return result;
    }

    /**
     * Computes the set of variable names referenced or read within this block.
     *
     * @returns Set of variable names used in this block.
     */
    collectUsedVars(): Set<string> {
        const result = new Set<string>();
        for (const stmt of this.statements) {
            for (const v of stmt.usedVars) {
                result.add(v);
            }
        }
        return result;
    }
}
