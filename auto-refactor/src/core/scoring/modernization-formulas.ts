/**
 * Module: Core Engine — Modernization, Trajectory Velocity & Compatibility Formulas
 * File Path: src/core/scoring/modernization-formulas.ts
 * Architecture Role: Pure mathematical transformations and metrics evaluating architecture
 *   modernization, compatibility layer technical debt, trajectory velocity, and zero-cost utilities.
 * Dependencies & Triggers: Consumes scoringTypes; exported through scorer-formulas and index.
 * Responsibilities:
 *   1. Calculate trajectory quality velocity with churn dampening.
 *   2. Evaluate recipe generalization index and statistical stability.
 *   3. Compute parameter clump density and hot-loop allocation pressure.
 *   4. Quantify hook decoupling, data-flow purity, pool conservation, and CAS reentrancy safety.
 *   5. Measure compatibility layer debt decay, directness purity, and deprecation containment.
 *   6. Assess Pareto zero-cost modern utility and modern construct adoption rate.
 * Exit Semantics & Design Rationale: Pure deterministic math helpers; zero I/O.
 */

import type { QualityScoreBreakdown } from './scoringTypes';
import { scoreDelta, SCORE_ROUNDING, PERCENT_SCALE } from './scorer-formulas';

/** Default parameter overload limit threshold before quadratic penalty triggers. */
export const DEFAULT_PARAM_CLUMP_THRESHOLD = 4;
/** Churn dampening coefficient used in trajectory convergence calculations. */
export const DEFAULT_CHURN_DAMPENING_GAMMA = 0.5;

/**
 * Compute the churn-damped quality improvement velocity across a Bad-to-Good trajectory.
 *
 * Mathematical formulation:
 * \Delta Q_{\text{velocity}} = \Delta S \cdot \frac{1}{1 + \gamma \cdot \text{churnRatio}}
 *
 * @param beforeScore - Quality score breakdown before trajectory refactoring.
 * @param afterScore - Quality score breakdown after trajectory refactoring.
 * @param churnRatio - Ratio of modified/deleted lines to total file size.
 * @param gamma - Churn penalty coefficient (default 0.5).
 * @returns Churn-normalized improvement velocity.
 */
export function calculateTrajectoryQualityVelocity(
    beforeScore?: QualityScoreBreakdown | null,
    afterScore?: QualityScoreBreakdown | null,
    churnRatio: number = 0,
    gamma: number = DEFAULT_CHURN_DAMPENING_GAMMA,
): number {
    if (!beforeScore || !afterScore) {
        return 0;
    }
    const rawDelta = scoreDelta(beforeScore.compositeScore, afterScore.compositeScore);
    if (rawDelta === null) {
        return 0;
    }
    const safeChurn = Math.max(0, churnRatio);
    const dampening = 1.0 / (1.0 + gamma * safeChurn);
    return Math.round(rawDelta * dampening * SCORE_ROUNDING) / SCORE_ROUNDING;
}

/**
 * Quantify the generalization index and statistical stability of an extracted refactoring recipe.
 *
 * Mathematical formulation:
 * G(R) = \left(\frac{\text{support}}{\text{trials}}\right) \cdot (1 - \text{normalizedEntropy}) \cdot \max(0, \overline{\Delta S})
 *
 * @param supportCount - Number of successful Bad-to-Good trajectory applications.
 * @param totalTrials - Total candidate targets evaluated.
 * @param normalizedEntropy - Dispersion of outcome metrics in [0, 1].
 * @param meanImpactScore - Average composite quality gain across targets.
 * @returns Generalization index in [0, 100].
 */
export function calculateRecipeGeneralizationIndex(
    supportCount: number,
    totalTrials: number,
    normalizedEntropy: number,
    meanImpactScore: number,
): number {
    if (totalTrials <= 0 || supportCount <= 0) {
        return 0;
    }
    const supportRatio = Math.min(1.0, supportCount / totalTrials);
    const stability = Math.max(0, Math.min(1.0, 1.0 - normalizedEntropy));
    const safeImpact = Math.max(0, meanImpactScore);
    const index = supportRatio * stability * safeImpact;
    return Math.round(Math.min(100, index) * SCORE_ROUNDING) / SCORE_ROUNDING;
}

/**
 * Compute the quadratic parameter clump density penalty.
 *
 * Mathematical formulation:
 * P_{\text{clump}} = \max(0, N_{\text{params}} - \theta)^2 \cdot \sqrt{\text{CC}}
 *
 * @param parameterCount - Number of arguments in function signature.
 * @param cyclomaticComplexity - Cyclomatic complexity of the function body.
 * @param threshold - Maximum allowed arguments without penalty (default 4).
 * @returns Quadratic parameter clump penalty points.
 */
export function calculateParameterClumpDensity(
    parameterCount: number,
    cyclomaticComplexity: number,
    threshold: number = DEFAULT_PARAM_CLUMP_THRESHOLD,
): number {
    const excess = Math.max(0, parameterCount - threshold);
    if (excess === 0) {
        return 0;
    }
    const ccWeight = Math.sqrt(Math.max(1, cyclomaticComplexity));
    const penalty = Math.pow(excess, 2) * ccWeight;
    return Math.round(penalty * SCORE_ROUNDING) / SCORE_ROUNDING;
}

/**
 * Quantify hot-loop transient memory allocation pressure.
 *
 * Mathematical formulation:
 * P_{\text{alloc}} = N_{\text{alloc}} \cdot e^{\alpha \cdot \text{nestingDepth}}
 *
 * @param loopAllocationCount - Number of object/array allocations within loops.
 * @param maxNestingDepth - Maximum nesting depth of loops enclosing allocations.
 * @param alpha - Nesting depth exponential factor (default 0.6).
 * @returns Allocation pressure penalty score.
 */
export function calculateLoopAllocationPressure(
    loopAllocationCount: number,
    maxNestingDepth: number,
    alpha: number = 0.6,
): number {
    if (loopAllocationCount <= 0) {
        return 0;
    }
    const safeDepth = Math.max(0, maxNestingDepth);
    const penalty = loopAllocationCount * Math.exp(alpha * safeDepth);
    return Math.round(penalty * SCORE_ROUNDING) / SCORE_ROUNDING;
}

/** Compatibility alias for hot-loop allocation pressure */
export const calculateHotLoopAllocationPressure = calculateLoopAllocationPressure;

/**
 * Measure hook configuration decoupling ratio.
 *
 * Mathematical formulation:
 * R_{\text{hook}} = \frac{N_{\text{hookedOps}}}{N_{\text{hardcodedBranches}} + N_{\text{hookedOps}}}
 *
 * @param hookedOpsCount - Number of operations driven by registered dynamic hooks.
 * @param hardcodedBranchesCount - Number of hardcoded stage/phase conditional branches.
 * @returns Decoupling ratio in [0, 1].
 */
export function calculateHookDecouplingRatio(
    hookedOpsCount: number,
    hardcodedBranchesCount: number,
): number {
    const total = Math.max(0, hookedOpsCount) + Math.max(0, hardcodedBranchesCount);
    if (total <= 0) {
        return 1.0;
    }
    const ratio = Math.max(0, hookedOpsCount) / total;
    return Math.round(ratio * PERCENT_SCALE) / PERCENT_SCALE;
}

/**
 * Quantify Data-Flow Purity and Reference Isolation Score.
 *
 * Mathematical formulation:
 * H_{\text{purity}} = 1.0 - \min\left(1.0, \frac{N_{\text{sharedMutations}} + 2 \cdot N_{\text{globalEscapes}}}{N_{\text{totalOps}} + 1}\right)
 *
 * @param sharedMutationsCount - Direct modifications to shared state or input parameter refs.
 * @param globalEscapesCount - Escapes to global singletons / external mutable registries.
 * @param totalOpsCount - Total state manipulation operations.
 * @returns Purity ratio in [0, 1].
 */
export function calculateDataFlowPurityScore(
    sharedMutationsCount: number,
    globalEscapesCount: number,
    totalOpsCount: number,
): number {
    const penaltyNumerator =
        Math.max(0, sharedMutationsCount) + 2 * Math.max(0, globalEscapesCount);
    const denominator = Math.max(0, totalOpsCount) + 1;
    const rawRatio = penaltyNumerator / denominator;
    const purity = Math.max(0, 1.0 - Math.min(1.0, rawRatio));
    return Math.round(purity * PERCENT_SCALE) / PERCENT_SCALE;
}

/** Compatibility alias for data flow purity */
export function calculateDataFlowPurity(mutationsCount: number, totalOpsCount: number): number {
    return calculateDataFlowPurityScore(mutationsCount, 0, totalOpsCount);
}

/**
 * Evaluate Object Pool Conservation and Reset State Completeness Law.
 *
 * Mathematical formulation:
 * \Phi_{\text{pool}} = \min\left(1.0, \frac{N_{\text{poolAcquires}}}{N_{\text{poolReleases}} + 1}\right) \cdot \mathbb{I}(\text{hasResetState})
 *
 * @param poolAcquires - Count of acquire calls.
 * @param poolReleases - Count of release calls.
 * @param hasResetState - Whether class implements reset_state method.
 * @returns Pool conservation index in [0, 1].
 */
export function calculateObjectPoolConservationIndex(
    poolAcquires: number,
    poolReleases: number,
    hasResetState: boolean,
): number {
    if (!hasResetState) {
        return 0;
    }
    if (poolAcquires <= 0 && poolReleases <= 0) {
        return 1.0;
    }
    const diff = Math.abs(poolAcquires - poolReleases);
    const maxOps = Math.max(poolAcquires, poolReleases, 1);
    const balance = Math.max(0, 1.0 - diff / maxOps);
    return Math.round(balance * PERCENT_SCALE) / PERCENT_SCALE;
}

/** Compatibility alias for object pool conservation */
export function calculateObjectPoolConservation(
    poolCapacity: number,
    leakCount: number,
    hasResetState: boolean,
): number {
    if (!hasResetState) return 0;
    if (poolCapacity <= 0) return 1.0;
    const balance = Math.max(0, 1.0 - Math.max(0, leakCount) / poolCapacity);
    return Math.round(balance * PERCENT_SCALE) / PERCENT_SCALE;
}

/**
 * Quantify State Machine CAS Reentrancy Safety Index.
 *
 * Mathematical formulation:
 * S_{\text{cas}} = \frac{N_{\text{guardedTransitions}}}{N_{\text{totalTransitions}} + 1} \cdot \left(1.0 - \text{reentrancyExposureRatio}\right)
 *
 * @param guardedTransitions - Transitions protected by boolean CAS flags or state guards.
 * @param totalTransitions - Total state transitions in lifecycle engine.
 * @param reentrancyExposureRatio - Fraction of transitions unguarded against re-entrant calls [0, 1].
 * @returns CAS safety index in [0, 1].
 */
export function calculateCasReentrancySafetyIndex(
    guardedTransitions: number,
    totalTransitions: number,
    reentrancyExposureRatio: number = 0,
): number {
    const denominator = Math.max(1, totalTransitions);
    const guardRatio = Math.min(1.0, Math.max(0, guardedTransitions) / denominator);
    const exposureDampening = Math.max(
        0,
        1.0 - Math.min(1.0, Math.max(0, reentrancyExposureRatio)),
    );
    const safety = guardRatio * exposureDampening;
    return Math.round(safety * PERCENT_SCALE) / PERCENT_SCALE;
}

/** Compatibility alias for reentrancy safety index */
export function calculateReentrancySafetyIndex(
    guardedTransitions: number,
    totalTransitions: number,
    reentrancyExposureRatio: number = 0,
): number {
    return calculateCasReentrancySafetyIndex(
        guardedTransitions,
        totalTransitions,
        reentrancyExposureRatio,
    );
}

/**
 * Measure Architecture Indirection-to-Cohesion Utility Metric.
 *
 * Mathematical formulation:
 * U_{\text{arch}} = \frac{C_{\text{cohesion}}}{1.0 + \beta \cdot D_{\text{indirection}}}
 *
 * @param cohesionScore - Functional cohesion metric in [0, 100].
 * @param indirectionDepth - Chain length of delegating abstractions / wrappers.
 * @param beta - Indirection penalty coefficient (default 0.25).
 * @returns Utility score in [0, 100].
 */
export function calculateIndirectionUtilityMetric(
    cohesionScore: number,
    indirectionDepth: number,
    beta: number = 0.25,
): number {
    const safeCohesion = Math.max(0, cohesionScore);
    const safeIndirection = Math.max(0, indirectionDepth);
    const denominator = 1.0 + beta * safeIndirection;
    const utility = safeCohesion / denominator;
    return Math.round(utility * SCORE_ROUNDING) / SCORE_ROUNDING;
}

/** Compatibility alias for indirection cohesion utility */
export function calculateIndirectionCohesionUtility(
    cohesionScore: number,
    wrapperDepth: number,
    bridgeCount: number = 0,
    alpha: number = 0.2,
    beta: number = 0.1,
): number {
    const safeCohesion = Math.max(0, cohesionScore);
    const denominator = 1.0 + alpha * Math.max(0, wrapperDepth) + beta * Math.max(0, bridgeCount);
    const utility = safeCohesion / denominator;
    return Math.round(utility * SCORE_ROUNDING) / SCORE_ROUNDING;
}

/**
 * Quantify Versioned Config Cache Freshness & Self-Healing Safety.
 *
 * Mathematical formulation:
 * C_{\text{cache}} = \frac{N_{\text{invalidatedOnReload}}}{N_{\text{cachedTables}} + 1} \cdot \left(1 - \text{staleWindowRatio}\right)
 *
 * @param invalidatedTablesCount - Count of cache maps flushed upon reload trigger.
 * @param totalCachedTablesCount - Total cached configuration lookup tables.
 * @param staleWindowRatio - Proportion of time cache serves outdated schema [0, 1].
 * @returns Cache freshness score in [0, 1].
 */
export function calculateConfigCacheFreshnessScore(
    invalidatedTablesCount: number,
    totalCachedTablesCount: number,
    staleWindowRatio: number = 0,
): number {
    if (totalCachedTablesCount <= 0) {
        return 1.0;
    }
    const flushRatio = Math.min(
        1.0,
        Math.max(0, invalidatedTablesCount) / Math.max(1, totalCachedTablesCount),
    );
    const stalenessPenalty = Math.max(0, 1.0 - Math.min(1.0, Math.max(0, staleWindowRatio)));
    const freshness = flushRatio * stalenessPenalty;
    return Math.round(freshness * PERCENT_SCALE) / PERCENT_SCALE;
}

/** Compatibility alias for cache freshness safety */
export function calculateCacheFreshnessSafety(
    invalidatedTablesCount: number,
    totalCachedTablesCount: number,
    staleWindowRatio: number = 0,
): number {
    return calculateConfigCacheFreshnessScore(
        invalidatedTablesCount,
        totalCachedTablesCount,
        staleWindowRatio,
    );
}

/**
 * Calculate DTO Backward-Compatibility Bridge Index.
 *
 * Mathematical formulation:
 * B_{\text{compat}} = \frac{N_{\text{legacyBridges}} + N_{\text{typedDTO}}}{N_{\text{directLegacyCalls}} + N_{\text{legacyBridges}} + N_{\text{typedDTO}} + 1}
 *
 * @param legacyBridgesCount - Legacy signature wrappers delegating to context DTOs.
 * @param directTypedDtoCalls - Direct calls to context DTO signatures.
 * @param directLegacyCalls - Un-migrated legacy scalar signature calls.
 * @returns Compatibility bridge index in [0, 1].
 */
export function calculateDtoCompatibilityBridgeIndex(
    legacyBridgesCount: number,
    directTypedDtoCalls: number,
    directLegacyCalls: number = 0,
): number {
    const modernBridgeOps = Math.max(0, legacyBridgesCount) + Math.max(0, directTypedDtoCalls);
    const total = modernBridgeOps + Math.max(0, directLegacyCalls) + 1;
    const index = modernBridgeOps / total;
    return Math.round(index * PERCENT_SCALE) / PERCENT_SCALE;
}

/** Compatibility alias for DTO compatibility index */
export function calculateDtoCompatibilityIndex(
    bridgedCallCount: number,
    totalCallCount: number,
): number {
    if (totalCallCount <= 0) return 1.0;
    const ratio = Math.min(1.0, Math.max(0, bridgedCallCount) / totalCallCount);
    return Math.round(ratio * PERCENT_SCALE) / PERCENT_SCALE;
}

/**
 * Measure Schema Grounding Rate for Dynamic Domain Literals.
 *
 * Mathematical formulation:
 * G_{\text{ground}} = \frac{N_{\text{groundedLiterals}}}{N_{\text{totalDomainLiterals}} + 1}
 *
 * @param groundedLiteralsCount - Identifiers verified in domain schemas / configs.
 * @param totalDomainLiteralsCount - Total literal domain identifiers referenced.
 * @returns Grounding rate in [0, 1].
 */
export function calculateSchemaGroundingRate(
    groundedLiteralsCount: number,
    totalDomainLiteralsCount: number,
): number {
    const total = Math.max(0, totalDomainLiteralsCount);
    if (total === 0) {
        return 1.0;
    }
    const rate = Math.min(1.0, Math.max(0, groundedLiteralsCount) / total);
    return Math.round(rate * PERCENT_SCALE) / PERCENT_SCALE;
}

/**
 * Compute Compatibility Layer Technical Debt Decay Penalty.
 *
 * Mathematical formulation:
 * P_{\text{shim}} = \sum_{s \in \text{Shims}} W(s) \cdot \left(1 + \mu \cdot \text{AgeDays}(s)\right) \cdot \frac{N_{\text{calls}}(s)}{N_{\text{totalCalls}} + 1}
 *
 * @param shimWeights - Base weight / complexity of the compatibility shims.
 * @param ageDays - Age of the shim since introduction in days.
 * @param callCount - Number of call sites still routing through the shim.
 * @param totalCallCount - Total call sites across old and new API.
 * @param mu - Aging debt growth factor per day (default 0.02 = 2% per day).
 * @returns Dynamic shim penalty score.
 */
export function calculateShimDebtDecayPenalty(
    shimWeights: number,
    ageDays: number,
    callCount: number,
    totalCallCount: number,
    mu: number = 0.02,
): number {
    if (shimWeights <= 0 || callCount <= 0) {
        return 0;
    }
    const safeAge = Math.max(0, ageDays);
    const agingMultiplier = 1.0 + mu * safeAge;
    const callRatio = Math.min(1.0, Math.max(0, callCount) / (Math.max(0, totalCallCount) + 1));
    const penalty = shimWeights * agingMultiplier * callRatio;
    return Math.round(penalty * SCORE_ROUNDING) / SCORE_ROUNDING;
}

/**
 * Compute Architecture Directness and Modern Purity Index.
 *
 * Mathematical formulation:
 * S_{\text{direct}} = \frac{N_{\text{directCalls}}}{N_{\text{directCalls}} + N_{\text{shimCalls}} + N_{\text{bridgeWrappers}}}
 *
 * @param directCallsCount - Calls directly invoking the modern canonical API / DTOs.
 * @param shimCallsCount - Calls routing through transitional compatibility bridges.
 * @param bridgeWrappersCount - Active wrapper functions maintaining backward compatibility.
 * @returns Directness purity index in [0, 1].
 */
export function calculateArchitectureDirectnessIndex(
    directCallsCount: number,
    shimCallsCount: number,
    bridgeWrappersCount: number = 0,
): number {
    const direct = Math.max(0, directCallsCount);
    const legacy = Math.max(0, shimCallsCount) + Math.max(0, bridgeWrappersCount);
    const total = direct + legacy;
    if (total <= 0) {
        return 1.0;
    }
    const index = direct / total;
    return Math.round(index * PERCENT_SCALE) / PERCENT_SCALE;
}

/**
 * Compute Deprecation Convergence Health.
 *
 * Mathematical formulation:
 * H_{\text{dep}} = \left(1 - \frac{N_{\text{unannotatedDeprecations}}}{N_{\text{deprecatedSymbols}} + 1}\right) \cdot \left(1 - \frac{N_{\text{inwardContaminations}}}{N_{\text{totalCalls}} + 1}\right)
 *
 * @param deprecatedSymbolsCount - Total deprecated symbols in codebase.
 * @param unannotatedDeprecationsCount - Deprecated symbols missing formal metadata (e.g. version/sunset).
 * @param inwardContaminationsCount - New architecture code calling deprecated legacy APIs.
 * @param totalCallsCount - Total calls evaluated across boundaries.
 * @returns Deprecation health index in [0, 1].
 */
export function calculateDeprecationConvergenceHealth(
    deprecatedSymbolsCount: number,
    unannotatedDeprecationsCount: number,
    inwardContaminationsCount: number,
    totalCallsCount: number,
): number {
    const annotationHealth = Math.max(
        0,
        1.0 -
            Math.min(
                1.0,
                Math.max(0, unannotatedDeprecationsCount) /
                    (Math.max(0, deprecatedSymbolsCount) + 1),
            ),
    );
    const isolationHealth = Math.max(
        0,
        1.0 -
            Math.min(
                1.0,
                Math.max(0, inwardContaminationsCount) / (Math.max(0, totalCallsCount) + 1),
            ),
    );
    const health = annotationHealth * isolationHealth;
    return Math.round(health * PERCENT_SCALE) / PERCENT_SCALE;
}

/**
 * Compute Pareto Zero-Cost Modern Architecture Utility.
 *
 * Mathematical formulation:
 * E_{\text{zero}} = \frac{\text{ThroughputRatio}}{1.0 + \lambda \cdot \text{IndirectionDepth}} \cdot (1 - \text{TransientAllocRatio}) \cdot \text{StrictTypedRatio}
 *
 * @param throughputRatio - Ratio of modern execution throughput relative to baseline.
 * @param indirectionDepth - Number of abstraction layer indirections.
 * @param transientAllocRatio - Fraction of operations triggering heap allocation.
 * @param strictTypedRatio - Proportion of API strictly typed with zero `any` or loose dictionaries.
 * @param lambda - Indirection penalty coefficient (default 0.2).
 * @returns Zero-cost utility score in [0, 100].
 */
export function calculateZeroCostModernUtility(
    throughputRatio: number,
    indirectionDepth: number,
    transientAllocRatio: number = 0,
    strictTypedRatio: number = 1.0,
    lambda: number = 0.2,
): number {
    const safeThroughput = Math.max(0.1, throughputRatio);
    const denominator = 1.0 + lambda * Math.max(0, indirectionDepth);
    const allocEfficiency = Math.max(0, 1.0 - Math.min(1.0, Math.max(0, transientAllocRatio)));
    const typeDiscipline = Math.max(0, Math.min(1.0, strictTypedRatio));
    const utility = (safeThroughput / denominator) * allocEfficiency * typeDiscipline * 100;
    return Math.round(Math.min(100, utility) * SCORE_ROUNDING) / SCORE_ROUNDING;
}

/**
 * Compute Modern Construct Adoption Rate.
 *
 * Mathematical formulation:
 * M_{\text{construct}} = \frac{N_{\text{modern}}}{N_{\text{modern}} + N_{\text{legacy}}}
 *
 * @param modernConstructsCount - Count of modern language constructs.
 * @param legacyConstructsCount - Count of legacy constructs.
 * @returns Adoption rate in [0, 1].
 */
export function calculateModernConstructAdoptionRate(
    modernConstructsCount: number,
    legacyConstructsCount: number,
): number {
    const total = Math.max(0, modernConstructsCount) + Math.max(0, legacyConstructsCount);
    if (total <= 0) {
        return 1.0;
    }
    const rate = Math.max(0, modernConstructsCount) / total;
    return Math.round(rate * PERCENT_SCALE) / PERCENT_SCALE;
}

/**
 * Compute Interactive Debounce & Anti-Spam Protection Index.
 *
 * Mathematical formulation:
 * D_{\text{debounce}} = 100 \times \left(\frac{N_{\text{debounced}} + \omega \cdot N_{\text{loadingFenced}}}{N_{\text{critical}} + \epsilon}\right)^{\mu}
 *
 * @param debouncedActions - Actions protected by >= 0.3s debounce or throttle.
 * @param loadingFencedActions - Actions protected by loading/disabled state locks.
 * @param criticalActions - Total critical/asynchronous user actions.
 * @param omega - Weight for loading fencing (default 0.5).
 * @param mu - Power decay scaling exponent (default 1.0).
 * @returns Debounce protection index in [0, 100].
 */
export function calculateDebounceProtectionIndex(
    debouncedActions: number,
    loadingFencedActions: number,
    criticalActions: number,
    omega: number = 0.5,
    mu: number = 1.0,
): number {
    if (criticalActions <= 0) {
        return 100.0;
    }
    const safeDebounced = Math.max(0, debouncedActions);
    const safeLoading = Math.max(0, loadingFencedActions);
    const rawProtected = (safeDebounced + omega * safeLoading) / Math.max(1, criticalActions);
    const normalized = Math.min(1.0, Math.max(0, rawProtected));
    const score = Math.pow(normalized, Math.max(0.1, mu)) * 100;
    return Math.round(score * SCORE_ROUNDING) / SCORE_ROUNDING;
}

/**
 * Compute Finite State Machine Structural Determinism Score.
 *
 * Mathematical formulation:
 * F_{\text{fsm}} = 100 \times \left(1 - \min\left(1.0, \frac{\sum W \cdot N_{\text{wild}}}{N_{\text{trans}} + 1}\right)\right) \cdot \left(\frac{N_{\text{guarded}}}{N_{\text{states}}}\right)
 *
 * @param wildMutations - Direct state variable mutations bypassing transition guards.
 * @param guardedTransitions - Total formal transitions routed through state machine guards.
 * @param guardedStates - States declaring complete entry/exit invariants.
 * @param totalStates - Total states in enum/catalog.
 * @param severityWeight - Penalty multiplier for wild mutations (default 1.0).
 * @returns FSM determinism score in [0, 100].
 */
export function calculateFsmDeterminismScore(
    wildMutations: number,
    guardedTransitions: number,
    guardedStates: number,
    totalStates: number,
    severityWeight: number = 1.0,
): number {
    if (totalStates <= 0) {
        return 100.0;
    }
    const mutationPenalty = Math.min(
        1.0,
        (Math.max(0, wildMutations) * Math.max(0.1, severityWeight)) /
            (Math.max(0, guardedTransitions) + 1),
    );
    const guardRatio = Math.min(1.0, Math.max(0, guardedStates) / Math.max(1, totalStates));
    const score = (1.0 - mutationPenalty) * guardRatio * 100;
    return Math.round(Math.max(0, Math.min(100, score)) * SCORE_ROUNDING) / SCORE_ROUNDING;
}

/**
 * Compute UI Layout Hierarchy Nesting Density Index.
 *
 * Mathematical formulation:
 * L_{\text{nest}} = 100 \times \exp\left(-\frac{\sum \max(0, \text{depth} - \theta)^2}{N_{\text{views}} \cdot \kappa}\right)
 *
 * @param depths - Array of nesting depths for UI container elements.
 * @param baseThreshold - Non-penalized layout container depth threshold (default 4).
 * @param kappa - Layout elasticity coefficient (default 10.0).
 * @param totalViews - Total views or screen files analyzed (default 1).
 * @returns Nesting density index in [0, 100].
 */
export function calculateLayoutNestingDensityIndex(
    depths: number[],
    baseThreshold: number = 4,
    kappa: number = 10.0,
    totalViews: number = 1,
): number {
    if (!depths || depths.length === 0) {
        return 100.0;
    }
    let excessSumSquared = 0;
    for (const d of depths) {
        const excess = Math.max(0, d - baseThreshold);
        excessSumSquared += excess * excess;
    }
    const normalizer = Math.max(1, totalViews) * Math.max(1.0, kappa);
    const score = 100.0 * Math.exp(-excessSumSquared / normalizer);
    return Math.round(Math.max(0, Math.min(100, score)) * SCORE_ROUNDING) / SCORE_ROUNDING;
}

/**
 * Compute Observer WeakRef Reference Hygiene Index.
 *
 * Mathematical formulation:
 * W_{\text{weak}} = 100 \times \left(\frac{N_{\text{weak}}}{N_{\text{total}} + 1}\right) \times \left(1 - \frac{N_{\text{uncleaned}}}{N_{\text{strong}} + 1}\right)
 *
 * @param weakrefBindings - Observers registered with weakref() wrappers.
 * @param totalDynamicBindings - Total dynamic UI event subscriptions.
 * @param uncleanedStrongRefs - Strong references not disposed on unmount.
 * @param totalStrongRefs - Total strong references recorded in registries.
 * @returns WeakRef hygiene index in [0, 100].
 */
export function calculateObserverWeakRefHygiene(
    weakrefBindings: number,
    totalDynamicBindings: number,
    uncleanedStrongRefs: number = 0,
    totalStrongRefs: number = 0,
): number {
    if (totalDynamicBindings <= 0 && totalStrongRefs <= 0) {
        return 100.0;
    }
    const coverageRatio = Math.min(
        1.0,
        Math.max(0, weakrefBindings) / (Math.max(0, totalDynamicBindings) + 1),
    );
    const leakPenalty = Math.min(
        1.0,
        Math.max(0, uncleanedStrongRefs) / (Math.max(0, totalStrongRefs) + 1),
    );
    const score = coverageRatio * (1.0 - leakPenalty) * 100;
    return Math.round(Math.max(0, Math.min(100, score)) * SCORE_ROUNDING) / SCORE_ROUNDING;
}

/**
 * Compute Viewport & Responsive Scalability Index.
 *
 * Mathematical formulation:
 * A_{\text{responsive}} = 100 \times \left(1 - \frac{N_{\text{hardcoded}}}{N_{\text{elements}} + 1}\right) \cdot (0.6 R_{\text{anchor}} + 0.4 R_{\text{font}})
 *
 * @param hardcodedPixelBounds - Hardcoded fixed pixel dimension assignments.
 * @param layoutElements - Total visual layout components.
 * @param anchorDrivenRatio - Fraction of elements using anchors preset / containers.
 * @param fontScalableRatio - Fraction of text elements with adaptive font scales.
 * @returns Responsive scalability index in [0, 100].
 */
export function calculateResponsiveScalabilityIndex(
    hardcodedPixelBounds: number,
    layoutElements: number,
    anchorDrivenRatio: number = 1.0,
    fontScalableRatio: number = 1.0,
): number {
    if (layoutElements <= 0) {
        return 100.0;
    }
    const hardcodedPenalty = Math.min(
        1.0,
        Math.max(0, hardcodedPixelBounds) / (Math.max(0, layoutElements) + 1),
    );
    const adaptiveFactor =
        0.6 * Math.min(1.0, Math.max(0, anchorDrivenRatio)) +
        0.4 * Math.min(1.0, Math.max(0, fontScalableRatio));
    const score = (1.0 - hardcodedPenalty) * adaptiveFactor * 100;
    return Math.round(Math.max(0, Math.min(100, score)) * SCORE_ROUNDING) / SCORE_ROUNDING;
}

/**
 * Compute Unidirectional Data Flow Integrity & CQRS Mutation Purity.
 *
 * Mathematical formulation:
 * V_{\text{uni}} = 100 \times \exp\left(-\frac{\lambda \cdot N_{\text{dtoMut}} + \nu \cdot N_{\text{domainMut}}}{\max(1, K_{\text{loc}} / 1000)}\right)
 *
 * @param dtoMutations - Direct mutations to immutable Snapshot DTOs inside views.
 * @param directDomainMutations - Direct invocations of domain entity write methods from views.
 * @param viewLoc - Total physical lines of presentation code.
 * @param lambda - DTO in-place mutation penalty weight (default 1.2).
 * @param nu - Direct domain mutation penalty weight (default 2.0).
 * @returns Unidirectional data flow integrity in [0, 100].
 */
export function calculateUnidirectionalFlowIntegrity(
    dtoMutations: number,
    directDomainMutations: number,
    viewLoc: number = 1000,
    lambda: number = 1.2,
    nu: number = 2.0,
): number {
    const totalPenalty =
        Math.max(0, dtoMutations) * lambda + Math.max(0, directDomainMutations) * nu;
    const locScale = Math.max(1.0, viewLoc / 1000.0);
    const score = 100.0 * Math.exp(-totalPenalty / locScale);
    return Math.round(Math.max(0, Math.min(100, score)) * SCORE_ROUNDING) / SCORE_ROUNDING;
}

/** Compute Component Adoption Index (CAI) measuring standardized UI component adoption. */
export function calculateComponentAdoptionIndex(
    kComponentUsages: number,
    totalComponentUsages: number,
    legacyElements: number = 0,
): number {
    const kComp = Math.max(0, kComponentUsages);
    const total = Math.max(0, totalComponentUsages);
    const legacy = Math.max(0, legacyElements);
    if (kComp === 0 && total === 0 && legacy === 0) return 100.0;
    const denom = kComp + legacy;
    if (denom <= 0) return 100.0;
    const ratio = kComp / denom;
    const coverage = Math.min(1.0, kComp / Math.max(1, total));
    const score = ratio * coverage * 100.0;
    return Math.round(Math.max(0, Math.min(100, score)) * SCORE_ROUNDING) / SCORE_ROUNDING;
}

/** Compute Design Token Compliance (DTC) measuring design system adherence. */
export function calculateDesignTokenComplianceIndex(
    tokenUsages: number,
    hardcodedColorLiterals: number,
    hardcodedPixelSizes: number = 0,
): number {
    const token = Math.max(0, tokenUsages);
    const color = Math.max(0, hardcodedColorLiterals);
    const pixel = Math.max(0, hardcodedPixelSizes);
    if (token === 0 && color === 0 && pixel === 0) return 100.0;
    const denom = token + 2.0 * color + 1.5 * pixel;
    if (denom <= 0) return 100.0;
    const score = (token / denom) * 100.0;
    return Math.round(Math.max(0, Math.min(100, score)) * SCORE_ROUNDING) / SCORE_ROUNDING;
}

/** Compute i18n Symmetry Index (ISI) measuring text localization purity. */
export function calculateI18nSymmetryIndex(
    trCallCount: number,
    rawUiStringLiterals: number,
    dynamicInterpolations: number = 0,
): number {
    const trCount = Math.max(0, trCallCount);
    const rawUi = Math.max(0, rawUiStringLiterals);
    const dyn = Math.max(0, dynamicInterpolations);
    if (trCount === 0 && rawUi === 0 && dyn === 0) return 100.0;
    const denom = trCount + 2.5 * rawUi + 0.5 * dyn;
    if (denom <= 0) return 100.0;
    const score = (trCount / denom) * 100.0;
    return Math.round(Math.max(0, Math.min(100, score)) * SCORE_ROUNDING) / SCORE_ROUNDING;
}

/** Compute Presentation Decoupling Index (PDI) measuring presentation-domain boundary isolation. */
export function calculatePresentationDecouplingIndex(
    backendDirectRefs: number,
    eventBusDirectSubs: number,
    viewCount: number = 1,
): number {
    const backend = Math.max(0, backendDirectRefs);
    const eventBus = Math.max(0, eventBusDirectSubs);
    const views = Math.max(1, viewCount);
    const score = 100.0 * Math.exp(-(2.5 * backend + 1.8 * eventBus) / views);
    return Math.round(Math.max(0, Math.min(100, score)) * SCORE_ROUNDING) / SCORE_ROUNDING;
}

/** Compute Boundary Interoperability Factor (BIF) across frontend-backend domain surfaces. */
export function calculateBoundaryInteroperabilityFactor(
    crossBoundaryViolations: number,
    totalInteractions: number = 10,
): number {
    const leaks = Math.max(0, crossBoundaryViolations);
    const total = Math.max(1, totalInteractions);
    const factor = Math.exp(-0.8 * (leaks / total));
    return Math.round(Math.max(0, Math.min(1.0, factor)) * PERCENT_SCALE) / PERCENT_SCALE;
}

/** Compute Composite Profile Quality Score combining frontend and backend assessments. */
export function calculateProfileCompositeScore(
    frontendScore: number,
    backendScore: number,
    feWeight: number = 1.0,
    beWeight: number = 1.0,
    boundaryFactor: number = 1.0,
): number {
    const fe = Math.max(15, Math.min(100, frontendScore));
    const be = Math.max(15, Math.min(100, backendScore));
    const wFe = Math.max(0.01, feWeight);
    const wBe = Math.max(0.01, beWeight);
    const geomMean = Math.exp((wFe * Math.log(fe) + wBe * Math.log(be)) / (wFe + wBe));
    const rawComposite = geomMean * Math.max(0.1, Math.min(1.0, boundaryFactor));
    return Math.round(Math.max(0, Math.min(100, rawComposite)) * SCORE_ROUNDING) / SCORE_ROUNDING;
}

/** Compute Shannon Information Entropy of identifier tokens for anti-gaming defense. */
export function calculateShannonEntropy(text: string): number {
    if (!text || text.length === 0) return 0.0;
    const freqMap = new Map<string, number>();
    for (let i = 0; i < text.length; i += 1) {
        const ch = text[i];
        freqMap.set(ch, (freqMap.get(ch) ?? 0) + 1);
    }
    const len = text.length;
    let entropy = 0.0;
    for (const count of freqMap.values()) {
        const p = count / len;
        entropy -= p * Math.log2(p);
    }
    return Math.round(entropy * SCORE_ROUNDING) / SCORE_ROUNDING;
}

/** Compute AST Node to Non-Blank LOC Density Index. */
export function calculateAstLocDensityIndex(astNodeCount: number, nonBlankLines: number): number {
    const nodes = Math.max(0, astNodeCount);
    const lines = Math.max(1, nonBlankLines);
    return Math.round((nodes / lines) * SCORE_ROUNDING) / SCORE_ROUNDING;
}
