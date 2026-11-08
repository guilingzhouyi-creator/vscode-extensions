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
import { THEORETICAL_SCORE_CEILING } from './scorer-formulas';

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

/** Pillar token for structural layering, coupling, and dependency direction. */
export const PILLAR_ARCHITECTURE: PrimaryQualityPillar = 'architecture';
/** Pillar token for readability, module size, and duplication pressure. */
export const PILLAR_MAINTAINABILITY: PrimaryQualityPillar = 'maintainability';
/** Pillar token for hot-path efficiency, allocation discipline, and I/O blocking. */
export const PILLAR_PERFORMANCE: PrimaryQualityPillar = 'performance';
/** Pillar token for schema modeling, persistence boundaries, and fixture integrity. */
export const PILLAR_DATA: PrimaryQualityPillar = 'data';
/** Pillar token for test coverage shape, determinism, and regression guarding. */
export const PILLAR_TESTING: PrimaryQualityPillar = 'testing';
/** Pillar token for failure containment, crash safety, and semantic purity. */
export const PILLAR_RELIABILITY: PrimaryQualityPillar = 'reliability';
/** Pillar token for vulnerability class, secret exposure, and input trust boundaries. */
export const PILLAR_SECURITY: PrimaryQualityPillar = 'security';
/** Pillar token for extension seams, configuration-driven variation, and plugin surface. */
export const PILLAR_EXTENSIBILITY: PrimaryQualityPillar = 'extensibility';

/**
 * All eight primary pillars in canonical order.
 */
export const ALL_PRIMARY_PILLARS: readonly PrimaryQualityPillar[] = [
    PILLAR_ARCHITECTURE,
    PILLAR_MAINTAINABILITY,
    PILLAR_PERFORMANCE,
    PILLAR_DATA,
    PILLAR_TESTING,
    PILLAR_RELIABILITY,
    PILLAR_SECURITY,
    PILLAR_EXTENSIBILITY,
] as const;

/**
 * Standard balanced weights across the eight primary pillars (sum = 1.0).
 */
export const DEFAULT_PILLAR_WEIGHTS: Record<PrimaryQualityPillar, number> = {
    [PILLAR_ARCHITECTURE]: 0.15,
    [PILLAR_MAINTAINABILITY]: 0.15,
    [PILLAR_PERFORMANCE]: 0.15,
    [PILLAR_DATA]: 0.1,
    [PILLAR_TESTING]: 0.15,
    [PILLAR_RELIABILITY]: 0.1,
    [PILLAR_SECURITY]: 0.1,
    [PILLAR_EXTENSIBILITY]: 0.1,
};

/**
 * Mapping from the 10 fine-grained dimensions to the 8 primary legacy pillars.
 * Note: Ten-Dimensional Quality Space is the SSOT primary governance standard.
 */
export const DIMENSION_TO_PILLAR_MAP: Record<QualityDimension, PrimaryQualityPillar> = {
    architectureConsistency: PILLAR_ARCHITECTURE,
    maintainability: PILLAR_MAINTAINABILITY,
    performanceEfficiency: PILLAR_PERFORMANCE,
    codeSecurity: PILLAR_SECURITY,
    semanticPurity: PILLAR_RELIABILITY,
    techDebtRisk: PILLAR_RELIABILITY,
    standardization: PILLAR_EXTENSIBILITY,
    commentQuality: PILLAR_EXTENSIBILITY,
    duplication: PILLAR_EXTENSIBILITY,
    modernity: PILLAR_EXTENSIBILITY,
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
 * Aggregation mode that multiplies pillar scores through a geometric mean.
 *
 * A single weak pillar drags the composite down far more than the arithmetic mean would allow,
 * which is what keeps one fatal deficiency from being diluted by seven strong pillars.
 */
export const AGGREGATION_MODE_GEOMETRIC = 'geometric';
/** Aggregation mode that averages pillar scores with equal weight. */
export const AGGREGATION_MODE_ARITHMETIC = 'arithmetic';
/** Aggregation mode applied when the caller does not select one explicitly. */
export const DEFAULT_AGGREGATION_MODE = 'geometric';

const PILLAR_SCORE_ROUND_FACTOR = 100;
const COMPOSITE_PILLAR_INDEX_FLOOR = 15;

/**
 * Synthesize eight primary pillar scores from fine-grained dimension indices.
 *
 * @param indices - Fine-grained 10-dimension score indices.
 * @param dataScoreOverride - Optional override for the data pillar score.
 * @param testingScoreOverride - Optional override for the testing pillar score.
 * @param ceilings - Optional ceiling constraints to cap pillars for fatal issues.
 * @param customWeights - Optional custom pillar weight overrides.
 * @param aggregationMode - Aggregation strategy ('geometric' | 'arithmetic', default: 'geometric').
 * @returns Complete eight-pillar breakdown and synthesized composite score.
 */
export function synthesizeEightPillars(
    indices: Record<QualityDimension, number>,
    dataScoreOverride?: number,
    testingScoreOverride?: number,
    ceilings: PillarCeilingConstraint[] = [],
    customWeights: Partial<Record<PrimaryQualityPillar, number>> = {},
    aggregationMode: 'geometric' | 'arithmetic' = DEFAULT_AGGREGATION_MODE,
): EightPillarBreakdown {
    const weights: Record<PrimaryQualityPillar, number> = {
        ...DEFAULT_PILLAR_WEIGHTS,
        ...customWeights,
    };

    // The data pillar previously defaulted to `architectureConsistency`, which has no
    // QualityDimension of its own. Combined with `architecture: 0.15` that gave one ten-
    // dimension index an effective 0.25 weight — more than any real axis — while the
    // dimensions that actually describe data quality were counted at a third of that. It now
    // derives from the axes that do describe it: duplication (repeated literals and code) and
    // semantic purity (data and constant handling).
    const pillarBuckets: Record<PrimaryQualityPillar, number[]> = {
        architecture: [indices.architectureConsistency],
        maintainability: [indices.maintainability],
        performance: [indices.performanceEfficiency],
        data: [dataScoreOverride ?? indices.duplication, indices.semanticPurity],
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
        const sumValues = values.reduce((sum, valueScore) => sum + valueScore, 0);
        const averageScore = sumValues / values.length;
        pillars[pillar] = Math.min(
            THEORETICAL_SCORE_CEILING,
            Math.round(averageScore * PILLAR_SCORE_ROUND_FACTOR) / PILLAR_SCORE_ROUND_FACTOR,
        );
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
    let logSum = 0;
    for (const pillar of ALL_PRIMARY_PILLARS) {
        const weight = weights[pillar];
        weightedSum += pillars[pillar] * weight;
        const boundedScore = Math.max(
            COMPOSITE_PILLAR_INDEX_FLOOR,
            Math.min(THEORETICAL_SCORE_CEILING, pillars[pillar]),
        );
        logSum += weight * Math.log(boundedScore);
        totalWeight += weight;
    }

    let rawScore = THEORETICAL_SCORE_CEILING;
    if (totalWeight > 0) {
        const scoreVal =
            aggregationMode === AGGREGATION_MODE_GEOMETRIC
                ? Math.exp(logSum / totalWeight)
                : weightedSum / totalWeight;
        rawScore = Math.round(scoreVal * PILLAR_SCORE_ROUND_FACTOR) / PILLAR_SCORE_ROUND_FACTOR;
    }
    const compositeScore = Math.min(THEORETICAL_SCORE_CEILING, rawScore);

    return {
        pillars,
        compositeScore,
        weights,
        ceilingsApplied: appliedCeilings,
    };
}
