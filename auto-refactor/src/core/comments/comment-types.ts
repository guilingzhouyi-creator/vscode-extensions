/**
 * Module: Core Engine - Comment Governance & Density Type System
 * File Path: src/core/comments/comment-types.ts
 * Architecture Role: Strongly typed contracts for project-level comment language profiling,
 *   9-dimensional effective comment density (ECD-C), and semantic intent matching.
 * Dependencies & Triggers: Consumes FineGrainedFileRole from intelligence; consumed by
 *   project-comment-profiler, comment-density-model, and comments analyzer.
 * Responsibilities: Declare language distribution models, comment categories, metrics,
 *   and governance options.
 * Exit Semantics & Design Rationale: Pure contract module; zero runtime overhead.
 */

import type { FineGrainedFileRole } from '../intelligence/file-role-inference';

/** Normalized comment language classifications */
export type CommentLanguageKind = 'en' | 'zh-CN' | 'bilingual';

/** Language distribution and statistical balance model */
export interface LanguageDistribution {
    /** Total number of detected CJK ideographs */
    cjkChars: number;
    /** Total number of detected Latin words */
    latinWords: number;
    /** Relative CJK character ratio in [0.00, 1.00] */
    cjkRatio: number;
    /** Relative Latin word ratio in [0.00, 1.00] */
    latinRatio: number;
    /** Inferred dominant comment language */
    dominantLanguage: CommentLanguageKind;
    /** Language fragmentation and drift entropy in [0.00, 1.00] */
    driftEntropy: number;
}

/** 9-dimensional taxonomic categories for comment substantive value */
export type CommentCategory =
    | 'DESIGN_RATIONALE'
    | 'ARCHITECTURE_INTENT'
    | 'ALGORITHMIC_PROOF'
    | 'LIFECYCLE_OWNERSHIP'
    | 'INVARIANT_BOUNDARY'
    | 'API_CONTRACT'
    | 'TRIVIAL_TRANSLATION'
    | 'BEHAVIOR_ECHO'
    | 'WATER_LOGGING';

/** Analysis record for an individual extracted comment block */
export interface CommentSnippetAnalysis {
    line: number;
    text: string;
    category: CommentCategory;
    weight: number;
    isWaterLogging: boolean;
    reason: string;
}

/** File-level Effective Comment Density (ECD-C) metrics */
export interface EffectiveCommentMetrics {
    /** Total physical comment lines */
    totalCommentLines: number;
    /** Weighted substantive comment line count */
    effectiveCommentLines: number;
    /** Effective Comment Ratio: effectiveCommentLines / totalCommentLines */
    effectiveCommentRatio: number;
    /** Flag indicating severe water-logging or tautological padding */
    hasWaterLogging: boolean;
    /** Hit count distribution across all 9 comment categories */
    categoryCounts: Record<CommentCategory, number>;
    /** Fine-grained breakdown of individual comment snippets */
    snippets: CommentSnippetAnalysis[];
}

/** Project-level and domain-specific comment ecosystem profile */
export interface ProjectCommentProfile {
    /** Total number of analyzed source files */
    totalFilesScanned: number;
    /** Inferred global dominant comment language */
    globalDominantLanguage: CommentLanguageKind;
    /** Repository-wide aggregated language distribution */
    overallDistribution: LanguageDistribution;
    /** Submodule and domain-specific language distributions */
    domainDistributions: Map<string, LanguageDistribution>;
}

/** Options configuring comment governance and density evaluation */
export interface CommentGovernanceOptions {
    /** Enforce comment language alignment with project convention */
    enforceDominantLanguage?: boolean;
    /** Minimum allowable effective comment density ratio (default: 0.40) */
    minEffectiveCommentRatio?: number;
    /** Explicit target language override */
    targetDominantLanguage?: CommentLanguageKind;
    /** Architectural role of the target file */
    fileRole?: FineGrainedFileRole;
}
