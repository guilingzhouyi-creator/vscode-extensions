/**
 * Module: Feedback Fusion Layer — Change Quality Arbiter & Anti-Gaming Guard
 * File Path: src/core/scoring/change-quality-arbiter.ts
 * Architecture Role: Evaluates real engineering improvement of code changes submitted by
 *   Agents or developers, enforcing the formula:
 *   ChangeScore = deltaQ - Regression - ComplexityCost - MaintenanceDebt,
 *   and strictly rejecting score-gaming attempts (relocation padding, fake tests, mechanical
 *   splitting, spurious abstraction).
 * Dependencies & Triggers: Consumes antiGaming, patchQuality, and Issue from core/types;
 *   consumed by CLI gate, commit hook, and PR gatekeepers.
 * Responsibilities:
 *   1. Calculate genuine net quality delta deltaQ = Q_after - Q_before.
 *   2. Deduct penalties for regressions, cognitive complexity cost, and new maintenance debt.
 *   3. Enforce the 4 Anti-Gaming hard blocks (G-01 through G-04).
 *   4. Render explainable change evaluation verdict: approved, neutral, degraded,
 *      or gaming_rejected.
 * Exit Semantics & Design Rationale: Deterministic calculation; gaming violations immediately
 *   fail-closed with 'gaming_rejected' verdict to protect downstream code bases.
 */

import type { Issue } from '../types';
import type { GamingPatternKind } from './antiGaming';
import { detectScoreGaming, detectDiffScoreGaming } from './antiGaming';
import { evaluateNetCognitiveCost } from './cognitive-cost-model';
import { computeEffectiveCodeDensity } from './effectiveDensity';

/**
 * Approved architectural refactoring pattern declaration.
 */
export interface ApprovedRefactoringPattern {
    /** Pattern name, e.g. 'extract_function', 'decompose_conditional' */
    pattern: string;
    /** Original target function or method name */
    originalSymbol?: string;
    /** Cyclomatic complexity delta of the decomposed function (e.g. -4 or more) */
    deltaCC: number;
    /** Maximum parameter count across extracted sub-functions (<= 3 recommended) */
    maxSubParamCount?: number;
    /** Whether extracted functions maintain local scope without global leakage */
    isNarrowScope?: boolean;
}

/**
 * Parameters for evaluating an agent or developer code modification.
 */
export interface ChangeEvaluationInput {
    /** Target file path */
    filePath: string;
    /** Original content before change */
    beforeContent: string;
    /** Modified content after change */
    afterContent: string;
    /** Baseline quality score before modification [0.0, 100.0] */
    beforeScore: number;
    /** Realized quality score after modification [0.0, 100.0] */
    afterScore: number;
    /** Issues present before change */
    existingIssues?: Issue[];
    /** Issues present after change */
    newIssues?: Issue[];
    /** Explicit regression issues introduced */
    regressionIssues?: Issue[];
    /** Direct cognitive complexity hop cost override */
    cognitiveHopCost?: number;
    /** Direct maintenance debt penalty points */
    maintenanceDebtPoints?: number;
    /** Optional declaration of approved architectural refactoring pattern */
    approvedPattern?: ApprovedRefactoringPattern;
}

/**
 * Final arbitration verdict of code change evaluation.
 */
export type ChangeArbiterVerdict = 'approved' | 'neutral' | 'degraded' | 'gaming_rejected';

/**
 * Quantified change evaluation result.
 */
export interface ChangeEvaluationResult {
    /** deltaQ = Q_after - Q_before */
    deltaQ: number;
    /** Regression penalty: points deducted for newly introduced errors or regressions */
    regressionPenalty: number;
    /** ComplexityCost: added cognitive hopping/forwarding overhead */
    complexityCost: number;
    /** MaintenanceDebt: new technical debt introduced */
    maintenanceDebt: number;
    /**
     * Final net improvement:
     * ChangeScore = deltaQ - Regression - ComplexityCost - MaintenanceDebt
     */
    changeScore: number;
    /** Whether change was flagged for score gaming */
    isGamingRejected: boolean;
    /** Detected score gaming patterns */
    gamingKinds: GamingPatternKind[];
    /** Specific anti-gaming violation issues */
    gamingIssues: Issue[];
    /** Whether change was recognized as an approved refactoring pattern */
    isApprovedRefactoring: boolean;
    /** Refactoring encouragement bonus points awarded */
    refactoringBonus: number;
    /** Final arbitration verdict */
    verdict: ChangeArbiterVerdict;
    /** Complete transparent explanation trail */
    explanation: string[];
}

/**
 * Evaluates modification for true engineering improvement and anti-gaming compliance:
 * ChangeScore = deltaQ - Regression - ComplexityCost - MaintenanceDebt
 *
 * @param input - Change evaluation parameters.
 * @returns Fully audited ChangeEvaluationResult.
 */
/**
 * Resolves anti-gaming analysis and checks approved refactoring pattern immunity.
 */
function resolveAntiGamingWithImmunity(
    input: ChangeEvaluationInput,
    filePath: string,
    beforeContent: string,
    afterContent: string,
    explanation: string[],
): {
    gamingKinds: GamingPatternKind[];
    gamingIssues: Issue[];
    isApprovedRefactoring: boolean;
    isGaming: boolean;
} {
    const diffGaming = detectDiffScoreGaming(filePath, beforeContent, afterContent);
    const staticGaming = detectScoreGaming(filePath, afterContent);

    let gamingKinds: GamingPatternKind[] = Array.from(
        new Set([...diffGaming.gamingKinds, ...staticGaming.gamingKinds]),
    );
    let gamingIssues: Issue[] = [...diffGaming.issues, ...staticGaming.issues];

    let isApprovedRefactoring = false;
    if (input.approvedPattern) {
        const { deltaCC, maxSubParamCount = 2, isNarrowScope = true } = input.approvedPattern;
        if (deltaCC <= -4 && maxSubParamCount <= 3 && isNarrowScope) {
            isApprovedRefactoring = true;
            gamingKinds = gamingKinds.filter((k) => k !== 'artificial_function_splitting');
            gamingIssues = gamingIssues.filter(
                (i) => i.rule !== 'GAMING-001' && !i.message.toLowerCase().includes('splitting'),
            );
            explanation.push(
                `Approved Refactoring: Validated atomic function extraction (ΔCC=${deltaCC}, ` +
                    `params<=${maxSubParamCount}). Immune to G-03 mechanical splitting guard.`,
            );
        }
    }
    const isGaming = gamingKinds.length > 0;
    return { gamingKinds, gamingIssues, isApprovedRefactoring, isGaming };
}

/**
 * Calculates regression penalty for newly introduced issues.
 */
function computeRegressionPenalty(
    existingIssues: Issue[],
    newIssues: Issue[],
    regressionIssues: Issue[],
    explanation: string[],
): number {
    const existingRuleKeys = new Set(existingIssues.map((i) => `${i.rule}:${i.severity}`));
    const newlyIntroduced = newIssues.filter(
        (i) => !existingRuleKeys.has(`${i.rule}:${i.severity}`),
    );
    const totalRegressions = [...regressionIssues, ...newlyIntroduced];

    let penalty = 0;
    for (const reg of totalRegressions) {
        if (reg.severity === 'error') {
            penalty += 15.0;
        } else if (reg.severity === 'warning') {
            penalty += 5.0;
        } else {
            penalty += 1.0;
        }
    }
    const rounded = Math.round(penalty * 10) / 10;
    if (rounded > 0) {
        explanation.push(
            `Regression penalty: -${rounded} (${totalRegressions.length} introduced issues)`,
        );
    }
    return rounded;
}

/**
 * Calculates cognitive complexity hop cost for added forwarding wrappers.
 */
function computeComplexityCost(
    input: ChangeEvaluationInput,
    beforeContent: string,
    afterContent: string,
    filePath: string,
    explanation: string[],
): number {
    if (input.cognitiveHopCost !== undefined) {
        if (input.cognitiveHopCost > 0) {
            explanation.push(
                `Complexity cost (cognitive jump overhead): -${input.cognitiveHopCost}`,
            );
        }
        return input.cognitiveHopCost;
    }

    const afterDensity = computeEffectiveCodeDensity(afterContent);
    const beforeDensity = computeEffectiveCodeDensity(beforeContent);
    const addedForwarders = Math.max(
        0,
        afterDensity.forwardingCount - beforeDensity.forwardingCount,
    );
    let cost = 0;
    if (addedForwarders >= 2) {
        const hopEval = evaluateNetCognitiveCost(
            filePath,
            Array.from({ length: addedForwarders }, (_, i) => ({
                name: `wrapper_${i + 1}`,
                loc: 2,
                cc: 1,
                callDepth: 1,
                isForwardingWrapper: true,
            })),
        );
        cost = Math.round(hopEval.hopPenalty * 10) / 10;
    }
    if (cost > 0) {
        explanation.push(`Complexity cost (cognitive jump overhead): -${cost}`);
    }
    return cost;
}

/**
 * Calculates new maintenance debt from added suppression directives.
 */
function computeMaintenanceDebt(
    input: ChangeEvaluationInput,
    beforeContent: string,
    afterContent: string,
    explanation: string[],
): number {
    if (input.maintenanceDebtPoints !== undefined) {
        if (input.maintenanceDebtPoints > 0) {
            explanation.push(`Maintenance debt penalty: -${input.maintenanceDebtPoints}`);
        }
        return input.maintenanceDebtPoints;
    }
    const ignorePattern = /@ts-ignore|@ts-nocheck|eslint-disable/g;
    const beforeIgnores = (beforeContent.match(ignorePattern) ?? []).length;
    const afterIgnores = (afterContent.match(ignorePattern) ?? []).length;
    const newIgnores = Math.max(0, afterIgnores - beforeIgnores);
    const debt = newIgnores * 10.0;
    if (debt > 0) {
        explanation.push(`Maintenance debt penalty: -${debt}`);
    }
    return debt;
}

/**
 * Resolves final arbitration verdict and score.
 */
function resolveArbiterVerdict(
    isGaming: boolean,
    gamingKinds: GamingPatternKind[],
    changeScore: number,
    regressionPenalty: number,
    explanation: string[],
): { verdict: ChangeArbiterVerdict; finalScore: number } {
    if (isGaming) {
        const finalScore = Math.min(-50.0, changeScore - 50.0);
        explanation.push(
            `CRITICAL: Anti-gaming violation detected (${gamingKinds.join(', ')}). ` +
                `Change strictly rejected.`,
        );
        return { verdict: 'gaming_rejected', finalScore };
    }
    if (changeScore >= 5.0 && regressionPenalty === 0) {
        explanation.push(`Verdict: Approved. Genuine positive improvement (+${changeScore}).`);
        return { verdict: 'approved', finalScore: changeScore };
    }
    if (changeScore <= -5.0 || regressionPenalty >= 10.0) {
        explanation.push(`Verdict: Degraded. Significant regression or net loss (${changeScore}).`);
        return { verdict: 'degraded', finalScore: changeScore };
    }
    explanation.push(`Verdict: Neutral. Minor or negligible delta (${changeScore}).`);
    return { verdict: 'neutral', finalScore: changeScore };
}

/**
 * Evaluates modification for true engineering improvement and anti-gaming compliance:
 * ChangeScore = deltaQ - Regression - ComplexityCost - MaintenanceDebt
 *
 * @param input - Change evaluation parameters.
 * @returns Fully audited ChangeEvaluationResult.
 */
export function evaluateChangeQuality(input: ChangeEvaluationInput): ChangeEvaluationResult {
    const {
        filePath,
        beforeContent,
        afterContent,
        beforeScore,
        afterScore,
        existingIssues = [],
        newIssues = [],
        regressionIssues = [],
    } = input;

    const explanation: string[] = [];

    // 1. Calculate raw quality delta: deltaQ = Q_after - Q_before
    const deltaQ = Math.round((afterScore - beforeScore) * 10) / 10;
    explanation.push(
        `Raw quality delta: ΔQ = ${deltaQ > 0 ? '+' : ''}${deltaQ} (${beforeScore} -> ${afterScore})`,
    );

    // 2. Anti-Gaming Detection & Approved Refactoring Pattern Immunity
    const { gamingKinds, gamingIssues, isApprovedRefactoring, isGaming } =
        resolveAntiGamingWithImmunity(input, filePath, beforeContent, afterContent, explanation);

    // 3. Regression Penalty calculation
    const regressionPenalty = computeRegressionPenalty(
        existingIssues,
        newIssues,
        regressionIssues,
        explanation,
    );

    // 4. Complexity Cost calculation (Call Hopping & Forwarding Wrappers)
    const complexityCost = computeComplexityCost(
        input,
        beforeContent,
        afterContent,
        filePath,
        explanation,
    );

    // 5. Maintenance Debt calculation
    const maintenanceDebt = computeMaintenanceDebt(
        input,
        beforeContent,
        afterContent,
        explanation,
    );

    // 6. Net ChangeScore: deltaQ - Regression - ComplexityCost - MaintenanceDebt + RefactorBonus
    let refactoringBonus = 0;
    let netDelta = deltaQ - regressionPenalty - complexityCost - maintenanceDebt;
    if (isApprovedRefactoring && regressionPenalty === 0) {
        refactoringBonus = 5.0;
        netDelta += refactoringBonus;
        explanation.push(
            `Refactoring incentive: +${refactoringBonus} pts for validated architectural decoupling.`,
        );
    }
    const preliminaryScore = Math.round(netDelta * 10) / 10;

    // 7. Anti-Gaming Verdict Enforcement
    const { verdict, finalScore } = resolveArbiterVerdict(
        isGaming,
        gamingKinds,
        preliminaryScore,
        regressionPenalty,
        explanation,
    );

    return {
        deltaQ,
        regressionPenalty,
        complexityCost,
        maintenanceDebt,
        changeScore: finalScore,
        isGamingRejected: isGaming,
        gamingKinds,
        gamingIssues,
        isApprovedRefactoring,
        refactoringBonus,
        verdict,
        explanation,
    };
}
