/**
 * Module: Core Scoring — Project-Scale Progressive Governance Evaluator
 * File Path: src/core/scoring/project-governance-evaluator.ts
 * Architecture Role: High-level architectural health and governance scoring engine providing
 *   adaptive lifecycle-aware evaluation across prototype, stable, and enterprise project stages.
 * Dependencies & Triggers: Consumes dimensionLiterals and Issue schema; invoked during
 *   whole-project quality scoring and eight-pillar aggregation passes.
 * Responsibilities: Calibrate severity thresholds across 3 maturity stages (prototype,
 *   stable, enterprise); calculate balanced governance score weighing distributed redundancy,
 *   role drift, pooling soundness, god-utils penalty, and over-abstraction without rewarding
 *   artificial sharing.
 * Exit Semantics & Design Rationale: Deterministic pure arithmetic model. Actively rejects
 *   simplistic 'more sharing = higher score' gaming by penalizing spurious indirection.
 */

import type { Issue } from '../types';
import { GovernanceEvalMessages } from '../messages';
import {
    DEDUCTION_DISTRIBUTED_REDUNDANCY,
    DEDUCTION_ROLE_DEVIATION,
    DEDUCTION_GOD_UTILS,
    DEDUCTION_OVER_ABSTRACTION,
    DEDUCTION_UNPOOLED_RESOURCE,
    DEDUCTION_UNSOUND_POOLING,
    DEDUCTION_NEGATIVE_ROI_POOLING,
} from './dimensionLiterals';

/**
 * 3 Canonical Project Lifecycle Maturity Stages.
 */
export type ProjectMaturityStage = 'prototype' | 'stable' | 'enterprise';

/** Stage token for early exploration, where redundancy is tolerated at half weight. */
export const STAGE_PROTOTYPE: ProjectMaturityStage = 'prototype';
/** Stage token for released code held to standard governance weighting. */
export const STAGE_STABLE: ProjectMaturityStage = 'stable';
/** Stage token for large-scale delivery, where redundancy and drift weigh heaviest. */
export const STAGE_ENTERPRISE: ProjectMaturityStage = 'enterprise';

const MAX_CLEAN_REUSE_BONUS = 10;
const BONUS_PER_CLEAN_LIB = 2;
const BONUS_PER_SOUND_POOL = 2;

const GOV_GRADE_D_MAX = 70;
const GOV_GRADE_C_MAX = 80;
const GOV_GRADE_B_MAX = 90;
const GOV_GRADE_A_MAX = 97;

const STAGE_MULTIPLIER_PROTOTYPE = 0.85;
const STAGE_MULTIPLIER_STABLE = 1.0;
const STAGE_MULTIPLIER_ENTERPRISE = 1.4;

const MAX_GOVERNANCE_BASE_SCORE = 100;
const GOVERNANCE_ROUND_FACTOR = 100;

/**
 * Project-scale governance audit snapshot metrics.
 */
export interface ProjectGovernanceInput {
    stage: ProjectMaturityStage;
    totalFiles: number;
    totalLOC: number;
    distributedRedundancyCount: number;
    pseudoSharedLibraryCount: number;
    unboundedUtilityCreepCount: number;
    godObjectUtilityCount: number;
    overAbstractionCount: number;
    unpooledHotspotCount: number;
    unsoundPoolCount: number;
    negativeRoiPoolCount: number;
    cleanSharedLibraryCount: number;
    soundPoolCount: number;
    issues: Issue[];
}

/**
 * Comprehensive governance evaluation output.
 */
export interface ProjectGovernanceScoreResult {
    stage: ProjectMaturityStage;
    compositeScore: number;
    grade: 'A+' | 'A' | 'B' | 'C' | 'D';
    deductions: {
        distributedRedundancy: number;
        roleDrift: number;
        godUtils: number;
        overAbstraction: number;
        poolingFlaws: number;
    };
    bonuses: {
        cleanReuseBonus: number;
    };
    calibratedIssues: Issue[];
    antiGamingWarnings: string[];
}

/**
 * Computes calibrated severity multiplier based on project maturity stage.
 */
function getStageMultiplier(stage: ProjectMaturityStage): number {
    switch (stage) {
        case 'prototype':
            return STAGE_MULTIPLIER_PROTOTYPE;
        case 'stable':
            return STAGE_MULTIPLIER_STABLE;
        case 'enterprise':
            return STAGE_MULTIPLIER_ENTERPRISE;
    }
}

interface GovernanceDeductions {
    distributedRedundancy: number;
    roleDrift: number;
    godUtils: number;
    overAbstraction: number;
    poolingFlaws: number;
}

function calculateGovernanceDeductions(
    input: ProjectGovernanceInput,
    stageMultiplier: number,
): { deductions: GovernanceDeductions; totalDeductions: number } {
    const distributedRedundancy = Math.round(
        input.distributedRedundancyCount * DEDUCTION_DISTRIBUTED_REDUNDANCY * stageMultiplier,
    );
    const roleDrift = Math.round(
        (input.pseudoSharedLibraryCount + input.unboundedUtilityCreepCount) *
            DEDUCTION_ROLE_DEVIATION *
            stageMultiplier,
    );
    const godUtils = Math.round(
        input.godObjectUtilityCount * DEDUCTION_GOD_UTILS * stageMultiplier,
    );
    const overAbstraction = Math.round(
        input.overAbstractionCount * DEDUCTION_OVER_ABSTRACTION * stageMultiplier,
    );
    const poolingFlaws = Math.round(
        (input.unpooledHotspotCount * DEDUCTION_UNPOOLED_RESOURCE +
            input.unsoundPoolCount * DEDUCTION_UNSOUND_POOLING +
            input.negativeRoiPoolCount * DEDUCTION_NEGATIVE_ROI_POOLING) *
            stageMultiplier,
    );

    const totalDeductions =
        distributedRedundancy + roleDrift + godUtils + overAbstraction + poolingFlaws;

    return {
        deductions: {
            distributedRedundancy,
            roleDrift,
            godUtils,
            overAbstraction,
            poolingFlaws,
        },
        totalDeductions,
    };
}

function calculateCleanReuseBonuses(input: ProjectGovernanceInput): {
    cleanReuseBonus: number;
    antiGamingWarnings: string[];
} {
    const antiGamingWarnings: string[] = [];
    if (input.overAbstractionCount === 0 && input.negativeRoiPoolCount === 0) {
        return {
            cleanReuseBonus: Math.min(
                MAX_CLEAN_REUSE_BONUS,
                input.cleanSharedLibraryCount * BONUS_PER_CLEAN_LIB +
                    input.soundPoolCount * BONUS_PER_SOUND_POOL,
            ),
            antiGamingWarnings,
        };
    }

    if (input.overAbstractionCount > 0) {
        antiGamingWarnings.push(GovernanceEvalMessages.BONUS_NULLIFIED_OVER_ABSTRACTION);
    }
    if (input.negativeRoiPoolCount > 0) {
        antiGamingWarnings.push(GovernanceEvalMessages.BONUS_NULLIFIED_NEGATIVE_ROI_POOL);
    }

    return { cleanReuseBonus: 0, antiGamingWarnings };
}

function assignGovernanceGrade(score: number): ProjectGovernanceScoreResult['grade'] {
    if (score < GOV_GRADE_D_MAX) return 'D';
    if (score < GOV_GRADE_C_MAX) return 'C';
    if (score < GOV_GRADE_B_MAX) return 'B';
    if (score < GOV_GRADE_A_MAX) return 'A';
    return 'A+';
}

function calibrateStageIssues(issues: Issue[], stage: ProjectMaturityStage): Issue[] {
    void stage;
    return issues.filter((iss) => !(iss as { clusteredInto?: string }).clusteredInto);
}

/**
 * Evaluates whole-project architectural governance score across all dimensions.
 *
 * @param input - Quantitative metrics collected across the repository.
 * @returns Balanced governance score result with graded assessment.
 */
export function evaluateProjectGovernance(
    input: ProjectGovernanceInput,
): ProjectGovernanceScoreResult {
    const stageMultiplier = getStageMultiplier(input.stage);
    const { deductions, totalDeductions } = calculateGovernanceDeductions(input, stageMultiplier);
    const { cleanReuseBonus, antiGamingWarnings } = calculateCleanReuseBonuses(input);

    const rawScore = MAX_GOVERNANCE_BASE_SCORE - totalDeductions + cleanReuseBonus;
    const compositeScore = Math.max(
        0,
        Math.min(
            MAX_GOVERNANCE_BASE_SCORE,
            Math.round(rawScore * GOVERNANCE_ROUND_FACTOR) / GOVERNANCE_ROUND_FACTOR,
        ),
    );
    const grade = assignGovernanceGrade(compositeScore);
    const calibratedIssues = calibrateStageIssues(input.issues, input.stage);

    return {
        stage: input.stage,
        compositeScore,
        grade,
        deductions,
        bonuses: {
            cleanReuseBonus,
        },
        calibratedIssues,
        antiGamingWarnings,
    };
}
