/**
 * Module: Core Engine — Modernization & Structural Metric Formulas
 * File Path: src/core/scoring/modernization-metrics.ts
 * Architecture Role: Mathematical formulas evaluating frontend and structural quality,
 *   including zero-cost modern utilities, FSM determinism, layout nesting, Shannon entropy,
 *   and polyglot multi-language generalization.
 * Dependencies & Triggers: Consumes scorer-formulas and scoringTypes; consumed by
 *   modernization-formulas.
 * Responsibilities: Compute structural, frontend, entropy, AST density, and polyglot
 *   generalization modernization equilibrium indices.
 * Exit Semantics & Design Rationale: Pure deterministic math helpers; strictly zero I/O.
 */

import { SCORE_ROUNDING, PERCENT_SCALE } from './scorer-formulas';

const SCORE_MAX = 100;
const SCORE_PERFECT_FLOAT = 100.0;
const DEFAULT_LAYOUT_BASE_DEPTH = 4;
const DEFAULT_LAYOUT_ELASTICITY = 10.0;
const DEFAULT_VIEW_LOC_BASE = 1000;
const VIEW_LOC_SCALE_FACTOR = 1000.0;
const DEFAULT_INTERACTIONS_COUNT = 10;
const MIN_PROFILE_SCORE_FLOOR = 15;

/**
 * Options for evaluating Pareto Zero-Cost Modern Utility score.
 */
export interface ZeroCostUtilityOptions {
    readonly throughputRatio: number;
    readonly indirectionDepth: number;
    readonly transientAllocRatio?: number;
    readonly strictTypedRatio?: number;
    readonly lambda?: number;
}

function resolveZeroCostUtilityParams(
    optionsOrThroughput: ZeroCostUtilityOptions | number,
    restArgs: readonly number[],
): {
    throughput: number;
    depth: number;
    allocRatio: number;
    typedRatio: number;
    lambdaPenalty: number;
} {
    if (typeof optionsOrThroughput === 'object' && optionsOrThroughput !== null) {
        return {
            throughput: optionsOrThroughput.throughputRatio,
            depth: optionsOrThroughput.indirectionDepth,
            allocRatio: optionsOrThroughput.transientAllocRatio ?? 0,
            typedRatio: optionsOrThroughput.strictTypedRatio ?? 1.0,
            lambdaPenalty: optionsOrThroughput.lambda ?? 0.2,
        };
    }
    return {
        throughput: optionsOrThroughput,
        depth: restArgs[0] ?? 0,
        allocRatio: restArgs[1] ?? 0,
        typedRatio: restArgs[2] ?? 1.0,
        lambdaPenalty: restArgs[3] ?? 0.2,
    };
}

/**
 * Compute Pareto Zero-Cost Modern Utility Score.
 *
 * Mathematical formulation:
 * E_{\text{zero}} = \frac{\text{ThroughputRatio}}{1.0 + \lambda \cdot \text{IndirectionDepth}}
 *   \cdot (1 - \text{TransientAllocRatio}) \cdot \text{StrictTypedRatio}
 *
 * @param options - Structured utility options or raw throughput ratio.
 * @param restArgs - Legacy positional arguments for backward compatibility.
 * @returns Zero-cost utility score in [0, 100].
 */
export function computeZeroCostModernUtility(
    options: ZeroCostUtilityOptions | number,
    ...restArgs: number[]
): number {
    const params = resolveZeroCostUtilityParams(options, restArgs);
    const safeThroughput = Math.max(0.1, params.throughput);
    const denominator = 1.0 + params.lambdaPenalty * Math.max(0, params.depth);
    const allocEfficiency = Math.max(0, 1.0 - Math.min(1.0, Math.max(0, params.allocRatio)));
    const typeDiscipline = Math.max(0, Math.min(1.0, params.typedRatio));
    const utility = (safeThroughput / denominator) * allocEfficiency * typeDiscipline * SCORE_MAX;
    return Math.round(Math.min(SCORE_MAX, utility) * SCORE_ROUNDING) / SCORE_ROUNDING;
}
export { computeZeroCostModernUtility as calculateZeroCostModernUtility };

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
export function computeModernAdoptionRate(
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
export { computeModernAdoptionRate as calculateModernConstructAdoptionRate };

/**
 * Options for evaluating interactive debounce and anti-spam protection index.
 */
export interface DebounceProtectionOptions {
    readonly debouncedActions: number;
    readonly loadingFencedActions: number;
    readonly criticalActions: number;
    readonly omega?: number;
    readonly powerExponent?: number;
}

function resolveDebounceParams(
    optionsOrActions: DebounceProtectionOptions | number,
    restArgs: readonly number[],
): {
    debounced: number;
    loading: number;
    critical: number;
    omegaWeight: number;
    exponent: number;
} {
    if (typeof optionsOrActions === 'object' && optionsOrActions !== null) {
        return {
            debounced: optionsOrActions.debouncedActions,
            loading: optionsOrActions.loadingFencedActions,
            critical: optionsOrActions.criticalActions,
            omegaWeight: optionsOrActions.omega ?? 0.5,
            exponent: optionsOrActions.powerExponent ?? 1.0,
        };
    }
    return {
        debounced: optionsOrActions,
        loading: restArgs[0] ?? 0,
        critical: restArgs[1] ?? 0,
        omegaWeight: restArgs[2] ?? 0.5,
        exponent: restArgs[3] ?? 1.0,
    };
}

/**
 * Compute Interactive Debounce & Anti-Spam Protection Index.
 *
 * Mathematical formulation:
 * D_{\text{debounce}} =
 *   100 \times
 *   ((N_{\text{deb}} + \omega \cdot N_{\text{fen}}) / (N_{\text{crit}} + \epsilon))^{\mu}
 *
 * @param options - Structured debounce options or debounced action count.
 * @param restArgs - Legacy positional arguments for backward compatibility.
 * @returns Debounce protection index in [0, 100].
 */
export function computeDebounceIndex(
    options: DebounceProtectionOptions | number,
    ...restArgs: number[]
): number {
    const params = resolveDebounceParams(options, restArgs);
    if (params.critical <= 0) {
        return SCORE_PERFECT_FLOAT;
    }
    const safeDebounced = Math.max(0, params.debounced);
    const safeLoading = Math.max(0, params.loading);
    const rawProtected = (safeDebounced + params.omegaWeight * safeLoading) / Math.max(1, params.critical);
    const normalized = Math.min(1.0, Math.max(0, rawProtected));
    const score = Math.pow(normalized, Math.max(0.1, params.exponent)) * SCORE_MAX;
    return Math.round(score * SCORE_ROUNDING) / SCORE_ROUNDING;
}
export { computeDebounceIndex as calculateDebounceProtectionIndex };

/**
 * Options for evaluating Finite State Machine structural determinism score.
 */
export interface FsmDeterminismOptions {
    readonly wildMutations: number;
    readonly guardedTransitions: number;
    readonly guardedStates: number;
    readonly totalStates: number;
    readonly severityWeight?: number;
}

function resolveFsmParams(
    optionsOrMutations: FsmDeterminismOptions | number,
    restArgs: readonly number[],
): {
    wild: number;
    transitions: number;
    states: number;
    total: number;
    weight: number;
} {
    if (typeof optionsOrMutations === 'object' && optionsOrMutations !== null) {
        return {
            wild: optionsOrMutations.wildMutations,
            transitions: optionsOrMutations.guardedTransitions,
            states: optionsOrMutations.guardedStates,
            total: optionsOrMutations.totalStates,
            weight: optionsOrMutations.severityWeight ?? 1.0,
        };
    }
    return {
        wild: optionsOrMutations,
        transitions: restArgs[0] ?? 0,
        states: restArgs[1] ?? 0,
        total: restArgs[2] ?? 0,
        weight: restArgs[3] ?? 1.0,
    };
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
 * @param options - Structured FSM determinism options or wild mutations count.
 * @param restArgs - Legacy positional arguments for backward compatibility.
 * @returns FSM determinism score in [0, 100].
 */
export function computeFsmDeterminism(
    options: FsmDeterminismOptions | number,
    ...restArgs: number[]
): number {
    const params = resolveFsmParams(options, restArgs);
    if (params.total <= 0) {
        return SCORE_PERFECT_FLOAT;
    }
    const mutationPenalty = Math.min(
        1.0,
        (Math.max(0, params.wild) * Math.max(0.1, params.weight)) /
            (Math.max(0, params.transitions) + 1),
    );
    const guardRatio = Math.min(1.0, Math.max(0, params.states) / Math.max(1, params.total));
    const score = (1.0 - mutationPenalty) * guardRatio * SCORE_MAX;
    return Math.round(Math.max(0, Math.min(SCORE_MAX, score)) * SCORE_ROUNDING) / SCORE_ROUNDING;
}
export { computeFsmDeterminism as calculateFsmDeterminismScore };

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
export function computeLayoutNestingDensity(
    depths: number[],
    baseThreshold: number = DEFAULT_LAYOUT_BASE_DEPTH,
    kappa: number = DEFAULT_LAYOUT_ELASTICITY,
    totalViews: number = 1,
): number {
    if (!depths || depths.length === 0) {
        return SCORE_PERFECT_FLOAT;
    }
    let excessSumSquared = 0;
    for (const depth of depths) {
        const excess = Math.max(0, depth - baseThreshold);
        excessSumSquared += excess * excess;
    }
    const normalizer = Math.max(1, totalViews) * Math.max(1.0, kappa);
    const score = SCORE_PERFECT_FLOAT * Math.exp(-excessSumSquared / normalizer);
    return Math.round(Math.max(0, Math.min(SCORE_MAX, score)) * SCORE_ROUNDING) / SCORE_ROUNDING;
}
export { computeLayoutNestingDensity as calculateLayoutNestingDensityIndex };

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
        return SCORE_PERFECT_FLOAT;
    }
    const coverageRatio = Math.min(
        1.0,
        Math.max(0, weakrefBindings) / (Math.max(0, totalDynamicBindings) + 1),
    );
    const leakPenalty = Math.min(
        1.0,
        Math.max(0, uncleanedStrongRefs) / (Math.max(0, totalStrongRefs) + 1),
    );
    const score = coverageRatio * (1.0 - leakPenalty) * SCORE_MAX;
    return Math.round(Math.max(0, Math.min(SCORE_MAX, score)) * SCORE_ROUNDING) / SCORE_ROUNDING;
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
export function computeResponsiveIndex(
    hardcodedPixelBounds: number,
    layoutElements: number,
    anchorDrivenRatio: number = 1.0,
    fontScalableRatio: number = 1.0,
): number {
    if (layoutElements <= 0) {
        return SCORE_PERFECT_FLOAT;
    }
    const hardcodedPenalty = Math.min(
        1.0,
        Math.max(0, hardcodedPixelBounds) / (Math.max(0, layoutElements) + 1),
    );
    const adaptiveFactor =
        0.6 * Math.min(1.0, Math.max(0, anchorDrivenRatio)) +
        0.4 * Math.min(1.0, Math.max(0, fontScalableRatio));
    const score = (1.0 - hardcodedPenalty) * adaptiveFactor * SCORE_MAX;
    return Math.round(Math.max(0, Math.min(SCORE_MAX, score)) * SCORE_ROUNDING) / SCORE_ROUNDING;
}
export { computeResponsiveIndex as calculateResponsiveScalabilityIndex };

/**
 * Options for evaluating unidirectional data flow integrity and CQRS mutation purity.
 */
export interface UnidirectionalFlowOptions {
    readonly dtoMutations: number;
    readonly directDomainMutations: number;
    readonly viewLoc?: number;
    readonly lambda?: number;
    readonly domainMutationWeight?: number;
}

function resolveUnidirectionalParams(
    optionsOrDto: UnidirectionalFlowOptions | number,
    restArgs: readonly number[],
): {
    dtoCount: number;
    domainCount: number;
    locLines: number;
    dtoWeight: number;
    domainWeight: number;
} {
    if (typeof optionsOrDto === 'object' && optionsOrDto !== null) {
        return {
            dtoCount: optionsOrDto.dtoMutations,
            domainCount: optionsOrDto.directDomainMutations,
            locLines: optionsOrDto.viewLoc ?? DEFAULT_VIEW_LOC_BASE,
            dtoWeight: optionsOrDto.lambda ?? 1.2,
            domainWeight: optionsOrDto.domainMutationWeight ?? 2.0,
        };
    }
    return {
        dtoCount: optionsOrDto,
        domainCount: restArgs[0] ?? 0,
        locLines: restArgs[1] ?? DEFAULT_VIEW_LOC_BASE,
        dtoWeight: restArgs[2] ?? 1.2,
        domainWeight: restArgs[3] ?? 2.0,
    };
}

/**
 * Compute Unidirectional Data Flow Integrity & CQRS Mutation Purity.
 *
 * Mathematical formulation:
 * V_{\text{uni}} =
 *   100 \times
 *   \exp(-(\lambda N_{\text{dto}} + \nu N_{\text{dom}}) / \max(1, K_{\text{loc}} / 1000))
 *
 * @param options - Structured unidirectional flow options or DTO mutations count.
 * @param restArgs - Legacy positional arguments for backward compatibility.
 * @returns Unidirectional data flow integrity in [0, 100].
 */
export function computeUnidirectionalFlow(
    options: UnidirectionalFlowOptions | number,
    ...restArgs: number[]
): number {
    const params = resolveUnidirectionalParams(options, restArgs);
    const totalPenalty =
        Math.max(0, params.dtoCount) * params.dtoWeight +
        Math.max(0, params.domainCount) * params.domainWeight;
    const locScale = Math.max(1.0, params.locLines / VIEW_LOC_SCALE_FACTOR);
    const score = SCORE_PERFECT_FLOAT * Math.exp(-totalPenalty / locScale);
    return Math.round(Math.max(0, Math.min(SCORE_MAX, score)) * SCORE_ROUNDING) / SCORE_ROUNDING;
}
export { computeUnidirectionalFlow as calculateUnidirectionalFlowIntegrity };

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
    if (kComp === 0 && total === 0 && legacy === 0) return SCORE_PERFECT_FLOAT;
    const denom = kComp + legacy;
    if (denom <= 0) return SCORE_PERFECT_FLOAT;
    const ratio = kComp / denom;
    const coverage = Math.min(1.0, kComp / Math.max(1, total));
    const score = ratio * coverage * SCORE_PERFECT_FLOAT;
    return Math.round(Math.max(0, Math.min(SCORE_MAX, score)) * SCORE_ROUNDING) / SCORE_ROUNDING;
}

/**
 * Compute Design Token Compliance (DTC) measuring design system adherence.
 *
 * @param tokenUsages - Count of design token usages.
 * @param hardcodedColorLiterals - Count of hardcoded color literals.
 * @param hardcodedPixelSizes - Count of hardcoded pixel sizes.
 * @returns Design token compliance score.
 */
export function computeDesignTokenCompliance(
    tokenUsages: number,
    hardcodedColorLiterals: number,
    hardcodedPixelSizes: number = 0,
): number {
    const token = Math.max(0, tokenUsages);
    const color = Math.max(0, hardcodedColorLiterals);
    const pixel = Math.max(0, hardcodedPixelSizes);
    if (token === 0 && color === 0 && pixel === 0) return SCORE_PERFECT_FLOAT;
    const denom = token + 2.0 * color + 1.5 * pixel;
    if (denom <= 0) return SCORE_PERFECT_FLOAT;
    const score = (token / denom) * SCORE_PERFECT_FLOAT;
    return Math.round(Math.max(0, Math.min(SCORE_MAX, score)) * SCORE_ROUNDING) / SCORE_ROUNDING;
}
export { computeDesignTokenCompliance as calculateDesignTokenComplianceIndex };

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
    if (trCount === 0 && rawUi === 0 && dyn === 0) return SCORE_PERFECT_FLOAT;
    const denom = trCount + 2.5 * rawUi + 0.5 * dyn;
    if (denom <= 0) return SCORE_PERFECT_FLOAT;
    const score = (trCount / denom) * SCORE_PERFECT_FLOAT;
    return Math.round(Math.max(0, Math.min(SCORE_MAX, score)) * SCORE_ROUNDING) / SCORE_ROUNDING;
}

/**
 * Compute Presentation Decoupling Index (PDI) measuring presentation-domain boundary isolation.
 *
 * @param backendDirectRefs - Backend direct references count.
 * @param eventBusDirectSubs - Event bus direct subscriptions count.
 * @param viewCount - View component count.
 * @returns Decoupling index value.
 */
export function computePresentationDecoupling(
    backendDirectRefs: number,
    eventBusDirectSubs: number,
    viewCount: number = 1,
): number {
    const backend = Math.max(0, backendDirectRefs);
    const eventBus = Math.max(0, eventBusDirectSubs);
    const views = Math.max(1, viewCount);
    const score = SCORE_PERFECT_FLOAT * Math.exp(-(2.5 * backend + 1.8 * eventBus) / views);
    return Math.round(Math.max(0, Math.min(SCORE_MAX, score)) * SCORE_ROUNDING) / SCORE_ROUNDING;
}
export { computePresentationDecoupling as calculatePresentationDecouplingIndex };

/**
 * Compute Boundary Interoperability Factor (BIF) across frontend-backend domain surfaces.
 *
 * @param crossBoundaryViolations - Count of cross-boundary violations.
 * @param totalInteractions - Total interaction count.
 * @returns Interoperability factor value.
 */
export function computeBoundaryInteroperability(
    crossBoundaryViolations: number,
    totalInteractions: number = DEFAULT_INTERACTIONS_COUNT,
): number {
    const leaks = Math.max(0, crossBoundaryViolations);
    const total = Math.max(1, totalInteractions);
    const factor = Math.exp(-0.8 * (leaks / total));
    return Math.round(Math.max(0, Math.min(1.0, factor)) * PERCENT_SCALE) / PERCENT_SCALE;
}
export { computeBoundaryInteroperability as calculateBoundaryInteroperabilityFactor };

/**
 * Options for computing composite frontend-backend quality profile score.
 */
export interface ProfileCompositeOptions {
    readonly frontendScore: number;
    readonly backendScore: number;
    readonly feWeight?: number;
    readonly beWeight?: number;
    readonly boundaryFactor?: number;
}

function resolveProfileParams(
    optionsOrFe: ProfileCompositeOptions | number,
    restArgs: readonly number[],
): {
    feScore: number;
    beScore: number;
    weightFe: number;
    weightBe: number;
    factorBoundary: number;
} {
    if (typeof optionsOrFe === 'object' && optionsOrFe !== null) {
        return {
            feScore: optionsOrFe.frontendScore,
            beScore: optionsOrFe.backendScore,
            weightFe: optionsOrFe.feWeight ?? 1.0,
            weightBe: optionsOrFe.beWeight ?? 1.0,
            factorBoundary: optionsOrFe.boundaryFactor ?? 1.0,
        };
    }
    return {
        feScore: optionsOrFe,
        beScore: restArgs[0] ?? 0,
        weightFe: restArgs[1] ?? 1.0,
        weightBe: restArgs[2] ?? 1.0,
        factorBoundary: restArgs[3] ?? 1.0,
    };
}

/**
 * Compute Composite Profile Quality Score combining frontend and backend assessments.
 *
 * @param options - Structured profile composite options or frontend score.
 * @param restArgs - Legacy positional arguments for backward compatibility.
 * @returns Composite profile quality score.
 */
export function computeProfileCompositeScore(
    options: ProfileCompositeOptions | number,
    ...restArgs: number[]
): number {
    const params = resolveProfileParams(options, restArgs);
    const boundedFe = Math.max(MIN_PROFILE_SCORE_FLOOR, Math.min(SCORE_MAX, params.feScore));
    const boundedBe = Math.max(MIN_PROFILE_SCORE_FLOOR, Math.min(SCORE_MAX, params.beScore));
    const weightFe = Math.max(0.01, params.weightFe);
    const weightBe = Math.max(0.01, params.weightBe);
    const geomMean = Math.exp(
        (weightFe * Math.log(boundedFe) + weightBe * Math.log(boundedBe)) /
            (weightFe + weightBe),
    );
    const rawComposite = geomMean * Math.max(0.1, Math.min(1.0, params.factorBoundary));
    return Math.round(Math.max(0, Math.min(SCORE_MAX, rawComposite)) * SCORE_ROUNDING) / SCORE_ROUNDING;
}
export { computeProfileCompositeScore as calculateProfileCompositeScore };

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

/**
 * Safely extract a clamped score in [0, 100].
 */
function extractSafeScore(raw: unknown): number {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        return 0;
    }
    return Math.min(SCORE_MAX, Math.max(0, raw));
}

/**
 * Safely extract a positive weighting value.
 */
function extractSafeWeight(raw: unknown): number {
    return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : 0;
}

/**
 * Compute the sum of valid custom weights for the given language keys.
 */
function computeTotalCustomWeight(
    keys: readonly string[],
    weights?: Readonly<Record<string, number>>,
): number {
    if (!weights) {
        return 0;
    }
    let total = 0;
    for (let i = 0; i < keys.length; i += 1) {
        total += extractSafeWeight(weights[keys[i]]);
    }
    return total;
}

interface ScoredLanguageWeight {
    readonly score: number;
    readonly weight: number;
}

function resolveLanguageScoreWeight(
    key: string,
    scores: Readonly<Record<string, number>>,
    weights?: Readonly<Record<string, number>>,
): ScoredLanguageWeight {
    return {
        score: extractSafeScore(scores[key]),
        weight: weights ? extractSafeWeight(weights[key]) : 1.0,
    };
}

/**
 * Compute weighted mean score across active languages.
 */
function computeWeightedMean(
    keys: readonly string[],
    scores: Readonly<Record<string, number>>,
    weights: Readonly<Record<string, number>> | undefined,
    totalWeight: number,
): number {
    let sum = 0;
    for (let i = 0; i < keys.length; i += 1) {
        const scoredEntry = resolveLanguageScoreWeight(keys[i], scores, weights);
        sum += scoredEntry.score * scoredEntry.weight;
    }
    return sum / totalWeight;
}

interface WeightedVarianceContext {
    readonly keys: readonly string[];
    readonly scores: Readonly<Record<string, number>>;
    readonly weights?: Readonly<Record<string, number>>;
    readonly mean: number;
    readonly totalWeight: number;
}

/**
 * Compute weighted variance across active languages.
 */
function computeWeightedVariance(context: WeightedVarianceContext): number {
    let sum = 0;
    for (let i = 0; i < context.keys.length; i += 1) {
        const scoredEntry = resolveLanguageScoreWeight(context.keys[i], context.scores, context.weights);
        const delta = scoredEntry.score - context.mean;
        sum += scoredEntry.weight * delta * delta;
    }
    return sum / context.totalWeight;
}

/**
 * Compute Polyglot Generalization and Modernization Equilibrium Index.
 *
 * Mathematical formulation:
 * S_{\text{mean}} = \frac{\sum w_i \cdot s_i}{\sum w_i}
 * \sigma_S = \sqrt{\frac{\sum w_i \cdot (s_i - S_{\text{mean}})^2}{\sum w_i}}
 * D = \max\left(0, 1.0 - \frac{\sigma_S}{100}\right)
 * P_{\text{polyglot}} = S_{\text{mean}} \cdot D
 *
 * Evaluates modernization and standardization equilibrium across multi-language stacks.
 * Homogeneous advancement yields zero dispersion penalty; severe single-language
 * lag incurs rational dampening to prevent isolated high-score masking.
 *
 * @param languageScores - Map of language identifiers to modernization scores in [0, 100].
 * @param languageWeights - Optional weighting map for languages (defaults to equal weight 1.0).
 * @returns Balanced polyglot generalization index in [0, 100].
 */
export function computePolyglotIndex(
    languageScores: Readonly<Record<string, number>>,
    languageWeights?: Readonly<Record<string, number>>,
): number {
    if (!languageScores || typeof languageScores !== 'object') {
        return SCORE_PERFECT_FLOAT;
    }
    const keys = Object.keys(languageScores);
    if (keys.length === 0) {
        return SCORE_PERFECT_FLOAT;
    }
    if (keys.length === 1) {
        const raw = languageScores[keys[0]];
        return Math.round(extractSafeScore(raw) * SCORE_ROUNDING) / SCORE_ROUNDING;
    }

    const customWeightSum = computeTotalCustomWeight(keys, languageWeights);
    const activeWeights = customWeightSum > 0 ? languageWeights : undefined;
    const totalWeight = customWeightSum > 0 ? customWeightSum : keys.length;

    const sMean = computeWeightedMean(keys, languageScores, activeWeights, totalWeight);
    const variance = computeWeightedVariance({
        keys,
        scores: languageScores,
        weights: activeWeights,
        mean: sMean,
        totalWeight,
    });
    const sigmaS = Math.sqrt(Math.max(0, variance));

    const dispersionPenalty = Math.max(0, 1.0 - sigmaS / SCORE_PERFECT_FLOAT);
    const polyglotScore = sMean * dispersionPenalty;
    const clampedScore = Math.max(0, Math.min(SCORE_MAX, polyglotScore));
    return Math.round(clampedScore * SCORE_ROUNDING) / SCORE_ROUNDING;
}
export { computePolyglotIndex as calculatePolyglotGeneralizationIndex };
