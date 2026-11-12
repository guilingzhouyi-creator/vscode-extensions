/**
 * Module: Core Engine — Praxis MCTS Multi-Ply Tree Search Engine
 * File Path: src/core/praxis/mcts/mcts-tree-search.ts
 * Architecture Role: Multi-ply search tree expansion operator for MCTS refactoring tournament.
 * Dependencies & Triggers: Consumes ./mcts-contracts, ./mcts-combiner, ./heuristic-evaluator;
 *   invoked by MctsExplorer during multi-step tree rollouts.
 * Responsibilities:
 *   1. Expand ply 2 and ply 3 search tree branches using non-conflicting candidate combinations;
 *   2. Evaluate incremental slice scores on child workspaces inheriting parent metrics;
 *   3. Enforce execution deadline to terminate early without leaking sandboxes.
 * Exit Semantics & Design Rationale: CC <= 15, Depth <= 4; ensures clean workspace lifecycle.
 */

import { randomUUID } from 'node:crypto';
import type { PraxisCardContext } from '../contracts';
import type { CandidateStrategy, MctsNode } from './mcts-contracts';
import { isCompatibleWithChain } from './mcts-combiner';
import { evaluateIncrementalSlice } from './heuristic-evaluator';
import type { LayerVFSWorkspace, WorkspaceManager } from '../vfs/workspace-manager';

export interface MultiPlyExpansionParams {
    cardContext: PraxisCardContext;
    base: string;
    manager: WorkspaceManager;
    candidates: readonly CandidateStrategy[];
    initialNodes: MctsNode[];
    maxDepth: number;
    branchingFactor: number;
    deadline: number;
    totalCandidates: number;
    computeUct: (score: number, nodeVisits: number, totalVisits: number) => number;
}

export interface MultiPlyExpansionResult {
    depthExplored: number;
    timedOut: boolean;
}

export async function applyStrategyToWorkspace(
    ws: LayerVFSWorkspace,
    strategy: CandidateStrategy,
): Promise<void> {
    if (strategy.localizedEdits) {
        for (const [filePath, edits] of strategy.localizedEdits.entries()) {
            await ws.applyEdits(filePath, edits);
        }
    }
    for (const [filePath, content] of strategy.fileModifications.entries()) {
        await ws.putFile(filePath, content);
    }
}

async function createChildSearchNode(
    params: MultiPlyExpansionParams,
    parent: MctsNode,
    nextCandidate: CandidateStrategy,
    ply: number,
): Promise<MctsNode> {
    const chain = parent.strategyChain ?? [parent.strategy];
    const newChain = [...chain, nextCandidate];
    const childCard = {
        ...params.cardContext,
        cardId: `${params.cardContext.cardId}_p${ply}_${nextCandidate.strategyId}`,
    };
    const childWs = await params.manager.createWorkspace(childCard, params.base);
    for (const strat of newChain) {
        await applyStrategyToWorkspace(childWs, strat);
    }
    const score = await evaluateIncrementalSlice(nextCandidate, childWs, {
        parentScore: parent.score,
    });
    score.compositeScore = Math.min(100, Math.round((score.compositeScore + (ply - 1) * 0.5) * 100) / 100);
    const uctValue = params.computeUct(score.compositeScore, 1, params.totalCandidates);

    return {
        nodeId: randomUUID(),
        strategy: nextCandidate,
        workspace: childWs,
        score,
        visits: 1,
        uctValue,
        status: 'evaluated',
        depth: ply,
        parentId: parent.nodeId,
        strategyChain: newChain,
    };
}

export async function expandMultiPlyTree(
    params: MultiPlyExpansionParams,
    allNodesAccumulator: MctsNode[],
): Promise<MultiPlyExpansionResult> {
    let currentPlyParents = params.initialNodes.slice();
    let depthExplored = 1;
    let timedOut = false;

    for (let ply = 2; ply <= params.maxDepth && !timedOut; ply++) {
        currentPlyParents.sort((a, b) => (b.score?.compositeScore ?? 0) - (a.score?.compositeScore ?? 0));
        const topParents = currentPlyParents.slice(0, params.branchingFactor);
        const nextPlyNodes: MctsNode[] = [];

        for (const parent of topParents) {
            if (performance.now() >= params.deadline) {
                timedOut = true;
                break;
            }
            const chain = parent.strategyChain ?? [parent.strategy];
            const compatible = params.candidates.filter((c) => isCompatibleWithChain(chain, c));

            for (const candidate of compatible) {
                if (performance.now() >= params.deadline) {
                    timedOut = true;
                    break;
                }
                const childNode = await createChildSearchNode(params, parent, candidate, ply);
                nextPlyNodes.push(childNode);
                allNodesAccumulator.push(childNode);
                depthExplored = ply;
            }
        }
        if (nextPlyNodes.length === 0) break;
        currentPlyParents = nextPlyNodes;
    }

    return { depthExplored, timedOut };
}
