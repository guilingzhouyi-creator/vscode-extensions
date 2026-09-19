/**
 * Module: Core Engine — Semantic Graph Subsystem Index
 * File Path: src/core/semantic/index.ts
 * Architecture Role: Central export barrel for language-agnostic semantic IR types
 *   and graph management facilities.
 * Dependencies & Triggers: Re-exports ./types and ./semanticGraph. Consumed by
 *   analyzers, rules, adapters, and public API facade.
 * Responsibilities: Single point of export for semantic topology models.
 * Exit Semantics & Design Rationale: Standardizes clean imports across the engine.
 */

export * from './types';
export * from './semanticGraph';
export * from './adapters';
