/**
 * Module: Core Engine - Trajectory Recipe Extractor
 * File Path: src/core/trajectory/recipeExtractor.ts
 * Architecture Role: Learns and synthesizes structured refactoring recipes from successful
 *   historical code evolution trajectories (Bad -> Good transitions); determines preconditions
 *   and operations for automated recipe reuse.
 * Dependencies & Triggers: Consumes recipeTypes, scorer-formulas, and recipe-catalog; consumed
 *   by praxis/trajectoryLearningService and trajectory learning pipelines.
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
import { scoreDelta } from '../scoring/scorer-formulas';
import {
    CATEGORY_PREFIXES,
    PATTERN_DESCRIPTORS,
    type PatternDescriptor,
} from './recipe-catalog';

type RecipeMeta = {
    name: string;
    category: RecipeCategory;
    description: string;
    precondition: RecipePrecondition;
    operations: TransformOp[];
};

const PREDICATE_MIN_LINES = 'min-lines' as const;
const PREDICATE_PATTERN = 'pattern' as const;
const PREDICATE_ABSENT = 'absent' as const;
const PREDICATE_COUNT = 'count' as const;
const PREDICATE_DUAL = 'dual' as const;

const MIN_FUNCTION_LINES = 25;
const MIN_BRANCH_COUNT = 3;
const MIN_QUALITY_GAIN = 5.0;
const DEFAULT_DELTA_SCORE = 10.0;
const RECIPE_ID_PAD_LENGTH = 3;
const FALLBACK_RECIPE_PREFIX = 'REC-GEN';

type TagPredicate =
    | { readonly kind: typeof PREDICATE_MIN_LINES; readonly minLines: number }
    | { readonly kind: typeof PREDICATE_PATTERN; readonly pattern: RegExp }
    | { readonly kind: typeof PREDICATE_ABSENT; readonly pattern: RegExp }
    | { readonly kind: typeof PREDICATE_COUNT; readonly pattern: RegExp; readonly minCount: number }
    | { readonly kind: typeof PREDICATE_DUAL; readonly present: RegExp; readonly absent: RegExp };

const TAG_RULES: Readonly<Record<string, TagPredicate>> = {
    'monolithic-function': { kind: PREDICATE_MIN_LINES, minLines: MIN_FUNCTION_LINES },
    'high-cyclomatic-complexity': { kind: PREDICATE_MIN_LINES, minLines: MIN_FUNCTION_LINES },
    'long-parameter-list': { kind: PREDICATE_PATTERN, pattern: /\(\s*[^)]{35,}\)/ },
    'positional-drift': { kind: PREDICATE_PATTERN, pattern: /\(\s*[^)]{35,}\)/ },
    'deep-branching': { kind: PREDICATE_COUNT, pattern: /case\s+|else\s+if/g, minCount: MIN_BRANCH_COUNT },
    'cyclomatic-cascade': { kind: PREDICATE_COUNT, pattern: /case\s+|else\s+if/g, minCount: MIN_BRANCH_COUNT },
    'missing-guard': { kind: PREDICATE_ABSENT, pattern: /if\s*\(!\w+\)\s*return/ },
    'unhandled-rejection': { kind: PREDICATE_DUAL, present: /\b(?:async|await|Promise)\b/, absent: /\bcatch\b/ },
    'transient-heap-allocation': { kind: PREDICATE_PATTERN, pattern: /\bnew\s+\w+|\.duplicate\(true\)/ },
    'hot-loop-gc-pressure': { kind: PREDICATE_PATTERN, pattern: /\bnew\s+\w+|\.duplicate\(true\)/ },
    'unprotected-reentrancy': { kind: PREDICATE_ABSENT, pattern: /(_is_executing|_is_stopping|_cas_lock)/ },
    'recursive-state-mutation': { kind: PREDICATE_ABSENT, pattern: /(_is_executing|_is_stopping|_cas_lock)/ },
    'hot-path-config-query': { kind: PREDICATE_COUNT, pattern: /GameConfig\.get_/g, minCount: MIN_BRANCH_COUNT },
    'stale-cache-risk': { kind: PREDICATE_COUNT, pattern: /GameConfig\.get_/g, minCount: MIN_BRANCH_COUNT },
    'data-clump': { kind: PREDICATE_PATTERN, pattern: /\(\s*[^,)]+,\s*[^,)]+,\s*[^,)]+,\s*[^,)]+,\s*[^,)]+/ },
    'parameter-overload': { kind: PREDICATE_PATTERN, pattern: /\(\s*[^,)]+,\s*[^,)]+,\s*[^,)]+,\s*[^,)]+,\s*[^,)]+/ },
    'hardcoded-pipeline-branch': { kind: PREDICATE_PATTERN, pattern: /\b(if\s+step\s*==|match\s+phase|switch\s*\(stage\))/ },
    'tight-lifecycle-coupling': { kind: PREDICATE_PATTERN, pattern: /\b(if\s+step\s*==|match\s+phase|switch\s*\(stage\))/ },
    'stale-shim-layer': { kind: PREDICATE_PATTERN, pattern: /\b(from_stat_mutation|apply_mutation_legacy)\b/ },
    'obsolete-compatibility-bridge': { kind: PREDICATE_PATTERN, pattern: /\b(from_stat_mutation|apply_mutation_legacy)\b/ },
    'indirect-shim-wrapper': { kind: PREDICATE_PATTERN, pattern: /\.apply_mutation\(\s*[^,)]+,\s*[^,)]+,\s*[^,)]+,\s*[^,)]+/ },
    'transitional-scaffolding': { kind: PREDICATE_PATTERN, pattern: /\.apply_mutation\(\s*[^,)]+,\s*[^,)]+,\s*[^,)]+,\s*[^,)]+/ },
    'unannotated-deprecation': { kind: PREDICATE_ABSENT, pattern: /@deprecated\b/ },
    'missing-sunset-plan': { kind: PREDICATE_ABSENT, pattern: /@deprecated\b/ },
    'transient-bridge-boxing': { kind: PREDICATE_PATTERN, pattern: /var\s+\w+\s*=\s*\{\s*["']\w+["']\s*:\s*\w+/ },
    'heavyweight-wrapper': { kind: PREDICATE_PATTERN, pattern: /var\s+\w+\s*=\s*\{\s*["']\w+["']\s*:\s*\w+/ },
    'missing-debounce': { kind: PREDICATE_ABSENT, pattern: /\b(debounced_pressed|debounce|is_loading)\b/ },
    'wild-state-mutation': { kind: PREDICATE_PATTERN, pattern: /_current_state\s*=/ },
    'strong-observer-leak': {
        kind: PREDICATE_DUAL,
        present: /\b(?:_observers|_listeners|_bindings)\.append\(/,
        absent: /weakref/,
    },
    'dto-mutation-leak': { kind: PREDICATE_PATTERN, pattern: /\b(?:snapshot|dto|_snapshot|_dto)\.\w+\s*[+\-\*]?=/ },
    'bare-progress-bar': { kind: PREDICATE_DUAL, present: /\bProgressBar\b/, absent: /\bKStatusBar\b/ },
    'hardcoded-color-token': { kind: PREDICATE_DUAL, present: /Color\s*\(/, absent: /DesignTokens\./ },
    'bare-control-inheritance': {
        kind: PREDICATE_DUAL,
        present: /extends\s+Control\b/,
        absent: /extends\s+(BaseScreen|BaseModal)\b/,
    },
    'unbounded-list-instantiation': { kind: PREDICATE_DUAL, present: /\badd_child\s*\(/, absent: /\bKVirtualList\b/ },
    'unlocalized-ui-string': { kind: PREDICATE_DUAL, present: /\.text\s*=\s*["'][^"']+["']/, absent: /\btr\s*\(/ },
    'fragile-node-path': { kind: PREDICATE_DUAL, present: /\b(?:get_parent|find_child)\b/, absent: /%[A-Za-z0-9_]+/ },
    'backend-singleton-coupling': { kind: PREDICATE_DUAL, present: /\bGameState\./, absent: /\bapply_snapshot\b/ },
};

/**
 * Extractor engine that derives reusable refactoring recipes from code evolution history.
 */
export class TrajectoryRecipeExtractor {
    private static recipeCounter = 1;

    public static readonly PATTERN_DESCRIPTORS: readonly PatternDescriptor[] = PATTERN_DESCRIPTORS;

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

        if (input.beforeContent.trim() === input.afterContent.trim()) {
            return undefined;
        }

        const deltaScore = this.calculateDeltaScore(input);
        if (deltaScore < 0) {
            return undefined;
        }

        const recipeMeta = this.detectTransformationPattern(
            beforeLines,
            afterLines,
            input.language,
        );
        if (!recipeMeta) {
            return undefined;
        }

        return {
            recipeId: this.generateRecipeId(recipeMeta.category),
            name: recipeMeta.name,
            category: recipeMeta.category,
            description: recipeMeta.description,
            precondition: recipeMeta.precondition,
            operations: recipeMeta.operations,
            expectedQualityGain: Math.max(MIN_QUALITY_GAIN, deltaScore),
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
            const delta = scoreDelta(
                input.beforeScore.compositeScore,
                input.afterScore.compositeScore,
            );
            if (delta !== null) {
                return delta;
            }
        }
        return DEFAULT_DELTA_SCORE;
    }

    /**
     * Detect specific transformation pattern from before and after line content.
     */
    private detectTransformationPattern(
        beforeLines: string[],
        afterLines: string[],
        language?: string,
    ): RecipeMeta | undefined {
        for (const descriptor of PATTERN_DESCRIPTORS) {
            if (descriptor.match(beforeLines, afterLines)) {
                return {
                    name: descriptor.name,
                    category: descriptor.category,
                    description: descriptor.description,
                    precondition: {
                        targetLanguage: language,
                        minLines: descriptor.minLines,
                        ...(descriptor.minComplexity === undefined
                            ? {}
                            : { minComplexity: descriptor.minComplexity }),
                        antiPatternTags: descriptor.antiPatternTags,
                    },
                    operations: descriptor.operations,
                };
            }
        }
        return undefined;
    }

    private detectTagInCode(tag: string, code: string, lines: string[]): boolean {
        const rule = TAG_RULES[tag];
        if (!rule) {
            return code.includes(tag);
        }
        if (rule.kind === PREDICATE_MIN_LINES) {
            return lines.length >= rule.minLines;
        }
        if (rule.kind === PREDICATE_PATTERN) {
            return rule.pattern.test(code);
        }
        if (rule.kind === PREDICATE_ABSENT) {
            return !rule.pattern.test(code);
        }
        if (rule.kind === PREDICATE_COUNT) {
            return (code.match(rule.pattern) || []).length >= rule.minCount;
        }
        return rule.present.test(code) && !rule.absent.test(code);
    }

    private createOp(opKind: TransformOpKind, targetSymbol: string, description: string): TransformOp {
        return { opKind, targetSymbol, description };
    }

    private generateRecipeId(category: RecipeCategory): string {
        const prefix = CATEGORY_PREFIXES[category] || FALLBACK_RECIPE_PREFIX;
        return `${prefix}-${String(TrajectoryRecipeExtractor.recipeCounter++).padStart(RECIPE_ID_PAD_LENGTH, '0')}`;
    }
}

/** Global default singleton instance */
export const defaultTrajectoryRecipeExtractor = new TrajectoryRecipeExtractor();
