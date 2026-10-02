/**
 * Module: Core Engine — Modernization & Structural Metric Formulas
 * File Path: src/core/scoring/modernization-metrics.ts
 * Architecture Role: Mathematical formulas evaluating frontend and structural quality,
 *   including zero-cost modern utilities, FSM determinism, layout nesting, and Shannon entropy.
 * Dependencies & Triggers: Consumes scorer-formulas and scoringTypes; consumed by
 *   modernization-formulas.
 * Responsibilities: Compute structural, frontend, entropy, and AST density quality indices.
 * Exit Semantics & Design Rationale: Pure deterministic math helpers; strictly zero I/O.
 */

import { SCORE_ROUNDING, PERCENT_SCALE } from './scorer-formulas';

/**
 * Compute Pareto Zero-Cost Modern Utility Score.
 *
 * Mathematical formulation:
 * E_{\text{zero}} = \frac{\text{ThroughputRatio}}{1.0 + \lambda \cdot \text{IndirectionDepth}}
 *   \cdot (1 - \text{TransientAllocRatio}) \cdot \text{StrictTypedRatio}
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
 * D_{\text{debounce}} =
 *   100 \times
 *   ((N_{\text{deb}} + \omega \cdot N_{\text{fen}}) / (N_{\text{crit}} + \epsilon))^{\mu}
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
 * F_{\text{fsm}} =
 *   100 \times
 *   \left(1 - \min(1.0, (\sum W \cdot N_{\text{wild}}) / (N_{\text{trans}} + 1))\right)
 *   \cdot \left(\frac{N_{\text{guarded}}}{N_{\text{states}}}\right)
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
 * L_{\text{nest}} =
 *   100 \times
 *   \exp\left(-\frac{\sum \max(0, \text{depth} - \theta)^2}{N_{\text{views}} \cdot \kappa}\right)
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
 * W_{\text{weak}} = 100 \times \left(\frac{N_{\text{weak}}}{N_{\text{total}} + 1}\right)
 *   \times \left(1 - \frac{N_{\text{uncleaned}}}{N_{\text{strong}} + 1}\right)
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
 * A_{\text{responsive}} =
 *   100 \times \left(1 - \frac{N_{\text{hardcoded}}}{N_{\text{elements}} + 1}\right)
 *   \cdot (0.6 R_{\text{anchor}} + 0.4 R_{\text{font}})
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
 * V_{\text{uni}} =
 *   100 \times
 *   \exp(-(\lambda N_{\text{dto}} + \nu N_{\text{dom}}) / \max(1, K_{\text{loc}} / 1000))
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

/**
 * Compute Component Adoption Index (CAI) measuring standardized UI component adoption.
 *
 * @param kComponentUsages - Count of KComponent usages.
 * @param totalComponentUsages - Total component usages count.
 * @param legacyElements - Legacy elements count.
 * @returns Adoption index value.
 */
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

/**
 * Compute Design Token Compliance (DTC) measuring design system adherence.
 *
 * @param tokenUsages - Count of design token usages.
 * @param hardcodedColorLiterals - Count of hardcoded color literals.
 * @param hardcodedPixelSizes - Count of hardcoded pixel sizes.
 * @returns Design token compliance score.
 */
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

/**
 * Compute i18n Symmetry Index (ISI) measuring text localization purity.
 *
 * @param trCallCount - Count of tr() call usages.
 * @param rawUiStringLiterals - Count of raw UI string literals.
 * @param dynamicInterpolations - Count of dynamic interpolations.
 * @returns i18n symmetry index value.
 */
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

/**
 * Compute Presentation Decoupling Index (PDI) measuring presentation-domain boundary isolation.
 *
 * @param backendDirectRefs - Backend direct references count.
 * @param eventBusDirectSubs - Event bus direct subscriptions count.
 * @param viewCount - View component count.
 * @returns Decoupling index value.
 */
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

/**
 * Compute Boundary Interoperability Factor (BIF) across frontend-backend domain surfaces.
 *
 * @param crossBoundaryViolations - Count of cross-boundary violations.
 * @param totalInteractions - Total interaction count.
 * @returns Interoperability factor value.
 */
export function calculateBoundaryInteroperabilityFactor(
    crossBoundaryViolations: number,
    totalInteractions: number = 10,
): number {
    const leaks = Math.max(0, crossBoundaryViolations);
    const total = Math.max(1, totalInteractions);
    const factor = Math.exp(-0.8 * (leaks / total));
    return Math.round(Math.max(0, Math.min(1.0, factor)) * PERCENT_SCALE) / PERCENT_SCALE;
}

/**
 * Compute Composite Profile Quality Score combining frontend and backend assessments.
 *
 * @param frontendScore - Frontend domain quality score.
 * @param backendScore - Backend domain quality score.
 * @param feWeight - Frontend weighting factor.
 * @param beWeight - Backend weighting factor.
 * @param boundaryFactor - Boundary interoperability factor.
 * @returns Composite profile quality score.
 */
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

/**
 * Compute Shannon Information Entropy of identifier tokens for anti-gaming defense.
 *
 * @param text - Source text or identifier sequence.
 * @returns Shannon entropy in bits.
 */
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

/**
 * Compute AST Node to Non-Blank LOC Density Index.
 *
 * @param astNodeCount - Total AST node count.
 * @param nonBlankLines - Non blank code line count.
 * @returns AST to LOC density index.
 */
export function calculateAstLocDensityIndex(astNodeCount: number, nonBlankLines: number): number {
    const nodes = Math.max(0, astNodeCount);
    const lines = Math.max(1, nonBlankLines);
    return Math.round((nodes / lines) * SCORE_ROUNDING) / SCORE_ROUNDING;
}
