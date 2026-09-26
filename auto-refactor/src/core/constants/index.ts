/**
 * Module: Core Constants — Central Barrel Facade
 * File Path: src/core/constants/index.ts
 * Architecture Role: Single entry point exporting all centralized domain constants
 *     (AST, diagnostic, system, and rule tokens).
 * Dependencies & Triggers: Re-exports from sibling token modules; imported by analyzers,
 *     rules, AST engines, and reporters.
 * Responsibilities: Aggregate and re-export the complete constants catalog, ensuring
 *     predictable import paths and zero duplication across the codebase.
 * Exit Semantics & Design Rationale: Pure re-export barrel with zero runtime footprint.
 */

export * from './ast-tokens';
export * from './diagnostic-tokens';
export * from './system-tokens';
export * from './rule-codes';
