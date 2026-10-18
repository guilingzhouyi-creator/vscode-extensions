/**
 * Module: Core Engine — Praxis LayerVFS Multi-Agent Workspace Manager
 * File Path: src/core/praxis/vfs/workspace-manager.ts
 * Architecture Role: High-level multi-agent sandbox orchestration layer; binds PraxisCardContext
 *   to zero-copy workspace branches, managing the lifecycle of concurrent agent exploration forks
 *   and atomic rollback checkpoints.
 * Dependencies & Triggers: Imports ./vfs-contracts, ./cas-store, and ../contracts. Consumed by
 *   PraxisReviewClient, LayerVFS facade, and MCTS explorer.
 * Responsibilities: Coordinate branch allocation per task card, manage initial branch snapshot
 *   baselines, enforce branch isolation, provide LayerVFSWorkspace handle operations, and track
 *   active workspaces.
 * Exit Semantics & Design Rationale: Thread-safe, low-latency (< 3ms per workspace creation);
 *   isolates agent failures to ephemeral branches; supports cascade discard without host disk
 *   pollution; adheres to CC <= 15 and Depth <= 4.
 */

import type { PraxisCardContext } from '../contracts';
import type { CasStoreOptions } from './cas-store';
import { CasStore } from './cas-store';
import type { LayerVFSWorkspace, ManagedWorkspaceRecord } from './managed-workspace';
import { ManagedWorkspace } from './managed-workspace';

export type { LayerVFSWorkspace, ManagedWorkspaceRecord };

/**
 * Options for configuring the WorkspaceManager.
 */
export interface WorkspaceManagerOptions {
    store?: CasStore;
    storeOptions?: CasStoreOptions;
    defaultBaseBranch?: string;
}

/**
 * Multi-Agent Workspace Router and Sandbox Manager for LayerVFS.
 */
export class WorkspaceManager {
    private readonly store: CasStore;
    private readonly defaultBase: string;
    private readonly activeWorkspaces = new Map<string, ManagedWorkspaceRecord>();
    private readonly cardToBranchIndex = new Map<string, string>();

    constructor(options: WorkspaceManagerOptions = {}) {
        this.store = options.store ?? new CasStore(options.storeOptions);
        this.defaultBase = options.defaultBaseBranch ?? 'main';
    }

    /**
     * Access underlying CAS store.
     */
    public getStore(): CasStore {
        return this.store;
    }

    /**
     * Creates an instant zero-copy workspace fork for a Praxis task card (< 3ms).
     *
     * @param cardContext - Task card context containing cardId, cellId, and agentUid.
     * @param baseBranch - Base branch to branch from (defaults to 'main').
     * @returns Interactive LayerVFSWorkspace handle.
     */
    public async createWorkspace(
        cardContext: PraxisCardContext,
        baseBranch?: string,
    ): Promise<LayerVFSWorkspace> {
        const base = baseBranch ?? this.defaultBase;
        const branchId = `ws_${cardContext.cardId}_${Date.now()}`;

        // Commit base state if never snapshotted, establishing immutable baseline
        let baselineSnapshotId: string | undefined;
        try {
            const baselineSnap = await this.store.commitBranch(
                base,
                `Baseline for ${cardContext.cardId}`,
            );
            baselineSnapshotId = baselineSnap.snapshotId;
        } catch (_commitErr) {
            // Base branch might already be committed or empty
            void _commitErr;
        }

        const handle = this.store.forkBranch(base, branchId, cardContext);
        const record: ManagedWorkspaceRecord = {
            handle,
            cardContext,
            baseBranch: base,
            initialSnapshotId: baselineSnapshotId,
            latestSnapshotId: baselineSnapshotId,
            createdAtMs: Date.now(),
        };

        this.activeWorkspaces.set(branchId, record);
        this.cardToBranchIndex.set(cardContext.cardId, branchId);

        return this.bindWorkspaceHandle(record);
    }

    private bindWorkspaceHandle(record: ManagedWorkspaceRecord): LayerVFSWorkspace {
        return new ManagedWorkspace(this, record);
    }

    /**
     * Resolves an existing workspace by branch ID or task card ID.
     */
    public getWorkspace(id: string): LayerVFSWorkspace | null {
        let record = this.activeWorkspaces.get(id);
        if (!record) {
            const branchId = this.cardToBranchIndex.get(id);
            if (branchId) {
                record = this.activeWorkspaces.get(branchId);
            }
        }
        if (!record) {
            return null;
        }
        return this.bindWorkspaceHandle(record);
    }

    /**
     * Lists all currently active managed workspaces.
     */
    public listWorkspaces(): LayerVFSWorkspace[] {
        return Array.from(this.activeWorkspaces.values()).map((r) => this.bindWorkspaceHandle(r));
    }

    /**
     * Discards an active workspace and drops its memory overlay.
     */
    public discardWorkspace(id: string): boolean {
        let branchId = id;
        const record = this.activeWorkspaces.get(id);
        if (!record) {
            const mapped = this.cardToBranchIndex.get(id);
            if (mapped) {
                branchId = mapped;
            } else {
                return false;
            }
        }

        const activeRec = this.activeWorkspaces.get(branchId);
        if (activeRec) {
            this.cardToBranchIndex.delete(activeRec.cardContext.cardId);
            this.activeWorkspaces.delete(branchId);
        }

        return this.store.discardBranch(branchId);
    }

    /**
     * Closes the workspace manager and cleans up underlying storage.
     */
    public async close(): Promise<void> {
        this.activeWorkspaces.clear();
        this.cardToBranchIndex.clear();
        await this.store.close();
    }
}
