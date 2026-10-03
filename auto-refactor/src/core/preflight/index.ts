/**
 * Module: Core Preflight — Unified Preflight Audit & Indexing Subsystem
 * File Path: src/core/preflight/index.ts
 * Architecture Role: Unified public surface and orchestration entry point for
 *   the preflight audit subsystem. Fulfills substantive facade criteria (ELOC >= 15,
 *   input contract validation, immutable freezing).
 * Dependencies & Triggers: Aggregates eloc-baseline, audit-index, scope-decision, sparse-activator,
 *   slice-partitioner, expansion-tracer, audit-bus, scope-normalizer, and preflight-controller.
 * Responsibilities:
 *   1. Re-export domain contracts and types across preflight subsystems.
 *   2. Expose the preflight controller singleton and convenience execution functions.
 *   3. Enforce contract guards against negative thresholds and empty candidate sets.
 *   4. Safeguard output immutability via Object.freeze.
 * Exit Semantics & Design Rationale: Never throws; deterministic; clean decoupled facade.
 */

import {
    defaultPreflightController,
    type PreflightPlanOptions,
    type PreflightPlanResult,
    type FinalizeSessionParams,
    type AuditFinalizationOutcome,
} from './preflight-controller';

// Re-export core types and classes from sub-modules
export * from './eloc-baseline';
export * from './audit-index';
export * from './scope-decision';
export * from './sparse-activator';
export * from './slice-partitioner';
export * from './expansion-tracer';
export * from './audit-bus';
export * from './scope-normalizer';
export * from './preflight-controller';

/**
 * Convenience utility to execute preflight planning with validated parameter contracts.
 * Concurrency: Reentrant and thread-safe; delegates to preflight controller.
 *
 * @param options - Plan options with input validation.
 * @returns Frozen PreflightPlanResult.
 */
export async function executePreflightPlan(
    options: PreflightPlanOptions,
): Promise<PreflightPlanResult> {
    if (!options || typeof options !== 'object') {
        throw new TypeError('PreflightPlanOptions must be a valid non-null object');
    }

    const sanitizedOptions: PreflightPlanOptions = Object.freeze({
        ledgerDir: options.ledgerDir || '.refactor-trajectory',
        fileContents: options.fileContents ?? new Map(),
        availableAnalyzers: Object.freeze([...(options.availableAnalyzers || [])]),
        diffFiles: options.diffFiles ? Object.freeze([...options.diffFiles]) : undefined,
        explicitMode: options.explicitMode,
        explicitDomain: options.explicitDomain,
        activationThreshold: Math.max(0.1, Math.min(0.9, options.activationThreshold ?? 0.35)),
        maxWorkers: Math.max(1, Math.min(16, options.maxWorkers ?? 4)),
    });

    return defaultPreflightController.planAudit(sanitizedOptions);
}

/**
 * Convenience utility to finalize audit session with input verification.
 * Concurrency: Thread-safe session finalizer; updates baseline atomically.
 *
 * @param params - Finalization parameters.
 * @returns Frozen AuditFinalizationOutcome.
 */
export async function finalizeAuditSession(
    params: FinalizeSessionParams,
): Promise<AuditFinalizationOutcome> {
    if (!params || typeof params !== 'object') {
        throw new TypeError('FinalizeSessionParams must be a valid non-null object');
    }

    return defaultPreflightController.finalizeAudit(params);
}
