/**
 * Module: Core Scoring — Logistic Marginal Deduction & Saturation Curves
 * File Path: src/core/scoring/logistic-deduction-curve.ts
 * Architecture Role: Implements non-linear logistic saturation and marginal utility
 *   dampening to eliminate catastrophic score cliff crashes while maintaining strict penalty
 *   fidelity on early infractions.
 * Dependencies & Triggers: Re-exports from src/core/math/saturation-curves for backward compatibility.
 * Responsibilities: Re-export saturation curve operators from the unified math library.
 * Exit Semantics & Design Rationale: Pure math functions; non-throwing.
 */

export * from '../math/saturation-curves';
