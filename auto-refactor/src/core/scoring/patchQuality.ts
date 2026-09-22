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
import { RULE_GOV_GAM_001, detectDiffScoreGaming } from './antiGaming';
import {
    extractConstantEntities,
    analyzeConstantTransitions,
} from '../diff/constant-relocation-detector';

/**
 * Patch quality evaluation verdict.
 */
export type PatchQualityVerdict = 'improved' | 'neutral' | 'degraded' | 'gaming_rejected';

const VERDICT_IMPROVED: PatchQualityVerdict = 'improved';
const VERDICT_NEUTRAL: PatchQualityVerdict = 'neutral';

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
 * Calculates issue differential between before and after states, respecting line migrations.
 */
function diffIssues(
    before: Issue[],
    after: Issue[],
    lineMigrationMap: Map<number, number> = new Map(),
): { introduced: Issue[]; resolved: Issue[]; gaming: Issue[] } {
    const reverseMigrationMap = new Map<number, number>();
    for (const [oldLine, newLine] of lineMigrationMap.entries()) {
        reverseMigrationMap.set(newLine, oldLine);
    }

    const beforeRules = new Set(before.map((i) => `${i.rule}:${i.location.start.line}`));
    const afterRules = new Set(after.map((i) => `${i.rule}:${i.location.start.line}`));

    const introduced = after.filter((i) => {
        const key = `${i.rule}:${i.location.start.line}`;
        if (beforeRules.has(key)) return false;
        const oldLine = reverseMigrationMap.get(i.location.start.line);
        if (oldLine !== undefined && beforeRules.has(`${i.rule}:${oldLine}`)) {
            return false;
        }
        return true;
    });

    const resolved = before.filter((i) => {
        const key = `${i.rule}:${i.location.start.line}`;
        if (afterRules.has(key)) return false;
        const newLine = lineMigrationMap.get(i.location.start.line);
        if (newLine !== undefined && afterRules.has(`${i.rule}:${newLine}`)) {
            return false;
        }
        return true;
    });

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

    const beforeEntities = extractConstantEntities(beforeContent, filePath);
    const afterEntities = extractConstantEntities(afterContent, filePath);
    const relocationAnalysis = analyzeConstantTransitions(beforeEntities, afterEntities);

    const diffGamingResult = detectDiffScoreGaming(filePath, beforeContent, afterContent);

    const {
        introduced,
        resolved,
        gaming: issueGaming,
    } = diffIssues(beforeDetails.issues, afterDetails.issues, relocationAnalysis.lineMigrationMap);

    const gaming = [...issueGaming, ...diffGamingResult.issues];

    const beforeScore = beforeDetails.compositeScore;
    const afterScore = afterDetails.compositeScore;
    let deltaScore = Math.round((afterScore - beforeScore) * 10) / 10;

    // Pure relocation debouncing: moving constants without quality improvement
    // earns 0 positive score
    if (relocationAnalysis.hasPureRelocationsOnly && deltaScore > 0) {
        deltaScore = 0.0;
    }

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

    let verdict = resolvePatchVerdict(deltaScore, gaming.length);
    if (relocationAnalysis.hasPureRelocationsOnly && verdict === VERDICT_IMPROVED) {
        verdict = VERDICT_NEUTRAL;
    }

    const explanation: string[] = [
        `Quality score moved from ${beforeScore} to ${afterScore} (Delta: ${deltaScore > 0 ? '+' : ''}${deltaScore}).`,
        `Effective code density shifted from ${effectiveDensityBefore} to ${effectiveDensityAfter} (Delta: ${effectiveDensityDelta}).`,
    ];

    if (relocationAnalysis.hasPureRelocationsOnly) {
        explanation.push(
            `DEBOUNCED: Detected ${relocationAnalysis.relocatedCount} pure constant relocation(s) without semantic improvement; score gain clamped to 0.0.`,
        );
    }

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
