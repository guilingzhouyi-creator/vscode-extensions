/**
 * Module: Core Engine — Multi-Agent Patch Arbiter
 * File Path: src/core/trajectory/patchArbiter.ts
 * Architecture Role: Evaluates competing candidate patches submitted by parallel agents,
 *   performing multi-criteria ranking and selecting the optimal patch.
 * Dependencies & Triggers: Consumes PatchArbitrationCandidate, AgentPatchSlice from ./types
 *   and evaluatePatchQuality from ../scoring/patchQuality.
 * Responsibilities: Compute arbitration scores combining composite quality, delta score,
 *   effective density, and defect introduction, rejecting anti-gaming candidates.
 * Exit Semantics & Design Rationale: Deterministic ranking algorithm; top-ranked valid patch
 *   is marked isRecommended=true; ties broken stably by agentUid and patchId.
 */

import type { AgentPatchSlice, PatchArbitrationCandidate } from './types';
import { evaluatePatchQuality } from '../scoring/patchQuality';
import { SCORE_ROUNDING } from '../scoring/scorer-formulas';

/** Weight coefficients for patch arbitration scoring */
const WEIGHT_COMPOSITE = 0.4;
const WEIGHT_DELTA = 0.3;
const WEIGHT_DENSITY = 0.2;
const PENALTY_PER_ISSUE = 2.0;

/**
 * Computes the unified arbitration composite score for ranking.
 *
 * @param compositeScore - Base composite quality score
 * @param deltaScore - Delta score from baseline
 * @param densityRatio - Code density ratio
 * @param issuesCount - Number of detected issues
 * @returns Rounded arbitration score
 */
export function computeArbitrationScore(
    compositeScore: number,
    deltaScore: number,
    densityRatio: number,
    issuesCount: number,
): number {
    const raw =
        WEIGHT_COMPOSITE * compositeScore +
        WEIGHT_DELTA * Math.max(0, deltaScore) +
        WEIGHT_DENSITY * (densityRatio * 100) -
        PENALTY_PER_ISSUE * issuesCount;
    return Math.round(raw * SCORE_ROUNDING) / SCORE_ROUNDING;
}

/**
 * Base helper constructing an excluded/rejected arbitration candidate.
 */
function createBaseExcludedCandidate(
    patch: AgentPatchSlice,
    density: number,
    deltaScore: number,
    reasons: string[],
): PatchArbitrationCandidate {
    return {
        agentUid: patch.agentUid,
        patchId: patch.patchId,
        filePath: patch.filePath,
        compositeScore: -100,
        deltaScore,
        density,
        issuesCount: patch.ruleHitIds?.length || 0,
        rank: 0,
        isRecommended: false,
        reasons,
    };
}

/**
 * Creates candidate record rejected by anti-gaming filter.
 */
function createGamingCandidate(patch: AgentPatchSlice, density: number): PatchArbitrationCandidate {
    return createBaseExcludedCandidate(patch, density, -50, [
        'Rejected by anti-gaming filter: metric manipulation detected',
    ]);
}

/**
 * Creates candidate record excluded because no quality dimension was measured.
 */
function createUnmeasuredCandidate(
    patch: AgentPatchSlice,
    density: number,
    deltaScore: number,
): PatchArbitrationCandidate {
    return createBaseExcludedCandidate(patch, density, deltaScore, [
        'Excluded from arbitration: no quality dimension was measured',
    ]);
}

/**
 * Builds human-readable reason strings for scored candidates.
 */
function buildScoredReasons(
    compositeScore: number,
    deltaScore: number,
    density: number,
    issuesCount: number,
): string[] {
    const reasons: string[] = [
        `Quality Score: ${compositeScore}`,
        `Delta Score: +${deltaScore}`,
        `Effective Density: ${(density * 100).toFixed(1)}%`,
    ];
    if (issuesCount > 0) {
        reasons.push(`Issues Introduced: ${issuesCount}`);
    }
    return reasons;
}

/**
 * Evaluates a single candidate patch slice.
 */
function evaluateCandidateSlice(patch: AgentPatchSlice): PatchArbitrationCandidate {
    const oldContent = patch.oldContent || '';
    const newContent = patch.newContent || '';
    const issuesCount = patch.ruleHitIds?.length || 0;

    const pq = evaluatePatchQuality({
        filePath: patch.filePath,
        beforeContent: oldContent,
        afterContent: newContent,
        newIssues: [],
    });

    const density = pq.effectiveDensityAfter;
    if (pq.verdict === 'gaming_rejected') {
        return createGamingCandidate(patch, density);
    }
    if (pq.verdict === 'unavailable') {
        return createUnmeasuredCandidate(patch, density, pq.deltaScore ?? 0);
    }

    const compositeScore = patch.compositeScore ?? 90;
    const deltaScore = pq.deltaScore ?? 0;
    const arbitrationScore = computeArbitrationScore(
        compositeScore,
        deltaScore,
        density,
        issuesCount,
    );

    return {
        agentUid: patch.agentUid,
        patchId: patch.patchId,
        filePath: patch.filePath,
        compositeScore: arbitrationScore,
        deltaScore,
        density,
        issuesCount,
        rank: 0,
        isRecommended: false,
        reasons: buildScoredReasons(compositeScore, deltaScore, density, issuesCount),
    };
}

/**
 * Evaluates and ranks candidate patches from competing agents.
 */
export class PatchArbiter {
    /**
     * Ranks multiple candidate patches for a given file and recommends the top patch.
     */
    public arbitratePatches(patches: AgentPatchSlice[]): PatchArbitrationCandidate[] {
        if (patches.length === 0) return [];

        const candidates = patches.map(evaluateCandidateSlice);

        // Sort descending by arbitration score, with tie-break on agentUid
        candidates.sort((a, b) => {
            if (b.compositeScore !== a.compositeScore) {
                return b.compositeScore - a.compositeScore;
            }
            if (b.deltaScore !== a.deltaScore) {
                return b.deltaScore - a.deltaScore;
            }
            return a.agentUid.localeCompare(b.agentUid);
        });

        // Assign ranks and mark the top non-gaming candidate as recommended
        let recommendedSet = false;
        for (let i = 0; i < candidates.length; i++) {
            const cand = candidates[i];
            cand.rank = i + 1;
            if (!recommendedSet && cand.compositeScore > 0) {
                cand.isRecommended = true;
                recommendedSet = true;
            }
        }

        return candidates;
    }
}

/** Default singleton instance of PatchArbiter */
export const defaultPatchArbiter = new PatchArbiter();
