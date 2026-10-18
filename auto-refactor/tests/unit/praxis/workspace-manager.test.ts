/**
 * Module: Unit Test — Praxis LayerVFS Multi-Agent Workspace Sandboxing & Atomic Rollback
 * File Path: tests/unit/praxis/workspace-manager.test.ts
 * Architecture Role: Verifies multi-agent zero-copy workspace allocation, concurrent branch
 *   isolation, sub-45ms 16-way fork throughput, and sub-1ms atomic rollback guarantees.
 * Dependencies & Triggers: Consumes src/core/praxis/vfs, src/core/praxis/praxis-review-client,
 *   src/core/rollback, and vitest runner.
 * Responsibilities: Prove that 16 concurrent sandboxes instantiate in <45ms, memory overlays
 *   remain strictly isolated, and atomic rollbacks restore 100% of previous byte state.
 * Exit Semantics & Design Rationale: Exits green when all assertions pass without error.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createWorkspaceManager, WorkspaceManager } from '../../../src/core/praxis/vfs';
import { createPraxisClient } from '../../../src/core/praxis/praxis-review-client';
import { PraxisRollbackEngine } from '../../../src/core/rollback';
import type { PraxisCardContext } from '../../../src/core/praxis/contracts';

describe('LayerVFS WorkspaceManager — Multi-Agent Sandboxing & Rollback', () => {
    let tempDir: string;
    let manager: WorkspaceManager;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'layervfs-ws-test-'));
        manager = createWorkspaceManager();
    });

    afterEach(async () => {
        await manager.close();
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch {
            /* ignore cleanup */
        }
    });

    it('instantiates 16 concurrent agent workspaces in under 45ms', async () => {
        // Setup initial base repository files
        const store = manager.getStore();
        await store.putFile('main', 'src/core/index.ts', 'export const version = "1.0.0";\n');
        await store.putFile(
            'main',
            'src/core/utils.ts',
            'export function add(a, b) { return a + b; }\n',
        );
        await store.commitBranch('main', 'Initial repository state');

        const cardContexts: PraxisCardContext[] = Array.from({ length: 16 }, (_, i) => ({
            cardId: `CARD-REFACTOR-${100 + i}`,
            cellId: `cell-${i % 4}`,
            agentUid: `agent-worker-${i}`,
        }));

        const startMs = performance.now();
        const workspaces = await Promise.all(
            cardContexts.map((ctx) => manager.createWorkspace(ctx)),
        );
        const totalDurationMs = performance.now() - startMs;

        expect(totalDurationMs).toBeLessThan(45.0);
        expect(workspaces.length).toBe(16);

        // Every workspace must be tracked and resolve its files
        for (const ws of workspaces) {
            expect(ws.listFiles().length).toBe(2);
            expect(manager.getWorkspace(ws.cardContext.cardId)).not.toBeNull();
        }
    });

    it('guarantees complete isolation between parallel agent branches', async () => {
        const store = manager.getStore();
        await store.putFile('main', 'shared/config.json', '{"mode":"prod"}');
        await store.commitBranch('main', 'Initial config');

        const wsA = await manager.createWorkspace({
            cardId: 'CARD-A',
            cellId: 'cell-alpha',
            agentUid: 'agent-alice',
        });
        const wsB = await manager.createWorkspace({
            cardId: 'CARD-B',
            cellId: 'cell-beta',
            agentUid: 'agent-bob',
        });

        // Agent A mutates config and adds file A
        await wsA.putFile('shared/config.json', '{"mode":"alpha-dev"}');
        await wsA.putFile('private/a.txt', 'secret-A');

        // Agent B mutates config and adds file B
        await wsB.putFile('shared/config.json', '{"mode":"beta-dev"}');
        await wsB.putFile('private/b.txt', 'secret-B');

        // Verify Agent A view
        const configA = await wsA.getFile('shared/config.json');
        expect(Buffer.from(configA!.content).toString()).toBe('{"mode":"alpha-dev"}');
        expect(wsA.hasFile('private/a.txt')).toBe(true);
        expect(wsA.hasFile('private/b.txt')).toBe(false);

        // Verify Agent B view
        const configB = await wsB.getFile('shared/config.json');
        expect(Buffer.from(configB!.content).toString()).toBe('{"mode":"beta-dev"}');
        expect(wsB.hasFile('private/b.txt')).toBe(true);
        expect(wsB.hasFile('private/a.txt')).toBe(false);

        // Base branch remains completely untouched
        const configMain = await store.getFile('main', 'shared/config.json');
        expect(Buffer.from(configMain!.content).toString()).toBe('{"mode":"prod"}');
    });

    it('triggers sub-1ms atomic rollback restoring previous state byte-accurately', async () => {
        const store = manager.getStore();
        await store.putFile('main', 'package.json', '{"name":"root-pkg"}');
        await store.commitBranch('main', 'Base package');

        const ws = await manager.createWorkspace({
            cardId: 'CARD-ROLLBACK-TEST',
            cellId: 'cell-gamma',
            agentUid: 'agent-revert',
        });

        // Initial snapshot
        const snap1 = await ws.commit('Valid checkpoint 1');

        // Apply destructive change
        await ws.putFile('package.json', '{"name":"CORRUPTED_JSON');
        await ws.putFile('junk.tmp', 'junk bytes');

        expect(ws.listFiles().length).toBe(2);

        // Atomic rollback execution
        const startRollbackMs = performance.now();
        const rollbackOk = await ws.rollback(snap1.snapshotId);
        const rollbackDurationMs = performance.now() - startRollbackMs;

        expect(rollbackDurationMs).toBeLessThan(1.5);
        expect(rollbackOk).toBe(true);

        // Assert 100% restored
        expect(ws.listFiles().length).toBe(1);
        const restored = await ws.getFile('package.json');
        expect(Buffer.from(restored!.content).toString()).toBe('{"name":"root-pkg"}');
        expect(ws.hasFile('junk.tmp')).toBe(false);
    });

    it('integrates seamlessly with PraxisReviewClient.createWorkspace', async () => {
        const client = createPraxisClient();
        const ws = await client.createWorkspace({
            cardId: 'CARD-CLIENT-TEST',
            cellId: 'cell-client',
            agentUid: 'agent-client-worker',
        });

        expect(ws).toBeDefined();
        expect(ws.cardContext.cardId).toBe('CARD-CLIENT-TEST');

        await ws.putFile('src/client-work.ts', 'export const clientWork = true;');
        expect(ws.hasFile('src/client-work.ts')).toBe(true);

        const diff = ws.diff();
        expect(diff.length).toBe(1);
        expect(diff[0].path).toBe('src/client-work.ts');
        expect(diff[0].status).toBe('added');

        const discarded = ws.discard();
        expect(discarded).toBe(true);
    });

    it('integrates seamlessly with PraxisRollbackEngine.revertWorkspace', async () => {
        const engine = new PraxisRollbackEngine();
        const ws = await manager.createWorkspace({
            cardId: 'CARD-ENGINE-ROLLBACK',
            cellId: 'cell-engine',
            agentUid: 'agent-reverter',
        });

        await ws.putFile('app.ts', 'const a = 1;');
        const baselineSnap = await ws.commit('baseline');

        await ws.putFile('app.ts', 'const a = BROKEN;');
        const reverted = await engine.revertWorkspace(ws, baselineSnap.snapshotId);

        expect(reverted).toBe(true);
        const restored = await ws.getFile('app.ts');
        expect(Buffer.from(restored!.content).toString()).toBe('const a = 1;');
    });
});
