/**
 * Module: Core Evolution — Barrel Export
 * File Path: src/core/evolution/index.ts
 * Architecture Role: Central exports for git history mining and code evolution quality analysis.
 * Dependencies & Triggers: Consumed by QualityScorer, test pipelines, and CLI reporters.
 * Responsibilities: Re-export GitHistoryMiner and CodeEvolutionAnalyzer with all core contracts.
 * Exit Semantics & Design Rationale: Clean barrel pattern maintaining zero direct circular imports.
 */

export * from './git-history-miner';
export * from './code-evolution-analyzer';
