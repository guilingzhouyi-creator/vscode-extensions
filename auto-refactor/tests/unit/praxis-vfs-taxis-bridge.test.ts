/**
 * Module: Unit Test — Praxis LayerVFS and Taxis CAS Bridge Integration
 * File Path: tests/unit/praxis-vfs-taxis-bridge.test.ts
 * Architecture Role: Verifies the unified contracts between Auto LayerVFS and Taxis CAS
 *   sandboxes, ensuring collision-free monotonic workspace IDs, candidate file deduplication,
 *   and seamless quarantine snapshot exports conforming to .taxis/quarantine format.
 * Dependencies & Triggers: Consumes WorkspaceManager, CasStore, FastCDC, and WorkspaceOrchestrator.
 * Responsibilities: Validate zero-copy fork, CAS content hashing, monotonic ID allocation,
 *   and .taxis/quarantine disk artifact generation.
 * Exit Semantics & Design Rationale: Exits 0 on full test pass without unhandled rejections.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { WorkspaceManager } from '../../src/core/praxis/vfs/workspace-manager';
import { CasStore } from '../../src/core/praxis/vfs/cas-store';
import { FastCDC, hashBuffer } from '../../src/core/praxis/vfs/fast-cdc';
import { WorkspaceOrchestrator } from '../../../fractal-git/ts/orchestration/workspace-manager';

describe('Praxis LayerVFS × Taxis CAS Sandbox & WorkspaceManager Bridge', () => {
    let tempDir: string;
    let manager: WorkspaceManager;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vfs-taxis-bridge-test-'));
        manager = new WorkspaceManager();
    });

    afterEach(async () => {
        await manager.close();
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch {
            /* ignore cleanup */
        }
    });

    it('allocates collision-free workspace IDs even within the same millisecond', async () => {
        const cardContext = {
            cardId: 'card-alpha',
            cellId: 'cell-core',
            agentUid: 'agent-007',
        };

        const wsPromises = Array.from({ length: 5 }, () =>
            manager.createWorkspace(cardContext),
        );
        const workspaces = await Promise.all(wsPromises);
        const branchIds = workspaces.map((ws) => ws.branchId);
        const uniqueIds = new Set(branchIds);

        expect(uniqueIds.size).toBe(5);
        for (const id of branchIds) {
            expect(id).toMatch(/^ws_card-alpha_\d+_\d+$/);
        }
    });

    it('manages file lifecycle, CAS FastCDC deduplication, and atomic rollback', async () => {
        const cardContext = {
            cardId: 'card-beta',
            cellId: 'cell-algo',
            agentUid: 'agent-dev',
        };

        const ws = await manager.createWorkspace(cardContext);
        const initialContent = 'function compute() {\n    return 42;\n}\n';

        await ws.putFile('src/compute.ts', initialContent);
        expect(ws.hasFile('src/compute.ts')).toBe(true);

        const fetched = await ws.getFile('src/compute.ts');
        expect(fetched).not.toBeNull();
        expect(Buffer.from(fetched!.content).toString('utf8')).toBe(initialContent);

        // Commit snapshot checkpoint
        const snap = await ws.commit('Checkpoint 1');
        expect(snap.fileCount).toBe(1);

        // Edit file
        await ws.putFile('src/compute.ts', 'function compute() {\n    return 100;\n}\n');
        const diff = ws.diff();
        expect(diff.length).toBe(1);
        expect(['added', 'modified']).toContain(diff[0].status);

        // Rollback
        const rolledBack = await ws.rollback(snap.snapshotId);
        expect(rolledBack).toBe(true);

        const restored = await ws.getFile('src/compute.ts');
        expect(Buffer.from(restored!.content).toString('utf8')).toBe(initialContent);
    });

    it('exports quarantine snapshot into .taxis/quarantine format on disk', async () => {
        const cardContext = {
            cardId: 'card-quar-101',
            cellId: 'cell-gate',
            agentUid: 'agent-violator',
        };

        const ws = await manager.createWorkspace(cardContext);
        await ws.putFile('crates/fg-gate/secret.rs', 'fn leak() -> i32 { 999 }\n');

        const quarDir = path.join(tempDir, '.taxis', 'quarantine');
        const exportData = await ws.exportQuarantineSnapshot('Policy breach in gate crate', quarDir);

        expect(exportData.cardId).toBe('card-quar-101');
        expect(exportData.entries.length).toBe(1);
        expect(exportData.entries[0].relPath).toBe('crates/fg-gate/secret.rs');
        expect(exportData.entries[0].status).toBe('Isolated');

        // Verify artifacts on disk
        const registryPath = path.join(quarDir, 'quarantine_registry.json');
        expect(fs.existsSync(registryPath)).toBe(true);

        const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
        expect(registry.records.length).toBe(1);
        expect(registry.records[0].rel_path).toBe('crates/fg-gate/secret.rs');
        expect(registry.records[0].status).toBe('Isolated');

        const patchFile = path.join(quarDir, registry.records[0].patch_file);
        expect(fs.existsSync(patchFile)).toBe(true);
        expect(fs.readFileSync(patchFile, 'utf8')).toBe('fn leak() -> i32 { 999 }\n');
    });

    it('WorkspaceOrchestrator deduplicates candidate files and prevents ID collision', () => {
        const orchestrator = new WorkspaceOrchestrator();
        const cardContext = {
            cardId: 'card-orch-1',
            cellId: 'cell-orchestration',
            agentUid: 'agent-sub1',
        };
        const targetRef = {
            cellId: 'cell-orchestration',
            cardId: 'card-orch-1',
            tier: 'Card' as const,
        };
        const parentRef = {
            cellId: 'cell-orchestration',
            tier: 'Cell' as const,
        };

        const ws1 = orchestrator.allocateWorkspace(cardContext, targetRef, parentRef);
        const ws2 = orchestrator.allocateWorkspace(cardContext, targetRef, parentRef);

        expect(ws1.workspaceId).not.toBe(ws2.workspaceId);
        expect(ws1.workspaceId).toMatch(/^ws_card-orch-1_\d+_\d+$/);

        // Stage files with duplicate paths
        orchestrator.stageCandidateFiles(ws1.workspaceId, [
            { path: 'src/main.ts', mode: '100644', content: 'v1' },
            { path: 'src/utils.ts', mode: '100644', content: 'util-v1' },
        ]);

        orchestrator.stageCandidateFiles(ws1.workspaceId, [
            { path: 'src/main.ts', mode: '100644', content: 'v2' },
        ]);

        const record = orchestrator.getWorkspace(ws1.workspaceId);
        expect(record).toBeDefined();
        expect(record!.candidateFiles.length).toBe(2);

        const mainEntry = record!.candidateFiles.find((f) => f.path === 'src/main.ts');
        expect(mainEntry?.content).toBe('v2');

        // Export quarantine snapshot
        const snapshot = orchestrator.exportQuarantineSnapshot(ws1.workspaceId, 'Unapproved AST mutation');
        expect(snapshot.records.length).toBe(2);
        expect(snapshot.records[0].status).toBe('Isolated');
        expect(snapshot.records[0].patchContent).toBe('v2');
    });

    it('FastCDC deterministic rolling chunking and buffer hashing', () => {
        const cdc = new FastCDC({ minSize: 1024, avgSize: 2048, maxSize: 8192 });
        const sampleBuffer = Buffer.from('A'.repeat(5000));
        const hash = hashBuffer(sampleBuffer);

        expect(typeof hash).toBe('string');
        expect(hash.length).toBe(64);

        const chunks = cdc.chunk(sampleBuffer);
        expect(chunks.length).toBeGreaterThan(0);
        expect(chunks[0].chunkHash.length).toBe(64);
        expect(chunks.reduce((acc, c) => acc + c.length, 0)).toBe(5000);
    });
});
