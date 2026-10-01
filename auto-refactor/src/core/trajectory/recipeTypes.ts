/**
 * Module: Core Engine - Refactoring Recipe & Trajectory Learning Contracts
 * File Path: src/core/trajectory/recipeTypes.ts
 * Architecture Role: Single source of truth for Refactoring Recipe extraction, Bad-to-Good
 *   trajectory knowledge synthesis, regression anomaly patterns, and Praxis learning contracts.
 * Dependencies & Triggers: Consumes QualityScoreBreakdown from ../scoring/scoringTypes and Issue
 *   from ../types; consumed by recipeExtractor, regressionTrajectoryDetector, and
 *   praxis/trajectoryLearningService.
 * Responsibilities: Define RecipeCategory, TransformOpKind, TransformOp, RecipePrecondition,
 *   RefactoringRecipe, TrajectoryLearningResult, and Praxis learning interaction types.
 * Exit Semantics & Design Rationale: Type declarations only; compile-time erased, zero runtime
 *   overhead and zero cyclical dependencies.
 */

import type { QualityScoreBreakdown } from '../scoring/scoringTypes';
import type { Issue } from '../types';

/** High-level architectural category of an extracted refactoring recipe */
export type RecipeCategory =
    | 'extract-method'
    | 'parameter-object'
    | 'strategy-dispatch'
    | 'defensive-guard'
    | 'concurrency-safe'
    | 'object-pool-lifecycle'
    | 'cas-reentrancy-guard'
    | 'config-cache-invalidation'
    | 'dto-context-aggregation'
    | 'hook-decoupling'
    | 'shim-elimination'
    | 'direct-modern-migration'
    | 'deprecation-lifecycle'
    | 'zero-cost-modernization'
    | 'interaction-debounce'
    | 'state-machine-discipline'
    | 'weakref-observer'
    | 'unidirectional-flow'
    | 'status-bar-component'
    | 'token-standardization'
    | 'screen-base-inheritance'
    | 'virtual-list-pooling'
    | 'i18n-localization'
    | 'explicit-node-unique'
    | 'presentation-decoupling'
    | 'modular-decomposition'
    | 'composite';

/** Specific transformation operator kind executed in a recipe */
export type TransformOpKind =
    | 'split-function'
    | 'introduce-parameter-object'
    | 'extract-strategy'
    | 'inject-null-guard'
    | 'wrap-try-catch'
    | 'introduce-object-pool'
    | 'inject-reset-state'
    | 'introduce-dto-context'
    | 'inject-cas-guard'
    | 'inject-cache-invalidation'
    | 'inject-hook-dispatch'
    | 'remove-stale-shim'
    | 'bypass-shim-to-direct'
    | 'inject-deprecated-annotation'
    | 'introduce-zero-cost-view'
    | 'inject-debounce-lock'
    | 'inject-transition-guard'
    | 'wrap-weakref-observer'
    | 'introduce-intent-command'
    | 'introduce-status-bar'
    | 'replace-color-token'
    | 'extend-base-screen'
    | 'introduce-virtual-list'
    | 'introduce-i18n-binding'
    | 'replace-relative-node-path'
    | 'isolate-domain-boundary'
    | 'split-companion-controller';

/**
 * Atomic structural code transformation operator.
 */
export interface TransformOp {
    opKind: TransformOpKind;
    targetSymbol: string;
    description: string;
    params?: Record<string, unknown>;
}

/**
 * Preconditions required for a code slice to match an extracted recipe.
 */
export interface RecipePrecondition {
    targetLanguage?: string;
    minComplexity?: number;
    minLines?: number;
    isAsync?: boolean;
    antiPatternTags: string[];
}

/**
 * Structured refactoring recipe synthesized from successful historical trajectories.
 */
export interface RefactoringRecipe {
    recipeId: string;
    name: string;
    category: RecipeCategory;
    description: string;
    precondition: RecipePrecondition;
    operations: TransformOp[];
    expectedQualityGain: number;
    sourceTrajectoryId?: string;
}

/**
 * Result of executing trajectory learning over a set of revisions or patches.
 */
export interface TrajectoryLearningResult {
    trajectoriesProcessed: number;
    extractedRecipes: RefactoringRecipe[];
    regressiveIssues: Issue[];
    totalQualityGain: number;
}

/**
 * Input payload sent to Praxis Trajectory Learning Service.
 */
export interface PraxisTrajectoryLearningInput {
    trajectoryId: string;
    filePath: string;
    beforeContent: string;
    afterContent: string;
    beforeScore?: QualityScoreBreakdown;
    afterScore?: QualityScoreBreakdown;
    language?: string;
    churnRatio?: number;
}

/**
 * Verdict produced by Praxis Trajectory Learning Service.
 */
export interface PraxisTrajectoryVerdict {
    hasBadToGoodImprovement: boolean;
    qualityDelta: number;
    qualityVelocity?: number;
    generalizationIndex?: number;
    extractedRecipe?: RefactoringRecipe;
    regressionIssues: Issue[];
    recommendations: RefactoringRecipe[];
    durationMs: number;
}
