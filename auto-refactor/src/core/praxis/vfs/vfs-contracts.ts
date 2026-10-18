/**
 * Module: Core Engine — Praxis LayerVFS Contracts & Storage Protocol
 * File Path: src/core/praxis/vfs/vfs-contracts.ts
 * Architecture Role: Compile-time single source of truth for LayerVFS content-addressed storage,
 *   FastCDC chunking, zero-copy workspace branching, and snapshot lifecycle contracts consumed
 *   by Auto and exported to Praxis consumers.
 * Dependencies & Triggers: Imports ../contracts for PraxisCardContext alignment; loaded during
 *   module resolution of ./cas-store, ./sqlite-backend, and ./index. Pure type definitions,
 *   zero runtime side effects.
 * Responsibilities: Define MountType, MountPoint, VfsNodeType, ChunkDescriptor, CASObject,
 *   VfsFileEntry, WorkspaceHandle, WorkspaceSnapshot, and IPraxisVFSStorage SPI interface.
 * Exit Semantics & Design Rationale: Type-only declarations cannot throw runtime errors and
 *   compile to zero runtime bytes; cleanly decouples storage backends (in-memory, SQLite WAL,
 *   FUSE/sparse projection) from consumption logic.
 */

import type { PraxisCardContext } from '../contracts';

/**
 * Filesystem mount types aligned with Praxis L1 Rust kernel and L4 sandbox contracts.
 */
export type MountType = 'RO' | 'HOST' | 'SANDBOX' | 'OVERLAY';

/**
 * Node type in the virtual filesystem.
 */
export type VfsNodeType = 'file' | 'directory' | 'symlink';

/**
 * VFS Error codes for structured error reporting.
 */
export type VfsErrorCode =
    | 'ERR_NOT_FOUND'
    | 'ERR_ACCESS_DENIED'
    | 'ERR_ALREADY_EXISTS'
    | 'ERR_CORRUPTED_CHUNK'
    | 'ERR_BRANCH_LOCKED'
    | 'ERR_STORAGE_EXHAUSTED'
    | 'ERR_INVALID_PATH'
    | 'ERR_PROVIDER_REQUIRED';

/**
 * Structured VFS error with error code and context metadata.
 */
export class VfsError extends Error {
    public readonly code: VfsErrorCode;
    public readonly path?: string;

    constructor(message: string, code: VfsErrorCode, path?: string) {
        super(`[LayerVFS:${code}] ${message}${path ? ` (path: ${path})` : ''}`);
        this.name = 'VfsError';
        this.code = code;
        this.path = path;
    }
}

/**
 * Mount point configuration matching Praxis kernel_vfs mount table.
 */
export interface MountPoint {
    /** Virtual path prefix, e.g. "/workspace" or "/tmp" */
    prefix: string;
    /** Mount type determining isolation and write permissions */
    mountType: MountType;
    /** Optional identifier of the physical provider backing this mount */
    providerId?: string;
    /** Target physical host path if mapped to host */
    hostPath?: string;
}

/**
 * Content-Defined Chunk descriptor produced by FastCDC.
 */
export interface ChunkDescriptor {
    /** Cryptographic hash of chunk payload (BLAKE3 or SHA-256 hex string) */
    chunkHash: string;
    /** Byte offset of this chunk in the original stream */
    offset: number;
    /** Byte length of this chunk */
    length: number;
    /** Rolling hash value at chunk boundary */
    boundaryHash: number;
}

/**
 * Content-Addressed Storage (CAS) object metadata and chunk manifest.
 */
export interface CASObject {
    /** Root content hash (Merkle root or SHA-256 of full content) */
    contentHash: string;
    /** Total byte length of content */
    byteLength: number;
    /** Ordered list of content-defined chunks comprising this object */
    chunks: ChunkDescriptor[];
    /** Timestamp when this object was persisted in epoch milliseconds */
    createdAtMs: number;
}

/**
 * File entry in the virtual workspace tree.
 */
export interface VfsFileEntry {
    /** Relative workspace path normalized with forward slashes */
    path: string;
    /** Type of filesystem node */
    type: VfsNodeType;
    /** Associated CAS content hash (null for directories) */
    contentHash: string | null;
    /** Byte length of file (0 for directories) */
    size: number;
    /** POSIX file permission mode (e.g. 0o644 or 0o755) */
    mode: number;
    /** Last modified timestamp in epoch milliseconds */
    mtimeMs: number;
}

/**
 * Snapshot of a workspace state at a point in time.
 */
export interface WorkspaceSnapshot {
    /** Unique snapshot identifier */
    snapshotId: string;
    /** Associated task card context if linked to a Praxis task */
    cardContext?: PraxisCardContext;
    /** Branch or workspace name from which snapshot was created */
    branchName: string;
    /** Merkle root hash representing the entire workspace tree */
    rootTreeHash: string;
    /** Number of tracked files in this snapshot */
    fileCount: number;
    /** Total byte size of all files in snapshot */
    totalSizeBytes: number;
    /** Creation timestamp in epoch milliseconds */
    createdAtMs: number;
    /** Optional human or machine commit description */
    message?: string;
}

/**
 * Handle to an active, mutable workspace branch.
 */
export interface WorkspaceHandle {
    /** Branch identifier */
    branchId: string;
    /** Parent snapshot or branch ID from which this workspace forked */
    parentSnapshotId?: string;
    /** Associated card ID for execution */
    cardId?: string;
    /** Creation timestamp in epoch milliseconds */
    createdAtMs: number;
    /** Status of the workspace */
    status: 'active' | 'committed' | 'discarded';
}

/**
 * Core Service Provider Interface (SPI) for LayerVFS storage backends.
 */
export interface IPraxisVFSStorage {
    /**
     * Store raw chunk payload under content hash address.
     * Idempotent: duplicate chunks return true immediately without writing.
     */
    putChunk(chunkHash: string, data: Uint8Array): Promise<boolean>;

    /**
     * Retrieve raw chunk payload by content hash.
     */
    getChunk(chunkHash: string): Promise<Uint8Array | null>;

    /**
     * Check if a chunk exists in storage.
     */
    hasChunk(chunkHash: string): Promise<boolean>;

    /**
     * Record a CAS object manifest.
     */
    putObject(object: CASObject): Promise<void>;

    /**
     * Retrieve a CAS object manifest by root content hash.
     */
    getObject(contentHash: string): Promise<CASObject | null>;

    /**
     * Create a snapshot of a branch.
     */
    createSnapshot(
        branchId: string,
        treeHash: string,
        entries: VfsFileEntry[],
        metadata?: { message?: string; cardContext?: PraxisCardContext },
    ): Promise<WorkspaceSnapshot>;

    /**
     * Retrieve a snapshot by ID.
     */
    getSnapshot(snapshotId: string): Promise<WorkspaceSnapshot | null>;

    /**
     * Retrieve all file entries belonging to a snapshot.
     */
    getSnapshotEntries(snapshotId: string): Promise<VfsFileEntry[]>;

    /**
     * Close the storage engine and flush all outstanding journals.
     */
    close(): Promise<void>;
}
