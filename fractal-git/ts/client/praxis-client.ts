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

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { FractalRefDescriptor, MaterializeCommitResult, StagedFileEntry } from '../contracts';
import { FRACTAL_REF, GIT_FILE_MODE } from '../constants';
import { materializeCommitPure } from '../native-binding';
import { verifyPreReviewZone } from '../gate-bridge';

const RE_HEX_OID = /^[0-9a-fA-F]{40}$/;

function resolveGitRefOid(gitDir: string, refName: string, depth = 0): string | undefined {
    if (depth >= 8) {
        return undefined;
    }
    const cleanRef = refName.replace(/^\/+/, '');
    const loosePath = path.join(gitDir, cleanRef);
    if (fs.existsSync(loosePath) && fs.statSync(loosePath).isFile()) {
        const body = fs.readFileSync(loosePath, 'utf8').trim();
        if (body.startsWith('ref:')) {
            return resolveGitRefOid(gitDir, body.slice(4).trim(), depth + 1);
        }
        if (RE_HEX_OID.test(body)) {
            return body.toLowerCase();
        }
    }
    const packedPath = path.join(gitDir, 'packed-refs');
    if (fs.existsSync(packedPath) && fs.statSync(packedPath).isFile()) {
        const lines = fs.readFileSync(packedPath, 'utf8').split(/\r?\n/);
        for (const rawLine of lines) {
            const line = rawLine.trim();
            if (line.length === 0 || line.startsWith('#') || line.startsWith('^')) {
                continue;
            }
            const spaceIdx = line.indexOf(' ');
            if (spaceIdx > 0 && line.slice(spaceIdx + 1).trim() === cleanRef) {
                const candidate = line.slice(0, spaceIdx).trim();
                if (RE_HEX_OID.test(candidate)) {
                    return candidate.toLowerCase();
                }
            }
        }
    }
    return undefined;
}

function resolveParentCommitOids(gitDir: string, targetGitRef: string): string[] {
    const existingRefOid = resolveGitRefOid(gitDir, targetGitRef);
    if (existingRefOid) {
        return [existingRefOid];
    }
    const headOid = resolveGitRefOid(gitDir, 'HEAD');
    return headOid ? [headOid] : [];
}

function buildCompliantCommitMessage(
    cardId: string,
    cellId: string,
    worktreeId: string,
    files: readonly StagedFileEntry[],
    score: number,
): string {
    const fileSummary = files.length > 0
        ? files.slice(0, 5).map((entry) => entry.path).join(', ')
        : worktreeId;
    return [
        `feat(subagent): persist verified worktree commit for ${cardId}`,
        '',
        '[Project / 项目归属]',
        '- fractal-git',
        '',
        '[Why / 动机背景]',
        `- Materialize pre-review changes from ${worktreeId} inside cell ${cellId} onto fractal history.`,
        '',
        '[Added / 新增内容]',
        `- Recorded staged payload (${files.length} file(s)): ${fileSummary}`,
        '',
        '[Verification / 验证结论]',
        `- Pre-review gate check confirmed ${fileSummary} scored ${score} without conflict markers or allocation violations.`,
    ].join('\n');
}

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
            gitRef: `${FRACTAL_REF.CELLS_PREFIX}${cellId}/card/${cardId}/sub/${subagentId}`,
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
                filePath: string,
                content: Uint8Array | string,
                executable = false,
            ) => {
                stagedFiles.push({
                    path: filePath,
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
                const parentCommitOids = resolveParentCommitOids(this.gitDir, ref.gitRef);
                const message = buildCompliantCommitMessage(
                    cardId,
                    cellId,
                    worktreeId,
                    stagedFiles,
                    verdict.score,
                );
                return materializeCommitPure(this.gitDir, {
                    targetRef: ref,
                    parentCommitOids,
                    files: stagedFiles,
                    message,
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
