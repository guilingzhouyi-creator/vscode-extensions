/**
 * Integration Test: Workspace Orchestration & MCTS Tournament Selection
 * File Path: tests/ts/workspace-orchestration.test.ts
 */

import * as assert from 'node:assert';
import { test } from 'node:test';
import {
    runVariantTournament,
    WorkspaceOrchestrator,
} from '../../ts/index';

test('WorkspaceOrchestrator allocates and releases workspaces', () => {
    const orchestrator = new WorkspaceOrchestrator();
    assert.strictEqual(orchestrator.getActiveCount(), 0);

    const record = orchestrator.allocateWorkspace(
        { cardId: 'card-200', cellId: 'cell-alpha', agentUid: 'agent-1' },
        { tier: 'card_worktree', gitRef: 'refs/fractal/cell/cell-alpha/card/card-200' },
        { tier: 'cell_main', gitRef: 'refs/fractal/cell/cell-alpha/main' },
    );

    assert.strictEqual(orchestrator.getActiveCount(), 1);
    assert.strictEqual(record.cardContext.cardId, 'card-200');

    const removed = orchestrator.removeWorkspace(record.workspaceId);
    assert.strictEqual(removed, true);
    assert.strictEqual(orchestrator.getActiveCount(), 0);
});

test('runVariantTournament picks highest-scoring clean variant and discards flawed variants', () => {
    const candidates = [
        {
            variantId: 'var-flawed-conflict',
            agentUid: 'subagent-1',
            files: [
                {
                    path: 'math.ts',
                    mode: '100644' as const,
                    content: '<<<<<<< HEAD\nconst x = 1;\n=======\nconst x = 2;\n>>>>>>>',
                },
            ],
        },
        {
            variantId: 'var-clean-winner',
            agentUid: 'subagent-2',
            files: [
                {
                    path: 'math.ts',
                    mode: '100644' as const,
                    content: 'export const add = (a: number, b: number): number => a + b;\n',
                },
            ],
        },
    ];

    const outcome = runVariantTournament(candidates);
    assert.strictEqual(outcome.winner.variantId, 'var-clean-winner');
    assert.strictEqual(outcome.winnerScore, 100);
    assert.deepStrictEqual(outcome.discardedVariantIds, ['var-flawed-conflict']);
});
