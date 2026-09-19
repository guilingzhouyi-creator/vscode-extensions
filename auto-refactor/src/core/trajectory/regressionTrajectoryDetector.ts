/**
 * Module: Core Engine - Regression Trajectory Detector
 * File Path: src/core/trajectory/regressionTrajectoryDetector.ts
 * Architecture Role: Detects flip-flop revisions, cyclic oscillations, and re-emerged anti-patterns
 *   in code evolution trajectories; emits blocking governance rule GOV-TRJ-001.
 * Dependencies & Triggers: Consumes FileRevision and ChangeTrajectory from types; emits Issue from
 *   ../types; consumed by praxis/trajectoryLearningService and scanner pipelines.
 * Responsibilities: Track code revision histories, detect flip-flop modifications, identify
 *   re-introduced structural debt, and produce actionable governance issues.
 * Exit Semantics & Design Rationale: Deterministic analysis; never throws, handles empty or single
 *   revisions safely by returning empty issue collections.
 */

import type { Issue } from '../types';
import type { FileRevision, TrajectoryComparison } from './types';

/**
 * Detector that identifies regressive oscillation and anti-pattern re-emergence in trajectories.
 */
export class RegressionTrajectoryDetector {
    /**
     * Inspect a sequence of revisions for cyclic regressions or flip-flop reversions.
     *
     * @param filePath - Target file path being tracked.
     * @param revisions - Chronological list of revisions for this file.
     * @returns Array of emitted Issue instances (e.g. GOV-TRJ-001).
     */
    public detectRegressions(filePath: string, revisions: FileRevision[]): Issue[] {
        if (!revisions || revisions.length < 2) {
            return [];
        }

        const issues: Issue[] = [];

        // Check for flip-flop mutations (A -> B -> A)
        const flipFlopIssue = this.checkFlipFlop(filePath, revisions);
        if (flipFlopIssue) {
            issues.push(flipFlopIssue);
        }

        // Check for severe quality collapse (score drop >= 10 points)
        const qualityCollapseIssue = this.checkQualityCollapse(filePath, revisions);
        if (qualityCollapseIssue) {
            issues.push(qualityCollapseIssue);
        }

        return issues;
    }

    /**
     * Inspect revision comparisons for re-introduced resolved issues or anti-patterns.
     *
     * @param comparison - Pairwise TrajectoryComparison data.
     * @returns Array of emitted Issue instances.
     */
    public detectReintroducedDebt(comparison: TrajectoryComparison): Issue[] {
        if (!comparison) {
            return [];
        }

        const issues: Issue[] = [];

        // If composite delta is heavily negative and new issues are present
        if (comparison.compositeDelta <= -10 || comparison.isLogicalRollback) {
            issues.push(
                this.createRegressionIssue(
                    comparison.filePath,
                    1,
                    `Logical rollback or heavy quality regression detected (Δ${comparison.compositeDelta.toFixed(1)}). ` +
                        `Trajectory broke evolutionary invariants.`,
                ),
            );
        }

        return issues;
    }

    /**
     * Check for flip-flop modifications where code reverts to an older hash or content.
     */
    private checkFlipFlop(filePath: string, revisions: FileRevision[]): Issue | undefined {
        const len = revisions.length;
        if (len < 3) {
            return undefined;
        }

        const current = revisions[len - 1];
        const previous = revisions[len - 2];
        const prior = revisions[len - 3];

        // Direct flip-flop: prior == current && previous != current
        const isHashFlipFlop =
            prior.fileHash &&
            current.fileHash &&
            prior.fileHash === current.fileHash &&
            previous.fileHash !== current.fileHash;

        const isDigestFlipFlop =
            prior.astDigest &&
            current.astDigest &&
            prior.astDigest === current.astDigest &&
            previous.astDigest !== current.astDigest;

        if (isHashFlipFlop || isDigestFlipFlop) {
            return this.createRegressionIssue(
                filePath,
                1,
                `Cyclic flip-flop detected between revision ${prior.revisionId} and ${current.revisionId}. ` +
                    `Code modifications reverted to an earlier state without forward progress.`,
            );
        }

        return undefined;
    }

    /**
     * Check for significant quality score drops across consecutive revisions.
     */
    private checkQualityCollapse(filePath: string, revisions: FileRevision[]): Issue | undefined {
        const len = revisions.length;
        const current = revisions[len - 1];
        const previous = revisions[len - 2];

        if (!current.qualityScore || !previous.qualityScore) {
            return undefined;
        }

        const delta = current.qualityScore.compositeScore - previous.qualityScore.compositeScore;
        if (delta <= -12.0) {
            return this.createRegressionIssue(
                filePath,
                1,
                `Severe quality regression detected (Score dropped from ${previous.qualityScore.compositeScore.toFixed(1)} ` +
                    `to ${current.qualityScore.compositeScore.toFixed(1)}, Δ${delta.toFixed(1)}).`,
            );
        }

        return undefined;
    }

    /**
     * Create a standard GOV-TRJ-001 Issue object.
     */
    private createRegressionIssue(filePath: string, line: number, message: string): Issue {
        const randomSuffix = Math.random().toString(36).slice(2, 6);
        return {
            id: `gov-trj-${Date.now()}-${randomSuffix}`,
            rule: 'GOV-TRJ-001',
            severity: 'error',
            analyzer: 'governance',
            message,
            location: {
                file: filePath,
                start: { line, column: 1 },
                end: { line, column: 1 },
            },
            detail: {
                category: 'governance',
                risk: 'Cyclic flip-flop or regressive mutation disrupts code stability and breaks evolutionary invariants.',
                rationale:
                    'Historical trajectories must progress monotonically towards improved quality.',
                fixable: false,
                targetLanguage: 'any',
            },
        };
    }
}

/** Global default singleton instance */
export const defaultRegressionTrajectoryDetector = new RegressionTrajectoryDetector();
