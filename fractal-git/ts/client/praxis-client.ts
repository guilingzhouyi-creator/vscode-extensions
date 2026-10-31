/**
 * Module: Fractal Git — Praxis Agent Client SDK
 * File Path: ts/client/praxis-client.ts
 * Architecture Role: High-level ergonomic client API for autonomous agents to interact
 *   with the Fractal Git engine: spawning worktrees, staging, requesting review, and merging.
 * Dependencies & Triggers: Consumes `../contracts`, `../constants`, `../native-binding`,
 *   and `../gate-bridge`.
 * Responsibilities: Manage per-subagent staged buffers, enforce Pre-Review Zone gate approval
 *   prior to commit materialization (`FGT-GAT-001`), and attach `Praxis-Agent-Meta` trailers.
 * Exit Semantics & Design Rationale: Rejects commits with an explicit Error whenever
 *   `verifyPreReviewZone` fails, preventing unverified agent mutations from entering the DAG.
 */

import type { FractalRefDescriptor, MaterializeCommitResult, StagedFileEntry } from '../contracts';
import { GIT_FILE_MODE } from '../constants';
import { materializeCommitPure } from '../native-binding';
import { verifyPreReviewZone } from '../gate-bridge';

/**
 * Immutable facade metadata descriptor for the Fractal Git Client SDK.
 */
export const FRACTAL_CLIENT_FACADE_INFO = Object.freeze({
    subsystem: 'fractal-git',
    tier: 'client',
    protocolVersion: '1.0.0',
});

/**
 * Ergonomic worktree handle for an autonomous agent performing isolated mutations.
 */
export interface AgentWorktreeHandle {
    worktreeId: string;
    fractalRef: FractalRefDescriptor;
    stageFile(path: string, content: Uint8Array | string, executable?: boolean): void;
    submitForPreReview(): MaterializeCommitResult;
}

/**
 * High-level Praxis Git client facilitating transactional operations for agent sandboxes.
 */
export class PraxisGitClient {
    private readonly gitDir: string;

    constructor(gitDir: string) {
        this.gitDir = gitDir;
    }

    /**
     * Spawns an isolated SubAgent worktree handle under the designated parent card.
     */
    public spawnSubAgentWorktree(
        cellId: string,
        cardId: string,
        subagentId: string,
    ): AgentWorktreeHandle {
        const ref: FractalRefDescriptor = {
            tier: 'subagent_worktree',
            gitRef: `refs/fractal/cell/${cellId}/card/${cardId}/sub/${subagentId}`,
            cellId,
            cardId,
            subagentId,
        };

        const worktreeId = `wt-${cellId}-${cardId}-${subagentId}`;
        const stagedFiles: StagedFileEntry[] = [];

        return {
            worktreeId,
            fractalRef: ref,
            stageFile: (
                path: string,
                content: Uint8Array | string,
                executable = false,
            ) => {
                stagedFiles.push({
                    path,
                    mode: executable ? GIT_FILE_MODE.EXECUTABLE : GIT_FILE_MODE.REGULAR,
                    content,
                });
            },
            submitForPreReview: (): MaterializeCommitResult => {
                const verdict = verifyPreReviewZone(stagedFiles);
                if (!verdict.passed) {
                    const reasons = verdict.violations.join('; ');
                    throw new Error(
                        `Pre-Review Zone gate rejected subagent worktree '${worktreeId}' ` +
                        `(score: ${verdict.score}): ${reasons}`,
                    );
                }
                return materializeCommitPure(this.gitDir, {
                    targetRef: ref,
                    parentCommitOids: [],
                    files: stagedFiles,
                    message: 'feat(subagent): atomic task commit\n\n[Project: fractal-git]',
                    authorName: `${cellId}:${subagentId}`,
                    authorEmail: `${subagentId}@${cellId}.praxis.local`,
                    agentMeta: {
                        cardContext: {
                            cardId,
                            cellId,
                            agentUid: subagentId,
                        },
                        qualityScore: verdict.score,
                        gateStatus: 'approved',
                        timestampMs: Date.now(),
                    },
                });
            },
        };
    }
}
