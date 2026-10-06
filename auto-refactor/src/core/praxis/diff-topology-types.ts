/**
 * Module: Core Engine — Praxis Three-Tier Topological Diff Types
 * File Path: src/core/praxis/diff-topology-types.ts
 * Architecture Role: Formal data contract and type definitions for Dual-Faced and Three-Tier
 *   Topological Diff architecture specified in Agent-Native System Blueprint §2.1.
 * Dependencies & Triggers: Consumes ReviewDiffHunk, AttributedDiffLine from ./contracts;
 *   consumes Issue from ../types; consumes SemanticGraph from ../semantic/semanticGraph.
 * Responsibilities:
 *   1. Declare Agent-Facing and Human/UI-Facing diff structures with symmetrical fidelity;
 *   2. Declare Layer 1 (Build Unit), Layer 2 (Review Cell), and Layer 3 (Conflict & Risk) schemas;
 *   3. Declare summary and input payload contracts for topological evaluation.
 * Exit Semantics & Design Rationale: Pure compile-time type definitions and contracts;
 *   zero runtime cost.
 */

import type { Issue } from '../types';
import type { ReviewDiffHunk } from './contracts';
import type { SemanticGraph } from '../semantic/semanticGraph';

// ============================================================================
// Dual-Faced Types: Agent Face & Human/UI Face
// ============================================================================

/**
 * Line offset mapping for an attributed diff line.
 */
export interface DiffAgentLineOffset {
    lineNoOld?: number;
    lineNoNew?: number;
    type: 'context' | 'insert' | 'delete';
}

/**
 * Agent-Facing representation of a diff hunk or slice.
 * Contains machine-actionable metadata, AST scope, line offsets,
 * deterministic patch instructions, and raw code slice.
 */
export interface DiffAgentFace {
    filePath: string;
    oldSpan: { startLine: number; lineCount: number };
    newSpan: { startLine: number; lineCount: number };
    enclosingSymbol?: string;
    symbolKind?: string;
    scopeRange?: { startLine: number; endLine: number };
    codeSlice: string;
    patchDirective: string;
    deterministicHunkId: string;
    exactLineOffsets: DiffAgentLineOffset[];
}

/** Visual badge color aligned with Praxis UI design tokens */
export type DiffBadgeColor = 'red' | 'yellow' | 'blue' | 'green';

/** Visual highlight category for UI rendering */
export type DiffVisualHighlight = 'added' | 'deleted' | 'modified' | 'conflict' | 'critical';

/** Risk severity level for diff hunks and overall review */
export type DiffRiskSeverity = 'block' | 'warn' | 'info' | 'pass';

/** Review decision action recommended for reviewers */
export type DiffReviewAction = 'accept' | 'auto_fix' | 'rework' | 'escalate_l3a' | 'reject';

/** Visual badge data model for status badges in Praxis UI */
export interface DiffDecisionBadge {
    text: string;
    color: DiffBadgeColor;
}

/**
 * Human/UI-Facing representation of a diff hunk for Praxis UI frontend.
 * Carries bilingual dictionary keys and localized texts, visual folding hierarchy,
 * syntax highlighting cues, risk severities, and actionable review decisions.
 */
export interface DiffHumanFace {
    hunkId: string;
    title: string;
    i18nKey: string;
    i18nMessage: {
        'zh-CN': string;
        en: string;
    };
    foldingLevel: number;
    visualHighlight: DiffVisualHighlight;
    riskSeverity: DiffRiskSeverity;
    suggestedReviewAction: DiffReviewAction;
    decisionBadge: DiffDecisionBadge;
    rationale?: string;
}

/**
 * Dual-Faced diff hunk joining machine-actionable Agent Face
 * and human-accessible UI Face with 100% data symmetry.
 */
export interface DualFacedDiffHunk {
    hunkId: string;
    agentFace: DiffAgentFace;
    humanFace: DiffHumanFace;
    rawHunk: ReviewDiffHunk;
}

// ============================================================================
// Three-Tier Topology Types: Layer 1, Layer 2, Layer 3
// ============================================================================

/**
 * AST node mapping entry linking physical line modifications to AST symbols.
 */
export interface DiffAstNodeMapping {
    symbolName: string;
    symbolKind: string;
    startLine: number;
    endLine: number;
    changedLines: number;
    hunkIds: string[];
}

/**
 * Layer 1: Build Execution Unit Diff.
 * Focuses on physical changed lines, add/delete/modification line counts,
 * and basic AST node mappings for execution agents within Cells.
 */
export interface DiffLayer1BuildUnit {
    filePath: string;
    totalChangedLines: number;
    additions: number;
    deletions: number;
    modifications: number;
    changedLineNumbers: number[];
    astNodeMappings: DiffAstNodeMapping[];
}

/**
 * Propagated semantic dependency node along a backward impact path.
 */
export interface SemanticPropagationNode {
    file: string;
    symbol?: string;
    distance: number;
    edgeKind: string;
}

/**
 * Architecture contract conflict detected in Layer 2.
 */
export interface DiffContractConflict {
    ruleId: string;
    severity: 'error' | 'warning' | 'info';
    message: string;
    sourceFile: string;
    targetFile?: string;
    violatingSymbol?: string;
}

/**
 * Layer 2: Review Cell Diff (Specialized Review Department).
 * Focuses on reverse dependency closures, semantic graph propagation,
 * architectural contract conflicts, and recommended qualitative verification.
 */
export interface DiffLayer2ReviewCell {
    filePath: string;
    impactFiles: string[];
    propagationPaths: SemanticPropagationNode[];
    contractConflicts: DiffContractConflict[];
    recommendedFocus: string[];
    requiredVerification: string[];
}

/**
 * Cross-layer dependency risk item detected in Layer 3.
 */
export interface DiffCrossLayerRisk {
    sourceFile: string;
    targetModule: string;
    riskDescription: string;
    ruleId: string;
}

/**
 * Destructive modification risk item detected in Layer 3.
 */
export interface DiffDestructiveRisk {
    kind: 'mass_deletion' | 'public_api_removal' | 'interface_breakage';
    description: string;
    affectedSymbols: string[];
    deletedLinesCount: number;
}

/**
 * Loop-internal transient heap allocation risk entry.
 */
export interface DiffLoopAllocationRisk {
    line: number;
    codeSnippet: string;
    riskKind: 'closure' | 'object_literal' | 'array_instantiation' | 'method_chaining';
    remediationAdvice: string;
}

/**
 * Git conflict marker entry detected in Layer 3.
 */
export interface DiffConflictMarker {
    line: number;
    markerType: 'start' | 'separator' | 'end';
    branchLabel?: string;
}

/**
 * Layer 3: Conflict & High-Risk Diff.
 * Pinpoints cross-layer architectural violations, mass destructive deletions,
 * loop-internal transient heap allocations, and unresolved git merge conflict markers.
 */
export interface DiffLayer3ConflictRisk {
    filePath: string;
    hasCriticalRisks: boolean;
    crossLayerRisks: DiffCrossLayerRisk[];
    destructiveModifications: DiffDestructiveRisk[];
    loopAllocations: DiffLoopAllocationRisk[];
    conflictMarkers: DiffConflictMarker[];
    blockingIssues: Issue[];
    shouldEscalateToL3A: boolean;
    escalationReasons: string[];
}

/**
 * High-level summary of the topological diff.
 */
export interface TopologicalDiffSummary {
    filePath: string;
    totalHunks: number;
    totalChangedLines: number;
    additions: number;
    deletions: number;
    overallRisk: DiffRiskSeverity;
    shouldEscalateToL3A: boolean;
    layer1Status: 'ready' | 'empty';
    layer2ImpactScope: 'isolated' | 'local' | 'wide' | 'critical';
    layer3RiskLevel: 'clean' | 'guarded' | 'hazardous' | 'blocking';
}

/**
 * Complete Three-Tier Topological Diff structure adhering to blueprint §2.1.
 */
export interface ThreeTierTopologicalDiff {
    filePath: string;
    layer1: DiffLayer1BuildUnit;
    layer2: DiffLayer2ReviewCell;
    layer3: DiffLayer3ConflictRisk;
    dualFacedHunks: DualFacedDiffHunk[];
    summary: TopologicalDiffSummary;
}

/**
 * Input configuration for constructing a topological diff.
 */
export interface TopologicalDiffInput {
    filePath: string;
    oldContent?: string;
    newContent?: string;
    hunks: ReviewDiffHunk[];
    issues?: Issue[];
    graph?: SemanticGraph;
    impactFiles?: string[];
}
