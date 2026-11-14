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

import * as fs from 'fs';
import * as path from 'path';
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
import { calculateRecipeGeneralizationIndex, calculateTrajectoryQualityVelocity, scoreDelta } from '../scoring/scorer-formulas';
import { numberMeasurement, type Measurement } from '../review/review-contracts';

const DEFAULT_TRAJECTORY_DIR = '.refactor-trajectory';
const DEFAULT_RECIPES_FILE = 'recipes.json';
const ENCODING_UTF8 = 'utf8';

/** Historical trajectory sample retained for holdout generalization evaluation. */
export interface HistoricalTrajectorySample {
    readonly trajectoryId: string;
    readonly filePath: string;
    readonly language?: string;
    readonly category?: string;
    readonly qualityDelta: number;
    readonly beforeContent: string;
}

/** Persistent disk schema for `.refactor-trajectory/recipes.json`. */
export interface PersistedRecipesEnvelope {
    readonly schemaVersion: 1;
    readonly updatedAtMs: number;
    readonly recipes: readonly RefactoringRecipe[];
    readonly history: readonly HistoricalTrajectorySample[];
}

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

    /**
     * Persist learned recipes and trajectory history to `.refactor-trajectory/recipes.json`.
     */
    saveRecipesToDisk(rootOrFilePath?: string): Promise<string>;
    /**
     * Load persisted recipes and trajectory history from `.refactor-trajectory/recipes.json`.
     */
    loadRecipesFromDisk(rootOrFilePath?: string): Promise<readonly RefactoringRecipe[]>;
}

function resolveRecipesFilePath(rootOrFilePath?: string, fallbackRoot?: string): string {
    const target = rootOrFilePath ?? fallbackRoot ?? process.cwd();
    return target.endsWith('.json')
        ? path.resolve(target)
        : path.resolve(target, DEFAULT_TRAJECTORY_DIR, DEFAULT_RECIPES_FILE);
}

function computeHoldoutDispersion(deltas: readonly number[], meanDelta: number): number {
    if (deltas.length <= 1 || meanDelta <= 0) return 0;
    let varianceSum = 0;
    for (const val of deltas) {
        varianceSum += (val - meanDelta) * (val - meanDelta);
    }
    return Math.min(1, Math.max(0, Math.sqrt(varianceSum / deltas.length) / (meanDelta + 1)));
}

/**
 * Implementation of the Praxis trajectory learning governance facade.
 */
export class PraxisTrajectoryLearningService implements IPraxisTrajectoryLearningService {
    private readonly extractor: TrajectoryRecipeExtractor;

    private readonly detector: RegressionTrajectoryDetector;

    private readonly recipeRegistry: Map<string, RefactoringRecipe> = new Map();

    private readonly historicalSamples: HistoricalTrajectorySample[] = [];

    private readonly persistenceRoot?: string;

    /**
     * Initialize service with modular recipe extractor and regression detector.
     */
    constructor(
        extractor: TrajectoryRecipeExtractor = defaultTrajectoryRecipeExtractor,
        detector: RegressionTrajectoryDetector = defaultRegressionTrajectoryDetector,
        persistenceRoot?: string,
    ) {
        this.extractor = extractor;
        this.detector = detector;
        this.persistenceRoot = persistenceRoot;
    }

    private measureTrajectoryDeltaAndVelocity(input: PraxisTrajectoryLearningInput): {
        deltaMeasurement: Measurement<number>;
        velocityMeasurement: Measurement<number>;
    } {
        const delta =
            input.beforeScore && input.afterScore
                ? (scoreDelta(input.beforeScore.compositeScore, input.afterScore.compositeScore) ?? NaN)
                : null;
        const provenance = {
            source: 'trajectory-comparison' as const,
            sampleIds: [input.trajectoryId],
        };
        const deltaMeasurement = numberMeasurement(delta, provenance, 'missing-score-pair');
        const velocityMeasurement =
            deltaMeasurement.status === 'measured'
                ? numberMeasurement(
                      calculateTrajectoryQualityVelocity(
                          input.beforeScore,
                          input.afterScore,
                          input.churnRatio ?? 0,
                      ),
                      provenance,
                      'missing-score-pair',
                  )
                : deltaMeasurement;
        return { deltaMeasurement, velocityMeasurement };
    }

    /**
     * Learn from a before/after trajectory revision pair.
     */
    public async learnFromTrajectory(
        input: PraxisTrajectoryLearningInput,
    ): Promise<PraxisTrajectoryVerdict> {
        const startTime = Date.now();
        const { deltaMeasurement, velocityMeasurement } = this.measureTrajectoryDeltaAndVelocity(input);
        const qualityDelta = deltaMeasurement.status === 'measured' ? deltaMeasurement.value : null;
        const qualityVelocity =
            velocityMeasurement.status === 'measured' ? velocityMeasurement.value : null;
        const extractedRecipe =
            qualityDelta !== null && qualityDelta > 0
                ? this.extractor.extractRecipeFromTrajectory(input)
                : undefined;
        if (extractedRecipe) this.registerRecipe(extractedRecipe);

        const genMeasurement = this.evaluateHoldoutGeneralization(input, extractedRecipe);
        const generalizationIndex = genMeasurement.status === 'measured' ? genMeasurement.value : null;
        if (qualityDelta !== null && Number.isFinite(qualityDelta)) {
            this.recordHistoricalSample({
                trajectoryId: input.trajectoryId,
                filePath: input.filePath,
                language: input.language,
                category: extractedRecipe?.category,
                qualityDelta,
                beforeContent: input.beforeContent,
            });
        }
        if (this.persistenceRoot && extractedRecipe) {
            await this.saveRecipesToDisk(this.persistenceRoot);
        }

        const recommendations = this.matchRecipes(input.beforeContent, input.language);
        return {
            hasBadToGoodImprovement: qualityDelta !== null && qualityDelta > 0 && extractedRecipe !== undefined,
            qualityDelta,
            qualityVelocity,
            generalizationIndex,
            measurements: {
                qualityDelta: deltaMeasurement,
                qualityVelocity: velocityMeasurement,
                generalizationIndex: genMeasurement,
            },
            extractedRecipe,
            regressionIssues: [],
            recommendations,
            durationMs: Math.max(1, Date.now() - startTime),
        };
    }

    private evaluateHoldoutGeneralization(
        input: PraxisTrajectoryLearningInput,
        recipe?: RefactoringRecipe,
    ): Measurement<number> {
        const holdout = this.historicalSamples.filter((s) => s.trajectoryId !== input.trajectoryId);
        if (holdout.length === 0) {
            return { status: 'unmeasured', reason: 'missing-holdout-validation' };
        }
        const positiveDeltas: number[] = [];
        const sampleIds: string[] = [];
        let deltaSum = 0;
        for (const sample of holdout) {
            sampleIds.push(sample.trajectoryId);
            const matched = recipe
                ? this.extractor.matchesRecipe(recipe, sample.beforeContent, sample.language) || sample.category === recipe.category
                : sample.qualityDelta > 0;
            if (sample.qualityDelta > 0 && matched) {
                deltaSum += sample.qualityDelta;
                positiveDeltas.push(sample.qualityDelta);
            }
        }
        const supportCount = positiveDeltas.length;
        const meanImpact = supportCount > 0 ? deltaSum / supportCount : 0;
        const genIndex = calculateRecipeGeneralizationIndex(supportCount, holdout.length, computeHoldoutDispersion(positiveDeltas, meanImpact), meanImpact);
        return numberMeasurement(genIndex, { source: 'holdout-validation', sampleIds }, 'missing-holdout-validation');
    }

    public recordHistoricalSample(sample: HistoricalTrajectorySample): void {
        const idx = this.historicalSamples.findIndex((e) => e.trajectoryId === sample.trajectoryId);
        if (idx >= 0) this.historicalSamples[idx] = sample;
        else this.historicalSamples.push(sample);
    }

    public async saveRecipesToDisk(rootOrFilePath?: string): Promise<string> {
        const targetFile = resolveRecipesFilePath(rootOrFilePath, this.persistenceRoot);
        await fs.promises.mkdir(path.dirname(targetFile), { recursive: true });
        const envelope: PersistedRecipesEnvelope = {
            schemaVersion: 1,
            updatedAtMs: Date.now(),
            recipes: Array.from(this.recipeRegistry.values()),
            history: [...this.historicalSamples],
        };
        const stagingFile = `${targetFile}.${process.pid}.tmp`;
        await fs.promises.writeFile(stagingFile, JSON.stringify(envelope, null, 2), ENCODING_UTF8);
        await fs.promises.rename(stagingFile, targetFile);
        return targetFile;
    }

    private ingestPersistedRecipesEnvelope(parsed: Partial<PersistedRecipesEnvelope>): void {
        for (const recipe of parsed.recipes ?? []) {
            if (recipe && typeof recipe.recipeId === 'string') this.registerRecipe(recipe);
        }
        for (const sample of parsed.history ?? []) {
            if (sample && typeof sample.trajectoryId === 'string') this.recordHistoricalSample(sample);
        }
    }

    public async loadRecipesFromDisk(rootOrFilePath?: string): Promise<readonly RefactoringRecipe[]> {
        const targetFile = resolveRecipesFilePath(rootOrFilePath, this.persistenceRoot);
        try {
            const parsed = JSON.parse(await fs.promises.readFile(targetFile, ENCODING_UTF8)) as Partial<PersistedRecipesEnvelope>;
            this.ingestPersistedRecipesEnvelope(parsed);
        } catch (err: unknown) {
            // Absent persistence file is expected on cold start; warn on read or JSON failure.
            const errno = (err as NodeJS.ErrnoException)?.code;
            if (errno !== 'ENOENT') {
                const detail = err instanceof Error ? err.message : String(err);
                process.stderr.write(`[trajectory-learning] failed to load recipes from ${targetFile}: ${detail}\n`);
            }
        }
        return this.getLearnedRecipes();
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
export function createTrajectoryLearningService(
    extractor?: TrajectoryRecipeExtractor,
    detector?: RegressionTrajectoryDetector,
    persistenceRoot?: string,
): IPraxisTrajectoryLearningService {
    return new PraxisTrajectoryLearningService(extractor, detector, persistenceRoot);
}
