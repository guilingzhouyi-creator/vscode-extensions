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
 *   4. Render explainable change evaluation verdict: approved, neutral, degraded, or gaming_rejected.
 * Exit Semantics & Design Rationale: Deterministic calculation; gaming violations immediately
 *   fail-closed with 'gaming_rejected' verdict to protect downstream code bases.
 */

import type { Issue } from '../types';
import type { GamingPatternKind } from './antiGaming';
import { detectScoreGaming, detectDiffScoreGaming } from './antiGaming';
import { evaluateNetCognitiveCost } from './cognitive-cost-model';
import { computeEffectiveCodeDensity } from './effectiveDensity';

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
    /** Final net improvement: ChangeScore = deltaQ - Regression - ComplexityCost - MaintenanceDebt */
    changeScore: number;
    /** Whether change was flagged for score gaming */
    isGamingRejected: boolean;
    /** Detected score gaming patterns */
    gamingKinds: GamingPatternKind[];
    /** Specific anti-gaming violation issues */
    gamingIssues: Issue[];
    /** Final arbitration verdict */
    verdict: ChangeArbiterVerdict;
    /** Complete transparent explanation trail */
    explanation: string[];
}

/**
 * Evaluates an agent or developer modification for true engineering improvement and anti-gaming compliance:
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
    explanation.push(`Raw quality delta: ΔQ = ${deltaQ > 0 ? '+' : ''}${deltaQ} (${beforeScore} -> ${afterScore})`);

    // 2. Anti-Gaming Detection across the 4 canonical patterns (G-01 ~ G-04)
    const gamingResult = detectDiffScoreGaming(filePath, beforeContent, afterContent);
    const staticGaming = detectScoreGaming(filePath, afterContent);

    const gamingKinds: GamingPatternKind[] = Array.from(
        new Set([...gamingResult.gamingKinds, ...staticGaming.gamingKinds]),
    );
    const gamingIssues: Issue[] = [...gamingResult.issues, ...staticGaming.issues];
    const isGaming = gamingKinds.length > 0;

    // 3. Regression Penalty calculation
    // Calculate issues introduced in newContent that did not exist in existingIssues
    const existingRuleKeys = new Set(existingIssues.map((i) => `${i.rule}:${i.severity}`));
    const newlyIntroduced = newIssues.filter((i) => !existingRuleKeys.has(`${i.rule}:${i.severity}`));
    const totalRegressions = [...regressionIssues, ...newlyIntroduced];

    let regressionPenalty = 0;
    for (const reg of totalRegressions) {
        if (reg.severity === 'error') {
            regressionPenalty += 15.0;
        } else if (reg.severity === 'warning') {
            regressionPenalty += 5.0;
        } else {
            regressionPenalty += 1.0;
        }
    }
    regressionPenalty = Math.round(regressionPenalty * 10) / 10;
    if (regressionPenalty > 0) {
        explanation.push(`Regression penalty: -${regressionPenalty} (${totalRegressions.length} introduced issues)`);
    }

    // 4. Complexity Cost calculation (Call Hopping & Forwarding Wrappers)
    let complexityCost = input.cognitiveHopCost ?? 0;
    if (input.cognitiveHopCost === undefined) {
        const afterDensity = computeEffectiveCodeDensity(afterContent);
        const beforeDensity = computeEffectiveCodeDensity(beforeContent);
        const addedForwarders = Math.max(0, afterDensity.forwardingCount - beforeDensity.forwardingCount);
        if (addedForwarders >= 2) {
            // Mechanical hop inflation detected
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
            complexityCost += Math.round(hopEval.hopPenalty * 10) / 10;
        }
    }
    if (complexityCost > 0) {
        explanation.push(`Complexity cost (cognitive jump overhead): -${complexityCost}`);
    }

    // 5. Maintenance Debt calculation
    let maintenanceDebt = input.maintenanceDebtPoints ?? 0;
    if (input.maintenanceDebtPoints === undefined) {
        // Count suppression tags or @ts-ignore added
        const beforeIgnores = (beforeContent.match(/@ts-ignore|@ts-nocheck|eslint-disable/g) ?? []).length;
        const afterIgnores = (afterContent.match(/@ts-ignore|@ts-nocheck|eslint-disable/g) ?? []).length;
        const newIgnores = Math.max(0, afterIgnores - beforeIgnores);
        maintenanceDebt += newIgnores * 10.0;
    }
    if (maintenanceDebt > 0) {
        explanation.push(`Maintenance debt penalty: -${maintenanceDebt}`);
    }

    // 6. Net ChangeScore Formulation: ChangeScore = deltaQ - Regression - ComplexityCost - MaintenanceDebt
    let changeScore = Math.round((deltaQ - regressionPenalty - complexityCost - maintenanceDebt) * 10) / 10;

    // 7. Anti-Gaming Verdict Enforcement
    let verdict: ChangeArbiterVerdict = 'neutral';

    if (isGaming) {
        verdict = 'gaming_rejected';
        changeScore = Math.min(-50.0, changeScore - 50.0);
        explanation.push(`CRITICAL: Anti-gaming violation detected (${gamingKinds.join(', ')}). Change strictly rejected.`);
    } else if (changeScore >= 5.0 && regressionPenalty === 0) {
        verdict = 'approved';
        explanation.push(`Verdict: Approved. Genuine positive improvement (+${changeScore}).`);
    } else if (changeScore <= -5.0 || regressionPenalty >= 10.0) {
        verdict = 'degraded';
        explanation.push(`Verdict: Degraded. Significant regression or net loss (${changeScore}).`);
    } else {
        verdict = 'neutral';
        explanation.push(`Verdict: Neutral. Minor or negligible delta (${changeScore}).`);
    }

    return {
        deltaQ,
        regressionPenalty,
        complexityCost,
        maintenanceDebt,
        changeScore,
        isGamingRejected: isGaming,
        gamingKinds,
        gamingIssues,
        verdict,
        explanation,
    };
}
