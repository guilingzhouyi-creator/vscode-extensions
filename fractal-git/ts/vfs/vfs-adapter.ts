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
        const candidates: StagedFileEntry[] = [];
        for (const [path, node] of this.virtualFiles.entries()) {
            candidates.push({
                path,
                mode: node.executable ? "100755" : "100644",
                content: node.content,
            });
        }
        return candidates;
    }

    /**
     * Clears virtual dirty file buffers after successful materialization.
     */
    public clear(): void {
        this.virtualFiles.clear();
    }
}
