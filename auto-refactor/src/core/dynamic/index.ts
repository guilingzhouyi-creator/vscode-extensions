/**
 * Module: Dynamic Analysis Plane — Unified Export Index
 * File Path: src/core/dynamic/index.ts
 * Architecture Role: Single export surface for Dynamic Analysis Plane (DAP) data contracts,
 *   telemetry ingestion adapters, and dynamic quality scorers.
 * Dependencies & Triggers: Consumes internal dynamic modules; exported through src/api.ts.
 * Responsibilities: Re-export all dynamic contracts and calculation functions.
 * Exit Semantics & Design Rationale: Clean barrel re-exports without side-effects.
 */

export * from './dynamic-types';
export * from './telemetry-ingestor';
export * from './dynamic-quality-scorer';
