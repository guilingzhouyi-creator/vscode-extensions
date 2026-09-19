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

/** Weight coefficients for patch arbitration scoring */
const WEIGHT_COMPOSITE = 0.4;
const WEIGHT_DELTA = 0.3;
const WEIGHT_DENSITY = 0.2;
const PENALTY_PER_ISSUE = 2.0;

/**
 * Computes the unified arbitration composite score for ranking.
 */
function computeArbitrationScore(
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
    return Math.round(raw * 10) / 10;
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

    const isGaming = pq.verdict === 'gaming_rejected';
    const compositeScore = patch.compositeScore ?? 90;
    const deltaScore = isGaming ? -50 : pq.deltaScore;
    const density = pq.effectiveDensityAfter;

    const arbitrationScore = isGaming
        ? -100
        : computeArbitrationScore(compositeScore, deltaScore, density, issuesCount);

    const reasons: string[] = [];
    if (isGaming) {
        reasons.push('Rejected by anti-gaming filter: metric manipulation detected');
    } else {
        reasons.push(`Quality Score: ${compositeScore}`);
        reasons.push(`Delta Score: +${deltaScore}`);
        reasons.push(`Effective Density: ${(density * 100).toFixed(1)}%`);
        if (issuesCount > 0) {
            reasons.push(`Issues Introduced: ${issuesCount}`);
        }
    }

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
        reasons,
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
