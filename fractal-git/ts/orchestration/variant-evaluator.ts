/**
 * Module: Fractal Git — Branch Variant Evaluator (MCTS Selection Engine)
 * File Path: ts/orchestration/variant-evaluator.ts
 * Architecture Role: Evaluates parallel SubAgent exploration candidate variants, ranking quality
 *   scores through verification gates and selecting winning variants for upstream persistence.
 * Dependencies & Triggers: Consumed when multi-agent rollouts finish exploring variant solutions.
 * Responsibilities: Run gate checks across candidates, select highest-scoring branch,
 *   and discard lower-quality variants.
 * Exit Semantics & Design Rationale: CC <= 15 and Depth <= 4; ensures zero unverified commits
 *   in Git history.
 */

import type { StagedFileEntry } from '../contracts';
import { verifyPreReviewZone } from '../gate-bridge';

/**
 * A candidate exploration variant produced by an agent.
 */
export interface CandidateVariant {
    readonly variantId: string;
    readonly agentUid: string;
    readonly files: readonly StagedFileEntry[];
}

/**
 * Result of a branch variant evaluation and selection.
 */
export interface VariantEvaluationOutcome {
    readonly winner: CandidateVariant;
    readonly winnerScore: number;
    readonly discardedVariantIds: readonly string[];
    readonly allScores: ReadonlyMap<string, number>;
}

/**
 * Legacy compatibility alias for VariantEvaluationOutcome.
 */
export type TournamentOutcome = VariantEvaluationOutcome;

/**
 * Evaluates competing candidate branch variants through pre-review verification gates.
 *
 * @param candidates - Collection of candidate variants to evaluate.
 * @returns The evaluation outcome containing the winning candidate and scores.
 */
export function evaluateBranchVariants(candidates: readonly CandidateVariant[]): VariantEvaluationOutcome {
    if (candidates.length === 0) {
        throw new Error('Cannot evaluate zero candidate variants');
    }

    const scores = new Map<string, number>();
    let bestCandidate: CandidateVariant | undefined;
    let bestScore = -1;

    for (const candidate of candidates) {
        const verdict = verifyPreReviewZone(candidate.files);
        scores.set(candidate.variantId, verdict.score);

        if (verdict.passed && verdict.score > bestScore) {
            bestScore = verdict.score;
            bestCandidate = candidate;
        }
    }

    if (!bestCandidate) {
        const summary = candidates
            .map((c) => `${c.variantId}(score=${scores.get(c.variantId) ?? 0})`)
            .join(', ');
        throw new Error(
            `All ${candidates.length} candidate variants failed pre-review gate verification: ${summary}`,
        );
    }

    const winner = bestCandidate;
    const discardedVariantIds = candidates
        .filter((c) => c.variantId !== winner.variantId)
        .map((c) => c.variantId);

    return {
        winner,
        winnerScore: bestScore,
        discardedVariantIds,
        allScores: scores,
    };
}

/**
 * Legacy compatibility alias for evaluateBranchVariants.
 */
export const runVariantTournament = evaluateBranchVariants;
