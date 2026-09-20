/**
 * Module: Core Engine — Semantic Evidence & Test Modernity Types
 * File Path: src/core/semantic-types.ts
 * Architecture Role: Shared evidence and metric shapes for the semantic and test-modernity
 *   analyzer packs, split out of the central types module to keep it inside the size budget.
 * Dependencies & Triggers: ./types (nested location/evidence shapes); imported by the analyzers
 *   and re-exported from ./types so existing importers keep working unchanged.
 * Responsibilities: Declare the step, review-detail, metric-summary, and debt-ticket contracts.
 * Exit Semantics & Design Rationale: Type-only module — no runtime code, no side effects; the
 *   re-export in ./types preserves the single-import-path contract for every consumer.
 */
import type { Severity } from './types';

/**
 * A discrete step in a semantic evidence chain (Section VII evidence trace).
 */
export interface SemanticEvidenceStep {
    /** Nature of the evidence step (call, variable read/write, loop, allocation, IO, check). */
    kind: 'call' | 'variable' | 'loop' | 'allocation' | 'io' | 'condition';
    /** Detailed description of what occurred at this step. */
    description: string;
    /** Relative file path where the step occurs. */
    file: string;
    /** 1-based source code line if available. */
    line?: number;
    /** Code symbol (function, method, class, or variable) associated with this step. */
    symbol?: string;
}

/**
 * Rich enterprise review details adhering strictly to Section VII of the review architecture.
 * Embedded inside Issue.detail so canonical schemas remain backward-compatible.
 */
export interface SemanticReviewDetail {
    /** Target programming language (e.g. 'typescript', 'python', 'rust', 'gdscript'). */
    language: string;
    /** Sub-project or partition module name. */
    module: string;
    /** Function, class, method, or declaration symbol under review. */
    symbol: string;
    /** Business code domain (e.g. 'order-orchestration', 'scanner-core', 'inventory'). */
    codeDomain: string;
    /** Description of current runtime or static code behavior. */
    currentBehavior: string;
    /** Ordered chain of semantic evidence facts proving the finding. */
    semanticEvidenceChain: SemanticEvidenceStep[];
    /** Precise static analysis condition that triggered this rule. */
    triggerCondition: string;
    /** Concrete operational, architectural, or performance risk. */
    risk: string;
    /** Blast radius / affected downstream boundaries. */
    blastRadius: string[];
    /** Whether the finding is statically proven (true) or heuristic/probabilistic (false). */
    isDeterministic: boolean;
    /** Whether manual review is required before taking remediation action. */
    requiresManualConfirm: boolean;
    /** Suggested architectural or code refactoring direction. */
    suggestedFix: string;
    /** Known callers impacted by the proposed remediation. */
    impactedCallers: string[];
    /** Test suites or contract verification tests that should guard this change. */
    impactedTests: string[];
    /** Recommended testing or benchmarking verification method. */
    verificationMethod: string;
    /** Rule specification version. */
    ruleVersion: string;
    /** Active engine configuration version. */
    configVersion: string;
    /** Whether automated safe refactoring is permitted for this issue. */
    canAutofix: boolean;
    [key: string]: unknown;
}

/**
 * Metric summary record for Effective Modern Test Density (EMTD) and contract coverage.
 */
export interface TestModernityMetricSummary {
    /** Effective Modern Test Density score (0..1000+). */
    emtd: number;
    /** Current Business Contract Coverage Rate fraction (0.0..1.0). */
    cbcr: number;
    /** Active non-comment, non-fixture test code lines. */
    activeTestNloc: number;
    /** Count of active business semantic units. */
    activeSemanticUnits: number;
    /** Count of covered semantic units. */
    coveredSemanticUnits: number;
}

/**
 * Technical debt ticket recording delayed test coverage with milestone convergence.
 */
export interface TestDebtTicket {
    /** Affected business or architectural domain. */
    domain: string;
    /** Severity / risk grade of the deferred test coverage. */
    riskLevel: Severity;
    /** Responsible agent or team identity. */
    owner: string;
    /** Target milestone for full test convergence. */
    targetMilestone: string;
    /** Latest acceptable deadline or convergence boundary. */
    deadline: string;
    /** Temporary invariant safeguards currently in place. */
    temporarySafeguards: string[];
}

/**
 * Uncertainty and empirical evidence metadata attached to an issue finding.
 * Allows downstream reviewers/agents/CI to distinguish mathematically proven
 * static bugs from probabilistic or runtime-dependent warnings.
 */
