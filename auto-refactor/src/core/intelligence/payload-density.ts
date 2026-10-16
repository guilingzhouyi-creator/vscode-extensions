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

import type { ClassifiedToken } from './token-entropy';

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
        const t = tokens[i];
        const w = t.weight;
        totalWeight += w;

        if (t.category === 'CALC_FLOW' || t.category === 'DOMAIN_LITERAL') {
            semanticWeight += w;
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

    const m = Math.max(0, Number.isFinite(stateMutationsCount) ? stateMutationsCount : 0);
    if (m === 0 && !hasSideEffects) {
        return { deltaEntropy: 0, isTautological: true };
    }

    const n = iterationItemsCount;
    const ratio = Math.min(m, n) / n;
    const entropyGrowth = ratio * (Math.log2(1.0 + m) / Math.log2(2.0 + n));
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
