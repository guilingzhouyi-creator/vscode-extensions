/**
 * Module: Fractal Git — Praxis Agent Client SDK
 * File Path: ts/client/praxis-client.ts
 * Architecture Role: High-level ergonomic client API for autonomous agents to interact
 *   with the Fractal Git engine: spawning worktrees, staging, requesting review, and merging.
 */

import type { FractalRefDescriptor, MaterializeCommitResult, StagedFileEntry } from "../contracts";
import { materializeCommitPure } from "../native-binding";

export interface AgentWorktreeHandle {
    worktreeId: string;
    fractalRef: FractalRefDescriptor;
    stageFile(path: string, content: Uint8Array | string, executable?: boolean): void;
    submitForPreReview(): MaterializeCommitResult;
}

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
        subagentId: string
    ): AgentWorktreeHandle {
        const ref: FractalRefDescriptor = {
            tier: "subagent_worktree",
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
            stageFile: (path: string, content: Uint8Array | string, executable: boolean = false) => {
                stagedFiles.push({
                    path,
                    mode: executable ? "100755" : "100644",
                    content,
                });
            },
            submitForPreReview: (): MaterializeCommitResult => {
                return materializeCommitPure(this.gitDir, {
                    targetRef: ref,
                    parentCommitOids: [],
                    files: stagedFiles,
                    message: `feat(subagent): atomic task commit\n\n[Project: fractal-git]`,
                    author: {
                        name: `${cellId}:${subagentId}`,
                        email: `${subagentId}@${cellId}.praxis.local`,
                        timestampSec: Math.floor(Date.now() / 1000),
                        tzOffset: "+0000",
                    },
                    agentMeta: {
                        cardContext: {
                            cardId,
                            cellId,
                            agentUid: subagentId,
                        },
                        qualityScore: 100.0,
                        gateStatus: "approved",
                        timestampMs: Date.now(),
                    },
                });
            },
        };
    }
}
