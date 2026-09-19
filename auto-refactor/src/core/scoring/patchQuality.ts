/**
 * Module: Core Scoring — Patch Quality Quantification Engine
 * File Path: src/core/scoring/patchQuality.ts
 * Architecture Role: Evaluates the quality transition of code changes (Before -> After -> Delta),
 *   synthesizing eight-pillar health deltas, effective density shifts, and anti-gaming gates.
 * Dependencies & Triggers: Consumes scoreFileQuality from ./hierarchicalScorer,
 *   ALL_PRIMARY_PILLARS from ./eightPillarModel, and Issue from ../types.
 * Responsibilities: Compute before/after scores, measure pillar and density deltas, identify
 *   introduced versus resolved issues, and enforce anti-gaming rejection.
 * Exit Semantics & Design Rationale: Deterministic bounded delta calculations; gaming violations
 *   strictly trigger 'gaming_rejected' verdict to protect downstream governance gates.
 */

import type { Issue } from '../types';
import type { PrimaryQualityPillar } from './eightPillarModel';
import { ALL_PRIMARY_PILLARS } from './eightPillarModel';
import type { FileQualityScore } from './hierarchicalScorer';
import { scoreFileQuality } from './hierarchicalScorer';
import { RULE_GOV_GAM_001 } from './antiGaming';

/**
 * Patch quality evaluation verdict.
 */
export type PatchQualityVerdict = 'improved' | 'neutral' | 'degraded' | 'gaming_rejected';

/**
 * Parameters for patch quality evaluation.
 */
export interface EvaluatePatchParams {
    filePath: string;
    beforeContent: string;
    afterContent: string;
    existingIssues?: Issue[];
    newIssues?: Issue[];
    domainName?: string;
    moduleName?: string;
}

/**
 * Result of patch quality evaluation.
 */
export interface PatchQualityResult {
    filePath: string;
    beforeScore: number;
    afterScore: number;
    deltaScore: number;
    effectiveDensityBefore: number;
    effectiveDensityAfter: number;
    effectiveDensityDelta: number;
    pillarDeltas: Record<PrimaryQualityPillar, number>;
    introducedIssues: Issue[];
    resolvedIssues: Issue[];
    gamingViolations: Issue[];
    verdict: PatchQualityVerdict;
    explanation: string[];
    beforeDetails: FileQualityScore;
    afterDetails: FileQualityScore;
}

/**
 * Calculates issue differential between before and after states.
 */
function diffIssues(
    before: Issue[],
    after: Issue[],
): { introduced: Issue[]; resolved: Issue[]; gaming: Issue[] } {
    const beforeRules = new Set(before.map((i) => `${i.rule}:${i.location.start.line}`));
    const afterRules = new Set(after.map((i) => `${i.rule}:${i.location.start.line}`));

    const introduced = after.filter((i) => !beforeRules.has(`${i.rule}:${i.location.start.line}`));
    const resolved = before.filter((i) => !afterRules.has(`${i.rule}:${i.location.start.line}`));
    const gaming = introduced.filter((i) => i.rule === RULE_GOV_GAM_001);

    return { introduced, resolved, gaming };
}

/**
 * Resolves patch verdict based on delta score and gaming detections.
 */
function resolvePatchVerdict(deltaScore: number, gamingCount: number): PatchQualityVerdict {
    if (gamingCount > 0) {
        return 'gaming_rejected';
    }
    if (deltaScore > 0.5) {
        return 'improved';
    }
    if (deltaScore < -0.5) {
        return 'degraded';
    }
    return 'neutral';
}

/**
 * Evaluates the quality change between before and after versions of a file.
 *
 * @param params - Configuration parameters including file path and before/after contents.
 * @returns Quantified patch quality result including delta score and verdict.
 */
export function evaluatePatchQuality(params: EvaluatePatchParams): PatchQualityResult {
    const {
        filePath,
        beforeContent,
        afterContent,
        existingIssues = [],
        newIssues = [],
        domainName = 'core',
        moduleName = 'root',
    } = params;

    const beforeDetails = scoreFileQuality(
        filePath,
        beforeContent,
        existingIssues,
        domainName,
        moduleName,
    );
    const afterDetails = scoreFileQuality(
        filePath,
        afterContent,
        newIssues,
        domainName,
        moduleName,
    );

    const { introduced, resolved, gaming } = diffIssues(beforeDetails.issues, afterDetails.issues);

    const beforeScore = beforeDetails.compositeScore;
    const afterScore = afterDetails.compositeScore;
    const deltaScore = Math.round((afterScore - beforeScore) * 10) / 10;

    const effectiveDensityBefore = beforeDetails.effectiveDensity;
    const effectiveDensityAfter = afterDetails.effectiveDensity;
    const effectiveDensityDelta =
        Math.round((effectiveDensityAfter - effectiveDensityBefore) * 100) / 100;

    const pillarDeltas = {} as Record<PrimaryQualityPillar, number>;
    for (const pillar of ALL_PRIMARY_PILLARS) {
        const pBefore = beforeDetails.eightPillars.pillars[pillar];
        const pAfter = afterDetails.eightPillars.pillars[pillar];
        pillarDeltas[pillar] = Math.round((pAfter - pBefore) * 10) / 10;
    }

    const verdict = resolvePatchVerdict(deltaScore, gaming.length);

    const explanation: string[] = [
        `Quality score moved from ${beforeScore} to ${afterScore} (Delta: ${deltaScore > 0 ? '+' : ''}${deltaScore}).`,
        `Effective code density shifted from ${effectiveDensityBefore} to ${effectiveDensityAfter} (Delta: ${effectiveDensityDelta}).`,
    ];

    if (gaming.length > 0) {
        explanation.push(
            `REJECTED: Detected ${gaming.length} anti-gaming metric manipulation pattern(s).`,
        );
    }
    if (introduced.length > 0) {
        explanation.push(`Introduced ${introduced.length} new issue(s).`);
    }
    if (resolved.length > 0) {
        explanation.push(`Resolved ${resolved.length} previous issue(s).`);
    }

    return {
        filePath,
        beforeScore,
        afterScore,
        deltaScore,
        effectiveDensityBefore,
        effectiveDensityAfter,
        effectiveDensityDelta,
        pillarDeltas,
        introducedIssues: introduced,
        resolvedIssues: resolved,
        gamingViolations: gaming,
        verdict,
        explanation,
        beforeDetails,
        afterDetails,
    };
}
