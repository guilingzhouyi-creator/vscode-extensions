/**
 * Module: Core Algorithms — Foundation Algorithms Barrel
 * File Path: src/core/algorithms/index.ts
 * Architecture Role: Single source of truth export barrel for graph traversal,
 *   hashing, text metrics, and set algebra algorithm operators.
 * Dependencies & Triggers: Zero external dependencies; pure algorithmic operators.
 * Responsibilities: Re-export graph, hash, text-metrics, and set-algebra operators.
 * Exit Semantics & Design Rationale: Static barrel; zero runtime overhead.
 */

export * from './hash';
export * from './text-metrics';
export * from './set-algebra';
export * from './graph';
