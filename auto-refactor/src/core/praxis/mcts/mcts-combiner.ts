/**
 * Module: Core Engine — Praxis MCTS Patch Combiner & Conflict Arbiter
 * File Path: src/core/praxis/mcts/mcts-combiner.ts
 * Architecture Role: Evaluates mutual compatibility between candidate refactoring strategies
 *   and synthesizes consolidated multi-step candidate strategies for MCTS tree search.
 * Dependencies & Triggers: Consumes CandidateStrategy from ./mcts-contracts; invoked by
 *   MctsExplorer.
 * Responsibilities:
 *   1. Detect whole-file and partial localized AST edit overlaps (spatial conflict checking);
 *   2. Determine whether a candidate strategy is mutually disjoint with an existing strategy chain;
 *   3. Synthesize unified multi-step candidate strategies merging disjoint file modifications.
 * Exit Semantics & Design Rationale: Pure deterministic checks; guarantees fail-closed collision
 *   detection before sandboxed branch execution. CC <= 15, Depth <= 4.
 */

import type { CandidateStrategy } from './mcts-contracts';

interface LocalizedSpan {
    readonly offset: number;
    readonly length: number;
}

function hasLocalizedOverlap(
    editsA: readonly LocalizedSpan[],
    editsB: readonly LocalizedSpan[],
): boolean {
    for (const editA of editsA) {
        const endA = editA.offset + editA.length;
        for (const editB of editsB) {
            const endB = editB.offset + editB.length;
            if (!(endA <= editB.offset || endB <= editA.offset)) {
                return true;
            }
        }
    }
    return false;
}

/**
 * Checks whether two candidate strategies contain mutually conflicting file
 * modifications or edits.
 *
 * @param strategyA - First candidate strategy.
 * @param strategyB - Second candidate strategy.
 * @returns True if strategies conflict on any shared file or overlapping edit span.
 */
export function hasEditConflict(
    strategyA: CandidateStrategy,
    strategyB: CandidateStrategy,
): boolean {
    if (strategyA.strategyId === strategyB.strategyId) return true;

    for (const fileA of strategyA.fileModifications.keys()) {
        if (strategyB.fileModifications.has(fileA) || strategyB.localizedEdits?.has(fileA)) {
            return true;
        }
    }

    if (strategyA.localizedEdits) {
        for (const [fileA, editsA] of strategyA.localizedEdits.entries()) {
            if (strategyB.fileModifications.has(fileA)) return true;
            const editsB = strategyB.localizedEdits?.get(fileA);
            if (editsB && hasLocalizedOverlap(editsA, editsB)) {
                return true;
            }
        }
    }

    return false;
}

/**
 * Validates whether a candidate strategy is non-conflicting with all previous
 * strategies in a chain.
 *
 * @param chain - Ordered sequence of previously accepted strategies.
 * @param candidate - New candidate strategy considered for rollout.
 * @returns True if candidate is mutually compatible with every strategy in chain.
 */
export function isCompatibleWithChain(
    chain: readonly CandidateStrategy[],
    candidate: CandidateStrategy,
): boolean {
    return chain.every((prev) => !hasEditConflict(prev, candidate));
}

/**
 * Synthesizes a composite CandidateStrategy combining file modifications from
 * a chain of strategies.
 *
 * @param chain - Non-conflicting sequence of candidate strategies.
 * @returns Consolidated CandidateStrategy with merged modifications.
 */
export function combineStrategies(chain: readonly CandidateStrategy[]): CandidateStrategy {
    const fileModifications = new Map<string, string | Uint8Array>();
    for (const item of chain) {
        for (const [path, content] of item.fileModifications.entries()) {
            fileModifications.set(path, content);
        }
    }
    return {
        strategyId: chain.map((s) => s.strategyId).join('+'),
        label: chain.map((s) => s.label).join(' + '),
        description: chain.map((s) => s.description).filter(Boolean).join('; '),
        fileModifications,
    };
}
