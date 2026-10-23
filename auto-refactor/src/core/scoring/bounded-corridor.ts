/**
 * Module: Core Engine — Compact Bounded Corridor & Numerical Interval Guard
 * File Path: src/core/scoring/bounded-corridor.ts
 * Architecture Role: Mathematical invariants and compact interval clamping primitives
 *   for scores, ratios, weights, and floating-point corridor assertions.
 * Dependencies & Triggers: Re-exports from src/core/math/numerical-corridor for backward
 *   compatibility; called by hierarchicalScorer, patchQuality, modernization-metrics, and gate scripts.
 * Responsibilities: Re-export numerical corridor operators from the unified math library.
 * Exit Semantics & Design Rationale: Pure functional arithmetic; zero side-effects.
 */

export * from '../math/numerical-corridor';
