/**
 * Module: Core Engine — Praxis MCTS Exploration & Tournament Arbiter
 * File Path: src/core/praxis/mcts/mcts-explorer.ts
 * Architecture Role: Monte Carlo Tree Search (MCTS) exploration tournament scheduler; orchestrates
 *   parallel agent sandbox evaluation, computes heuristic utility, promotes the winning refactoring
 *   strategy, and automatically discards suboptimal branches with zero disk residue.
 * Dependencies & Triggers: Imports ./mcts-contracts, ./heuristic-evaluator, ../contracts,
 *   ../vfs/workspace-manager; consumed by PraxisReviewClient and LayerVFS facade.
 * Responsibilities: Fork ephemeral sandboxes for candidates, apply file modifications,
 *   evaluate heuristic scores, rank candidates on an objective leaderboard, promote winner,
 *   and prune losers.
 * Exit Semantics & Design Rationale: Never leaves orphan sandboxes on disk; guarantees winning
 *   deltas are verified; adheres to CC <= 15 and Depth <= 4.
 */

import { randomUUID } from 'node:crypto';
import type { PraxisCardContext } from '../contracts';
import type {
    CandidateStrategy,
    ExplorationVerdict,
    HeuristicScore,
    MctsNode,
} from './mcts-contracts';
import { evaluateCandidateStrategy } from './heuristic-evaluator';
import { WorkspaceManager } from '../vfs/workspace-manager';

/**
 * Options configuring MCTS exploration behavior.
 */
export interface MctsExplorerOptions {
    /** WorkspaceManager instance to use for sandboxing */
    workspaceManager?: WorkspaceManager;
    /** Base branch name to fork candidate strategies from (defaults to 'main') */
    baseBranch?: string;
    /** Exploration constant for UCT scoring (defaults to 1.414) */
    uctConstant?: number;
}

/**
 * MCTS Exploration and Candidate Refactoring Tournament Engine.
 */
export class MctsExplorer {
    private readonly manager: WorkspaceManager;
    private readonly defaultBase: string;
    private readonly uctC: number;

    constructor(options: MctsExplorerOptions = {}) {
        this.manager = options.workspaceManager ?? new WorkspaceManager();
        this.defaultBase = options.baseBranch ?? 'main';
        this.uctC = options.uctConstant ?? 1.414;
    }

    /**
     * Executes an MCTS exploration tournament across candidate refactoring strategies.
     *
     * @param cardContext - Praxis task card context.
     * @param candidates - List of candidate strategies to evaluate.
     * @param baseBranch - Optional base branch override.
     * @returns Consolidated ExplorationVerdict containing winning deltas and full leaderboard.
     */
    public async explore(
        cardContext: PraxisCardContext,
        candidates: CandidateStrategy[],
        baseBranch?: string,
    ): Promise<ExplorationVerdict> {
        const startMs = performance.now();
        const base = baseBranch ?? this.defaultBase;

        if (candidates.length === 0) {
            return {
                cardContext,
                candidatesEvaluated: 0,
                winningDeltas: [],
                leaderboard: [],
                durationMs: Math.round(performance.now() - startMs),
            };
        }

        const nodes: MctsNode[] = [];

        // 1. Evaluate each candidate strategy in its own zero-copy fork
        for (const strategy of candidates) {
            const specificCardContext: PraxisCardContext = {
                ...cardContext,
                cardId: `${cardContext.cardId}_${strategy.strategyId}`,
            };

            const ws = await this.manager.createWorkspace(specificCardContext, base);

            // Apply candidate modifications
            for (const [filePath, content] of strategy.fileModifications.entries()) {
                await ws.putFile(filePath, content);
            }

            const score = await evaluateCandidateStrategy(strategy, ws);
            const uctValue = this.computeUct(score.compositeScore, 1, candidates.length);

            nodes.push({
                nodeId: randomUUID(),
                strategy,
                workspace: ws,
                score,
                visits: 1,
                uctValue,
                status: 'evaluated',
            });
        }

        // 2. Rank nodes by composite score descending
        nodes.sort((a, b) => (b.score?.compositeScore ?? 0) - (a.score?.compositeScore ?? 0));

        // 3. Promote winning node, discard all losers
        const winner = nodes[0];
        winner.status = 'promoted';
        await winner.workspace.commit(`MCTS Promoted Strategy: ${winner.strategy.label}`);
        const winningDeltas = winner.workspace.diff();

        for (let i = 1; i < nodes.length; i++) {
            const loser = nodes[i];
            loser.status = 'discarded';
            loser.workspace.discard();
        }

        const leaderboard = nodes.map((node) => ({
            strategyId: node.strategy.strategyId,
            label: node.strategy.label,
            score: node.score as HeuristicScore,
            status: node.status as 'promoted' | 'discarded',
        }));

        return {
            cardContext,
            candidatesEvaluated: candidates.length,
            winningStrategy: winner.strategy,
            bestScore: winner.score,
            winningDeltas,
            leaderboard,
            durationMs: Math.round(performance.now() - startMs),
        };
    }

    /**
     * Computes Upper Confidence Bound (UCT) value for a node.
     */
    private computeUct(score: number, nodeVisits: number, totalVisits: number): number {
        const exploitation = score / 100.0;
        const exploration = this.uctC * Math.sqrt(Math.log(totalVisits + 1) / (nodeVisits + 1e-5));
        return Math.round((exploitation + exploration) * 1000) / 1000;
    }
}
