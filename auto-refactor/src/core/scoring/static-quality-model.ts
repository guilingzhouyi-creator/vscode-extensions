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
 * Exit Semantics & Design Rationale: Bounded [0.0, 100.0] score space and [0.0, 1.0] confidence;
 *   zero external I/O; deterministic mathematical operators with 100% explainable audit trails.
 */

import type { Issue } from '../types';
import type { QualityDimension } from './scoringTypes';
import type { PrimaryQualityPillar } from './eightPillarModel';
import type { IssueReach } from './riskWeightModel';
import { mapRuleToPrimaryPillar, REACH_FACTORS } from './riskWeightModel';

/**
 * Seven primary strategic axes for the Static Analysis Plane (SAP):
 * - A: Architecture Quality (boundaries, layering, dependency direction)
 * - M: Maintainability (cognitive complexity, cyclomatic complexity, coupling)
 * - P: Algorithms & Performance (nested loops, transient heap allocations)
 * - D: Data Architecture (types, DTO schemas, parameter clumps)
 * - T: Test Quality (assertion density, modern test semantics)
 * - R: Reliability (error flow, exception guards, resource release)
 * - E: Extensibility (modularity, literal policy, configuration decoupling)
 */
export type StaticQualityAxis = 'A' | 'M' | 'P' | 'D' | 'T' | 'R' | 'E';

/**
 * Ordered enumeration of all seven static quality axes in canonical sequence.
 */
export const ALL_STATIC_QUALITY_AXES: readonly StaticQualityAxis[] = [
    'A',
    'M',
    'P',
    'D',
    'T',
    'R',
    'E',
] as const;

/**
 * Full descriptive names for each static quality axis.
 */
export const STATIC_AXIS_NAMES: Readonly<Record<StaticQualityAxis, string>> = {
    A: 'architectureQuality',
    M: 'maintainability',
    P: 'algorithmAndPerformance',
    D: 'dataArchitecture',
    T: 'testQuality',
    R: 'reliability',
    E: 'extensibility',
};

/**
 * Seven-dimensional static quality vector Q_s = (A, M, P, D, T, R, E).
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
    /** E: Extensibility */
    E: number;
}

/**
 * Balanced default weights for the static quality vector (sum = 1.0).
 */
export const DEFAULT_STATIC_WEIGHTS: Readonly<Record<StaticQualityAxis, number>> = {
    A: 0.18,
    M: 0.18,
    P: 0.16,
    D: 0.12,
    T: 0.12,
    R: 0.12,
    E: 0.12,
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
export function pillarToStaticAxis(pillar: PrimaryQualityPillar): StaticQualityAxis {
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
        case 'security':
            return 'R';
        case 'extensibility':
            return 'E';
        default:
            return 'R';
    }
}

/**
 * Maps an auto-refactor analyzer or rule name to its default semantic confidence C_i.
 */
function resolveDefaultSemanticConfidence(analyzer: string): number {
    switch (analyzer) {
        case 'architecture':
        case 'dependency-graph':
        case 'dependency-layout':
            return 1.0; // Whole-system graph resolution
        case 'governance':
        case 'complexity':
        case 'performance':
        case 'data-architecture':
            return 0.9; // AST & control-flow analysis
        case 'test-modernity':
        case 'large-file':
            return 0.85; // Structural metric evaluation
        case 'constants':
        case 'hygiene':
        case 'comments':
            return 0.75; // Heuristic / pattern matching
        default:
            return 0.8;
    }
}

/**
 * Maps an issue reach or explicit numeric value to its impact factor I_i.
 */
function resolveImpactFactor(scope?: IssueReach | number): number {
    if (typeof scope === 'number') {
        return Math.max(1.0, Math.min(10.0, scope));
    }
    if (scope && REACH_FACTORS[scope]) {
        // Map local (1.0), file (1.5), cross_domain (2.5) to blast radius scale [1.0, 8.0]
        switch (scope) {
            case 'local':
                return 1.0;
            case 'file':
                return 2.5;
            case 'cross_domain':
                return 7.5;
        }
    }
    return 2.0; // Default file-level reach
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
    const P = Math.max(0.1, Math.min(1.0, options.ruleProbability ?? 1.0));
    const defaultConfidence = resolveDefaultSemanticConfidence(issue.analyzer);
    const C = Math.max(0.1, Math.min(1.0, options.semanticConfidence ?? defaultConfidence));
    const I = resolveImpactFactor(options.impactScope);

    const rawRisk = P * C * I;
    const normalizedRisk = Math.min(10.0, rawRisk);
    const pillar = mapRuleToPrimaryPillar(issue.rule);
    const affectedAxis = pillarToStaticAxis(pillar);

    return {
        issueId: issue.id,
        rule: issue.rule,
        P,
        C,
        I,
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
    const A = overrides.A ?? indices.architectureConsistency;
    const M = overrides.M ?? indices.maintainability;
    const P = overrides.P ?? indices.performanceEfficiency;

    // D: Data Architecture defaults to architectureConsistency or data metrics
    const D = overrides.D ?? indices.architectureConsistency;

    // T: Test Quality maps to modernity
    const T = overrides.T ?? indices.modernity;

    // R: Reliability synthesizes semantic purity and tech-debt risk
    const R =
        overrides.R ??
        Math.min(100.0, Math.max(0.0, (indices.semanticPurity + indices.techDebtRisk) / 2));

    // E: Extensibility synthesizes standardization, comment quality, and duplication
    const E =
        overrides.E ??
        Math.min(
            100.0,
            Math.max(
                0.0,
                (indices.standardization + indices.commentQuality + indices.duplication) / 3,
            ),
        );

    return {
        A: Math.round(A * 10) / 10,
        M: Math.round(M * 10) / 10,
        P: Math.round(P * 10) / 10,
        D: Math.round(D * 10) / 10,
        T: Math.round(T * 10) / 10,
        R: Math.round(R * 10) / 10,
        E: Math.round(E * 10) / 10,
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

    if (weightSum <= 0) return 0;
    return Math.round((weightedScore / weightSum) * 10) / 10;
}

/**
 * Metric comparison between two StaticQualityVectors (Before -> After).
 */
export interface StaticVectorDelta {
    deltaVector: StaticQualityVector;
    scalarDelta: number;
    euclideanDistance: number;
    cosineSimilarity: number;
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
        A: Math.round((after.A - before.A) * 10) / 10,
        M: Math.round((after.M - before.M) * 10) / 10,
        P: Math.round((after.P - before.P) * 10) / 10,
        D: Math.round((after.D - before.D) * 10) / 10,
        T: Math.round((after.T - before.T) * 10) / 10,
        R: Math.round((after.R - before.R) * 10) / 10,
        E: Math.round((after.E - before.E) * 10) / 10,
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

    const euclideanDistance = Math.round(Math.sqrt(sumDiffSq) * 100) / 100;
    const denominator = Math.sqrt(normBeforeSq) * Math.sqrt(normAfterSq);
    const cosineSimilarity =
        denominator > 0 ? Math.round((dotProduct / denominator) * 1000) / 1000 : 1.0;

    const scalarDelta =
        Math.round((computeStaticQualityScore(after) - computeStaticQualityScore(before)) * 10) /
        10;

    return {
        deltaVector,
        scalarDelta,
        euclideanDistance,
        cosineSimilarity,
    };
}
