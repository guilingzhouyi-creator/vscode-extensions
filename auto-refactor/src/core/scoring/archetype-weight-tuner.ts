/**
 * Module: Core Engine — Archetype-Aware Adaptive Weight Tuner
 * File Path: src/core/scoring/archetype-weight-tuner.ts
 * Architecture Role: Dynamically adapts quality dimension weights:
 *   W_final = Normalize(W_base ⊙ M_archetype) based on detected project archetypes
 *   (systems runtime, game script, shared library, web app, etc.).
 * Dependencies & Triggers: Imports scoring types and constants from ./scoringTypes,
 *   ProjectArchetype from ../types; invoked by QualityScorer and scan orchestrators.
 * Responsibilities:
 *   1. Define explicit archetype bias multipliers M_archetype across all 10 quality dimensions.
 *   2. Compute element-wise multiplication with base weights and preserve mass invariant.
 *   3. Provide seamless fallback to DEFAULT_QUALITY_WEIGHTS when archetype is omitted.
 * Exit Semantics & Design Rationale: Pure mathematical transformation with zero side effects;
 *   weight mass normalization ensures composite scores across archetypes remain comparable.
 */

import type { ProjectArchetype } from '../types';
import type { QualityDimension, QualityWeights } from './scoringTypes';
import { ALL_QUALITY_DIMENSIONS, DEFAULT_QUALITY_WEIGHTS } from './scoringTypes';

/**
 * Archetype-specific bias multiplier matrices M_archetype.
 */
export const ARCHETYPE_WEIGHT_MULTIPLIERS: Record<
    ProjectArchetype | 'cli',
    Record<QualityDimension, number>
> = {
    systems_runtime: {
        performanceEfficiency: 1.8,
        codeSecurity: 1.5,
        architectureConsistency: 1.4,
        techDebtRisk: 1.5,
        maintainability: 1.0,
        semanticPurity: 1.2,
        commentQuality: 0.8,
        duplication: 0.9,
        standardization: 1.0,
        modernity: 1.0,
    },
    game: {
        performanceEfficiency: 1.9,
        semanticPurity: 1.4,
        architectureConsistency: 1.3,
        maintainability: 1.2,
        techDebtRisk: 1.2,
        codeSecurity: 0.9,
        commentQuality: 0.6,
        duplication: 1.0,
        standardization: 1.0,
        modernity: 1.1,
    },
    library: {
        standardization: 1.6,
        commentQuality: 1.5,
        modernity: 1.3,
        maintainability: 1.4,
        architectureConsistency: 1.3,
        codeSecurity: 1.2,
        semanticPurity: 1.1,
        performanceEfficiency: 1.0,
        duplication: 1.2,
        techDebtRisk: 1.0,
    },
    stdlib: {
        standardization: 1.7,
        commentQuality: 1.6,
        modernity: 1.3,
        maintainability: 1.5,
        architectureConsistency: 1.4,
        codeSecurity: 1.3,
        semanticPurity: 1.2,
        performanceEfficiency: 1.1,
        duplication: 1.2,
        techDebtRisk: 1.1,
    },
    web: {
        codeSecurity: 1.6,
        modernity: 1.4,
        maintainability: 1.3,
        standardization: 1.2,
        architectureConsistency: 1.2,
        performanceEfficiency: 1.0,
        commentQuality: 0.9,
        duplication: 1.1,
        semanticPurity: 1.0,
        techDebtRisk: 1.2,
    },
    cli: {
        maintainability: 1.6,
        semanticPurity: 1.4,
        codeSecurity: 1.2,
        standardization: 1.2,
        architectureConsistency: 1.1,
        modernity: 1.1,
        commentQuality: 1.0,
        duplication: 1.0,
        techDebtRisk: 1.1,
        performanceEfficiency: 0.7,
    },
    demo: {
        commentQuality: 1.4,
        modernity: 1.3,
        standardization: 1.2,
        maintainability: 1.0,
        semanticPurity: 0.9,
        duplication: 0.9,
        architectureConsistency: 0.8,
        codeSecurity: 0.8,
        techDebtRisk: 0.8,
        performanceEfficiency: 0.6,
    },
};

/**
 * Dynamic tuner adapting quality dimension weights based on project
 * archetype with mass preservation.
 */
export class ArchetypeWeightTuner {
    /**
     * Tune quality weights according to project archetype with invariant mass normalization.
     *
     * @param archetype - The project archetype or undefined for default balanced weights.
     * @param baseWeights - Optional base weights (defaults to DEFAULT_QUALITY_WEIGHTS).
     * @returns Normalized adaptive quality weights.
     */
    public tuneWeights(
        archetype?: ProjectArchetype | string,
        baseWeights: QualityWeights = DEFAULT_QUALITY_WEIGHTS,
    ): QualityWeights {
        if (!archetype || !(archetype in ARCHETYPE_WEIGHT_MULTIPLIERS)) {
            return { ...baseWeights };
        }

        const multipliers =
            ARCHETYPE_WEIGHT_MULTIPLIERS[archetype as keyof typeof ARCHETYPE_WEIGHT_MULTIPLIERS];

        // 1. Calculate sum of base weights to preserve total mass invariant
        let baseMass = 0;
        for (const dim of ALL_QUALITY_DIMENSIONS) {
            baseMass += baseWeights[dim] ?? 1.0;
        }

        // 2. Element-wise multiplication: W_unnorm = W_base ⊙ M_archetype
        const unnormalized: Record<QualityDimension, number> = {} as Record<
            QualityDimension,
            number
        >;
        let unnormMass = 0;

        for (const dim of ALL_QUALITY_DIMENSIONS) {
            const baseW = baseWeights[dim] ?? 1.0;
            const mul = multipliers[dim] ?? 1.0;
            const tuned = baseW * mul;
            unnormalized[dim] = tuned;
            unnormMass += tuned;
        }

        // 3. Normalization scale factor
        const scale = unnormMass > 0 ? baseMass / unnormMass : 1.0;

        const result: QualityWeights = {} as QualityWeights;
        for (const dim of ALL_QUALITY_DIMENSIONS) {
            result[dim] = +(unnormalized[dim] * scale).toFixed(3);
        }

        return result;
    }
}
