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
import { scoreDelta, clampRatio } from './scorer-formulas';
import {
    extractConstantEntities,
    analyzeConstantTransitions,
} from '../diff/constant-relocation-detector';

/**
 * Patch quality evaluation verdict.
 *
 * `unavailable` is returned when either side of the patch was not measured (composite is
 * NaN). It is distinct from `neutral` on purpose: `neutral` asserts "measured, no material
 * change", and a NaN delta satisfies neither `> 0.5` nor `< -0.5`, so an unmeasured patch
 * would otherwise fall through to `neutral` and read as a passing verdict.
 */
export type PatchQualityVerdict =
    'improved' | 'neutral' | 'degraded' | 'gaming_rejected' | 'unavailable';

const VERDICT_IMPROVED: PatchQualityVerdict = 'improved';
const VERDICT_NEUTRAL: PatchQualityVerdict = 'neutral';
const VERDICT_DEGRADED: PatchQualityVerdict = 'degraded';
const VERDICT_GAMING_REJECTED: PatchQualityVerdict = 'gaming_rejected';
const VERDICT_UNAVAILABLE: PatchQualityVerdict = 'unavailable';

const PERCENT_SCALE_FACTOR = 100;
const THOUSANDTHS_SCALE_FACTOR = 1000;
const DEFAULT_PATCH_DOMAIN = 'core';
const DEFAULT_PATCH_MODULE = 'root';

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
 * Metrics representing score and effective code density deltas for a patch.
 */
export interface PatchScoreMetrics {
    beforeScore: number;
    afterScore: number;
    /** Signed score change, or null when either side was not measured (composite was NaN). */
    deltaScore: number | null;
    effectiveDensityBefore: number;
    effectiveDensityAfter: number;
    effectiveDensityDelta: number;
    compositeDensityBefore?: number;
    compositeDensityAfter?: number;
    compositeDensityDelta?: number;
    tsprDelta?: number;
    porDelta?: number;
}

/**
 * Result of patch quality evaluation.
 */
export interface PatchQualityResult extends PatchScoreMetrics {
    filePath: string;
    pillarDeltas: Record<PrimaryQualityPillar, number>;
    introducedIssues: Issue[];
    resolvedIssues: Issue[];
    gamingViolations: Issue[];
    verdict: PatchQualityVerdict;
    explanation: string[];
    beforeDetails: FileQualityScore;
    afterDetails: FileQualityScore;
    simplificationRewardBonus?: number;
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
 *
 * A null delta means one side was not measured, so the verdict is `unavailable` rather than
 * a pass: every comparison against NaN is false, so without this guard an unmeasured patch
 * would fall through to `neutral` and be reported as an acceptable change.
 */
function resolvePatchVerdict(deltaScore: number | null, gamingCount: number): PatchQualityVerdict {
    if (gamingCount > 0) {
        return VERDICT_GAMING_REJECTED;
    }
    if (deltaScore === null) {
        return VERDICT_UNAVAILABLE;
    }
    if (deltaScore > 0.5) {
        return VERDICT_IMPROVED;
    }
    if (deltaScore < -0.5) {
        return VERDICT_DEGRADED;
    }
    return VERDICT_NEUTRAL;
}

const TYPE_NUMBER = 'number';

/**
 * Sum simplification bonus reward points from issues.
 */
function computeSimplificationRewardBonus(newIssues: Issue[]): number {
    let bonus = 0;
    for (const issue of newIssues) {
        if (issue.detail && typeof issue.detail.rewardBonus === TYPE_NUMBER) {
            bonus += issue.detail.rewardBonus;
        }
    }
    return bonus;
}

/**
 * Context bundle for constructing patch quality diagnostic and evaluation explanations.
 */
export interface PatchExplanationContext {
    readonly metrics: PatchScoreMetrics;
    readonly relocationAnalysis: ReturnType<typeof analyzeConstantTransitions>;
    readonly gamingCount: number;
    readonly introducedCount: number;
    readonly resolvedCount: number;
    readonly simplificationRewardBonus: number;
}

/**
 * Construct diagnostic and evaluation explanations for a patch quality result.
 */
function buildPatchExplanations(ctx: PatchExplanationContext): string[] {
    const {
        metrics,
        relocationAnalysis,
        gamingCount,
        introducedCount,
        resolvedCount,
        simplificationRewardBonus,
    } = ctx;
    const scoreLine =
        metrics.deltaScore === null
            ? `Quality score could not be compared: the scan measured no quality dimension ` +
              `(${metrics.beforeScore} -> ${metrics.afterScore}).`
            : `Quality score moved from ${metrics.beforeScore} to ${metrics.afterScore} ` +
              `(Delta: ${metrics.deltaScore > 0 ? '+' : ''}${metrics.deltaScore}).`;
    const explanation: string[] = [
        scoreLine,
        `Effective code density shifted from ${metrics.effectiveDensityBefore} to ${metrics.effectiveDensityAfter} (Delta: ${metrics.effectiveDensityDelta}).`,
    ];

    if (
        metrics.compositeDensityDelta !== undefined &&
        metrics.compositeDensityBefore !== undefined &&
        metrics.compositeDensityAfter !== undefined &&
        Math.abs(metrics.compositeDensityDelta) >= 0.05
    ) {
        explanation.push(
            `Composite multi-dimensional density shifted from ${metrics.compositeDensityBefore} to ${metrics.compositeDensityAfter} (Delta: ${metrics.compositeDensityDelta > 0 ? '+' : ''}${metrics.compositeDensityDelta}).`,
        );
    }

    if (metrics.porDelta !== undefined && metrics.porDelta >= 0.25) {
        explanation.push(
            `WARNING: Wiring code overhead increased by +${Math.round(metrics.porDelta * PERCENT_SCALE_FACTOR)}%; ensure new trampolines are avoided.`,
        );
    }

    if (relocationAnalysis.hasPureRelocationsOnly) {
        explanation.push(
            `DEBOUNCED: Detected ${relocationAnalysis.relocatedCount} pure constant relocation(s) without semantic improvement; score gain clamped to 0.0.`,
        );
    }

    if (gamingCount > 0) {
        explanation.push(
            `REJECTED: Detected ${gamingCount} anti-gaming metric manipulation pattern(s).`,
        );
    }
    if (introducedCount > 0) {
        explanation.push(`Introduced ${introducedCount} new issue(s).`);
    }
    if (resolvedCount > 0) {
        explanation.push(`Resolved ${resolvedCount} previous issue(s).`);
    }

    if (simplificationRewardBonus > 0) {
        explanation.push(
            `REWARD BONUS: Earned +${simplificationRewardBonus} simplification bonus points for immutable folding/ternary refactoring opportunities.`,
        );
    }

    return explanation;
}

/**
 * Evaluates the quality change between before and after versions of a file.
 *
 * @param params - Configuration parameters including file path and before/after contents.
 * @returns Quantified patch quality result including delta score and verdict.
 */
interface PatchDensityMetricsResult {
    compositeDensityBefore: number;
    compositeDensityAfter: number;
    compositeDensityDelta: number;
    tsprDelta: number;
    porDelta: number;
}

function computePatchDensityMetrics(
    beforeDetails: FileQualityScore,
    afterDetails: FileQualityScore,
    effectiveDensityBefore: number,
    effectiveDensityAfter: number,
): PatchDensityMetricsResult {
    const compositeDensityBefore = clampRatio(
        beforeDetails.densityMetrics?.compositeDensity ?? effectiveDensityBefore,
    );
    const compositeDensityAfter = clampRatio(
        afterDetails.densityMetrics?.compositeDensity ?? effectiveDensityAfter,
    );
    const compositeDensityDelta =
        Math.round((compositeDensityAfter - compositeDensityBefore) * PERCENT_SCALE_FACTOR) /
        PERCENT_SCALE_FACTOR;

    const tsprBefore = clampRatio(beforeDetails.densityMetrics?.tspr ?? effectiveDensityBefore);
    const tsprAfter = clampRatio(afterDetails.densityMetrics?.tspr ?? effectiveDensityAfter);
    const tsprDelta =
        Math.round((tsprAfter - tsprBefore) * THOUSANDTHS_SCALE_FACTOR) / THOUSANDTHS_SCALE_FACTOR;

    const porBefore = clampRatio(
        beforeDetails.densityMetrics?.por ?? Math.max(0, 1.0 - effectiveDensityBefore),
    );
    const porAfter = clampRatio(
        afterDetails.densityMetrics?.por ?? Math.max(0, 1.0 - effectiveDensityAfter),
    );
    const porDelta =
        Math.round((porAfter - porBefore) * THOUSANDTHS_SCALE_FACTOR) / THOUSANDTHS_SCALE_FACTOR;

    return {
        compositeDensityBefore,
        compositeDensityAfter,
        compositeDensityDelta,
        tsprDelta,
        porDelta,
    };
}

function computePillarDeltas(
    beforeDetails: FileQualityScore,
    afterDetails: FileQualityScore,
): Record<PrimaryQualityPillar, number> {
    const pillarDeltas = {} as Record<PrimaryQualityPillar, number>;
    for (const pillar of ALL_PRIMARY_PILLARS) {
        const pBefore = beforeDetails.eightPillars.pillars[pillar];
        const pAfter = afterDetails.eightPillars.pillars[pillar];
        pillarDeltas[pillar] =
            Math.round((pAfter - pBefore) * PERCENT_SCALE_FACTOR) / PERCENT_SCALE_FACTOR;
    }
    return pillarDeltas;
}

/**
 * Scores a candidate patch by comparing file quality before and after the edit.
 *
 * Both revisions are run through the same file scorer, so the verdict reflects measured
 * before/after deltas per pillar plus the cognitive cost of any induced indirection, rather than
 * the size of the diff. Net-negative patches are reported as rejected with their dominant cause.
 *
 * @param params - Candidate patch bundle carrying both revisions and their issue sets.
 * @returns Per-pillar deltas, composite delta, and the acceptance verdict for the patch.
 */
export function evaluatePatchQuality(params: EvaluatePatchParams): PatchQualityResult {
    const {
        filePath,
        beforeContent,
        afterContent,
        existingIssues = [],
        newIssues = [],
        domainName = DEFAULT_PATCH_DOMAIN,
        moduleName = DEFAULT_PATCH_MODULE,
    } = params;

    const beforeDetails = scoreFileQuality({
        filePath,
        content: beforeContent,
        issues: existingIssues,
        domainName,
        moduleName,
    });
    const afterDetails = scoreFileQuality({
        filePath,
        content: afterContent,
        issues: newIssues,
        domainName,
        moduleName,
    });

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
    // A NaN on either side means the scan measured no quality dimension, which happens on a
    // narrow analyzer selection. Subtracting it would yield NaN, and a NaN delta satisfies
    // neither `> 0.5` nor `< -0.5`, so the patch would be reported as `neutral`.
    const rawDelta = scoreDelta(beforeScore, afterScore);
    let deltaScore =
        rawDelta === null
            ? null
            : Math.round(rawDelta * PERCENT_SCALE_FACTOR) / PERCENT_SCALE_FACTOR;

    // Pure relocation debouncing: moving constants without quality improvement
    // earns 0 positive score
    if (deltaScore !== null && relocationAnalysis.hasPureRelocationsOnly && deltaScore > 0) {
        deltaScore = 0.0;
    }

    const effectiveDensityBefore = beforeDetails.effectiveDensity;
    const effectiveDensityAfter = afterDetails.effectiveDensity;
    const effectiveDensityDelta =
        Math.round((effectiveDensityAfter - effectiveDensityBefore) * PERCENT_SCALE_FACTOR) /
        PERCENT_SCALE_FACTOR;

    const patchDensity = computePatchDensityMetrics(
        beforeDetails,
        afterDetails,
        effectiveDensityBefore,
        effectiveDensityAfter,
    );

    const pillarDeltas = computePillarDeltas(beforeDetails, afterDetails);

    let verdict = resolvePatchVerdict(deltaScore, gaming.length);
    if (relocationAnalysis.hasPureRelocationsOnly && verdict === VERDICT_IMPROVED) {
        verdict = VERDICT_NEUTRAL;
    }
    if (
        patchDensity.porDelta >= 0.35 &&
        deltaScore !== null &&
        deltaScore <= 0.5 &&
        verdict === VERDICT_IMPROVED
    ) {
        verdict = VERDICT_NEUTRAL;
    }

    const simplificationRewardBonus = computeSimplificationRewardBonus(newIssues);

    const metrics: PatchScoreMetrics = {
        beforeScore,
        afterScore,
        deltaScore,
        effectiveDensityBefore,
        effectiveDensityAfter,
        effectiveDensityDelta,
        ...patchDensity,
    };

    const explanation = buildPatchExplanations({
        metrics,
        relocationAnalysis,
        gamingCount: gaming.length,
        introducedCount: introduced.length,
        resolvedCount: resolved.length,
        simplificationRewardBonus,
    });

    return {
        filePath,
        ...metrics,
        pillarDeltas,
        introducedIssues: introduced,
        resolvedIssues: resolved,
        gamingViolations: gaming,
        verdict,
        explanation,
        beforeDetails,
        afterDetails,
        simplificationRewardBonus,
    };
}
