/**
 * Module: Feedback Fusion Layer — Unified Cross-Plane Fusion Scorer
 * File Path: src/core/scoring/fusion-scorer.ts
 * Architecture Role: Primary quality synthesis engine uniting Static Analysis Plane (Q_s),
 *   Dynamic Analysis Plane (Q_d), and Historical Feedback Ledger (Q_f):
 *   Q_total = W_s * Q_s + W_d * Q_d + W_f * Q_f.
 * Dependencies & Triggers: Consumes static-quality-model, dynamic-types, and dynamic-quality-scorer;
 *   consumed by reportBuilder, CLI, and change-quality arbiter.
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

/**
 * Resolves context-adaptive tri-plane weights W = f(Stage, Scale, Domain, Risk).
 *
 * @param profile - Contextual project profile parameters.
 * @param hasDynamicEvidence - Whether genuine dynamic telemetry was ingested.
 * @returns Normalized FusionWeights summing to 1.0.
 */
export function resolveAdaptiveFusionWeights(
    profile: GovernanceProjectProfile = {},
    hasDynamicEvidence = true,
): FusionWeights {
    if (!hasDynamicEvidence) {
        // When dynamic telemetry is absent, static carries primary burden
        return { Ws: 0.85, Wd: 0.0, Wf: 0.15 };
    }

    const domain = profile.domain ?? 'core_framework';
    const stage = profile.stage ?? 'production';

    let Ws = 0.5;
    let Wd = 0.35;
    let Wf = 0.15;

    // Domain adjustments
    switch (domain) {
        case 'core_framework':
            Ws = 0.55;
            Wd = 0.3;
            Wf = 0.15;
            break;
        case 'algorithm_lib':
            Ws = 0.35;
            Wd = 0.5;
            Wf = 0.15;
            break;
        case 'business_app':
            Ws = 0.4;
            Wd = 0.35;
            Wf = 0.25;
            break;
        case 'cli_tool':
            Ws = 0.6;
            Wd = 0.25;
            Wf = 0.15;
            break;
    }

    // Stage adjustments
    if (stage === 'prototype') {
        Ws = 0.7;
        Wd = 0.2;
        Wf = 0.1;
    } else if (stage === 'industrial_infrastructure') {
        Ws = 0.45;
        Wd = 0.4;
        Wf = 0.15;
    }

    // Normalize so sum == 1.0
    const sum = Ws + Wd + Wf;
    return {
        Ws: Math.round((Ws / sum) * 100) / 100,
        Wd: Math.round((Wd / sum) * 100) / 100,
        Wf: Math.round((Wf / sum) * 100) / 100,
    };
}

/**
 * Computes the unified tri-plane quality score:
 * Q_total = W_s * Q_s + W_d * Q_d + W_f * Q_f
 *
 * @param staticVector - 7-axis Static Quality Vector.
 * @param dynamicVector - Optional 5-axis Dynamic Quality Vector.
 * @param historicalScore - Historical reliability / zero-incident score (default: 100.0).
 * @param profile - Contextual project profile for adaptive weighting.
 * @returns Fully explained UnifiedQualityAssessment.
 */
export function computeUnifiedQualityScore(
    staticVector: StaticQualityVector,
    dynamicVector?: DynamicQualityVector,
    historicalScore = 100.0,
    profile: GovernanceProjectProfile = {},
): UnifiedQualityAssessment {
    const hasDynamic = dynamicVector !== undefined;
    const weights = resolveAdaptiveFusionWeights(profile, hasDynamic);

    const staticScore = computeStaticQualityScore(staticVector);
    const dynamicScore = dynamicVector ? computeDynamicQualityScore(dynamicVector) : staticScore;
    const feedbackScore = Math.max(0.0, Math.min(100.0, historicalScore));

    const totalRaw =
        weights.Ws * staticScore +
        weights.Wd * dynamicScore +
        weights.Wf * feedbackScore;

    const totalScore = Math.round(totalRaw * 10) / 10;

    const explanation =
        `Unified quality synthesized: Q_total=${totalScore} ` +
        `[Static (${(weights.Ws * 100).toFixed(0)}%): ${staticScore}, ` +
        `Dynamic (${(weights.Wd * 100).toFixed(0)}%): ${dynamicScore}, ` +
        `Feedback (${(weights.Wf * 100).toFixed(0)}%): ${feedbackScore}]`;

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
