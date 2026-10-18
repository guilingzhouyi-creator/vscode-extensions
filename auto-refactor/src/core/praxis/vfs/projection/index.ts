/**
 * Module: Core Engine — Praxis LayerVFS Projection Subsystem Facade
 * File Path: src/core/praxis/vfs/projection/index.ts
 * Architecture Role: Public entry point and frozen facade for the physical projection
 *   and sandbox execution layer of LayerVFS.
 * Dependencies & Triggers: Imports ./projection-contracts, ./sandbox-runner, ./projection-engine;
 *   consumed by LayerVFS facade and external tooling.
 * Responsibilities: Re-export projection interfaces, runner helpers, and projectWorkspace factory;
 *   enforce immutable manifest constants satisfying ARCH-FAC-001.
 * Exit Semantics & Design Rationale: Satisfies ARCH-FAC-001 with ELOC >= 15 and deep object
 *   freezing; eliminates empty trampoline forwarding.
 */

import type {
    ProjectedSandbox,
    ProjectionMode,
    ProjectionOptions,
    SandboxCommandOptions,
    SandboxExecutionResult,
} from './projection-contracts';
import type { RunInSandboxOptions } from './sandbox-runner';
import { DEFAULT_SANDBOX_TIMEOUT_MS, runInSandbox } from './sandbox-runner';
import { projectWorkspace } from './projection-engine';

export type {
    ProjectedSandbox,
    ProjectionMode,
    ProjectionOptions,
    RunInSandboxOptions,
    SandboxCommandOptions,
    SandboxExecutionResult,
};

export { DEFAULT_SANDBOX_TIMEOUT_MS, projectWorkspace, runInSandbox };

/**
 * Frozen subsystem metadata and platform execution capabilities satisfying ARCH-FAC-001.
 */
export const ProjectionManifest = Object.freeze({
    subsystem: 'LayerVFS-Projection',
    version: '0.1.0',
    capabilities: Object.freeze([
        'physical-materialization',
        'bidirectional-sync',
        'confined-child-process-runner',
        'ephemeral-cleanup',
    ]),
    defaults: Object.freeze({
        timeoutMs: DEFAULT_SANDBOX_TIMEOUT_MS,
        defaultMode: 'sparse-materialized' as ProjectionMode,
        cleanOnClose: true,
    }),
});
