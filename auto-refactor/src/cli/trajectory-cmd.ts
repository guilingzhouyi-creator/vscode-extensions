/**
 * Module: CLI — Trajectory & Multi-Scale Telemetry Controller
 * File Path: src/cli/trajectory-cmd.ts
 * Architecture Role: Dispatches and renders trajectory queries, unified lifetime summaries,
 *   rolling statistical moments, and multi-scale virtual timeline projections.
 * Dependencies & Triggers: Consumes timeline-projector, compact-ledger-store, rolling-sampling-governor,
 *   and changeTrajectory; called by CLI main entry point.
 * Responsibilities: Parse trajectory CLI arguments, resolve repository root, render ANSI-formatted
 *   integrated dashboards or JSON streams, and handle file-specific change trajectories.
 * Exit Semantics & Design Rationale: Decouples command presentation from main index.ts facade,
 *   guarantees zero-throw defensive execution, returns explicit { text, code } result bundles.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
    projectTimelineReport,
    type TimelineBucketSnapshot,
    type TimelineBucketType,
    type TimelineProjectionReport,
} from '../core/trajectory/timeline-projector';
import { readLifetimeSummary } from '../core/trajectory/compact-ledger-store';
import { getChangeTrajectory } from '../api';
import { RollingSamplingGovernor } from '../core/scoring/rolling-sampling-governor';

/** Trajectory folder name inside repository root. */
const TRAJECTORY_DIR_NAME = '.refactor-trajectory';

/** Lifetime summary file name. */
const LIFETIME_SUMMARY_FILE = 'lifetime.summary.json';

/** Subproject folder fallback name. */
const PROJECT_SUBDIR_NAME = 'auto-refactor';

/** Display truncation length for short commit revisions. */
const REVISION_DISPLAY_LENGTH = 8;

/** Default LOC-to-equivalent ratio for display. */
const LOC_TO_EQUIV_RATIO = 1.37;
const MILLION_DIVISOR = 1000000;

/** Parsed options for trajectory command execution. */
interface TrajectoryCommandOptions {
    rootDir: string;
    targetFile?: string;
    isSummaryOnly: boolean;
    isJson: boolean;
    since?: string;
    bucket?: TimelineBucketType;
    outputFilePath?: string;
}

/**
 * Checks if a target path exists asynchronously.
 */
async function pathExists(targetPath: string): Promise<boolean> {
    try {
        await fs.promises.access(targetPath);
        return true;
    } catch {
        return false;
    }
}

/**
 * Resolves trajectory ledger directory respecting root and subproject layouts.
 */
async function resolveLedgerDir(rootDir: string): Promise<string | null> {
    const directPath = path.join(rootDir, TRAJECTORY_DIR_NAME);
    if (await pathExists(directPath)) {
        return directPath;
    }
    const subprojectPath = path.join(rootDir, PROJECT_SUBDIR_NAME, TRAJECTORY_DIR_NAME);
    if (await pathExists(subprojectPath)) {
        return subprojectPath;
    }
    return null;
}

/**
 * Extracts string value following an option flag.
 */
function findOptionValue(args: string[], flag: string): string | undefined {
    const flagIndex = args.indexOf(flag);
    return flagIndex !== -1 && args[flagIndex + 1] ? args[flagIndex + 1] : undefined;
}

/**
 * Validates and converts raw string to recognized TimelineBucketType.
 */
function parseBucketType(raw?: string): TimelineBucketType | undefined {
    if (!raw) return undefined;
    const lower = raw.toLowerCase();
    switch (lower) {
        case 'hour':
        case 'day':
        case 'commit':
        case 'agent':
            return lower;
        default:
            return undefined;
    }
}

/**
 * Extracts target file argument if provided.
 */
function findTargetFile(args: string[]): string | undefined {
    const flagValues = new Set<string>();
    const flagsWithArgs = ['--root', '--since', '--bucket', '--format', '--out'];

    for (const flag of flagsWithArgs) {
        const optionValue = findOptionValue(args, flag);
        if (optionValue) flagValues.add(optionValue);
    }

    for (const token of args) {
        if (token.startsWith('-') || token === 'trajectory') continue;
        if (flagValues.has(token)) continue;
        return token;
    }
    return undefined;
}

/**
 * Parses trajectory command line argument flags.
 */
function parseTrajectoryArgs(args: string[]): TrajectoryCommandOptions {
    const rawRoot = findOptionValue(args, '--root');
    const rootDir = rawRoot ? path.resolve(rawRoot) : process.cwd();
    const formatOption = findOptionValue(args, '--format');
    const isJson = args.includes('--json') || formatOption?.toLowerCase() === 'json';
    const isSummaryOnly = args.includes('--summary') || args.includes('-s');
    const since = findOptionValue(args, '--since');
    const bucket = parseBucketType(findOptionValue(args, '--bucket'));
    const outputFilePath = findOptionValue(args, '--out');
    const targetFile = findTargetFile(args);

    return { rootDir, targetFile, isSummaryOnly, isJson, since, bucket, outputFilePath };
}

/**
 * Formats a single timeline row for console table output.
 */
function formatBucketRow(snapshot: TimelineBucketSnapshot): string {
    if (snapshot.isIdleFold) {
        return `│ ── ${snapshot.bucketId.padEnd(72, '·')} 0 runs │`;
    }

    const bucketIdColumn = snapshot.bucketId.padEnd(20).slice(0, 20);
    const runsCountColumn = String(snapshot.runsCount).padStart(5);
    const semanticColumn = `${(snapshot.semanticEloc / 1000).toFixed(1)}k`.padStart(9);
    const netSign = snapshot.debtResolved >= snapshot.debtAdded ? '-' : '+';
    const debtDeltaValue = Math.abs(snapshot.debtResolved - snapshot.debtAdded);
    const debtDeltaColumn = `${netSign}${debtDeltaValue} pts`.padStart(11);
    const scoreRangeText = `[${snapshot.scoreFloor.toFixed(1)}~${snapshot.scoreCeiling.toFixed(1)}]`;
    const scoreRangeColumn = `${snapshot.latestScore.toFixed(2)} ${scoreRangeText}`.padEnd(17).slice(0, 17);
    const weightedMeanColumn = snapshot.weightedMeanScore.toFixed(2).padStart(7);
    const gatePassRateColumn = `${snapshot.gatePassRate.toFixed(1)}%`.padStart(7);

    return `│ ${bucketIdColumn} ${runsCountColumn} ${semanticColumn} ${debtDeltaColumn} ${scoreRangeColumn} ${weightedMeanColumn} ${gatePassRateColumn} │`;
}

/**
 * Builds formatted text lines for the temporal rolling moments section.
 */
function renderRollingMomentsSection(rootDir: string): string[] {
    const lines: string[] = [];
    const governor = new RollingSamplingGovernor({ workspaceRoot: rootDir });
    const telemetry = governor.getDashboardTelemetry();

    lines.push(`├─────────────────────────────────────────────────────────────────────────────┤`);
    lines.push(`│ 📊 TEMPORAL ROLLING EQUILIBRIUM (Multi-Pass Moments)                        │`);

    if (telemetry.sampleCount === 0) {
        lines.push(`│ • Rolling Buffer: No active multi-pass samples recorded in cache.           │`);
    } else {
        const fastLine = `• Fast  Pass (N=5)  : Mean ${telemetry.fastWindow.mean.toFixed(2)} | σ ${telemetry.fastWindow.stdDev.toFixed(2)}  [Recent Mutation Window]`;
        const mesoLine = `• Meso  Pass (N=20) : Mean ${telemetry.mesoWindow.mean.toFixed(2)} | σ ${telemetry.mesoWindow.stdDev.toFixed(2)}  [Medium Equilibrium]`;
        const macroLine = `• Macro Pass (N=60) : Mean ${telemetry.macroWindow.mean.toFixed(2)} | σ ${telemetry.macroWindow.stdDev.toFixed(2)}  [Long-term Attractor]`;
        const shiftTag = telemetry.isRegimeShift ? 'TRUE (Shift)' : 'FALSE (Stable)';
        const statusLine = `• Regime Shift: ${shiftTag} | Z-Score: ${telemetry.studentizedZScore.toFixed(2)} | Stability Factor: ${telemetry.stabilityFactor.toFixed(2)}`;

        lines.push(`│ ${fastLine.padEnd(75)} │`);
        lines.push(`│ ${mesoLine.padEnd(75)} │`);
        lines.push(`│ ${macroLine.padEnd(75)} │`);
        lines.push(`│ ${statusLine.padEnd(75)} │`);
    }

    return lines;
}

/**
 * Builds formatted ASCII table for timeline projection.
 */
function renderTimelineTableSection(report: TimelineProjectionReport): string[] {
    const lines: string[] = [];
    lines.push(`├─────────────────────────────────────────────────────────────────────────────┤`);
    const headerTitle = `⏱️  VIRTUAL TIMELINE PROJECTION (Bucket: ${report.bucketType}, Adaptive Folded)`;
    lines.push(`│ ${headerTitle.padEnd(75)} │`);
    lines.push(`│ RELATIVE WINDOW      RUNS  SEM_ELOC    DEBT(Δ)     LATEST [RANGE]   W_MEAN    GATE │`);
    lines.push(`│ ──────────────────  ─────  ────────  ───────────  ─────────────────  ──────  ───── │`);

    if (report.buckets.length === 0) {
        lines.push(`│ No trajectory runs recorded in the requested time interval.                 │`);
    } else {
        for (const bucket of report.buckets) {
            lines.push(formatBucketRow(bucket));
        }
    }

    return lines;
}

/**
 * Builds complete unified dashboard text presentation.
 */
async function buildUnifiedDashboard(
    rootDir: string,
    ledgerDir: string,
    options: TrajectoryCommandOptions,
): Promise<string> {
    const lifetime = await readLifetimeSummary(ledgerDir);
    const timelineReport = await projectTimelineReport({
        ledgerDir,
        since: options.since,
        bucket: options.bucket,
    });

    if (options.isJson) {
        const governor = new RollingSamplingGovernor({ workspaceRoot: rootDir });
        const telemetry = governor.getDashboardTelemetry();
        if (options.isSummaryOnly) {
            return JSON.stringify({ lifetime, rolling: telemetry }, null, 2);
        }
        return JSON.stringify({ lifetime, rolling: telemetry, timeline: timelineReport }, null, 2);
    }

    const lines: string[] = [];
    lines.push(`┌─────────────────────────────────────────────────────────────────────────────┐`);
    lines.push(`│ 🚀 AUTO-REFACTOR INTEGRATED TRAJECTORY TELEMETRY                            │`);
    lines.push(`├─────────────────────────────────────────────────────────────────────────────┤`);
    lines.push(`│ Target Scope : ${rootDir.padEnd(61).slice(0, 61)} │`);

    if (lifetime) {
        const equivalentLocMillions = ((lifetime.eloc.processedTotal * LOC_TO_EQUIV_RATIO) / MILLION_DIVISOR).toFixed(2);
        const lifetimeLine = `Lifetime Totals: ${lifetime.totalRuns} runs | ${lifetime.eloc.processedTotal.toLocaleString()} ELOC (~${equivalentLocMillions}M eqLOC) | Net: +${lifetime.debt.totalResolved - lifetime.debt.totalAdded} pts`;
        const floorScore = lifetime.stability?.scoreFloor ?? lifetime.meanCompositeScore;
        const scoreLine = `Quality Baseline: Mean ${lifetime.meanCompositeScore} / 100 | Floor ${floorScore} | Pass Rate: ${lifetime.gatePassRate}%`;
        lines.push(`│ ${lifetimeLine.padEnd(75)} │`);
        lines.push(`│ ${scoreLine.padEnd(75)} │`);
    }

    const sampleSummary = `Recent Interval: ${timelineReport.totalSampledRuns} sampled runs | Semantic ELOC: ${(timelineReport.totalSemanticEloc / 1000).toFixed(1)}k | Net: ${timelineReport.netDebtCleared >= 0 ? '+' : ''}${timelineReport.netDebtCleared} pts`;
    lines.push(`│ ${sampleSummary.padEnd(75)} │`);

    lines.push(...renderRollingMomentsSection(rootDir));
    if (!options.isSummaryOnly) {
        lines.push(...renderTimelineTableSection(timelineReport));
    }

    lines.push(`└─────────────────────────────────────────────────────────────────────────────┘`);

    if (timelineReport.malformedLinesCount > 0) {
        lines.push(`[Notice: Isolated and skipped ${timelineReport.malformedLinesCount} malformed NDJSON log line(s)]`);
    }

    return lines.join('\n');
}

/**
 * Safely writes text content to an external destination file path.
 */
async function writeOutputToFile(destinationFilePath: string, content: string): Promise<string> {
    const resolvedPath = path.resolve(destinationFilePath);
    await fs.promises.mkdir(path.dirname(resolvedPath), { recursive: true });
    await fs.promises.writeFile(
        resolvedPath,
        content.endsWith('\n') ? content : content + '\n',
        'utf8',
    );
    return `[Trajectory report written to ${destinationFilePath}]\n`;
}

/**
 * Builds formatted output for individual file change trajectory.
 */
function buildFileTrajectoryText(targetFile: string): string {
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
        const shortRev = revision.revisionId.slice(0, REVISION_DISPLAY_LENGTH);
        lines.push(`  • [${dateStr}] Rev ${shortRev} by Agent: ${revision.agentUid} | Score: ${scoreText}`);
    }

    if (fileTrajectory.activeAnomalies.length > 0) {
        lines.push(`Active Anomalies:`);
        for (const anomaly of fileTrajectory.activeAnomalies) {
            lines.push(`  ⚠️ [${anomaly.kind}] ${anomaly.message}`);
        }
    }
    lines.push(`========================================\n`);
    return lines.join('\n');
}

/**
 * Dispatches the trajectory subcommand.
 *
 * @param args CLI argument tokens.
 * @returns Result object containing text presentation and exit code.
 */
export async function trajectoryCommand(args: string[]): Promise<{ text: string; code: number }> {
    const options = parseTrajectoryArgs(args);

    if (options.targetFile) {
        const fileTrajectoryText = buildFileTrajectoryText(options.targetFile);
        if (options.outputFilePath) {
            const writtenNotice = await writeOutputToFile(options.outputFilePath, fileTrajectoryText);
            return { text: writtenNotice, code: 0 };
        }
        return {
            text: fileTrajectoryText,
            code: 0,
        };
    }

    const ledgerDir = await resolveLedgerDir(options.rootDir);
    if (!ledgerDir) {
        const notice = [
            `\nNo persistent refactoring ledger found at ${options.rootDir}`,
            `To enable trajectory logging, run an audit or scan with --record-trajectory.\n`,
        ].join('\n');
        return { text: notice, code: 0 };
    }

    try {
        const dashboardText = await buildUnifiedDashboard(options.rootDir, ledgerDir, options);
        if (options.outputFilePath) {
            const writtenNotice = await writeOutputToFile(options.outputFilePath, dashboardText);
            return { text: writtenNotice, code: 0 };
        }
        return { text: dashboardText, code: 0 };
    } catch (error: unknown) {
        return {
            text: `Failed to compute trajectory dashboard: ${String(error)}\n`,
            code: 1,
        };
    }
}
