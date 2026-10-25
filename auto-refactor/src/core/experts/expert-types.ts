/**
 * Module: Core Experts - MoE Expert Profile & Activation Contract
 * File Path: src/core/experts/expert-types.ts
 * Architecture Role: Canonical type definitions and domain contracts for the MoE
 *   Expert Activation Library. Unifies expert identity, 32-bit single-word bitmasks,
 *   activation affinities, execution/serving profiles, and governance metadata.
 * Dependencies & Triggers: Consumed by expert-catalog, expert-activation-library,
 *   router, scanner, and daemon.
 * Responsibilities:
 *   1. Define MoEExpertProfile as the single source of truth for all 32 experts;
 *   2. Define activation affinities (signals, categories, archetypes, languages, slice triggers);
 *   3. Define serving and resource policies (tracks, shared status, memory tiering, cost/weights);
 *   4. Define governance dimensions and security family constraints.
 * Exit Semantics & Design Rationale: Pure compile-time type definitions with zero runtime overhead.
 */

import type { AnalyzerBit } from '../constants/analyzer-bitmask';
import type { ProjectArchetype } from '../types';
import type { DiffSemanticCategory, SliceFeatureVector } from '../router/sliceTypes';
import type { QualityDimension } from '../scoring/scoringTypes';

/** Architectural domain classifications for MoE experts. */
export type ExpertDomain =
    | 'hygiene'
    | 'security'
    | 'ast'
    | 'topology'
    | 'concurrency'
    | 'system'
    | 'quality'
    | 'lexical';

/** Execution pipeline track designation (fast synchronous, deep asynchronous, or bypassed). */
export type ExecutionTrack = 'fast' | 'deep' | 'off';

/** Error and timeout fallback policy for MoE expert scheduling. */
export type FallbackStrategy = 'escalate-deep' | 'block' | 'skip';

/** Serving memory caching tier for disaggregated inference. */
export type MemoryTier = 'resident' | 'offload';

/** Discriminant keys of AST slice feature vectors. */
export type SliceFeatureKey = keyof SliceFeatureVector;

/**
 * Mutation signals derived from diff analysis for sparse routing.
 */
export type MutationSignal =
    | 'LITERAL'
    | 'GENERAL_CODE'
    | 'INTERFACE_SIGNATURE'
    | 'CONTROL_FLOW'
    | 'IMPORT_EXPORT'
    | 'TYPE_DECLARATION'
    | 'COMMENT_ONLY'
    | 'COMMENT_DOC_ONLY'
    | 'DOC_COMMENT'
    | 'CONCURRENCY'
    | 'DATA_STRUCTURE'
    | 'NON_SOURCE'
    | 'INSTRUCTION_SURFACE'
    | 'MANIFEST'
    | 'CONFIG_SECURITY'
    | 'IO'
    | 'DELETION'
    | 'ASYNC'
    | 'AGENT_METADATA'
    | 'UNKNOWN';

/**
 * Activation affinities governing when and where an MoE expert is activated.
 */
export interface ExpertActivationAffinities {
    /** Signals extracted from source diff that trigger this expert. */
    readonly signals: readonly MutationSignal[];
    /** Semantic diff categories where this expert participates. */
    readonly categories: readonly DiffSemanticCategory[];
    /** Project archetypes where this expert is active (demo, web, game, library, etc.). */
    readonly archetypes: readonly ProjectArchetype[];
    /** Language exclusivity. Undefined/empty indicates a universal language-agnostic expert. */
    readonly languages?: readonly string[];
    /** AST slice feature triggers that activate this expert in localized slice review. */
    readonly sliceTriggers: readonly SliceFeatureKey[];
}

/**
 * Serving and execution profile for an MoE expert aligned with DeepInfer serving architecture.
 */
export interface ExpertServingProfile {
    /** Execution track (FastTrack < 15ms or asynchronous DeepTrack). */
    readonly track: ExecutionTrack;
    /** True if this expert is an N_shared baseline expert (always retained across any mutation). */
    readonly isShared: boolean;
    /** KTransformers-style memory tiering: hot resident pool vs cold on-demand offload. */
    readonly memoryTier: MemoryTier;
    /** Microsecond steady-state execution cost profile. */
    readonly steadyCostUs: number;
    /** Priority weight for capacity-gated Top-k routing. */
    readonly weight: number;
    /** Base routing score calculated as Math.round((weight * 1000) / max(1, steadyCostUs)). */
    readonly baseScore: number;
    /** Fallback strategy when budget is exceeded or expert is bypassed. */
    readonly fallback: FallbackStrategy;
}

/**
 * Governance and quality classification metadata for an MoE expert.
 */
export interface ExpertGovernanceMetadata {
    /** Target scoring quality dimension. */
    readonly dimension: QualityDimension;
    /** True if this expert is non-default and requires explicit config or sparse routing. */
    readonly isSpecialized: boolean;
    /** True if this expert belongs to security family and strictly forbids 'skip' fallback. */
    readonly isSecurityFamily: boolean;
    /** Human-readable description of expert domain and responsibility. */
    readonly description: string;
}

/**
 * Canonical MoE Expert Profile unifying all expert attributes across the entire workspace.
 */
export interface MoEExpertProfile {
    /** Canonical string identifier (e.g. 'concurrency', 'complexity'). */
    readonly id: string;
    /** 32-bit single-word bitmask constant from AnalyzerBit SSOT. */
    readonly bit: AnalyzerBit;
    /** Zero-based bit index [0..31]. */
    readonly index: number;
    /** Expert primary architectural domain. */
    readonly domain: ExpertDomain;
    /** Activation affinities and conditions. */
    readonly affinities: ExpertActivationAffinities;
    /** Serving execution and resource lifecycle profile. */
    readonly serving: ExpertServingProfile;
    /** Governance, quality dimension, and safety constraints. */
    readonly governance: ExpertGovernanceMetadata;
}
