/**
 * Module: Core Engine — Change Trajectory Anomaly Detection
 * File Path: src/core/trajectory/anomalyDetector.ts
 * Architecture Role: Stateless comparison engine in the trajectory layer; owns no state and is
 *   invoked per revision by ChangeTrajectoryManager to turn revision deltas into anomalies
 * Dependencies & Triggers: Imports EvolutionAnomaly / FileRevision / TrajectoryComparison from
 *   ./types, ALL_QUALITY_DIMENSIONS / QualityDimension from ../scoring/scoringTypes and
 *   TrajectoryMessages from ../messages; triggered synchronously on every recorded revision
 *   (Scanner finalization, dual-track Step 1.7, API trajectory replay, training export)
 * Responsibilities: Recompute rounded per-dimension and composite score deltas; detect logical
 *   rollback when fileHash / astDigest matches a non-adjacent past revision; emit composite
 *   (<= -5) and per-dimension (<= -10) quality-regression anomalies unless rolling back;
 *   flag agent style drift (standardization or commentQuality < -5); report re-introduced
 *   rule hit ids seen in older history; report duplicate/conflicting fixes on overlapping
 *   modifiedDomains with |compositeDelta| < 2; populate newIssues, resolvedIssues and summary
 * Exit Semantics & Design Rationale: Pure synchronous computation, never throws and performs no
 *   I/O; always returns a TrajectoryComparison (filePath left empty for the manager to stamp).
 *   It mutates `current` for rollback flags so every consumer sees one authoritative verdict,
 *   and treats anomalies as advisory data rather than exceptions so a scan is never aborted.
 */
import type { EvolutionAnomaly, FileRevision, TrajectoryComparison } from './types';
import type { QualityDimension } from '../scoring/scoringTypes';
import { ALL_QUALITY_DIMENSIONS } from '../scoring/scoringTypes';
import { TrajectoryMessages } from '../messages';

/** Default per-dimension quality score used when a revision omits an index. */
const DEFAULT_QUALITY_SCORE = 100;

/** Composite-score drop magnitude that triggers a quality-regression anomaly. */
const COMPOSITE_REGRESSION_THRESHOLD = 5.0;

/** Per-dimension score drop magnitude that triggers a quality-regression anomaly. */
const DIMENSION_REGRESSION_THRESHOLD = 10.0;

/** Standardization or comment-quality drop magnitude that triggers an agent style-drift anomaly. */
const STYLE_DRIFT_THRESHOLD = 5;

/** Scale factor used to round score deltas to one decimal place (multiply, then divide). */
const SCORE_DELTA_ROUND_SCALE = 10;

/** Base-10 radix for parsing the trailing line number out of a rule-hit id. */
const DECIMAL_RADIX = 10;

/**
 * Detects evolution anomalies, quality regressions, style drifts,
 * re-introduced issues and logical rollbacks across revisions and agents.
 */
export class AnomalyDetector {
    /**
     * Compare two revisions and detect anomalies.
     * `history` contains all past revisions in chronological order.
     */
    detect(
        current: FileRevision,
        previous: FileRevision,
        history: FileRevision[] = [],
    ): TrajectoryComparison {
        const dimensionDeltas: Record<QualityDimension, number> = {} as any;
        for (const dim of ALL_QUALITY_DIMENSIONS) {
            const prevScore = previous.qualityScore.indices[dim] ?? DEFAULT_QUALITY_SCORE;
            const currScore = current.qualityScore.indices[dim] ?? DEFAULT_QUALITY_SCORE;
            dimensionDeltas[dim] =
                Math.round((currScore - prevScore) * SCORE_DELTA_ROUND_SCALE) /
                SCORE_DELTA_ROUND_SCALE;
        }

        const compositeDelta =
            Math.round(
                (current.qualityScore.compositeScore - previous.qualityScore.compositeScore) *
                    SCORE_DELTA_ROUND_SCALE,
            ) / SCORE_DELTA_ROUND_SCALE;

        const anomalies: EvolutionAnomaly[] = [];

        // 1. Check for Logical Rollback / Recovery
        let isLogicalRollback = false;
        for (let i = 0; i < history.length - 1; i++) {
            const past = history[i];
            if (
                past.revisionId !== previous.revisionId &&
                (past.fileHash === current.fileHash || past.astDigest === current.astDigest)
            ) {
                isLogicalRollback = true;
                current.isRollback = true;
                current.rolledBackToRevisionId = past.revisionId;
                anomalies.push({
                    kind: 'logical-rollback',
                    severity: 'info',
                    message: TrajectoryMessages.LOGICAL_ROLLBACK(past.revisionId, past.agentUid),
                    affectedAgents: [past.agentUid, current.agentUid],
                    details: { restoredRevisionId: past.revisionId },
                });
                break;
            }
        }

        // 2. Check for Quality Regression (if not a logical rollback)
        if (!isLogicalRollback) {
            if (compositeDelta <= -COMPOSITE_REGRESSION_THRESHOLD) {
                anomalies.push({
                    kind: 'quality-regression',
                    severity: 'error',
                    message: TrajectoryMessages.COMPOSITE_QUALITY_REGRESSION(
                        Math.abs(compositeDelta),
                        current.agentUid,
                    ),
                    affectedAgents: [previous.agentUid, current.agentUid],
                    details: { compositeDelta },
                });
            }

            for (const dim of ALL_QUALITY_DIMENSIONS) {
                const delta = dimensionDeltas[dim];
                if (delta <= -DIMENSION_REGRESSION_THRESHOLD) {
                    anomalies.push({
                        kind: 'quality-regression',
                        dimension: dim,
                        severity: 'warning',
                        message: TrajectoryMessages.DIMENSION_QUALITY_REGRESSION(
                            dim,
                            Math.abs(delta),
                        ),
                        affectedAgents: [previous.agentUid, current.agentUid],
                        details: { dimension: dim, delta },
                    });
                }
            }
        }

        // 3. Check for Style Drift
        if (previous.agentUid !== current.agentUid) {
            const namingDelta = dimensionDeltas.standardization;
            const commentDelta = dimensionDeltas.commentQuality;
            if (namingDelta < -STYLE_DRIFT_THRESHOLD || commentDelta < -STYLE_DRIFT_THRESHOLD) {
                anomalies.push({
                    kind: 'style-drift',
                    severity: 'warning',
                    message: TrajectoryMessages.STYLE_DRIFT(previous.agentUid, current.agentUid),
                    affectedAgents: [previous.agentUid, current.agentUid],
                    details: { namingDelta, commentDelta },
                });
            }
        }

        // 4. Check for Re-introduced Issues
        const prevIssues = new Set(previous.ruleHitIds);
        const currIssues = new Set(current.ruleHitIds);

        const newIssueIds = current.ruleHitIds.filter((id) => !prevIssues.has(id));
        const resolvedIssueIds = previous.ruleHitIds.filter((id) => !currIssues.has(id));

        // Check if any new issue existed in older history before previous revision
        for (const newId of newIssueIds) {
            for (const oldRev of history) {
                if (
                    oldRev.revisionId !== previous.revisionId &&
                    oldRev.ruleHitIds.includes(newId)
                ) {
                    anomalies.push({
                        kind: 're-introduced-issue',
                        severity: 'error',
                        message: TrajectoryMessages.REINTRODUCED_ISSUE(newId, oldRev.revisionId),
                        affectedAgents: [oldRev.agentUid, current.agentUid],
                        details: { issueId: newId, originRevision: oldRev.revisionId },
                    });
                    break;
                }
            }
        }

        // 5. Check for Duplicate / Conflicting Fixes
        if (
            previous.agentUid !== current.agentUid &&
            (current.diffSummary?.modifiedDomains || []).length > 0
        ) {
            const prevMods = new Set(previous.diffSummary?.modifiedDomains || []);
            const overlapping = (current.diffSummary?.modifiedDomains || []).filter((d) =>
                prevMods.has(d),
            );
            if (overlapping.length > 0 && Math.abs(compositeDelta) < 2) {
                anomalies.push({
                    kind: 'duplicate-fix',
                    severity: 'info',
                    message: TrajectoryMessages.RECURRING_CONFLICTING_MODS(overlapping),
                    affectedAgents: [previous.agentUid, current.agentUid],
                    details: { domains: overlapping },
                });
            }
        }

        return {
            filePath: '',
            fromRevisionId: previous.revisionId,
            toRevisionId: current.revisionId,
            fromAgent: previous.agentUid,
            toAgent: current.agentUid,
            dimensionDeltas,
            compositeDelta,
            newIssues: newIssueIds.map((id) => ({
                id,
                rule: id.split(':')[1] || id,
                severity: 'warning',
                line: parseInt(id.split(':')[3] || '1', DECIMAL_RADIX),
                message: TrajectoryMessages.NEW_ISSUE_LABEL,
            })),
            resolvedIssues: resolvedIssueIds.map((id) => ({
                id,
                rule: id.split(':')[1] || id,
                severity: 'info',
                line: parseInt(id.split(':')[3] || '1', DECIMAL_RADIX),
                message: TrajectoryMessages.RESOLVED_ISSUE_LABEL,
            })),
            anomalies,
            isLogicalRollback,
            summary: isLogicalRollback
                ? TrajectoryMessages.SUMMARY_ROLLBACK(current.rolledBackToRevisionId || '')
                : compositeDelta >= 0
                  ? TrajectoryMessages.SUMMARY_IMPROVED(compositeDelta)
                  : TrajectoryMessages.SUMMARY_REGRESSED(compositeDelta),
        };
    }
}
