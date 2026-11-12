/**
 * Module: Fractal Git — LayerVFS Virtual File System Adapter
 * File Path: ts/vfs/vfs-adapter.ts
 * Architecture Role: Adapts LayerVFS in-memory virtual inodes and write-buffers
 *   into StagedFileEntry candidates for atomic Fractal Git materialization.
 * Dependencies & Triggers: Consumes `../contracts` (`StagedFileEntry`); invoked by
 *   agent VFS bridges.
 * Responsibilities: Maintain versioned in-memory file snapshots, enforce strict directory-boundary
 *   scope projection (`FGT-TOP-001`), and project dirty virtual files into Git staging candidates.
 * Exit Semantics & Design Rationale: Directory boundary checks require either exact equality or a
 *   trailing `'/'` boundary so scope `'src/core'` never leaks `'src/core-hack/x.ts'`.
 */

import type { StagedFileEntry } from '../contracts';

/**
 * Immutable facade metadata descriptor for the Fractal Git VFS driver.
 */
export const FRACTAL_VFS_FACADE_INFO = Object.freeze({
    subsystem: 'fractal-git',
    tier: 'vfs',
    driverVersion: '1.0.0',
});

/**
 * Virtual file system node representing an in-memory file snapshot.
 */
export interface VirtualFileNode {
    readonly path: string;
    readonly content: Uint8Array | string;
    readonly executable: boolean;
    readonly version: number;
}

/**
 * Configuration defining the active scope projection boundaries for a worktree.
 */
export interface ScopeProjectionConfig {
    readonly scopes: string[];
    readonly isFull: boolean;
}

/**
 * Checks whether `candidatePath` falls within at least one scope prefix on a `'/'` boundary.
 */
function isWithinScope(candidatePath: string, scopePrefixes?: readonly string[]): boolean {
    if (!scopePrefixes || scopePrefixes.length === 0 || scopePrefixes.includes('*')) {
        return true;
    }
    const clean = candidatePath.replace(/^[/\\]+/, '').replace(/\\/g, '/');
    return scopePrefixes.some((prefix) => {
        const cleanPrefix = prefix
            .replace(/^[/\\]+/, '')
            .replace(/\\/g, '/')
            .replace(/\/+$/, '');
        if (cleanPrefix.length === 0) {
            return true;
        }
        return clean === cleanPrefix || clean.startsWith(`${cleanPrefix}/`);
    });
}

/**
 * Adapter integrating in-memory virtual inodes into candidate staging trees.
 */
export class LayerVfsAdapter {
    private readonly virtualFiles: Map<string, VirtualFileNode> = new Map();
    private readonly tombstones: Set<string> = new Set();

    /**
     * Writes or updates an in-memory virtual file node.
     */
    public writeVirtualFile(
        path: string,
        content: Uint8Array | string,
        executable = false,
    ): void {
        const existing = this.virtualFiles.get(path);
        const version = existing ? existing.version + 1 : 1;
        this.tombstones.delete(path);
        this.virtualFiles.set(path, {
            path,
            content,
            executable,
            version,
        });
    }

    /**
     * Marks a virtual path as deleted with an explicit tombstone.
     */
    public deleteVirtualFile(path: string): void {
        this.virtualFiles.delete(path);
        this.tombstones.add(path);
    }

    /**
     * Returns all pending deletion tombstones.
     */
    public toTombstones(): string[] {
        return this.toScopedTombstones([]);
    }

    /**
     * Returns pending deletion tombstones constrained to the given scope prefixes.
     */
    public toScopedTombstones(scopePrefixes: readonly string[]): string[] {
        const deletedPaths: string[] = [];
        for (const candidatePath of this.tombstones) {
            if (isWithinScope(candidatePath, scopePrefixes)) {
                deletedPaths.push(candidatePath);
            }
        }
        return deletedPaths;
    }

    /**
     * Converts current virtual dirty files into staged candidates for commit.
     */
    public toStagedCandidates(): StagedFileEntry[] {
        return this.toScopedStagedCandidates([]);
    }

    /**
     * Converts only virtual files within the delegated scope projection into staged candidates.
     */
    public toScopedStagedCandidates(scopePrefixes: string[]): StagedFileEntry[] {
        const candidates: StagedFileEntry[] = [];
        for (const [path, node] of this.virtualFiles.entries()) {
            if (!isWithinScope(path, scopePrefixes)) {
                continue;
            }
            candidates.push({
                path,
                mode: node.executable ? '100755' : '100644',
                content: node.content,
            });
        }
        return candidates;
    }

    /**
     * Ingests file entries from Auto LayerVFS snapshot or sandbox delta.
     */
    public ingestLayerVfsEntries(
        entries: Array<{ path: string; content?: Uint8Array | string | null; mode?: number; deleted?: boolean }>,
        scopePrefixes?: string[],
    ): number {
        let count = 0;
        for (const entry of entries) {
            if (!isWithinScope(entry.path, scopePrefixes)) {
                continue;
            }
            if (entry.deleted === true || entry.content === null) {
                this.deleteVirtualFile(entry.path);
                count++;
                continue;
            }
            if (entry.content === undefined) {
                continue;
            }
            const isExecutable = entry.mode ? (entry.mode & 0o111) !== 0 : false;
            this.writeVirtualFile(entry.path, entry.content, isExecutable);
            count++;
        }
        return count;
    }

    /**
     * Clears virtual dirty file buffers and deletion tombstones after successful materialization.
     */
    public clear(): void {
        this.virtualFiles.clear();
        this.tombstones.clear();
    }
}
