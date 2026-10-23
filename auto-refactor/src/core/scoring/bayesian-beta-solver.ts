/**
 * Module: Core Engine — Analytical Bayesian Beta Distribution Solver
 * File Path: src/core/scoring/bayesian-beta-solver.ts
 * Architecture Role: Evaluates exact quantiles, incomplete beta functions, and credible
 *   intervals for Beta distributions using Lanczos log-gamma and Halley root iterations.
 * Dependencies & Triggers: Re-exports from src/core/math/bayesian-solver for backward
 *   compatibility; consumed by autonomy-scorer and statistical models.
 * Responsibilities: Re-export Bayesian solver operators from the unified math library.
 * Exit Semantics & Design Rationale: Pure math functions; zero I/O; deterministic; non-throwing.
 */

export * from '../math/bayesian-solver';
