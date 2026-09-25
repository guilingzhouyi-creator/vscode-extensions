/**
 * Module: Core Scoring — Unified Quality Quantification & Scoring Index
 * File Path: src/core/scoring/index.ts
 * Architecture Role: Central aggregator and single entrypoint for the multi-dimensional
 *   quality quantification engine, eight-pillar executive model, non-linear risk deductions,
 *   five-level hierarchical scoring, effective density calculations, anti-gaming protection,
 *   and patch quality evaluations.
 * Dependencies & Triggers: Consumes internal scoring modules; exported through src/api.ts.
 * Responsibilities: Export all public scoring models, interfaces, types, and engine entrypoints.
 * Exit Semantics & Design Rationale: Clean barrel re-exports without side-effects.
 */

export * from './scoringTypes';
export * from './eightPillarModel';
export * from './riskWeightModel';
export * from './effectiveDensity';
export * from './antiGaming';
export * from './hierarchicalScorer';
export * from './patchQuality';
export * from './diffScore';
export * from './qualityScorer';
export * from './project-governance-evaluator';
export * from './static-quality-model';
export * from './risk-fusion-engine';
export * from './fusion-scorer';
export * from './change-quality-arbiter';
