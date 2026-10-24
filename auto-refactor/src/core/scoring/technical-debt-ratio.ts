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
import { ALL_PRIMARY_PILLARS, PILLAR_MAINTAINABILITY } from './eightPillarModel';

const SEV_ERROR: Severity = 'error';
const SEV_WARNING: Severity = 'warning';
const SEV_INFO: Severity = 'info';

const BASE_MINUTES_ERROR = 30;
const BASE_MINUTES_WARNING = 10;
const BASE_MINUTES_INFO = 3;

const EFFORT_SEC = 45;
const EFFORT_ARCH = 35;
const EFFORT_CPX = 20;
const EFFORT_PRF = 20;
const EFFORT_SIM = 12;
const EFFORT_MOD = 10;
const EFFORT_GOV = 15;
const EFFORT_HYG = 5;
const EFFORT_NAM = 3;

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
export const SQALE_GRADE_B_THRESHOLD = 0.1; // <= 10% debt ratio
export const SQALE_GRADE_C_THRESHOLD = 0.2; // <= 20% debt ratio
export const SQALE_GRADE_D_THRESHOLD = 0.5; // <= 50% debt ratio

export type SqaleRating = 'A' | 'B' | 'C' | 'D' | 'E';

export const SQALE_RATING_A: SqaleRating = 'A';
export const SQALE_RATING_B: SqaleRating = 'B';
export const SQALE_RATING_C: SqaleRating = 'C';
export const SQALE_RATING_D: SqaleRating = 'D';
export const SQALE_RATING_E: SqaleRating = 'E';

const ERROR_EFFORT_MULTIPLIER = 1.5;
const INFO_EFFORT_MULTIPLIER = 0.4;
const MIN_INFO_REMEDIATION_MINUTES = 2;
const DEFAULT_FALLBACK_REMEDIATION_MINUTES = 10;
const HIGH_DEBT_WARNING_THRESHOLD_MINUTES = 20;

const PRECISION_RATIO_DECIMALS = 4;
const PRECISION_TIME_DECIMALS = 2;
const MIN_SAFE_ELOC = 1;

/**
 * Baseline remediation effort in minutes calibrated by issue severity.
 */
const SEVERITY_BASE_MINUTES: Record<Severity, number> = {
    [SEV_ERROR]: BASE_MINUTES_ERROR,
    [SEV_WARNING]: BASE_MINUTES_WARNING,
    [SEV_INFO]: BASE_MINUTES_INFO,
};

/**
 * Baseline remediation effort multipliers for specific rule family prefixes.
 */
const FAMILY_EFFORT_MINUTES: Record<string, number> = {
    SEC: EFFORT_SEC, // Security vulnerability, token breach, prototype pollution
    ARCH: EFFORT_ARCH, // Structural circularity, illegal layer penetration
    CPX: EFFORT_CPX, // High cyclomatic complexity, excessive nesting
    PRF: EFFORT_PRF, // Per-frame heap allocation, blocking sync I/O
    SIM: EFFORT_SIM, // Tautological branches, dead assignments, redundant wrappers
    MOD: EFFORT_MOD, // Deprecated API access, fallback chain, modern syntax
    GOV: EFFORT_GOV, // Governance violations, score gaming, process breach
    HYG: EFFORT_HYG, // Code hygiene, whitespace, trailing blank lines
    NAM: EFFORT_NAM, // Identifier casing, single-letter variable names
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
        if (issue.severity === SEV_ERROR) {
            return Math.round(familyMinutes * ERROR_EFFORT_MULTIPLIER);
        }
        if (issue.severity === SEV_INFO) {
            return Math.max(
                MIN_INFO_REMEDIATION_MINUTES,
                Math.round(familyMinutes * INFO_EFFORT_MULTIPLIER),
            );
        }
        return familyMinutes;
    }

    return SEVERITY_BASE_MINUTES[issue.severity] ?? DEFAULT_FALLBACK_REMEDIATION_MINUTES;
}

/**
 * Resolves SQALE letter rating from computed Technical Debt Ratio.
 * @param tdr
 */
export function resolveSqaleGrade(tdr: number): SqaleRating {
    if (!Number.isFinite(tdr) || tdr <= SQALE_GRADE_A_THRESHOLD) return SQALE_RATING_A;
    if (tdr <= SQALE_GRADE_B_THRESHOLD) return SQALE_RATING_B;
    if (tdr <= SQALE_GRADE_C_THRESHOLD) return SQALE_RATING_C;
    if (tdr <= SQALE_GRADE_D_THRESHOLD) return SQALE_RATING_D;
    return SQALE_RATING_E;
}

function initializePillarEffort(): Record<PrimaryQualityPillar, number> {
    const record = {} as Record<PrimaryQualityPillar, number>;
    for (const p of ALL_PRIMARY_PILLARS) {
        record[p] = 0;
    }
    return record;
}

const PILLAR_BY_ANALYZER: Readonly<Record<string, PrimaryQualityPillar>> = Object.freeze({
    security: 'security',
    secrets: 'security',
    architecture: 'architecture',
    performance: 'performance',
});

const PILLAR_BY_RULE_PREFIX: Readonly<Record<string, PrimaryQualityPillar>> = Object.freeze({
    'SEC-': 'security',
    'ARCH-': 'architecture',
    'PRF-': 'performance',
    'GOV-': 'reliability',
    'HYG-': 'reliability',
    'NAM-': 'extensibility',
    'SIM-': 'extensibility',
});

function resolveTargetPillar(ruleId: string, analyzer?: string): PrimaryQualityPillar {
    if (analyzer && PILLAR_BY_ANALYZER[analyzer]) {
        return PILLAR_BY_ANALYZER[analyzer];
    }
    const prefixIdx = ruleId.indexOf('-');
    if (prefixIdx !== -1) {
        const prefix = ruleId.slice(0, prefixIdx + 1);
        const mapped = PILLAR_BY_RULE_PREFIX[prefix];
        if (mapped) {
            return mapped;
        }
    }
    return PILLAR_MAINTAINABILITY;
}

function accumulateSeverityDebt(
    severity: Severity,
    minutes: number,
    effortBySeverity: Record<Severity, number>,
): number {
    if (severity === SEV_ERROR) {
        effortBySeverity[SEV_ERROR] += minutes;
        return minutes;
    }
    if (severity === SEV_WARNING) {
        effortBySeverity[SEV_WARNING] += minutes;
        return minutes >= HIGH_DEBT_WARNING_THRESHOLD_MINUTES ? minutes : 0;
    }
    effortBySeverity[SEV_INFO] += minutes;
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

        highDebtRemediationMinutes += accumulateSeverityDebt(
            issue.severity,
            minutes,
            effortBySeverity,
        );

        const targetPillar = resolveTargetPillar(issue.rule ?? '', issue.analyzer);
        effortByPillar[targetPillar] += minutes;
    }

    const safeEloc = Math.max(MIN_SAFE_ELOC, Math.round(eloc));
    const developmentCostMinutes = safeEloc * devMinutesPerEloc;
    const technicalDebtRatio = +(totalRemediationMinutes / developmentCostMinutes).toFixed(
        PRECISION_RATIO_DECIMALS,
    );
    const sqaleGrade = resolveSqaleGrade(technicalDebtRatio);
    const totalRemediationHours = +(totalRemediationMinutes / MINUTES_PER_HOUR).toFixed(
        PRECISION_TIME_DECIMALS,
    );
    const totalRemediationDays = +(totalRemediationHours / WORK_HOURS_PER_DAY).toFixed(
        PRECISION_TIME_DECIMALS,
    );

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
