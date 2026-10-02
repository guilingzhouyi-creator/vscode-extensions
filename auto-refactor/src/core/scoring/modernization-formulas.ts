/**
 * Module: Core Engine — Modernization, Trajectory Velocity & Compatibility Formulas
 * File Path: src/core/scoring/modernization-formulas.ts
 * Architecture Role: Pure mathematical transformations and metrics evaluating architecture
 *   modernization, compatibility layer technical debt, trajectory velocity,
 *   and zero-cost utilities.
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
 * G(R) = \left(\frac{\text{support}}{\text{trials}}\right) \cdot (1 - \text{normalizedEntropy})
 *   \cdot \max(0, \overline{\Delta S})
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
 * R_{\text{hook}} =
 *   \frac{N_{\text{hookedOps}}}{N_{\text{hardcodedBranches}} + N_{\text{hookedOps}}}
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
 * H_{\text{purity}} = 1.0 -
 *   \min\left(1.0,
 *     \frac{N_{\text{mut}} + 2 \cdot N_{\text{esc}}}{N_{\text{totalOps}} + 1}\right)
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

/**
 * Compatibility alias for data flow purity.
 *
 * @param mutationsCount - Count of mutations.
 * @param totalOpsCount - Total operation count.
 * @returns Purity score.
 */
export function calculateDataFlowPurity(mutationsCount: number, totalOpsCount: number): number {
    return calculateDataFlowPurityScore(mutationsCount, 0, totalOpsCount);
}

/**
 * Evaluate Object Pool Conservation and Reset State Completeness Law.
 *
 * Mathematical formulation:
 * \Phi_{\text{pool}} =
 *   \min\left(1.0, \frac{N_{\text{poolAcquires}}}{N_{\text{poolReleases}} + 1}\right)
 *   \cdot \mathbb{I}(\text{hasResetState})
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

/**
 * Compatibility alias for object pool conservation.
 *
 * @param poolCapacity - Pool capacity.
 * @param leakCount - Count of resource leaks.
 * @param hasResetState - Whether state is resettable.
 * @returns Conservation index.
 */
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
 * S_{\text{cas}} = \frac{N_{\text{guardedTransitions}}}{N_{\text{totalTransitions}} + 1}
 *   \cdot \left(1.0 - \text{reentrancyExposureRatio}\right)
 *
 * @param guardedTransitions - Transitions protected by boolean CAS flags or state guards.
 * @param totalTransitions - Total state transitions in lifecycle engine.
 * @param reentrancyExposureRatio - Fraction of transitions unguarded
 *   against re-entrant calls [0, 1].
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

/**
 * Compatibility alias for reentrancy safety index.
 *
 * @param guardedTransitions - Guarded transitions count.
 * @param totalTransitions - Total transitions count.
 * @param reentrancyExposureRatio - Reentrancy exposure ratio.
 * @returns Safety index value.
 */
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

/**
 * Compatibility alias for indirection cohesion utility.
 *
 * @param cohesionScore - Cohesion score.
 * @param wrapperDepth - Wrapper depth.
 * @param bridgeCount - Bridge count.
 * @param alpha - Cohesion exponent.
 * @param beta - Depth penalty exponent.
 * @returns Utility index value.
 */
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
 * C_{\text{cache}} = \frac{N_{\text{invalidatedOnReload}}}{N_{\text{cachedTables}} + 1}
 *   \cdot \left(1 - \text{staleWindowRatio}\right)
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

/**
 * Compatibility alias for cache freshness safety.
 *
 * @param invalidatedTablesCount - Invalidated tables count.
 * @param totalCachedTablesCount - Total cached tables count.
 * @param staleWindowRatio - Stale window ratio.
 * @returns Freshness index value.
 */
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
 * B_{\text{compat}} =
 *   (N_{\text{legacyBridges}} + N_{\text{typedDTO}}) /
 *   (N_{\text{directLegacyCalls}} + N_{\text{legacyBridges}} + N_{\text{typedDTO}} + 1)
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

/**
 * Compatibility alias for DTO compatibility index.
 *
 * @param bridgedCallCount - Bridged call count.
 * @param totalCallCount - Total call count.
 * @returns Compatibility index value.
 */
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
 * P_{\text{shim}} = \sum_{s \in \text{Shims}} W(s)
 *   \cdot \left(1 + \mu \cdot \text{AgeDays}(s)\right)
 *   \cdot \frac{N_{\text{calls}}(s)}{N_{\text{totalCalls}} + 1}
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
 * S_{\text{direct}} =
 *   N_{\text{directCalls}} /
 *   (N_{\text{directCalls}} + N_{\text{shimCalls}} + N_{\text{bridgeWrappers}})
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
 * H_{\text{dep}} =
 *   \left(1 - \frac{N_{\text{unannotatedDeprecations}}}{N_{\text{deprecatedSymbols}} + 1}\right)
 *   \cdot \left(1 - \frac{N_{\text{inwardContaminations}}}{N_{\text{totalCalls}} + 1}\right)
 *
 * @param deprecatedSymbolsCount - Total deprecated symbols in codebase.
 * @param unannotatedDeprecationsCount - Deprecated symbols missing
 *   formal metadata (e.g. version/sunset).
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

export {
    calculateZeroCostModernUtility,
    calculateModernConstructAdoptionRate,
    calculateDebounceProtectionIndex,
    calculateFsmDeterminismScore,
    calculateLayoutNestingDensityIndex,
    calculateObserverWeakRefHygiene,
    calculateResponsiveScalabilityIndex,
    calculateUnidirectionalFlowIntegrity,
    calculateComponentAdoptionIndex,
    calculateDesignTokenComplianceIndex,
    calculateI18nSymmetryIndex,
    calculatePresentationDecouplingIndex,
    calculateBoundaryInteroperabilityFactor,
    calculateProfileCompositeScore,
    calculateShannonEntropy,
    calculateAstLocDensityIndex,
} from './modernization-metrics';
