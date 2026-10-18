/**
 * Module: Core Scoring — SQALE Technical Debt Ratio (TDR) & Remediation Effort Engine
 * File Path: src/core/scoring/technical-debt-ratio.ts
 * Architecture Role: Evaluates objective technical debt effort in remediation minutes,
 *   computing SQALE Technical Debt Ratio (TDR) against standard development baseline.
 * Dependencies & Triggers: Consumes Issue from core/types and PrimaryQualityPillar from eightPillarModel;
 *   called by qualityScorer, reportFinalizer, and governance gates.
 * Responsibilities:
 *   1. Quantify individual finding remediation cost in minutes based on severity and rule family.
 *   2. Compute aggregate remediation effort in hours and person-days (8 hours/day).
 *   3. Compute standardized SQALE Technical Debt Ratio: TDR = RemediationCost / DevelopmentCost.
 *   4. Map TDR to standard SQALE ratings (Grade A through E).
 *   5. Produce actionable debt paydown breakdown partitioned by pillar and severity.
 * Exit Semantics & Design Rationale: Deterministic arithmetic; zero side-effects; non-throwing.
 */

import type { Issue, Severity } from '../types';
import type { PrimaryQualityPillar } from './eightPillarModel';
import { ALL_PRIMARY_PILLARS, DIMENSION_TO_PILLAR_MAP } from './eightPillarModel';
import type { QualityDimension } from './scoringTypes';
import { ALL_QUALITY_DIMENSIONS } from './scoringTypes';

/**
 * Standard baseline engineering investment per Effective Line of Code (ELOC).
 * In SQALE/ISO calibration: 30 minutes per ELOC (0.5 hours) covering full-lifecycle design,
 * implementation, testing, code review, documentation, and CI integration.
 */
export const DEFAULT_DEV_MINUTES_PER_ELOC = 30;

/** Hours in a standard engineering working day for effort translation. */
export const WORK_HOURS_PER_DAY = 8.0;

/** Minutes in a standard engineering hour. */
export const MINUTES_PER_HOUR = 60.0;

/**
 * Standard SQALE Technical Debt Ratio rating thresholds.
 */
export const SQALE_GRADE_A_THRESHOLD = 0.05; // <= 5% debt ratio
export const SQALE_GRADE_B_THRESHOLD = 0.10; // <= 10% debt ratio
export const SQALE_GRADE_C_THRESHOLD = 0.20; // <= 20% debt ratio
export const SQALE_GRADE_D_THRESHOLD = 0.50; // <= 50% debt ratio

export type SqaleRating = 'A' | 'B' | 'C' | 'D' | 'E';

/**
 * Baseline remediation effort in minutes calibrated by issue severity.
 */
const SEVERITY_BASE_MINUTES: Record<Severity, number> = {
    error: 30,
    warning: 10,
    info: 3,
};

/**
 * Baseline remediation effort multipliers for specific rule family prefixes.
 */
const FAMILY_EFFORT_MINUTES: Record<string, number> = {
    SEC: 45, // Security vulnerability, token breach, prototype pollution
    ARCH: 35, // Structural circularity, illegal layer penetration
    CPX: 20, // High cyclomatic complexity, excessive nesting
    PRF: 20, // Per-frame heap allocation, blocking sync I/O
    SIM: 12, // Tautological branches, dead assignments, redundant wrappers
    MOD: 10, // Deprecated API access, fallback chain, modern syntax
    GOV: 15, // Governance violations, score gaming, process breach
    HYG: 5, // Code hygiene, whitespace, trailing blank lines
    NAM: 3, // Identifier casing, single-letter variable names
};

/**
 * Result record evaluating SQALE technical debt metrics across a file or project.
 */
export interface TechnicalDebtAssessment {
    readonly totalRemediationMinutes: number;
    readonly totalRemediationHours: number;
    readonly totalRemediationDays: number;
    readonly developmentCostMinutes: number;
    readonly technicalDebtRatio: number;
    readonly sqaleGrade: SqaleRating;
    readonly highDebtRemediationMinutes: number;
    readonly effortBySeverity: Record<Severity, number>;
    readonly effortByPillar: Record<PrimaryQualityPillar, number>;
}

/**
 * Resolves standard remediation minutes for a single issue.
 *
 * @param issue - Static analysis finding.
 * @param customRuleCost - Optional table mapping ruleId to exact override minutes.
 * @returns Estimated engineering remediation time in minutes.
 */
export function resolveIssueRemediationMinutes(
    issue: Issue,
    customRuleCost?: Record<string, number>,
): number {
    const ruleId = issue.rule ?? '';
    if (customRuleCost && typeof customRuleCost[ruleId] === 'number') {
        return Math.max(1, customRuleCost[ruleId]);
    }

    // Extract family prefix: e.g. SEC-VUL-001 -> SEC
    const prefixMatch = ruleId.match(/^([A-Z]{2,4})-/);
    if (prefixMatch && FAMILY_EFFORT_MINUTES[prefixMatch[1]] !== undefined) {
        const familyMinutes = FAMILY_EFFORT_MINUTES[prefixMatch[1]];
        if (issue.severity === 'error') {
            return Math.round(familyMinutes * 1.5);
        }
        if (issue.severity === 'info') {
            return Math.max(2, Math.round(familyMinutes * 0.4));
        }
        return familyMinutes;
    }

    return SEVERITY_BASE_MINUTES[issue.severity] ?? 10;
}

/**
 * Resolves SQALE letter rating from computed Technical Debt Ratio.
 */
export function resolveSqaleGrade(tdr: number): SqaleRating {
    if (!Number.isFinite(tdr) || tdr <= SQALE_GRADE_A_THRESHOLD) return 'A';
    if (tdr <= SQALE_GRADE_B_THRESHOLD) return 'B';
    if (tdr <= SQALE_GRADE_C_THRESHOLD) return 'C';
    if (tdr <= SQALE_GRADE_D_THRESHOLD) return 'D';
    return 'E';
}

function initializePillarEffort(): Record<PrimaryQualityPillar, number> {
    const record = {} as Record<PrimaryQualityPillar, number>;
    for (const p of ALL_PRIMARY_PILLARS) {
        record[p] = 0;
    }
    return record;
}

function resolveTargetPillar(ruleId: string, analyzer?: string): PrimaryQualityPillar {
    if (ruleId.startsWith('SEC-') || analyzer === 'security' || analyzer === 'secrets') {
        return 'security';
    }
    if (ruleId.startsWith('ARCH-') || analyzer === 'architecture') {
        return 'architecture';
    }
    if (ruleId.startsWith('PRF-') || analyzer === 'performance') {
        return 'performance';
    }
    if (ruleId.startsWith('GOV-') || ruleId.startsWith('HYG-')) {
        return 'reliability';
    }
    if (ruleId.startsWith('NAM-') || ruleId.startsWith('SIM-')) {
        return 'extensibility';
    }
    return 'maintainability';
}

function accumulateSeverityDebt(
    severity: Severity,
    minutes: number,
    effortBySeverity: Record<Severity, number>,
): number {
    if (severity === 'error') {
        effortBySeverity.error += minutes;
        return minutes;
    }
    if (severity === 'warning') {
        effortBySeverity.warning += minutes;
        return minutes >= 20 ? minutes : 0;
    }
    effortBySeverity.info += minutes;
    return 0;
}

/**
 * Evaluates comprehensive SQALE technical debt assessment for a set of issues and code volume.
 *
 * @param issues - Collection of static analysis findings.
 * @param eloc - Total effective lines of code (ELOC) in scope.
 * @param customRuleCost - Optional exact remediation minutes per rule.
 * @param devMinutesPerEloc - Optional development investment baseline (default: 30 minutes/ELOC).
 * @returns Fully computed TechnicalDebtAssessment record.
 */
export function evaluateTechnicalDebtAssessment(
    issues: readonly Issue[],
    eloc: number,
    customRuleCost?: Record<string, number>,
    devMinutesPerEloc = DEFAULT_DEV_MINUTES_PER_ELOC,
): TechnicalDebtAssessment {
    let totalRemediationMinutes = 0;
    let highDebtRemediationMinutes = 0;

    const effortBySeverity: Record<Severity, number> = {
        error: 0,
        warning: 0,
        info: 0,
    };
    const effortByPillar = initializePillarEffort();

    for (let i = 0; i < issues.length; i++) {
        const issue = issues[i];
        const minutes = resolveIssueRemediationMinutes(issue, customRuleCost);
        totalRemediationMinutes += minutes;

        highDebtRemediationMinutes += accumulateSeverityDebt(issue.severity, minutes, effortBySeverity);

        const targetPillar = resolveTargetPillar(issue.rule ?? '', issue.analyzer);
        effortByPillar[targetPillar] += minutes;
    }

    const safeEloc = Math.max(1, Math.round(eloc));
    const developmentCostMinutes = safeEloc * devMinutesPerEloc;
    const technicalDebtRatio = +(totalRemediationMinutes / developmentCostMinutes).toFixed(4);
    const sqaleGrade = resolveSqaleGrade(technicalDebtRatio);
    const totalRemediationHours = +(totalRemediationMinutes / MINUTES_PER_HOUR).toFixed(2);
    const totalRemediationDays = +(totalRemediationHours / WORK_HOURS_PER_DAY).toFixed(2);

    return {
        totalRemediationMinutes,
        totalRemediationHours,
        totalRemediationDays,
        developmentCostMinutes,
        technicalDebtRatio,
        sqaleGrade,
        highDebtRemediationMinutes,
        effortBySeverity,
        effortByPillar,
    };
}
