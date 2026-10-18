/**
 * Module: Core Engine — Declarative Structural Pattern & Rewrite Contracts
 * File Path: src/core/pattern/types.ts
 * Architecture Role: Canonical contract declarations for structural AST pattern matching,
 *   metavariable capture, template rewrite synthesis, and actionable refactoring patches.
 * Dependencies & Triggers: Pure type definitions consumed by StructuralPatternEngine,
 *   facades, analyzers, and unit test suites.
 * Responsibilities:
 *   1. Define PatternSpec schema for declarative GritQL-inspired rewrite rules;
 *   2. Define MetavariableBinding and StructuralMatch structures for captured AST nodes;
 *   3. Define RewriteResult and ActionablePatch models with unified diff specifications.
 * Exit Semantics & Design Rationale: Exclusively exports pure TypeScript interfaces and
 *   type aliases to guarantee zero runtime cycles and compile-time immutability contracts.
 */

/**
 * Textual span and 1-indexed line/column boundaries within a source document.
 */
export interface SourceRange {
    /** 0-indexed character offset where the span starts. */
    readonly start: number;
    /** 0-indexed character offset where the span ends. */
    readonly end: number;
    /** 1-indexed line number of the start coordinate. */
    readonly startLine: number;
    /** 1-indexed column number of the start coordinate. */
    readonly startCol: number;
    /** 1-indexed line number of the end coordinate. */
    readonly endLine: number;
    /** 1-indexed column number of the end coordinate. */
    readonly endCol: number;
}

/**
 * Captured value and location of an AST metavariable (such as `$VAR`, `$COND`, `$_`).
 */
export interface MetavariableBinding {
    /** Canonical metavariable identifier, including the leading '$' sign. */
    readonly name: string;
    /** Exact source text captured for this metavariable occurrence. */
    readonly value: string;
    /** SyntaxKind name of the captured AST node. */
    readonly nodeKind?: string;
    /** Coordinate boundary of the captured AST node. */
    readonly range: SourceRange;
}

/**
 * Filter predicate or pattern constraint applied to a captured metavariable.
 */
export interface MetavariableConstraint {
    /** Required TypeScript AST SyntaxKind name (e.g. 'Identifier', 'NumericLiteral'). */
    readonly kind?: string;
    /** Value that the captured string must NOT equal. */
    readonly notEquals?: string;
    /** Regular expression pattern that the captured string must satisfy. */
    readonly regex?: RegExp | string;
    /** Custom deterministic predicate evaluating the metavariable binding. */
    readonly predicate?: (binding: MetavariableBinding) => boolean;
}

/**
 * Granularity kind determining how the pattern AST is rooted and matched.
 */
export type PatternKind = 'auto' | 'expression' | 'statement';

/**
 * Declarative rule specification defining search pattern and rewrite template.
 */
export interface PatternSpec {
    /** Unique rule identifier for tracking and reporting. */
    readonly id: string;
    /** Human-readable explanation of the refactoring transformation. */
    readonly description?: string;
    /** Structural AST search pattern containing metavariables ($VAR, $COND, $_). */
    readonly pattern: string;
    /** Replacement template string substituting captured metavariables. */
    readonly rewrite: string;
    /** Pattern kind explicitly specifying expression or statement granularity. */
    readonly kind?: PatternKind;
    /** Source language target (defaults to TypeScript/TSX). */
    readonly language?: string;
    /** Optional metavariable constraints (where clauses) filtering candidates. */
    readonly where?: Readonly<Record<string, MetavariableConstraint>>;
}

/**
 * Successfully matched AST occurrence with captured bindings and synthesized rewrite.
 */
export interface StructuralMatch {
    /** Identifier of the originating rewrite rule. */
    readonly ruleId: string;
    /** Source coordinate boundaries of the matched AST node in the target document. */
    readonly range: SourceRange;
    /** Exact verbatim source code substring matched by the pattern. */
    readonly matchedText: string;
    /** Map of metavariable name to its captured AST binding. */
    readonly bindings: Readonly<Record<string, MetavariableBinding>>;
    /** Synthesized replacement string ready for text substitution. */
    readonly replacementText: string;
}

/**
 * Discrete coordinate-based text modification for IDE/agent execution.
 */
export interface PatchEdit {
    /** 1-indexed coordinate range targeting the text to be replaced. */
    readonly range: {
        readonly startLine: number;
        readonly startCol: number;
        readonly endLine: number;
        readonly endCol: number;
    };
    /** New replacement text string replacing the target range. */
    readonly newText: string;
}

/**
 * Actionable refactoring patch model compatible with CLI and IDE apply protocols.
 */
export interface ActionablePatch {
    /** Originating rule identifier. */
    readonly ruleId: string;
    /** Human-readable description or title of the refactoring action. */
    readonly title: string;
    /** Collection of non-overlapping text edits implementing the patch. */
    readonly edits: readonly PatchEdit[];
    /** Standard unified diff patch representing the cumulative change. */
    readonly unifiedPatch: string;
}

/**
 * Comprehensive outcome emitted by pattern matching and rewriting executions.
 */
export interface RewriteResult {
    /** Boolean flag indicating whether at least one match was transformed. */
    readonly hasChanged: boolean;
    /** Original source code prior to rewriting. */
    readonly originalSource: string;
    /** Transformed source code after all non-overlapping rewrites are applied. */
    readonly rewrittenSource: string;
    /** List of all individual structural matches discovered and applied. */
    readonly matches: readonly StructuralMatch[];
    /** Structured actionable patch payload containing edits and diff. */
    readonly patch: ActionablePatch;
    /** Standard unified diff patch string. */
    readonly unifiedDiff: string;
    /** Number of transformation rounds executed until fixpoint. */
    readonly roundsApplied?: number;
}

/**
 * Execution options tuning pattern matching and diff generation.
 */
export interface MatchAndRewriteOptions {
    /** Virtual or relative file path embedded into diff headers. */
    readonly filePath?: string;
    /** Maximum number of replacements to apply in a single pass. */
    readonly maxReplacements?: number;
    /** Maximum transformation rounds to execute until fixpoint (default: 1, max: 5). */
    readonly maxRounds?: number;
}
