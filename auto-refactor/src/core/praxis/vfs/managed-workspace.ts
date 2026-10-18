/**
 * Module: Core Engine — Praxis LayerVFS Managed Workspace Implementation
 * File Path: src/core/praxis/vfs/managed-workspace.ts
 * Architecture Role: Concrete handle representing an isolated workspace sandbox assigned to
 *   an agent; routes file operations, snapshots, rollbacks, and deltas to underlying CAS store.
 * Dependencies & Triggers: Consumes ../contracts, ./cas-store, and ./vfs-contracts. Bound by
 *   WorkspaceManager.
 * Responsibilities: Implement LayerVFSWorkspace interface, encapsulate branch operations, manage
 *   workspace commit/rollback state transitions.
 * Exit Semantics & Design Rationale: Thread-safe, non-blocking handle; encapsulates branch ID
 *   and task card context; keeps function count low and cohesive.
 */

import type { PraxisCardContext } from '../contracts';
import type { BranchDelta, CasStore } from './cas-store';
import type { VfsFileEntry, WorkspaceHandle, WorkspaceSnapshot } from './vfs-contracts';

/**
 * High-level object representing an isolated workspace sandbox assigned to an agent/card.
 */
export interface LayerVFSWorkspace {
    readonly branchId: string;
    readonly cardContext: PraxisCardContext;
    readonly baseBranch: string;
    readonly initialSnapshotId?: string;
    readonly createdAtMs: number;

    putFile(filePath: string, content: Uint8Array | string, mode?: number): Promise<VfsFileEntry>;
    getFile(filePath: string): Promise<{ entry: VfsFileEntry; content: Uint8Array } | null>;
    hasFile(filePath: string): boolean;
    deleteFile(filePath: string): boolean;
    listFiles(): VfsFileEntry[];
    commit(message?: string): Promise<WorkspaceSnapshot>;
    rollback(targetSnapshotId?: string): Promise<boolean>;
    discard(): boolean;
    diff(): BranchDelta[];
}

/**
 * Internal record of a managed workspace held by WorkspaceManager.
 */
export interface ManagedWorkspaceRecord {
    handle: WorkspaceHandle;
    cardContext: PraxisCardContext;
    baseBranch: string;
    initialSnapshotId?: string;
    latestSnapshotId?: string;
    createdAtMs: number;
}

/**
 * Workspace management delegate interface required by ManagedWorkspace.
 */
export interface WorkspaceDiscardDelegate {
    getStore(): CasStore;
    discardWorkspace(branchId: string): boolean;
}

/**
 * Concrete implementation of LayerVFSWorkspace bound to a WorkspaceManager and record.
 */
export class ManagedWorkspace implements LayerVFSWorkspace {
    constructor(
        private readonly delegate: WorkspaceDiscardDelegate,
        private readonly record: ManagedWorkspaceRecord,
    ) {}

    public get branchId(): string {
        return this.record.handle.branchId;
    }

    public get cardContext(): PraxisCardContext {
        return this.record.cardContext;
    }

    public get baseBranch(): string {
        return this.record.baseBranch;
    }

    public get initialSnapshotId(): string | undefined {
        return this.record.initialSnapshotId;
    }

    public get createdAtMs(): number {
        return this.record.createdAtMs;
    }

    public async putFile(
        filePath: string,
        content: Uint8Array | string,
        mode?: number,
    ): Promise<VfsFileEntry> {
        return this.delegate
            .getStore()
            .putFile(this.record.handle.branchId, filePath, content, mode);
    }

    public async getFile(
        filePath: string,
    ): Promise<{ entry: VfsFileEntry; content: Uint8Array } | null> {
        return this.delegate.getStore().getFile(this.record.handle.branchId, filePath);
    }

    public hasFile(filePath: string): boolean {
        return this.delegate.getStore().hasFile(this.record.handle.branchId, filePath);
    }

    public deleteFile(filePath: string): boolean {
        return this.delegate.getStore().deleteFile(this.record.handle.branchId, filePath);
    }

    public listFiles(): VfsFileEntry[] {
        return this.delegate.getStore().listFiles(this.record.handle.branchId);
    }

    public async commit(message?: string): Promise<WorkspaceSnapshot> {
        const snap = await this.delegate
            .getStore()
            .commitBranch(
                this.record.handle.branchId,
                message ?? `Snapshot for card ${this.record.cardContext.cardId}`,
            );
        this.record.latestSnapshotId = snap.snapshotId;
        return snap;
    }

    public async rollback(targetSnapshotId?: string): Promise<boolean> {
        const target = targetSnapshotId ?? this.record.initialSnapshotId;
        if (!target) {
            return false;
        }
        try {
            await this.delegate.getStore().revertBranch(this.record.handle.branchId, target);
            return true;
        } catch {
            return false;
        }
    }

    public discard(): boolean {
        return this.delegate.discardWorkspace(this.record.handle.branchId);
    }

    public diff(): BranchDelta[] {
        return this.delegate
            .getStore()
            .diffBranches(this.record.baseBranch, this.record.handle.branchId);
    }
}
