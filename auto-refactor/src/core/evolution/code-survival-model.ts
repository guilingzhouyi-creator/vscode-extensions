/**
 * Module: Core Evolution — Kaplan-Meier Code Survival Model
 * File Path: src/core/evolution/code-survival-model.ts
 * Architecture Role: Computes Kaplan-Meier non-parametric survival functions S(t) and
 *   empirical hazard rates lambda(t) for software units across commit generations.
 * Dependencies & Triggers: Consumed by CodeEvolutionAnalyzer, BehavioralHotspotEvaluator,
 *   and CI quality gates.
 * Responsibilities:
 *   1. Accept chronological revision interval data with at-risk and event counts;
 *   2. Compute product-limit survival estimator S(t) = prod_{t_i <= t} (1 - d_i / n_i);
 *   3. Estimate code half-life t_{0.5} (median survival time);
 *   4. Classify stability regimes: stable mature vs high infant mortality.
 * Exit Semantics & Design Rationale: Deterministic mathematical model; zero transient
 *   heap allocation within hot loops; handles censored observations gracefully.
 */

/**
 * Single observation point representing an interval in code lifetime.
 */
export interface SurvivalIntervalData {
    /** Revision generation or time step index (t_i >= 0) */
    readonly timeStep: number;
    /** Number of code elements active and at risk prior to this step (n_i) */
    readonly atRiskCount: number;
    /** Number of defect/churn events occurring at this step (d_i) */
    readonly eventCount: number;
}

/**
 * Point on the computed Kaplan-Meier survival curve.
 */
export interface SurvivalCurvePoint {
    readonly timeStep: number;
    readonly survival: number;
    readonly hazard: number;
}

/**
 * Full outcome of a Kaplan-Meier code survival evaluation.
 */
export interface CodeSurvivalEvaluation {
    /** Cumulative survival probability S(t) in [0.0, 1.0] */
    readonly survivalProbability: number;
    /** Empirical hazard rate at final step: d_k / n_k */
    readonly finalHazardRate: number;
    /** Estimated code half-life (first step where S(t) <= 0.50), or null if S(t) remains > 0.50 */
    readonly estimatedHalfLife: number | null;
    /** Qualitative stability regime */
    readonly regime: 'stable_mature' | 'moderate_decay' | 'high_infant_mortality';
    /** Step-by-step survival curve */
    readonly survivalCurve: readonly SurvivalCurvePoint[];
    /** Actionable guidance message */
    readonly recommendation?: string;
}

const MATURE_SURVIVAL_THRESHOLD = 0.75;
const INFANT_MORTALITY_TIME_THRESHOLD = 5;
const INFANT_MORTALITY_SURVIVAL_THRESHOLD = 0.50;

/**
 * Computes the Kaplan-Meier survival estimator S(t) from revision interval data.
 * Formula: S(t) = prod_{t_i <= t} (1 - d_i / n_i)
 *
 * @param intervals - Chronologically sorted array of revision intervals.
 * @returns Evaluated code survival outcome.
 */
export function computeCodeSurvival(
    intervals: readonly SurvivalIntervalData[],
): CodeSurvivalEvaluation {
    if (!intervals || intervals.length === 0) {
        return Object.freeze({
            survivalProbability: 1.0,
            finalHazardRate: 0.0,
            estimatedHalfLife: null,
            regime: 'stable_mature',
            survivalCurve: Object.freeze([]),
        });
    }

    let currentSurvival = 1.0;
    let finalHazard = 0.0;
    let halfLife: number | null = null;
    const curve: SurvivalCurvePoint[] = [];

    for (let i = 0; i < intervals.length; i++) {
        const item = intervals[i];
        const n = Math.max(0, item.atRiskCount);
        const d = Math.max(0, item.eventCount);

        let hazard = 0.0;
        if (n > 0) {
            hazard = Math.min(1.0, +(d / n).toFixed(4));
        }
        finalHazard = hazard;

        currentSurvival = +(currentSurvival * (1.0 - hazard)).toFixed(4);
        currentSurvival = Math.max(0.0, Math.min(1.0, currentSurvival));

        if (halfLife === null && currentSurvival <= 0.50) {
            halfLife = item.timeStep;
        }

        curve.push(Object.freeze({
            timeStep: item.timeStep,
            survival: currentSurvival,
            hazard,
        }));
    }

    const regime = classifySurvivalRegime(currentSurvival, halfLife);
    const recommendation = generateSurvivalRecommendation(regime, currentSurvival, halfLife);

    return Object.freeze({
        survivalProbability: currentSurvival,
        finalHazardRate: finalHazard,
        estimatedHalfLife: halfLife,
        regime,
        survivalCurve: Object.freeze(curve),
        recommendation,
    });
}

/**
 * Classifies the survival regime based on final survival rate and half-life timing.
 *
 * @param survival - Final cumulative survival probability S(t).
 * @param halfLife - Estimated step where S(t) dropped below 0.50.
 * @returns Classified regime.
 */
export function classifySurvivalRegime(
    survival: number,
    halfLife: number | null,
): 'stable_mature' | 'moderate_decay' | 'high_infant_mortality' {
    if (halfLife !== null && halfLife <= INFANT_MORTALITY_TIME_THRESHOLD) {
        return 'high_infant_mortality';
    }
    if (survival >= MATURE_SURVIVAL_THRESHOLD) {
        return 'stable_mature';
    }
    return 'moderate_decay';
}

/**
 * Generates an actionable stabilization recommendation for the code module.
 *
 * @param regime - Classified regime.
 * @param survival - Final survival probability.
 * @param halfLife - Estimated half life.
 * @returns Optional recommendation message.
 */
export function generateSurvivalRecommendation(
    regime: 'stable_mature' | 'moderate_decay' | 'high_infant_mortality',
    survival: number,
    halfLife: number | null,
): string | undefined {
    if (regime === 'high_infant_mortality') {
        return (
            `High infant mortality detected (half-life: step ${halfLife}, S(t)=${survival}). ` +
            `Code experiences rapid regression fixes immediately following introduction. ` +
            `Harden unit testing and boundary discipline before committing further changes.`
        );
    }
    if (regime === 'moderate_decay') {
        return (
            `Moderate structural decay observed (survival rate S(t)=${survival}). ` +
            `Consider scheduled stabilization refactoring to counteract gradual architectural erosion.`
        );
    }
    return undefined;
}
