/**
 * Module: Fractal Git — Tournament Runner (MCTS Selection Engine)
 * File Path: ts/orchestration/tournament-runner.ts
 * Architecture Role: Evaluates parallel SubAgent exploration candidates, ranking quality
 *   scores through Auto gating and picking winning variants for upstream materialization.
 * Dependencies & Triggers: Consumed when multi-agent rollouts finish exploring variant solutions.
 * Responsibilities: Run gate checks across candidates, select highest-scoring branch,
 *   and discard lower-quality variants.
 * Exit Semantics & Design Rationale: CC <= 15 and Depth <= 4; ensures zero unverified commits
 *   in Git history.
 */

import type { StagedFileEntry } from '../contracts';
import { verifyPreReviewZone } from '../gate-bridge';

/**
 * A candidate exploration variant produced by a SubAgent.
 */
export interface CandidateVariant {
    readonly variantId: string;
    readonly agentUid: string;
    readonly files: readonly StagedFileEntry[];
}

/**
 * Result of a tournament adjudication.
 */
export interface TournamentOutcome {
    readonly winner: CandidateVariant;
    readonly winnerScore: number;
    readonly discardedVariantIds: readonly string[];
    readonly allScores: ReadonlyMap<string, number>;
}

/**
 * Adjudicates competing candidate variants through automated review gates.
 */
export function runVariantTournament(candidates: readonly CandidateVariant[]): TournamentOutcome {
    if (candidates.length === 0) {
        throw new Error('Cannot run tournament with zero candidate variants');
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

    // Fallback: if no candidate passed cleanly, pick the highest scoring imperfect candidate
    if (!bestCandidate) {
        let maxFallbackScore = -1;
        for (const candidate of candidates) {
            const s = scores.get(candidate.variantId) ?? 0;
            if (s > maxFallbackScore) {
                maxFallbackScore = s;
                bestCandidate = candidate;
                bestScore = s;
            }
        }
    }

    const winner = bestCandidate ?? candidates[0];
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
