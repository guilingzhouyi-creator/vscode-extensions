/**
 * Module: Core Scoring — Eight-Pillar Primary Quality Model
 * File Path: src/core/scoring/eightPillarModel.ts
 * Architecture Role: High-level executive quality index synthesizing the fine-grained
 *   dimensions into 8 primary strategic pillars: Architecture, Maintainability, Performance,
 *   Data, Testing, Reliability, Security, and Extensibility.
 * Dependencies & Triggers: Consumes QualityDimension from ./scoringTypes.
 * Responsibilities: Define PrimaryQualityPillar, default weights, synthesis functions,
 *   and pillar ceiling constraints.
 * Exit Semantics & Design Rationale: Bounded 0.0-100.0 score space with zero black-box magic.
 */

import type { QualityDimension } from './scoringTypes';

/**
 * Eight primary architectural pillars for executive code health evaluation.
 */
export type PrimaryQualityPillar =
    | 'architecture'
    | 'maintainability'
    | 'performance'
    | 'data'
    | 'testing'
    | 'reliability'
    | 'security'
    | 'extensibility';

/**
 * All eight primary pillars in canonical order.
 */
export const ALL_PRIMARY_PILLARS: readonly PrimaryQualityPillar[] = [
    'architecture',
    'maintainability',
    'performance',
    'data',
    'testing',
    'reliability',
    'security',
    'extensibility',
] as const;

/**
 * Standard balanced weights across the eight primary pillars (sum = 1.0).
 */
export const DEFAULT_PILLAR_WEIGHTS: Record<PrimaryQualityPillar, number> = {
    architecture: 0.15,
    maintainability: 0.15,
    performance: 0.15,
    data: 0.1,
    testing: 0.15,
    reliability: 0.1,
    security: 0.1,
    extensibility: 0.1,
};

/**
 * Mapping from the 10 fine-grained dimensions to the 8 primary pillars.
 */
export const DIMENSION_TO_PILLAR_MAP: Record<QualityDimension, PrimaryQualityPillar> = {
    architectureConsistency: 'architecture',
    maintainability: 'maintainability',
    performanceEfficiency: 'performance',
    codeSecurity: 'security',
    semanticPurity: 'reliability',
    techDebtRisk: 'reliability',
    standardization: 'extensibility',
    commentQuality: 'extensibility',
    duplication: 'extensibility',
    modernity: 'testing',
};

/**
 * Breakdown of scores across the eight pillars.
 */
export interface EightPillarBreakdown {
    pillars: Record<PrimaryQualityPillar, number>;
    compositeScore: number;
    weights: Record<PrimaryQualityPillar, number>;
    ceilingsApplied: { pillar: PrimaryQualityPillar; maxScore: number; reason: string }[];
}

/**
 * Pillar ceiling constraint to prevent dilution of fatal errors.
 */
export interface PillarCeilingConstraint {
    pillar: PrimaryQualityPillar;
    maxScore: number;
    reason: string;
}

/**
 * Synthesize eight primary pillar scores from fine-grained dimension indices.
 *
 * @param indices - Fine-grained 10-dimension score indices.
 * @param dataScoreOverride - Optional override for the data pillar score.
 * @param testingScoreOverride - Optional override for the testing pillar score.
 * @param ceilings - Optional ceiling constraints to cap pillars for fatal issues.
 * @param customWeights - Optional custom pillar weight overrides.
 * @returns Complete eight-pillar breakdown and synthesized composite score.
 */
export function synthesizeEightPillars(
    indices: Record<QualityDimension, number>,
    dataScoreOverride?: number,
    testingScoreOverride?: number,
    ceilings: PillarCeilingConstraint[] = [],
    customWeights: Partial<Record<PrimaryQualityPillar, number>> = {},
): EightPillarBreakdown {
    const weights: Record<PrimaryQualityPillar, number> = {
        ...DEFAULT_PILLAR_WEIGHTS,
        ...customWeights,
    };

    const pillarBuckets: Record<PrimaryQualityPillar, number[]> = {
        architecture: [indices.architectureConsistency],
        maintainability: [indices.maintainability],
        performance: [indices.performanceEfficiency],
        data: [dataScoreOverride ?? indices.architectureConsistency],
        testing: [testingScoreOverride ?? indices.modernity],
        reliability: [indices.semanticPurity, indices.techDebtRisk],
        security: [indices.codeSecurity],
        extensibility: [indices.standardization, indices.commentQuality, indices.duplication],
    };

    const pillars: Record<PrimaryQualityPillar, number> = {} as Record<
        PrimaryQualityPillar,
        number
    >;

    for (const pillar of ALL_PRIMARY_PILLARS) {
        const values = pillarBuckets[pillar];
        const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
        pillars[pillar] = Math.round(avg * 10) / 10;
    }

    const appliedCeilings: { pillar: PrimaryQualityPillar; maxScore: number; reason: string }[] =
        [];

    for (const constraint of ceilings) {
        if (pillars[constraint.pillar] > constraint.maxScore) {
            pillars[constraint.pillar] = constraint.maxScore;
            appliedCeilings.push(constraint);
        }
    }

    let totalWeight = 0;
    let weightedSum = 0;
    for (const pillar of ALL_PRIMARY_PILLARS) {
        const w = weights[pillar];
        weightedSum += pillars[pillar] * w;
        totalWeight += w;
    }

    const compositeScore =
        totalWeight > 0 ? Math.round((weightedSum / totalWeight) * 10) / 10 : 100.0;

    return {
        pillars,
        compositeScore,
        weights,
        ceilingsApplied: appliedCeilings,
    };
}
