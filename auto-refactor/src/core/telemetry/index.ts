/**
 * Module: Core Telemetry — Barrel Export
 * File Path: src/core/telemetry/index.ts
 * Architecture Role: Unified exports for CI coverage telemetry ingestion and dynamic feedback.
 * Dependencies & Triggers: Consumed by RiskFusionEngine, test pipelines, and CLI reporters.
 * Responsibilities: Re-export LcovIngester and all associated telemetry interfaces.
 * Exit Semantics & Design Rationale: Clean barrel re-exports without side-effects.
 */

export * from './lcov-ingester';
