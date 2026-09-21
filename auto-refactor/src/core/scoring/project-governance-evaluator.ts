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
            return 0.5; // Tolerates reasonable redundancy during early exploration
        case 'stable':
            return 1.0; // Standard governance enforcement
        case 'enterprise':
            return 1.4; // Strict zero-tolerance for redundancy and drift in enterprise scale
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
                10,
                input.cleanSharedLibraryCount * 2 + input.soundPoolCount * 2,
            ),
            antiGamingWarnings,
        };
    }

    if (input.overAbstractionCount > 0) {
        antiGamingWarnings.push(
            'Clean reuse bonus nullified due to presence of spurious indirection or cyclic over-abstraction.',
        );
    }
    if (input.negativeRoiPoolCount > 0) {
        antiGamingWarnings.push(
            'Clean reuse bonus nullified due to presence of negative-ROI excessive micro-object pooling.',
        );
    }

    return { cleanReuseBonus: 0, antiGamingWarnings };
}

function assignGovernanceGrade(score: number): ProjectGovernanceScoreResult['grade'] {
    if (score < 70) return 'D';
    if (score < 80) return 'C';
    if (score < 90) return 'B';
    if (score < 97) return 'A';
    return 'A+';
}

function calibrateStageIssues(issues: Issue[], stage: ProjectMaturityStage): Issue[] {
    if (stage !== 'prototype') {
        return issues;
    }
    return issues.map((iss) => (iss.severity === 'warning' ? { ...iss, severity: 'info' } : iss));
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

    const rawScore = 100 - totalDeductions + cleanReuseBonus;
    const compositeScore = Math.max(0, Math.min(100, Math.round(rawScore * 10) / 10));
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
