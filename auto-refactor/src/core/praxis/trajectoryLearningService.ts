/**
 * Module: Core Engine - Praxis Trajectory Learning Service Facade
 * File Path: src/core/praxis/trajectoryLearningService.ts
 * Architecture Role: Strongly typed facade and SPI designed for the Praxis Diff & Refactoring
 *   subsystem team; delivers Bad-to-Good pattern extraction, refactoring recipe synthesis,
 *   recipe recommendation, and trajectory regression detection.
 * Dependencies & Triggers: Consumes recipeExtractor, regressionTrajectoryDetector, and recipeTypes;
 *   consumed by Praxis refactoring cells and public api barrel.
 * Responsibilities: Coordinate recipe extraction, maintain learned recipe knowledge base,
 *   recommend applicable recipes for target code slices, and identify cyclic regression issues.
 * Exit Semantics & Design Rationale: High-performance SPI facade; safe fallback on corrupt or
 *   empty inputs; never throws uncaught exceptions.
 */

import type {
    PraxisTrajectoryLearningInput,
    PraxisTrajectoryVerdict,
    RefactoringRecipe,
} from '../trajectory/recipeTypes';
import type { FileRevision } from '../trajectory/types';
import type { Issue } from '../types';
import type { TrajectoryRecipeExtractor } from '../trajectory/recipeExtractor';
import { defaultTrajectoryRecipeExtractor } from '../trajectory/recipeExtractor';
import type { RegressionTrajectoryDetector } from '../trajectory/regressionTrajectoryDetector';
import { defaultRegressionTrajectoryDetector } from '../trajectory/regressionTrajectoryDetector';

/**
 * Public service interface provided to the Praxis team for trajectory learning governance.
 */
export interface IPraxisTrajectoryLearningService {
    /**
     * Learn from a before/after trajectory revision pair, extracting reusable refactoring recipes.
     *
     * @param input - Trajectory input payload with before and after code snapshots.
     * @returns Detailed learning verdict including extracted recipe, delta score, and latency.
     */
    learnFromTrajectory(input: PraxisTrajectoryLearningInput): Promise<PraxisTrajectoryVerdict>;

    /**
     * Detect cyclic oscillations and regressions across a file's revision sequence.
     *
     * @param filePath - File path being tracked.
     * @param revisions - Chronological list of FileRevision records.
     * @returns Collection of GOV-TRJ-001 issues if regressions detected.
     */
    detectRegressions(filePath: string, revisions: FileRevision[]): Issue[];

    /**
     * Match learned refactoring recipes against candidate target code.
     *
     * @param code - Target candidate code to evaluate.
     * @param language - Optional language identifier.
     * @returns Array of applicable RefactoringRecipes.
     */
    matchRecipes(code: string, language?: string): RefactoringRecipe[];

    /**
     * Register a custom or externally learned refactoring recipe into the knowledge base.
     *
     * @param recipe - RefactoringRecipe descriptor.
     */
    registerRecipe(recipe: RefactoringRecipe): void;

    /**
     * Get all currently learned and registered refactoring recipes.
     *
     * @returns Readonly array of RefactoringRecipes.
     */
    getLearnedRecipes(): readonly RefactoringRecipe[];
}

/**
 * Implementation of the Praxis trajectory learning governance facade.
 */
export class PraxisTrajectoryLearningService implements IPraxisTrajectoryLearningService {
    private readonly extractor: TrajectoryRecipeExtractor;

    private readonly detector: RegressionTrajectoryDetector;

    private readonly recipeRegistry: Map<string, RefactoringRecipe> = new Map();

    /**
     * Initialize service with modular recipe extractor and regression detector.
     */
    constructor(
        extractor: TrajectoryRecipeExtractor = defaultTrajectoryRecipeExtractor,
        detector: RegressionTrajectoryDetector = defaultRegressionTrajectoryDetector,
    ) {
        this.extractor = extractor;
        this.detector = detector;
    }

    /**
     * Learn from a before/after trajectory revision pair.
     */
    public async learnFromTrajectory(
        input: PraxisTrajectoryLearningInput,
    ): Promise<PraxisTrajectoryVerdict> {
        const startTime = Date.now();

        const extractedRecipe = this.extractor.extractRecipeFromTrajectory(input);
        if (extractedRecipe) {
            this.registerRecipe(extractedRecipe);
        }

        const qualityDelta = this.calculateDelta(input);
        const hasImprovement = qualityDelta > 0 && extractedRecipe !== undefined;

        // Recommend existing recipes for the beforeContent if relevant
        const recommendations = this.matchRecipes(input.beforeContent, input.language);

        const durationMs = Math.max(1, Date.now() - startTime);

        return {
            hasBadToGoodImprovement: hasImprovement,
            qualityDelta,
            extractedRecipe,
            regressionIssues: [],
            recommendations,
            durationMs,
        };
    }

    /**
     * Detect cyclic oscillations and regressions across a file's revision sequence.
     */
    public detectRegressions(filePath: string, revisions: FileRevision[]): Issue[] {
        return this.detector.detectRegressions(filePath, revisions);
    }

    /**
     * Match learned refactoring recipes against candidate target code.
     */
    public matchRecipes(code: string, language?: string): RefactoringRecipe[] {
        if (!code || code.trim().length === 0) {
            return [];
        }

        const matched: RefactoringRecipe[] = [];
        for (const recipe of this.recipeRegistry.values()) {
            if (this.extractor.matchesRecipe(recipe, code, language)) {
                matched.push(recipe);
            }
        }

        return matched;
    }

    /**
     * Register a refactoring recipe into the knowledge registry.
     */
    public registerRecipe(recipe: RefactoringRecipe): void {
        this.recipeRegistry.set(recipe.recipeId, recipe);
    }

    /**
     * Get all currently learned and registered refactoring recipes.
     */
    public getLearnedRecipes(): readonly RefactoringRecipe[] {
        return Array.from(this.recipeRegistry.values());
    }

    private calculateDelta(input: PraxisTrajectoryLearningInput): number {
        if (input.beforeScore && input.afterScore) {
            return input.afterScore.compositeScore - input.beforeScore.compositeScore;
        }
        return input.beforeContent !== input.afterContent ? 8.0 : 0.0;
    }
}

/** Global default singleton instance */
export const defaultPraxisTrajectoryLearningService = new PraxisTrajectoryLearningService();

/**
 * Factory function to create a new instance of IPraxisTrajectoryLearningService.
 *
 * @param extractor - Optional custom recipe extractor instance.
 * @param detector - Optional custom regression detector instance.
 * @returns Configured IPraxisTrajectoryLearningService instance.
 */
export function createPraxisTrajectoryLearningService(
    extractor?: TrajectoryRecipeExtractor,
    detector?: RegressionTrajectoryDetector,
): IPraxisTrajectoryLearningService {
    return new PraxisTrajectoryLearningService(extractor, detector);
}
