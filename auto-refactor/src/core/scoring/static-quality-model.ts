/**
 * Module: Core Scoring — Static Analysis Plane Quality Model & Confidence Quantification
 * File Path: src/core/scoring/static-quality-model.ts
 * Architecture Role: Single source of truth for the Static Analysis Plane (SAP) mathematical
 *   model; formalizes the 7-dimensional static quality vector Q_s = (A, M, P, D, T, R, E),
 *   static risk confidence formulation S_i = P_i * C_i * I_i, vector space deltas, and
 *   inter-plane projection from fine-grained 10-dimension indicators.
 * Dependencies & Triggers: Consumes Issue and IssueReach from ../types and riskWeightModel,
 *   QualityDimension from ./scoringTypes; consumed by hierarchicalScorer, patchQuality,
 *   and feedback fusion engine.
 * Responsibilities:
 *   1. Define StaticQualityAxis and StaticQualityVector Q_s = (A, M, P, D, T, R, E).
 *   2. Synthesize Q_s from fine-grained dimension indices with optional domain overrides.
 *   3. Calculate static issue risk S_i = P_i * C_i * I_i with reach-aware blast radius.
 *   4. Compute vector deltas, Euclidean distances, and cosine similarities between revisions.
 * Exit Semantics & Design Rationale: Bounded [-100.0, 100.0] score space and [0.0, 1.0] confidence;
 *   zero external I/O; deterministic mathematical operators with 100% explainable audit trails.
 */

import type { Issue } from '../types';
import type { QualityDimension } from './scoringTypes';
import type { PrimaryQualityPillar } from './eightPillarModel';
import type { IssueReach } from './riskWeightModel';
import { mapRuleToPrimaryPillar, REACH_FACTORS } from './riskWeightModel';

export const DEFAULT_STATIC_SCORE_CEILING = 100.0;
export const DEFAULT_STATIC_SCORE_FLOOR = -DEFAULT_STATIC_SCORE_CEILING;

const SCORE_ROUND_FACTOR = 100;
const COSINE_ROUND_FACTOR = 1000;

const PROBABILITY_MIN = 0.1;
const PROBABILITY_MAX = 1.0;
const RISK_SCALE_MAX = 10.0;
const DEFAULT_IMPACT_FACTOR = 2.0;

const REACH_FACTOR_LOCAL = 1.0;
const REACH_FACTOR_FILE = 2.5;
const REACH_FACTOR_CROSS_DOMAIN = 7.5;

const CONFIDENCE_GRAPH = 1.0;
const CONFIDENCE_AST = 0.9;
const CONFIDENCE_STRUCTURAL = 0.85;
const CONFIDENCE_DEFAULT = 0.8;
const CONFIDENCE_HEURISTIC = 0.75;

const DATA_AXIS_DIVISOR = 2;
const EXTENSIBILITY_AXIS_DIVISOR = 3;

/**
 * Seven primary strategic axes for the Static Analysis Plane (SAP):
 * - A: Architecture Quality (boundaries, layering, dependency direction)
 * - M: Maintainability (cognitive complexity, cyclomatic complexity, coupling)
 * - P: Algorithms & Performance (nested loops, transient heap allocations)
 * - D: Data Architecture (types, DTO schemas, parameter clumps)
 * - T: Test Quality (assertion density, modern test semantics)
 * - R: Reliability (error flow, exception guards, resource release)
 * - S: Security Quality (vulnerability defense, safe input handling, secrets hygiene)
 * - E: Extensibility (modularity, literal policy, configuration decoupling)
 */
export type StaticQualityAxis = 'A' | 'M' | 'P' | 'D' | 'T' | 'R' | 'S' | 'E';

/**
 * Ordered enumeration of all eight static quality axes in canonical sequence.
 */
export const ALL_STATIC_QUALITY_AXES: readonly StaticQualityAxis[] = [
    'A',
    'M',
    'P',
    'D',
    'T',
    'R',
    'S',
    'E',
] as const;

const AXIS_NAME_ARCHITECTURE = 'architectureQuality';
const AXIS_NAME_MAINTAINABILITY = 'maintainability';
const AXIS_NAME_PERFORMANCE = 'algorithmAndPerformance';
const AXIS_NAME_DATA = 'dataArchitecture';
const AXIS_NAME_TEST = 'testQuality';
const AXIS_NAME_RELIABILITY = 'reliability';
const AXIS_NAME_SECURITY = 'securityQuality';
const AXIS_NAME_EXTENSIBILITY = 'extensibility';

/**
 * Full descriptive names for each static quality axis.
 */
export const STATIC_AXIS_NAMES: Readonly<Record<StaticQualityAxis, string>> = {
    A: AXIS_NAME_ARCHITECTURE,
    M: AXIS_NAME_MAINTAINABILITY,
    P: AXIS_NAME_PERFORMANCE,
    D: AXIS_NAME_DATA,
    T: AXIS_NAME_TEST,
    R: AXIS_NAME_RELIABILITY,
    S: AXIS_NAME_SECURITY,
    E: AXIS_NAME_EXTENSIBILITY,
};

/**
 * Eight-dimensional static quality vector Q_s = (A, M, P, D, T, R, S, E).
 * Each dimension is scaled between 0.0 and 100.0.
 */
export interface StaticQualityVector {
    /** A: Architecture Quality */
    A: number;
    /** M: Maintainability */
    M: number;
    /** P: Algorithms & Performance */
    P: number;
    /** D: Data Architecture */
    D: number;
    /** T: Test Quality */
    T: number;
    /** R: Reliability */
    R: number;
    /** S: Security Quality */
    S: number;
    /** E: Extensibility */
    E: number;
}

/**
 * Balanced default weights for the static quality vector, aligned with the eight primary
 * pillars (sum = 1.0).
 */
export const DEFAULT_STATIC_WEIGHTS: Readonly<Record<StaticQualityAxis, number>> = {
    A: 0.15,
    M: 0.15,
    P: 0.15,
    D: 0.10,
    T: 0.15,
    R: 0.10,
    S: 0.10,
    E: 0.10,
};

/**
 * Configuration options for evaluating single-issue static risk S_i = P_i * C_i * I_i.
 */
export interface StaticRiskOptions {
    /** P_i: Rule trigger probability (0.0 < P_i <= 1.0), default 1.0 */
    ruleProbability?: number;
    /** C_i: Semantic analysis confidence (0.0 < C_i <= 1.0), default derived from analyzer */
    semanticConfidence?: number;
    /** I_i: Impact scope / blast radius (1.0 <= I_i <= 10.0), default derived from reach */
    impactScope?: IssueReach | number;
}

/**
 * Quantified static risk evaluation for an individual issue.
 */
export interface StaticIssueRisk {
    issueId: string;
    rule: string;
    /** P_i: Rule trigger probability */
    P: number;
    /** C_i: Semantic analysis confidence */
    C: number;
    /** I_i: Impact scope */
    I: number;
    /** Raw calculated risk: S_i = P_i * C_i * I_i */
    rawRisk: number;
    /** Normalized risk on standard scale [0.0, 10.0] */
    normalizedRisk: number;
    /** Associated static quality axis */
    affectedAxis: StaticQualityAxis;
}

/**
 * Maps a PrimaryQualityPillar to its corresponding StaticQualityAxis.
 *
 * @param pillar - Strategic primary quality pillar.
 * @returns Corresponding single-character StaticQualityAxis.
 */
export function mapPillarToStaticAxis(pillar: PrimaryQualityPillar): StaticQualityAxis {
    switch (pillar) {
        case 'architecture':
            return 'A';
        case 'maintainability':
            return 'M';
        case 'performance':
            return 'P';
        case 'data':
            return 'D';
        case 'testing':
            return 'T';
        case 'reliability':
            return 'R';
        case 'security':
            return 'S';
        case 'extensibility':
            return 'E';
        default:
            return 'R';
    }
}

/**
 * Backward compatibility alias for mapPillarToStaticAxis.
 */
export const pillarToStaticAxis = mapPillarToStaticAxis;

/**
 * Maps an auto-refactor analyzer or rule name to its default semantic confidence C_i.
 */
function resolveDefaultSemanticConfidence(analyzer: string): number {
    switch (analyzer) {
        case 'architecture':
        case 'dependency-graph':
        case 'dependency-layout':
            return CONFIDENCE_GRAPH;
        case 'governance':
        case 'complexity':
        case 'performance':
        case 'data-architecture':
            return CONFIDENCE_AST;
        case 'test-modernity':
        case 'large-file':
            return CONFIDENCE_STRUCTURAL;
        case 'constants':
        case 'hygiene':
        case 'comments':
            return CONFIDENCE_HEURISTIC;
        default:
            return CONFIDENCE_DEFAULT;
    }
}

/**
 * Maps an issue reach or explicit numeric value to its impact factor I_i.
 */
function resolveImpactFactor(scope?: IssueReach | number): number {
    if (typeof scope === 'number') {
        return Math.max(REACH_FACTOR_LOCAL, Math.min(RISK_SCALE_MAX, scope));
    }
    if (scope && REACH_FACTORS[scope]) {
        switch (scope) {
            case 'local':
                return REACH_FACTOR_LOCAL;
            case 'file':
                return REACH_FACTOR_FILE;
            case 'cross_domain':
                return REACH_FACTOR_CROSS_DOMAIN;
        }
    }
    return DEFAULT_IMPACT_FACTOR;
}

/**
 * Calculates the static risk S_i of a single issue using the confidence model:
 * S_i = P_i * C_i * I_i
 *
 * @param issue - The detected static issue.
 * @param options - Optional override parameters for P_i, C_i, and I_i.
 * @returns Fully quantified StaticIssueRisk assessment.
 */
export function computeStaticIssueRisk(
    issue: Issue,
    options: StaticRiskOptions = {},
): StaticIssueRisk {
    const probabilityScore = Math.max(
        PROBABILITY_MIN,
        Math.min(PROBABILITY_MAX, options.ruleProbability ?? PROBABILITY_MAX),
    );
    const defaultConfidence = resolveDefaultSemanticConfidence(issue.analyzer);
    const confidenceScore = Math.max(
        PROBABILITY_MIN,
        Math.min(PROBABILITY_MAX, options.semanticConfidence ?? defaultConfidence),
    );
    const impactScore = resolveImpactFactor(options.impactScope);

    const rawRisk = probabilityScore * confidenceScore * impactScore;
    const normalizedRisk = Math.min(RISK_SCALE_MAX, rawRisk);
    const pillar = mapRuleToPrimaryPillar(issue.rule);
    const affectedAxis = pillarToStaticAxis(pillar);

    return {
        issueId: issue.id,
        rule: issue.rule,
        P: probabilityScore,
        C: confidenceScore,
        I: impactScore,
        rawRisk,
        normalizedRisk,
        affectedAxis,
    };
}

/**
 * Synthesizes the 7-dimensional Static Quality Vector Q_s = (A, M, P, D, T, R, E)
 * from the fine-grained 10-dimension index map.
 *
 * @param indices - Fine-grained 10-dimension quality indices [0.0, 100.0].
 * @param overrides - Optional direct overrides for specific axes.
 * @returns Normalized 7-dimensional StaticQualityVector.
 */
export function synthesizeStaticQualityVector(
    indices: Record<QualityDimension, number>,
    overrides: Partial<Record<StaticQualityAxis, number>> = {},
): StaticQualityVector {
    const sanitizeScore = (raw: number): number =>
        Math.min(DEFAULT_STATIC_SCORE_CEILING, Math.max(DEFAULT_STATIC_SCORE_FLOOR, raw));

    const architectureScore = sanitizeScore(overrides.A ?? indices.architectureConsistency);
    const maintainabilityScore = sanitizeScore(overrides.M ?? indices.maintainability);
    const performanceScore = sanitizeScore(overrides.P ?? indices.performanceEfficiency);

    // D: Data Architecture derives from axes describing data quality and purity
    const dataArchitectureScore = sanitizeScore(
        overrides.D ?? (indices.duplication + indices.semanticPurity) / DATA_AXIS_DIVISOR,
    );

    // T: Test Quality maps to modernity
    const testQualityScore = sanitizeScore(overrides.T ?? indices.modernity);

    // R: Reliability synthesizes semantic purity and tech-debt risk
    const reliabilityScore = sanitizeScore(
        overrides.R ?? (indices.semanticPurity + indices.techDebtRisk) / DATA_AXIS_DIVISOR,
    );

    // S: Security Quality maps to codeSecurity
    const securityScore = sanitizeScore(overrides.S ?? indices.codeSecurity);

    // E: Extensibility synthesizes standardization, comment quality, and duplication
    const extensibilityScore = sanitizeScore(
        overrides.E ??
            (indices.standardization + indices.commentQuality + indices.duplication) /
                EXTENSIBILITY_AXIS_DIVISOR,
    );

    return {
        A: Math.round(architectureScore * SCORE_ROUND_FACTOR) / SCORE_ROUND_FACTOR,
        M: Math.round(maintainabilityScore * SCORE_ROUND_FACTOR) / SCORE_ROUND_FACTOR,
        P: Math.round(performanceScore * SCORE_ROUND_FACTOR) / SCORE_ROUND_FACTOR,
        D: Math.round(dataArchitectureScore * SCORE_ROUND_FACTOR) / SCORE_ROUND_FACTOR,
        T: Math.round(testQualityScore * SCORE_ROUND_FACTOR) / SCORE_ROUND_FACTOR,
        R: Math.round(reliabilityScore * SCORE_ROUND_FACTOR) / SCORE_ROUND_FACTOR,
        S: Math.round(securityScore * SCORE_ROUND_FACTOR) / SCORE_ROUND_FACTOR,
        E: Math.round(extensibilityScore * SCORE_ROUND_FACTOR) / SCORE_ROUND_FACTOR,
    };
}

/**
 * Computes the scalar static composite quality score Q_s_total from a StaticQualityVector.
 *
 * @param vector - 7-dimensional StaticQualityVector.
 * @param weights - Optional customized axis weights.
 * @returns Weighted static score [0.0, 100.0].
 */
export function computeStaticQualityScore(
    vector: StaticQualityVector,
    weights: Partial<Record<StaticQualityAxis, number>> = {},
): number {
    const mergedWeights = { ...DEFAULT_STATIC_WEIGHTS, ...weights };
    let weightSum = 0;
    let weightedScore = 0;

    for (const axis of ALL_STATIC_QUALITY_AXES) {
        const w = mergedWeights[axis] ?? 0;
        weightSum += w;
        weightedScore += vector[axis] * w;
    }

    const rawScore = weightSum <= 0 ? 0 : weightedScore / weightSum;
    return Math.round(rawScore * SCORE_ROUND_FACTOR) / SCORE_ROUND_FACTOR;
}

/**
 * Pre-calibrated Precision Matrix P_8 in R^(8x8) for the 8-axis static quality vector Q_s.
 * Inverts the empirical covariance between Architecture, Maintainability, Performance, Data,
 * Testing, Reliability, Security, and Extensibility to eliminate collinearity in distance metrics.
 */
const STATIC_QUALITY_PRECISION_MATRIX_8X8: readonly (readonly number[])[] = [
    [0.00725072, -0.0024297, 0.00008305, -0.00206602, 0.00046567, -0.00148577, 0.00044333, -0.00179392],
    [-0.0024297, 0.00612729, -0.00053356, 0.00048177, -0.00095561, 0.00048988, -0.00035644, -0.00108528],
    [0.00008305, -0.00053356, 0.00464179, -0.00034919, -0.00023069, -0.00021691, -0.00025382, -0.0002056],
    [-0.00206602, 0.00048177, -0.00034919, 0.00518974, -0.00041313, 0.00022302, -0.00039677, 0.00023242],
    [0.00046567, -0.00095561, -0.00023069, -0.00041313, 0.00496588, -0.00123125, 0.00012664, -0.00017355],
    [-0.00148577, 0.00048988, -0.00021691, 0.00022302, -0.00123125, 0.00592273, -0.00216394, 0.00016948],
    [0.00044333, -0.00035644, -0.00025382, -0.00039677, 0.00012664, -0.00216394, 0.00538596, -0.00032238],
    [-0.00179392, -0.00108528, -0.0002056, 0.00023242, -0.00017355, 0.00016948, -0.00032238, 0.00557182],
] as const;

const STATIC_SCORE_SCALE_REF = 15.0;

/**
 * Metric comparison between two StaticQualityVectors (Before -> After).
 */
export interface StaticVectorDelta {
    deltaVector: StaticQualityVector;
    scalarDelta: number;
    euclideanDistance: number;
    cosineSimilarity: number;
    mahalanobisDistance?: number;
    dominantShiftAxis?: StaticQualityAxis;
}

/**
 * Computes vector difference, Euclidean distance, and cosine similarity between two static states.
 *
 * @param before - Previous static quality vector.
 * @param after - Subsequent static quality vector.
 * @returns Comprehensive StaticVectorDelta.
 */
export function computeStaticVectorDelta(
    before: StaticQualityVector,
    after: StaticQualityVector,
): StaticVectorDelta {
    const deltaVector: StaticQualityVector = {
        A: Math.round((after.A - before.A) * SCORE_ROUND_FACTOR) / SCORE_ROUND_FACTOR,
        M: Math.round((after.M - before.M) * SCORE_ROUND_FACTOR) / SCORE_ROUND_FACTOR,
        P: Math.round((after.P - before.P) * SCORE_ROUND_FACTOR) / SCORE_ROUND_FACTOR,
        D: Math.round((after.D - before.D) * SCORE_ROUND_FACTOR) / SCORE_ROUND_FACTOR,
        T: Math.round((after.T - before.T) * SCORE_ROUND_FACTOR) / SCORE_ROUND_FACTOR,
        R: Math.round((after.R - before.R) * SCORE_ROUND_FACTOR) / SCORE_ROUND_FACTOR,
        S: Math.round((after.S - before.S) * SCORE_ROUND_FACTOR) / SCORE_ROUND_FACTOR,
        E: Math.round((after.E - before.E) * SCORE_ROUND_FACTOR) / SCORE_ROUND_FACTOR,
    };

    let sumDiffSq = 0;
    let dotProduct = 0;
    let normBeforeSq = 0;
    let normAfterSq = 0;

    for (const axis of ALL_STATIC_QUALITY_AXES) {
        const b = before[axis];
        const a = after[axis];
        const diff = a - b;
        sumDiffSq += diff * diff;
        dotProduct += b * a;
        normBeforeSq += b * b;
        normAfterSq += a * a;
    }

    const euclideanDistance =
        Math.round(Math.sqrt(sumDiffSq) * SCORE_ROUND_FACTOR) / SCORE_ROUND_FACTOR;
    const denominator = Math.sqrt(normBeforeSq) * Math.sqrt(normAfterSq);
    const cosineSimilarity =
        denominator > 0
            ? Math.round((dotProduct / denominator) * COSINE_ROUND_FACTOR) / COSINE_ROUND_FACTOR
            : 1.0;

    const scalarDelta =
        Math.round(
            (computeStaticQualityScore(after) - computeStaticQualityScore(before)) *
                SCORE_ROUND_FACTOR,
        ) / SCORE_ROUND_FACTOR;

    const diffs: readonly number[] = [
        after.A - before.A,
        after.M - before.M,
        after.P - before.P,
        after.D - before.D,
        after.T - before.T,
        after.R - before.R,
        after.S - before.S,
        after.E - before.E,
    ];

    let quadForm = 0;
    let maxShift = -1;
    let dominantShiftAxis: StaticQualityAxis = 'A';

    for (let i = 0; i < 8; i++) {
        const absDiff = Math.abs(diffs[i]);
        if (absDiff > maxShift) {
            maxShift = absDiff;
            dominantShiftAxis = ALL_STATIC_QUALITY_AXES[i];
        }
        const row = STATIC_QUALITY_PRECISION_MATRIX_8X8[i];
        for (let j = 0; j < 8; j++) {
            quadForm += diffs[i] * row[j] * diffs[j];
        }
    }

    const mahalanobisDistance =
        Math.round(Math.sqrt(Math.max(0, quadForm)) * STATIC_SCORE_SCALE_REF * SCORE_ROUND_FACTOR) /
        SCORE_ROUND_FACTOR;

    return {
        deltaVector,
        scalarDelta,
        euclideanDistance,
        cosineSimilarity,
        mahalanobisDistance,
        dominantShiftAxis,
    };
}
