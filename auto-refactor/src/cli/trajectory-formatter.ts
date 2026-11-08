/**
 * Module: Automated Code Refactoring Engine (CLI Trajectory Presentation Formatter)
 * File Path: src/cli/trajectory-formatter.ts
 * Architecture Role: CLI presentation formatting and terminal dashboard rendering
 * Dependencies & Triggers: Consumed by src/cli/trajectory-cmd.ts
 * Responsibilities: Formats ASCII tables, rolling moments, file trajectory revisions,
 *   and sparklines
 * Exit Semantics & Design Rationale: Deterministic string generation without side effects.
 */

import {
    type TimelineBucketSnapshot,
    type TimelineProjectionReport,
} from '../core/trajectory/timeline-projector';
import { getChangeTrajectory } from '../api';
import { RollingSamplingGovernor } from '../core/scoring/rolling-sampling-governor';

/** Console formatting layout and column width metrics. */
export const TRAJECTORY_FORMAT_METRICS = Object.freeze({
    REVISION_DISPLAY_LENGTH: 8,
    LOC_TO_EQUIV_RATIO: 1.37,
    MILLION_DIVISOR: 1000000,
    LINE_CONTENT_WIDTH: 75,
    IDLE_LINE_WIDTH: 72,
    BUCKET_ID_COL_WIDTH: 20,
    RUNS_COL_WIDTH: 5,
    SEMANTIC_COL_WIDTH: 9,
    DEBT_DELTA_COL_WIDTH: 11,
    SCORE_RANGE_COL_WIDTH: 17,
    METRIC_SCORE_COL_WIDTH: 7,
    TARGET_SCOPE_WIDTH: 61,
    NUM_THOUSAND: 1000,
});

/** Terminal border decoration characters and dividers. */
export const TRAJECTORY_BORDERS = Object.freeze({
    TOP: '┌─────────────────────────────────────────────────────────────────────────────┐',
    MIDDLE: '├─────────────────────────────────────────────────────────────────────────────┤',
    BOTTOM: '└─────────────────────────────────────────────────────────────────────────────┘',
    HEADER_SEPARATOR: '│ ──────────────────  ─────  ────────  ───────────  ─────────────────  ──────  ───── │',
    FILE_FOOTER: '========================================\n',
});

/** Sparkline level characters from min to max. */
const SPARKLINE_CHARS: readonly string[] = [' ', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

/**
 * Renders an array of numeric values into a visual sparkline string.
 *
 * @param values - Array of numeric samples.
 * @returns Sparkline string representing relative heights.
 */
export function renderSparkline(values: readonly number[]): string {
    if (values.length === 0) return '';
    const min = Math.min(...values);
    const max = Math.max(...values);
    if (max === min) {
        return SPARKLINE_CHARS[SPARKLINE_CHARS.length - 1].repeat(values.length);
    }

    const range = max - min;
    const bins = SPARKLINE_CHARS.length - 1;

    return values
        .map((value) => {
            const normalized = Math.max(0, Math.min(1, (value - min) / range));
            const index = Math.round(normalized * bins);
            return SPARKLINE_CHARS[index];
        })
        .join('');
}

/**
 * Formats a single timeline row for console table output.
 *
 * @param snapshot - Individual bucket snapshot record.
 * @returns Formatted table line string.
 */
export function formatBucketRow(snapshot: TimelineBucketSnapshot): string {
    const {
        IDLE_LINE_WIDTH,
        BUCKET_ID_COL_WIDTH,
        RUNS_COL_WIDTH,
        SEMANTIC_COL_WIDTH,
        DEBT_DELTA_COL_WIDTH,
        SCORE_RANGE_COL_WIDTH,
        METRIC_SCORE_COL_WIDTH,
        NUM_THOUSAND,
    } = TRAJECTORY_FORMAT_METRICS;

    if (snapshot.isIdleFold) {
        return `│ ── ${snapshot.bucketId.padEnd(IDLE_LINE_WIDTH, '·')} 0 runs │`;
    }

    const bucketIdColumn = snapshot.bucketId.padEnd(BUCKET_ID_COL_WIDTH).slice(0, BUCKET_ID_COL_WIDTH);
    const runsCountColumn = String(snapshot.runsCount).padStart(RUNS_COL_WIDTH);
    const semanticColumn = `${(snapshot.semanticEloc / NUM_THOUSAND).toFixed(1)}k`.padStart(SEMANTIC_COL_WIDTH);
    const netSign = snapshot.debtResolved >= snapshot.debtAdded ? '-' : '+';
    const debtDeltaValue = Math.abs(snapshot.debtResolved - snapshot.debtAdded);
    const debtDeltaColumn = `${netSign}${debtDeltaValue} pts`.padStart(DEBT_DELTA_COL_WIDTH);
    const scoreRangeText = `[${snapshot.scoreFloor.toFixed(1)}~${snapshot.scoreCeiling.toFixed(1)}]`;
    const scoreRangeColumn = `${snapshot.latestScore.toFixed(2)} ${scoreRangeText}`.padEnd(SCORE_RANGE_COL_WIDTH).slice(0, SCORE_RANGE_COL_WIDTH);
    const weightedMeanColumn = snapshot.weightedMeanScore.toFixed(2).padStart(METRIC_SCORE_COL_WIDTH);
    const gatePassRateColumn = `${snapshot.gatePassRate.toFixed(1)}%`.padStart(METRIC_SCORE_COL_WIDTH);

    return `│ ${bucketIdColumn} ${runsCountColumn} ${semanticColumn} ${debtDeltaColumn} ${scoreRangeColumn} ${weightedMeanColumn} ${gatePassRateColumn} │`;
}

/**
 * Builds formatted text lines for the temporal rolling moments section.
 *
 * @param rootDir - Root directory containing rolling state cache.
 * @returns Array of formatted console rows.
 */
export function renderRollingMomentsSection(rootDir: string): string[] {
    const lines: string[] = [];
    const governor = new RollingSamplingGovernor({ workspaceRoot: rootDir });
    const telemetry = governor.getDashboardTelemetry();

    lines.push(TRAJECTORY_BORDERS.MIDDLE);
    lines.push(`│ 📊 TEMPORAL ROLLING EQUILIBRIUM (Multi-Pass Moments)                        │`);

    if (telemetry.sampleCount === 0) {
        lines.push(`│ • Rolling Buffer: No active multi-pass samples recorded in cache.           │`);
    } else {
        const fastLine = `• Fast  Pass (N=5)  : Mean ${telemetry.fastWindow.mean.toFixed(2)} | σ ${telemetry.fastWindow.stdDev.toFixed(2)}  [Recent Mutation Window]`;
        const mesoLine = `• Meso  Pass (N=20) : Mean ${telemetry.mesoWindow.mean.toFixed(2)} | σ ${telemetry.mesoWindow.stdDev.toFixed(2)}  [Medium Equilibrium]`;
        const macroLine = `• Macro Pass (N=60) : Mean ${telemetry.macroWindow.mean.toFixed(2)} | σ ${telemetry.macroWindow.stdDev.toFixed(2)}  [Long-term Attractor]`;
        const shiftTag = telemetry.isRegimeShift ? 'TRUE (Shift)' : 'FALSE (Stable)';
        const statusLine = `• Regime Shift: ${shiftTag} | Z-Score: ${telemetry.studentizedZScore.toFixed(2)} | Stability Factor: ${telemetry.stabilityFactor.toFixed(2)}`;

        lines.push(`│ ${fastLine.padEnd(TRAJECTORY_FORMAT_METRICS.LINE_CONTENT_WIDTH)} │`);
        lines.push(`│ ${mesoLine.padEnd(TRAJECTORY_FORMAT_METRICS.LINE_CONTENT_WIDTH)} │`);
        lines.push(`│ ${macroLine.padEnd(TRAJECTORY_FORMAT_METRICS.LINE_CONTENT_WIDTH)} │`);
        lines.push(`│ ${statusLine.padEnd(TRAJECTORY_FORMAT_METRICS.LINE_CONTENT_WIDTH)} │`);
    }

    return lines;
}

/**
 * Builds formatted ASCII table for timeline projection.
 *
 * @param report - Projected timeline report.
 * @param withSparkline - Whether to append terminal trend sparkline.
 * @returns Array of formatted table lines.
 */
export function renderTimelineTableSection(
    report: TimelineProjectionReport,
    withSparkline = false,
): string[] {
    const lines: string[] = [];
    lines.push(TRAJECTORY_BORDERS.MIDDLE);
    const headerTitle = `⏱️  VIRTUAL TIMELINE PROJECTION (Bucket: ${report.bucketType}, Adaptive Folded)`;
    lines.push(`│ ${headerTitle.padEnd(TRAJECTORY_FORMAT_METRICS.LINE_CONTENT_WIDTH)} │`);
    lines.push(`│ RELATIVE WINDOW      RUNS  SEM_ELOC    DEBT(Δ)     LATEST [RANGE]   W_MEAN    GATE │`);
    lines.push(TRAJECTORY_BORDERS.HEADER_SEPARATOR);

    if (report.buckets.length === 0) {
        lines.push(`│ No trajectory runs recorded in the requested time interval.                 │`);
    } else {
        for (const bucket of report.buckets) {
            lines.push(formatBucketRow(bucket));
        }

        const activeScores = report.buckets
            .filter((b) => !b.isIdleFold && b.runsCount > 0)
            .map((b) => b.weightedMeanScore);
        if (withSparkline && activeScores.length > 0) {
            const spark = renderSparkline(activeScores);
            const trend = activeScores[activeScores.length - 1] >= activeScores[0] ? '↗' : '↘';
            const minScore = Math.min(...activeScores).toFixed(2);
            const maxScore = Math.max(...activeScores).toFixed(2);
            lines.push(TRAJECTORY_BORDERS.HEADER_SEPARATOR);
            const sparkLine = `📈 Trend Sparkline: [${spark}] (Range: ${minScore}~${maxScore}, Dir: ${trend})`;
            lines.push(`│ ${sparkLine.padEnd(TRAJECTORY_FORMAT_METRICS.LINE_CONTENT_WIDTH)} │`);
        }
    }

    return lines;
}

/**
 * Builds formatted output for individual file change trajectory.
 *
 * @param targetFile - Repository-relative target file path.
 * @returns Plain text report.
 */
export function buildFileTrajectoryText(targetFile: string): string {
    const fileTrajectory = getChangeTrajectory(targetFile);
    if (!fileTrajectory || fileTrajectory.revisions.length === 0) {
        return `No historical trajectory recorded for ${targetFile}\n`;
    }

    const lines: string[] = [];
    lines.push(`\n=== Change Trajectory: ${targetFile} ===`);
    lines.push(`Total Revisions: ${fileTrajectory.totalRevisions} | Agents: ${fileTrajectory.participatingAgents.join(', ')}`);

    for (const revision of fileTrajectory.revisions) {
        const score = revision.qualityScore?.compositeScore;
        const scoreText = typeof score === 'number' && Number.isFinite(score) ? score.toFixed(2) : 'N/A';
        const dateStr = new Date(revision.timestamp).toISOString();
        const shortRev = revision.revisionId.slice(0, TRAJECTORY_FORMAT_METRICS.REVISION_DISPLAY_LENGTH);
        lines.push(`  • [${dateStr}] Rev ${shortRev} by Agent: ${revision.agentUid} | Score: ${scoreText}`);
    }

    if (fileTrajectory.activeAnomalies.length > 0) {
        lines.push(`Active Anomalies:`);
        for (const anomaly of fileTrajectory.activeAnomalies) {
            lines.push(`  ⚠️ [${anomaly.kind}] ${anomaly.message}`);
        }
    }
    lines.push(TRAJECTORY_BORDERS.FILE_FOOTER);
    return lines.join('\n');
}
