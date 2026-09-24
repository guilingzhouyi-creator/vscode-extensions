/**
 * Module: Core Engine - Praxis Presentation Subsystem Facade
 * File Path: src/core/praxis/presentation/index.ts
 * Architecture Role: Barrel entry point exposing presentation contracts, diagnostic card models,
 *   i18n translation dictionaries, and presentation adapters.
 * Dependencies & Triggers: Re-exports ./i18n-types, ./i18n-provider, ./presentation-types,
 *   and ./presentation-adapter; consumed by praxis/index and public API.
 * Responsibilities: Deliver a clean, unified export surface for Praxis frontend consumers.
 * Exit Semantics & Design Rationale: Dependency-free barrel; preserves internal module freedom.
 */

export * from './i18n-types';
export * from './i18n-provider';
export * from './presentation-types';
export * from './presentation-adapter';
