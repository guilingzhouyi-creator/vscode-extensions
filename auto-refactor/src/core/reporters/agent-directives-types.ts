/**
 * Module: Core Reporting — Agent Directives Protocol & Multi-Agent Contracts
 * File Path: src/core/reporters/agent-directives-types.ts
 * Architecture Role: Strongly-typed protocol schema for machine-actionable Agent directives,
 *   structured envelopes, immutable constraints, and multi-agent collaborative payloads.
 * Dependencies & Triggers: Consumed by agent-review-reporter.ts, agentConstraintGenerator.ts,
 *   and autonomous agents for deterministic automated refactoring.
 * Responsibilities:
 *   1. Define AgentDirectiveSeverity, AgentTopologyLayer, and AgentTargetContext.
 *   2. Define AgentRuleContract with catalog-aligned rule IDs and factual root cause.
 *   3. Define AgentImmutableConstraints for purity, snapshots, budgets, and zero allocation.
 *   4. Define AgentRemediationRecipe and AgentVerificationDirective for targeted testing.
 *   5. Define AgentDirectiveEnvelope and AgentReviewDirectivesPayload for multi-agent workflows.
 * Exit Semantics & Design Rationale: Pure compile-time type definitions and immutable contracts;
 *   zero runtime overhead, 100% type-safe, CC = 0.
 */

/**
 * Directive severity levels strictly mapped for Agent prioritization and quality gates.
 */
export type AgentDirectiveSeverity = 'BLOCK' | 'WARN' | 'INFO';

/**
 * Architectural topology layer for deterministic ordering of refactoring batches.
 * L1_CONTRACT: Type definitions, interfaces, core abstractions, schemas.
 * L2_OPERATOR: Pure operators, AST transforms, calculation engines, complexity, performance.
 * L3_CONFIG: Configurations, options, environment, rule catalogs.
 * L4_PRESENTATION: UI, reporters, formatters, renderers, views.
 * L5_GOVERNANCE: Linter, gates, sanity, commit-msg, naming, comments, git hooks, docs.
 */
export type AgentTopologyLayer =
    'L1_CONTRACT' | 'L2_OPERATOR' | 'L3_CONFIG' | 'L4_PRESENTATION' | 'L5_GOVERNANCE';

/**
 * Target context providing precise location and surrounding code anchor slice.
 */
export interface AgentTargetContext {
    /** Target file path relative to workspace or repository root */
    readonly filePath: string;
    /** 1-indexed starting line number */
    readonly startLine: number;
    /** 1-indexed ending line number */
    readonly endLine: number;
    /** 1-indexed starting column number (optional) */
    readonly startColumn?: number;
    /** 1-indexed ending column number (optional) */
    readonly endColumn?: number;
    /** Surrounding code anchor slice carrying 2~3 lines of real surrounding context */
    readonly anchorCodeSlice?: string;
    /** Target symbol identifier or function name (optional) */
    readonly targetSymbol?: string;
}

/**
 * Rule contract stating rule identity, severity, topology layer, and factual root cause.
 */
export interface AgentRuleContract {
    /** Registered rule ID (must be catalogued in rule-catalog.json) */
    readonly ruleId: string;
    /** Diagnostic severity level */
    readonly severity: AgentDirectiveSeverity;
    /** Architectural topology layer */
    readonly topologyLayer: AgentTopologyLayer;
    /** Objective, non-hyperbolic technical root cause statement */
    readonly rootCause: string;
    /** Originating static analyzer identifier */
    readonly analyzer?: string;
}

/**
 * Immutable engineering constraints that must NOT be violated during remediation.
 */
export interface AgentImmutableConstraints {
    /** Whether function purity must be preserved (no hidden state mutations) */
    readonly preservesPurity: boolean;
    /** Zero transient heap allocation in hot loop bodies (ADV-PRF-002 / CPX-SPACE-001) */
    readonly zeroHeapAllocationInLoop: boolean;
    /** Immutable state snapshot requirement (Object.freeze / deep freeze / defensive copy) */
    readonly immutableStateSnapshot: boolean;
    /** Strict adherence to ELOC <= 900 and LOC <= 1400 dual-track budget (GATE-AST-001) */
    readonly elocBudgetConstraint: boolean;
    /** Prohibition against introducing external side effects or unsolicited dependencies */
    readonly noExternalSideEffects: boolean;
    /** List of explicit invariant rules and constraints to enforce */
    readonly contractRules: readonly string[];
}

/**
 * Deterministic remediation recipe providing concrete guidance and code templates.
 */
export interface AgentRemediationRecipe {
    /** Deterministic summary and procedural instruction for remediation */
    readonly remediationSummary: string;
    /** Proposed replacement pseudocode or AST template snippet */
    readonly templateSnippet?: string;
    /** Whether an automated Agent can safely apply this modification without human intervention */
    readonly safeToAutomate: boolean;
    /** Standard action verb (e.g., align_numeric_precision, apply_guard_clause) */
    readonly actionVerb?: string;
    /** Defect taxonomy code (e.g., NUM_PREC, CTRL_FLOW, ARCH_LAYER) */
    readonly taxonomy?: string;
}

/**
 * Targeted verification directive recommending exact qualitative test or gate commands.
 */
export interface AgentVerificationDirective {
    /** Targeted test or gate command to verify resolution (e.g., 'npm test' or 'pwsh -File ...') */
    readonly command: string;
    /** Technical rationale and description of what this verification confirms */
    readonly description: string;
    /** Qualitative acceptance assertions (zero regression, invariant satisfaction) */
    readonly assertionCriteria: readonly string[];
}

/**
 * Single actionable directive encompassing the five complete dimensions.
 */
export interface AgentActionableDirective {
    /** Unique directive identifier (e.g., 'DIR:NUM-PREC-001:src/score.ts:42') */
    readonly directiveId: string;
    /** ① Target context and code anchor slice */
    readonly targetContext: AgentTargetContext;
    /** ② Rule contract with registered rule ID, severity, topology layer and root cause */
    readonly ruleContract: AgentRuleContract;
    /** ③ Immutable engineering constraints (purity, budgets, zero allocations) */
    readonly immutableConstraints: AgentImmutableConstraints;
    /** ④ Deterministic remediation recipe with code template and automation flag */
    readonly remediationRecipe: AgentRemediationRecipe;
    /** ⑤ Precise verification command recommendation and qualitative criteria */
    readonly verificationDirective: AgentVerificationDirective;
}

/**
 * Structured directive envelope encapsulating directives for an entire scan run.
 */
export interface AgentDirectiveEnvelope {
    /** Directive protocol version (e.g., '2.0') */
    readonly protocolVersion: string;
    /** Envelope instance identifier */
    readonly envelopeId: string;
    /** ISO 8601 generation timestamp */
    readonly generatedAt: string;
    /** Audited repository or workspace root */
    readonly targetRoot: string;
    /** Overall gate verdict */
    readonly overallVerdict: AgentDirectiveSeverity | 'PASS';
    /** Ordered list of actionable directives */
    readonly directives: readonly AgentActionableDirective[];
}

/**
 * Builder Agent directive tailored for sequential code remediation.
 */
export interface AgentBuilderDirective {
    /** Directive identifier */
    readonly directiveId: string;
    /** Execution sequence index (topological order) */
    readonly sequence: number;
    /** Topology layer */
    readonly topologyLayer: AgentTopologyLayer;
    /** Target file path */
    readonly targetFile: string;
    /** Target line number */
    readonly line: number;
    /** Action verb */
    readonly action: string;
    /** Safe to automate flag */
    readonly safeToAutomate: boolean;
    /** Concise procedural instruction */
    readonly instruction: string;
    /** Remediation template snippet */
    readonly templateSnippet?: string;
    /** Guardrail constraints to adhere to */
    readonly constraints: readonly string[];
}

/**
 * Reviewer Agent cross-check point for independent validation and regression verification.
 */
export interface AgentReviewerCrossCheckPoint {
    /** Checkpoint identifier */
    readonly checkPointId: string;
    /** Target file under verification */
    readonly targetFile: string;
    /** Related registered rule ID */
    readonly relatedRule: string;
    /** Directive severity */
    readonly severity: AgentDirectiveSeverity;
    /** Precise command to execute for verification */
    readonly verificationCommand: string;
    /** Qualitative assertion criteria */
    readonly qualitativeAssertion: string;
    /** Topology layer */
    readonly topologyLayer: AgentTopologyLayer;
}

/**
 * Directives metrics summarizing distribution, layer coverage, and automation potential.
 */
export interface AgentDirectivesMetrics {
    /** Total number of actionable directives */
    readonly totalDirectives: number;
    /** Count of directives grouped by severity */
    readonly bySeverity: {
        readonly block: number;
        readonly warn: number;
        readonly info: number;
    };
    /** Count of directives grouped by topology layer */
    readonly byTopologyLayer: Record<AgentTopologyLayer, number>;
    /** Directives that can be safely automated without human supervision */
    readonly safeToAutomateCount: number;
    /** Ratio of safe automated directives (0.00 to 1.00) */
    readonly automationRatio: number;
    /** Unique affected files count */
    readonly affectedFilesCount: number;
}

/**
 * Multi-agent collaborative directives payload.
 * Provides builder instructions, reviewer cross-validation checkpoints, and summary metrics.
 */
export interface AgentReviewDirectivesPayload {
    /** Structured envelope containing raw actionable directives */
    readonly envelope: AgentDirectiveEnvelope;
    /** Sequential task items for Builder Agent execution */
    readonly builderDirectives: readonly AgentBuilderDirective[];
    /** Verification checkpoints for Reviewer Agent validation */
    readonly reviewerDirectives: readonly AgentReviewerCrossCheckPoint[];
    /** Summary metrics */
    readonly metrics: AgentDirectivesMetrics;
}
