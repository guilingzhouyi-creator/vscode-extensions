/**
 * Module: Core Engine — Review Pipeline Subsystem Facade
 * File Path: src/core/pipeline/index.ts
 * Architecture Role: Primary facade and entry point for the auto-refactor execution pipeline,
 *   aggregating dual-track speculative audit, DualPipe bidirectional scheduler, cycle detection,
 *   and escalation channel subsystems.
 * Dependencies & Triggers: Consumes internal pipeline modules and re-exports public interfaces
 *   for the engine, CLI, and public api.ts.
 * Responsibilities:
 *   1. Re-export DualTrackPipeline primitives (FastTrackVerdict, DeepTrackVerdict, executeDualTrack).
 *   2. Re-export DualPipe BidirectionalAuditScheduler and schedule step structures.
 *   3. Re-export dependency cycle detectors and escalation channel handlers.
 * Exit Semantics & Design Rationale: Centralized immutable export surface preventing
 *   fragmented deep module imports.
 */

export * from './dualTrackPipeline';
export * from './cycle-detector';
export * from './escalationChannel';
export * from './bidirectional-scheduler';
