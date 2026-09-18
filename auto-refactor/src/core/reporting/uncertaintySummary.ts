/**
 * Module: Core Engine — Uncertainty Summary
 * File Path: src/core/reporting/uncertaintySummary.ts
 * Architecture Role: Aggregates issue uncertainty metrics for scan reporting.
 * Dependencies & Triggers: ../types; called by reportBuilder while assembling the summary and by
 *   reportFinalizer when a post-scan pass rewrites the report.
 * Responsibilities: Calculate runtime-evidence counts and the average evidence confidence.
 * Exit Semantics & Design Rationale: Pure aggregation returning structured metrics; issues
 *   without evidence are skipped so an empty report yields the neutral confidence of 1.0.
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
