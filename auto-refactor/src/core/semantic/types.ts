/**
 * Module: Core Engine — Unified Semantic Graph & IR Model
 * File Path: src/core/semantic/types.ts
 * Architecture Role: Defines language-agnostic intermediate representation (IR)
 *   data models for semantic topology, data flow, call graphs, and impact slicing.
 * Dependencies & Triggers: Consumed by semantic graph builder, analyzers, and adapters.
 * Responsibilities: Universal node and edge models, semantic attributes, graph metrics.
 * Exit Semantics & Design Rationale: Strongly typed schemas ensure lossless mapping
 *   across different host languages (TypeScript, Python, Rust, Go, Java, etc.).
 */

/**
 * Fundamental category of semantic node within the unified code graph.
 */
export type SemanticNodeKind =
    | 'module'
    | 'function'
    | 'type'
    | 'variable'
    | 'dependency'
    | 'call'
    | 'data_flow'
    | 'state_mutation'
    | 'exception'
    | 'resource'
    | 'import'
    | 'loop'
    | 'branch'
    | 'async_boundary'
    | 'concurrency'
    | 'io'
    | 'database_operation';

/**
 * Topology relation category representing directed flow or structural binding.
 */
export type SemanticEdgeKind =
    | 'calls'
    | 'mutates'
    | 'depends_on'
    | 'instantiates'
    | 'flows_to'
    | 'awaits'
    | 'handles'
    | 'reads'
    | 'writes'
    | 'inherits';

/**
 * Text coordinate location of a node within its source unit.
 */
export interface NodeCoordinate {
    line: number;
    column: number;
    offset?: number;
}

/**
 * Physical location descriptor for a semantic entity.
 */
export interface NodeLocation {
    file: string;
    start: NodeCoordinate;
    end: NodeCoordinate;
}

/**
 * Language-agnostic code metrics associated with an individual node.
 */
export interface NodeMetrics {
    cyclomaticComplexity?: number;
    nestingDepth?: number;
    lineCount?: number;
    parameterCount?: number;
    fanIn?: number;
    fanOut?: number;
}

/**
 * Behavioral and semantic attributes attached to a node.
 */
export interface NodeAttributes {
    visibility?: 'public' | 'protected' | 'private' | 'internal';
    isAsync?: boolean;
    isStatic?: boolean;
    isGenerator?: boolean;
    isRecursive?: boolean;
    isPure?: boolean;
    isExported?: boolean;
    returnType?: string;
    [key: string]: unknown;
}

/**
 * Execution or data flow context surrounding an edge.
 */
export interface EdgeContext {
    inLoop?: boolean;
    inTryCatch?: boolean;
    isConditional?: boolean;
    conditionExpr?: string;
    payloadType?: string;
    [key: string]: unknown;
}

/**
 * Language-independent semantic node representing a logical unit of code.
 */
export interface SemanticNode {
    /** Canonical unique identifier: ${language}:${filePath}#${symbolPath} */
    id: string;
    language: string;
    kind: SemanticNodeKind;
    name: string;
    scope?: string;
    location: NodeLocation;
    attributes?: NodeAttributes;
    metrics?: NodeMetrics;
}

/**
 * Directed relationship linking two semantic nodes.
 */
export interface SemanticEdge {
    /** Unique edge identifier */
    id: string;
    fromNodeId: string;
    toNodeId: string;
    kind: SemanticEdgeKind;
    weight?: number;
    context?: EdgeContext;
}

/**
 * Sliced subgraph containing connected nodes and directed relations.
 */
export interface SemanticSubgraph {
    nodes: SemanticNode[];
    edges: SemanticEdge[];
    seedNodeId: string;
    depth: number;
}

/**
 * Whole-graph structural and topological statistics.
 */
export interface SemanticGraphMetrics {
    nodeCount: number;
    edgeCount: number;
    componentCount: number;
    density: number;
    averageInDegree: number;
    averageOutDegree: number;
    cycleCount: number;
}
