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

/** Configuration parameters for multi-ply MCTS tree search expansion. */
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

/** Result descriptor produced by multi-ply tree expansion. */
export interface MultiPlyExpansionResult {
    depthExplored: number;
    timedOut: boolean;
}

/**
 * Applies candidate strategy modifications and localized edits to workspace.
 * Concurrency: Asynchronous pipeline; idempotent operation.
 * @param ws - Target LayerVFS workspace.
 * @param strategy - Candidate strategy containing modifications.
 */
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

/**
 * Captures baseline pre-modification file snapshots for incremental evaluation.
 * Concurrency: Asynchronous pipeline; read-only idempotent operation on workspace.
 * @param ws - Target LayerVFS workspace holding current branch state.
 * @param strategy - Candidate strategy whose file modifications will be evaluated.
 * @returns Map of file paths to utf8 string snapshots.
 */
export async function captureBaselineSnapshots(
    ws: LayerVFSWorkspace,
    strategy: CandidateStrategy,
): Promise<Map<string, string>> {
    const snapshots = new Map<string, string>();
    for (const filePath of strategy.fileModifications.keys()) {
        const existing = await ws.getFile(filePath);
        if (existing) {
            snapshots.set(filePath, Buffer.from(existing.content).toString('utf8'));
        }
    }
    return snapshots;
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
    for (const strat of chain) {
        await applyStrategyToWorkspace(childWs, strat);
    }

    const originalFiles = await captureBaselineSnapshots(childWs, nextCandidate);
    await applyStrategyToWorkspace(childWs, nextCandidate);
    const score = await evaluateIncrementalSlice(nextCandidate, childWs, {
        originalFiles,
        parentScore: parent.score,
    });
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

/**
 * Expands MCTS search tree across subsequent plies with timeout safety.
 * Concurrency: Asynchronous pipeline; operates across candidate workspaces.
 * @param params - Search parameters controlling exploration limits.
 * @param allNodesAccumulator - Node accumulator capturing explored states.
 * @returns Result object detailing maximum explored depth and timeout status.
 */
export async function expandMultiPlyTree(
    params: MultiPlyExpansionParams,
    allNodesAccumulator: MctsNode[],
): Promise<MultiPlyExpansionResult> {
    let currentPlyParents = params.initialNodes.slice();
    let depthExplored = 1;
    let timedOut = false;

    for (let ply = 2; ply <= params.maxDepth && !timedOut; ply++) {
        currentPlyParents.sort(
            (a, b) => (b.score?.compositeScore ?? 0) - (a.score?.compositeScore ?? 0),
        );
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
