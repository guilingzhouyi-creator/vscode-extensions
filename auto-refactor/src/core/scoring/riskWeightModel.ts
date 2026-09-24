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

const PILLAR_ARCHITECTURE: PrimaryQualityPillar = 'architecture';
const PILLAR_MAINTAINABILITY: PrimaryQualityPillar = 'maintainability';
const PILLAR_PERFORMANCE: PrimaryQualityPillar = 'performance';
const PILLAR_DATA: PrimaryQualityPillar = 'data';
const PILLAR_TESTING: PrimaryQualityPillar = 'testing';
const PILLAR_RELIABILITY: PrimaryQualityPillar = 'reliability';
const PILLAR_SECURITY: PrimaryQualityPillar = 'security';
const PILLAR_EXTENSIBILITY: PrimaryQualityPillar = 'extensibility';

const REACH_LOCAL: IssueReach = 'local';
const REACH_FILE: IssueReach = 'file';
const REACH_CROSS_DOMAIN: IssueReach = 'cross_domain';

const SEVERITY_ERROR = 'error';
const SEVERITY_WARNING = 'warning';

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

const CEILING_MAX_SCORE_ARCHITECTURE = 40;
const CEILING_MAX_SCORE_PERFORMANCE = 45;
const CEILING_MAX_SCORE_SECURITY = 30;

const DEFAULT_SEVERITY_FACTOR = 3.0;
const DEFAULT_CONFIDENCE = 1.0;
const DAMPENING_SCALE = 10;

const PREFIX_ARCH = 'ARCH-';
const PREFIX_PRF = 'PRF-';
const PREFIX_DAT = 'DAT-';
const PREFIX_TST = 'TST-';
const PREFIX_SEC = 'SEC-';
const PREFIX_CPX = 'CPX-';
const PREFIX_BIG = 'BIG-';
const PREFIX_DEP = 'DEP-';

const RULE_CLEAN_LAYER = 'clean-layer-violation';
const RULE_HIGH_COMPLEXITY = 'high-complexity';
const RULE_IMPORT_CYCLE = 'import-cycle';

const KEYWORD_ALGORITHMIC = 'algorithmic';
const KEYWORD_TRANSIENT = 'transient';
const KEYWORD_QUERY = 'query';
const KEYWORD_TEST = 'test';
const KEYWORD_SECRET = 'secret';
const KEYWORD_ENTROPY = 'entropy';

const EXACT_RULE_TO_PILLAR: Readonly<Record<string, PrimaryQualityPillar>> = {
    [RULE_CLEAN_LAYER]: PILLAR_ARCHITECTURE,
    [RULE_HIGH_COMPLEXITY]: PILLAR_MAINTAINABILITY,
    [RULE_IMPORT_CYCLE]: PILLAR_RELIABILITY,
};

const PREFIX_TO_PILLAR: ReadonlyArray<readonly [string, PrimaryQualityPillar]> = [
    [PREFIX_ARCH, PILLAR_ARCHITECTURE],
    [PREFIX_PRF, PILLAR_PERFORMANCE],
    [PREFIX_DAT, PILLAR_DATA],
    [PREFIX_TST, PILLAR_TESTING],
    [PREFIX_SEC, PILLAR_SECURITY],
    [PREFIX_CPX, PILLAR_MAINTAINABILITY],
    [PREFIX_BIG, PILLAR_MAINTAINABILITY],
    [PREFIX_DEP, PILLAR_RELIABILITY],
];

const KEYWORD_TO_PILLAR_MAP: Readonly<Record<string, PrimaryQualityPillar>> = {
    [KEYWORD_ALGORITHMIC]: PILLAR_PERFORMANCE,
    [KEYWORD_TRANSIENT]: PILLAR_PERFORMANCE,
    [KEYWORD_QUERY]: PILLAR_DATA,
    [KEYWORD_TEST]: PILLAR_TESTING,
    [KEYWORD_SECRET]: PILLAR_SECURITY,
    [KEYWORD_ENTROPY]: PILLAR_SECURITY,
};

const KEYWORD_DISPATCH_RE = /(algorithmic|transient|query|test|secret|entropy)/;

const CROSS_DOMAIN_EXACT_RULES = new Set([RULE_CLEAN_LAYER, RULE_IMPORT_CYCLE]);
const CROSS_DOMAIN_PREFIXES = [PREFIX_ARCH, PREFIX_DAT];
const FILE_PREFIXES = [PREFIX_BIG, PREFIX_SEC];

const FATAL_CEILING_CONFIGS: ReadonlyArray<{
    pillar: PrimaryQualityPillar;
    maxScore: number;
    prefix: string;
}> = [
    {
        pillar: PILLAR_ARCHITECTURE,
        maxScore: CEILING_MAX_SCORE_ARCHITECTURE,
        prefix: 'Fatal architecture breach',
    },
    {
        pillar: PILLAR_PERFORMANCE,
        maxScore: CEILING_MAX_SCORE_PERFORMANCE,
        prefix: 'Fatal performance violation',
    },
    {
        pillar: PILLAR_SECURITY,
        maxScore: CEILING_MAX_SCORE_SECURITY,
        prefix: 'Fatal security vulnerability',
    },
];

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
    const exact = EXACT_RULE_TO_PILLAR[ruleId];
    if (exact) return exact;

    for (let i = 0; i < PREFIX_TO_PILLAR.length; i++) {
        if (ruleId.startsWith(PREFIX_TO_PILLAR[i][0])) {
            return PREFIX_TO_PILLAR[i][1];
        }
    }

    const m = KEYWORD_DISPATCH_RE.exec(ruleId);
    if (m && KEYWORD_TO_PILLAR_MAP[m[1]]) {
        return KEYWORD_TO_PILLAR_MAP[m[1]];
    }

    return PILLAR_EXTENSIBILITY;
}

/**
 * Infers the reach / blast radius of an issue.
 *
 * @param issue - Issue to analyze for blast radius.
 * @returns Local, file, or cross-domain reach scope.
 */
export function inferIssueReach(issue: Issue): IssueReach {
    const rule = issue.rule;
    if (CROSS_DOMAIN_EXACT_RULES.has(rule)) return REACH_CROSS_DOMAIN;
    for (let i = 0; i < CROSS_DOMAIN_PREFIXES.length; i++) {
        if (rule.startsWith(CROSS_DOMAIN_PREFIXES[i])) return REACH_CROSS_DOMAIN;
    }
    for (let i = 0; i < FILE_PREFIXES.length; i++) {
        if (rule.startsWith(FILE_PREFIXES[i])) return REACH_FILE;
    }
    return REACH_LOCAL;
}

interface SingleIssueEvaluation {
    assessment: IssueRiskAssessment;
    ceiling?: PillarCeilingConstraint;
    isFatal: boolean;
}

function evaluateSingleIssue(issue: Issue, ruleCount: number): SingleIssueEvaluation {
    const severity = issue.severity || SEVERITY_WARNING;
    const sevFactor = SEVERITY_FACTORS[severity] || DEFAULT_SEVERITY_FACTOR;
    const reach = inferIssueReach(issue);
    const reachFactor = REACH_FACTORS[reach];
    const confidence = issue.evidence?.confidence ?? DEFAULT_CONFIDENCE;

    // Logarithmic frequency dampening prevents runaway compounding
    const freqDampening = 1 / Math.sqrt(ruleCount);
    const effectivePenalty =
        Math.round(sevFactor * reachFactor * confidence * freqDampening * DAMPENING_SCALE) /
        DAMPENING_SCALE;

    const affectedPillar = mapRuleToPrimaryPillar(issue.rule);
    let ceiling: PillarCeilingConstraint | undefined;
    const isFatal = severity === SEVERITY_ERROR;

    if (isFatal) {
        for (let i = 0; i < FATAL_CEILING_CONFIGS.length; i++) {
            const cfg = FATAL_CEILING_CONFIGS[i];
            if (affectedPillar === cfg.pillar) {
                ceiling = {
                    pillar: cfg.pillar,
                    maxScore: cfg.maxScore,
                    reason: `${cfg.prefix}: [${issue.rule}] ${issue.message}`,
                };
                break;
            }
        }
    }

    return {
        assessment: {
            issueId: issue.id,
            rule: issue.rule,
            severity,
            basePenalty: sevFactor,
            reach,
            confidence,
            effectivePenalty,
            affectedPillar,
        },
        ceiling,
        isFatal,
    };
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
    for (let i = 0; i < issues.length; i++) {
        const rule = issues[i].rule;
        ruleFrequencies.set(rule, (ruleFrequencies.get(rule) || 0) + 1);
    }

    const ceilings: PillarCeilingConstraint[] = [];
    let fatalIssueCount = 0;

    for (let i = 0; i < issues.length; i++) {
        const issue = issues[i];
        const count = ruleFrequencies.get(issue.rule) || 1;
        const result = evaluateSingleIssue(issue, count);

        pillarPenalties[result.assessment.affectedPillar] += result.assessment.effectivePenalty;
        assessments.push(result.assessment);
        if (result.isFatal) fatalIssueCount++;
        if (result.ceiling) ceilings.push(result.ceiling);
    }

    let totalPenalty = 0;
    for (const p of Object.values(pillarPenalties)) {
        totalPenalty += p;
    }

    return {
        totalPenalty: Math.round(totalPenalty * DAMPENING_SCALE) / DAMPENING_SCALE,
        assessments,
        pillarPenalties,
        ceilings,
        fatalIssueCount,
    };
}
