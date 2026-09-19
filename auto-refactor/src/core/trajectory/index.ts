/**
 * Module: Core Engine — Change Trajectory and Multi-Agent Governance Barrel
 * File Path: src/core/trajectory/index.ts
 * Architecture Role: Public facade barrel re-exporting all trajectory types, anomaly detectors,
 *   agent attribution trackers, collision detectors, conflict auditors, patch arbiters, and
 *   multi-agent coordinators.
 * Dependencies & Triggers: Consumes all modules under src/core/trajectory/.
 * Responsibilities: Expose clean public imports for the rest of the engine and Praxis layer.
 * Exit Semantics & Design Rationale: Standard barrel with pure re-exports; no runtime overhead.
 */

export * from './types';
export * from './anomalyDetector';
export * from './changeTrajectory';
export * from './agentAttribution';
export * from './agentCollisionDetector';
export * from './intentConflictDetector';
export * from './duplicateWorkAuditor';
export * from './patchArbiter';
export * from './multiAgentCoordinator';
export * from './recipeTypes';
export * from './recipeExtractor';
export * from './regressionTrajectoryDetector';
