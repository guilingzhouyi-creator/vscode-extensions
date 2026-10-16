/**
 * Module: Math Operators — Spectral Noise Floor & Gamma Dynamic Range Compression
 * File Path: src/math/spectral-gamma.ts
 * Architecture Role: Pure TS operator providing 8% noise floor suppression and 0.7-power
 *   Gamma dynamic range compression for audio/frequency spectral buffers.
 * Dependencies & Triggers: Independent pure math module; consumed by frequency analyzers,
 *   audio waveform processors, and spectral density estimators.
 * Responsibilities:
 *   1. Suppress low-level background noise below the 8% (0.08) threshold to absolute zero.
 *   2. Normalize and compress dynamic range above the noise floor using x^0.7 power curve.
 *   3. Process Float64Array spectral buffers in-place with zero heap allocations in loop.
 * Exit Semantics & Design Rationale: CC <= 8; strictly monotonic;
 *   numerical stability for [0, 1] inputs.
 */

/** Default noise floor threshold below which spectral amplitude is clamped to zero. */
export const DEFAULT_NOISE_FLOOR = 0.08;

/** Default power-law Gamma exponent for spectral dynamic range compression. */
export const DEFAULT_GAMMA_EXPONENT = 0.7;

/**
 * Compresses a single normalized amplitude value [0.0, 1.0].
 * CC = 3, Depth = 1.
 *
 * @param amplitude - Input amplitude value.
 * @param floor - Noise floor threshold (default 0.08).
 * @param gamma - Power-law exponent (default 0.7).
 * @returns Compressed amplitude value.
 */
export function compressSpectralSample(
    amplitude: number,
    floor: number = DEFAULT_NOISE_FLOOR,
    gamma: number = DEFAULT_GAMMA_EXPONENT,
): number {
    if (amplitude <= floor) {
        return 0.0;
    }
    if (amplitude >= 1.0) {
        return 1.0;
    }
    const normalized = (amplitude - floor) / (1.0 - floor);
    return Math.pow(normalized, gamma);
}

/**
 * In-place spectral buffer compression with pre-computed inverse range.
 * Zero heap allocations in loop (CPX-SPACE-001). CC = 4, Depth = 2.
 *
 * @param buffer - Buffer modified in-place.
 * @param floor - Noise floor threshold.
 * @param gamma - Power-law exponent.
 */
export function compressSpectralBufferInPlace(
    buffer: Float64Array,
    floor: number = DEFAULT_NOISE_FLOOR,
    gamma: number = DEFAULT_GAMMA_EXPONENT,
): void {
    const invRange = 1.0 / (1.0 - floor);
    const len = buffer.length;
    for (let i = 0; i < len; i++) {
        const val = buffer[i];
        if (val <= floor) {
            buffer[i] = 0.0;
        } else if (val >= 1.0) {
            buffer[i] = 1.0;
        } else {
            buffer[i] = Math.pow((val - floor) * invRange, gamma);
        }
    }
}

/**
 * Copies and compresses input spectral buffer into destination buffer.
 * CC = 4, Depth = 2.
 *
 * @param input - Source input buffer.
 * @param output - Destination output buffer.
 * @param floor - Noise floor threshold.
 * @param gamma - Power-law exponent.
 */
export function compressSpectralBuffer(
    input: Float64Array,
    output: Float64Array,
    floor: number = DEFAULT_NOISE_FLOOR,
    gamma: number = DEFAULT_GAMMA_EXPONENT,
): void {
    const len = Math.min(input.length, output.length);
    const invRange = 1.0 / (1.0 - floor);
    for (let i = 0; i < len; i++) {
        const val = input[i];
        if (val <= floor) {
            output[i] = 0.0;
        } else if (val >= 1.0) {
            output[i] = 1.0;
        } else {
            output[i] = Math.pow((val - floor) * invRange, gamma);
        }
    }
}
