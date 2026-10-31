/**
 * Module: Fractal Git — Primary TypeScript Public Facade
 * File Path: ts/index.ts
 * Architecture Role: Unified public entry point for the Fractal Git engine. Re-exports
 *   contracts, the pure-TypeScript Git object engine, pre-review verification gates,
 *   multi-agent orchestration, and developer CLI diagnostics.
 * Dependencies & Triggers: Consumed by Praxis review clients, VS Code extension, and CLI scripts.
 * Responsibilities: Expose high-level workspace management factories, enforce frozen export
 *   discipline with substantial domain operations, and provide end-to-end atomic commit APIs.
 * Exit Semantics & Design Rationale: Guarantees ELOC >= 15 with deep object freezing; encapsulates
 *   low-level Git object manipulation behind ergonomic agent-native operations. The active and only
 *   engine is the pure-TypeScript reference implementation in ts/native-binding.ts: this package
 *   compiles and ships no `.node` native binding, so no native shim is probed or claimed.
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
import {
    BENCHMARK_METRICS,
    CLI_TAGS,
    FGT_RULES,
    FRACTAL_REF,
    GIT_FILE_MODE,
    GIT_OBJ_TYPE,
    isRegisteredFgtRule,
    isValidBenchmarkMetric,
} from './constants';

export type * from './contracts';
export * from './constants';
export * from './orchestration/workspace-manager';
export * from './orchestration/variant-evaluator';
export * from './cli/commands';
export * from './client/praxis-client';
export * from './vfs/vfs-adapter';
export * from './tui/tree-renderer';
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
            const reasons = gateVerdict.violations.join('; ');
            throw new Error(
                `Fractal Git materialization rejected by Auto gate ` +
                `(score: ${gateVerdict.score}): ${reasons}`,
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
        options: { physicalDir?: string; deleteRef?: boolean } | string = {},
    ): ReclamationSummary {
        const normalized = typeof options === 'string'
            ? { physicalDir: options, deleteRef: false }
            : options;
        return reclaimWorkspacePure(this.gitDir, workspaceId, {
            targetRef,
            physicalDir: normalized.physicalDir,
            deleteRef: normalized.deleteRef ?? false,
        });
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
 * Root facade immutable descriptor object.
 */
export const FractalGit = Object.freeze({
    createEngine: createFractalGitEngine,
    verifyPreReviewZone,
    computeGitBlobOid,
    writeLooseObjectToDisk,
    constants: Object.freeze({
        GIT_OBJ_TYPE,
        GIT_FILE_MODE,
        FRACTAL_REF,
        FGT_RULES,
        BENCHMARK_METRICS,
        CLI_TAGS,
        isRegisteredFgtRule,
        isValidBenchmarkMetric,
    }),
});
