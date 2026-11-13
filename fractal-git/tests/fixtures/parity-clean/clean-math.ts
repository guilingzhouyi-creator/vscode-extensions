/**
 * Module: Golden Parity Clean Fixture
 * File Path: fractal-git/tests/fixtures/parity-clean/clean-math.ts
 * Architecture Role: Reference clean TypeScript library module for Rust-vs-TS scoring parity.
 * Dependencies & Triggers: Zero external imports; pure arithmetic functions.
 * Responsibilities: Compute clamped arithmetic helpers with explicit types and docblocks.
 * Exit Semantics & Design Rationale: Pure deterministic outputs without side effects.
 */

/**
 * Adds two finite numbers and clamps the sum to `[minValue, maxValue]`.
 *
 * @param left - Left operand.
 * @param right - Right operand.
 * @param bounds - Clamp boundaries.
 * @returns Clamped sum.
 */
export function clampedAdd(
    left: number,
    right: number,
    bounds: { readonly minValue: number; readonly maxValue: number },
): number {
    const rawSum = left + right;
    if (!Number.isFinite(rawSum)) {
        return bounds.minValue;
    }
    if (rawSum < bounds.minValue) {
        return bounds.minValue;
    }
    if (rawSum > bounds.maxValue) {
        return bounds.maxValue;
    }
    return rawSum;
}

/**
 * Computes arithmetic mean across a non-empty numeric sample slice.
 *
 * @param samples - Numeric array of observations.
 * @returns Mean value or `0` for empty input.
 */
export function sampleMean(samples: readonly number[]): number {
    if (samples.length === 0) {
        return 0;
    }
    let accumulator = 0;
    for (let idx = 0; idx < samples.length; idx += 1) {
        const entry = samples[idx];
        if (Number.isFinite(entry)) {
            accumulator += entry;
        }
    }
    return accumulator / samples.length;
}
