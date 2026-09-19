/**
 * Module: Core Engine — Universal Rule Hierarchy & Pyramid Types
 * File Path: src/core/rules/pyramid/types.ts
 * Architecture Role: Formalizes the three-tier rule pyramid (Layer 1 Universal, Layer 2
 *   Language Family, Layer 3 Dialect Specific) mapping universal architecture and lifecycle
 *   rules cleanly onto the underlying SemanticGraph.
 * Dependencies & Triggers: Consumes Issue from core/types and SemanticGraph from core/semantic.
 * Responsibilities: Declare RuleLayer classification, evaluation context, and universal
 *   semantic rule execution contracts.
 * Exit Semantics & Design Rationale: Standardizes cross-language review rules without
 *   fracturing existing 136-rule contracts or creating disconnected audit silos.
 */

import type { Issue } from '../../types';
import type { SemanticGraph } from '../../semantic/semanticGraph';

/**
 * Three-tier architectural hierarchy for code governance and review rules.
 */
export type RuleLayer =
    | 'layer1_universal' // Language-agnostic (topology, lifecycle symmetry, clean architecture)
    | 'layer2_family' // Language-family level (static type systems, garbage-collected runtimes)
    | 'layer3_dialect'; // Concrete language/syntax specific (idioms, decorators, macro patterns)

/**
 * Evaluation context supplied to universal semantic rules.
 */
export interface UniversalEvaluationContext {
    /** Target repository or workspace root directory */
    rootDir?: string;
    /** Current file path under review, if scoped to a single file */
    currentFilePath?: string;
    /** Optional baseline issues for ratchet diff suppression */
    baselineIssueIds?: ReadonlySet<string>;
}

/**
 * Universal semantic rule definition executing against the unified code graph.
 */
export interface UniversalSemanticRule {
    /** Canonical rule identifier (e.g. clean-layer-violation, import-cycle) */
    id: string;
    /** Human-readable title */
    name: string;
    /** Hierarchy tier */
    layer: RuleLayer;
    /** Default issue severity */
    defaultSeverity: 'error' | 'warning' | 'info';
    /** English explanation of the rule rationale */
    description: string;
    /**
     * Evaluates the graph and returns detected issues conforming to the standard Issue contract.
     */
    evaluate(graph: SemanticGraph, context: UniversalEvaluationContext): Issue[];
}
