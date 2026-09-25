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
    D: number;
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
            D: 1.0,
            isDualConfirmed: false,
            suppressionApplied: false,
            rationale:
                'Dynamic telemetry unavailable; risk inferred from static structural ' +
                'analysis with neutral dynamic baseline.',
        };
    }

    const D = Math.max(0.05, dynamicRisk.normalizedRisk);
    const S = staticRisk.normalizedRisk;

    if (S >= 3.0 && D >= 3.0) {
        return {
            D,
            isDualConfirmed: true,
            suppressionApplied: false,
            rationale:
                `Dual-plane confirmed: High static structural risk (S=${S.toFixed(1)}) ` +
                `corroborated by runtime hotspot evidence (D=${D.toFixed(1)}). Risk amplified.`,
        };
    }
    if (S >= 2.0 && D <= 0.5) {
        return {
            D,
            isDualConfirmed: false,
            suppressionApplied: true,
            rationale:
                `Single-sided dampening: High static complexity (S=${S.toFixed(1)}) ` +
                `refuted by cold runtime invocation evidence (D=${D.toFixed(1)}). Severity downgraded.`,
        };
    }
    if (S <= 1.0 && D >= 5.0) {
        return {
            D,
            isDualConfirmed: false,
            suppressionApplied: false,
            rationale:
                `Hidden runtime bottleneck: Low static penalty (S=${S.toFixed(1)}) ` +
                `overridden by severe runtime latency/contention hotspot (D=${D.toFixed(1)}).`,
        };
    }
    return {
        D,
        isDualConfirmed: false,
        suppressionApplied: false,
        rationale: 'Standard dual-plane fusion across static and dynamic indicators.',
    };
}

function classifyFusedRiskLevel(fusedScore: number, isDualConfirmed: boolean): FusedRiskLevel {
    if (fusedScore >= 20.0 || (isDualConfirmed && fusedScore >= 12.0)) {
        return 'critical';
    }
    if (fusedScore >= 10.0) {
        return 'high';
    }
    if (fusedScore >= 4.0) {
        return 'medium';
    }
    if (fusedScore >= 1.5) {
        return 'low';
    }
    return 'informational';
}

export function fuseIssueRisks(
    staticRisk: StaticIssueRisk,
    dynamicRisk?: DynamicIssueRisk,
    historicalFactor = 1.0,
    customCoeffs: Partial<RiskFusionCoefficients> = {},
): FusedIssueRisk {
    const coeffs: RiskFusionCoefficients = {
        ...DEFAULT_FUSION_COEFFICIENTS,
        ...customCoeffs,
    };

    const S = Math.max(0.1, staticRisk.normalizedRisk);
    const H = Math.max(0.5, Math.min(3.0, historicalFactor));

    const { D, isDualConfirmed, suppressionApplied, rationale } =
        arbitrateCorroboration(staticRisk, dynamicRisk);

    let rawFused = Math.pow(S, coeffs.alpha) * Math.pow(D, coeffs.beta) * Math.pow(H, coeffs.gamma);

    if (suppressionApplied) {
        rawFused *= 0.35;
    } else if (isDualConfirmed) {
        rawFused *= 1.3;
    }

    const fusedScore = Math.round(Math.min(100.0, rawFused) * 10) / 10;
    const level = classifyFusedRiskLevel(fusedScore, isDualConfirmed);

    return {
        issueId: staticRisk.issueId,
        rule: staticRisk.rule,
        staticRisk: Math.round(staticRisk.normalizedRisk * 10) / 10,
        dynamicRisk: dynamicRisk ? Math.round(dynamicRisk.normalizedRisk * 10) / 10 : 0.0,
        historicalFactor: Math.round(H * 100) / 100,
        fusedScore,
        level,
        isDualConfirmed,
        suppressionApplied,
        rationale,
    };
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
        rawRisk: Math.round(effectiveDynamic * 25.0 * 100) / 100,
        normalizedRisk: Math.round(effectiveDynamic * 10) / 10,
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
    const effectiveDynamic = Math.min(10.0, selfRiskVal + cascadedDynamicSum);

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
        upstreamCascadedDynamicRisk: Math.round(cascadedDynamicSum * 10) / 10,
        effectiveDynamicRisk: Math.round(effectiveDynamic * 10) / 10,
        contributingCallers,
    };
}
