/**
 * Module: Praxis Workflow Template — ReviewGateChain & Trajectory Recipe Pipeline
 * File Path: .agents/skills/praxis-vfs-and-trajectory-learning/templates/praxis-gate-and-vfs-workflow.ts
 * Architecture Role: Reference scaffold for evaluating a candidate diff batch against
 *   the GAT-* differential gate chain and extracting a verified trajectory recipe.
 * Dependencies & Triggers: Loaded on demand (JIT) when implementing or testing Praxis
 *   review gates, LayerVFS virtual branches, or trajectory recipe extraction.
 * Responsibilities:
 *   1. Validate per-file and batch 5D ELOC bounds (GAT-BOUND-001, GAT-BATCH-001);
 *   2. Verify substantive payload density (GAT-DENS-001);
 *   3. Emit a compact (< 350B) trajectory recipe record with *Ms timestamps on pass.
 * Design Rationale: Provides a pure, deterministic in-memory evaluation pipeline that
 *   enforces GAT-* invariants before committing virtual branch mutations.
 */

export interface CandidateFileDiff {
    readonly filePath: string;
    readonly isNewFile: boolean;
    readonly addedEloc: number;
    readonly deletedEloc: number;
    readonly substantiveRatio: number;
    readonly tspr: number;
    readonly resolvedRules: readonly string[];
}

export interface GateChainVerdict {
    readonly passed: boolean;
    readonly blockingRuleId: string | null;
    readonly reason: string;
    readonly evaluatedAtMs: number;
}

const MAX_NEW_FILE_ADD = 360;
const MAX_EXISTING_FILE_ADD = 120;
const MAX_BATCH_ADD = 360;
const MAX_BATCH_DEL = 280;
const MIN_ADMISSION_TURNOVER = 3.0;
const MIN_SUBSTANTIVE_RATIO = 0.6;
const MIN_TSPR = 0.4;

/**
 * Evaluates a single file diff against GAT-BOUND-001 and GAT-DENS-001.
 *
 * @param file - Candidate file diff metrics.
 * @returns Blocking rule ID and message, or null when compliant.
 */
function checkSingleFileBounds(file: CandidateFileDiff): { ruleId: string; reason: string } | null {
    const addCeiling = file.isNewFile ? MAX_NEW_FILE_ADD : MAX_EXISTING_FILE_ADD;
    if (file.addedEloc > addCeiling) {
        return { ruleId: 'GAT-BOUND-001', reason: `File addedEloc ${file.addedEloc} > ${addCeiling} ceiling` };
    }
    if (file.substantiveRatio < MIN_SUBSTANTIVE_RATIO || file.tspr < MIN_TSPR) {
        return { ruleId: 'GAT-DENS-001', reason: `Density below floor in ${file.filePath}` };
    }
    return null;
}

/**
 * Evaluates a batch of candidate diffs against the GAT-* gate chain.
 *
 * @param files - Non-empty list of candidate file diffs.
 * @param nowMs - Deterministic timestamp in milliseconds.
 * @returns Structured gate chain verdict.
 */
export function evaluatePraxisGateBatch(
    files: readonly CandidateFileDiff[],
    nowMs: number,
): GateChainVerdict {
    let totalAdded = 0;
    let totalDeleted = 0;
    for (const file of files) {
        const violation = checkSingleFileBounds(file);
        if (violation) {
            return { passed: false, blockingRuleId: violation.ruleId, reason: violation.reason, evaluatedAtMs: nowMs };
        }
        totalAdded += file.addedEloc;
        totalDeleted += file.deletedEloc;
    }
    const turnover = totalAdded + 0.8 * totalDeleted;
    if (totalAdded > MAX_BATCH_ADD || totalDeleted > MAX_BATCH_DEL || turnover < MIN_ADMISSION_TURNOVER) {
        return {
            passed: false,
            blockingRuleId: 'GAT-BATCH-001',
            reason: `Batch macro bounds violated (add=${totalAdded}, del=${totalDeleted}, turnover=${turnover.toFixed(1)})`,
            evaluatedAtMs: nowMs,
        };
    }
    return { passed: true, blockingRuleId: null, reason: 'PASS', evaluatedAtMs: nowMs };
}
