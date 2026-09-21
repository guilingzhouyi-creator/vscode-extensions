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

/** Universal Layer 1 rule tier identifier for cross-language rules. */
export const RULE_LAYER_UNIVERSAL = 'layer1_universal' as const;
/** Language Family Layer 2 rule tier identifier. */
export const RULE_LAYER_FAMILY = 'layer2_family' as const;
/** Dialect Specific Layer 3 rule tier identifier. */
export const RULE_LAYER_DIALECT = 'layer3_dialect' as const;

/**
 * Three-tier architectural hierarchy for code governance and review rules.
 */
export type RuleLayer =
    // Language-agnostic (topology, lifecycle symmetry, clean architecture)
    | typeof RULE_LAYER_UNIVERSAL
    // Language-family level (static type systems, garbage-collected runtimes)
    | typeof RULE_LAYER_FAMILY
    // Concrete language/syntax specific (idioms, decorators, macro patterns)
    | typeof RULE_LAYER_DIALECT;

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
