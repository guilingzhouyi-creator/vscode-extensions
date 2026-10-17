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
import { SCORE_ROUNDING } from './scorer-formulas';

const APPROVED_DELTA_CC_MAGNITUDE = 4;
const MAX_APPROVED_PARAM_COUNT = 3;
const GAMING_KIND_ARTIFICIAL_SPLITTING = 'artificial_function_splitting';
const RULE_GAMING_001 = 'GAMING-001';
const RULE_SPLITTING_KEYWORD = 'splitting';

const SEVERITY_ERROR_TAG = 'error';
const SEVERITY_WARNING_TAG = 'warning';

const PENALTY_ERROR_SEVERITY = 15.0;
const PENALTY_WARNING_SEVERITY = 5.0;
const PENALTY_INFO_SEVERITY = 1.0;
const PENALTY_MAINTENANCE_SUPPRESSION = 10.0;
const PENALTY_GAMING_REJECT_OFFSET = 50.0;
const BONUS_APPROVED_REFACTORING = 5.0;

const THRESHOLD_APPROVED_SCORE = 5.0;
const THRESHOLD_DEGRADED_REGRESSION = 10.0;

const SAFETY_INDEX_DECIMAL_PLACES = 3;
const DIFF_ENTROPY_DECIMAL_PLACES = 2;
const ROI_DECIMAL_PLACES = 2;

const VERDICT_GAMING_REJECTED: ChangeArbiterVerdict = 'gaming_rejected';
const VERDICT_APPROVED: ChangeArbiterVerdict = 'approved';
const VERDICT_DEGRADED: ChangeArbiterVerdict = 'degraded';
const VERDICT_NEUTRAL: ChangeArbiterVerdict = 'neutral';

const DECISION_AUTO_APPLY: AgentDecisionVerdict = 'AUTO_APPLY';
const DECISION_HUMAN_REVIEW: AgentDecisionVerdict = 'HUMAN_REVIEW';
const DECISION_AUTO_REJECT: AgentDecisionVerdict = 'AUTO_REJECT';

const SUPPRESSION_DIRECTIVE_PATTERN = /@ts-ignore|@ts-nocheck|eslint-disable/g;

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

/** Context object for anti-gaming resolution with pattern immunity. */
interface AntiGamingResolutionContext {
    readonly input: ChangeEvaluationInput;
    readonly filePath: string;
    readonly beforeContent: string;
    readonly afterContent: string;
    readonly explanation: string[];
}

/** Context object for cognitive complexity cost computation. */
interface ComplexityCostContext {
    readonly input: ChangeEvaluationInput;
    readonly beforeContent: string;
    readonly afterContent: string;
    readonly filePath: string;
    readonly explanation: string[];
}

/** Context object for maintenance debt computation. */
interface MaintenanceDebtContext {
    readonly input: ChangeEvaluationInput;
    readonly beforeContent: string;
    readonly afterContent: string;
    readonly explanation: string[];
}

/** Context object for arbiter verdict resolution. */
interface ArbiterVerdictContext {
    readonly isGaming: boolean;
    readonly gamingKinds: readonly GamingPatternKind[];
    readonly changeScore: number;
    readonly regressionPenalty: number;
    readonly explanation: string[];
}

/**
 * Resolves anti-gaming analysis and checks approved refactoring pattern immunity.
 */
function resolveAntiGamingWithImmunity(ctx: AntiGamingResolutionContext): {
    gamingKinds: GamingPatternKind[];
    gamingIssues: Issue[];
    isApprovedRefactoring: boolean;
    isGaming: boolean;
} {
    const diffGaming = detectDiffScoreGaming(ctx.filePath, ctx.beforeContent, ctx.afterContent);
    const staticGaming = detectScoreGaming(ctx.filePath, ctx.afterContent);

    let gamingKinds: GamingPatternKind[] = Array.from(
        new Set([...diffGaming.gamingKinds, ...staticGaming.gamingKinds]),
    );
    let gamingIssues: Issue[] = [...diffGaming.issues, ...staticGaming.issues];

    let isApprovedRefactoring = false;
    if (ctx.input.approvedPattern) {
        const { deltaCC, maxSubParamCount = 2, isNarrowScope = true } = ctx.input.approvedPattern;
        if (
            deltaCC <= -APPROVED_DELTA_CC_MAGNITUDE &&
            maxSubParamCount <= MAX_APPROVED_PARAM_COUNT &&
            isNarrowScope
        ) {
            isApprovedRefactoring = true;
            gamingKinds = gamingKinds.filter((k) => k !== GAMING_KIND_ARTIFICIAL_SPLITTING);
            gamingIssues = gamingIssues.filter(
                (i) =>
                    i.rule !== RULE_GAMING_001 &&
                    !i.message.toLowerCase().includes(RULE_SPLITTING_KEYWORD),
            );
            ctx.explanation.push(
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
        if (reg.severity === SEVERITY_ERROR_TAG) {
            penalty += PENALTY_ERROR_SEVERITY;
        } else if (reg.severity === SEVERITY_WARNING_TAG) {
            penalty += PENALTY_WARNING_SEVERITY;
        } else {
            penalty += PENALTY_INFO_SEVERITY;
        }
    }
    const rounded = Math.round(penalty * SCORE_ROUNDING) / SCORE_ROUNDING;
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
function computeComplexityCost(ctx: ComplexityCostContext): number {
    if (ctx.input.cognitiveHopCost !== undefined) {
        if (ctx.input.cognitiveHopCost > 0) {
            ctx.explanation.push(
                `Complexity cost (cognitive jump overhead): -${ctx.input.cognitiveHopCost}`,
            );
        }
        return ctx.input.cognitiveHopCost;
    }

    const afterDensity = computeEffectiveCodeDensity(ctx.afterContent);
    const beforeDensity = computeEffectiveCodeDensity(ctx.beforeContent);
    const addedForwarders = Math.max(
        0,
        afterDensity.forwardingCount - beforeDensity.forwardingCount,
    );
    let cost = 0;
    if (addedForwarders >= 2) {
        const hopEval = evaluateNetCognitiveCost(
            ctx.filePath,
            Array.from({ length: addedForwarders }, (_, i) => ({
                name: `wrapper_${i + 1}`,
                loc: 2,
                cc: 1,
                callDepth: 1,
                isForwardingWrapper: true,
            })),
        );
        cost = Math.round(hopEval.hopPenalty * SCORE_ROUNDING) / SCORE_ROUNDING;
    }
    if (cost > 0) {
        ctx.explanation.push(`Complexity cost (cognitive jump overhead): -${cost}`);
    }
    return cost;
}

/**
 * Calculates new maintenance debt from added suppression directives.
 */
function computeMaintenanceDebt(ctx: MaintenanceDebtContext): number {
    if (ctx.input.maintenanceDebtPoints !== undefined) {
        if (ctx.input.maintenanceDebtPoints > 0) {
            ctx.explanation.push(`Maintenance debt penalty: -${ctx.input.maintenanceDebtPoints}`);
        }
        return ctx.input.maintenanceDebtPoints;
    }
    const beforeIgnores = (ctx.beforeContent.match(SUPPRESSION_DIRECTIVE_PATTERN) ?? []).length;
    const afterIgnores = (ctx.afterContent.match(SUPPRESSION_DIRECTIVE_PATTERN) ?? []).length;
    const newIgnores = Math.max(0, afterIgnores - beforeIgnores);
    const debt = newIgnores * PENALTY_MAINTENANCE_SUPPRESSION;
    if (debt > 0) {
        ctx.explanation.push(`Maintenance debt penalty: -${debt}`);
    }
    return debt;
}

/**
 * Resolves final arbitration verdict and score.
 */
function resolveArbiterVerdict(ctx: ArbiterVerdictContext): {
    verdict: ChangeArbiterVerdict;
    finalScore: number;
} {
    if (ctx.isGaming) {
        const finalScore = Math.min(
            -PENALTY_GAMING_REJECT_OFFSET,
            ctx.changeScore - PENALTY_GAMING_REJECT_OFFSET,
        );
        ctx.explanation.push(
            `CRITICAL: Anti-gaming violation detected (${ctx.gamingKinds.join(', ')}). ` +
                `Change strictly rejected.`,
        );
        return { verdict: VERDICT_GAMING_REJECTED, finalScore };
    }
    if (ctx.changeScore >= THRESHOLD_APPROVED_SCORE && ctx.regressionPenalty === 0) {
        ctx.explanation.push(
            `Verdict: Approved. Genuine positive improvement (+${ctx.changeScore}).`,
        );
        return { verdict: VERDICT_APPROVED, finalScore: ctx.changeScore };
    }
    if (
        ctx.changeScore <= -THRESHOLD_APPROVED_SCORE ||
        ctx.regressionPenalty >= THRESHOLD_DEGRADED_REGRESSION
    ) {
        ctx.explanation.push(
            `Verdict: Degraded. Significant regression or net loss (${ctx.changeScore}).`,
        );
        return { verdict: VERDICT_DEGRADED, finalScore: ctx.changeScore };
    }
    ctx.explanation.push(`Verdict: Neutral. Minor or negligible delta (${ctx.changeScore}).`);
    return { verdict: VERDICT_NEUTRAL, finalScore: ctx.changeScore };
}

/**
 * Calculates refactoring bonus for validated architectural decoupling.
 */
function calculateRefactoringBonus(
    isApprovedRefactoring: boolean,
    regressionPenalty: number,
    explanation: string[],
): number {
    if (!isApprovedRefactoring || regressionPenalty !== 0) {
        return 0;
    }
    explanation.push(
        `Refactoring incentive: +${BONUS_APPROVED_REFACTORING} pts for validated architectural decoupling.`,
    );
    return BONUS_APPROVED_REFACTORING;
}

/**
 * Evaluates modification for true engineering improvement and anti-gaming compliance:
/** Context object for assembling the change evaluation result. */
interface EvaluationResultAssemblyContext {
    readonly deltaQ: number;
    readonly regressionPenalty: number;
    readonly complexityCost: number;
    readonly maintenanceDebt: number;
    readonly refactoringBonus: number;
    readonly isApprovedRefactoring: boolean;
    readonly isGaming: boolean;
    readonly gamingKinds: readonly GamingPatternKind[];
    readonly gamingIssues: readonly Issue[];
    readonly explanation: string[];
}

/**
 * Assembles the final ChangeEvaluationResult structure with verdict calculations.
 */
function assembleEvaluationResult(ctx: EvaluationResultAssemblyContext): ChangeEvaluationResult {
    const netDelta =
        ctx.deltaQ -
        ctx.regressionPenalty -
        ctx.complexityCost -
        ctx.maintenanceDebt +
        ctx.refactoringBonus;
    const preliminaryScore = Math.round(netDelta * SCORE_ROUNDING) / SCORE_ROUNDING;

    const { verdict, finalScore } = resolveArbiterVerdict({
        isGaming: ctx.isGaming,
        gamingKinds: ctx.gamingKinds,
        changeScore: preliminaryScore,
        regressionPenalty: ctx.regressionPenalty,
        explanation: ctx.explanation,
    });

    return {
        deltaQ: ctx.deltaQ,
        regressionPenalty: ctx.regressionPenalty,
        complexityCost: ctx.complexityCost,
        maintenanceDebt: ctx.maintenanceDebt,
        changeScore: finalScore,
        isGamingRejected: ctx.isGaming,
        gamingKinds: [...ctx.gamingKinds],
        gamingIssues: [...ctx.gamingIssues],
        isApprovedRefactoring: ctx.isApprovedRefactoring,
        refactoringBonus: ctx.refactoringBonus,
        verdict,
        explanation: ctx.explanation,
    };
}

interface PenaltyCostContext {
    readonly input: ChangeEvaluationInput;
    readonly beforeContent: string;
    readonly afterContent: string;
    readonly filePath: string;
    readonly isApprovedRefactoring: boolean;
    readonly existingIssues: Issue[];
    readonly newIssues: Issue[];
    readonly regressionIssues: Issue[];
    readonly explanation: string[];
}

/**
 * Calculates all regression, complexity, maintenance penalties and refactoring bonus.
 */
function calculatePenaltiesAndBonus(ctx: PenaltyCostContext): {
    regressionPenalty: number;
    complexityCost: number;
    maintenanceDebt: number;
    refactoringBonus: number;
} {
    const regressionPenalty = computeRegressionPenalty(
        ctx.existingIssues,
        ctx.newIssues,
        ctx.regressionIssues,
        ctx.explanation,
    );
    const complexityCost = computeComplexityCost({
        input: ctx.input,
        beforeContent: ctx.beforeContent,
        afterContent: ctx.afterContent,
        filePath: ctx.filePath,
        explanation: ctx.explanation,
    });
    const maintenanceDebt = computeMaintenanceDebt({
        input: ctx.input,
        beforeContent: ctx.beforeContent,
        afterContent: ctx.afterContent,
        explanation: ctx.explanation,
    });
    const refactoringBonus = calculateRefactoringBonus(
        ctx.isApprovedRefactoring,
        regressionPenalty,
        ctx.explanation,
    );
    return { regressionPenalty, complexityCost, maintenanceDebt, refactoringBonus };
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
    const deltaQ = Math.round((afterScore - beforeScore) * SCORE_ROUNDING) / SCORE_ROUNDING;
    explanation.push(
        `Raw quality delta: ΔQ = ${deltaQ > 0 ? '+' : ''}${deltaQ} (${beforeScore} -> ${afterScore})`,
    );

    const { gamingKinds, gamingIssues, isApprovedRefactoring, isGaming } =
        resolveAntiGamingWithImmunity({
            input,
            filePath,
            beforeContent,
            afterContent,
            explanation,
        });

    const { regressionPenalty, complexityCost, maintenanceDebt, refactoringBonus } =
        calculatePenaltiesAndBonus({
            input,
            beforeContent,
            afterContent,
            filePath,
            isApprovedRefactoring,
            existingIssues,
            newIssues,
            regressionIssues,
            explanation,
        });

    return assembleEvaluationResult({
        deltaQ,
        regressionPenalty,
        complexityCost,
        maintenanceDebt,
        refactoringBonus,
        isApprovedRefactoring,
        isGaming,
        gamingKinds,
        gamingIssues,
        explanation,
    });
}

/**
 * Agent automated patch arbitration decision verdict.
 */
export type AgentDecisionVerdict = 'AUTO_APPLY' | 'HUMAN_REVIEW' | 'AUTO_REJECT';

/**
 * Patch safety risk metrics.
 */
export interface PatchSafetyMetrics {
    apiDriftScore: number; // [0.0, 1.0]
    uncoveredRiskScore: number; // [0.0, 1.0]
    semanticBleedScore: number; // [0.0, 1.0]
    safetyIndex: number; // [0.0, 1.0]
}

/**
 * Refactoring Return On Investment (ROI) metrics.
 */
export interface RefactoringRoiMetrics {
    deltaQualityScore: number;
    centralityMultiplier: number;
    diffEntropy: number;
    cognitiveLoad: number;
    roi: number;
}

/**
 * Complete quantified agent patch arbitration report.
 */
export interface AgentPatchArbitrationResult {
    decision: AgentDecisionVerdict;
    safety: PatchSafetyMetrics;
    roi: RefactoringRoiMetrics;
    baseEvaluation: ChangeEvaluationResult;
    recommendation: string;
}

/**
 * Configuration options contextualizing agent patch safety and risk arbitration.
 */
export interface AgentPatchArbitrationOptions {
    centralityMultiplier?: number;
    hasApiDrift?: boolean;
    uncoveredRiskScore?: number;
    semanticBleedScore?: number;
}

/**
 * Computes safety metrics and index for an incoming patch.
 */
function computePatchSafetyMetrics(options?: AgentPatchArbitrationOptions): PatchSafetyMetrics {
    const apiDrift = options?.hasApiDrift ? 1.0 : 0.0;
    const uncoveredRisk = Math.max(0.0, Math.min(1.0, options?.uncoveredRiskScore ?? 0.0));
    const semanticBleed = Math.max(0.0, Math.min(1.0, options?.semanticBleedScore ?? 0.0));
    const rawSafety = 1.0 - (0.4 * apiDrift + 0.3 * uncoveredRisk + 0.3 * semanticBleed);
    const safetyIndex = +Math.max(0.0, Math.min(1.0, rawSafety)).toFixed(
        SAFETY_INDEX_DECIMAL_PLACES,
    );

    return {
        apiDriftScore: apiDrift,
        uncoveredRiskScore: uncoveredRisk,
        semanticBleedScore: semanticBleed,
        safetyIndex,
    };
}

/**
 * Computes diff entropy heuristic from line modification count.
 */
function computeDiffEntropy(beforeContent: string, afterContent: string): number {
    const beforeLines = beforeContent.split(/\r\n|\n/).length;
    const afterLines = afterContent.split(/\r\n|\n/).length;
    const lineDelta = Math.abs(afterLines - beforeLines);
    return +(1.0 + Math.log10(1 + lineDelta)).toFixed(DIFF_ENTROPY_DECIMAL_PLACES);
}

/**
 * Resolves automated decision and recommendation message for a patch.
 */
function resolvePatchDecision(
    baseEvaluation: ChangeEvaluationResult,
    safety: PatchSafetyMetrics,
    roi: number,
): { decision: AgentDecisionVerdict; recommendation: string } {
    if (
        baseEvaluation.isGamingRejected ||
        safety.apiDriftScore >= 0.8 ||
        safety.safetyIndex < 0.7 ||
        baseEvaluation.verdict === VERDICT_DEGRADED ||
        roi < 0.5
    ) {
        return {
            decision: DECISION_AUTO_REJECT,
            recommendation:
                `Patch rejected by safety arbiter. SafetyIndex=${safety.safetyIndex}, ROI=${roi}, ` +
                `Gaming=${baseEvaluation.isGamingRejected}, ApiDrift=${safety.apiDriftScore > 0}. Automated rollback executed.`,
        };
    }
    if (
        safety.safetyIndex >= 0.9 &&
        roi >= 2.0 &&
        baseEvaluation.verdict === VERDICT_APPROVED &&
        baseEvaluation.regressionPenalty === 0
    ) {
        return {
            decision: DECISION_AUTO_APPLY,
            recommendation:
                `Patch verified safe with high ROI (${roi}) and robust SafetyIndex (${safety.safetyIndex}). ` +
                `Approved for automated non-blocking application.`,
        };
    }
    return {
        decision: DECISION_HUMAN_REVIEW,
        recommendation:
            `Patch meets basic stability but requires human verification. ` +
            `SafetyIndex=${safety.safetyIndex}, ROI=${roi}.`,
    };
}

/**
 * Arbitrate an automated agent patch considering ROI, Safety, and regression hazards.
 *
 * @param input - The change evaluation input containing before and after states.
 * @param options - Contextual arbitration options including centrality and risk metrics.
 * @returns Arbitration result with decision, ROI, and safety metrics.
 */
export function arbitrateAgentPatch(
    input: ChangeEvaluationInput,
    options?: AgentPatchArbitrationOptions,
): AgentPatchArbitrationResult {
    const baseEvaluation = evaluateChangeQuality(input);
    const centrality = options?.centralityMultiplier ?? 1.0;
    const safety = computePatchSafetyMetrics(options);
    const diffEntropy = computeDiffEntropy(input.beforeContent, input.afterContent);
    const cognitiveLoad = Math.max(0.1, baseEvaluation.complexityCost);

    const effectiveDeltaQ = Math.max(0, baseEvaluation.changeScore);
    const roi = +((effectiveDeltaQ * centrality) / (diffEntropy + cognitiveLoad + 0.1)).toFixed(
        ROI_DECIMAL_PLACES,
    );

    const { decision, recommendation } = resolvePatchDecision(baseEvaluation, safety, roi);

    return {
        decision,
        safety,
        roi: {
            deltaQualityScore: baseEvaluation.changeScore,
            centralityMultiplier: centrality,
            diffEntropy,
            cognitiveLoad,
            roi,
        },
        baseEvaluation,
        recommendation,
    };
}

/**
 * Facade class for Change Quality Arbiter.
 */
export class ChangeQualityArbiter {
    public evaluateChange(input: ChangeEvaluationInput): ChangeEvaluationResult {
        if (!input || !input.filePath) {
            throw new Error('ChangeEvaluationInput requires a non-empty filePath');
        }
        return evaluateChangeQuality(input);
    }

    public arbitratePatch(
        input: ChangeEvaluationInput,
        options?: AgentPatchArbitrationOptions,
    ): AgentPatchArbitrationResult {
        if (!input || !input.filePath) {
            throw new Error('ChangeEvaluationInput requires a non-empty filePath');
        }
        return arbitrateAgentPatch(input, options);
    }
}
