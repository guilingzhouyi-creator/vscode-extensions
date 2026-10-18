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
import { projectWorkspace } from '../vfs/projection';
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
    let sandbox = null;
    try {
        sandbox = await projectWorkspace(workspace, { cleanOnClose: true });
        const execResult = await sandbox.runCommand(
            strategy.verificationCommand.command,
            strategy.verificationCommand.args,
            { timeoutMs: strategy.verificationCommand.timeoutMs ?? 15000 },
        );
        return execResult.success;
    } catch {
        return false;
    } finally {
        if (sandbox) {
            await sandbox.close();
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
): { compositeScore: number; caiScore: number; breakdown: HeuristicScore['breakdown'] } {
    const testWeight = testsPassed ? 25.0 : -40.0;
    const complexityWeight =
        complexityDelta < 0
            ? Math.min(20.0, Math.abs(complexityDelta) * 4.0)
            : -Math.min(25.0, complexityDelta * 5.0);
    const ruleWeight = -Math.min(25.0, violationCount * 5.0);
    const caiWeight = testsPassed && violationCount === 0 ? 15.0 : 5.0;

    let rawScore = 60.0 + testWeight + complexityWeight + ruleWeight + caiWeight;
    if (!testsPassed) {
        rawScore = Math.min(rawScore, 25.0);
    }
    const compositeScore = Math.max(0.0, Math.min(100.0, Math.round(rawScore * 10) / 10));
    const caiScore = Math.max(0.0, Math.min(1.0, Math.round((compositeScore / 100) * 100) / 100));

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

    for (const [filePath, modifiedContent] of strategy.fileModifications.entries()) {
        const modStr =
            typeof modifiedContent === 'string'
                ? modifiedContent
                : Buffer.from(modifiedContent).toString('utf8');

        violationCount += countCodeDefects(modStr);
        const newCpx = estimateComplexity(modStr);
        const originalFile = await workspace.getFile(filePath);
        const origCpx = originalFile
            ? estimateComplexity(Buffer.from(originalFile.content).toString('utf8'))
            : newCpx;

        complexityDelta += newCpx - origCpx;
    }

    const { compositeScore, caiScore, breakdown } = computeScoreBreakdown(
        testsPassed,
        complexityDelta,
        violationCount,
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
