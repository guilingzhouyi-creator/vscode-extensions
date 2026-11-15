/**
 * Module: Core Engine — Praxis MCTS Heuristic Refactoring Evaluator
 * File Path: src/core/praxis/mcts/heuristic-evaluator.ts
 * Architecture Role: Evaluates candidate refactoring strategies inside LayerVFS sandboxes,
 *   combining compiler/test verification outcomes, AST complexity delta, rule violations,
 *   and CAI autonomy ratings into normalized heuristic scores.
 * Dependencies & Triggers: Imports ./mcts-contracts, ../vfs/projection, ../vfs/workspace-manager;
 *   consumed by mcts-explorer.ts.
 * Responsibilities: Run optional verification commands in projected sandboxes, compute cyclomatic
 *   complexity deltas, evaluate static quality penalties, and calculate composite scores.
 * Exit Semantics & Design Rationale: Never throws; treats command failures as failed test signals
 *   with strict score deductions; adheres to CC <= 15 and Depth <= 4.
 */

import type { CandidateStrategy, HeuristicScore } from './mcts-contracts';
import { projectWorkspace, type ProjectedSandbox } from '../vfs/projection';
import type { LayerVFSWorkspace } from '../vfs/workspace-manager';

const DEFAULT_VERIFICATION_TIMEOUT_MS = 15_000;
const FAILED_TEST_BASE_SCORE = 20.0;
const FAILED_TEST_PENALTY = -40.0;
const MAX_RULE_PENALTY = 20.0;
const VIOLATION_PENALTY_MULTIPLIER = 5.0;
const PASSED_TEST_WEIGHT = 25.0;
const MAX_COMPLEXITY_WEIGHT = 25.0;
const MAX_RULE_WEIGHT = 25.0;
const NET_GAIN_WEIGHT_MULTIPLIER = 10.0;
const ROUNDING_SCALE_HUNDRED = 100;
const MAX_COMPLEXITY_DIVISOR = 4.0;
const CAI_WEIGHT_MULTIPLIER = 15.0;
const BASELINE_COMPOSITE_SCORE = 50.0;
const MAX_COMPOSITE_SCORE = 100.0;

const BRANCHING_TOKENS = ['if ', 'for ', 'while ', 'case ', 'catch ', '&&', '||', '?'] as const;

/**
 * Estimates cyclomatic complexity from source code by counting branching tokens.
 */
function estimateComplexity(content: string): number {
    let count = 1;
    for (const token of BRANCHING_TOKENS) {
        let idx = 0;
        while ((idx = content.indexOf(token, idx)) !== -1) {
            count++;
            idx += token.length;
        }
    }
    return count;
}

/**
 * Counts basic static code quality defects in modified content.
 */
function countCodeDefects(content: string): number {
    let defects = 0;
    const forbiddenPatterns = [
        new RegExp(':\\s*any\\b'),
        /catch\s*\([^)]*\)\s*\{\s*\}/,
        /\bTODO\b/i,
        /\bFIXME\b/i,
        /console\.log\(/,
    ];
    for (const pat of forbiddenPatterns) {
        if (pat.test(content)) {
            defects++;
        }
    }
    return defects;
}

/**
 * Executes physical verification command in an ephemeral projected sandbox if configured.
 */
async function runVerificationCommand(
    strategy: CandidateStrategy,
    workspace: LayerVFSWorkspace,
): Promise<boolean> {
    if (!strategy.verificationCommand) {
        return true;
    }
    let projectedSandbox: ProjectedSandbox | null = null;
    try {
        projectedSandbox = await projectWorkspace(workspace, {
            cleanOnClose: true,
            baseDir: strategy.baseDir,
            useSparseLinks: Boolean(strategy.baseDir),
            instantBootstrap: true,
        });
        const executionResult = await projectedSandbox.runCommand(
            strategy.verificationCommand.command,
            strategy.verificationCommand.args,
            {
                timeoutMs:
                    strategy.verificationCommand.timeoutMs ?? DEFAULT_VERIFICATION_TIMEOUT_MS,
            },
        );
        return executionResult.success;
    } catch {
        return false;
    } finally {
        if (projectedSandbox) {
            await projectedSandbox.close();
        }
    }
}

/**
 * Computes composite and CAI scores from component evaluation weights.
 */
function computeScoreBreakdown(
    testsPassed: boolean,
    complexityDelta: number,
    violationCount: number,
    originalViolationCount = 0,
): { compositeScore: number; caiScore: number; breakdown: HeuristicScore['breakdown'] } {
    if (!testsPassed) {
        return {
            compositeScore: FAILED_TEST_BASE_SCORE,
            caiScore: 0.0,
            breakdown: {
                testWeight: FAILED_TEST_PENALTY,
                complexityWeight: 0.0,
                ruleWeight: -Math.min(
                    MAX_RULE_PENALTY,
                    violationCount * VIOLATION_PENALTY_MULTIPLIER,
                ),
                caiWeight: 0.0,
            },
        };
    }

    const testWeight = PASSED_TEST_WEIGHT;
    const complexityWeight =
        complexityDelta < 0
            ? Math.min(
                  MAX_COMPLEXITY_WEIGHT,
                  Math.abs(complexityDelta) * VIOLATION_PENALTY_MULTIPLIER,
              )
            : -Math.min(MAX_COMPLEXITY_WEIGHT, complexityDelta * VIOLATION_PENALTY_MULTIPLIER);

    const netDefectGain =
        originalViolationCount > 0
            ? (originalViolationCount - violationCount) / originalViolationCount
            : violationCount === 0
              ? 1.0
              : -0.5;

    const rulePenalty = Math.min(MAX_RULE_WEIGHT, violationCount * VIOLATION_PENALTY_MULTIPLIER);
    const ruleWeight =
        Math.round(
            (Math.max(0, netDefectGain) * NET_GAIN_WEIGHT_MULTIPLIER - rulePenalty) *
                ROUNDING_SCALE_HUNDRED,
        ) / ROUNDING_SCALE_HUNDRED;

    // CAI (Code Autonomy Index): objective assessment of structural cleanliness & net improvement
    const cleanRatio = 1.0 / (1.0 + violationCount);
    const cpxGain =
        complexityDelta < 0
            ? Math.min(1.0, Math.abs(complexityDelta) / MAX_COMPLEXITY_DIVISOR)
            : 0.0;
    const rawCai = 0.5 * cleanRatio + 0.3 * Math.max(0, netDefectGain) + 0.2 * cpxGain;
    const caiScore = Math.max(
        0.0,
        Math.min(1.0, Math.round(rawCai * ROUNDING_SCALE_HUNDRED) / ROUNDING_SCALE_HUNDRED),
    );
    const caiWeight =
        Math.round(caiScore * CAI_WEIGHT_MULTIPLIER * ROUNDING_SCALE_HUNDRED) /
        ROUNDING_SCALE_HUNDRED;

    const baseScore = BASELINE_COMPOSITE_SCORE;
    const rawScore = baseScore + testWeight + complexityWeight + ruleWeight + caiWeight;
    const compositeScore = Math.max(
        0.0,
        Math.min(
            MAX_COMPOSITE_SCORE,
            Math.round(rawScore * ROUNDING_SCALE_HUNDRED) / ROUNDING_SCALE_HUNDRED,
        ),
    );

    return {
        compositeScore,
        caiScore,
        breakdown: { testWeight, complexityWeight, ruleWeight, caiWeight },
    };
}

/**
 * Options for incremental slice evaluation.
 */
export interface SliceEvaluationOptions {
    /** Map of file path to baseline content before strategy application */
    originalFiles?: ReadonlyMap<string, string>;
    /** Optional prior score from parent search node to accumulate deltas */
    parentScore?: HeuristicScore;
    /** Skip physical command execution when already validated upstream */
    skipVerification?: boolean;
}

/**
 * Evaluates an incremental candidate slice in its sandboxed workspace and
 * produces a HeuristicScore.
 *
 * Concurrency: Asynchronous pipeline; operates on an isolated workspace copy per candidate.
 * Complexity bounds: CC <= 15, Depth <= 4.
 *
 * @param strategy - Candidate refactoring strategy under evaluation.
 * @param workspace - LayerVFS workspace holding the candidate modifications.
 * @param options - Incremental slice evaluation options.
 * @returns Comprehensive HeuristicScore with incremental metrics.
 */
export async function evaluateIncrementalSlice(
    strategy: CandidateStrategy,
    workspace: LayerVFSWorkspace,
    options: SliceEvaluationOptions = {},
): Promise<HeuristicScore> {
    const testsPassed = options.skipVerification
        ? (options.parentScore?.testsPassed ?? true)
        : await runVerificationCommand(strategy, workspace);

    let sliceComplexityDelta = 0;
    let sliceViolationDelta = 0;
    let baselineViolations = options.parentScore?.violationCount ?? 0;

    const filesToAudit = new Set<string>([
        ...strategy.fileModifications.keys(),
        ...(strategy.localizedEdits ? strategy.localizedEdits.keys() : []),
    ]);

    for (const filePath of filesToAudit) {
        const fileRecord = await workspace.getFile(filePath);
        if (!fileRecord) continue;

        const currentStr = Buffer.from(fileRecord.content).toString('utf8');
        const currentViolations = countCodeDefects(currentStr);
        const currentCpx = estimateComplexity(currentStr);

        const origStr = options.originalFiles?.get(filePath);
        const origViolations =
            origStr !== undefined ? countCodeDefects(origStr) : currentViolations;
        const origCpx = origStr !== undefined ? estimateComplexity(origStr) : currentCpx;

        sliceComplexityDelta += currentCpx - origCpx;
        sliceViolationDelta += currentViolations - origViolations;
        if (!options.parentScore) {
            baselineViolations += origViolations;
        }
    }

    const complexityDelta = (options.parentScore?.complexityDelta ?? 0) + sliceComplexityDelta;
    const violationCount = Math.max(0, baselineViolations + sliceViolationDelta);

    const { compositeScore, caiScore, breakdown } = computeScoreBreakdown(
        testsPassed,
        complexityDelta,
        violationCount,
        baselineViolations,
    );

    return {
        compositeScore,
        testsPassed,
        complexityDelta,
        violationCount,
        caiScore,
        breakdown,
    };
}

/**
 * Evaluates a candidate strategy in its sandboxed workspace using incremental slice evaluation.
 *
 * Concurrency: Asynchronous pipeline; operates safely on isolated sandboxed LayerVFS workspaces.
 *
 * @param strategy - Candidate refactoring strategy under evaluation.
 * @param workspace - LayerVFS workspace holding candidate modifications.
 * @param options - Optional slice evaluation options.
 * @returns Comprehensive HeuristicScore.
 */
export async function evaluateCandidateStrategy(
    strategy: CandidateStrategy,
    workspace: LayerVFSWorkspace,
    options: SliceEvaluationOptions = {},
): Promise<HeuristicScore> {
    return evaluateIncrementalSlice(strategy, workspace, options);
}
