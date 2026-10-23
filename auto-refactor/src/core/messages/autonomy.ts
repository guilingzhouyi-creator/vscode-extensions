/**
 * Module: Core Messages — Project In-House Autonomy (CAI 2.0) Descriptions
 * File Path: src/core/messages/autonomy.ts
 * Architecture Role: Single source of truth for qualitative grade descriptions and
 *   human-readable narrative rationales used by the autonomy-scorer.
 * Dependencies & Triggers: Zero external dependencies; consumed by autonomy-scorer and reports.
 * Responsibilities:
 *   1. Define immutable qualitative tier descriptions for L1 (Shallow Wrapper) to L5 (Independent).
 *   2. Support standardized English text with zero inline duplication.
 * Exit Semantics & Design Rationale: Pure `as const` mapping; total and side-effect free.
 */

/**
 * Standardized human-readable descriptions for qualitative autonomy tiers (L1~L5).
 */
export const AutonomyGradeDescriptions = {
    L5_INDEPENDENT:
        'Extremely high autonomy: Core architecture and algorithms are entirely proprietary with minimal external SDK coupling',
    L4_HIGH_AUTONOMY:
        'High autonomy: Business logic and domain kernel are fully proprietary, integrating standard open-source ecosystems reasonably',
    L3_BALANCED:
        'Balanced autonomy: Core business is proprietary with moderate collaboration with mainstream frameworks and cloud ecosystems',
    L2_FRAMEWORK_DEPENDENT:
        'Framework dependent: Substantial business logic is composed as glue code around third-party external SDKs',
    L1_SHALLOW_WRAPPER:
        'Shallow wrapper: Primarily interface passthrough and third-party implementation references with low proprietary ratio',
} as const;
