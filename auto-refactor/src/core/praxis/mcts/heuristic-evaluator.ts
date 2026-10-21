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

/**
 * Estimates cyclomatic complexity from source code by counting branching tokens.
 */
function estimateComplexity(content: string): number {
    let count = 1;
    const tokens = ['if ', 'for ', 'while ', 'case ', 'catch ', '&&', '||', '?'];
    for (const token of tokens) {
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
        /: any\b/,
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
            { timeoutMs: strategy.verificationCommand.timeoutMs ?? 15000 },
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
            compositeScore: 20.0,
            caiScore: 0.0,
            breakdown: {
                testWeight: -40.0,
                complexityWeight: 0.0,
                ruleWeight: -Math.min(20.0, violationCount * 5.0),
                caiWeight: 0.0,
            },
        };
    }

    const testWeight = 25.0;
    const complexityWeight =
        complexityDelta < 0
            ? Math.min(25.0, Math.abs(complexityDelta) * 5.0)
            : -Math.min(25.0, complexityDelta * 5.0);

    const netDefectGain =
        originalViolationCount > 0
            ? (originalViolationCount - violationCount) / originalViolationCount
            : violationCount === 0
              ? 1.0
              : -0.5;

    const rulePenalty = Math.min(25.0, violationCount * 5.0);
    const ruleWeight = Math.round((Math.max(0, netDefectGain) * 10.0 - rulePenalty) * 10) / 10;

    // CAI (Code Autonomy Index): objective assessment of structural cleanliness & net improvement
    const cleanRatio = 1.0 / (1.0 + violationCount);
    const cpxGain = complexityDelta < 0 ? Math.min(1.0, Math.abs(complexityDelta) / 4.0) : 0.0;
    const rawCai = 0.5 * cleanRatio + 0.3 * Math.max(0, netDefectGain) + 0.2 * cpxGain;
    const caiScore = Math.max(0.0, Math.min(1.0, Math.round(rawCai * 100) / 100));
    const caiWeight = Math.round(caiScore * 15.0 * 10) / 10;

    const baseScore = 50.0;
    const rawScore = baseScore + testWeight + complexityWeight + ruleWeight + caiWeight;
    const compositeScore = Math.max(0.0, Math.min(100.0, Math.round(rawScore * 10) / 10));

    return {
        compositeScore,
        caiScore,
        breakdown: { testWeight, complexityWeight, ruleWeight, caiWeight },
    };
}

/**
 * Evaluates a candidate strategy in its sandboxed workspace and produces a HeuristicScore.
 *
 * Concurrency: Asynchronous pipeline; operates on an isolated workspace copy per candidate.
 *
 * @param strategy - Candidate refactoring strategy under evaluation.
 * @param workspace - LayerVFS workspace holding the candidate modifications.
 * @returns Comprehensive HeuristicScore.
 */
export async function evaluateCandidateStrategy(
    strategy: CandidateStrategy,
    workspace: LayerVFSWorkspace,
): Promise<HeuristicScore> {
    const testsPassed = await runVerificationCommand(strategy, workspace);

    let complexityDelta = 0;
    let violationCount = 0;
    let originalViolationCount = 0;

    for (const [filePath, modifiedContent] of strategy.fileModifications.entries()) {
        const modStr =
            typeof modifiedContent === 'string'
                ? modifiedContent
                : Buffer.from(modifiedContent).toString('utf8');

        violationCount += countCodeDefects(modStr);
        const newCpx = estimateComplexity(modStr);
        const originalFile = await workspace.getFile(filePath);
        const origStr = originalFile
            ? Buffer.from(originalFile.content).toString('utf8')
            : modStr;
        const origCpx = originalFile
            ? estimateComplexity(origStr)
            : newCpx;

        originalViolationCount += countCodeDefects(origStr);
        complexityDelta += newCpx - origCpx;
    }

    const { compositeScore, caiScore, breakdown } = computeScoreBreakdown(
        testsPassed,
        complexityDelta,
        violationCount,
        originalViolationCount,
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
