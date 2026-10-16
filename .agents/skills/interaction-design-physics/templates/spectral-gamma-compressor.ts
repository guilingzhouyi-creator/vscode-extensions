/**
 * Module: Spectral Gamma Compressor & Noise Floor Algorithm
 * File Path: .agents/skills/interaction-design-physics/templates/spectral-gamma-compressor.ts
 * Architecture Role: Digital signal processor for thinking frequency visualization and audio spectrums.
 * Dependencies & Triggers: Consumes Float32Array frequency bins or amplitude scalars; invoked per render frame.
 * Responsibilities:
 *   1. Cut off background visual noise below 8% floor threshold (noiseFloorThreshold = 0.08).
 *   2. Rescale active amplitudes linearly to [0, 1] range.
 *   3. Apply gamma exponent 0.7 power compression to amplify subtle nuances and suppress harsh peaks.
 *   4. Zero transient heap allocations in hot animation frames (CPX-SPACE-001).
 * Exit Semantics & Design Rationale: In-place array mutations or scalar returns, CC <= 15, Depth <= 3.
 */

export interface SpectralCompressorOptions {
    readonly noiseFloorThreshold?: number;
    readonly gammaExponent?: number;
    readonly smoothingFactor?: number;
}

export class SpectralGammaCompressor {
    private readonly noiseFloor: number;
    private readonly invRange: number;
    private readonly gamma: number;
    private readonly smoothing: number;

    public constructor(options: SpectralCompressorOptions = {}) {
        this.noiseFloor = options.noiseFloorThreshold ?? 0.08;
        this.gamma = options.gammaExponent ?? 0.7;
        this.smoothing = options.smoothingFactor ?? 0.15;
        this.invRange = 1.0 / (1.0 - this.noiseFloor);
    }

    /**
     * Compress a single amplitude value.
     */
    public compressScalar(rawAmplitude: number): number {
        if (rawAmplitude <= this.noiseFloor) {
            return 0.0;
        }
        const normalized = (rawAmplitude - this.noiseFloor) * this.invRange;
        return Math.pow(Math.min(1.0, Math.max(0.0, normalized)), this.gamma);
    }

    /**
     * In-place batch processing of frequency spectrum bins without heap allocation (CPX-SPACE-001).
     *
     * @param inputOutput Buffer containing normalized [0.0, 1.0] amplitude bins.
     * @param previousBuffer Optional history buffer for exponential moving average smoothing.
     */
    public compressBufferInPlace(
        inputOutput: Float32Array,
        previousBuffer?: Float32Array,
    ): void {
        const len = inputOutput.length;
        const hasHistory = previousBuffer !== undefined && previousBuffer.length === len;

        for (let i = 0; i < len; ++i) {
            const raw = inputOutput[i];
            let value = 0.0;

            if (raw > this.noiseFloor) {
                const norm = (raw - this.noiseFloor) * this.invRange;
                const clamped = norm > 1.0 ? 1.0 : (norm < 0.0 ? 0.0 : norm);
                value = Math.pow(clamped, this.gamma);
            }

            if (hasHistory) {
                const prev = previousBuffer[i];
                value = prev + (value - prev) * (1.0 - this.smoothing);
                previousBuffer[i] = value;
            }

            inputOutput[i] = value;
        }
    }
}
