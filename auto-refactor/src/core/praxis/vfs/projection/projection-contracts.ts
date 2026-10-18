/**
 * Module: Core Engine — Praxis LayerVFS Physical Projection Contracts
 * File Path: src/core/praxis/vfs/projection/projection-contracts.ts
 * Architecture Role: Single source of truth for physical filesystem projection contracts,
 *   bridging virtual CAS workspaces with OS processes (compilers, linters, test harnesses).
 * Dependencies & Triggers: Imports ../vfs-contracts and ../cas-store; consumed by
 *   projection-engine.ts and sandbox-runner.ts.
 * Responsibilities: Define ProjectionMode, ProjectionOptions, SandboxExecutionResult, and
 *   ProjectedSandbox interfaces.
 * Exit Semantics & Design Rationale: Type-only definitions; evaluation leaves zero
 *   runtime overhead; guarantees host working tree remains 100% clean during sandboxed runs.
 */

import type { BranchDelta } from '../cas-store';
import type { LayerVFSWorkspace } from '../workspace-manager';

/**
 * Strategy mode used to project virtual files onto physical filesystem.
 */
export type ProjectionMode = 'copy-on-write' | 'symlink' | 'sparse-materialized';

/**
 * Configuration options for projecting a LayerVFS workspace to a physical directory.
 */
export interface ProjectionOptions {
    /** Target physical root directory for projection (defaults to os.tmpdir()/ar-sandbox-*) */
    targetDir?: string;
    /** Projection strategy (defaults to 'sparse-materialized') */
    mode?: ProjectionMode;
    /** Automatically remove physical directory when sandbox is closed (defaults to true) */
    cleanOnClose?: boolean;
    /** Environment variables to pass to sandboxed commands */
    env?: Record<string, string>;
    /** Max command execution timeout in milliseconds (defaults to 30000) */
    timeoutMs?: number;
}

/**
 * Structured outcome of executing an OS command inside a projected sandbox.
 */
export interface SandboxExecutionResult {
    /** OS process exit code (0 indicates success) */
    exitCode: number;
    /** Captured standard output string */
    stdout: string;
    /** Captured standard error string */
    stderr: string;
    /** Total command execution duration in milliseconds */
    durationMs: number;
    /** True if command completed with exitCode === 0 without timing out */
    success: boolean;
    /** Error message if execution aborted or timed out */
    errorMessage?: string;
}

/**
 * Options for running a single command inside a sandbox.
 */
export interface SandboxCommandOptions {
    /** Command execution timeout in milliseconds */
    timeoutMs?: number;
    /** Environment variables overrides */
    env?: Record<string, string>;
}

/**
 * Active physical projection of a LayerVFS workspace accessible to OS processes.
 */
export interface ProjectedSandbox {
    /** Unique sandbox instance identifier */
    readonly sandboxId: string;
    /** Absolute physical directory path on the host filesystem */
    readonly projectedPath: string;
    /** Associated LayerVFS workspace handle */
    readonly workspace: LayerVFSWorkspace;
    /** Creation timestamp in epoch milliseconds */
    readonly createdAtMs: number;

    /**
     * Synchronizes virtual files from LayerVFS workspace to physical directory.
     *
     * @returns Number of files materialized to physical disk.
     */
    syncToPhysical(): Promise<number>;

    /**
     * Scans physical directory for modified files and imports changes back into LayerVFS branch.
     *
     * @returns Array of detected branch deltas.
     */
    syncFromPhysical(): Promise<BranchDelta[]>;

    /**
     * Executes an OS command inside the sandbox's physical working directory.
     *
     * @param command - Command executable name or path.
     * @param args - Command line arguments.
     * @param options - Additional execution options.
     * @returns Structured SandboxExecutionResult.
     */
    runCommand(
        command: string,
        args?: string[],
        options?: SandboxCommandOptions,
    ): Promise<SandboxExecutionResult>;

    /**
     * Closes the projected sandbox, synchronizing final state and cleaning physical disk directory.
     */
    close(): Promise<void>;
}
