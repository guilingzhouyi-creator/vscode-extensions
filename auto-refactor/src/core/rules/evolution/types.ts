/**
 * Module: Core Rules — Evolution & Generalization Types
 * File Path: src/core/rules/evolution/types.ts
 * Architecture Role: Defines domain types and contracts for the rule generalization pipeline,
 *   candidate lifecycle state machines, multi-language verification fixtures, and 4-tier
 *   generalization scrutiny models.
 * Dependencies & Triggers: Consumes core types and rule family types; imported by candidate
 *   management, pattern normalizer, and generalization pipeline.
 * Responsibilities: Declare GeneralizationLevel, CandidateLifecycleStatus, RuleCandidate,
 *   MultiLangFixture, ScrutinyRecord, and evaluation result models.
 * Exit Semantics & Design Rationale: Pure types and contracts without runtime side-effects.
 */

import type { AnalyzerId } from '../../types';
import type { RuleFamily } from '../types';

/**
 * 4-level generalization scrutiny hierarchy.
 * Governs whether a pattern candidate qualifies for global production admission.
 */
export type GeneralizationLevel =
    | 'project_specific' // Tier 0: Single project / repository convention (not eligible)
    | 'language_specific' // Tier 3 (Layer 3): Dialect / language idiomatic constraint
    | 'language_family' // Tier 2 (Layer 2): Paradigm / runtime family (e.g. exception handling)
    | 'universal'; // Tier 1 (Layer 1): Paradigm-agnostic architecture / hygiene principle

/** Lifecycle status for a rule candidate within the evolution pipeline. */
export type CandidateLifecycleStatus =
    'draft' | 'under_scrutiny' | 'promoted' | 'rejected' | 'graduated';

/** Evidence and assessment gathered during candidate scrutiny review. */
export interface CandidateScrutinyRecord {
    candidateId: string;
    evaluatedLevel: GeneralizationLevel;
    falsePositiveRisk: 'low' | 'medium' | 'high';
    performanceOverhead: 'negligible' | 'low' | 'moderate';
    justification: string;
    universalAcrossLanguages: readonly string[];
    reviewedAt: string;
}

/** Multi-language verification test fixture for cross-language validation. */
export interface MultiLangFixture {
    language: 'typescript' | 'javascript' | 'python' | 'rust' | 'gdscript' | 'go';
    negativeSample: string;
    positiveSample: string;
    description: string;
}

/** Rule Candidate tracking entity extracted from refactoring trajectories or audits. */
export interface RuleCandidate {
    id: string;
    canonicalRuleId: string;
    title: string;
    family: RuleFamily;
    targetAnalyzer: AnalyzerId;
    level: GeneralizationLevel;
    status: CandidateLifecycleStatus;
    origin: string;
    badPattern: string;
    goodPattern: string;
    fixtures: readonly MultiLangFixture[];
    scrutiny?: CandidateScrutinyRecord;
}

/** Result of executing 4-tier generalization evaluation on a candidate. */
export interface ScrutinyEvaluationResult {
    candidateId: string;
    passed: boolean;
    determinedLevel: GeneralizationLevel;
    eligibleForPromotion: boolean;
    rejectionReason?: string;
}

/** Result emitted when a candidate is promoted to production status. */
export interface PromotionResult {
    candidateId: string;
    canonicalRuleId: string;
    promotedAt: string;
    targetAnalyzer: AnalyzerId;
    ruleLayer: 'layer1_universal' | 'layer2_family' | 'layer3_dialect';
    verifiedLanguages: readonly string[];
}
