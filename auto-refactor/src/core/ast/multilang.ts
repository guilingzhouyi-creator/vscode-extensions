/**
 * Module: Core Engine — Language-Agnostic AST Contracts
 * File Path: src/core/ast/multilang.ts
 * Architecture Role: Normalized-AST contract boundary between concrete parser adapters
 *     (TypeScript, oxc, Rust/tree-sitter, GDScript) and traverse.ts plus all analyzers.
 * Dependencies & Triggers: Imported at module load by adapters, traverse, worker, and analyzers.
 * Responsibilities: Declare NodeKind and NormalizedNode semantic flags (scope, metric, literal);
 *     define LanguageAdapter, ProjectionPolicy, NodeProjector, ReusedSpan, and ProjectionSeed.
 * Exit Semantics & Design Rationale: Pure contract module with no I/O, no throws, and zero
 *     per-parse allocation. Precomputed flags keep analyzers parser-agnostic.
 *     See docs/02-parsers-and-ast/01-multilang-abstraction.md for architectural specifications.
 */

/** Language-independent node classification used by analyzers (never `ts.SyntaxKind`). */
export enum NodeKind {
    SourceFile = 'SourceFile',
    Function = 'Function', // Standalone function / fn / arrow function / closure
    Method = 'Method', // Method declared inside a struct / impl / trait / class
    Struct = 'Struct',
    Class = 'Class',
    Impl = 'Impl', // Rust impl / TypeScript class implementation block
    Trait = 'Trait', // Rust trait / behavioral TypeScript interface
    Interface = 'Interface',
    Variable = 'Variable', // let / var binding
    Constant = 'Constant', // const binding
    Field = 'Field', // Struct field / class field
    NumericLiteral = 'NumericLiteral',
    StringLiteral = 'StringLiteral',
    Literal = 'Literal', // Generic literal when no more specific kind applies
    Call = 'Call',
    BinaryExpr = 'BinaryExpr',
    ControlFlow = 'ControlFlow', // if/for/while/match/switch
    Block = 'Block',
    Other = 'Other',
}

/** 1-based line/column position (same convention as core/types Position). */
export interface Position {
    line: number;
    column: number;
}

/**
 * Language-agnostic AST node with precomputed semantic flags for zero-allocation scope descent.
 * Adapters precompute flags at parse time so engine and analyzers remain parser-agnostic.
 */
export interface NormalizedNode {
    kind: NodeKind;
    /** Language-native kind string (ts.SyntaxKind name / tree-sitter node type). */
    rawKind?: string;
    /** Source text of this node, lazily populated for literal nodes. */
    text?: string;
    /** Node start/end positions (1-based line/column), populated for literals and functions. */
    start?: Position;
    end?: Position;
    /** Declaration or identifier name when applicable. */
    name?: string | null;
    isNumeric?: boolean;
    isString?: boolean;
    /** True when this node's initializer is function-like. */
    hasFunctionInitializer?: boolean;
    /** Cyclomatic decision-point weight (default 0). */
    branchWeight?: number;
    /** Precomputed children populated by adapter. */
    children?: NormalizedNode[];

    // ---- Engine scope-descent flags ----
    /** Function-like unit boundary (function / method / arrow / closure). */
    functionLike?: boolean;
    /** Class/struct/impl/trait: children inherit className = name. */
    isClassDefining?: boolean;
    /** Introduces binding: children inherit binding = name. */
    introducesBinding?: boolean;
    /** Binding name introduced by this node. */
    bindingName?: string | null;
    /** Control/block node: children sit one nesting level deeper. */
    increasesNesting?: boolean;

    // ---- Metric and analyzer flags ----
    /** Top-level declaration (direct child of source file). */
    topLevel?: boolean;
    /** Top-level and exported declaration. */
    exported?: boolean;
    /** Literal bound by const declaration or enum member. */
    isConstBound?: boolean;
    /** Literal in tolerated context (property key, index, i18n, import path). */
    tolerated?: boolean;
    /** Constructor declaration for complexity naming. */
    isConstructor?: boolean;
}

/**
 * Root wrapper returned by every adapter's parse method.
 */
export interface NormalizedAst {
    root: NormalizedNode;
}

/**
 * Projection policy describing which normalized fields analyzers require on fast path.
 * See docs/02-parsers-and-ast/03-lazy-projection.md for strategy details.
 */
export interface ProjectionPolicy {
    /** Whether function subtrees need branchWeight/children for complexity analysis. */
    needComplexity: boolean;
    /** Whether literal nodes need full projection for constants analysis. */
    needLiterals: boolean;
    /** Whether function/class/binding nodes need identifier names. */
    needNames: boolean;
    /** Whether nodes require start/end source positions. */
    needPositions: boolean;
    /** Request declaration names/positions for cross-file symbol index. */
    needSymbols?: boolean;
}

/**
 * Language-agnostic on-demand projection interface for streaming traversal.
 */
export interface NodeProjector {
    /** Root raw node (the SourceFile). */
    readonly root: unknown;
    /**
     * Projects a raw parser node into a NormalizedNode on demand.
     */
    project(
        raw: unknown,
        parentRaw: unknown | undefined,
        grandparentRaw: unknown | undefined,
    ): NormalizedNode;
    /**
     * Iterates a raw node's children in materialized source order.
     */
    forEachChild(raw: unknown): Iterable<unknown>;
    /**
     * Tests whether raw node is the source-file root.
     */
    isSourceFile(raw: unknown): boolean;
}

/** Shared fallback Other node singleton (zero allocation per use). */
export const FALLBACK_OTHER_NODE: NormalizedNode = Object.freeze({ kind: NodeKind.Other });
/** Shared fallback Other node placeholder. */
export const OTHER_PLACEHOLDER: NormalizedNode = Object.freeze({ kind: NodeKind.Other });

/**
 * Position and source text of a function subtree for incremental reuse.
 */
export interface ReusedSpan {
    startLine: number;
    startColumn: number;
    startByte: number;
    endByte: number;
    sourceText: string;
}

/**
 * Optional seed threaded into LanguageAdapter.parse for line-level incremental reuse.
 */
export interface ProjectionSeed {
    /** Return cached normalized children on an exact span/text hit, or null. */
    reuseSubtree(span: ReusedSpan): NormalizedNode[] | null;
    /** Record a function's normalized children under its byte span for next scan. */
    cacheSubtree(span: ReusedSpan, children: NormalizedNode[]): void;
    /** Signal recording node as a reused function for analyzer-memo caching. */
    markReused?(node: NormalizedNode, span: ReusedSpan): void;
}

/**
 * Unified contract implemented by every language parser adapter.
 */
export interface LanguageAdapter {
    /** Unique adapter identifier used in registry and configurations. */
    id: string;
    /** File extensions claimed by this adapter (lowercase with leading dot). */
    extensions: string[];
    /** Parse source content into a normalized AST root. */
    parse(content: string, filePath: string, seed?: ProjectionSeed): NormalizedAst;
    /** Optional fast path creating a lazy node projector. */
    project?(content: string, filePath: string, policy: ProjectionPolicy): NodeProjector | null;
    /** Return the source-file root node of a parsed AST. */
    root(ast: NormalizedAst): NormalizedNode;
    /** Return direct children of a normalized node in source order. */
    children(node: NormalizedNode): NormalizedNode[];
}
