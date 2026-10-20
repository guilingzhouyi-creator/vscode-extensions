/**
 * Module: Fractal Git — LayerVFS Virtual File System Adapter
 * File Path: ts/vfs/vfs-adapter.ts
 * Architecture Role: Adapts LayerVFS in-memory virtual inodes and write-buffers
 *   into StagedFileEntry candidates for atomic Fractal Git materialization.
 */

import type { StagedFileEntry } from "../contracts";

export interface VirtualFileNode {
    readonly path: string;
    readonly content: Uint8Array | string;
    readonly executable: boolean;
    readonly version: number;
}

export interface ScopeProjectionConfig {
    readonly scopes: string[];
    readonly isFull: boolean;
}

export class LayerVfsAdapter {
    private readonly virtualFiles: Map<string, VirtualFileNode> = new Map();

    /**
     * Writes or updates an in-memory virtual file node.
     */
    public writeVirtualFile(path: string, content: Uint8Array | string, executable: boolean = false): void {
        const existing = this.virtualFiles.get(path);
        const version = existing ? existing.version + 1 : 1;
        this.virtualFiles.set(path, {
            path,
            content,
            executable,
            version,
        });
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
        const isFull = scopePrefixes.length === 0 || scopePrefixes.includes("*");

        for (const [path, node] of this.virtualFiles.entries()) {
            if (!isFull) {
                const clean = path.replace(/^[/\\]+/, "").replace(/\\/g, "/");
                const matched = scopePrefixes.some((prefix) => {
                    const cleanPrefix = prefix.replace(/^[/\\]+/, "").replace(/\\/g, "/");
                    return clean.startsWith(cleanPrefix);
                });
                if (!matched) {
                    continue;
                }
            }

            candidates.push({
                path,
                mode: node.executable ? "100755" : "100644",
                content: node.content,
            });
        }
        return candidates;
    }

    /**
     * Ingests file entries from Auto LayerVFS snapshot or sandbox delta.
     */
    public ingestLayerVfsEntries(
        entries: Array<{ path: string; content?: Uint8Array | string; mode?: number }>,
        scopePrefixes?: string[],
    ): number {
        let count = 0;
        const isFull = !scopePrefixes || scopePrefixes.length === 0 || scopePrefixes.includes("*");

        for (const entry of entries) {
            if (!entry.content) {
                continue;
            }
            if (!isFull && scopePrefixes) {
                const clean = entry.path.replace(/^[/\\]+/, "").replace(/\\/g, "/");
                const matched = scopePrefixes.some((p) => {
                    const cp = p.replace(/^[/\\]+/, "").replace(/\\/g, "/");
                    return clean.startsWith(cp);
                });
                if (!matched) {
                    continue;
                }
            }
            const isExecutable = entry.mode ? (entry.mode & 0o111) !== 0 : false;
            this.writeVirtualFile(entry.path, entry.content, isExecutable);
            count++;
        }
        return count;
    }

    /**
     * Clears virtual dirty file buffers after successful materialization.
     */
    public clear(): void {
        this.virtualFiles.clear();
    }
}
