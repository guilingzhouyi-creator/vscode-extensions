/**
 * Module: Feedback Fusion Layer — Dual-Plane Risk Fusion Engine
 * File Path: src/core/scoring/risk-fusion-engine.ts
 * Architecture Role: Evaluates non-linear cross-plane risk resonance combining static analysis
 *   inferences, dynamic runtime evidence, and historical failure records:
 *   Risk_i = S_i^alpha * D_i^beta * H_i^gamma.
 * Dependencies & Triggers: Consumes static-quality-model and dynamic-types; consumed by
 *   fusion-scorer, report-builder, and governance gates.
 * Responsibilities:
 *   1. Evaluate non-linear resonance between Static Risk (S_i) and Dynamic Risk (D_i).
 *   2. Enforce Dual Confirmation escalation to CRITICAL for verified hotspots.
 *   3. Enforce Single-Side Dampening to eliminate false positives on cold/uninvoked paths.
 *   4. Capture hidden runtime bottlenecks when static heuristics underestimate complexity.
 * Exit Semantics & Design Rationale: Bounded [0.0, 100.0] fused score space; deterministic;
 *   produces transparent rationale explaining why risks were amplified or dampened.
 */

import type { StaticIssueRisk } from './static-quality-model';
import type { DynamicIssueRisk } from '../dynamic/dynamic-types';
import type { TopologicalChurnResult } from './topological-churn-evaluator';
import { computePowerResonance } from '../math';
import { RiskFusionRationales } from '../messages';

/**
 * Exponent tuning coefficients for risk resonance calculation:
 * Risk_i = S_i^alpha * D_i^beta * H_i^gamma
 */
export interface RiskFusionCoefficients {
    /** alpha: Static inference exponent (default: 1.0) */
    alpha: number;
    /** beta: Dynamic evidence exponent (default: 1.2, prioritizing runtime facts) */
    beta: number;
    /** gamma: Historical failure sensitivity exponent (default: 0.8) */
    gamma: number;
    /** Optional churn impact multiplier M_impact(f) from topological churn analysis */
    churnImpactMultiplier?: number;
}

/**
 * Standard default risk fusion coefficients.
 */
export const DEFAULT_FUSION_COEFFICIENTS: Readonly<RiskFusionCoefficients> = {
    alpha: 1.0,
    beta: 1.2,
    gamma: 0.8,
};

/**
 * Final classified risk levels after cross-plane fusion.
 */
export type FusedRiskLevel = 'critical' | 'high' | 'medium' | 'low' | 'informational';

/** Fused level for defects that must block delivery regardless of other evidence. */
export const FUSED_LEVEL_CRITICAL: FusedRiskLevel = 'critical';
/** Fused level for defects warranting immediate remediation before the next release. */
export const FUSED_LEVEL_HIGH: FusedRiskLevel = 'high';
/** Fused level for defects scheduled within the current remediation cycle. */
export const FUSED_LEVEL_MEDIUM: FusedRiskLevel = 'medium';
/** Fused level for defects tracked without a scheduling commitment. */
export const FUSED_LEVEL_LOW: FusedRiskLevel = 'low';
/** Fused level for findings retained as context with no remediation obligation. */
export const FUSED_LEVEL_INFORMATIONAL: FusedRiskLevel = 'informational';

const THRESHOLD_CRITICAL = 20.0;
const THRESHOLD_CRITICAL_DUAL_CONFIRMED = 12.0;
const THRESHOLD_HIGH = 10.0;
const THRESHOLD_MEDIUM = 4.0;
const THRESHOLD_LOW = 1.5;

const MIN_DYNAMIC_RISK = 0.05;
const DUAL_CONFIRM_THRESHOLD_STATIC = 3.0;
const DUAL_CONFIRM_THRESHOLD_DYNAMIC = 3.0;
const DAMPENING_THRESHOLD_STATIC = 2.0;
const DAMPENING_THRESHOLD_DYNAMIC = 0.5;
const HIDDEN_BOTTLENECK_STATIC = 1.0;
const HIDDEN_BOTTLENECK_DYNAMIC = 5.0;

const MIN_HISTORICAL_FACTOR = 0.3;
const MAX_HISTORICAL_FACTOR = 6.0;
const MIN_NORMALIZED_STATIC_RISK = 0.1;

const PROPERTY_IMPACT_MULTIPLIER = 'impactMultiplier';
const MAX_FUSED_SCORE_CEILING = 100.0;
const SCORE_ROUND_FACTOR = 100;
const DYNAMIC_RAW_RISK_SCALE = 25.0;
const MAX_EFFECTIVE_DYNAMIC_RISK = 10.0;

/**
 * Quantified cross-plane fused issue risk evaluation.
 */
export interface FusedIssueRisk {
    issueId: string;
    rule: string;
    /** S_i: Static risk score [0.0, 10.0] */
    staticRisk: number;
    /** D_i: Dynamic risk score [0.0, 10.0] */
    dynamicRisk: number;
    /** H_i: Historical incident multiplier [0.5, 3.0] */
    historicalFactor: number;
    /** Fused risk score: S_i^alpha * D_i^beta * H_i^gamma */
    fusedScore: number;
    /** Final categorized risk level */
    level: FusedRiskLevel;
    /** True if issue is corroborated by both static AST and dynamic profiler */
    isDualConfirmed: boolean;
    /** True if single-sided noise dampening was applied */
    suppressionApplied: boolean;
    /** Human-readable explanation of the fusion arbitration verdict */
    rationale: string;
}

/**
 * Fuses static risk and dynamic runtime evidence for an issue or hotspot:
 * Risk_i = S_i^alpha * D_i^beta * H_i^gamma
 *
 * @param staticRisk - Quantified static risk assessment (S_i).
 * @param dynamicRisk - Optional dynamic hotspot risk assessment (D_i).
 * @param historicalFactor - Optional historical failure multiplier (H_i, default 1.0).
 * @param customCoeffs - Optional override for alpha, beta, gamma exponents.
 * @returns Fully articulated FusedIssueRisk record.
 */
interface CorroborationArbitration {
    dynamicRiskScore: number;
    isDualConfirmed: boolean;
    suppressionApplied: boolean;
    rationale: string;
}

function arbitrateCorroboration(
    staticRisk: StaticIssueRisk,
    dynamicRisk?: DynamicIssueRisk,
): CorroborationArbitration {
    if (!dynamicRisk || dynamicRisk.evidenceConfidence <= 0) {
        return {
            dynamicRiskScore: 1.0,
            isDualConfirmed: false,
            suppressionApplied: false,
            rationale: RiskFusionRationales.TELEMETRY_UNAVAILABLE,
        };
    }

    const dynamicRiskScore = Math.max(MIN_DYNAMIC_RISK, dynamicRisk.normalizedRisk);
    const staticRiskScore = staticRisk.normalizedRisk;

    if (
        staticRiskScore >= DUAL_CONFIRM_THRESHOLD_STATIC &&
        dynamicRiskScore >= DUAL_CONFIRM_THRESHOLD_DYNAMIC
    ) {
        return {
            dynamicRiskScore,
            isDualConfirmed: true,
            suppressionApplied: false,
            rationale: RiskFusionRationales.DUAL_CONFIRMED(staticRiskScore, dynamicRiskScore),
        };
    }
    if (
        staticRiskScore >= DAMPENING_THRESHOLD_STATIC &&
        dynamicRiskScore <= DAMPENING_THRESHOLD_DYNAMIC
    ) {
        return {
            dynamicRiskScore,
            isDualConfirmed: false,
            suppressionApplied: true,
            rationale: RiskFusionRationales.SINGLE_SIDED_DAMPENED(
                staticRiskScore,
                dynamicRiskScore,
            ),
        };
    }
    if (
        staticRiskScore <= HIDDEN_BOTTLENECK_STATIC &&
        dynamicRiskScore >= HIDDEN_BOTTLENECK_DYNAMIC
    ) {
        return {
            dynamicRiskScore,
            isDualConfirmed: false,
            suppressionApplied: false,
            rationale: RiskFusionRationales.HIDDEN_BOTTLENECK(staticRiskScore, dynamicRiskScore),
        };
    }
    return {
        dynamicRiskScore,
        isDualConfirmed: false,
        suppressionApplied: false,
        rationale: RiskFusionRationales.STANDARD_FUSION,
    };
}

function classifyFusedRiskLevel(fusedScore: number, isDualConfirmed: boolean): FusedRiskLevel {
    if (
        fusedScore >= THRESHOLD_CRITICAL ||
        (isDualConfirmed && fusedScore >= THRESHOLD_CRITICAL_DUAL_CONFIRMED)
    ) {
        return FUSED_LEVEL_CRITICAL;
    }
    if (fusedScore >= THRESHOLD_HIGH) {
        return FUSED_LEVEL_HIGH;
    }
    if (fusedScore >= THRESHOLD_MEDIUM) {
        return FUSED_LEVEL_MEDIUM;
    }
    if (fusedScore >= THRESHOLD_LOW) {
        return FUSED_LEVEL_LOW;
    }
    return FUSED_LEVEL_INFORMATIONAL;
}

/**
 * Fuses static severity, dynamic telemetry, and historical decay into a unified risk rating.
 *
 * @param staticRisk - Static finding risk profile.
 * @param dynamicRisk - Optional dynamic execution telemetry risk.
 * @param historicalFactor - Multiplier or TopologicalChurnResult reflecting churn and defect
 *                           history.
 * @param customCoeffs - Optional weight coefficients override.
 * @returns Unified fused risk assessment.
 */
export function fuseIssueRisks(
    staticRisk: StaticIssueRisk,
    dynamicRisk?: DynamicIssueRisk,
    historicalFactor: number | TopologicalChurnResult = 1.0,
    customCoeffs: Partial<RiskFusionCoefficients> = {},
): FusedIssueRisk {
    const coeffs: RiskFusionCoefficients = {
        ...DEFAULT_FUSION_COEFFICIENTS,
        ...customCoeffs,
    };

    let churnMultiplier = coeffs.churnImpactMultiplier ?? 1.0;
    let baseH = 1.0;

    if (typeof historicalFactor === 'number') {
        baseH = historicalFactor;
    } else if (
        historicalFactor &&
        typeof historicalFactor === 'object' &&
        PROPERTY_IMPACT_MULTIPLIER in historicalFactor
    ) {
        churnMultiplier = historicalFactor[PROPERTY_IMPACT_MULTIPLIER];
    }

    const staticRiskScore = Math.max(MIN_NORMALIZED_STATIC_RISK, staticRisk.normalizedRisk);
    const historicalMultiplier = Math.max(
        MIN_HISTORICAL_FACTOR,
        Math.min(MAX_HISTORICAL_FACTOR, baseH * churnMultiplier),
    );

    const {
        dynamicRiskScore,
        isDualConfirmed,
        suppressionApplied,
        rationale: baseRationale,
    } = arbitrateCorroboration(staticRisk, dynamicRisk);

    const modifier = suppressionApplied ? 0.35 : isDualConfirmed ? 1.3 : 1.0;
    const fusedScore = computePowerResonance({
        staticScore: staticRiskScore,
        dynamicScore: dynamicRiskScore,
        historicalScore: historicalMultiplier,
        coeffs,
        modifier,
        ceiling: MAX_FUSED_SCORE_CEILING,
    });
    const level = classifyFusedRiskLevel(fusedScore, isDualConfirmed);

    let rationale = baseRationale;
    if (churnMultiplier < 0.9) {
        rationale += RiskFusionRationales.CHURN_RELAXATION(churnMultiplier);
    } else if (churnMultiplier > 1.1) {
        rationale += RiskFusionRationales.CHURN_AMPLIFICATION(churnMultiplier);
    }

    return {
        issueId: staticRisk.issueId,
        rule: staticRisk.rule,
        staticRisk: Math.round(staticRisk.normalizedRisk * SCORE_ROUND_FACTOR) / SCORE_ROUND_FACTOR,
        dynamicRisk: dynamicRisk
            ? Math.round(dynamicRisk.normalizedRisk * SCORE_ROUND_FACTOR) / SCORE_ROUND_FACTOR
            : 0.0,
        historicalFactor:
            Math.round(historicalMultiplier * SCORE_ROUND_FACTOR) / SCORE_ROUND_FACTOR,
        fusedScore,
        level,
        isDualConfirmed,
        suppressionApplied,
        rationale,
    };
}

/**
 * Object-oriented facade for the Risk Fusion Engine.
 */
export class RiskFusionEngine {
    private readonly defaultCoeffs?: Partial<RiskFusionCoefficients>;

    constructor(defaultCoeffs?: Partial<RiskFusionCoefficients>) {
        this.defaultCoeffs = defaultCoeffs;
    }

    public evaluateIssue(
        staticRisk: StaticIssueRisk,
        dynamicRisk?: DynamicIssueRisk,
        historicalFactor: number | TopologicalChurnResult = 1.0,
    ): FusedIssueRisk {
        return fuseIssueRisks(staticRisk, dynamicRisk, historicalFactor, this.defaultCoeffs);
    }
}

/**
 * Caller node in a topological call graph representing dynamic invocation pressure.
 */
export interface TopologicalCallerNode {
    /** Identifier or name of the caller function or module */
    callerSymbol: string;
    /** Dynamic hotspot risk of the caller */
    dynamicRisk: DynamicIssueRisk;
    /** Relative invocation frequency weight omega(u, v) in [0.0, 1.0] (default: 0.5) */
    couplingWeight?: number;
}

/**
 * Result of topological cascading risk evaluation across call paths.
 */
export interface CascadedRiskResult extends FusedIssueRisk {
    /** Cumulative dynamic risk cascading into this callee from all upstream callers */
    upstreamCascadedDynamicRisk: number;
    /** Effective composite dynamic risk after topological amplification */
    effectiveDynamicRisk: number;
    /** List of callers contributing to the cascaded risk */
    contributingCallers: string[];
}

function aggregateTopologicalCallers(callers: TopologicalCallerNode[]): {
    cascadedDynamicSum: number;
    contributingCallers: string[];
} {
    let cascadedDynamicSum = 0;
    const contributingCallers: string[] = [];

    for (const caller of callers) {
        const weight = Math.max(0.0, Math.min(1.0, caller.couplingWeight ?? 0.5));
        const callerRisk = caller.dynamicRisk.normalizedRisk;
        if (callerRisk > 0 && weight > 0) {
            cascadedDynamicSum += callerRisk * weight;
            contributingCallers.push(caller.callerSymbol);
        }
    }
    return { cascadedDynamicSum, contributingCallers };
}

function buildEffectiveDynamicHotspot(
    staticRisk: StaticIssueRisk,
    selfDynamicRisk: DynamicIssueRisk | undefined,
    effectiveDynamic: number,
    callersCount: number,
): DynamicIssueRisk {
    return {
        hotspotId: selfDynamicRisk?.hotspotId ?? `cascaded-${staticRisk.issueId}`,
        targetSymbol: selfDynamicRisk?.targetSymbol,
        filePath: selfDynamicRisk?.filePath,
        line: selfDynamicRisk?.line,
        B: selfDynamicRisk?.B ?? 2.0,
        F: selfDynamicRisk?.F ?? 2.0,
        R: selfDynamicRisk?.R ?? 2.0,
        V: selfDynamicRisk?.V ?? 2.0,
        rawRisk:
            Math.round(effectiveDynamic * DYNAMIC_RAW_RISK_SCALE * SCORE_ROUND_FACTOR) /
            SCORE_ROUND_FACTOR,
        normalizedRisk: Math.round(effectiveDynamic * SCORE_ROUND_FACTOR) / SCORE_ROUND_FACTOR,
        evidenceConfidence: selfDynamicRisk?.evidenceConfidence ?? (callersCount > 0 ? 0.9 : 0.6),
    };
}

/**
 * Evaluates non-linear topological risk resonance cascading along caller-callee execution edges:
 * Risk_cascaded(v) = S_i(v)^alpha * (D_i(v) + sum(omega(u, v) * D_i(u)))^beta * H_i(v)^gamma
 *
 * @param staticRisk - Quantified static risk assessment for the target callee (S_i(v)).
 * @param selfDynamicRisk - Direct dynamic hotspot risk of the callee (D_i(v)).
 * @param callers - Array of upstream callers feeding execution pressure into this callee.
 * @param historicalFactor - Historical failure multiplier H_i.
 * @param customCoeffs - Optional override for alpha, beta, gamma exponents.
 * @returns Fully articulated CascadedRiskResult.
 */
export function fuseCascadedRisks(
    staticRisk: StaticIssueRisk,
    selfDynamicRisk: DynamicIssueRisk | undefined,
    callers: TopologicalCallerNode[] = [],
    historicalFactor = 1.0,
    customCoeffs: Partial<RiskFusionCoefficients> = {},
): CascadedRiskResult {
    const { cascadedDynamicSum, contributingCallers } = aggregateTopologicalCallers(callers);

    const selfRiskVal = selfDynamicRisk ? selfDynamicRisk.normalizedRisk : 0.0;
    const effectiveDynamic = Math.min(MAX_EFFECTIVE_DYNAMIC_RISK, selfRiskVal + cascadedDynamicSum);

    const effectiveDynamicRiskObj = buildEffectiveDynamicHotspot(
        staticRisk,
        selfDynamicRisk,
        effectiveDynamic,
        callers.length,
    );

    const baseFused = fuseIssueRisks(
        staticRisk,
        effectiveDynamicRiskObj,
        historicalFactor,
        customCoeffs,
    );

    let updatedRationale = baseFused.rationale;
    if (contributingCallers.length > 0) {
        updatedRationale +=
            ` [Topological Cascade: Amplified by ${contributingCallers.length} caller(s) ` +
            `(${contributingCallers.join(', ')}), +${cascadedDynamicSum.toFixed(1)} dynamic pressure]`;
    }

    return {
        ...baseFused,
        rationale: updatedRationale,
        upstreamCascadedDynamicRisk:
            Math.round(cascadedDynamicSum * SCORE_ROUND_FACTOR) / SCORE_ROUND_FACTOR,
        effectiveDynamicRisk:
            Math.round(effectiveDynamic * SCORE_ROUND_FACTOR) / SCORE_ROUND_FACTOR,
        contributingCallers,
    };
}
