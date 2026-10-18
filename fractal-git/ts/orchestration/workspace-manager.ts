/**
 * Module: Fractal Git — Multi-Agent Workspace Orchestrator
 * File Path: ts/orchestration/workspace-manager.ts
 * Architecture Role: Manages allocation and lifecycle routing of fractal workspaces
 *   bound to individual PraxisCardContext instances.
 * Dependencies & Triggers: Consumed by agent runners and the tournament coordinator.
 * Responsibilities: Track active workspace records, allocate unique branches, and coordinate cleanup.
 * Exit Semantics & Design Rationale: CC <= 15 and Depth <= 4; isolates agent failures to ephemeral nodes.
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
 * Manages allocation and tracking of active agent workspaces.
 */
export class WorkspaceOrchestrator {
    private readonly activeWorkspaces = new Map<string, ActiveWorkspaceRecord>();

    /**
     * Allocates a new fractal workspace for a given task card.
     */
    public allocateWorkspace(
        cardContext: PraxisCardContext,
        targetRef: FractalRefDescriptor,
        parentRef: FractalRefDescriptor,
    ): ActiveWorkspaceRecord {
        const workspaceId = `ws_${cardContext.cardId}_${Date.now()}`;
        const record: ActiveWorkspaceRecord = {
            workspaceId,
            cardContext,
            targetRef,
            parentRef,
            candidateFiles: [],
            createdAtMs: Date.now(),
        };

        this.activeWorkspaces.set(workspaceId, record);
        return record;
    }

    /**
     * Stages candidate files into the specified workspace pre-review zone.
     */
    public stageCandidateFiles(workspaceId: string, files: readonly StagedFileEntry[]): void {
        const record = this.activeWorkspaces.get(workspaceId);
        if (!record) {
            throw new Error(`Workspace ${workspaceId} not found in orchestrator`);
        }
        record.candidateFiles.push(...files);
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
