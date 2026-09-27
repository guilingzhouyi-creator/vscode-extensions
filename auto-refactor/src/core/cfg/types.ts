/**
 * Module: Core Engine — Control Flow Graph & Dataflow Types
 * File Path: src/core/cfg/types.ts
 * Architecture Role: Canonical type contracts for basic blocks, CFG topology edges,
 *                    statement classifications, and variable def-use tracking.
 * Dependencies & Triggers: Consumed by BasicBlock, CfgBuilder, DefUseAnalyzer,
 *                          and static review pipelines.
 * Responsibilities: Declare CfgStatement, BasicBlockKind, CfgEdgeKind, CfgEdge,
 *                   VariableDef, VariableUse, and FlowAnalysisResult interfaces.
 * Exit Semantics & Design Rationale: Pure type definitions with zero runtime overhead.
 *                    Decoupled from AST parser implementations for portability.
 */

/** Classification of basic block nodes in a control flow graph. */
export type BasicBlockKind = 'entry' | 'normal' | 'condition' | 'loop-head' | 'loop-exit' | 'exit';

/** Classification of individual statement operations within a basic block. */
export type CfgStatementKind =
    'assignment' | 'expression' | 'condition' | 'return' | 'throw' | 'break' | 'continue';

/** Metadata and semantic facts for a single statement within a basic block. */
export interface CfgStatement {
    /** Unique statement identifier within the function graph. */
    readonly id: string;
    /** Statement semantic classification. */
    readonly kind: CfgStatementKind;
    /** Original source code slice representing the statement. */
    readonly rawText: string;
    /** Source line number (1-based). */
    readonly line: number;
    /** Identifiers of variables defined or assigned in this statement. */
    readonly definedVars: readonly string[];
    /** Identifiers of variables read or referenced in this statement. */
    readonly usedVars: readonly string[];
    /** Invoked call signatures or member method expressions. */
    readonly calls: readonly string[];
    /** True when this statement triggers an unawaited floating Promise expression. */
    readonly isFloatingPromise?: boolean;
    /** True when this statement performs a null/undefined guard check. */
    readonly isNullGuard?: boolean;
}

/** Directional relationship between two basic blocks in a CFG. */
export type CfgEdgeKind =
    'unconditional' | 'true-branch' | 'false-branch' | 'loop-back' | 'loop-exit' | 'exceptional';

/** Directed control flow transition edge connecting two basic blocks. */
export interface CfgEdge {
    /** Source basic block identifier. */
    readonly fromId: number;
    /** Target basic block identifier. */
    readonly toId: number;
    /** Edge transition condition semantics. */
    readonly kind: CfgEdgeKind;
}

/** Variable definition site recording location and resource semantics. */
export interface VariableDef {
    /** Variable identifier name. */
    readonly variable: string;
    /** Enclosing basic block identifier. */
    readonly blockId: number;
    /** Enclosing statement identifier. */
    readonly statementId: string;
    /** Source code line number. */
    readonly line: number;
    /** True if this definition holds an allocated or acquired disposable resource. */
    readonly isResource: boolean;
}

/** Variable use site classification. */
export type VariableUseKind = 'read' | 'call-target' | 'argument' | 'dereference' | 'cleanup';

/** Variable usage site recording reference context. */
export interface VariableUse {
    /** Variable identifier name. */
    readonly variable: string;
    /** Enclosing basic block identifier. */
    readonly blockId: number;
    /** Enclosing statement identifier. */
    readonly statementId: string;
    /** Source code line number. */
    readonly line: number;
    /** Semantic nature of the usage. */
    readonly kind: VariableUseKind;
}

/** Discovered floating asynchronous invocation lacking await or error handling. */
export interface FloatingPromiseFinding {
    /** Source line number where the floating promise call occurs. */
    readonly line: number;
    /** Raw call or expression text. */
    readonly rawText: string;
    /** Name of the invoked asynchronous function or method. */
    readonly callName: string;
}

/** Discovered potentially unguarded null dereference. */
export interface UnguardedNullFinding {
    /** Source line number where the dereference occurs. */
    readonly line: number;
    /** Identifier of the potentially null/undefined variable. */
    readonly variable: string;
    /** Raw expression containing the unguarded dereference. */
    readonly rawText: string;
}

/** Discovered resource leak on an execution path escaping without cleanup. */
export interface UnclosedResourceFinding {
    /** Identifier of the unclosed variable resource. */
    readonly variable: string;
    /** Line number where the resource was defined/allocated. */
    readonly defLine: number;
    /** Exit block id escaping without registration or disposal. */
    readonly exitBlockId: number;
    /** Line number where the function exits without releasing the resource. */
    readonly exitLine: number;
}

/** Complete diagnostics result returned by control flow and def-use analysis. */
export interface FlowAnalysisResult {
    /** Floating asynchronous promise calls detected. */
    readonly floatingPromises: readonly FloatingPromiseFinding[];
    /** Unguarded null dereferences detected. */
    readonly unguardedDereferences: readonly UnguardedNullFinding[];
    /** Disposable or handle resources leaking on exit paths. */
    readonly unclosedResources: readonly UnclosedResourceFinding[];
}
