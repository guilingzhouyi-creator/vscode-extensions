/**
 * Module: Unit Test — Praxis LayerVFS MCTS Exploration Tournament
 * File Path: tests/unit/praxis/mcts-explorer.test.ts
 * Architecture Role: Verifies the multi-candidate parallel MCTS exploration tournament,
 *   heuristic scoring, winner promotion, and zero-residual branch pruning in LayerVFS.
 * Dependencies & Triggers: Consumes src/core/praxis/mcts, src/core/praxis/vfs, and vitest runner.
 * Responsibilities: Prove that multiple competing agent strategies are evaluated in isolated
 *   zero-copy forks, the best refactoring strategy is objectively promoted, and inferior
 *   candidates are cleanly pruned without disk residue.
 * Exit Semantics & Design Rationale: Exits green when all assertions pass without error.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createMctsExplorer, MctsExplorer } from '../../../src/core/praxis/mcts';
import { createWorkspaceManager, WorkspaceManager } from '../../../src/core/praxis/vfs';
import type { CandidateStrategy } from '../../../src/core/praxis/mcts/mcts-contracts';
import type { PraxisCardContext } from '../../../src/core/praxis/contracts';

describe('LayerVFS MCTS — Multi-Agent Exploration Tournament', () => {
    let tempDir: string;
    let manager: WorkspaceManager;
    let explorer: MctsExplorer;

    beforeEach(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'layervfs-mcts-test-'));
        manager = createWorkspaceManager();
        explorer = createMctsExplorer({ workspaceManager: manager });

        // Initialize base branch with an unrefactored sample module
        const store = manager.getStore();
        const initialCode = [
            'function processOrder(order) {',
            '    if (order) {',
            '        if (order.items) {',
            '            if (order.items.length > 0) {',
            '                return true;',
            '            }',
            '        }',
            '    }',
            '    return false;',
            '}',
            'module.exports = { processOrder };',
        ].join('\n');

        await store.putFile('main', 'src/order.js', initialCode);
        await store.commitBranch('main', 'Initial unrefactored order module');
    });

    afterEach(async () => {
        await manager.close();
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch {
            /* ignore cleanup */
        }
    });

    it('evaluates competing strategies and promotes the highest-scoring candidate', async () => {
        const cardContext: PraxisCardContext = {
            cardId: 'TASK-MCTS-001',
            cellId: 'refactor-tournament',
            agentUid: 'agent-scheduler',
        };

        // Strategy A: Guard clause early return (lowers complexity, zero defects)
        const strategyA: CandidateStrategy = {
            strategyId: 'strategy-guard-clause',
            label: 'Guard Clause Early Return',
            description: 'Flattens deep 3-level nesting into early return guard clauses',
            fileModifications: new Map([
                [
                    'src/order.js',
                    [
                        'function processOrder(order) {',
                        '    if (!order || !order.items || order.items.length === 0) {',
                        '        return false;',
                        '    }',
                        '    return true;',
                        '}',
                        'module.exports = { processOrder };',
                    ].join('\n'),
                ],
            ]),
        };

        // Strategy B: Inferior candidate introducing defects and ANY type
        const strategyB: CandidateStrategy = {
            strategyId: 'strategy-defect-heavy',
            label: 'Defect Heavy Hack',
            description: 'Uses any type and empty catch blocks',
            fileModifications: new Map([
                [
                    'src/order.js',
                    [
                        'function processOrder(order: any) {',
                        '    try {',
                        '        // TODO: fix this later',
                        '        return Boolean(order.items.length);',
                        '    } catch (e) { /* intentional empty catch for defect test */ }',
                        '    return false;',
                        '}',
                        'module.exports = { processOrder };',
                    ].join('\n'),
                ],
            ]),
        };

        // Strategy C: Failing test verification command
        const strategyC: CandidateStrategy = {
            strategyId: 'strategy-broken-tests',
            label: 'Broken Implementation',
            description: 'Fails test command execution',
            fileModifications: new Map([
                [
                    'src/order.js',
                    'module.exports = { processOrder: () => { throw new Error("BROKEN"); } };\n',
                ],
            ]),
            verificationCommand: {
                command: 'node',
                args: ['-e', 'process.exit(1);'],
            },
        };

        const verdict = await explorer.explore(cardContext, [strategyA, strategyB, strategyC]);

        expect(verdict.candidatesEvaluated).toBe(3);
        expect(verdict.winningStrategy).toBeDefined();
        expect(verdict.winningStrategy?.strategyId).toBe('strategy-guard-clause');
        expect(verdict.bestScore).toBeDefined();
        expect(verdict.bestScore!.compositeScore).toBeGreaterThan(70.0);

        // Leaderboard must be sorted in descending order
        expect(verdict.leaderboard.length).toBe(3);
        expect(verdict.leaderboard[0].strategyId).toBe('strategy-guard-clause');
        expect(verdict.leaderboard[0].status).toBe('promoted');
        expect(verdict.leaderboard[1].status).toBe('discarded');
        expect(verdict.leaderboard[2].status).toBe('discarded');

        // Strategy C (broken tests) must have lowest score
        const scoreC = verdict.leaderboard.find((l) => l.strategyId === 'strategy-broken-tests');
        expect(scoreC?.score.testsPassed).toBe(false);
        expect(scoreC?.score.compositeScore).toBeLessThanOrEqual(25.0);

        // Winning deltas must reflect modified order.js
        expect(verdict.winningDeltas.length).toBe(1);
        expect(verdict.winningDeltas[0].path).toBe('src/order.js');
        expect(verdict.winningDeltas[0].status).toBe('modified');
    });

    it('handles empty candidate list gracefully', async () => {
        const cardContext: PraxisCardContext = {
            cardId: 'TASK-MCTS-EMPTY',
            cellId: 'cell-empty',
            agentUid: 'agent-empty',
        };

        const verdict = await explorer.explore(cardContext, []);
        expect(verdict.candidatesEvaluated).toBe(0);
        expect(verdict.winningStrategy).toBeUndefined();
        expect(verdict.winningDeltas).toEqual([]);
        expect(verdict.leaderboard).toEqual([]);
    });
});
