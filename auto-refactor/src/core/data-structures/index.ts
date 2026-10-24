/**
 * Module: Core Data Structures — Foundation Data Structures Barrel
 * File Path: src/core/data-structures/index.ts
 * Architecture Role: Single source of truth export barrel for standard reusable data structures
 *   including O(1) Map LRU cache, bitwise RingBuffer, and bidirectional IdInterner.
 * Dependencies & Triggers: Zero external runtime dependencies.
 * Responsibilities: Re-export standard data structure containers.
 * Exit Semantics & Design Rationale: Static barrel; zero runtime overhead.
 */

export * from './lru-cache';
export * from './ring-buffer';
export * from './id-interner';
