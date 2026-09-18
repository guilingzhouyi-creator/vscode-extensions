/**
 * Module: Core Engine — Uncertainty Summary Helper
 * File Path: src/core/scanner/uncertaintyHelper.ts
 * Architecture Role: Aggregates issue uncertainty metrics for scan reporting.
 * Dependencies & Triggers: ../types; called by Scanner.buildReport and reportFinalizer.
 * Responsibilities: Calculate runtime evidence counts and average confidence across issues.
 * Exit Semantics & Design Rationale: Pure aggregation function returning structured metrics.
 */

import type { Issue } from '../types';

/**
 * Compute uncertainty metrics across all findings in a scan report.
 *
 * @param issues - Emitted issues for the scan.
 * @returns Uncertainty summary with count of issues requiring runtime evidence and average
 *   confidence.
 */
export function summarizeUncertainty(issues: Issue[]): {
    requiresRuntimeCount: number;
    averageConfidence: number;
} {
    let requiresRuntimeCount = 0;
    let confidenceSum = 0;
    let evidenceCount = 0;

    for (const issue of issues) {
        if (!issue.evidence) continue;
        evidenceCount++;
        confidenceSum += issue.evidence.confidence;
        if (issue.evidence.requiresRuntime === true) {
            requiresRuntimeCount++;
        }
    }

    const averageConfidence =
        evidenceCount > 0 ? Number((confidenceSum / evidenceCount).toFixed(2)) : 1.0;

    return {
        requiresRuntimeCount,
        averageConfidence,
    };
}
