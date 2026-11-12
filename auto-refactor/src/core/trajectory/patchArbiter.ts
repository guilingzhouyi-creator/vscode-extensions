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

import type { Issue } from '../types';
import type { AgentPatchSlice, PatchArbitrationCandidate } from './types';
import { evaluatePatchQuality } from '../scoring/patchQuality';
import { SCORE_ROUNDING } from '../scoring/scorer-formulas';

/** Callback scanning a candidate file snapshot and returning detected issues. */
export type PatchIssueScanner = (filePath: string, content: string) => Issue[];

/** Options customizing multi-agent patch arbitration. */
export interface PatchArbitrationOptions {
    /** Optional issue scanner callback invoked on before/after candidate snapshots. */
    readonly issueScanner?: PatchIssueScanner;
}

/** Weight coefficients for patch arbitration scoring */
const WEIGHT_COMPOSITE = 0.4;
const WEIGHT_DELTA = 0.3;
const WEIGHT_DENSITY = 0.2;
const PENALTY_PER_ISSUE = 2.0;

/** Score of a candidate excluded before scoring, so it sorts below every measured patch. */
const EXCLUDED_CANDIDATE_SCORE = -100;

/** Delta score recorded on an anti-gaming rejection, distinct from a merely degraded patch. */
const GAMING_REJECTION_DELTA = -50;

/** Scale factor converting a unit-interval density ratio into a reported percentage. */
const PERCENT_SCALE = 100;

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
 *
 * `compositeScore` keeps the patch's own measured quality so an excluded candidate is still
 * auditable; `arbitrationScore` carries the ranking value, which for an excluded candidate is the
 * floor that puts it below every scored patch.
 *
 * @param patch - Candidate patch slice.
 * @param compositeScore - Measured composite quality of the patch.
 * @param density - Effective code density after the patch.
 * @param deltaScore - Measured before/after composite delta.
 * @param reasons - Exclusion rationales shown to the caller.
 * @returns Excluded arbitration candidate.
 */
function createBaseExcludedCandidate(
    patch: AgentPatchSlice,
    compositeScore: number,
    density: number,
    deltaScore: number,
    reasons: string[],
): PatchArbitrationCandidate {
    return {
        agentUid: patch.agentUid,
        patchId: patch.patchId,
        filePath: patch.filePath,
        compositeScore,
        arbitrationScore: EXCLUDED_CANDIDATE_SCORE,
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
 *
 * @param patch - Candidate patch slice.
 * @param compositeScore - Measured composite quality of the patch.
 * @param density - Effective code density after the patch.
 * @returns Rejected arbitration candidate.
 */
function createGamingCandidate(
    patch: AgentPatchSlice,
    compositeScore: number,
    density: number,
): PatchArbitrationCandidate {
    return createBaseExcludedCandidate(patch, compositeScore, density, GAMING_REJECTION_DELTA, [
        'Rejected by anti-gaming filter: metric manipulation detected',
    ]);
}

/**
 * Creates candidate record excluded because no quality dimension was measured.
 *
 * @param patch - Candidate patch slice.
 * @param compositeScore - Measured composite quality of the patch, or NaN when unmeasured.
 * @param density - Effective code density after the patch.
 * @param deltaScore - Measured before/after composite delta.
 * @returns Excluded arbitration candidate.
 */
function createUnmeasuredCandidate(
    patch: AgentPatchSlice,
    compositeScore: number,
    density: number,
    deltaScore: number,
): PatchArbitrationCandidate {
    return createBaseExcludedCandidate(patch, compositeScore, density, deltaScore, [
        'Excluded from arbitration: no quality dimension was measured',
    ]);
}

/**
 * Builds human-readable reason strings for scored candidates.
 *
 * The arbitration score is reported next to the composite score it was derived from, because the
 * two answer different questions and a reader that saw only one would mistake the ranking value
 * for the patch's quality.
 *
 * @param compositeScore - Measured composite quality of the patch.
 * @param arbitrationScore - Score the ranking compared on.
 * @param deltaScore - Measured before/after composite delta.
 * @param density - Effective code density after the patch.
 * @param issuesCount - Rule hits introduced by the patch.
 * @returns Ordered reason strings.
 */
function buildScoredReasons(
    compositeScore: number,
    arbitrationScore: number,
    deltaScore: number,
    density: number,
    issuesCount: number,
): string[] {
    const reasons: string[] = [
        `Quality Score: ${compositeScore}`,
        `Arbitration Score: ${arbitrationScore}`,
        `Delta Score: ${deltaScore}`,
        `Effective Density: ${(density * PERCENT_SCALE).toFixed(1)}%`,
    ];
    if (issuesCount > 0) {
        reasons.push(`Issues Introduced: ${issuesCount}`);
    }
    return reasons;
}

function createPatchIssue(
    filePath: string,
    line: number,
    spec: { rule: string; analyzer: string; severity: 'error' | 'warning'; message: string },
): Issue {
    return {
        id: `arbiter-${spec.rule}-${line}`,
        rule: spec.rule,
        severity: spec.severity,
        analyzer: spec.analyzer,
        message: spec.message,
        location: { file: filePath, start: { line, column: 1 }, end: { line, column: 1 } },
        detail: { category: spec.analyzer, fixable: false },
    };
}

function inspectSinglePatchLine(filePath: string, trimmed: string, lineNum: number, out: Issue[]): void {
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) return;
    if (trimmed.includes(': any') || trimmed.includes('as any') || trimmed.includes('<any>')) {
        out.push(createPatchIssue(filePath, lineNum, { rule: 'GOV-TYP-003', analyzer: 'governance', severity: 'warning', message: 'Type safety escape hatch (any) detected in candidate patch.' }));
    }
    if (trimmed.includes('eval(')) {
        out.push(createPatchIssue(filePath, lineNum, { rule: 'SEC-VUL-001', analyzer: 'security', severity: 'error', message: 'Arbitrary code execution pattern (eval) detected in candidate patch.' }));
    }
    if (trimmed.includes('console.log(') || trimmed.includes('console.debug(')) {
        out.push(createPatchIssue(filePath, lineNum, { rule: 'SEC-LEAK-001', analyzer: 'production-hygiene', severity: 'warning', message: 'Unfiltered console debug logging detected in candidate patch.' }));
    }
}

function appendRuleHitIssueIfMissing(collected: Issue[], filePath: string, rawHit: string, lineNum: number): void {
    const colonPos = rawHit.indexOf(':');
    const ruleCode = colonPos > 0 ? rawHit.slice(0, colonPos) : rawHit;
    for (const existing of collected) {
        if (existing.rule === ruleCode && existing.location.start.line === lineNum) return;
    }
    collected.push(createPatchIssue(filePath, lineNum, { rule: ruleCode, analyzer: 'governance', severity: 'warning', message: `Rule violation ${rawHit} reported on candidate patch.` }));
}

/**
 * Collects real or synthesized issues for a candidate snapshot via scanner callback and lightweight rules.
 */
export function inspectPatchContentIssues(
    filePath: string,
    content: string,
    ruleHitIds?: readonly string[],
    customScanner?: PatchIssueScanner,
): Issue[] {
    const collected: Issue[] = customScanner ? [...customScanner(filePath, content)] : [];
    if (content.length > 0) {
        const lines = content.split('\n');
        for (let idx = 0; idx < lines.length; idx++) {
            inspectSinglePatchLine(filePath, lines[idx].trim(), idx + 1, collected);
        }
    }
    if (ruleHitIds && ruleHitIds.length > 0) {
        for (let idx = 0; idx < ruleHitIds.length; idx++) {
            appendRuleHitIssueIfMissing(collected, filePath, ruleHitIds[idx], idx + 1);
        }
    }
    return collected;
}

/**
 * Evaluates a single candidate patch slice.
 *
 * @param patch - Candidate patch slice under evaluation.
 * @param customScanner - Optional custom scanner callback.
 * @returns Scored or excluded arbitration candidate.
 */
function evaluateCandidateSlice(
    patch: AgentPatchSlice,
    customScanner?: PatchIssueScanner,
): PatchArbitrationCandidate {
    const oldContent = patch.oldContent || '';
    const newContent = patch.newContent || '';
    const existingIssues = inspectPatchContentIssues(
        patch.filePath,
        oldContent,
        undefined,
        customScanner,
    );
    const newIssues = inspectPatchContentIssues(
        patch.filePath,
        newContent,
        patch.ruleHitIds,
        customScanner,
    );

    const qualityResult = evaluatePatchQuality({
        filePath: patch.filePath,
        beforeContent: oldContent,
        afterContent: newContent,
        existingIssues,
        newIssues,
    });
    const issuesCount = Math.max(
        patch.ruleHitIds?.length || 0,
        qualityResult.introducedIssues.length,
    );

    const density = qualityResult.effectiveDensityAfter;
    // The patch may arrive without a self-reported composite score. The before/after evaluation
    // already measured one, so ranking uses that measurement instead of substituting a constant
    // that no scan produced: a fabricated 90 would rank every unselfreported patch identically.
    const compositeScore = patch.compositeScore ?? qualityResult.afterScore;
    if (!Number.isFinite(compositeScore)) {
        return createUnmeasuredCandidate(patch, compositeScore, density, 0);
    }
    if (qualityResult.verdict === 'gaming_rejected') {
        return createGamingCandidate(patch, compositeScore, density);
    }
    if (qualityResult.verdict === 'unavailable') {
        return createUnmeasuredCandidate(
            patch,
            compositeScore,
            density,
            qualityResult.deltaScore ?? 0,
        );
    }

    const deltaScore = qualityResult.deltaScore ?? 0;
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
        compositeScore,
        arbitrationScore,
        deltaScore,
        density,
        issuesCount,
        rank: 0,
        isRecommended: false,
        reasons: buildScoredReasons(
            compositeScore,
            arbitrationScore,
            deltaScore,
            density,
            issuesCount,
        ),
    };
}

/**
 * Evaluates and ranks candidate patches from competing agents.
 */
export class PatchArbiter {
    private readonly defaultScanner?: PatchIssueScanner;

    constructor(defaultScanner?: PatchIssueScanner) {
        this.defaultScanner = defaultScanner;
    }

    /**
     * Ranks multiple candidate patches for a given file and recommends the top patch.
     */
    public arbitratePatches(
        patches: AgentPatchSlice[],
        options?: PatchArbitrationOptions | PatchIssueScanner,
    ): PatchArbitrationCandidate[] {
        if (patches.length === 0) return [];

        const scanner =
            typeof options === 'function'
                ? options
                : (options?.issueScanner ?? this.defaultScanner);
        const candidates: PatchArbitrationCandidate[] = [];
        for (const patch of patches) {
            candidates.push(evaluateCandidateSlice(patch, scanner));
        }

        // Sort descending by arbitration score, then by measured delta, then stably by agent id.
        candidates.sort((candidateA, candidateB) => {
            if (candidateB.arbitrationScore !== candidateA.arbitrationScore) {
                return candidateB.arbitrationScore - candidateA.arbitrationScore;
            }
            if (candidateB.deltaScore !== candidateA.deltaScore) {
                return candidateB.deltaScore - candidateA.deltaScore;
            }
            return candidateA.agentUid.localeCompare(candidateB.agentUid);
        });

        // Assign ranks and recommend the top patch that scored above the exclusion floor. Testing
        // the arbitration score rather than zero keeps a legitimately negative but ranked patch
        // from being labelled exclusions-only, and keeps every excluded candidate at the floor.
        let recommendedSet = false;
        for (let i = 0; i < candidates.length; i++) {
            const cand = candidates[i];
            cand.rank = i + 1;
            if (!recommendedSet && cand.arbitrationScore > EXCLUDED_CANDIDATE_SCORE) {
                cand.isRecommended = true;
                recommendedSet = true;
            }
        }

        return candidates;
    }
}

/** Default singleton instance of PatchArbiter */
export const defaultPatchArbiter = new PatchArbiter();
