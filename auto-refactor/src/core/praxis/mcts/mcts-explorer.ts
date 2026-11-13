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
import { combineStrategies } from './mcts-combiner';
import {
    applyStrategyToWorkspace,
    captureBaselineSnapshots,
    expandMultiPlyTree,
} from './mcts-tree-search';
import { WorkspaceManager } from '../vfs/workspace-manager';

const DEFAULT_UCT_C = 1.414;
const DEFAULT_MAX_DEPTH = 3;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_BRANCHING_FACTOR = 3;

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
    /** Maximum exploration search depth (1-ply up to 3-ply; defaults to 3) */
    maxDepth?: number;
    /** Timeout threshold in milliseconds before triggering safe early termination */
    timeoutMs?: number;
    /** Maximum candidate branches expanded per ply (defaults to 3) */
    branchingFactor?: number;
}

/**
 * MCTS Exploration and Multi-Step Refactoring Tournament Engine.
 */
export class MctsExplorer {
    private readonly manager: WorkspaceManager;
    private readonly defaultBase: string;
    private readonly uctC: number;
    private readonly maxDepth: number;
    private readonly timeoutMs: number;
    private readonly branchingFactor: number;

    constructor(options: MctsExplorerOptions = {}) {
        this.manager = options.workspaceManager ?? new WorkspaceManager();
        this.defaultBase = options.baseBranch ?? 'main';
        this.uctC = options.uctConstant ?? DEFAULT_UCT_C;
        this.maxDepth = Math.max(1, Math.min(3, options.maxDepth ?? DEFAULT_MAX_DEPTH));
        this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        this.branchingFactor = options.branchingFactor ?? DEFAULT_BRANCHING_FACTOR;
    }

    /**
     * Executes an MCTS exploration tournament across candidate refactoring strategies.
     */
    public async explore(
        cardContext: PraxisCardContext,
        candidates: CandidateStrategy[],
        baseBranch?: string,
    ): Promise<ExplorationVerdict> {
        const startMs = performance.now();
        const deadline = startMs + this.timeoutMs;
        const base = baseBranch ?? this.defaultBase;

        if (candidates.length === 0) {
            return this.buildEmptyVerdict(cardContext, startMs);
        }

        const allNodes: MctsNode[] = [];
        let timedOut = false;

        // 1. Ply 1: Evaluate each candidate strategy individually
        for (const strategy of candidates) {
            if (performance.now() >= deadline) {
                timedOut = true;
                break;
            }
            const specificCard = {
                ...cardContext,
                cardId: `${cardContext.cardId}_${strategy.strategyId}`,
            };
            const candidateWs = await this.manager.createWorkspace(specificCard, base);
            const originalFiles = await captureBaselineSnapshots(candidateWs, strategy);
            await applyStrategyToWorkspace(candidateWs, strategy);
            const score = await evaluateCandidateStrategy(strategy, candidateWs, {
                originalFiles,
            });
            const uctValue = this.computeUct(score.compositeScore, 1, candidates.length);

            allNodes.push({
                nodeId: randomUUID(),
                strategy,
                workspace: candidateWs,
                score,
                visits: 1,
                uctValue,
                status: 'evaluated',
                depth: 1,
                strategyChain: [strategy],
            });
        }

        // 2. Multi-step tree expansion (Ply 2 and 3)
        let depthExplored = 1;
        if (this.maxDepth > 1 && !timedOut && allNodes.length > 0) {
            const expansionResult = await expandMultiPlyTree(
                {
                    cardContext,
                    base,
                    manager: this.manager,
                    candidates,
                    initialNodes: allNodes.slice(),
                    maxDepth: this.maxDepth,
                    branchingFactor: this.branchingFactor,
                    deadline,
                    totalCandidates: candidates.length,
                    computeUct: this.computeUct.bind(this),
                },
                allNodes,
            );
            depthExplored = expansionResult.depthExplored;
            timedOut = expansionResult.timedOut;
        }

        if (allNodes.length === 0) {
            return {
                cardContext,
                candidatesEvaluated: 0,
                winningDeltas: [],
                leaderboard: [],
                timedOut: true,
                durationMs: Math.round(performance.now() - startMs),
            };
        }

        // 3. Rank all nodes by composite score descending (prefer deeper verified chains on tie)
        allNodes.sort((nodeA, nodeB) => {
            const scoreA = nodeA.score?.compositeScore ?? 0;
            const scoreB = nodeB.score?.compositeScore ?? 0;
            if (Math.abs(scoreB - scoreA) < 1e-4) {
                return (nodeB.depth ?? 1) - (nodeA.depth ?? 1);
            }
            return scoreB - scoreA;
        });

        // 4. Promote winner, discard all losers safely
        const winner = allNodes[0];
        winner.status = 'promoted';
        await winner.workspace.commit(`MCTS Promoted Strategy: ${winner.strategy.label}`);
        const winningDeltas = winner.workspace.diff();

        for (let i = 1; i < allNodes.length; i++) {
            const loser = allNodes[i];
            loser.status = 'discarded';
            loser.workspace.discard();
        }

        const winningChain = winner.strategyChain ?? [winner.strategy];
        const winningStrategy =
            winningChain.length > 1 ? combineStrategies(winningChain) : winner.strategy;

        const leaderboard = allNodes.map((node) => ({
            strategyId: node.strategy.strategyId,
            label: node.strategy.label,
            score: node.score as HeuristicScore,
            status: node.status as 'promoted' | 'discarded',
        }));

        return {
            cardContext,
            candidatesEvaluated: allNodes.length,
            winningStrategy,
            bestScore: winner.score,
            winningDeltas,
            leaderboard,
            winningChain,
            treeDepthExplored: depthExplored,
            timedOut,
            durationMs: Math.round(performance.now() - startMs),
        };
    }

    private buildEmptyVerdict(cardContext: PraxisCardContext, startMs: number): ExplorationVerdict {
        return {
            cardContext,
            candidatesEvaluated: 0,
            winningDeltas: [],
            leaderboard: [],
            durationMs: Math.round(performance.now() - startMs),
        };
    }

    private computeUct(score: number, nodeVisits: number, totalVisits: number): number {
        const exploitation = score / 100.0;
        const exploration = this.uctC * Math.sqrt(Math.log(totalVisits + 1) / (nodeVisits + 1e-5));
        return Math.round((exploitation + exploration) * 1000) / 1000;
    }
}
