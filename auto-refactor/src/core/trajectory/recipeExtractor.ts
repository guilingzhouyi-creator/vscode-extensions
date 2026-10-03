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
import { scoreDelta } from '../scoring/scorer-formulas';
import { RecipePatternDetectors } from './recipe-pattern-detectors';

type RecipeMeta = {
    name: string;
    category: RecipeCategory;
    description: string;
    precondition: RecipePrecondition;
    operations: TransformOp[];
};

interface PatternDescriptor {
    match: (beforeLines: string[], afterLines: string[]) => boolean;
    name: string;
    category: RecipeCategory;
    description: string;
    minLines: number;
    antiPatternTags: string[];
    operations: TransformOp[];
    minComplexity?: number;
}

/**
 * Extractor engine that derives reusable refactoring recipes from code evolution history.
 */
export class TrajectoryRecipeExtractor {
    private static recipeCounter = 1;

    private static readonly TAG_DETECTORS: Record<
        string,
        (code: string, lines: string[]) => boolean
    > = {
        'monolithic-function': (_code, lines) => lines.length >= 25,
        'high-cyclomatic-complexity': (_code, lines) => lines.length >= 25,
        'long-parameter-list': (code) => /\(\s*[^)]{35,}\)/.test(code),
        'positional-drift': (code) => /\(\s*[^)]{35,}\)/.test(code),
        'deep-branching': (code) => (code.match(/case\s+|else\s+if/g) || []).length >= 3,
        'cyclomatic-cascade': (code) => (code.match(/case\s+|else\s+if/g) || []).length >= 3,
        'missing-guard': (code) => !/if\s*\(!\w+\)\s*return/.test(code),
        'unhandled-rejection': (code) =>
            /\b(?:async|await|Promise)\b/.test(code) && !/\bcatch\b/.test(code),
        'transient-heap-allocation': (code) => /\bnew\s+\w+|\.duplicate\(true\)/.test(code),
        'hot-loop-gc-pressure': (code) => /\bnew\s+\w+|\.duplicate\(true\)/.test(code),
        'unprotected-reentrancy': (code) => !/(_is_executing|_is_stopping|_cas_lock)/.test(code),
        'recursive-state-mutation': (code) => !/(_is_executing|_is_stopping|_cas_lock)/.test(code),
        'hot-path-config-query': (code) => (code.match(/GameConfig\.get_/g) || []).length >= 3,
        'stale-cache-risk': (code) => (code.match(/GameConfig\.get_/g) || []).length >= 3,
        'data-clump': (code) => /\(\s*[^,)]+,\s*[^,)]+,\s*[^,)]+,\s*[^,)]+,\s*[^,)]+/.test(code),
        'parameter-overload': (code) =>
            /\(\s*[^,)]+,\s*[^,)]+,\s*[^,)]+,\s*[^,)]+,\s*[^,)]+/.test(code),
        'hardcoded-pipeline-branch': (code) =>
            /\b(if\s+step\s*==|match\s+phase|switch\s*\(stage\))/.test(code),
        'tight-lifecycle-coupling': (code) =>
            /\b(if\s+step\s*==|match\s+phase|switch\s*\(stage\))/.test(code),
        'stale-shim-layer': (code) => /\b(from_stat_mutation|apply_mutation_legacy)\b/.test(code),
        'obsolete-compatibility-bridge': (code) =>
            /\b(from_stat_mutation|apply_mutation_legacy)\b/.test(code),
        'indirect-shim-wrapper': (code) =>
            /\.apply_mutation\(\s*[^,)]+,\s*[^,)]+,\s*[^,)]+,\s*[^,)]+/.test(code),
        'transitional-scaffolding': (code) =>
            /\.apply_mutation\(\s*[^,)]+,\s*[^,)]+,\s*[^,)]+,\s*[^,)]+/.test(code),
        'unannotated-deprecation': (code) => !/@deprecated\b/.test(code),
        'missing-sunset-plan': (code) => !/@deprecated\b/.test(code),
        'transient-bridge-boxing': (code) =>
            /var\s+\w+\s*=\s*\{\s*["']\w+["']\s*:\s*\w+/.test(code),
        'heavyweight-wrapper': (code) => /var\s+\w+\s*=\s*\{\s*["']\w+["']\s*:\s*\w+/.test(code),
        'missing-debounce': (code) => !/\b(debounced_pressed|debounce|is_loading)\b/.test(code),
        'wild-state-mutation': (code) => /_current_state\s*=/.test(code),
        'strong-observer-leak': (code) =>
            /\b(?:_observers|_listeners|_bindings)\.append\(/.test(code) && !/weakref/.test(code),
        'dto-mutation-leak': (code) =>
            /\b(?:snapshot|dto|_snapshot|_dto)\.\w+\s*[+\-\*]?=/.test(code),
        'bare-progress-bar': (code) => /\bProgressBar\b/.test(code) && !/\bKStatusBar\b/.test(code),
        'hardcoded-color-token': (code) => /Color\s*\(/.test(code) && !/DesignTokens\./.test(code),
        'bare-control-inheritance': (code) =>
            /extends\s+Control\b/.test(code) && !/extends\s+(BaseScreen|BaseModal)\b/.test(code),
        'unbounded-list-instantiation': (code) =>
            /\badd_child\s*\(/.test(code) && !/\bKVirtualList\b/.test(code),
        'unlocalized-ui-string': (code) =>
            /\.text\s*=\s*["'][^"']+["']/.test(code) && !/\btr\s*\(/.test(code),
        'fragile-node-path': (code) =>
            /\b(?:get_parent|find_child)\b/.test(code) && !/%[A-Za-z0-9_]+/.test(code),
        'backend-singleton-coupling': (code) =>
            /\bGameState\./.test(code) && !/\bapply_snapshot\b/.test(code),
    };

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
        return 10.0;
    }

    /**
     * Detect specific transformation pattern from before and after line content.
     */
    private static readonly PATTERN_DESCRIPTORS: readonly PatternDescriptor[] = [
        {
            match: (b, a) => RecipePatternDetectors.isFunctionSplit(b, a),
            name: 'Large Function Decomposition into Focused Sub-methods',
            category: 'extract-method',
            description:
                'Splits monolithic routine exceeding complexity limits into modular sub-tasks.',
            minLines: 20,
            antiPatternTags: ['monolithic-function', 'high-cyclomatic-complexity'],
            operations: [
                {
                    opKind: 'split-function',
                    targetSymbol: 'main-routine',
                    description: 'Extract business sub-logic into separate cohesive helper methods',
                },
            ],
            minComplexity: 8,
        },
        {
            match: (b, a) => RecipePatternDetectors.isParameterObjectIntroduction(b, a),
            name: 'Parameter List Encapsulation into Options Object',
            category: 'parameter-object',
            description:
                'Replaces lengthy positional parameter list with a structured options record.',
            minLines: 8,
            antiPatternTags: ['long-parameter-list', 'positional-drift'],
            operations: [
                {
                    opKind: 'introduce-parameter-object',
                    targetSymbol: 'function-signature',
                    description:
                        'Consolidate 4+ positional arguments into a strongly typed options interface',
                },
            ],
        },
        {
            match: (b, a) => RecipePatternDetectors.isStrategyDispatchConversion(b, a),
            name: 'Conditional Cascade Replacement with Strategy Map',
            category: 'strategy-dispatch',
            description:
                'Replaces rigid switch/if-else cascades with declarative strategy handlers.',
            minLines: 15,
            antiPatternTags: ['deep-branching', 'cyclomatic-cascade'],
            operations: [
                {
                    opKind: 'extract-strategy',
                    targetSymbol: 'branching-core',
                    description:
                        'Extract conditional branches into handler dictionary / strategy dispatch',
                },
            ],
            minComplexity: 6,
        },
        {
            match: (b, a) => RecipePatternDetectors.isDefensiveGuardAddition(b, a),
            name: 'Defensive Guard and Safe Exception Boundary Injection',
            category: 'defensive-guard',
            description:
                'Adds early return boundary guards and safe exception wrappers around unsafe ops.',
            minLines: 5,
            antiPatternTags: ['missing-guard', 'unhandled-rejection'],
            operations: [
                {
                    opKind: 'inject-null-guard',
                    targetSymbol: 'entry-parameters',
                    description:
                        'Add early exit guards for null, undefined, or corrupt boundary payloads',
                },
            ],
        },
        {
            match: (b, a) => RecipePatternDetectors.isObjectPoolIntroduction(b, a),
            name: 'Object Pool & State Reset Lifecycle Implementation',
            category: 'object-pool-lifecycle',
            description:
                'Introduces static bounded object pool with acquire/release and reset_state to eliminate transient GC allocations.',
            minLines: 15,
            antiPatternTags: ['transient-heap-allocation', 'hot-loop-gc-pressure'],
            operations: [
                {
                    opKind: 'introduce-object-pool',
                    targetSymbol: 'class-definition',
                    description:
                        'Add static pool container with bounded capacity and acquire/release methods',
                },
                {
                    opKind: 'inject-reset-state',
                    targetSymbol: 'lifecycle-hooks',
                    description:
                        'Implement state clean-up in reset_state to ensure clean object reuse',
                },
            ],
        },
        {
            match: (b, a) => RecipePatternDetectors.isCasReentrancyGuardIntroduction(b, a),
            name: 'Atomic CAS State Machine Reentrancy Guard',
            category: 'cas-reentrancy-guard',
            description:
                'Adds atomic compare-and-swap boolean flags to prevent recursive or concurrent state machine reentrancy.',
            minLines: 8,
            antiPatternTags: ['unprotected-reentrancy', 'recursive-state-mutation'],
            operations: [
                {
                    opKind: 'inject-cas-guard',
                    targetSymbol: 'state-machine-entry',
                    description:
                        'Add boolean CAS flag check and short-circuit guard at critical section entry',
                },
            ],
        },
        {
            match: (b, a) => RecipePatternDetectors.isConfigCacheInvalidationIntroduction(b, a),
            name: 'Config-Driven Cache Invalidation & Lazy Self-Healing',
            category: 'config-cache-invalidation',
            description:
                'Replaces hot-loop config dictionary queries with version-checked static cache and invalidate_cache hook.',
            minLines: 12,
            antiPatternTags: ['hot-path-config-query', 'stale-cache-risk'],
            operations: [
                {
                    opKind: 'inject-cache-invalidation',
                    targetSymbol: 'cache-management',
                    description:
                        'Implement version-checked ensure_cache and explicit invalidate_cache hook',
                },
            ],
        },
        {
            match: (b, a) => RecipePatternDetectors.isDtoContextAggregationIntroduction(b, a),
            name: 'Data Clump to Typed Context DTO Aggregation',
            category: 'dto-context-aggregation',
            description:
                'Encapsulates 5+ loose scalar parameters into a typed Context DTO while maintaining 1-to-N backward-compatible bridges.',
            minLines: 12,
            antiPatternTags: ['data-clump', 'parameter-overload'],
            operations: [
                {
                    opKind: 'introduce-dto-context',
                    targetSymbol: 'service-api',
                    description:
                        'Consolidate multi-parameter signatures into ContextDTO and delegate legacy calls to context overload',
                },
            ],
        },
        {
            match: (b, a) => RecipePatternDetectors.isHookDecouplingIntroduction(b, a),
            name: 'Hardcoded Pipeline Branch to Dynamic Hook Dispatch Decoupling',
            category: 'hook-decoupling',
            description:
                'Replaces hardcoded downstream consequence branches with schema-validated dynamic hook dispatcher.',
            minLines: 10,
            antiPatternTags: ['hardcoded-pipeline-branch', 'tight-lifecycle-coupling'],
            operations: [
                {
                    opKind: 'inject-hook-dispatch',
                    targetSymbol: 'pipeline-flow',
                    description:
                        'Dispatch lifecycle transitions via HookBus/ConfigHook rather than hardcoded direct calls',
                },
            ],
        },
        {
            match: (b, a) => RecipePatternDetectors.isShimEliminationIntroduction(b, a),
            name: 'Compatibility Layer Shim Elimination and Obsolete Bridge Purge',
            category: 'shim-elimination',
            description:
                'Removes legacy compatibility shims, bridge adapters, and redundant scalar delegation wrappers.',
            minLines: 5,
            antiPatternTags: ['stale-shim-layer', 'obsolete-compatibility-bridge'],
            operations: [
                {
                    opKind: 'remove-stale-shim',
                    targetSymbol: 'compatibility-layer',
                    description:
                        'Purge deprecated compatibility adapters and scalar bridging overloads',
                },
            ],
        },
        {
            match: (b, a) => RecipePatternDetectors.isDirectModernMigrationIntroduction(b, a),
            name: 'Direct Modern Architecture API Migration',
            category: 'direct-modern-migration',
            description:
                'Migrates call sites from transitional bridging shims to canonical direct modern DTO APIs.',
            minLines: 3,
            antiPatternTags: ['indirect-shim-wrapper', 'transitional-scaffolding'],
            operations: [
                {
                    opKind: 'bypass-shim-to-direct',
                    targetSymbol: 'call-sites',
                    description:
                        'Replace indirect shim method calls with direct canonical context DTO invocations',
                },
            ],
        },
        {
            match: (b, a) => RecipePatternDetectors.isDeprecationLifecycleAnnotation(b, a),
            name: 'Deprecation Lifecycle Metadata and Sunset Plan Governance',
            category: 'deprecation-lifecycle',
            description:
                'Enforces formal deprecation tagging with Since/Sunset versions and migration guide references.',
            minLines: 3,
            antiPatternTags: ['unannotated-deprecation', 'missing-sunset-plan'],
            operations: [
                {
                    opKind: 'inject-deprecated-annotation',
                    targetSymbol: 'deprecated-symbol',
                    description:
                        'Attach formal @deprecated JSDoc tag with Since version and Sunset target',
                },
            ],
        },
        {
            match: (b, a) => RecipePatternDetectors.isZeroCostModernization(b, a),
            name: 'Zero-Cost Modern Abstraction and Direct Context View',
            category: 'zero-cost-modernization',
            description:
                'Replaces heap-allocating bridge boxing wrappers with zero-cost typed views and direct solvers.',
            minLines: 3,
            antiPatternTags: ['transient-bridge-boxing', 'heavyweight-wrapper'],
            operations: [
                {
                    opKind: 'introduce-zero-cost-view',
                    targetSymbol: 'data-binding',
                    description:
                        'Replace dictionary boxing with strongly-typed zero-overhead context view',
                },
            ],
        },
        {
            match: (b, a) => RecipePatternDetectors.isInteractionDebounceIntroduction(b, a),
            name: 'Interactive Action Debounce and Loading State Guard',
            category: 'interaction-debounce',
            description:
                'Protects high-frequency buttons and RPC triggers with debounce timeout and loading mutex fencing.',
            minLines: 3,
            antiPatternTags: ['missing-debounce'],
            operations: [
                {
                    opKind: 'inject-debounce-lock',
                    targetSymbol: 'event-handler',
                    description:
                        'Upgrade bare button connection to debounced handler with loading state lock',
                },
            ],
        },
        {
            match: (b, a) => RecipePatternDetectors.isStateMachineDisciplineIntroduction(b, a),
            name: 'Finite State Machine Transition Guard Discipline',
            category: 'state-machine-discipline',
            description:
                'Replaces wild direct state variable mutations with formal guarded transition_to calls.',
            minLines: 3,
            antiPatternTags: ['wild-state-mutation'],
            operations: [
                {
                    opKind: 'inject-transition-guard',
                    targetSymbol: 'state-machine',
                    description:
                        'Enforce transition_to guard flow and entry/exit invariant execution',
                },
            ],
        },
        {
            match: (b, a) => RecipePatternDetectors.isWeakRefObserverIntroduction(b, a),
            name: 'Dynamic Observer WeakRef Reference Decoupling',
            category: 'weakref-observer',
            description:
                'Replaces strong Node references in dynamic registries with weakref wrappers to prevent zombie leaks.',
            minLines: 3,
            antiPatternTags: ['strong-observer-leak'],
            operations: [
                {
                    opKind: 'wrap-weakref-observer',
                    targetSymbol: 'observer-registry',
                    description:
                        'Wrap registered Node listener in weakref and add dead reference cleanup',
                },
            ],
        },
        {
            match: (b, a) => RecipePatternDetectors.isUnidirectionalFlowIntroduction(b, a),
            name: 'Presentation Unidirectional Flow and Snapshot Immutability',
            category: 'unidirectional-flow',
            description:
                'Eliminates in-place mutation of Snapshot DTOs in presentation layer in favor of intent commands.',
            minLines: 3,
            antiPatternTags: ['dto-mutation-leak'],
            operations: [
                {
                    opKind: 'introduce-intent-command',
                    targetSymbol: 'presentation-view',
                    description:
                        'Replace in-place DTO field mutation with intention Command dispatch to domain service',
                },
            ],
        },
        {
            match: (b, a) =>
                b.some((l) => /\bProgressBar\b/.test(l)) && a.some((l) => /\bKStatusBar\b/.test(l)),
            name: 'Bare ProgressBar to KStatusBar Refactoring',
            category: 'status-bar-component',
            description: 'Upgrades discrete ProgressBar manipulation to KStatusBar component.',
            minLines: 2,
            antiPatternTags: ['bare-progress-bar'],
            operations: [
                {
                    opKind: 'introduce-status-bar',
                    targetSymbol: 'progress-bar',
                    description: 'Replace ProgressBar with KStatusBar',
                },
            ],
        },
        {
            match: (b, a) =>
                b.some((l) => /Color\s*\(/.test(l)) && a.some((l) => /DesignTokens\./.test(l)),
            name: 'Hardcoded Color to DesignTokens Refactoring',
            category: 'token-standardization',
            description: 'Replaces raw Color literals with DesignTokens constants.',
            minLines: 2,
            antiPatternTags: ['hardcoded-color-token'],
            operations: [
                {
                    opKind: 'replace-color-token',
                    targetSymbol: 'design-tokens',
                    description: 'Adopt DesignTokens constants',
                },
            ],
        },
        {
            match: (b, a) =>
                b.some((l) => /extends\s+Control\b/.test(l)) &&
                a.some((l) => /extends\s+(BaseScreen|BaseModal)\b/.test(l)),
            name: 'Bare Control to BaseScreen Refactoring',
            category: 'screen-base-inheritance',
            description: 'Replaces bare Control inheritance with BaseScreen/BaseModal framework.',
            minLines: 2,
            antiPatternTags: ['bare-control-inheritance'],
            operations: [
                {
                    opKind: 'extend-base-screen',
                    targetSymbol: 'base-screen',
                    description: 'Extend BaseScreen or BaseModal',
                },
            ],
        },
        {
            match: (b, a) =>
                b.some((l) => /\badd_child\b/.test(l)) && a.some((l) => /\bKVirtualList\b/.test(l)),
            name: 'List Node Virtualization & Pooling Refactoring',
            category: 'virtual-list-pooling',
            description:
                'Converts unbounded dynamic node instantiation into KVirtualList with object pooling.',
            minLines: 2,
            antiPatternTags: ['unbounded-list-instantiation'],
            operations: [
                {
                    opKind: 'introduce-virtual-list',
                    targetSymbol: 'virtual-list',
                    description: 'Adopt KVirtualList with object pool',
                },
            ],
        },
        {
            match: (b, a) =>
                b.some((l) => /=\s*"[A-Z]/.test(l)) &&
                a.some((l) => /\b(?:tr\s*\(|UIIntermediary)/.test(l)),
            name: 'UI Text i18n Localization Refactoring',
            category: 'i18n-localization',
            description:
                'Wraps raw display strings into localized tr(KEY) or UIIntermediary bindings.',
            minLines: 2,
            antiPatternTags: ['unlocalized-ui-string'],
            operations: [
                {
                    opKind: 'introduce-i18n-binding',
                    targetSymbol: 'i18n-service',
                    description: 'Bind UI text to i18n dictionary',
                },
            ],
        },
        {
            match: (b, a) =>
                b.some((l) => /\b(?:get_parent|find_child)\b/.test(l)) &&
                a.some((l) => /%[A-Za-z0-9_]+/.test(l)),
            name: 'Explicit Unique Node Path Refactoring',
            category: 'explicit-node-unique',
            description: 'Replaces fragile node traversal with explicit %UniqueNode references.',
            minLines: 2,
            antiPatternTags: ['fragile-node-path'],
            operations: [
                {
                    opKind: 'replace-relative-node-path',
                    targetSymbol: 'node-path',
                    description: 'Use %UniqueNode reference',
                },
            ],
        },
        {
            match: (b, a) =>
                b.some((l) => /\bGameState\./.test(l)) &&
                a.some((l) => /\bapply_snapshot\b/.test(l)),
            name: 'Presentation Domain Boundary Decoupling Refactoring',
            category: 'presentation-decoupling',
            description:
                'Decouples presentation views from backend singletons via apply_snapshot contract.',
            minLines: 2,
            antiPatternTags: ['backend-singleton-coupling'],
            operations: [
                {
                    opKind: 'isolate-domain-boundary',
                    targetSymbol: 'presentation-view',
                    description: 'Decouple view via snapshot flow',
                },
            ],
        },
    ];

    /**
     * Detect specific transformation pattern from before and after line content.
     */
    private detectTransformationPattern(
        beforeLines: string[],
        afterLines: string[],
        language?: string,
    ): RecipeMeta | undefined {
        for (const desc of TrajectoryRecipeExtractor.PATTERN_DESCRIPTORS) {
            if (desc.match(beforeLines, afterLines)) {
                return {
                    name: desc.name,
                    category: desc.category,
                    description: desc.description,
                    precondition: {
                        targetLanguage: language,
                        minLines: desc.minLines,
                        ...(desc.minComplexity === undefined
                            ? {}
                            : { minComplexity: desc.minComplexity }),
                        antiPatternTags: desc.antiPatternTags,
                    },
                    operations: desc.operations,
                };
            }
        }
        return undefined;
    }

    private detectTagInCode(tag: string, code: string, lines: string[]): boolean {
        const detector = TrajectoryRecipeExtractor.TAG_DETECTORS[tag];
        return detector ? detector(code, lines) : code.includes(tag);
    }

    private createOp(opKind: TransformOpKind, target: string, description: string): TransformOp {
        return { opKind, targetSymbol: target, description };
    }

    private generateRecipeId(category: RecipeCategory): string {
        const prefixMap: Record<RecipeCategory, string> = {
            'extract-method': 'REC-SPLIT',
            'parameter-object': 'REC-PARAM',
            'strategy-dispatch': 'REC-STRAT',
            'defensive-guard': 'REC-GUARD',
            'concurrency-safe': 'REC-ASYNC',
            'object-pool-lifecycle': 'REC-POOL',
            'config-cache-invalidation': 'REC-HOTCFG',
            'cas-reentrancy-guard': 'REC-CAS',
            'dto-context-aggregation': 'REC-DTO',
            'hook-decoupling': 'REC-HOOK',
            'shim-elimination': 'REC-PURGE',
            'direct-modern-migration': 'REC-DIRECT',
            'deprecation-lifecycle': 'REC-DEPR',
            'zero-cost-modernization': 'REC-ZCOST',
            'interaction-debounce': 'REC-DEB',
            'state-machine-discipline': 'REC-FSM',
            'weakref-observer': 'REC-WEAK',
            'unidirectional-flow': 'REC-UNI',
            'status-bar-component': 'REC-BAR',
            'token-standardization': 'REC-TOK',
            'screen-base-inheritance': 'REC-EXT',
            'virtual-list-pooling': 'REC-VRT',
            'i18n-localization': 'REC-I18N',
            'explicit-node-unique': 'REC-NOD',
            'presentation-decoupling': 'REC-BND',
            'modular-decomposition': 'REC-MOD',
            composite: 'REC-COMP',
        };
        const prefix = prefixMap[category] || 'REC-GEN';
        return `${prefix}-${String(TrajectoryRecipeExtractor.recipeCounter++).padStart(3, '0')}`;
    }
}

/** Global default singleton instance */
export const defaultTrajectoryRecipeExtractor = new TrajectoryRecipeExtractor();
