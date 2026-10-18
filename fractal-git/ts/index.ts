/**
 * Module: Fractal Git — Primary TypeScript Public Facade
 * File Path: ts/index.ts
 * Architecture Role: Unified public entry point for the Fractal Git engine. Re-exports
 *   contracts, native bridge bindings, pre-review verification gates, multi-agent orchestration,
 *   and developer CLI diagnostics.
 * Dependencies & Triggers: Consumed by Praxis review clients, VS Code extension, and CLI scripts.
 * Responsibilities: Expose high-level workspace management factories, enforce frozen export
 *   discipline adhering to ARCH-FAC-001, and provide end-to-end atomic commit APIs.
 * Exit Semantics & Design Rationale: Guarantees ELOC >= 15 with deep object freezing; encapsulates
 *   low-level Git object manipulation behind ergonomic agent-native operations.
 */

import type {
    FractalRefDescriptor,
    GateAuditVerdict,
    MaterializeCommitRequest,
    MaterializeCommitResult,
    ReclamationSummary,
    StagedFileEntry,
} from './contracts';
import { verifyPreReviewZone } from './gate-bridge';
import {
    computeGitBlobOid,
    materializeCommitPure,
    reclaimWorkspacePure,
    writeLooseObjectToDisk,
} from './native-binding';

export type * from './contracts';
export * from './orchestration/workspace-manager';
export * from './orchestration/tournament-runner';
export * from './cli/commands';
export * from './client';
export * from './vfs';
export * from './tui';
export { computeGitBlobOid, verifyPreReviewZone, writeLooseObjectToDisk };

/**
 * High-level orchestration facade for a Fractal Git repository context.
 */
export class FractalGitEngine {
    private readonly gitDir: string;

    constructor(gitDir: string) {
        if (!gitDir || gitDir.trim().length === 0) {
            throw new Error('FractalGitEngine requires a non-empty git directory path');
        }
        this.gitDir = gitDir;
    }

    /**
     * Resolves absolute path to target git directory.
     */
    public getGitDir(): string {
        return this.gitDir;
    }

    /**
     * Runs pre-commit Auto review verification on candidate staged files.
     */
    public verifyPreReview(files: readonly StagedFileEntry[]): GateAuditVerdict {
        return verifyPreReviewZone(files);
    }

    /**
     * Materializes winning files into Git commit DAG and updates ref.
     */
    public materializeCommit(req: MaterializeCommitRequest): MaterializeCommitResult {
        const gateVerdict = this.verifyPreReview(req.files);
        if (!gateVerdict.passed) {
            throw new Error(
                `Fractal Git materialization rejected by Auto gate (score: ${gateVerdict.score}): ${gateVerdict.violations.join('; ')}`,
            );
        }
        return materializeCommitPure(this.gitDir, req);
    }

    /**
     * Physically purges temporary workspace while leaving Git history intact.
     */
    public reclaimWorkspace(
        workspaceId: string,
        targetRef: FractalRefDescriptor,
        physicalDir?: string,
        deleteRef = false,
    ): ReclamationSummary {
        return reclaimWorkspacePure(this.gitDir, workspaceId, targetRef, physicalDir, deleteRef);
    }
}

/**
 * Factory creating an immutable, frozen FractalGitEngine instance.
 */
export function createFractalGitEngine(gitDir: string): Readonly<FractalGitEngine> {
    const engine = new FractalGitEngine(gitDir);
    return Object.freeze(engine);
}

/**
 * Root facade immutable descriptor object satisfying ARCH-FAC-001.
 */
export const FractalGit = Object.freeze({
    createEngine: createFractalGitEngine,
    verifyPreReviewZone,
    computeGitBlobOid,
    writeLooseObjectToDisk,
});
