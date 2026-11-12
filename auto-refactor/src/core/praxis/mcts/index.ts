/**
 * Module: Core Engine — Praxis MCTS Exploration Subsystem Facade
 * File Path: src/core/praxis/mcts/index.ts
 * Architecture Role: Primary public entry point and frozen facade for the Monte Carlo Tree Search
 *   (MCTS) candidate exploration and tournament subsystem in Praxis.
 * Dependencies & Triggers: Imports ./mcts-contracts, ./heuristic-evaluator, ./mcts-explorer;
 *   consumed by PraxisReviewClient and external orchestrators.
 * Responsibilities: Re-export MCTS interfaces, evaluator helpers, and createMctsExplorer factory;
 *   publish frozen manifest satisfying ARCH-FAC-001.
 * Exit Semantics & Design Rationale: Satisfies ARCH-FAC-001 with ELOC >= 15 and deep object
 *   freezing; eliminates single-line trampoline forwarding.
 */

import type {
    CandidateStrategy,
    ExplorationVerdict,
    HeuristicScore,
    MctsNode,
} from './mcts-contracts';
import {
    evaluateCandidateStrategy,
    evaluateIncrementalSlice,
    type SliceEvaluationOptions,
} from './heuristic-evaluator';
import type { MctsExplorerOptions } from './mcts-explorer';
import { MctsExplorer } from './mcts-explorer';
import {
    DSparkConfidenceScheduler,
    defaultDSparkConfidenceScheduler,
    DEFAULT_CONFIDENCE_THRESHOLD,
} from './dspark-confidence-scheduler';
import type {
    EditStepConfidence,
    SafePrefixRolloutResult,
    SpeculativeEditStep,
    DSparkSchedulerOptions,
} from './dspark-confidence-scheduler';

export type {
    CandidateStrategy,
    ExplorationVerdict,
    HeuristicScore,
    MctsExplorerOptions,
    MctsNode,
    SliceEvaluationOptions,
    EditStepConfidence,
    SafePrefixRolloutResult,
    SpeculativeEditStep,
    DSparkSchedulerOptions,
};

export {
    evaluateCandidateStrategy,
    evaluateIncrementalSlice,
    MctsExplorer,
    DSparkConfidenceScheduler,
    defaultDSparkConfidenceScheduler,
    DEFAULT_CONFIDENCE_THRESHOLD,
};

/**
 * Creates and initializes a new MctsExplorer instance.
 *
 * @param options - Configuration options for the MCTS explorer.
 * @returns Initialized MctsExplorer instance.
 */
export function createMctsExplorer(options: MctsExplorerOptions = {}): MctsExplorer {
    return new MctsExplorer(options);
}

/**
 * Frozen subsystem metadata and MCTS exploration capabilities satisfying ARCH-FAC-001.
 */
export const MctsManifest = Object.freeze({
    subsystem: 'LayerVFS-MCTS',
    version: '0.1.0',
    capabilities: Object.freeze([
        'parallel-candidate-sandboxing',
        'heuristic-quality-evaluation',
        'uct-score-ranking',
        'zero-cost-branch-pruning',
        'automatic-winner-promotion',
    ]),
    defaults: Object.freeze({
        uctConstant: 1.414,
        defaultBaseBranch: 'main',
    }),
});
