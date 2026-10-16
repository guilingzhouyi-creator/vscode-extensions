/**
 * Module: Core Engine — Trajectory Recipe Pattern Detectors
 * File Path: src/core/trajectory/recipe-pattern-detectors.ts
 * Architecture Role: Static transformation pattern recognition engine for historical code
 *   evolution trajectories (Bad -> Good transitions).
 * Dependencies & Triggers: Consumed by TrajectoryRecipeExtractor in trajectory/recipeExtractor.
 * Responsibilities: Provides pure-function pattern heuristics detecting structural refactorings,
 *   including extract-method, parameter objects, strategy maps, defensive guards, object pools,
 *   CAS locks, config cache invalidation, DTO aggregation, and unidirectional flow.
 * Exit Semantics & Design Rationale: Pure functional detectors with zero side effects; isolated
 *   from recipeExtractor to enforce physical line budget boundaries (< 900 LOC).
 */

function resolveText(lines: string[], text?: string): string {
    return text !== undefined ? text : lines.join('\n');
}

function countBranchMatches(text: string, minCount: number): number {
    const re = /case\s+|else\s+if/g;
    let count = 0;
    while (re.exec(text) !== null) {
        count++;
        if (count >= minCount) break;
    }
    return count;
}

/**
 * Static heuristic detectors identifying refactoring patterns between code revisions.
 */
export class RecipePatternDetectors {
    /**
     * Pattern 1: Long Function Splitting (extract-method).
     */
    public static isFunctionSplit(before: string[], after: string[]): boolean {
        const countFn = (lines: string[]): number =>
            lines.filter((line) => {
                const trimmed = line.trim();
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
        return before.length >= 20 && afterFnCount >= beforeFnCount + 1;
    }

    /**
     * Pattern 2: Multi-parameter grouping into parameter object.
     */
    public static isParameterObjectIntroduction(
        before: string[],
        after: string[],
        beforeText?: string,
        afterText?: string,
    ): boolean {
        const beforeSrc = resolveText(before, beforeText);
        const afterSrc = resolveText(after, afterText);
        const hasManyArgsBefore =
            /\(\s*\w+\s*(?::\s*[^,)]+)?,\s*\w+\s*(?::\s*[^,)]+)?,\s*\w+\s*(?::\s*[^,)]+)?,\s*\w+/.test(
                beforeSrc,
            );
        const hasOptionsInterfaceAfter =
            /interface\s+\w+Options|type\s+\w+Config\s*=|interface\s+\w+Config|\w+Options\b/.test(
                afterSrc,
            );
        return hasManyArgsBefore && hasOptionsInterfaceAfter;
    }

    /**
     * Pattern 3: Branching cascade converted to strategy dispatch.
     */
    public static isStrategyDispatchConversion(
        before: string[],
        after: string[],
        beforeText?: string,
        afterText?: string,
    ): boolean {
        const beforeSrc = resolveText(before, beforeText);
        const afterSrc = resolveText(after, afterText);
        const beforeBranches = countBranchMatches(beforeSrc, 3);
        const afterHasMapOrRecord =
            /const\s+\w*(?:Handlers|_HANDLERS|Strategy|_STRATEGY|Dispatch)\s*:\s*Record|new\s+Map|\bMap<\w+,\s*\w+>|\w+_HANDLERS\b/i.test(
                afterSrc,
            );
        return beforeBranches >= 3 && afterHasMapOrRecord;
    }

    /**
     * Pattern 4: Defensive Guard / Error Wrap Injection.
     */
    public static isDefensiveGuardAddition(
        before: string[],
        after: string[],
        beforeText?: string,
        afterText?: string,
    ): boolean {
        const beforeSrc = resolveText(before, beforeText);
        const afterSrc = resolveText(after, afterText);
        const beforeHasGuards = /if\s*\(!\w+\)\s*return|try\s*\{/.test(beforeSrc);
        const afterHasGuards = /if\s*\(!\w+\)\s*return|try\s*\{/.test(afterSrc);
        return !beforeHasGuards && afterHasGuards;
    }

    /**
     * Pattern 5: Object Pool & Reset State Lifecycle (object-pool-lifecycle).
     */
    public static isObjectPoolIntroduction(
        before: string[],
        after: string[],
        beforeText?: string,
        afterText?: string,
    ): boolean {
        const beforeSrc = resolveText(before, beforeText);
        const afterSrc = resolveText(after, afterText);
        const beforeHasPool = /\b(acquire|release|_pool|reset_state)\b/.test(beforeSrc);
        const afterHasPool =
            /\b(reset_state|acquire\s*\(|release\s*\(|_pool\b)/.test(afterSrc) &&
            (/\breset_state\b/.test(afterSrc) || /\b_pool\b/.test(afterSrc));
        return !beforeHasPool && afterHasPool;
    }

    /**
     * Pattern 6: CAS Reentrancy Guard (cas-reentrancy-guard).
     */
    public static isCasReentrancyGuardIntroduction(
        before: string[],
        after: string[],
        beforeText?: string,
        afterText?: string,
    ): boolean {
        const beforeSrc = resolveText(before, beforeText);
        const afterSrc = resolveText(after, afterText);

        const beforeHasCas = /(_is_executing|_is_stopping|is_reentrant|_cas_lock)\b/.test(
            beforeSrc,
        );
        const afterHasCas =
            /(_is_executing|_is_stopping|is_reentrant|_cas_lock)\s*[:=]/.test(afterSrc) &&
            /if\s+.*(_is_executing|_is_stopping|is_reentrant|_cas_lock)/.test(afterSrc);

        return !beforeHasCas && afterHasCas;
    }

    /**
     * Pattern 7: Config Cache Invalidation & Hot-Reload (config-cache-invalidation).
     */
    public static isConfigCacheInvalidationIntroduction(
        before: string[],
        after: string[],
        beforeText?: string,
        afterText?: string,
    ): boolean {
        const beforeSrc = resolveText(before, beforeText);
        const afterSrc = resolveText(after, afterText);

        const beforeHasInvalidate =
            /\b(invalidate_cache|_ensure_\w+_cache|config_reload_version)\b/.test(beforeSrc);
        const afterHasInvalidate =
            /\b(invalidate_cache|_ensure_\w+_cache|config_reload_version)\b/.test(afterSrc);

        return !beforeHasInvalidate && afterHasInvalidate;
    }

    /**
     * Pattern 8: DTO Context Aggregation & Backward-Compatible Bridge.
     */
    public static isDtoContextAggregationIntroduction(
        before: string[],
        after: string[],
        beforeText?: string,
        afterText?: string,
    ): boolean {
        const beforeSrc = resolveText(before, beforeText);
        const afterSrc = resolveText(after, afterText);
        return (
            /\b(func|function)\s+\w+\s*\(\s*\w+[^,)]+,\s*\w+[^,)]+,\s*\w+[^,)]+,\s*\w+/.test(
                beforeSrc,
            ) &&
            /\b(func|function)\s+\w+_context\b|\b\w+ContextDTO\b/.test(afterSrc) &&
            /\b(from_stat_mutation|from_wallet_mutation|create\s*\(|_context\s*\()/.test(afterSrc)
        );
    }

    /**
     * Pattern 9: Dynamic Hook Decoupling (hook-decoupling).
     */
    public static isHookDecouplingIntroduction(
        before: string[],
        after: string[],
        beforeText?: string,
        afterText?: string,
    ): boolean {
        const beforeSrc = resolveText(before, beforeText);
        const afterSrc = resolveText(after, afterText);
        return (
            /\b(if\s+step\s*==|match\s+phase|switch\s*\(stage\))/.test(beforeSrc) &&
            /\b(dispatch_hook|invoke_hook|HookRegistry|_hook_bus|execute_pipeline_hook)\b/.test(
                afterSrc,
            )
        );
    }

    /**
     * Pattern 10: Shim Elimination & Obsolete Bridge Purge (shim-elimination).
     */
    public static isShimEliminationIntroduction(
        before: string[],
        after: string[],
        beforeText?: string,
        afterText?: string,
    ): boolean {
        const beforeSrc = resolveText(before, beforeText);
        const afterSrc = resolveText(after, afterText);
        return (
            /\b(from_stat_mutation|from_wallet_mutation|apply_mutation_legacy|bridge_)\b/.test(
                beforeSrc,
            ) &&
            !/\b(from_stat_mutation|from_wallet_mutation|apply_mutation_legacy|bridge_)\b/.test(
                afterSrc,
            ) &&
            /\bapply_mutation_context\b/.test(afterSrc)
        );
    }

    /**
     * Pattern 11: Direct Modern Migration (direct-modern-migration).
     */
    public static isDirectModernMigrationIntroduction(
        before: string[],
        after: string[],
        beforeText?: string,
        afterText?: string,
    ): boolean {
        const beforeSrc = resolveText(before, beforeText);
        const afterSrc = resolveText(after, afterText);
        return (
            /\.apply_mutation\(\s*[^,)]+,\s*[^,)]+,\s*[^,)]+,\s*[^,)]+/.test(beforeSrc) &&
            /\.apply_mutation_context\(\s*(?:new\s+\w+ContextDTO|\w+ContextDTO\.create|ctx\b)/.test(
                afterSrc,
            )
        );
    }

    /**
     * Pattern 12: Deprecation Lifecycle Annotation (deprecation-lifecycle).
     */
    public static isDeprecationLifecycleAnnotation(
        before: string[],
        after: string[],
        beforeText?: string,
        afterText?: string,
    ): boolean {
        const beforeSrc = resolveText(before, beforeText);
        const afterSrc = resolveText(after, afterText);
        return (
            !/@deprecated\b/.test(beforeSrc) &&
            /@deprecated\s+\[Since\s+v[^\]]+,\s*Sunset\s+v[^\]]+\]|@deprecated\b/.test(afterSrc)
        );
    }

    /**
     * Pattern 13: Zero-Cost Modern Abstraction (zero-cost-modernization).
     */
    public static isZeroCostModernization(
        before: string[],
        after: string[],
        beforeText?: string,
        afterText?: string,
    ): boolean {
        const beforeSrc = resolveText(before, beforeText);
        const afterSrc = resolveText(after, afterText);
        const beforeHasBoxing =
            /\bvar\s+\w+\s*=\s*\{\s*["']\w+["']\s*:/.test(beforeSrc) ||
            /new\s+Object\(\)|\.duplicate\(true\)/.test(beforeSrc);
        const afterHasZeroCost =
            /\b(ReadOnlyContext|TypedContextView|solve_direct)\b/.test(afterSrc) &&
            !/\bvar\s+\w+\s*=\s*\{\s*["']\w+["']\s*:/.test(afterSrc);
        return beforeHasBoxing && afterHasZeroCost;
    }

    /**
     * Pattern 14: Interaction Debounce Guard (interaction-debounce).
     */
    public static isInteractionDebounceIntroduction(
        before: string[],
        after: string[],
        beforeText?: string,
        afterText?: string,
    ): boolean {
        const beforeSrc = resolveText(before, beforeText);
        const afterSrc = resolveText(after, afterText);
        return (
            /\.pressed\.connect\s*\(/.test(beforeSrc) &&
            !/\bdebounced_pressed\b/.test(beforeSrc) &&
            /\b(debounced_pressed|KButtonClass|is_loading|_debounce_timer)\b/.test(afterSrc)
        );
    }

    /**
     * Pattern 15: State Machine Guard Discipline (state-machine-discipline).
     */
    public static isStateMachineDisciplineIntroduction(
        before: string[],
        after: string[],
        beforeText?: string,
        afterText?: string,
    ): boolean {
        const beforeSrc = resolveText(before, beforeText);
        const afterSrc = resolveText(after, afterText);
        return (
            /_current_state\s*=\s*(?:State\.|STATE_|\w+)/.test(beforeSrc) &&
            !/transition_to\s*\(/.test(beforeSrc) &&
            /transition_to\s*\(\s*(?:State\.|STATE_|\w+)/.test(afterSrc)
        );
    }

    /**
     * Pattern 16: Observer WeakRef Reference Safety (weakref-observer).
     */
    public static isWeakRefObserverIntroduction(
        before: string[],
        after: string[],
        beforeText?: string,
        afterText?: string,
    ): boolean {
        const beforeSrc = resolveText(before, beforeText);
        const afterSrc = resolveText(after, afterText);
        return (
            /\b(?:_observers|_listeners|_bindings)\.append\s*\(\s*\w+\s*\)/.test(beforeSrc) &&
            !/weakref\s*\(/.test(beforeSrc) &&
            /weakref\s*\(\s*\w+\s*\)/.test(afterSrc)
        );
    }

    /**
     * Pattern 17: Unidirectional Data Flow Integrity (unidirectional-flow).
     */
    public static isUnidirectionalFlowIntroduction(
        before: string[],
        after: string[],
        beforeText?: string,
        afterText?: string,
    ): boolean {
        const beforeSrc = resolveText(before, beforeText);
        const afterSrc = resolveText(after, afterText);
        return (
            /\b(?:snapshot|dto|_snapshot|_dto)\s*\.\s*\w+\s*(?:=|\+=|-=|\*=)/.test(beforeSrc) &&
            /\b(?:dispatch_intent|send_command|request_\w+|call_domain)\b/.test(afterSrc) &&
            !/\b(?:snapshot|dto|_snapshot|_dto)\s*\.\s*\w+\s*(?:=|\+=|-=|\*=)/.test(afterSrc)
        );
    }
}
