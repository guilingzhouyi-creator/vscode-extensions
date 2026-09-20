/**
 * Module: Core Engine — Semantic Language Adapters Index
 * File Path: src/core/semantic/adapters/index.ts
 * Architecture Role: Central export barrel for multi-language semantic adapters, path
 *   utilities, and registry infrastructure.
 * Dependencies & Triggers: Consumed by core/semantic, analyzers, and external consumers.
 * Responsibilities: Export base classes, path utilities, concrete adapters, and registry.
 * Exit Semantics & Design Rationale: Provides clean and consolidated import targets.
 */

export * from './path-utils';
export * from './base';
export * from './typescript-adapter';
export * from './python-adapter';
export * from './skeleton-adapters';
export * from './registry';
