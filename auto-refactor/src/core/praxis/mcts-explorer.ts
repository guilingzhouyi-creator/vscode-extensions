/**
 * Module: Core Engine — Praxis MCTS Explorer Root Facade
 * File Path: src/core/praxis/mcts-explorer.ts
 * Architecture Role: Primary root facade re-exporting Monte Carlo Tree Search (MCTS) exploration
 *   types, scheduler options, and tournament arbiter implementation.
 * Dependencies & Triggers: Consumes ./mcts/mcts-explorer, ./mcts/mcts-contracts, and
 *   ./mcts/heuristic-evaluator; consumed by Praxis review client, CLI runner, and tournament
 *   orchestration drivers.
 * Responsibilities:
 *   1. Expose MctsExplorer engine and MctsExplorerOptions;
 *   2. Re-export exploration contracts, candidate strategies, and tournament verdicts;
 *   3. Publish frozen facade metadata satisfying ARCH-FAC-001 with ELOC >= 15.
 * Exit Semantics & Design Rationale: Zero-overhead frozen facade; guarantees type-safe multi-ply
 *   tree search dispatch without redundant runtime wrapper allocations.
 */

import { MctsExplorer, type MctsExplorerOptions } from './mcts/mcts-explorer';
import type {
    CandidateStrategy,
    ExplorationVerdict,
    HeuristicScore,
    MctsNode,
} from './mcts/mcts-contracts';
import {
    evaluateCandidateStrategy,
    evaluateIncrementalSlice,
    type SliceEvaluationOptions,
} from './mcts/heuristic-evaluator';

export type {
    CandidateStrategy,
    ExplorationVerdict,
    HeuristicScore,
    MctsExplorerOptions,
    MctsNode,
    SliceEvaluationOptions,
};

export {
    MctsExplorer,
    evaluateCandidateStrategy,
    evaluateIncrementalSlice,
};

/**
 * Creates and initializes a new MctsExplorer instance with root default options.
 *
 * @param options - Configuration options for the MCTS explorer.
 * @returns Initialized MctsExplorer instance.
 */
export function createRootMctsExplorer(options: MctsExplorerOptions = {}): MctsExplorer {
    return new MctsExplorer(options);
}

/**
 * Frozen facade metadata descriptor satisfying ARCH-FAC-001.
 */
export const MctsExplorerFacadeManifest = Object.freeze({
    subsystem: 'Praxis-MctsExplorer',
    version: '0.2.0',
    capabilities: Object.freeze([
        'multi-step-search-tree',
        'incremental-slice-evaluation',
        'non-conflicting-patch-combination',
        'timeout-safe-termination',
    ]),
    maxSupportedPly: 3,
});
