/**
 * Module: Core Engine - Native Acceleration Types and Interfaces
 * File Path: src/core/native/native-types.ts
 * Architecture Role: Contract definitions for the native Rust acceleration core
 *   and pure JS fallback shim.
 * Dependencies & Triggers: Consumed by native-bridge.ts, execution schedulers, and diff pipelines.
 * Responsibilities: Declare interfaces for histogram diffs, graph topological analysis,
 *   AST pattern matching, and runtime engine status reporting.
 * Exit Semantics & Design Rationale: Pure type definitions; zero runtime overhead.
 */

/**
 * Identifier distinguishing compiled Rust native core from pure JS fallback shim.
 */
export type NativeCoreEngineType = 'rust-native' | 'pure-js-shim';

/**
 * Diagnostic status and telemetry for the active native acceleration layer.
 */
export interface NativeCoreStatus {
    readonly isNativeAvailable: boolean;
    readonly activeEngine: NativeCoreEngineType;
    readonly version?: string;
    readonly capabilities: string[];
}

/**
 * Structured diff hunk emitted by histogram diff computation.
 */
export interface NativeDiffHunk {
    readonly oldStart: number;
    readonly oldLines: number;
    readonly newStart: number;
    readonly newLines: number;
    readonly lines: string[];
}

/**
 * Topological dependency analysis outcome including cycles, ordering, and SCC components.
 */
export interface NativeGraphAnalysis {
    readonly cycles: string[][];
    readonly topologicalOrder: string[];
    readonly stronglyConnectedComponents: string[][];
    readonly isAcyclic: boolean;
}

/**
 * Result of fast AST or text token pattern matching.
 */
export interface NativePatternMatch {
    readonly pattern: string;
    readonly line: number;
    readonly column: number;
    readonly matchText: string;
}

/**
 * Lexical masking configuration consumed by the native source masking operator.
 */
export interface NativeMaskConfig {
    readonly lineComment: string;
    readonly blockCommentOpen?: string;
    readonly blockCommentClose?: string;
    readonly quoteChars: string;
    readonly multilineTemplates?: boolean;
    readonly regexLiterals?: boolean;
}

/**
 * Result of native source code masking including raw/masked lines and line counts.
 */
export interface NativeMaskedSource {
    readonly raw: string[];
    readonly masked: string[];
    readonly lines: number;
    readonly nonBlankLines: number;
}

/**
 * Detected intra-file code clone block.
 */
export interface NativeCloneBlock {
    readonly startLine: number;
    readonly originalLine: number;
    readonly lineSpan: number;
}

/**
 * Detected candidate clone file pair with similarity score.
 */
export interface NativeClonePair {
    readonly fileA: number;
    readonly fileB: number;
    readonly similarity: number;
}

/**
 * Dominator tree analysis result for a control-flow / dataflow graph.
 */
export interface NativeDominatorTreeResult {
    readonly entry: string;
    readonly reachableNodes: string[];
    readonly idom: Record<string, string>;
    readonly dominanceFrontiers: Record<string, string[]>;
    readonly loopHeaders: string[];
    readonly backEdges: Array<[string, string]>;
}

/**
 * Dataflow fixed-point solver parameters.
 */
export interface NativeDataflowParams {
    readonly entry: string;
    readonly nodes?: string[];
    readonly edges: Array<[string, string]>;
    readonly forward?: boolean;
    readonly gen?: Record<string, string[]>;
    readonly kill?: Record<string, string[]>;
}

/**
 * Dataflow fixed-point solver result.
 */
export interface NativeDataflowResult {
    readonly inSets: Record<string, string[]>;
    readonly outSets: Record<string, string[]>;
    readonly iterations: number;
}

/**
 * Unified interface implemented by both native Rust core and pure JS shim.
 */
export interface INativeCore {
    /**
     * Computes line-level histogram diff between old and new text.
     */
    computeHistogramDiff(oldContent: string, newContent: string): NativeDiffHunk[];

    /**
     * Analyzes directed dependency graph edges: [from, to] (where `from` depends on `to`).
     */
    analyzeDependencyGraph(edges: [string, string][]): NativeGraphAnalysis;

    /**
     * Performs fast pattern matching across source text.
     */
    fastPatternMatch(sourceText: string, patterns: string[]): NativePatternMatch[];

    /**
     * Masks comment and literal regions using the fast native SIMD masking operator.
     */
    maskSourceCode(content: string, config: NativeMaskConfig): NativeMaskedSource;

    /**
     * Counts duplicated non-blank lines in source content.
     */
    countDuplicateLines(content: string): number;

    /**
     * Detects repeated code blocks within a single file.
     */
    detectCloneBlocks(content: string, minCloneLines: number): NativeCloneBlock[];

    /**
     * Computes MinHash signature vector for a source file.
     */
    computeMinHash(content: string, numPermutations?: number): number[];

    /**
     * Discovers similar file pairs using Locality Sensitive Hashing (LSH).
     */
    findClonePairs(signatures: number[][], threshold: number): NativeClonePair[];

    /**
     * Computes the immediate dominator tree and dominance frontiers for a graph.
     */
    computeDominatorTree(
        entry: string,
        nodes: string[],
        edges: Array<[string, string]>,
    ): NativeDominatorTreeResult;

    /**
     * Solves forward or backward dataflow equations to a fixed point.
     */
    solveDataflow(params: NativeDataflowParams): NativeDataflowResult;

    /**
     * Inspects active engine status and capabilities.
     */
    getStatus(): NativeCoreStatus;
}


