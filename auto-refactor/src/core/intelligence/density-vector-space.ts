/**
 * Module: Core Intelligence — High-Dimensional Code Density Vector Space & Riemannian Manifold
 * File Path: src/core/intelligence/density-vector-space.ts
 * Architecture Role: Provides the formal mathematical space solution for code density,
 *   mapping the 5D density tensor (line, column, reuse, shared, payload) into a whitened
 *   isotropic Riemannian manifold via Logit tangent expansion and Mahalanobis whitening.
 * Dependencies & Triggers: Consumes CompositeDensityInputs from ./payload-density; consumed by
 *   code-density-analyzer and refactoring prioritization engines.
 * Responsibilities:
 *   1. Map bounded [0.0, 1.0] density indicators to unconstrained tangent space via logit.
 *   2. Compute Cholesky-whitened coordinates z = W(y - mu_0) eliminating inter-metric collinearity.
 *   3. Calculate exact Mahalanobis distance d_M and Fisher-Rao simplex spherical arc distances.
 *   4. Compute Riemannian pullback refactoring gradient and identify the dominant deficit axis.
 *   5. Synthesize continuous Gaussian manifold composite density rho_space in [0.0, 1.0].
 * Exit Semantics & Design Rationale: Bounded [0.0, 1.0] and strictly zero transient heap
 *   allocations in linear algebra inner paths; robust to extreme boundary values [0, 1].
 */

import type { CompositeDensityInputs } from './payload-density';

/** Dimensionality of the canonical code density vector space. */
export const DENSITY_SPACE_DIMENSIONS = 5;

/** Five canonical axes of the code density vector space. */
export type DensityAxis =
    'lineDensity' | 'columnDensity' | 'reuseDensity' | 'sharedDensity' | 'payloadDensity';

/** Ordered tuple representation of the five canonical density dimensions. */
export type DensityVector5D = readonly [number, number, number, number, number];

/** Ordered array of canonical density axes. */
export const CANONICAL_DENSITY_AXES: readonly DensityAxis[] = [
    'lineDensity',
    'columnDensity',
    'reuseDensity',
    'sharedDensity',
    'payloadDensity',
] as const;

/** Default dominant density axis fallback. */
export const DEFAULT_DOMINANT_AXIS: DensityAxis = 'payloadDensity';

/** Two-element probability simplex coordinate on the unit 1-simplex. */
export interface SimplexPoint2D {
    readonly primary: number;
    readonly secondary: number;
}

/** Comprehensive result of evaluating code density on the Riemannian manifold. */
export interface SpatialDensityEvaluation {
    readonly rawVector: DensityVector5D;
    readonly tangentVector: DensityVector5D;
    readonly whitenedVector: DensityVector5D;
    readonly mahalanobisDistance: number;
    readonly fisherSimplexDistance: number;
    readonly spatialCompositeDensity: number;
    readonly refactoringGradient: Record<DensityAxis, number>;
    readonly dominantDeficitAxis: DensityAxis;
    readonly isIsotropicOptimal: boolean;
}

/** Small epsilon avoiding singularity at logit boundaries 0.0 and 1.0. */
export const DEFAULT_LOGIT_EPSILON = 1e-4;

/** Mahalanobis variance bandwidth sigma_M regulating the Gaussian density decay. */
export const OPTIMAL_MAHALANOBIS_BANDWIDTH = 2.5;

/** Mahalanobis distance threshold below which code is declared isotropically optimal. */
export const OPTIMAL_MAHALANOBIS_TOLERANCE = 0.5;

/** Precision rounding multiplier for export metrics. */
const ROUNDING_PRECISION = 1e6;

/** Target optimal attractor probabilities for clean, well-factored code. */
const TARGET_PAYLOAD_DENSITY = 0.9;

/**
 * Pre-computed logit coordinates of the optimal target attractor mu_0.
 * mu_0,i = ln(p_i / (1 - p_i)).
 */
export const DEFAULT_TARGET_TANGENT_ATTRACTOR: DensityVector5D = [
    2.197225, 2.197225, 1.734601, 1.734601, 2.197225,
] as const;

/**
 * Pre-calibrated Cholesky Whitening Matrix W = L^(-1) in R^(5x5) (lower-triangular).
 * Satisfies W * Sigma * W^T = I_5, decorrelating code density features.
 */
const WHITENING_MATRIX_LOWER: readonly (readonly number[])[] = [
    [0.833333, 0.0, 0.0, 0.0, 0.0],
    [-0.31136, 0.970474, 0.0, 0.0, 0.0],
    [-0.143511, -0.084912, 0.788092, 0.0, 0.0],
    [-0.091418, -0.05409, -0.367577, 0.869599, 0.0],
    [-0.304798, -0.111792, -0.069416, -0.069416, 0.926861],
] as const;

/**
 * Pre-calibrated Precision Matrix P = Sigma^(-1) = W^T * W in R^(5x5).
 * Used for direct quadratic form evaluation and gradient pullback.
 */
const PRECISION_MATRIX: readonly (readonly number[])[] = [
    [0.913244, -0.250962, -0.058339, -0.058339, -0.282505],
    [-0.250962, 0.964452, -0.039276, -0.039276, -0.103616],
    [-0.058339, -0.039276, 0.761021, -0.314826, -0.064339],
    [-0.058339, -0.039276, -0.314826, 0.761021, -0.064339],
    [-0.282505, -0.103616, -0.064339, -0.064339, 0.859072],
] as const;

/**
 * Maps a bounded probability into unconstrained tangent space via Logit.
 *
 * @param probability - Bounded probability or density ratio.
 * @param epsilon - Safeguard clamping threshold.
 * @returns Real-valued tangent coordinate y in (-inf, +inf).
 */
export function transformLogit(
    probability: number,
    epsilon: number = DEFAULT_LOGIT_EPSILON,
): number {
    const clamped = Math.min(
        1.0 - epsilon,
        Math.max(epsilon, Number.isFinite(probability) ? probability : epsilon),
    );
    return Math.log(clamped / (1.0 - clamped));
}

/** Historical alias for transformLogit. */
export const logitTransform = transformLogit;

/**
 * Inverts a tangent space coordinate back to bounded probability in (0.0, 1.0).
 *
 * @param logitCoord - Real-valued tangent coordinate.
 * @returns Bounded probability ratio.
 */
export function computeInverseLogit(logitCoord: number): number {
    if (!Number.isFinite(logitCoord)) {
        return logitCoord > 0 ? 1.0 : 0.0;
    }
    const expNeg = Math.exp(-logitCoord);
    return 1.0 / (1.0 + expNeg);
}

/** Historical alias for computeInverseLogit. */
export const inverseLogit = computeInverseLogit;

/**
 * Transforms CompositeDensityInputs into a canonical 5D density tuple.
 *
 * @param inputs - Raw composite density metrics.
 * @returns 5D density vector in [0.0, 1.0]^5.
 */
export function toDensityVector5D(inputs: CompositeDensityInputs): DensityVector5D {
    const line = Math.min(
        1.0,
        Math.max(0.0, Number.isFinite(inputs.lineDensity) ? inputs.lineDensity : 0.0),
    );
    const col = Math.min(
        1.0,
        Math.max(0.0, Number.isFinite(inputs.columnDensity) ? inputs.columnDensity : 0.0),
    );
    const reuse = Math.min(
        1.0,
        Math.max(0.0, Number.isFinite(inputs.reuseDensity) ? inputs.reuseDensity : 0.0),
    );
    const shared = Math.min(
        1.0,
        Math.max(0.0, Number.isFinite(inputs.sharedDensity) ? inputs.sharedDensity : 0.0),
    );
    const payload = Math.min(
        1.0,
        Math.max(0.0, Number.isFinite(inputs.payloadDensity) ? inputs.payloadDensity : 0.0),
    );
    return [line, col, reuse, shared, payload];
}

/**
 * Maps a 5D raw density vector into unconstrained tangent space coordinates.
 *
 * @param raw - 5D raw density vector.
 * @param epsilon - Clamping epsilon.
 * @returns 5D tangent space coordinate vector.
 */
export function toTangentVector5D(
    raw: DensityVector5D,
    epsilon: number = DEFAULT_LOGIT_EPSILON,
): DensityVector5D {
    return [
        transformLogit(raw[0], epsilon),
        transformLogit(raw[1], epsilon),
        transformLogit(raw[2], epsilon),
        transformLogit(raw[3], epsilon),
        transformLogit(raw[4], epsilon),
    ];
}

/**
 * Computes whitened isotropic coordinates z = W * (tangent - target).
 * When oneSidedDeficit is true, only deficits below target attractor are penalized.
 *
 * @param tangent - Tangent vector of current code.
 * @param target - Reference attractor (defaults to DEFAULT_TARGET_TANGENT_ATTRACTOR).
 * @param oneSidedDeficit - Whether to evaluate one-sided deficiency (default false).
 * @returns Whitened coordinates in R^5.
 */
export function computeWhitenedCoordinates(
    tangent: DensityVector5D,
    target: DensityVector5D = DEFAULT_TARGET_TANGENT_ATTRACTOR,
    oneSidedDeficit: boolean = false,
): DensityVector5D {
    const raw0 = tangent[0] - target[0];
    const raw1 = tangent[1] - target[1];
    const raw2 = tangent[2] - target[2];
    const raw3 = tangent[3] - target[3];
    const raw4 = tangent[4] - target[4];

    const deltas: readonly [number, number, number, number, number] = oneSidedDeficit
        ? [
              Math.min(0.0, raw0),
              Math.min(0.0, raw1),
              Math.min(0.0, raw2),
              Math.min(0.0, raw3),
              Math.min(0.0, raw4),
          ]
        : [raw0, raw1, raw2, raw3, raw4];

    const whitenedCoords: [number, number, number, number, number] = [0, 0, 0, 0, 0];

    for (let i = 0; i < DENSITY_SPACE_DIMENSIONS; i++) {
        let sum = 0.0;
        const row = WHITENING_MATRIX_LOWER[i];
        for (let j = 0; j <= i; j++) {
            sum += row[j] * deltas[j];
        }
        whitenedCoords[i] = sum;
    }

    return whitenedCoords;
}

/**
 * Computes the exact Mahalanobis distance between tangent coordinates and target attractor:
 * d_M = sqrt( (y - mu_0)^T * P * (y - mu_0) ) = ||z||_2.
 *
 * @param tangent - Tangent vector of current code.
 * @param target - Target attractor.
 * @param oneSidedDeficit - Whether to evaluate one-sided deficiency (default false).
 * @returns Non-negative Mahalanobis distance.
 */
export function computeMahalanobisDistance(
    tangent: DensityVector5D,
    target: DensityVector5D = DEFAULT_TARGET_TANGENT_ATTRACTOR,
    oneSidedDeficit: boolean = false,
): number {
    const whitened = computeWhitenedCoordinates(tangent, target, oneSidedDeficit);
    let normSq = 0.0;
    for (let i = 0; i < DENSITY_SPACE_DIMENSIONS; i++) {
        normSq += whitened[i] * whitened[i];
    }
    return Math.sqrt(normSq);
}

/**
 * Computes Fisher-Rao geodesic spherical arc length between two 2D probability simplex points:
 * d_FR(p, q) = 2 * arccos( sqrt(primary * q_primary) + sqrt(secondary * q_secondary) ).
 *
 * @param samplePrimary - First point primary probability.
 * @param sampleSecondary - First point secondary probability.
 * @param targetPrimary - Target primary probability (default 0.90).
 * @param targetSecondary - Target secondary probability (default 0.10).
 * @returns Geodesic distance in [0.0, pi].
 */
export function computeFisherSimplexDistance(
    samplePrimary: number,
    sampleSecondary: number,
    targetPrimary: number = TARGET_PAYLOAD_DENSITY,
    targetSecondary: number = 1.0 - TARGET_PAYLOAD_DENSITY,
): number {
    const safePrimary = Math.min(
        1.0,
        Math.max(0.0, Number.isFinite(samplePrimary) ? samplePrimary : 0.0),
    );
    const safeSecondary = Math.min(
        1.0,
        Math.max(0.0, Number.isFinite(sampleSecondary) ? sampleSecondary : 0.0),
    );
    const sumPrimarySecondary = safePrimary + safeSecondary;
    const normPrimary = sumPrimarySecondary > 0 ? safePrimary / sumPrimarySecondary : 0.5;
    const normSecondary = sumPrimarySecondary > 0 ? safeSecondary / sumPrimarySecondary : 0.5;

    const bhattacharyya =
        Math.sqrt(normPrimary * targetPrimary) + Math.sqrt(normSecondary * targetSecondary);
    const clampedCosine = Math.min(1.0, Math.max(-1.0, bhattacharyya));
    return 2.0 * Math.acos(clampedCosine);
}

/**
 * Computes refactoring gradient pulling code state toward the optimal attractor.
 * Identifies which density axis provides the steepest marginal improvement if refactored.
 *
 * @param raw - Raw physical density vector in [0.0, 1.0]^5.
 * @param tangent - Tangent space coordinate vector.
 * @param target - Reference attractor.
 * @returns Gradient record and dominant deficit axis.
 */
export function computeRefactoringGradient(
    raw: DensityVector5D,
    tangent: DensityVector5D,
    target: DensityVector5D = DEFAULT_TARGET_TANGENT_ATTRACTOR,
): { gradient: Record<DensityAxis, number>; dominantAxis: DensityAxis } {
    const deltas: readonly [number, number, number, number, number] = [
        tangent[0] - target[0],
        tangent[1] - target[1],
        tangent[2] - target[2],
        tangent[3] - target[3],
        tangent[4] - target[4],
    ];

    const gradY: [number, number, number, number, number] = [0, 0, 0, 0, 0];

    for (let i = 0; i < DENSITY_SPACE_DIMENSIONS; i++) {
        let sum = 0.0;
        const row = PRECISION_MATRIX[i];
        for (let j = 0; j < DENSITY_SPACE_DIMENSIONS; j++) {
            sum += row[j] * deltas[j];
        }
        gradY[i] = sum;
    }

    const gradient: Record<DensityAxis, number> = {
        lineDensity: 0,
        columnDensity: 0,
        reuseDensity: 0,
        sharedDensity: 0,
        payloadDensity: 0,
    };

    let maxDeficit = -Infinity;
    let dominantAxis: DensityAxis = DEFAULT_DOMINANT_AXIS;

    for (let i = 0; i < DENSITY_SPACE_DIMENSIONS; i++) {
        const axis = CANONICAL_DENSITY_AXES[i];
        const prob = Math.min(1.0 - DEFAULT_LOGIT_EPSILON, Math.max(DEFAULT_LOGIT_EPSILON, raw[i]));
        const jacobian = 1.0 / (prob * (1.0 - prob));
        const physGrad = gradY[i] * jacobian;
        const roundedGrad = Math.round(physGrad * ROUNDING_PRECISION) / ROUNDING_PRECISION;
        gradient[axis] = roundedGrad;

        // When code is in deficit (delta < 0), gradY is negative.
        // Steepest deficit corresponds to the most negative gradient.
        const deficitPayoff = -physGrad;
        if (deficitPayoff > maxDeficit) {
            maxDeficit = deficitPayoff;
            dominantAxis = axis;
        }
    }

    return { gradient, dominantAxis };
}

/**
 * Comprehensive evaluator mapping 5D composite density inputs onto the Riemannian manifold.
 *
 * @param inputs - Composite density inputs from code tokenization.
 * @returns Complete SpatialDensityEvaluation structure.
 */
export function evaluateSpatialDensityManifold(
    inputs: CompositeDensityInputs,
): SpatialDensityEvaluation {
    const rawVector = toDensityVector5D(inputs);
    const tangentVector = toTangentVector5D(rawVector);
    const whitenedVector = computeWhitenedCoordinates(
        tangentVector,
        DEFAULT_TARGET_TANGENT_ATTRACTOR,
        true,
    );
    const mahalanobisDistance = computeMahalanobisDistance(
        tangentVector,
        DEFAULT_TARGET_TANGENT_ATTRACTOR,
        true,
    );

    // Simplex arc length between payloadDensity (TSPR) and plumbing overhead (POR)
    const tspr = rawVector[4];
    const por = 1.0 - tspr;
    const fisherSimplexDistance = computeFisherSimplexDistance(tspr, por);

    // Continuous Riemannian Gaussian manifold density modulated by entropy bandwidth factor
    const bandwidthSq = 2.0 * OPTIMAL_MAHALANOBIS_BANDWIDTH * OPTIMAL_MAHALANOBIS_BANDWIDTH;
    const gaussianDecay = Math.exp(-(mahalanobisDistance * mahalanobisDistance) / bandwidthSq);
    const safeFactor = Math.min(
        1.0,
        Math.max(0.0, Number.isFinite(inputs.entropyFactor) ? inputs.entropyFactor : 1.0),
    );
    const spatialCompositeDensity =
        Math.round(gaussianDecay * safeFactor * ROUNDING_PRECISION) / ROUNDING_PRECISION;

    const { gradient, dominantAxis } = computeRefactoringGradient(rawVector, tangentVector);
    const isIsotropicOptimal = mahalanobisDistance <= OPTIMAL_MAHALANOBIS_TOLERANCE;

    return {
        rawVector,
        tangentVector,
        whitenedVector,
        mahalanobisDistance:
            Math.round(mahalanobisDistance * ROUNDING_PRECISION) / ROUNDING_PRECISION,
        fisherSimplexDistance:
            Math.round(fisherSimplexDistance * ROUNDING_PRECISION) / ROUNDING_PRECISION,
        spatialCompositeDensity,
        refactoringGradient: gradient,
        dominantDeficitAxis: dominantAxis,
        isIsotropicOptimal,
    };
}

/**
 * Calculates scalar spatial composite effective density in [0.0, 1.0].
 * Drop-in, mathematically principled upgrade to naive arithmetic averaging.
 *
 * @param inputs - Composite density inputs.
 * @returns Spatial composite density in [0.0, 1.0].
 */
export function calculateSpatialEffectiveDensity(inputs: CompositeDensityInputs): number {
    return evaluateSpatialDensityManifold(inputs).spatialCompositeDensity;
}
