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
    private detectTransformationPattern(
        beforeLines: string[],
        afterLines: string[],
        language?: string,
    ): RecipeMeta | undefined {
        if (RecipePatternDetectors.isFunctionSplit(beforeLines, afterLines)) {
            return this.createPatternMeta(
                'Large Function Decomposition into Focused Sub-methods',
                'extract-method',
                'Splits monolithic routine exceeding complexity limits into modular sub-tasks.',
                language,
                20,
                ['monolithic-function', 'high-cyclomatic-complexity'],
                [
                    this.createOp(
                        'split-function',
                        'main-routine',
                        'Extract business sub-logic into separate cohesive helper methods',
                    ),
                ],
                8,
            );
        }

        if (RecipePatternDetectors.isParameterObjectIntroduction(beforeLines, afterLines)) {
            return this.createPatternMeta(
                'Parameter List Encapsulation into Options Object',
                'parameter-object',
                'Replaces lengthy positional parameter list with a structured options record.',
                language,
                8,
                ['long-parameter-list', 'positional-drift'],
                [
                    this.createOp(
                        'introduce-parameter-object',
                        'function-signature',
                        'Consolidate 4+ positional arguments into a strongly typed options interface',
                    ),
                ],
            );
        }

        if (RecipePatternDetectors.isStrategyDispatchConversion(beforeLines, afterLines)) {
            return this.createPatternMeta(
                'Conditional Cascade Replacement with Strategy Map',
                'strategy-dispatch',
                'Replaces rigid switch/if-else cascades with declarative strategy handlers.',
                language,
                15,
                ['deep-branching', 'cyclomatic-cascade'],
                [
                    this.createOp(
                        'extract-strategy',
                        'branching-core',
                        'Extract conditional branches into handler dictionary / strategy dispatch',
                    ),
                ],
                6,
            );
        }

        if (RecipePatternDetectors.isDefensiveGuardAddition(beforeLines, afterLines)) {
            return this.createPatternMeta(
                'Defensive Guard and Safe Exception Boundary Injection',
                'defensive-guard',
                'Adds early return boundary guards and safe exception wrappers around unsafe ops.',
                language,
                5,
                ['missing-guard', 'unhandled-rejection'],
                [
                    this.createOp(
                        'inject-null-guard',
                        'entry-parameters',
                        'Add early exit guards for null, undefined, or corrupt boundary payloads',
                    ),
                ],
            );
        }

        if (RecipePatternDetectors.isObjectPoolIntroduction(beforeLines, afterLines)) {
            return this.createPatternMeta(
                'Object Pool & State Reset Lifecycle Implementation',
                'object-pool-lifecycle',
                'Introduces static bounded object pool with acquire/release and reset_state to eliminate transient GC allocations.',
                language,
                15,
                ['transient-heap-allocation', 'hot-loop-gc-pressure'],
                [
                    this.createOp(
                        'introduce-object-pool',
                        'class-definition',
                        'Add static pool container with bounded capacity and acquire/release methods',
                    ),
                    this.createOp(
                        'inject-reset-state',
                        'lifecycle-hooks',
                        'Implement state clean-up in reset_state to ensure clean object reuse',
                    ),
                ],
            );
        }

        if (RecipePatternDetectors.isCasReentrancyGuardIntroduction(beforeLines, afterLines)) {
            return this.createPatternMeta(
                'Atomic CAS State Machine Reentrancy Guard',
                'cas-reentrancy-guard',
                'Adds atomic compare-and-swap boolean flags to prevent recursive or concurrent state machine reentrancy.',
                language,
                8,
                ['unprotected-reentrancy', 'recursive-state-mutation'],
                [
                    this.createOp(
                        'inject-cas-guard',
                        'state-machine-entry',
                        'Add boolean CAS flag check and short-circuit guard at critical section entry',
                    ),
                ],
            );
        }

        if (RecipePatternDetectors.isConfigCacheInvalidationIntroduction(beforeLines, afterLines)) {
            return this.createPatternMeta(
                'Config-Driven Cache Invalidation & Lazy Self-Healing',
                'config-cache-invalidation',
                'Replaces hot-loop config dictionary queries with version-checked static cache and invalidate_cache hook.',
                language,
                12,
                ['hot-path-config-query', 'stale-cache-risk'],
                [
                    this.createOp(
                        'inject-cache-invalidation',
                        'cache-management',
                        'Implement version-checked ensure_cache and explicit invalidate_cache hook',
                    ),
                ],
            );
        }

        if (RecipePatternDetectors.isDtoContextAggregationIntroduction(beforeLines, afterLines)) {
            return this.createPatternMeta(
                'Data Clump to Typed Context DTO Aggregation',
                'dto-context-aggregation',
                'Encapsulates 5+ loose scalar parameters into a typed Context DTO while maintaining 1-to-N backward-compatible bridges.',
                language,
                12,
                ['data-clump', 'parameter-overload'],
                [
                    this.createOp(
                        'introduce-dto-context',
                        'service-api',
                        'Consolidate multi-parameter signatures into ContextDTO and delegate legacy calls to context overload',
                    ),
                ],
            );
        }

        if (RecipePatternDetectors.isHookDecouplingIntroduction(beforeLines, afterLines)) {
            return this.createPatternMeta(
                'Hardcoded Pipeline Branch to Dynamic Hook Dispatch Decoupling',
                'hook-decoupling',
                'Replaces hardcoded downstream consequence branches with schema-validated dynamic hook dispatcher.',
                language,
                10,
                ['hardcoded-pipeline-branch', 'tight-lifecycle-coupling'],
                [
                    this.createOp(
                        'inject-hook-dispatch',
                        'pipeline-flow',
                        'Dispatch lifecycle transitions via HookBus/ConfigHook rather than hardcoded direct calls',
                    ),
                ],
            );
        }

        if (RecipePatternDetectors.isShimEliminationIntroduction(beforeLines, afterLines)) {
            return this.createPatternMeta(
                'Compatibility Layer Shim Elimination and Obsolete Bridge Purge',
                'shim-elimination',
                'Removes legacy compatibility shims, bridge adapters, and redundant scalar delegation wrappers.',
                language,
                5,
                ['stale-shim-layer', 'obsolete-compatibility-bridge'],
                [
                    this.createOp(
                        'remove-stale-shim',
                        'compatibility-layer',
                        'Purge deprecated compatibility adapters and scalar bridging overloads',
                    ),
                ],
            );
        }

        if (RecipePatternDetectors.isDirectModernMigrationIntroduction(beforeLines, afterLines)) {
            return this.createPatternMeta(
                'Direct Modern Architecture API Migration',
                'direct-modern-migration',
                'Migrates call sites from transitional bridging shims to canonical direct modern DTO APIs.',
                language,
                3,
                ['indirect-shim-wrapper', 'transitional-scaffolding'],
                [
                    this.createOp(
                        'bypass-shim-to-direct',
                        'call-sites',
                        'Replace indirect shim method calls with direct canonical context DTO invocations',
                    ),
                ],
            );
        }

        if (RecipePatternDetectors.isDeprecationLifecycleAnnotation(beforeLines, afterLines)) {
            return this.createPatternMeta(
                'Deprecation Lifecycle Metadata and Sunset Plan Governance',
                'deprecation-lifecycle',
                'Enforces formal deprecation tagging with Since/Sunset versions and migration guide references.',
                language,
                3,
                ['unannotated-deprecation', 'missing-sunset-plan'],
                [
                    this.createOp(
                        'inject-deprecated-annotation',
                        'deprecated-symbol',
                        'Attach formal @deprecated JSDoc tag with Since version and Sunset target',
                    ),
                ],
            );
        }

        if (RecipePatternDetectors.isZeroCostModernization(beforeLines, afterLines)) {
            return this.createPatternMeta(
                'Zero-Cost Modern Abstraction and Direct Context View',
                'zero-cost-modernization',
                'Replaces heap-allocating bridge boxing wrappers with zero-cost typed views and direct solvers.',
                language,
                3,
                ['transient-bridge-boxing', 'heavyweight-wrapper'],
                [
                    this.createOp(
                        'introduce-zero-cost-view',
                        'data-binding',
                        'Replace dictionary boxing with strongly-typed zero-overhead context view',
                    ),
                ],
            );
        }

        if (RecipePatternDetectors.isInteractionDebounceIntroduction(beforeLines, afterLines)) {
            return this.createPatternMeta(
                'Interactive Action Debounce and Loading State Guard',
                'interaction-debounce',
                'Protects high-frequency buttons and RPC triggers with debounce timeout and loading mutex fencing.',
                language,
                3,
                ['missing-debounce'],
                [
                    this.createOp(
                        'inject-debounce-lock',
                        'event-handler',
                        'Upgrade bare button connection to debounced handler with loading state lock',
                    ),
                ],
            );
        }

        if (RecipePatternDetectors.isStateMachineDisciplineIntroduction(beforeLines, afterLines)) {
            return this.createPatternMeta(
                'Finite State Machine Transition Guard Discipline',
                'state-machine-discipline',
                'Replaces wild direct state variable mutations with formal guarded transition_to calls.',
                language,
                3,
                ['wild-state-mutation'],
                [
                    this.createOp(
                        'inject-transition-guard',
                        'state-machine',
                        'Enforce transition_to guard flow and entry/exit invariant execution',
                    ),
                ],
            );
        }

        if (RecipePatternDetectors.isWeakRefObserverIntroduction(beforeLines, afterLines)) {
            return this.createPatternMeta(
                'Dynamic Observer WeakRef Reference Decoupling',
                'weakref-observer',
                'Replaces strong Node references in dynamic registries with weakref wrappers to prevent zombie leaks.',
                language,
                3,
                ['strong-observer-leak'],
                [
                    this.createOp(
                        'wrap-weakref-observer',
                        'observer-registry',
                        'Wrap registered Node listener in weakref and add dead reference cleanup',
                    ),
                ],
            );
        }

        if (RecipePatternDetectors.isUnidirectionalFlowIntroduction(beforeLines, afterLines)) {
            return this.createPatternMeta(
                'Presentation Unidirectional Flow and Snapshot Immutability',
                'unidirectional-flow',
                'Eliminates in-place mutation of Snapshot DTOs in presentation layer in favor of intent commands.',
                language,
                3,
                ['dto-mutation-leak'],
                [
                    this.createOp(
                        'introduce-intent-command',
                        'presentation-view',
                        'Replace in-place DTO field mutation with intention Command dispatch to domain service',
                    ),
                ],
            );
        }

        if (
            beforeLines.some((line) => /\bProgressBar\b/.test(line)) &&
            afterLines.some((line) => /\bKStatusBar\b/.test(line))
        ) {
            return this.createPatternMeta(
                'Bare ProgressBar to KStatusBar Refactoring',
                'status-bar-component',
                'Upgrades discrete ProgressBar manipulation to KStatusBar component.',
                language,
                2,
                ['bare-progress-bar'],
                [
                    this.createOp(
                        'introduce-status-bar',
                        'progress-bar',
                        'Replace ProgressBar with KStatusBar',
                    ),
                ],
            );
        }

        if (
            beforeLines.some((line) => /Color\s*\(/.test(line)) &&
            afterLines.some((line) => /DesignTokens\./.test(line))
        ) {
            return this.createPatternMeta(
                'Hardcoded Color to DesignTokens Refactoring',
                'token-standardization',
                'Replaces raw Color literals with DesignTokens constants.',
                language,
                2,
                ['hardcoded-color-token'],
                [
                    this.createOp(
                        'replace-color-token',
                        'design-tokens',
                        'Adopt DesignTokens constants',
                    ),
                ],
            );
        }

        if (
            beforeLines.some((line) => /extends\s+Control\b/.test(line)) &&
            afterLines.some((line) => /extends\s+(BaseScreen|BaseModal)\b/.test(line))
        ) {
            return this.createPatternMeta(
                'Bare Control to BaseScreen Refactoring',
                'screen-base-inheritance',
                'Replaces bare Control inheritance with BaseScreen/BaseModal framework.',
                language,
                2,
                ['bare-control-inheritance'],
                [
                    this.createOp(
                        'extend-base-screen',
                        'base-screen',
                        'Extend BaseScreen or BaseModal',
                    ),
                ],
            );
        }

        if (
            beforeLines.some((line) => /\badd_child\b/.test(line)) &&
            afterLines.some((line) => /\bKVirtualList\b/.test(line))
        ) {
            return this.createPatternMeta(
                'List Node Virtualization & Pooling Refactoring',
                'virtual-list-pooling',
                'Converts unbounded dynamic node instantiation into KVirtualList with object pooling.',
                language,
                2,
                ['unbounded-list-instantiation'],
                [
                    this.createOp(
                        'introduce-virtual-list',
                        'virtual-list',
                        'Adopt KVirtualList with object pool',
                    ),
                ],
            );
        }

        if (
            beforeLines.some((line) => /=\s*"[A-Z]/.test(line)) &&
            afterLines.some((line) => /\b(?:tr\s*\(|UIIntermediary)/.test(line))
        ) {
            return this.createPatternMeta(
                'UI Text i18n Localization Refactoring',
                'i18n-localization',
                'Wraps raw display strings into localized tr(KEY) or UIIntermediary bindings.',
                language,
                2,
                ['unlocalized-ui-string'],
                [
                    this.createOp(
                        'introduce-i18n-binding',
                        'i18n-service',
                        'Bind UI text to i18n dictionary',
                    ),
                ],
            );
        }

        if (
            beforeLines.some((line) => /\b(?:get_parent|find_child)\b/.test(line)) &&
            afterLines.some((line) => /%[A-Za-z0-9_]+/.test(line))
        ) {
            return this.createPatternMeta(
                'Explicit Unique Node Path Refactoring',
                'explicit-node-unique',
                'Replaces fragile node traversal with explicit %UniqueNode references.',
                language,
                2,
                ['fragile-node-path'],
                [
                    this.createOp(
                        'replace-relative-node-path',
                        'node-path',
                        'Use %UniqueNode reference',
                    ),
                ],
            );
        }

        if (
            beforeLines.some((line) => /\bGameState\./.test(line)) &&
            afterLines.some((line) => /\bapply_snapshot\b/.test(line))
        ) {
            return this.createPatternMeta(
                'Presentation Domain Boundary Decoupling Refactoring',
                'presentation-decoupling',
                'Decouples presentation views from backend singletons via apply_snapshot contract.',
                language,
                2,
                ['backend-singleton-coupling'],
                [
                    this.createOp(
                        'isolate-domain-boundary',
                        'presentation-view',
                        'Decouple view via snapshot flow',
                    ),
                ],
            );
        }

        return undefined;
    }

    private createPatternMeta(
        name: string,
        category: RecipeCategory,
        description: string,
        language: string | undefined,
        minLines: number,
        antiPatternTags: string[],
        operations: TransformOp[],
        minComplexity?: number,
    ): RecipeMeta {
        return {
            name,
            category,
            description,
            precondition: {
                targetLanguage: language,
                minLines,
                ...(minComplexity === undefined ? {} : { minComplexity }),
                antiPatternTags,
            },
            operations,
        };
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
