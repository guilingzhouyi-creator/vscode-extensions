/**
 * Module: Core Engine — Praxis LayerVFS Projection Engine
 * File Path: src/core/praxis/vfs/projection/projection-engine.ts
 * Architecture Role: Materializes LayerVFS virtual CAS workspaces into ephemeral physical OS
 *   directories and synchronizes external compiler/test modifications back into virtual branches.
 * Dependencies & Triggers: Imports node:fs, node:path, node:os, ./projection-contracts,
 *   ./sandbox-runner. Consumed by LayerVFS facade and MCTS exploration engines.
 * Responsibilities: Manage physical sandbox directory allocation, recursive file materialization,
 *   bidirectional state synchronization, and sandbox lifecycle cleanup.
 * Exit Semantics & Design Rationale: Guarantees zero host disk pollution by isolating projections
 *   in OS temp directories; protects host git working tree from test run artifacts; satisfies
 *   CC <= 15 and Depth <= 4.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { randomUUID } from 'node:crypto';
import type { BranchDelta } from '../cas-store';
import type { LayerVFSWorkspace } from '../workspace-manager';
import type {
    ProjectedSandbox,
    ProjectionOptions,
    SandboxCommandOptions,
    SandboxExecutionResult,
} from './projection-contracts';
import { runInSandbox } from './sandbox-runner';

/** Default execution timeout in milliseconds */
const DEFAULT_SANDBOX_TIMEOUT_MS = 30000;

/** Set of directory names to skip during reverse synchronization */
const IGNORED_SYNC_DIRS = new Set([
    'node_modules',
    '.git',
    '.cache',
    'dist',
    'build',
    'coverage',
    'target',
]);

/**
 * Concrete implementation of ProjectedSandbox.
 */
class DefaultProjectedSandbox implements ProjectedSandbox {
    public readonly sandboxId: string;
    public readonly projectedPath: string;
    public readonly workspace: LayerVFSWorkspace;
    public readonly createdAtMs: number;

    private readonly cleanOnClose: boolean;
    private readonly defaultTimeoutMs: number;
    private readonly defaultEnv?: Record<string, string>;
    private readonly baseDir?: string;
    private readonly useSparseLinks: boolean;
    private readonly instantBootstrap: boolean;
    private readonly mountedJunctions = new Set<string>();
    private isClosed = false;

    constructor(
        projectedPath: string,
        workspace: LayerVFSWorkspace,
        options: ProjectionOptions = {},
    ) {
        this.sandboxId = randomUUID();
        this.projectedPath = projectedPath;
        this.workspace = workspace;
        this.createdAtMs = Date.now();
        this.cleanOnClose = options.cleanOnClose ?? true;
        this.defaultTimeoutMs = options.timeoutMs ?? DEFAULT_SANDBOX_TIMEOUT_MS;
        this.defaultEnv = options.env;
        this.baseDir = options.baseDir ? path.resolve(options.baseDir) : undefined;
        this.useSparseLinks = options.useSparseLinks ?? true;
        this.instantBootstrap = options.instantBootstrap ?? true;
    }

    private async trySparseLink(entryPath: string, entrySize: number, destPath: string): Promise<boolean> {
        if (!this.useSparseLinks || !this.baseDir) return false;
        const hostSourcePath = path.join(this.baseDir, entryPath);
        try {
            const sourceFileStat = await fs.promises.stat(hostSourcePath);
            if (sourceFileStat.isFile() && sourceFileStat.size === entrySize) {
                await fs.promises.link(hostSourcePath, destPath);
                return true;
            }
        } catch {
            // Best-effort hardlink fallback to standard VFS byte extraction
        }
        return false;
    }

    private async materializeEntry(entry: { path: string; size: number; mode: number }): Promise<boolean> {
        const destPath = path.join(this.projectedPath, entry.path);
        const parentDir = path.dirname(destPath);
        await fs.promises.mkdir(parentDir, { recursive: true });

        const linked = await this.trySparseLink(entry.path, entry.size, destPath);
        if (linked) return true;

        const fileData = await this.workspace.getFile(entry.path);
        if (!fileData) return false;

        await fs.promises.writeFile(destPath, fileData.content, { mode: entry.mode });
        return true;
    }

    public async syncToPhysical(): Promise<number> {
        this.assertNotClosed();
        const entries = this.workspace.listFiles();
        let materializedCount = 0;

        for (const entry of entries) {
            const materialized = await this.materializeEntry(entry);
            if (materialized) {
                materializedCount++;
            }
        }

        // Instant Bootstrap: mount shared node_modules if available in baseDir
        if (this.instantBootstrap && this.baseDir) {
            await this.mountInstantDependencies();
        }

        return materializedCount;
    }

    private async mountInstantDependencies(): Promise<void> {
        if (!this.baseDir) return;
        const hostNodeModules = path.join(this.baseDir, 'node_modules');
        const sandboxNodeModules = path.join(this.projectedPath, 'node_modules');
        try {
            const nodeModulesStat = await fs.promises.stat(hostNodeModules);
            if (nodeModulesStat.isDirectory()) {
                await fs.promises.symlink(hostNodeModules, sandboxNodeModules, 'junction');
                this.mountedJunctions.add(sandboxNodeModules);
            }
        } catch {
            /* ignore if host node_modules not present */
        }
    }

    public async syncFromPhysical(): Promise<BranchDelta[]> {
        this.assertNotClosed();
        const physicalFiles = await this.scanDirectory(this.projectedPath);
        const physicalRelativePaths = new Set<string>();

        for (const absPath of physicalFiles) {
            const relPath = path.relative(this.projectedPath, absPath).replace(/\\/g, '/');
            physicalRelativePaths.add(relPath);

            const fileBytes = await fs.promises.readFile(absPath);
            const existing = await this.workspace.getFile(relPath);

            if (!existing || Buffer.compare(existing.content, fileBytes) !== 0) {
                await this.workspace.putFile(relPath, fileBytes);
            }
        }

        // Detect deleted files
        for (const entry of this.workspace.listFiles()) {
            if (!physicalRelativePaths.has(entry.path)) {
                this.workspace.deleteFile(entry.path);
            }
        }

        return this.workspace.diff();
    }

    private async scanDirectory(dir: string): Promise<string[]> {
        const results: string[] = [];
        const dirents = await fs.promises.readdir(dir, { withFileTypes: true });

        for (const dirent of dirents) {
            if (IGNORED_SYNC_DIRS.has(dirent.name)) {
                continue;
            }

            const fullPath = path.join(dir, dirent.name);
            if (dirent.isDirectory()) {
                const subFiles = await this.scanDirectory(fullPath);
                results.push(...subFiles);
            } else if (dirent.isFile()) {
                results.push(fullPath);
            }
        }

        return results;
    }

    public async runCommand(
        command: string,
        args: string[] = [],
        options: SandboxCommandOptions = {},
    ): Promise<SandboxExecutionResult> {
        this.assertNotClosed();
        return runInSandbox({
            cwd: this.projectedPath,
            command,
            args,
            timeoutMs: options.timeoutMs ?? this.defaultTimeoutMs,
            env: { ...this.defaultEnv, ...options.env },
        });
    }

    private assertNotClosed(): void {
        if (this.isClosed) {
            throw new Error(`Projected sandbox '${this.sandboxId}' is already closed`);
        }
    }

    private async safeUnmountJunction(junctionPath: string): Promise<void> {
        try {
            await fs.promises.unlink(junctionPath);
        } catch {
            try {
                await fs.promises.rmdir(junctionPath);
            } catch {
                /* ignore transient junction unmount errors */
            }
        }
    }

    public async close(): Promise<void> {
        if (this.isClosed) return;
        this.isClosed = true;

        if (!this.cleanOnClose) return;

        for (const junctionPath of this.mountedJunctions) {
            await this.safeUnmountJunction(junctionPath);
        }
        this.mountedJunctions.clear();

        try {
            await fs.promises.rm(this.projectedPath, { recursive: true, force: true });
        } catch {
            /* ignore transient cleanup errors */
        }
    }
}

/**
 * Creates and initializes a new physical projection for a LayerVFS workspace.
 *
 * Concurrency: Re-entrant and thread-safe. Allocates a unique physical sandbox directory per call.
 *
 * @param workspace - LayerVFS workspace to project.
 * @param options - Projection and cleanup configuration.
 * @returns Fully initialized ProjectedSandbox instance with materialized files.
 */
export async function projectWorkspace(
    workspace: LayerVFSWorkspace,
    options: ProjectionOptions = {},
): Promise<ProjectedSandbox> {
    const projectedPath = options.targetDir
        ? path.resolve(options.targetDir)
        : await fs.promises.mkdtemp(
              path.join(os.tmpdir(), `ar-sandbox-${workspace.cardContext.cardId}-`),
          );

    if (options.targetDir) {
        await fs.promises.mkdir(projectedPath, { recursive: true });
    }

    const sandbox = new DefaultProjectedSandbox(projectedPath, workspace, options);
    await sandbox.syncToPhysical();
    return sandbox;
}
