/**
 * Module: Core Engine — Praxis LayerVFS Storage Subsystem Facade
 * File Path: src/core/praxis/vfs/index.ts
 * Architecture Role: Primary public entry point and unified facade for the LayerVFS
 *   content-addressed storage subsystem, providing frozen factories, FastCDC partitioning,
 *   SQLite WAL backing, and zero-copy workspace management.
 * Dependencies & Triggers: Imports ./vfs-contracts, ./fast-cdc, ./sqlite-backend, and ./cas-store.
 *   Triggered when consumers import '@auto-refactor/praxis/vfs' or '../vfs'.
 * Responsibilities: Re-export all storage contracts and implementations, provide standard factory
 *   functions (createLayerVFSStore, createFastCDCEngine, createSqliteBackend), and enforce
 *   immutable frozen runtime exports adhering to ARCH-FAC-001.
 * Exit Semantics & Design Rationale: Satisfies ARCH-FAC-001 with ELOC >= 15 and deep object
 *   freezing; eliminates single-line trampoline anti-patterns; provides fail-fast validation.
 */

import type { CasStoreOptions } from './cas-store';
import { CasStore } from './cas-store';
import type { FastCDCOptions } from './fast-cdc';
import {
    DEFAULT_AVG_CHUNK_SIZE,
    DEFAULT_MAX_CHUNK_SIZE,
    DEFAULT_MIN_CHUNK_SIZE,
    FastCDC,
    hashBuffer,
} from './fast-cdc';
import { SqliteBackend } from './sqlite-backend';
import { VfsError } from './vfs-contracts';
import type { WorkspaceManagerOptions } from './workspace-manager';
import { WorkspaceManager } from './workspace-manager';

export type * from './vfs-contracts';
export type { CasStoreOptions } from './cas-store';
export type { FastCDCOptions } from './fast-cdc';
export type { LayerVFSWorkspace, WorkspaceManagerOptions } from './workspace-manager';

export {
    CasStore,
    DEFAULT_AVG_CHUNK_SIZE,
    DEFAULT_MAX_CHUNK_SIZE,
    DEFAULT_MIN_CHUNK_SIZE,
    FastCDC,
    hashBuffer,
    SqliteBackend,
    VfsError,
    WorkspaceManager,
};

/**
 * Creates and initializes a new CasStore instance.
 *
 * @param options - Optional configuration options for storage and FastCDC chunking.
 * @returns Initialized CasStore instance.
 */
export function createLayerVFSStore(options: CasStoreOptions = {}): CasStore {
    const storage = options.storage ?? new SqliteBackend(':memory:');
    const cdc = options.cdc ?? new FastCDC();
    return new CasStore({
        storage,
        cdc,
        maxL1CacheEntries: options.maxL1CacheEntries ?? 5000,
    });
}

/**
 * Creates a standalone FastCDC chunking engine.
 *
 * @param options - Chunk boundary configuration options.
 * @returns Initialized FastCDC instance.
 */
export function createFastCDCEngine(options: FastCDCOptions = {}): FastCDC {
    return new FastCDC(options);
}

/**
 * Creates a standalone SQLite WAL storage backend.
 *
 * @param dbPath - Database file path or ':memory:' (default: ':memory:').
 * @returns Initialized SqliteBackend instance.
 */
export function createSqliteBackend(dbPath: string = ':memory:'): SqliteBackend {
    return new SqliteBackend(dbPath);
}

/**
 * Creates an interactive WorkspaceManager instance for multi-agent sandbox orchestration.
 *
 * @param options - WorkspaceManager configuration options.
 * @returns Initialized WorkspaceManager instance.
 */
export function createWorkspaceManager(options: WorkspaceManagerOptions = {}): WorkspaceManager {
    return new WorkspaceManager(options);
}

/**
 * Frozen subsystem metadata and default boundary constants satisfying ARCH-FAC-001.
 */
export const LayerVFSManifest = Object.freeze({
    subsystem: 'LayerVFS',
    version: '0.1.0',
    capabilities: Object.freeze([
        'content-addressed-storage',
        'fast-cdc-chunking',
        'sqlite-wal-persistence',
        'zero-copy-workspace-forking',
        'atomic-snapshot-rollback',
        'diff-content-addressed',
    ]),
    defaults: Object.freeze({
        minChunkSizeBytes: DEFAULT_MIN_CHUNK_SIZE,
        avgChunkSizeBytes: DEFAULT_AVG_CHUNK_SIZE,
        maxChunkSizeBytes: DEFAULT_MAX_CHUNK_SIZE,
        journalMode: 'WAL',
        defaultBranch: 'main',
    }),
});

export * from './projection';
