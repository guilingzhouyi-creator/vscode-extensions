/**
 * Module: Core Engine - Scale-Adaptive Sparse Scheduler Subsystem Facade
 * File Path: src/core/scheduler/index.ts
 * Architecture Role: Barrel entry point exposing scheduler contracts, dynamic partitioners,
 *   review context caches, cascade event buses, and seven-stage orchestrators.
 * Dependencies & Triggers: Re-exports ./scheduler-types, ./dynamic-partitioner,
 *   ./review-context-cache, ./review-event-bus, and ./sparse-orchestrator.
 * Responsibilities: Deliver a clean unified import surface for asynchronous sparse scheduling.
 * Exit Semantics & Design Rationale: Dependency-free barrel; preserves internal module freedom.
 */

export * from './scheduler-types';
export * from './dynamic-partitioner';
export * from './review-context-cache';
export * from './review-event-bus';
export * from './sparse-orchestrator';
