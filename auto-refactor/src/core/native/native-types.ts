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
     * Inspects active engine status and capabilities.
     */
    getStatus(): NativeCoreStatus;
}
