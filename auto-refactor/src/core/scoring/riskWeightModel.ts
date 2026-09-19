/**
 * Module: Core Scoring — Non-linear Risk-Weighted Penalty Model
 * File Path: src/core/scoring/riskWeightModel.ts
 * Architecture Role: Evaluates multi-factor non-linear penalty curves and calculates
 *   severe pillar ceilings so fatal issues are never diluted by high volumes of trivial code.
 * Dependencies & Triggers: Consumes Issue from core/types, and PillarCeilingConstraint
 *   from ./eightPillarModel.
 * Responsibilities: Factor in severity, confidence, reach, and logarithmic frequency saturation;
 *   generate fatal pillar cap constraints.
 * Exit Semantics & Design Rationale: Deterministic and bounded deduction calculations.
 */

import type { Issue } from '../types';
import type { PillarCeilingConstraint, PrimaryQualityPillar } from './eightPillarModel';

/**
 * Reach / blast radius scope of an issue.
 */
export type IssueReach = 'local' | 'file' | 'cross_domain';

/**
 * Multipliers for severity weights.
 */
export const SEVERITY_FACTORS = {
    error: 10.0,
    warning: 3.0,
    info: 0.5,
} as const;

/**
 * Multipliers for issue reach / blast radius.
 */
export const REACH_FACTORS = {
    local: 1.0,
    file: 1.5,
    cross_domain: 2.5,
} as const;

/**
 * Calculated risk impact of an individual issue.
 */
export interface IssueRiskAssessment {
    issueId: string;
    rule: string;
    severity: 'error' | 'warning' | 'info';
    basePenalty: number;
    reach: IssueReach;
    confidence: number;
    effectivePenalty: number;
    affectedPillar: PrimaryQualityPillar;
}

/**
 * Result of non-linear risk penalty calculation across an issue set.
 */
export interface RiskPenaltyResult {
    totalPenalty: number;
    assessments: IssueRiskAssessment[];
    pillarPenalties: Record<PrimaryQualityPillar, number>;
    ceilings: PillarCeilingConstraint[];
    fatalIssueCount: number;
}

/**
 * Maps a rule id to the primary quality pillar it impacts.
 *
 * @param ruleId - Unique rule identifier to categorize.
 * @returns Impacted primary quality pillar.
 */
export function mapRuleToPrimaryPillar(ruleId: string): PrimaryQualityPillar {
    if (ruleId.startsWith('ARCH-') || ruleId === 'clean-layer-violation') {
        return 'architecture';
    }
    if (
        ruleId.startsWith('PRF-') ||
        ruleId.includes('algorithmic') ||
        ruleId.includes('transient')
    ) {
        return 'performance';
    }
    if (ruleId.startsWith('DAT-') || ruleId.includes('query')) {
        return 'data';
    }
    if (ruleId.startsWith('TST-') || ruleId.includes('test')) {
        return 'testing';
    }
    if (ruleId.startsWith('SEC-') || ruleId.includes('secret') || ruleId.includes('entropy')) {
        return 'security';
    }
    if (ruleId.startsWith('CPX-') || ruleId.startsWith('BIG-') || ruleId === 'high-complexity') {
        return 'maintainability';
    }
    if (ruleId.startsWith('DEP-') || ruleId === 'import-cycle') {
        return 'reliability';
    }
    return 'extensibility';
}

/**
 * Infers the reach / blast radius of an issue.
 *
 * @param issue - Issue to analyze for blast radius.
 * @returns Local, file, or cross-domain reach scope.
 */
export function inferIssueReach(issue: Issue): IssueReach {
    const rule = issue.rule;
    if (
        rule.startsWith('ARCH-') ||
        rule === 'clean-layer-violation' ||
        rule === 'import-cycle' ||
        rule.startsWith('DAT-')
    ) {
        return 'cross_domain';
    }
    if (rule.startsWith('BIG-') || rule.startsWith('SEC-')) {
        return 'file';
    }
    return 'local';
}

/**
 * Calculates non-linear risk-weighted penalties and fatal ceiling constraints.
 *
 * @param issues - Collection of detected issues to evaluate.
 * @returns Calculated risk penalties, pillar ceilings, and fatal issue count.
 */
export function computeRiskWeightedPenalties(issues: Issue[]): RiskPenaltyResult {
    const assessments: IssueRiskAssessment[] = [];
    const pillarPenalties: Record<PrimaryQualityPillar, number> = {
        architecture: 0,
        maintainability: 0,
        performance: 0,
        data: 0,
        testing: 0,
        reliability: 0,
        security: 0,
        extensibility: 0,
    };

    const ruleFrequencies = new Map<string, number>();
    for (const issue of issues) {
        ruleFrequencies.set(issue.rule, (ruleFrequencies.get(issue.rule) || 0) + 1);
    }

    const ceilings: PillarCeilingConstraint[] = [];
    let fatalIssueCount = 0;

    for (const issue of issues) {
        const severity = issue.severity || 'warning';
        const sevFactor = SEVERITY_FACTORS[severity] || 3.0;
        const reach = inferIssueReach(issue);
        const reachFactor = REACH_FACTORS[reach];
        const confidence = issue.evidence?.confidence ?? 1.0;
        const count = ruleFrequencies.get(issue.rule) || 1;

        // Logarithmic frequency dampening prevents runaway compounding
        const freqDampening = 1 / Math.sqrt(count);
        const effectivePenalty =
            Math.round(sevFactor * reachFactor * confidence * freqDampening * 10) / 10;

        const affectedPillar = mapRuleToPrimaryPillar(issue.rule);
        pillarPenalties[affectedPillar] += effectivePenalty;

        assessments.push({
            issueId: issue.id,
            rule: issue.rule,
            severity,
            basePenalty: sevFactor,
            reach,
            confidence,
            effectivePenalty,
            affectedPillar,
        });

        // Fatal ceiling triggers
        if (severity === 'error') {
            fatalIssueCount++;
            if (affectedPillar === 'architecture') {
                ceilings.push({
                    pillar: 'architecture',
                    maxScore: 40,
                    reason: `Fatal architecture breach: [${issue.rule}] ${issue.message}`,
                });
            } else if (affectedPillar === 'performance') {
                ceilings.push({
                    pillar: 'performance',
                    maxScore: 45,
                    reason: `Fatal performance violation: [${issue.rule}] ${issue.message}`,
                });
            } else if (affectedPillar === 'security') {
                ceilings.push({
                    pillar: 'security',
                    maxScore: 30,
                    reason: `Fatal security vulnerability: [${issue.rule}] ${issue.message}`,
                });
            }
        }
    }

    let totalPenalty = 0;
    for (const p of Object.values(pillarPenalties)) {
        totalPenalty += p;
    }

    return {
        totalPenalty: Math.round(totalPenalty * 10) / 10,
        assessments,
        pillarPenalties,
        ceilings,
        fatalIssueCount,
    };
}
