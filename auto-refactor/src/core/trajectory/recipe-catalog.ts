/**
 * Module: Core Engine - Trajectory Recipe Catalog
 * File Path: src/core/trajectory/recipe-catalog.ts
 * Architecture Role: Central catalog of static pattern descriptors and recipe category
 *   prefixes used by TrajectoryRecipeExtractor to synthesize refactoring recipes.
 * Dependencies & Triggers: Consumes recipeTypes and recipe-pattern-detectors; consumed by
 *   recipeExtractor.
 * Responsibilities: Provide descriptive transformation definitions, precondition thresholds,
 *   anti-pattern heuristics, and category prefix mappings for learned refactoring recipes.
 * Exit Semantics & Design Rationale: Pure metadata constants and declarative pattern
 *   definitions; decoupled from extraction execution logic to keep single responsibility.
 */

import type { RecipeCategory, TransformOp } from './recipeTypes';
import { RecipePatternDetectors } from './recipe-pattern-detectors';

/**
 * Transformation pattern descriptor defining precondition predicates and operations.
 */
export interface PatternDescriptor {
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
 * Category prefix dictionary for deterministic recipe ID synthesis.
 */
export const CATEGORY_PREFIXES: Readonly<Record<RecipeCategory, string>> = {
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

/**
 * Static catalog of transformation pattern descriptors.
 */
export const PATTERN_DESCRIPTORS: readonly PatternDescriptor[] = [
    {
        match: (beforeLines, afterLines) =>
            RecipePatternDetectors.isFunctionSplit(beforeLines, afterLines),
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
        match: (beforeLines, afterLines) =>
            RecipePatternDetectors.isParameterObjectIntroduction(beforeLines, afterLines),
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
        match: (beforeLines, afterLines) =>
            RecipePatternDetectors.isStrategyDispatchConversion(beforeLines, afterLines),
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
        match: (beforeLines, afterLines) =>
            RecipePatternDetectors.isDefensiveGuardAddition(beforeLines, afterLines),
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
        match: (beforeLines, afterLines) =>
            RecipePatternDetectors.isObjectPoolIntroduction(beforeLines, afterLines),
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
        match: (beforeLines, afterLines) =>
            RecipePatternDetectors.isCasReentrancyGuardIntroduction(beforeLines, afterLines),
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
        match: (beforeLines, afterLines) =>
            RecipePatternDetectors.isConfigCacheInvalidationIntroduction(beforeLines, afterLines),
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
        match: (beforeLines, afterLines) =>
            RecipePatternDetectors.isDtoContextAggregationIntroduction(beforeLines, afterLines),
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
        match: (beforeLines, afterLines) =>
            RecipePatternDetectors.isHookDecouplingIntroduction(beforeLines, afterLines),
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
        match: (beforeLines, afterLines) =>
            RecipePatternDetectors.isShimEliminationIntroduction(beforeLines, afterLines),
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
        match: (beforeLines, afterLines) =>
            RecipePatternDetectors.isDirectModernMigrationIntroduction(beforeLines, afterLines),
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
        match: (beforeLines, afterLines) =>
            RecipePatternDetectors.isDeprecationLifecycleAnnotation(beforeLines, afterLines),
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
        match: (beforeLines, afterLines) =>
            RecipePatternDetectors.isZeroCostModernization(beforeLines, afterLines),
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
        match: (beforeLines, afterLines) =>
            RecipePatternDetectors.isInteractionDebounceIntroduction(beforeLines, afterLines),
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
        match: (beforeLines, afterLines) =>
            RecipePatternDetectors.isStateMachineDisciplineIntroduction(beforeLines, afterLines),
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
        match: (beforeLines, afterLines) =>
            RecipePatternDetectors.isWeakRefObserverIntroduction(beforeLines, afterLines),
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
        match: (beforeLines, afterLines) =>
            RecipePatternDetectors.isUnidirectionalFlowIntroduction(beforeLines, afterLines),
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
        match: (beforeLines, afterLines) =>
            beforeLines.some((sourceLine) => /\bProgressBar\b/.test(sourceLine)) &&
            afterLines.some((sourceLine) => /\bKStatusBar\b/.test(sourceLine)),
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
        match: (beforeLines, afterLines) =>
            beforeLines.some((sourceLine) => /Color\s*\(/.test(sourceLine)) &&
            afterLines.some((sourceLine) => /DesignTokens\./.test(sourceLine)),
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
        match: (beforeLines, afterLines) =>
            beforeLines.some((sourceLine) => /extends\s+Control\b/.test(sourceLine)) &&
            afterLines.some((sourceLine) => /extends\s+(BaseScreen|BaseModal)\b/.test(sourceLine)),
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
        match: (beforeLines, afterLines) =>
            beforeLines.some((sourceLine) => /\badd_child\b/.test(sourceLine)) &&
            afterLines.some((sourceLine) => /\bKVirtualList\b/.test(sourceLine)),
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
        match: (beforeLines, afterLines) =>
            beforeLines.some((sourceLine) => /=\s*"[A-Z]/.test(sourceLine)) &&
            afterLines.some((sourceLine) => /\b(?:tr\s*\(|UIIntermediary)/.test(sourceLine)),
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
        match: (beforeLines, afterLines) =>
            beforeLines.some((sourceLine) => /\b(?:get_parent|find_child)\b/.test(sourceLine)) &&
            afterLines.some((sourceLine) => /%[A-Za-z0-9_]+/.test(sourceLine)),
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
        match: (beforeLines, afterLines) =>
            beforeLines.some((sourceLine) => /\bGameState\./.test(sourceLine)) &&
            afterLines.some((sourceLine) => /\bapply_snapshot\b/.test(sourceLine)),
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

