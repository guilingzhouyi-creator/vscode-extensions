/**
 * Module: Core Engine — Praxis MCTS Exploration Contracts
 * File Path: src/core/praxis/mcts/mcts-contracts.ts
 * Architecture Role: Compile-time single source of truth for Monte Carlo Tree Search (MCTS)
 *   exploration, candidate strategy generation, and heuristic evaluation contracts in the
 *   Praxis LayerVFS architecture.
 * Dependencies & Triggers: Imports ../contracts, ../vfs/cas-store; consumed by
 *   heuristic-evaluator.ts and mcts-explorer.ts.
 * Responsibilities: Define CandidateStrategy, MctsNode, HeuristicScore, ExplorationVerdict,
 *   and IMctsExplorer interface.
 * Exit Semantics & Design Rationale: Type-only definitions; evaluation leaves zero
 *   runtime overhead; strictly enforces typed candidate inputs and objective scoring outputs.
 */

import type { PraxisCardContext } from '../contracts';
import type { BranchDelta } from '../vfs/cas-store';
import type { LayerVFSWorkspace } from '../vfs/workspace-manager';

/**
 * Candidate refactoring strategy proposed by an agent for MCTS exploration.
 */
export interface CandidateStrategy {
    /** Unique strategy identifier e.g. "strategy-guard-clause" */
    strategyId: string;
    /** Human or machine readable strategy label */
    label: string;
    /** Strategy rationale or architectural description */
    description?: string;
    /** Map of file path to updated content */
    fileModifications: Map<string, string | Uint8Array>;
    /** Optional test or verification command to run in sandbox */
    verificationCommand?: {
        command: string;
        args?: string[];
        timeoutMs?: number;
    };
}

/**
 * Multi-dimensional heuristic evaluation score computed by Auto analyzers.
 */
export interface HeuristicScore {
    /** Overall normalized score between 0.0 and 100.0 (higher is better) */
    compositeScore: number;
    /** Verification test suite passed (true/false) */
    testsPassed: boolean;
    /** Cyclomatic complexity delta (negative is reduction = good) */
    complexityDelta: number;
    /** Number of detected rule violations */
    violationCount: number;
    /** Objective Code Autonomy Index (CAI) rating */
    caiScore: number;
    /** Explanation of positive and negative deduction factors */
    breakdown: {
        testWeight: number;
        complexityWeight: number;
        ruleWeight: number;
        caiWeight: number;
    };
}

/**
 * Node in the Monte Carlo exploration search tree.
 */
export interface MctsNode {
    /** Node identifier */
    nodeId: string;
    /** Candidate strategy tested at this node */
    strategy: CandidateStrategy;
    /** Sandboxed LayerVFS workspace handle */
    workspace: LayerVFSWorkspace;
    /** Computed heuristic evaluation score */
    score?: HeuristicScore;
    /** Number of simulation visits */
    visits: number;
    /** Upper Confidence Bound (UCT) value */
    uctValue: number;
    /** Exploration status */
    status: 'pending' | 'evaluated' | 'promoted' | 'discarded';
}

/**
 * Final consolidated outcome of an MCTS tournament exploration.
 */
export interface ExplorationVerdict {
    /** Associated Praxis task card context */
    cardContext: PraxisCardContext;
    /** Total number of candidate strategies evaluated */
    candidatesEvaluated: number;
    /** The winning strategy promoted to production */
    winningStrategy?: CandidateStrategy;
    /** Best heuristic score achieved */
    bestScore?: HeuristicScore;
    /** Resulting branch deltas of the winning candidate against base */
    winningDeltas: BranchDelta[];
    /** All evaluated candidate rankings in descending score order */
    leaderboard: Array<{
        strategyId: string;
        label: string;
        score: HeuristicScore;
        status: 'promoted' | 'discarded';
    }>;
    /** Total exploration duration in milliseconds */
    durationMs: number;
}
