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
import type { Severity } from '../types';
import { SEVERITY_WARNING, SEVERITY_INFO, SEVERITY_ERROR } from '../types';

const ANOMALY_KIND_REINTRODUCED = 're-introduced-issue';
const ANOMALY_KIND_DUPLICATE_FIX = 'duplicate-fix';

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
 * Compute delta between two revisions for each quality dimension.
 *
 * @param current - Current file revision.
 * @param previous - Prior file revision.
 * @returns Map of quality dimensions to rounded score deltas.
 */
function calculateDimensionDeltas(
    current: FileRevision,
    previous: FileRevision,
): Record<QualityDimension, number> {
    const dimensionDeltas: Record<QualityDimension, number> = {} as any;
    for (const dim of ALL_QUALITY_DIMENSIONS) {
        const prevScore = previous.qualityScore.indices[dim] ?? DEFAULT_QUALITY_SCORE;
        const currScore = current.qualityScore.indices[dim] ?? DEFAULT_QUALITY_SCORE;
        dimensionDeltas[dim] =
            Math.round((currScore - prevScore) * SCORE_DELTA_ROUND_SCALE) / SCORE_DELTA_ROUND_SCALE;
    }
    return dimensionDeltas;
}

/**
 * Compute composite score delta between two revisions.
 *
 * @param current - Current file revision.
 * @param previous - Prior file revision.
 * @returns Rounded composite score delta.
 */
function calculateCompositeDelta(current: FileRevision, previous: FileRevision): number {
    return (
        Math.round(
            (current.qualityScore.compositeScore - previous.qualityScore.compositeScore) *
                SCORE_DELTA_ROUND_SCALE,
        ) / SCORE_DELTA_ROUND_SCALE
    );
}

/**
 * Detect logical rollback or recovery to an earlier non-adjacent revision.
 *
 * @param current - Current file revision.
 * @param previous - Prior file revision.
 * @param history - Complete chronological history of file revisions.
 * @returns EvolutionAnomaly if rollback detected, otherwise null.
 */
function detectLogicalRollback(
    current: FileRevision,
    previous: FileRevision,
    history: FileRevision[],
): EvolutionAnomaly | null {
    for (let i = 0; i < history.length - 1; i++) {
        const past = history[i];
        if (
            past.revisionId !== previous.revisionId &&
            (past.fileHash === current.fileHash || past.astDigest === current.astDigest)
        ) {
            current.isRollback = true;
            current.rolledBackToRevisionId = past.revisionId;
            return {
                kind: 'logical-rollback',
                severity: 'info',
                message: TrajectoryMessages.LOGICAL_ROLLBACK(past.revisionId, past.agentUid),
                affectedAgents: [past.agentUid, current.agentUid],
                details: { restoredRevisionId: past.revisionId },
            };
        }
    }
    return null;
}

/**
 * Detect quality regressions in composite or dimension scores.
 *
 * @param current - Current file revision.
 * @param previous - Prior file revision.
 * @param compositeDelta - Rounded composite score delta.
 * @param dimensionDeltas - Rounded per-dimension score deltas.
 * @returns List of detected quality regression anomalies.
 */
function detectQualityRegressions(
    current: FileRevision,
    previous: FileRevision,
    compositeDelta: number,
    dimensionDeltas: Record<QualityDimension, number>,
): EvolutionAnomaly[] {
    const anomalies: EvolutionAnomaly[] = [];

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
                message: TrajectoryMessages.DIMENSION_QUALITY_REGRESSION(dim, Math.abs(delta)),
                affectedAgents: [previous.agentUid, current.agentUid],
                details: { dimension: dim, delta },
            });
        }
    }

    return anomalies;
}

/**
 * Detect agent style drift between different authors across revisions.
 *
 * @param current - Current file revision.
 * @param previous - Prior file revision.
 * @param dimensionDeltas - Rounded per-dimension score deltas.
 * @returns EvolutionAnomaly if style drift detected, otherwise null.
 */
function detectStyleDrift(
    current: FileRevision,
    previous: FileRevision,
    dimensionDeltas: Record<QualityDimension, number>,
): EvolutionAnomaly | null {
    if (previous.agentUid === current.agentUid) return null;

    const namingDelta = dimensionDeltas.standardization;
    const commentDelta = dimensionDeltas.commentQuality;
    if (namingDelta < -STYLE_DRIFT_THRESHOLD || commentDelta < -STYLE_DRIFT_THRESHOLD) {
        return {
            kind: 'style-drift',
            severity: 'warning',
            message: TrajectoryMessages.STYLE_DRIFT(previous.agentUid, current.agentUid),
            affectedAgents: [previous.agentUid, current.agentUid],
            details: { namingDelta, commentDelta },
        };
    }
    return null;
}

/**
 * Detect issues re-introduced from older history revisions.
 *
 * @param newIssueIds - Issue IDs present in current revision but not previous.
 * @param current - Current file revision.
 * @param previous - Prior file revision.
 * @param history - Complete chronological history of file revisions.
 * @returns List of re-introduced issue anomalies.
 */
function detectReintroducedIssues(
    newIssueIds: string[],
    current: FileRevision,
    previous: FileRevision,
    history: FileRevision[],
): EvolutionAnomaly[] {
    const anomalies: EvolutionAnomaly[] = [];

    for (const newId of newIssueIds) {
        for (const oldRev of history) {
            if (oldRev.revisionId !== previous.revisionId && oldRev.ruleHitIds.includes(newId)) {
                anomalies.push({
                    kind: ANOMALY_KIND_REINTRODUCED,
                    severity: SEVERITY_ERROR,
                    message: TrajectoryMessages.REINTRODUCED_ISSUE(newId, oldRev.revisionId),
                    affectedAgents: [oldRev.agentUid, current.agentUid],
                    details: { issueId: newId, originRevision: oldRev.revisionId },
                });
                break;
            }
        }
    }

    return anomalies;
}

/**
 * Detect duplicate or conflicting modifications across different agents.
 *
 * @param current - Current file revision.
 * @param previous - Prior file revision.
 * @param compositeDelta - Rounded composite score delta.
 * @returns EvolutionAnomaly if conflicting fix detected, otherwise null.
 */
function detectConflictingFixes(
    current: FileRevision,
    previous: FileRevision,
    compositeDelta: number,
): EvolutionAnomaly | null {
    if (
        previous.agentUid !== current.agentUid &&
        (current.diffSummary?.modifiedDomains || []).length > 0
    ) {
        const prevMods = new Set(previous.diffSummary?.modifiedDomains || []);
        const overlapping = (current.diffSummary?.modifiedDomains || []).filter((d) =>
            prevMods.has(d),
        );
        if (overlapping.length > 0 && Math.abs(compositeDelta) < 2) {
            return {
                kind: ANOMALY_KIND_DUPLICATE_FIX,
                severity: SEVERITY_INFO,
                message: TrajectoryMessages.RECURRING_CONFLICTING_MODS(overlapping),
                affectedAgents: [previous.agentUid, current.agentUid],
                details: { domains: overlapping },
            };
        }
    }
    return null;
}

/**
 * Format issue ids into trajectory issue summary objects.
 *
 * @param issueIds - List of issue rule hit strings.
 * @param severity - Severity to label the issues with.
 * @param defaultMessage - User-facing description label.
 * @returns Array of structured issue records.
 */
function formatIssueSummaries(issueIds: string[], severity: Severity, defaultMessage: string) {
    return issueIds.map((id) => ({
        id,
        rule: id.split(':')[1] || id,
        severity,
        line: parseInt(id.split(':')[3] || '1', DECIMAL_RADIX),
        message: defaultMessage,
    }));
}

/**
 * Format a human-readable comparison summary string.
 *
 * @param isLogicalRollback - Whether a logical rollback was detected.
 * @param rolledBackToRevisionId - Target revision ID if rolled back.
 * @param compositeDelta - Rounded composite score delta.
 * @returns Explanatory summary message.
 */
function formatTrajectorySummary(
    isLogicalRollback: boolean,
    rolledBackToRevisionId: string | undefined,
    compositeDelta: number,
): string {
    if (isLogicalRollback) {
        return TrajectoryMessages.SUMMARY_ROLLBACK(rolledBackToRevisionId || '');
    }
    return compositeDelta >= 0
        ? TrajectoryMessages.SUMMARY_IMPROVED(compositeDelta)
        : TrajectoryMessages.SUMMARY_REGRESSED(compositeDelta);
}

/**
 * Detects evolution anomalies, quality regressions, style drifts,
 * re-introduced issues and logical rollbacks across revisions and agents.
 */
export class AnomalyDetector {
    /**
     * Compare two revisions and detect anomalies.
     * `history` contains all past revisions in chronological order.
     *
     * @param current - Current file revision to evaluate.
     * @param previous - Prior baseline file revision.
     * @param history - Complete chronological history of file revisions.
     * @returns Complete trajectory comparison with detected anomalies.
     */
    detect(
        current: FileRevision,
        previous: FileRevision,
        history: FileRevision[] = [],
    ): TrajectoryComparison {
        const dimensionDeltas = calculateDimensionDeltas(current, previous);
        const compositeDelta = calculateCompositeDelta(current, previous);
        const anomalies: EvolutionAnomaly[] = [];

        const rollbackAnomaly = detectLogicalRollback(current, previous, history);
        const isLogicalRollback = rollbackAnomaly !== null;
        if (rollbackAnomaly) {
            anomalies.push(rollbackAnomaly);
        } else {
            anomalies.push(
                ...detectQualityRegressions(current, previous, compositeDelta, dimensionDeltas),
            );
        }

        const styleDriftAnomaly = detectStyleDrift(current, previous, dimensionDeltas);
        if (styleDriftAnomaly) {
            anomalies.push(styleDriftAnomaly);
        }

        const prevIssues = new Set(previous.ruleHitIds);
        const currIssues = new Set(current.ruleHitIds);
        const newIssueIds = current.ruleHitIds.filter((id) => !prevIssues.has(id));
        const resolvedIssueIds = previous.ruleHitIds.filter((id) => !currIssues.has(id));

        anomalies.push(...detectReintroducedIssues(newIssueIds, current, previous, history));

        const conflictAnomaly = detectConflictingFixes(current, previous, compositeDelta);
        if (conflictAnomaly) {
            anomalies.push(conflictAnomaly);
        }

        return {
            filePath: '',
            fromRevisionId: previous.revisionId,
            toRevisionId: current.revisionId,
            fromAgent: previous.agentUid,
            toAgent: current.agentUid,
            dimensionDeltas,
            compositeDelta,
            newIssues: formatIssueSummaries(
                newIssueIds,
                SEVERITY_WARNING,
                TrajectoryMessages.NEW_ISSUE_LABEL,
            ),
            resolvedIssues: formatIssueSummaries(
                resolvedIssueIds,
                SEVERITY_INFO,
                TrajectoryMessages.RESOLVED_ISSUE_LABEL,
            ),
            anomalies,
            isLogicalRollback,
            summary: formatTrajectorySummary(
                isLogicalRollback,
                current.rolledBackToRevisionId,
                compositeDelta,
            ),
        };
    }
}
