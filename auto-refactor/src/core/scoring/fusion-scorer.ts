/**
 * Module: Feedback Fusion Layer — Unified Cross-Plane Fusion Scorer
 * File Path: src/core/scoring/fusion-scorer.ts
 * Architecture Role: Primary quality synthesis engine uniting Static Analysis Plane (Q_s),
 *   Dynamic Analysis Plane (Q_d), and Historical Feedback Ledger (Q_f):
 *   Q_total = W_s * Q_s + W_d * Q_d + W_f * Q_f.
 * Dependencies & Triggers: Consumes static-quality-model, dynamic-types,
 *   and dynamic-quality-scorer; consumed by reportBuilder, CLI, and change-quality arbiter.
 * Responsibilities:
 *   1. Resolve context-adaptive weights W = f(Stage, Scale, Domain, Risk).
 *   2. Synthesize total unified quality score Q_total.
 *   3. Provide full explainability and mathematical traceability of applied weights.
 * Exit Semantics & Design Rationale: Normalized weights summing to 1.0; bounded score [0.0, 100.0];
 *   graceful fallback when dynamic or historical data is missing.
 */

import type { StaticQualityVector } from './static-quality-model';
import { computeStaticQualityScore } from './static-quality-model';
import type { DynamicQualityVector } from '../dynamic/dynamic-types';
import { computeDynamicQualityScore } from '../dynamic/dynamic-quality-scorer';
import { SCORE_ROUNDING } from './scorer-formulas';

/**
 * Contextual project characteristics driving dynamic weight adaptation.
 */
export interface GovernanceProjectProfile {
    /** Development maturity stage */
    stage?: 'prototype' | 'rapid_development' | 'production' | 'industrial_infrastructure';
    /** Codebase scale tier */
    scale?: 'small' | 'medium' | 'large' | 'massive';
    /** Architectural domain classification */
    domain?: 'algorithm_lib' | 'core_framework' | 'business_app' | 'cli_tool';
    /** Quality and risk posture */
    riskTolerance?: 'strict_zero_defect' | 'balanced' | 'speed_priority';
}

/**
 * Tri-plane weighting vector (sum = 1.0).
 */
export interface FusionWeights {
    /** W_s: Static Analysis Plane weight */
    Ws: number;
    /** W_d: Dynamic Analysis Plane weight */
    Wd: number;
    /** W_f: Historical Feedback Plane weight */
    Wf: number;
}

/**
 * Breakdown of tri-plane fusion quality evaluation.
 */
export interface UnifiedQualityAssessment {
    /** Q_total: Final composite quality score [0.0, 100.0] */
    totalScore: number;
    /** Q_s: Static plane score */
    staticScore: number;
    /** Q_d: Dynamic plane score */
    dynamicScore: number;
    /** Q_f: Historical feedback score */
    feedbackScore: number;
    /** Applied weights: W_s, W_d, W_f */
    weights: FusionWeights;
    /** Static 7-axis vector */
    staticVector: StaticQualityVector;
    /** Dynamic 5-axis vector */
    dynamicVector?: DynamicQualityVector;
    /** Evaluation explanation */
    explanation: string;
}

const DOMAIN_WEIGHT_MAP: Readonly<Record<string, readonly [number, number, number]>> = Object.freeze({
    core_framework: [0.55, 0.3, 0.15],
    algorithm_lib: [0.35, 0.5, 0.15],
    business_app: [0.4, 0.35, 0.25],
    cli_tool: [0.6, 0.25, 0.15],
});

const STAGE_WEIGHT_MAP: Readonly<Record<string, readonly [number, number, number]>> = Object.freeze({
    prototype: [0.7, 0.2, 0.1],
    industrial_infrastructure: [0.45, 0.4, 0.15],
});

const DEFAULT_FUSION_WEIGHTS: readonly [number, number, number] = [0.5, 0.35, 0.15];

/** Resolves raw tri-plane weights from static configuration lookup table. */
function resolveRawTriplaneWeights(domain: string, stage: string): [number, number, number] {
    const stageOverride = STAGE_WEIGHT_MAP[stage];
    if (stageOverride) {
        return [stageOverride[0], stageOverride[1], stageOverride[2]];
    }
    const domainDefault = DOMAIN_WEIGHT_MAP[domain] ?? DEFAULT_FUSION_WEIGHTS;
    return [domainDefault[0], domainDefault[1], domainDefault[2]];
}

/**
 * Resolves context-adaptive tri-plane weights W = f(Stage, Scale, Domain, Risk).
 *
 * Ground-truth Invariant: An unobserved plane MUST receive zero weight (W_i = 0),
 * and the remaining observed planes are re-normalized to sum to 1.0.
 * Fabricating a non-zero weight for an unmeasured plane is prohibited by AGENTS.md.
 *
 * @param profile - Contextual project profile parameters.
 * @param hasDynamicEvidence - Whether genuine dynamic telemetry was ingested.
 * @param hasHistoricalEvidence - Whether genuine historical reliability feedback was ingested.
 * @returns Normalized FusionWeights summing to 1.0 (or Ws=1.0 when only static is observed).
 */
export function resolveAdaptiveFusionWeights(
    profile: GovernanceProjectProfile = {},
    hasDynamicEvidence = true,
    hasHistoricalEvidence = false,
): FusionWeights {
    if (!hasDynamicEvidence && !hasHistoricalEvidence) {
        // Pure static observation: 100% ground-truth weight on static analysis plane
        return { Ws: 1.0, Wd: 0.0, Wf: 0.0 };
    }

    const domain = profile.domain ?? 'core_framework';
    const stage = profile.stage ?? 'production';
    const [rawWs, rawWd, rawWf] = resolveRawTriplaneWeights(domain, stage);

    const effectiveWs = rawWs;
    const effectiveWd = hasDynamicEvidence ? rawWd : 0.0;
    const effectiveWf = hasHistoricalEvidence ? rawWf : 0.0;

    const sum = effectiveWs + effectiveWd + effectiveWf;
    if (sum <= 0) {
        return { Ws: 1.0, Wd: 0.0, Wf: 0.0 };
    }

    return {
        Ws: Math.round((effectiveWs / sum) * 100) / 100,
        Wd: Math.round((effectiveWd / sum) * 100) / 100,
        Wf: Math.round((effectiveWf / sum) * 100) / 100,
    };
}

/**
 * Computes the unified tri-plane quality score:
 * Q_total = W_s * Q_s + W_d * Q_d + W_f * Q_f
 *
 * When dynamic or historical data is absent, its weight drops to 0.0 and the active
 * planes are strictly renormalized, eliminating unearned score inflation.
 *
 * @param staticVector - 7-axis Static Quality Vector.
 * @param dynamicVector - Optional 5-axis Dynamic Quality Vector.
 * @param historicalScore - Optional historical reliability / incident score.
 * @param profile - Contextual project profile for adaptive weighting.
 * @returns Fully explained UnifiedQualityAssessment.
 */
export function computeUnifiedQualityScore(
    staticVector: StaticQualityVector,
    dynamicVector?: DynamicQualityVector,
    historicalScore?: number | null,
    profile: GovernanceProjectProfile = {},
): UnifiedQualityAssessment {
    const hasDynamic = dynamicVector !== undefined;
    const hasHistorical = typeof historicalScore === 'number' && Number.isFinite(historicalScore);
    const weights = resolveAdaptiveFusionWeights(profile, hasDynamic, hasHistorical);

    const staticScore = computeStaticQualityScore(staticVector);
    const dynamicScore = hasDynamic ? computeDynamicQualityScore(dynamicVector!) : staticScore;
    const feedbackScore = hasHistorical ? Math.max(0.0, Math.min(100.0, historicalScore!)) : staticScore;

    const totalRaw =
        weights.Ws * staticScore +
        (weights.Wd > 0 ? weights.Wd * dynamicScore : 0.0) +
        (weights.Wf > 0 ? weights.Wf * feedbackScore : 0.0);

    const totalScore = Math.round(totalRaw * SCORE_ROUNDING) / SCORE_ROUNDING;

    const dynLabel = hasDynamic ? `${dynamicScore} (${(weights.Wd * 100).toFixed(0)}%)` : 'unobserved';
    const histLabel = hasHistorical ? `${feedbackScore} (${(weights.Wf * 100).toFixed(0)}%)` : 'unobserved';
    const explanation =
        `Unified quality synthesized: Q_total=${totalScore} ` +
        `[Static (${(weights.Ws * 100).toFixed(0)}%): ${staticScore}, ` +
        `Dynamic: ${dynLabel}, ` +
        `Feedback: ${histLabel}]`;

    return {
        totalScore,
        staticScore,
        dynamicScore,
        feedbackScore,
        weights,
        staticVector,
        dynamicVector,
        explanation,
    };
}
