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

import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
    PraxisTrajectoryLearningInput,
    RecipeCategory,
    RecipePrecondition,
    RefactoringRecipe,
    TransformOp,
    TransformOpKind,
} from './recipeTypes';
import { scoreDelta } from '../scoring/scorer-formulas';
import { numberMeasurement } from '../review/review-contracts';
import { CATEGORY_PREFIXES, PATTERN_DESCRIPTORS, type PatternDescriptor } from './recipe-catalog';

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
const RECIPE_ID_PAD_LENGTH = 3;
const FALLBACK_RECIPE_PREFIX = 'REC-GEN';
const WILDCARD_LANGUAGE = '*';

/** Compiled tag predicate evaluated against candidate source snippets. */
export type TagPredicate =
    | { readonly kind: typeof PREDICATE_MIN_LINES; readonly minLines: number }
    | { readonly kind: typeof PREDICATE_PATTERN; readonly pattern: RegExp }
    | { readonly kind: typeof PREDICATE_ABSENT; readonly pattern: RegExp }
    | { readonly kind: typeof PREDICATE_COUNT; readonly pattern: RegExp; readonly minCount: number }
    | { readonly kind: typeof PREDICATE_DUAL; readonly present: RegExp; readonly absent: RegExp };

/** JSON-serializable predicate descriptor loaded from declarative preset plugins. */
export interface SerializedTagPredicate {
    readonly kind: TagPredicate['kind'];
    readonly minLines?: number;
    readonly minCount?: number;
    readonly pattern?: string;
    readonly flags?: string;
    readonly present?: string;
    readonly presentFlags?: string;
    readonly absent?: string;
    readonly absentFlags?: string;
}

/** Pluggable domain or language tag rule pack injected via options or preset JSON. */
export interface TrajectoryRecipePlugin {
    readonly id: string;
    readonly language?: string;
    readonly tagRules: Readonly<Record<string, TagPredicate | SerializedTagPredicate>>;
}

/** Configuration options for TrajectoryRecipeExtractor plugin hydration. */
export interface TrajectoryRecipeExtractorOptions {
    readonly plugins?: readonly TrajectoryRecipePlugin[];
    readonly tagRules?: Readonly<Record<string, TagPredicate | SerializedTagPredicate>>;
    readonly autoLoadBuiltinPresets?: boolean;
}

const GENERIC_TAG_RULES: Readonly<Record<string, TagPredicate>> = {
    'monolithic-function': { kind: PREDICATE_MIN_LINES, minLines: MIN_FUNCTION_LINES },
    'high-cyclomatic-complexity': { kind: PREDICATE_MIN_LINES, minLines: MIN_FUNCTION_LINES },
    'long-parameter-list': { kind: PREDICATE_PATTERN, pattern: /\(\s*[^)]{35,}\)/ },
    'positional-drift': { kind: PREDICATE_PATTERN, pattern: /\(\s*[^)]{35,}\)/ },
    'deep-branching': {
        kind: PREDICATE_COUNT,
        pattern: /case\s+|else\s+if/g,
        minCount: MIN_BRANCH_COUNT,
    },
    'cyclomatic-cascade': {
        kind: PREDICATE_COUNT,
        pattern: /case\s+|else\s+if/g,
        minCount: MIN_BRANCH_COUNT,
    },
    'missing-guard': { kind: PREDICATE_ABSENT, pattern: /if\s*\(!\w+\)\s*return/ },
    'unhandled-rejection': {
        kind: PREDICATE_DUAL,
        present: /\b(?:async|await|Promise)\b/,
        absent: /\bcatch\b/,
    },
    'transient-heap-allocation': { kind: PREDICATE_PATTERN, pattern: /\bnew\s+\w+/ },
    'hot-loop-gc-pressure': { kind: PREDICATE_PATTERN, pattern: /\bnew\s+\w+/ },
    'data-clump': {
        kind: PREDICATE_PATTERN,
        pattern: /\(\s*[^,)]+,\s*[^,)]+,\s*[^,)]+,\s*[^,)]+,\s*[^,)]+/,
    },
    'parameter-overload': {
        kind: PREDICATE_PATTERN,
        pattern: /\(\s*[^,)]+,\s*[^,)]+,\s*[^,)]+,\s*[^,)]+,\s*[^,)]+/,
    },
    'hardcoded-pipeline-branch': {
        kind: PREDICATE_PATTERN,
        pattern: /\b(if\s+step\s*==|match\s+phase|switch\s*\(stage\))/,
    },
    'tight-lifecycle-coupling': {
        kind: PREDICATE_PATTERN,
        pattern: /\b(if\s+step\s*==|match\s+phase|switch\s*\(stage\))/,
    },
    'unannotated-deprecation': { kind: PREDICATE_ABSENT, pattern: /@deprecated\b/ },
    'missing-sunset-plan': { kind: PREDICATE_ABSENT, pattern: /@deprecated\b/ },
};

let cachedBuiltinPlugins: readonly TrajectoryRecipePlugin[] | undefined;

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function nonEmptyText(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function compilePatternInput(
    input: string | RegExp | undefined,
    flags = '',
    forceGlobal = false,
): RegExp | undefined {
    if (!input) return undefined;
    if (input instanceof RegExp) {
        return !forceGlobal || input.global ? input : new RegExp(input.source, `${input.flags}g`);
    }
    try {
        return new RegExp(input, forceGlobal && !flags.includes('g') ? `${flags}g` : flags);
    } catch {
        // intentional: skip invalid user-supplied preset regex without crashing extraction
        return undefined;
    }
}

function compileDualTagPredicate(
    spec: Extract<TagPredicate, { kind: typeof PREDICATE_DUAL }> | SerializedTagPredicate,
): TagPredicate | undefined {
    const present = compilePatternInput(
        spec.present,
        'presentFlags' in spec ? spec.presentFlags : undefined,
    );
    const absent = compilePatternInput(
        spec.absent,
        'absentFlags' in spec ? spec.absentFlags : undefined,
    );
    return present && absent ? { kind: PREDICATE_DUAL, present, absent } : undefined;
}

function compileTagPredicate(
    spec: TagPredicate | SerializedTagPredicate,
): TagPredicate | undefined {
    if (spec.kind === PREDICATE_MIN_LINES) {
        return spec.minLines && spec.minLines > 0
            ? { kind: PREDICATE_MIN_LINES, minLines: spec.minLines }
            : undefined;
    }
    const flags = 'flags' in spec ? spec.flags : undefined;
    if (spec.kind === PREDICATE_PATTERN || spec.kind === PREDICATE_ABSENT) {
        const compiled = compilePatternInput(spec.pattern, flags);
        return compiled ? { kind: spec.kind, pattern: compiled } : undefined;
    }
    if (spec.kind === PREDICATE_COUNT) {
        const minCount = spec.minCount ?? 0;
        const compiled = minCount > 0 ? compilePatternInput(spec.pattern, flags, true) : undefined;
        return compiled ? { kind: PREDICATE_COUNT, pattern: compiled, minCount } : undefined;
    }
    return spec.kind === PREDICATE_DUAL ? compileDualTagPredicate(spec) : undefined;
}

/**
 * Extracts and validates a TrajectoryRecipePlugin block from a parsed preset config object.
 *
 * @param rawConfig - Parsed JSON config object possibly carrying trajectoryPlugin.
 * @param fallbackId - Fallback plugin identifier if omitted in JSON.
 * @returns Validated plugin descriptor, or undefined if absent or malformed.
 */
export function parsePresetTrajectoryPlugin(
    rawConfig: unknown,
    fallbackId = 'preset-plugin',
): TrajectoryRecipePlugin | undefined {
    if (!isPlainObject(rawConfig) || !isPlainObject(rawConfig.trajectoryPlugin)) return undefined;
    const block = rawConfig.trajectoryPlugin;
    if (!isPlainObject(block.tagRules)) return undefined;
    const compiledRules: Record<string, TagPredicate> = {};
    for (const [tag, rawRule] of Object.entries(block.tagRules)) {
        const compiled = isPlainObject(rawRule)
            ? compileTagPredicate(rawRule as unknown as SerializedTagPredicate)
            : undefined;
        if (compiled) compiledRules[tag] = compiled;
    }
    return Object.keys(compiledRules).length > 0
        ? {
              id: nonEmptyText(block.id) ?? fallbackId,
              language: nonEmptyText(block.language),
              tagRules: compiledRules,
          }
        : undefined;
}

function tryReadPresetPluginFile(
    filePath: string,
    entryName: string,
): TrajectoryRecipePlugin | undefined {
    try {
        const readSyncFn = fs['readFileSync'];
        const raw = JSON.parse(readSyncFn(filePath, 'utf8'));
        return parsePresetTrajectoryPlugin(raw, entryName.replace(/\.config\.json$/, ''));
    } catch {
        // intentional: ignore unreadable or malformed optional preset files cleanly
        return undefined;
    }
}

function collectPresetPluginsFromDir(dir: string, loaded: TrajectoryRecipePlugin[]): void {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir).sort();
    for (const entry of entries) {
        if (!entry.endsWith('.config.json')) continue;
        const plugin = tryReadPresetPluginFile(path.join(dir, entry), entry);
        if (plugin) loaded.push(plugin);
    }
}

/**
 * Discovers declarative trajectoryPlugin entries from built-in preset configs once per process.
 *
 * @param presetDirs - Optional override directories to scan for *.config.json presets.
 * @returns Immutable list of loaded trajectory recipe plugins.
 */
export function loadTrajectoryPluginsFromPresets(
    presetDirs?: readonly string[],
): readonly TrajectoryRecipePlugin[] {
    if (!presetDirs && cachedBuiltinPlugins) return cachedBuiltinPlugins;
    const searchDirs = presetDirs ?? [
        path.resolve(__dirname, '../../../presets'),
        path.resolve(__dirname, '../../../../presets'),
    ];
    const loaded: TrajectoryRecipePlugin[] = [];
    for (const dir of searchDirs) {
        collectPresetPluginsFromDir(dir, loaded);
        if (!presetDirs && loaded.length > 0) break;
    }
    if (!presetDirs) cachedBuiltinPlugins = loaded;
    return loaded;
}

/**
 * Builds a RecipePrecondition without transient object spreading.
 *
 * @param language - Target language identifier.
 * @param descriptor - Matched pattern descriptor.
 * @returns Concrete RecipePrecondition object.
 */
function buildRecipePrecondition(
    language: string | undefined,
    descriptor: PatternDescriptor,
): RecipePrecondition {
    const precondition: RecipePrecondition = {
        targetLanguage: language,
        minLines: descriptor.minLines,
        antiPatternTags: descriptor.antiPatternTags,
    };
    if (descriptor.minComplexity !== undefined) {
        precondition.minComplexity = descriptor.minComplexity;
    }
    return precondition;
}

/**
 * Extractor engine that derives reusable refactoring recipes from code evolution history.
 */
export class TrajectoryRecipeExtractor {
    private static recipeCounter = 1;

    public static readonly PATTERN_DESCRIPTORS: readonly PatternDescriptor[] = PATTERN_DESCRIPTORS;

    private readonly globalTagRules: Record<string, TagPredicate> = {};
    private readonly languageTagRules = new Map<string, Record<string, TagPredicate>>();

    /**
     * Initializes an extractor with generic tag rules plus declarative preset or custom plugins.
     *
     * @param options - Optional plugin, inline rule, and preset path configuration.
     */
    constructor(options: TrajectoryRecipeExtractorOptions = {}) {
        if (options.autoLoadBuiltinPresets !== false) {
            for (const plugin of loadTrajectoryPluginsFromPresets()) this.registerPlugin(plugin);
        }
        if (options.plugins) {
            for (const plugin of options.plugins) this.registerPlugin(plugin);
        }
        if (options.tagRules) {
            this.registerPlugin({ id: 'inline-options', tagRules: options.tagRules });
        }
    }

    /**
     * Registers a declarative or programmatic tag-rule plugin onto this extractor instance.
     *
     * @param plugin - Plugin carrying optional target language scope and tag predicates.
     * @returns Number of tag rules compiled and registered from the plugin.
     */
    public registerPlugin(plugin: TrajectoryRecipePlugin): number {
        const scope =
            plugin.language && plugin.language !== WILDCARD_LANGUAGE
                ? plugin.language.trim()
                : undefined;
        const bucket = scope
            ? (this.languageTagRules.get(scope) ?? this.languageTagRules.set(scope, {}).get(scope)!)
            : this.globalTagRules;
        let added = 0;
        for (const [tag, rawPredicate] of Object.entries(plugin.tagRules)) {
            const compiled = compileTagPredicate(rawPredicate);
            if (compiled) {
                bucket[tag] = compiled;
                added++;
            }
        }
        return added;
    }

    /**
     * Counts active tag predicates visible for the given optional target language.
     *
     * @param language - Optional language scope to include alongside global/generic rules.
     * @returns Total distinct tag predicate count.
     */
    public getTagRuleCount(language?: string): number {
        const scoped = language ? this.languageTagRules.get(language) : undefined;
        return new Set<string>([
            ...Object.keys(GENERIC_TAG_RULES),
            ...Object.keys(this.globalTagRules),
            ...(scoped ? Object.keys(scoped) : []),
        ]).size;
    }

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

        const qualityGain = numberMeasurement(
            input.beforeScore && input.afterScore
                ? (scoreDelta(input.beforeScore.compositeScore, input.afterScore.compositeScore) ??
                      NaN)
                : null,
            { source: 'trajectory-comparison', sampleIds: [input.trajectoryId] },
            'missing-score-pair',
        );
        if (qualityGain.status === 'measured' && qualityGain.value <= 0) {
            return undefined;
        }

        const recipeMeta =
            this.detectTransformationPattern(
                beforeLines,
                afterLines,
                input.language,
                input.beforeContent,
                input.afterContent,
            ) ??
            (qualityGain.status === 'measured' && qualityGain.value > 0
                ? this.synthesizeVerifiedFallbackMeta(beforeLines, afterLines, input.language)
                : undefined);
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
            expectedQualityGain: qualityGain.status === 'measured' ? qualityGain.value : null,
            qualityGain,
            sourceTrajectoryId: input.trajectoryId,
        };
    }

    private hasMinimumLines(code: string, minLines: number): boolean {
        let lineCount = 1;
        for (let i = 0; i < code.length; i++) {
            if (code.charCodeAt(i) === 10) lineCount++;
            if (lineCount >= minLines) return true;
        }
        return false;
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
        if (precondition.minLines && !this.hasMinimumLines(code, precondition.minLines)) {
            return false;
        }
        if (precondition.antiPatternTags.length === 0) return true;

        let lazyLines: string[] | undefined;
        const getLines = (): string[] => (lazyLines ??= code.split('\n'));
        const effectiveLanguage = language ?? precondition.targetLanguage;
        return precondition.antiPatternTags.some((tag) =>
            this.detectTagInCode(tag, code, getLines, effectiveLanguage),
        );
    }

    /**
     * Detect specific transformation pattern from before and after line content.
     */
    private detectTransformationPattern(
        beforeLines: string[],
        afterLines: string[],
        language?: string,
        beforeText?: string,
        afterText?: string,
    ): RecipeMeta | undefined {
        for (const descriptor of PATTERN_DESCRIPTORS) {
            if (descriptor.match(beforeLines, afterLines, beforeText, afterText)) {
                return {
                    name: descriptor.name,
                    category: descriptor.category,
                    description: descriptor.description,
                    precondition: buildRecipePrecondition(language, descriptor),
                    operations: descriptor.operations,
                };
            }
        }
        return undefined;
    }

    private synthesizeVerifiedFallbackMeta(
        beforeLines: string[],
        afterLines: string[],
        language?: string,
    ): RecipeMeta | undefined {
        const filterCode = (lines: string[]): string =>
            lines
                .map((line) => line.trim())
                .filter(
                    (line) =>
                        line.length > 0 &&
                        !line.startsWith('//') &&
                        !line.startsWith('/*') &&
                        !line.startsWith('*') &&
                        !line.startsWith('#'),
                )
                .join('\n');
        if (filterCode(beforeLines) === filterCode(afterLines)) {
            return undefined;
        }
        return {
            name: 'Verified Codemod Structural Improvement',
            category: 'defensive-guard',
            description:
                'Synthesized refactoring recipe from verified positive-delta trajectory transformation.',
            precondition: {
                targetLanguage: language,
                minLines: 1,
                antiPatternTags: ['missing-guard'],
            },
            operations: [
                this.createOp(
                    'inject-null-guard',
                    'module-slice',
                    'Apply verified structural guard or codemod transformation.',
                ),
            ],
        };
    }

    private resolveTagRule(tag: string, language?: string): TagPredicate | undefined {
        if (language) {
            const scoped = this.languageTagRules.get(language)?.[tag];
            if (scoped) return scoped;
        }
        return this.globalTagRules[tag] ?? GENERIC_TAG_RULES[tag];
    }

    private detectTagInCode(
        tag: string,
        code: string,
        getLines: () => string[],
        language?: string,
    ): boolean {
        const rule = this.resolveTagRule(tag, language);
        if (!rule) {
            return code.includes(tag);
        }
        if (rule.kind === PREDICATE_MIN_LINES) {
            return getLines().length >= rule.minLines;
        }
        if (rule.kind === PREDICATE_PATTERN) {
            return rule.pattern.test(code);
        }
        if (rule.kind === PREDICATE_ABSENT) {
            return !rule.pattern.test(code);
        }
        if (rule.kind === PREDICATE_COUNT) {
            let count = 0;
            rule.pattern.lastIndex = 0;
            while (rule.pattern.exec(code) !== null) {
                count++;
                if (count >= rule.minCount) break;
            }
            return count >= rule.minCount;
        }
        return rule.present.test(code) && !rule.absent.test(code);
    }

    private createOp(
        opKind: TransformOpKind,
        targetSymbol: string,
        description: string,
    ): TransformOp {
        return { opKind, targetSymbol, description };
    }

    private generateRecipeId(category: RecipeCategory): string {
        const prefix = CATEGORY_PREFIXES[category] || FALLBACK_RECIPE_PREFIX;
        return `${prefix}-${String(TrajectoryRecipeExtractor.recipeCounter++).padStart(RECIPE_ID_PAD_LENGTH, '0')}`;
    }
}

/** Global default singleton instance */
export const defaultTrajectoryRecipeExtractor = new TrajectoryRecipeExtractor();
