/**
 * Module: Core Scoring — Commit Batch Bounds & Aggregate Envelope Governor
 * File Path: src/core/scoring/diff-bounds-batch.ts
 * Architecture Role: Evaluates macro-level aggregate bounding envelopes across all staged files
 *   in a single commit batch ([Sigma L_add_max, Sigma L_del_max]), preventing multi-file monolithic
 *   dumps and enforcing atomic decomposition under batch-commit 6-layer topology.
 * Dependencies & Triggers: Consumes diff-bounds-governor; invoked by gate-self-slice and runners.
 * Responsibilities:
 *   1. Enforce batch-wide 5D ELOC addition ceiling (Sigma L_add <= 360 lines);
 *   2. Enforce batch-wide 5D ELOC deletion ceiling (Sigma L_del <= 280 lines);
 *   3. Enforce empirical net turnover admission floor (Sigma Delta_5D >= Theta_admission).
 * Exit Semantics & Design Rationale: CC <= 15; deterministic math; zero transient allocations;
 *   strict fail-closed verification.
 */

import {
    calculateEmpiricalAdmissionThreshold,
    DECIMAL_ROUNDING_FACTOR_HUNDREDTH,
    DELETION_TURNOVER_WEIGHT,
    VERDICT_ADMITTED,
    VERDICT_BLOCKED_INSUFFICIENT_TURNOVER,
    type DifferentialVerdictCode,
    type DifferentialBoundsVerdict,
    type TrajectoryRunPoint,
} from './diff-bounds-governor';

/** Maximum aggregated added 5D ELOC allowed across all staged files in a single commit batch. */
export const MAX_COMMIT_BATCH_ADD_5D_ELOC = 360;

/** Maximum aggregated deleted 5D ELOC allowed across all staged files in a single commit batch. */
export const MAX_COMMIT_BATCH_DEL_5D_ELOC = 280;

/** Verdict code when aggregated commit batch additions exceed the atomic batch ceiling. */
export const VERDICT_BLOCK_BATCH_ADD_OVERFLOW = 'BLOCK_BATCH_ADD_OVERFLOW';

/** Verdict code when aggregated commit batch deletions exceed the atomic batch ceiling. */
export const VERDICT_BLOCK_BATCH_DEL_OVERFLOW = 'BLOCK_BATCH_DEL_OVERFLOW';

/**
 * Staged file differential input item for commit batch bounds evaluation.
 */
export interface StagedFileDeltaItem {
    readonly filePath: string;
    readonly eloc5dAdd: number;
    readonly eloc5dDel: number;
    readonly net5dTurnover: number;
    readonly rawAdd: number;
    readonly rawDel: number;
    readonly boundsVerdict: DifferentialBoundsVerdict;
}

/**
 * Parameters for evaluating whole commit batch bounds.
 */
export interface CommitBatchBoundsParams {
    readonly stagedFiles: readonly StagedFileDeltaItem[];
    readonly recentRuns: readonly TrajectoryRunPoint[];
    readonly currentComplexity: number;
    readonly currentEloc: number;
    readonly windowSize?: number;
}

/**
 * Verdict resulting from commit batch bounds evaluation.
 */
export interface CommitBatchVerdict {
    readonly passed: boolean;
    readonly verdictCode: DifferentialVerdictCode;
    readonly total5dAdd: number;
    readonly total5dDel: number;
    readonly total5dTurnover: number;
    readonly admissionThreshold: number;
    readonly reason?: string;
}

/**
 * Evaluates macro-level aggregate bounds across all staged files in a commit batch.
 *
 * Enforces:
 * 1. Single-file differential bounds envelopes for all files;
 * 2. Total aggregated 5D added ELOC <= MAX_COMMIT_BATCH_ADD_5D_ELOC (360);
 * 3. Total aggregated 5D deleted ELOC <= MAX_COMMIT_BATCH_DEL_5D_ELOC (280);
 * 4. Total net 5D ELOC turnover >= Theta_admission (empirical threshold).
 *
 * @param params - Commit batch inputs.
 * @returns Unified CommitBatchVerdict.
 */
export function evaluateCommitBatchBounds(params: CommitBatchBoundsParams): CommitBatchVerdict {
    for (let fileIndex = 0; fileIndex < params.stagedFiles.length; fileIndex++) {
        const item = params.stagedFiles[fileIndex];
        if (!item.boundsVerdict.isAllowed) {
            return {
                passed: false,
                verdictCode: item.boundsVerdict.verdictCode,
                total5dAdd: 0,
                total5dDel: 0,
                total5dTurnover: 0,
                admissionThreshold: 0,
                reason: `[${item.filePath}] ${item.boundsVerdict.reason || 'differential bounds violated'}`,
            };
        }
    }

    let accumulated5dAdd = 0;
    let accumulated5dDel = 0;
    for (let fileIndex = 0; fileIndex < params.stagedFiles.length; fileIndex++) {
        const item = params.stagedFiles[fileIndex];
        accumulated5dAdd += item.eloc5dAdd;
        accumulated5dDel += item.eloc5dDel;
    }

    const total5dAdd =
        Math.round(accumulated5dAdd * DECIMAL_ROUNDING_FACTOR_HUNDREDTH) /
        DECIMAL_ROUNDING_FACTOR_HUNDREDTH;
    const total5dDel =
        Math.round(accumulated5dDel * DECIMAL_ROUNDING_FACTOR_HUNDREDTH) /
        DECIMAL_ROUNDING_FACTOR_HUNDREDTH;
    const total5dTurnover =
        Math.round(
            (total5dAdd + total5dDel * DELETION_TURNOVER_WEIGHT) *
                DECIMAL_ROUNDING_FACTOR_HUNDREDTH,
        ) / DECIMAL_ROUNDING_FACTOR_HUNDREDTH;

    if (total5dAdd > MAX_COMMIT_BATCH_ADD_5D_ELOC) {
        return {
            passed: false,
            verdictCode: VERDICT_BLOCK_BATCH_ADD_OVERFLOW,
            total5dAdd,
            total5dDel,
            total5dTurnover,
            admissionThreshold: 0,
            reason:
                `Commit batch total 5D added ELOC (${total5dAdd.toFixed(1)}) exceeds atomic batch ceiling ` +
                `(${MAX_COMMIT_BATCH_ADD_5D_ELOC}). Decompose using batch-commit 6-layer topology before committing.`,
        };
    }

    if (total5dDel > MAX_COMMIT_BATCH_DEL_5D_ELOC) {
        return {
            passed: false,
            verdictCode: VERDICT_BLOCK_BATCH_DEL_OVERFLOW,
            total5dAdd,
            total5dDel,
            total5dTurnover,
            admissionThreshold: 0,
            reason:
                `Commit batch total 5D deleted ELOC (${total5dDel.toFixed(1)}) exceeds safe deletion ceiling ` +
                `(${MAX_COMMIT_BATCH_DEL_5D_ELOC}). Decompose large refactorings into smaller incremental steps.`,
        };
    }

    const admission = calculateEmpiricalAdmissionThreshold({
        recentRuns: params.recentRuns,
        currentComplexity: params.currentComplexity,
        currentEloc: params.currentEloc,
        windowSize: params.windowSize,
    });

    if (total5dTurnover < admission.threshold) {
        return {
            passed: false,
            verdictCode: VERDICT_BLOCKED_INSUFFICIENT_TURNOVER,
            total5dAdd,
            total5dDel,
            total5dTurnover,
            admissionThreshold: admission.threshold,
            reason:
                `Commit batch net 5D ELOC turnover (${total5dTurnover.toFixed(1)}) is below empirical admission threshold ` +
                `(${admission.threshold.toFixed(1)}). Hollow or cosmetic-only commits are rejected.`,
        };
    }

    return {
        passed: true,
        verdictCode: VERDICT_ADMITTED,
        total5dAdd,
        total5dDel,
        total5dTurnover,
        admissionThreshold: admission.threshold,
    };
}
