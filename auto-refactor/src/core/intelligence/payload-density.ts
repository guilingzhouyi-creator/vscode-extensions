/**
 * Module: Core Intelligence — Weighted Token Semantic Payload & Five-Dimensional Density Tensor
 * File Path: src/core/intelligence/payload-density.ts
 * Architecture Role: Higher-order density aggregator, TSPR ratio calculator, function reuse
 *   evaluator, and loop conditional entropy analyzer.
 * Dependencies & Triggers: Consumes ClassifiedToken from ./token-entropy; invoked by quality
 *   scoring pipelines and complexity budget evaluators.
 * Responsibilities: Calculate weighted token semantic payload ratio (TSPR) and plumbing overhead
 *   ratio (POR); evaluate single-use function rate (SUFR) and function reuse density; compute
 *   loop state transition conditional entropy increase and identify tautological loops;
 *   compute composite five-dimensional effective density tensor index.
 * Exit Semantics & Design Rationale: Scale-invariant and formatting-invariant evaluation; pure
 *   functional implementation with zero memory allocation in high-frequency loops; guaranteed
 *   numerical stability across extreme boundary conditions.
 */

import type { Severity } from '../types';
import type { ClassifiedToken } from './token-entropy';
export {
    evaluateSpatialDensityManifold,
    calculateSpatialEffectiveDensity,
    computeMahalanobisDistance,
    computeWhitenedCoordinates,
    computeFisherSimplexDistance,
    computeRefactoringGradient,
    logitTransform,
    inverseLogit,
} from './density-vector-space';
export type {
    DensityAxis,
    DensityVector5D,
    SpatialDensityEvaluation,
    SimplexPoint2D,
} from './density-vector-space';

/** Rule id: token density floor — lines fragmented until each carries almost no payload. */
export const RULE_VOL_TAU_FLOOR = 'VOL-TAU-001';
/** Rule id: token density ceiling — one line packed with more concepts than a reader can hold. */
export const RULE_VOL_TAU_CEILING = 'VOL-TAU-002';

/** Lowest semantic tokens per effective line a module may carry. */
export const MIN_TOKENS_PER_ELOC = 2.5;

/** Highest semantic tokens per effective line a module may carry before a line is congested. */
export const MAX_TOKENS_PER_ELOC = 22.0;

/** Effective lines below which the band carries no signal. */
export const MIN_TAU_SAMPLE_ELOC = 10;

/** One band verdict: which rule fired, at what severity, and how to explain it. */
export interface TokenDensityFinding {
    readonly rule: string;
    readonly severity: Severity;
    readonly message: string;
    readonly suggestion: string;
}

const TAU_SEVERITY_WARNING: Severity = 'warning';
const SUGGESTION_COMPACT =
    'Collapse vertically fragmented calls and declarations onto cohesive statements, and pass four or more parameters as a single parameter object.';
const SUGGESTION_SPLIT =
    'Extract intermediate variables from monolithic chained expressions and spread nested logic across dedicated lines.';

/**
 * Evaluate the token-density band for one module.
 *
 * @param tokensPerEloc - Measured semantic tokens per effective line, or undefined when unmeasured.
 * @param eloc - Effective lines of code the ratio was computed over.
 * @returns The band finding, or null when the module sits inside the band or cannot be judged.
 */
export function evaluateTokenDensityBand(
    tokensPerEloc: number | undefined,
    eloc: number,
): TokenDensityFinding | null {
    if (eloc < MIN_TAU_SAMPLE_ELOC) return null;
    if (tokensPerEloc === undefined || tokensPerEloc <= 0) return null;
    if (tokensPerEloc < MIN_TOKENS_PER_ELOC) {
        return {
            rule: RULE_VOL_TAU_FLOOR,
            severity: TAU_SEVERITY_WARNING,
            message:
                `Token density floor breached: tau = ${tokensPerEloc.toFixed(2)} tokens per effective line, ` +
                `below the ${MIN_TOKENS_PER_ELOC} floor across ${eloc} ELOC.`,
            suggestion: SUGGESTION_COMPACT,
        };
    }
    if (tokensPerEloc > MAX_TOKENS_PER_ELOC) {
        return {
            rule: RULE_VOL_TAU_CEILING,
            severity: TAU_SEVERITY_WARNING,
            message:
                `Token density ceiling breached: tau = ${tokensPerEloc.toFixed(2)} tokens per effective line, ` +
                `above the ${MAX_TOKENS_PER_ELOC} ceiling across ${eloc} ELOC.`,
            suggestion: SUGGESTION_SPLIT,
        };
    }
    return null;
}

/**
 * Weighted token semantic payload ratio (TSPR) and plumbing overhead ratio (POR).
 */
export interface WeightedPayloadMetrics {
    readonly tspr: number;
    readonly por: number;
}

/**
 * Function reuse metrics: single-use function rate and reuse density.
 */
export interface FunctionReuseMetrics {
    readonly sufr: number;
    readonly reuseDensity: number;
}

/**
 * Result of calculating state entropy delta across a loop construct.
 */
export interface LoopStateEntropyResult {
    readonly deltaEntropy: number;
    readonly isTautological: boolean;
}

/**
 * Composite density input vectors for synthesizing overall file density.
 */
export interface CompositeDensityInputs {
    readonly lineDensity: number;
    readonly columnDensity: number;
    readonly reuseDensity: number;
    readonly sharedDensity: number;
    readonly payloadDensity: number;
    readonly entropyFactor: number;
}

/**
 * Calculate Weighted Token Semantic Payload Ratio (TSPR) and Plumbing Overhead Ratio (POR).
 *
 * Format and scale invariant: line wraps, indentation, and whitespace changes do not emit
 * tokens and thus preserve exact mathematical invariance.
 *
 * @param tokens Classified token array.
 * @returns Weighted payload ratio (tspr) and plumbing ratio (por) in [0.0, 1.0].
 */
export function calculateWeightedTokenPayload(
    tokens: readonly ClassifiedToken[],
): WeightedPayloadMetrics {
    const count = tokens.length;
    if (count === 0) {
        return { tspr: 0, por: 0 };
    }

    let semanticWeight = 0;
    let totalWeight = 0;

    for (let i = 0; i < count; i++) {
        const token = tokens[i];
        const weight = token.weight;
        totalWeight += weight;

        if (token.category === 'CALC_FLOW' || token.category === 'DOMAIN_LITERAL') {
            semanticWeight += weight;
        }
    }

    if (totalWeight <= 0) {
        return { tspr: 0, por: 0 };
    }

    const tspr = semanticWeight / totalWeight;
    const por = 1.0 - tspr;

    return {
        tspr: Math.round(Math.min(1.0, Math.max(0.0, tspr)) * 1e6) / 1e6,
        por: Math.round(Math.min(1.0, Math.max(0.0, por)) * 1e6) / 1e6,
    };
}

/**
 * Calculate function reuse metrics including Single-Use Function Rate (SUFR) and Reuse Density.
 *
 * @param fanIns Array of fan-in call counts for all declared functions.
 * @returns SUFR in [0.0, 1.0] and reuse density in [0.0, 1.0].
 */
export function calculateFunctionReuseMetrics(fanIns: readonly number[]): FunctionReuseMetrics {
    const total = fanIns.length;
    if (total === 0) {
        return { sufr: 0, reuseDensity: 0 };
    }

    let singleUseCount = 0;
    for (let i = 0; i < total; i++) {
        if (fanIns[i] <= 1) {
            singleUseCount++;
        }
    }

    const sufr = singleUseCount / total;
    const reuseDensity = 1.0 - sufr;

    return {
        sufr: Math.round(Math.min(1.0, Math.max(0.0, sufr)) * 1e6) / 1e6,
        reuseDensity: Math.round(Math.min(1.0, Math.max(0.0, reuseDensity)) * 1e6) / 1e6,
    };
}

/**
 * Calculate loop state transition algebraic conditional entropy increase.
 *
 * When conditional entropy increase <= 0.05, the loop produces negligible state mutation
 * and is flagged as a tautological form-over-substance loop.
 *
 * @param iterationItemsCount Number of elements or iterations in loop domain.
 * @param stateMutationsCount Count of actual state mutation operations.
 * @param hasSideEffects Whether the loop body invokes external side effects (I/O, emission).
 * @returns deltaEntropy and isTautological flag.
 */
export function calculateLoopStateEntropy(
    iterationItemsCount: number,
    stateMutationsCount: number,
    hasSideEffects: boolean,
): LoopStateEntropyResult {
    if (iterationItemsCount <= 0 || !Number.isFinite(iterationItemsCount)) {
        return { deltaEntropy: 0, isTautological: true };
    }

    const mutationCount = Math.max(
        0,
        Number.isFinite(stateMutationsCount) ? stateMutationsCount : 0,
    );
    if (mutationCount === 0 && !hasSideEffects) {
        return { deltaEntropy: 0, isTautological: true };
    }

    const itemCount = Math.max(1, iterationItemsCount);
    const ratio = Math.min(mutationCount, itemCount) / itemCount;
    const entropyGrowth = ratio * (Math.log2(1.0 + mutationCount) / Math.log2(2.0 + itemCount));
    const sideEffectBonus = hasSideEffects ? 0.2 : 0.0;
    const deltaEntropy = Math.min(1.0, Math.max(0.0, entropyGrowth + sideEffectBonus));

    const isTautological = deltaEntropy <= 0.05;

    return {
        deltaEntropy: Math.round(deltaEntropy * 1e6) / 1e6,
        isTautological,
    };
}

/**
 * Calculate composite five-dimensional effective density tensor index.
 *
 * Five primary dimensions:
 *   1. lineDensity: Line-level compactness
 *   2. columnDensity: Bilateral log-normal column density
 *   3. reuseDensity: Function reuse density
 *   4. sharedDensity: Shared scope / cohesion density
 *   5. payloadDensity: Weighted token semantic payload ratio (TSPR)
 *
 * Modulated by the Goldilocks entropy bandwidth factor:
 *   Composite = Mean(D_1..D_5) * entropyFactor
 *
 * @param metrics Composite density metric inputs.
 * @returns Composite effective density in [0.0, 1.0].
 */
export function calculateCompositeEffectiveDensity(metrics: CompositeDensityInputs): number {
    const lineD = Math.min(
        1.0,
        Math.max(0.0, Number.isFinite(metrics.lineDensity) ? metrics.lineDensity : 0),
    );
    const colD = Math.min(
        1.0,
        Math.max(0.0, Number.isFinite(metrics.columnDensity) ? metrics.columnDensity : 0),
    );
    const reuseD = Math.min(
        1.0,
        Math.max(0.0, Number.isFinite(metrics.reuseDensity) ? metrics.reuseDensity : 0),
    );
    const sharedD = Math.min(
        1.0,
        Math.max(0.0, Number.isFinite(metrics.sharedDensity) ? metrics.sharedDensity : 0),
    );
    const payloadD = Math.min(
        1.0,
        Math.max(0.0, Number.isFinite(metrics.payloadDensity) ? metrics.payloadDensity : 0),
    );
    const factor = Math.min(
        1.0,
        Math.max(0.0, Number.isFinite(metrics.entropyFactor) ? metrics.entropyFactor : 0),
    );

    const baseDensity = 0.2 * (lineD + colD + reuseD + sharedD + payloadD);
    const composite = baseDensity * factor;

    return Math.round(Math.min(1.0, Math.max(0.0, composite)) * 1e6) / 1e6;
}
