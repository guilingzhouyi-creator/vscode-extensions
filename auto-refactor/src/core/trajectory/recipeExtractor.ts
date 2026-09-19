/**
 * Module: Core Engine - Trajectory Recipe Extractor
 * File Path: src/core/trajectory/recipeExtractor.ts
 * Architecture Role: Learns and synthesizes structured refactoring recipes from successful
 *   historical code evolution trajectories (Bad -> Good transitions); determines preconditions
 *   and operations for automated recipe reuse.
 * Dependencies & Triggers: Consumes recipeTypes; consumed by praxis/trajectoryLearningService
 *   and trajectory learning pipelines.
 * Responsibilities: Detect structural improvements between code revisions, map changes to
 *   canonical transform operators, synthesize RefactoringRecipe descriptors, and match recipes
 *   against candidate code.
 * Exit Semantics & Design Rationale: Pure functional deterministic extraction; handles corrupt
 *   or identical revisions gracefully by returning undefined/empty lists without throwing.
 */

import type {
    PraxisTrajectoryLearningInput,
    RecipeCategory,
    RecipePrecondition,
    RefactoringRecipe,
    TransformOp,
    TransformOpKind,
} from './recipeTypes';

/**
 * Extractor engine that derives reusable refactoring recipes from code evolution history.
 */
export class TrajectoryRecipeExtractor {
    private static recipeCounter = 1;

    /**
     * Analyze a before-and-after trajectory revision pair and synthesize a recipe if improved.
     *
     * @param input - Input payload with before/after contents and optional quality scores.
     * @returns Synthesized RefactoringRecipe if Bad-to-Good pattern detected, or undefined.
     */
    public extractRecipeFromTrajectory(
        input: PraxisTrajectoryLearningInput,
    ): RefactoringRecipe | undefined {
        if (!input.beforeContent || !input.afterContent) {
            return undefined;
        }

        const beforeLines = input.beforeContent.split('\n');
        const afterLines = input.afterContent.split('\n');

        // Check if identical
        if (input.beforeContent.trim() === input.afterContent.trim()) {
            return undefined;
        }

        const deltaScore = this.calculateDeltaScore(input);
        if (deltaScore < 0) {
            return undefined;
        }

        // Detect transformation kind
        const recipeMeta = this.detectTransformationPattern(
            beforeLines,
            afterLines,
            input.language,
        );
        if (!recipeMeta) {
            return undefined;
        }

        const recipeId = this.generateRecipeId(recipeMeta.category);

        return {
            recipeId,
            name: recipeMeta.name,
            category: recipeMeta.category,
            description: recipeMeta.description,
            precondition: recipeMeta.precondition,
            operations: recipeMeta.operations,
            expectedQualityGain: Math.max(5.0, deltaScore),
            sourceTrajectoryId: input.trajectoryId,
        };
    }

    /**
     * Match whether a given target code meets the preconditions of a learned recipe.
     *
     * @param recipe - Learned RefactoringRecipe.
     * @param code - Target candidate code to evaluate.
     * @param language - Optional language identifier.
     * @returns True if target code satisfies the recipe preconditions.
     */
    public matchesRecipe(recipe: RefactoringRecipe, code: string, language?: string): boolean {
        const { precondition } = recipe;

        if (precondition.targetLanguage && language && precondition.targetLanguage !== language) {
            return false;
        }

        const lines = code.split('\n');
        if (precondition.minLines && lines.length < precondition.minLines) {
            return false;
        }

        // Match anti-pattern tags
        if (precondition.antiPatternTags.length > 0) {
            const hasMatchingTag = precondition.antiPatternTags.some((tag) =>
                this.detectTagInCode(tag, code, lines),
            );
            if (!hasMatchingTag) {
                return false;
            }
        }

        return true;
    }

    /**
     * Compute the quality delta score between revisions.
     */
    private calculateDeltaScore(input: PraxisTrajectoryLearningInput): number {
        if (input.beforeScore && input.afterScore) {
            return input.afterScore.compositeScore - input.beforeScore.compositeScore;
        }
        // Heuristic default if scores are absent: positive delta on structural optimization
        return 10.0;
    }

    /**
     * Detect specific transformation pattern from before and after line content.
     */
    private detectTransformationPattern(
        beforeLines: string[],
        afterLines: string[],
        language?: string,
    ):
        | {
              name: string;
              category: RecipeCategory;
              description: string;
              precondition: RecipePrecondition;
              operations: TransformOp[];
          }
        | undefined {
        // Pattern 1: Long Function Splitting (extract-method)
        if (this.isFunctionSplit(beforeLines, afterLines)) {
            return {
                name: 'Large Function Decomposition into Focused Sub-methods',
                category: 'extract-method',
                description:
                    'Splits monolithic routine exceeding complexity limits into modular sub-tasks.',
                precondition: {
                    targetLanguage: language,
                    minLines: 30,
                    minComplexity: 10,
                    antiPatternTags: ['monolithic-function', 'high-cyclomatic-complexity'],
                },
                operations: [
                    this.createOp(
                        'split-function',
                        'main-routine',
                        'Extract business sub-logic into separate cohesive helper methods',
                    ),
                ],
            };
        }

        // Pattern 2: Multi-parameter grouping into parameter object
        if (this.isParameterObjectIntroduction(beforeLines, afterLines)) {
            return {
                name: 'Parameter List Encapsulation into Options Object',
                category: 'parameter-object',
                description:
                    'Replaces lengthy positional parameter list with a structured options record.',
                precondition: {
                    targetLanguage: language,
                    minLines: 10,
                    antiPatternTags: ['long-parameter-list', 'positional-drift'],
                },
                operations: [
                    this.createOp(
                        'introduce-parameter-object',
                        'function-signature',
                        'Consolidate 4+ positional arguments into a strongly typed options interface',
                    ),
                ],
            };
        }

        // Pattern 3: Branching cascade converted to strategy dispatch
        if (this.isStrategyDispatchConversion(beforeLines, afterLines)) {
            return {
                name: 'Conditional Cascade Replacement with Strategy Map',
                category: 'strategy-dispatch',
                description:
                    'Replaces rigid switch/if-else cascades with declarative strategy handlers.',
                precondition: {
                    targetLanguage: language,
                    minLines: 20,
                    minComplexity: 8,
                    antiPatternTags: ['deep-branching', 'cyclomatic-cascade'],
                },
                operations: [
                    this.createOp(
                        'extract-strategy',
                        'branching-core',
                        'Extract conditional branches into handler dictionary / strategy dispatch',
                    ),
                ],
            };
        }

        // Pattern 4: Defensive Guard / Error Wrap Injection
        if (this.isDefensiveGuardAddition(beforeLines, afterLines)) {
            return {
                name: 'Defensive Guard and Safe Exception Boundary Injection',
                category: 'defensive-guard',
                description:
                    'Adds early return boundary guards and safe exception wrappers around unsafe ops.',
                precondition: {
                    targetLanguage: language,
                    minLines: 5,
                    antiPatternTags: ['missing-guard', 'unhandled-rejection'],
                },
                operations: [
                    this.createOp(
                        'inject-null-guard',
                        'entry-parameters',
                        'Add early exit guards for null, undefined, or corrupt boundary payloads',
                    ),
                ],
            };
        }

        return undefined;
    }

    private isFunctionSplit(before: string[], after: string[]): boolean {
        const countFn = (lines: string[]): number =>
            lines.filter((l) => {
                const trimmed = l.trim();
                if (/^(?:if|for|while|switch|catch)\b/.test(trimmed)) {
                    return false;
                }
                return (
                    /function\s+\w+/.test(trimmed) ||
                    /^(?:(?:public|private|protected|async|static)\s+)*\w+\s*\([^)]*\)\s*(?::\s*[^;{]+)?\s*\{/.test(
                        trimmed,
                    )
                );
            }).length;

        const beforeFnCount = countFn(before);
        const afterFnCount = countFn(after);

        return before.length >= 35 && afterFnCount >= beforeFnCount + 1;
    }

    private isParameterObjectIntroduction(before: string[], after: string[]): boolean {
        const beforeJoined = before.join('\n');
        const afterJoined = after.join('\n');

        const hasManyArgsBefore =
            /\(\s*\w+\s*:\s*\w+,\s*\w+\s*:\s*\w+,\s*\w+\s*:\s*\w+,\s*\w+/.test(beforeJoined);
        const hasOptionsInterfaceAfter = /interface\s+\w+Options|type\s+\w+Config\s*=/.test(
            afterJoined,
        );

        return hasManyArgsBefore && hasOptionsInterfaceAfter;
    }

    private isStrategyDispatchConversion(before: string[], after: string[]): boolean {
        const beforeJoined = before.join('\n');
        const afterJoined = after.join('\n');

        const beforeBranches = (beforeJoined.match(/case\s+|else\s+if/g) || []).length;
        const afterHasMapOrRecord =
            /const\s+\w+Handlers\s*:\s*Record|new\s+Map|\bMap<\w+,\s*\w+>/.test(afterJoined);

        return beforeBranches >= 3 && afterHasMapOrRecord;
    }

    private isDefensiveGuardAddition(before: string[], after: string[]): boolean {
        const beforeJoined = before.join('\n');
        const afterJoined = after.join('\n');

        const beforeHasGuards = /if\s*\(!\w+\)\s*return|try\s*\{/.test(beforeJoined);
        const afterHasGuards = /if\s*\(!\w+\)\s*return|try\s*\{/.test(afterJoined);

        return !beforeHasGuards && afterHasGuards;
    }

    private detectTagInCode(tag: string, code: string, lines: string[]): boolean {
        switch (tag) {
            case 'monolithic-function':
            case 'high-cyclomatic-complexity':
                return lines.length >= 30;
            case 'long-parameter-list':
                return /\(\s*[^)]{40,}\)/.test(code);
            case 'deep-branching':
            case 'cyclomatic-cascade':
                return (code.match(/case\s+|else\s+if/g) || []).length >= 3;
            case 'missing-guard':
                return !/if\s*\(!\w+\)\s*return/.test(code);
            default:
                return code.includes(tag);
        }
    }

    private createOp(opKind: TransformOpKind, target: string, desc: string): TransformOp {
        return {
            opKind,
            targetSymbol: target,
            description: desc,
        };
    }

    private generateRecipeId(category: RecipeCategory): string {
        const prefixMap: Record<RecipeCategory, string> = {
            'extract-method': 'REC-SPLIT',
            'parameter-object': 'REC-PARAM',
            'strategy-dispatch': 'REC-STRAT',
            'defensive-guard': 'REC-GUARD',
            'concurrency-safe': 'REC-ASYNC',
            composite: 'REC-COMP',
        };
        const prefix = prefixMap[category] || 'REC-GEN';
        const id = `${prefix}-${String(TrajectoryRecipeExtractor.recipeCounter++).padStart(3, '0')}`;
        return id;
    }
}

/** Global default singleton instance */
export const defaultTrajectoryRecipeExtractor = new TrajectoryRecipeExtractor();
