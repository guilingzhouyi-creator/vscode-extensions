/**
 * Module: Core Messages — Project Governance Evaluation & Anti-Gaming Warnings
 * File Path: src/core/messages/governance-eval.ts
 * Architecture Role: Single source of truth for progressive governance warnings,
 *   anti-gaming bonus nullification notices, and stage calibration messages.
 * Dependencies & Triggers: Zero external dependencies; consumed by project-governance-evaluator.
 * Responsibilities:
 *   1. Define standardized warning text for nullified reuse bonuses.
 *   2. Support explainable auditing for over-abstraction and negative-ROI pooling.
 * Exit Semantics & Design Rationale: Pure string constants; total and immutable.
 */

/**
 * Standardized governance evaluation warnings and explanations.
 */
export const GovernanceEvalMessages = {
    BONUS_NULLIFIED_OVER_ABSTRACTION:
        'Clean reuse bonus nullified due to presence of spurious indirection or cyclic over-abstraction.',

    BONUS_NULLIFIED_NEGATIVE_ROI_POOL:
        'Clean reuse bonus nullified due to presence of negative-ROI excessive micro-object pooling.',
} as const;
