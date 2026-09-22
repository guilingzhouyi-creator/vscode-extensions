/**
 * Module: Core Engine - AST Slice and Sparse MoE Architecture Types
 * File Path: src/core/router/sliceTypes.ts
 * Architecture Role: Foundation contracts for fine-grained incremental AST slice extraction,
 *   feature vector classification, sparse MoE CED (Conditional Expert Dispatching) routing,
 *   call-chain impact tracing, and Praxis slice audit governance.
 * Dependencies & Triggers: Consumed by sliceExtractor, sparseMoEGate, callChainImpactTracer,
 *   and Praxis slice audit facade.
 * Responsibilities: Declare ASTSliceNode, SliceFeatureVector, SparseRoutingPlan,
 *   CallChainImpactResult, and Praxis slice review contracts.
 * Exit Semantics & Design Rationale: Pure type declarations without runtime overhead.
 */

import type { Issue } from '../types';

/** Canonical domain error tag for invalid custom analyzer declarations (N-08). */
export const ERR_INVALID_CUSTOM_ANALYZER = '[INVALID_CUSTOM_ANALYZER]' as const;

/** Canonical domain error tag for unknown semantic diff categories (N-02). */
export const ERR_UNKNOWN_CATEGORY = '[UNKNOWN_CATEGORY]' as const;

/** Canonical domain error tag for unclassified files lacking language support (N-03). */
export const ERR_UNCLASSIFIED_FILE = '[UNCLASSIFIED_FILE]' as const;

/** Mutation category for a diff hunk modifying literal values only. */
export const CATEGORY_LITERAL_ONLY = 'LITERAL_ONLY' as const;

/** Mutation category for a diff hunk modifying control-flow structures. */
export const CATEGORY_CONTROL_FLOW = 'CONTROL_FLOW' as const;

/** Mutation category for a diff hunk modifying type or interface signatures. */
export const CATEGORY_INTERFACE_SIGNATURE = 'INTERFACE_SIGNATURE' as const;

/** Mutation category for a diff hunk modifying import or export statements. */
export const CATEGORY_IMPORT_EXPORT = 'IMPORT_EXPORT' as const;

/** Mutation category for a diff hunk modifying comments or documentation only. */
export const CATEGORY_COMMENT_DOC_ONLY = 'COMMENT_DOC_ONLY' as const;

/** Mutation category for unclassified or general multi-feature code modifications. */
export const CATEGORY_GENERAL_CODE = 'GENERAL_CODE' as const;

/** Closed vocabulary of mutation categories emitted by diff classification. */
export type DiffSemanticCategory =
    | typeof CATEGORY_LITERAL_ONLY
    | typeof CATEGORY_CONTROL_FLOW
    | typeof CATEGORY_INTERFACE_SIGNATURE
    | typeof CATEGORY_IMPORT_EXPORT
    | typeof CATEGORY_COMMENT_DOC_ONLY
    | typeof CATEGORY_GENERAL_CODE;

/** Kinds of semantic mutations detected within an AST slice. */
export type SliceMutationKind =
    | 'signature'
    | 'control-flow'
    | 'literal'
    | 'async'
    | 'io'
    | 'type-annotation'
    | 'doc-comment'
    | 'general';

/** Feature vector representing semantic attributes of an AST slice mutation. */
export interface SliceFeatureVector {
    /** True when function name, parameter count/types, or return type mutated. */
    hasSignatureMutation: boolean;
    /** True when branches, loops, guards, or match arms mutated. */
    hasControlFlowMutation: boolean;
    /** True when only literals (numeric, string, boolean) were replaced. */
    hasLiteralMutation: boolean;
    /** True when async/await, Promise, or concurrency patterns mutated. */
    hasAsyncMutation: boolean;
    /** True when filesystem, network, process, or IPC calls mutated. */
    hasIoMutation: boolean;
    /** True when type annotations, interfaces, or type aliases mutated. */
    hasTypeMutation: boolean;
    /** True when only comments or documentation annotations mutated. */
    isDocOnly: boolean;
}

/** Represents a localized AST slice affected by a diff hunk or line range. */
export interface ASTSliceNode {
    /** Unique slice identifier. */
    sliceId: string;
    /** Relative repository path. */
    filePath: string;
    /** 1-based start line of the containing AST declaration node. */
    startLine: number;
    /** 1-based end line of the containing AST declaration node. */
    endLine: number;
    /** Syntax node kind (e.g. FunctionDeclaration, ClassDeclaration, InterfaceDeclaration). */
    nodeKind: string;
    /** Name of the primary symbol declared or modified in this slice. */
    symbolName: string;
    /** Whether the symbol is exported outside the current file. */
    isExported: boolean;
    /** Computed mutation features. */
    featureVector: SliceFeatureVector;
    /** Primary mutation classification. */
    primaryKind: SliceMutationKind;
}

/** Sparse MoE CED (Conditional Expert Dispatching) routing plan for an AST slice. */
export interface SparseRoutingPlan {
    /** Identifier of the AST slice or diff being routed. */
    sliceId: string;
    /** Target file path. */
    filePath: string;
    /** List of analyzer identifiers selected for active execution. */
    activeAnalyzers: string[];
    /** List of cold analyzer identifiers bypassed to avoid traversal. */
    skippedAnalyzers: string[];
    /** Ratio of active analyzers to all available analyzers (e.g. 0.15 = 15%). */
    activationRatio: number;
    /** Concrete architectural reasons for analyzer activation. */
    reasons: string[];
}

/** Represents a single hop in a reverse call chain traversal. */
export interface CallChainHop {
    /** File path containing the calling symbol. */
    file: string;
    /** Symbol making the call. */
    callerSymbol: string;
    /** 1-based line of invocation. */
    line: number;
    /** Distance in call depth from modified target symbol (1 = direct caller). */
    depth: number;
}

/** Complete impact analysis for a symbol modified in an AST slice. */
export interface CallChainImpactResult {
    /** Target symbol analyzed. */
    targetSymbol: string;
    /** File defining target symbol. */
    targetFile: string;
    /** Whether the symbol had breaking signature mutations. */
    hasBreakingMutation: boolean;
    /** Total count of direct and transitive callers impacted. */
    totalImpactedCallers: number;
    /** Distinct external files calling this symbol. */
    impactedFiles: string[];
    /** Traversed call chain paths. */
    callChains: CallChainHop[];
    /** Synthesized architectural risk assessment. */
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    /** Detected breaking drift issues. */
    issues: Issue[];
}

/** Input payload for Praxis fine-grained slice audit. */
export interface PraxisSliceAuditInput {
    /** Relative file path. */
    filePath: string;
    /** Prior content before modification. */
    oldContent: string;
    /** New content after modification. */
    newContent: string;
    /** Modified 1-based line numbers. */
    changedLines: number[];
    /** Optional author/agent identifier. */
    author?: string;
    /** Optional max traversal depth for call chain impact. Defaults to 3. */
    maxCallDepth?: number;
}

/** Detailed verdict produced by Praxis slice audit. */
export interface PraxisSliceAuditVerdict {
    /** Target file. */
    filePath: string;
    /** Extracted AST slice nodes. */
    slices: ASTSliceNode[];
    /** Executed sparse routing plan. */
    routingPlan: SparseRoutingPlan;
    /** Call-chain impacts for all modified symbols. */
    impacts: CallChainImpactResult[];
    /** Issues identified during slice inspection. */
    issues: Issue[];
    /** High-resolution analysis latency in microseconds (C-06). */
    latencyUs: number;
    /** Analysis latency in milliseconds. */
    latencyMs: number;
    /** Status indicating whether slice passes architectural governance. */
    status: 'PASS' | 'WARN' | 'BLOCK';
}
