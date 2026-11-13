/**
 * Module: Fractal Git — Multi-Agent Workspace Orchestrator
 * File Path: ts/orchestration/workspace-manager.ts
 * Architecture Role: Manages allocation and lifecycle routing of fractal workspaces
 *   bound to individual PraxisCardContext instances.
 * Dependencies & Triggers: Consumed by agent runners and the variant evaluation coordinator.
 * Responsibilities: Track active workspace records, allocate unique branches,
 *   and coordinate cleanup.
 * Exit Semantics & Design Rationale: CC <= 15 and Depth <= 4; isolates agent failures
 *   to ephemeral nodes.
 */

import type {
    FractalRefDescriptor,
    PraxisCardContext,
    StagedFileEntry,
} from '../contracts';

/**
 * Metadata record for an active fractal workspace.
 */
export interface ActiveWorkspaceRecord {
    readonly workspaceId: string;
    readonly cardContext: PraxisCardContext;
    readonly targetRef: FractalRefDescriptor;
    readonly parentRef: FractalRefDescriptor;
    readonly candidateFiles: StagedFileEntry[];
    readonly createdAtMs: number;
}

/**
 * Quarantine entry exported from an isolated workspace compatible with .taxis/quarantine format.
 */
export interface WorkspaceQuarantineEntry {
    readonly quarantineId: string;
    readonly projectId: string;
    readonly agentId: string;
    readonly relPath: string;
    readonly patchFile: string;
    readonly reason: string;
    readonly quarantinedAt: number;
    readonly status: 'Isolated' | 'Restored' | 'Discarded';
    readonly patchContent: string;
}

/**
 * Snapshot of quarantined mutations from an isolated workspace branch.
 */
export interface WorkspaceQuarantineSnapshot {
    readonly workspaceId: string;
    readonly cardId: string;
    readonly agentUid: string;
    readonly exportedAtMs: number;
    readonly records: readonly WorkspaceQuarantineEntry[];
}

/**
 * Manages allocation and tracking of active agent workspaces.
 */
export class WorkspaceOrchestrator {
    private static monotonicSeq = 0;
    private readonly activeWorkspaces = new Map<string, ActiveWorkspaceRecord>();

    /**
     * Allocates a new fractal workspace for a given task card with collision-free monotonic ID.
     */
    public allocateWorkspace(
        cardContext: PraxisCardContext,
        targetRef: FractalRefDescriptor,
        parentRef: FractalRefDescriptor,
    ): ActiveWorkspaceRecord {
        if (!cardContext.cellId?.trim() || !cardContext.cardId?.trim() || !cardContext.agentUid?.trim()) {
            throw new Error(
                'WorkspaceOrchestrator requires non-empty cellId, cardId, and agentUid coordinates',
            );
        }
        const seq = ++WorkspaceOrchestrator.monotonicSeq;
        const now = Date.now();
        const workspaceId = `ws_${cardContext.cardId}_${now}_${seq}`;
        const record: ActiveWorkspaceRecord = {
            workspaceId,
            cardContext,
            targetRef,
            parentRef,
            candidateFiles: [],
            createdAtMs: now,
        };

        this.activeWorkspaces.set(workspaceId, record);
        return record;
    }

    /**
     * Stages candidate files into the specified workspace pre-review zone with path-based deduplication.
     */
    public stageCandidateFiles(workspaceId: string, files: readonly StagedFileEntry[]): void {
        const record = this.activeWorkspaces.get(workspaceId);
        if (!record) {
            throw new Error(`Workspace ${workspaceId} not found in orchestrator`);
        }
        const indexByPath = new Map<string, number>();
        for (let i = 0; i < record.candidateFiles.length; i++) {
            indexByPath.set(record.candidateFiles[i].path, i);
        }
        for (const file of files) {
            const existingIdx = indexByPath.get(file.path);
            if (existingIdx !== undefined) {
                record.candidateFiles[existingIdx] = file;
            } else {
                indexByPath.set(file.path, record.candidateFiles.length);
                record.candidateFiles.push(file);
            }
        }
    }

    /**
     * Exports an active workspace pre-review snapshot into .taxis/quarantine compatible format.
     */
    public exportQuarantineSnapshot(
        workspaceId: string,
        reason = 'Policy or invariant violation in workspace pre-review zone',
    ): WorkspaceQuarantineSnapshot {
        const record = this.activeWorkspaces.get(workspaceId);
        if (!record) {
            throw new Error(`Workspace ${workspaceId} not found in orchestrator`);
        }
        const now = Date.now();
        const nowSec = Math.floor(now / 1000);
        const records: WorkspaceQuarantineEntry[] = record.candidateFiles.map((file, idx) => {
            const quarantineId = `quar-${nowSec}-${idx + 1}`;
            const contentStr =
                typeof file.content === 'string'
                    ? file.content
                    : Buffer.from(file.content).toString('utf8');
            const projectId = record.cardContext.cellId?.trim();
            const agentId = record.cardContext.agentUid?.trim();
            if (!projectId || !agentId) {
                throw new Error(
                    `Workspace ${workspaceId} is missing cellId or agentUid for quarantine export`,
                );
            }
            return {
                quarantineId,
                projectId,
                agentId,
                relPath: file.path,
                patchFile: `${quarantineId}.patch`,
                reason,
                quarantinedAt: nowSec,
                status: 'Isolated',
                patchContent: contentStr,
            };
        });
        return {
            workspaceId,
            cardId: record.cardContext.cardId,
            agentUid: record.cardContext.agentUid,
            exportedAtMs: now,
            records,
        };
    }

    /**
     * Retrieves an active workspace record by ID.
     */
    public getWorkspace(workspaceId: string): ActiveWorkspaceRecord | undefined {
        return this.activeWorkspaces.get(workspaceId);
    }

    /**
     * Releases and removes workspace record from active memory index.
     */
    public removeWorkspace(workspaceId: string): boolean {
        return this.activeWorkspaces.delete(workspaceId);
    }

    /**
     * Returns count of currently active workspaces.
     */
    public getActiveCount(): number {
        return this.activeWorkspaces.size;
    }
}
