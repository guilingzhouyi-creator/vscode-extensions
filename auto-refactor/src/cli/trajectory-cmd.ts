/**
 * Module: CLI — Trajectory & Multi-Scale Telemetry Controller
 * File Path: src/cli/trajectory-cmd.ts
 * Architecture Role: Dispatches and coordinates trajectory queries, unified lifetime summaries,
 *   rolling statistical moments, and multi-scale virtual timeline projections.
 * Dependencies & Triggers: Consumes timeline-projector, compact-ledger-store,
 *   rolling-sampling-governor, and trajectory-formatter; called by CLI main entry point.
 * Responsibilities: Parse trajectory CLI arguments, resolve repository root, coordinate
 *   integrated dashboards or JSON streams, and handle file-specific change trajectories.
 * Exit Semantics & Design Rationale: Decouples command presentation from main index.ts facade,
 *   guarantees zero-throw defensive execution, returns explicit { text, code } result bundles.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
    projectTimelineReport,
    type TimelineBucketType,
} from '../core/trajectory/timeline-projector';
import { readLifetimeSummary } from '../core/trajectory/compact-ledger-store';
import { RollingSamplingGovernor } from '../core/scoring/rolling-sampling-governor';
import {
    renderSparkline,
    renderRollingMomentsSection,
    renderTimelineTableSection,
    buildFileTrajectoryText,
    TRAJECTORY_BORDERS,
    TRAJECTORY_FORMAT_METRICS,
} from './trajectory-formatter';

export { renderSparkline };

/** Trajectory folder name inside repository root. */
const TRAJECTORY_DIR_NAME = '.refactor-trajectory';

/** Subproject folder fallback name. */
const PROJECT_SUBDIR_NAME = 'auto-refactor';

const CMD_TRAJECTORY_SUBCOMMAND = 'trajectory';
const BUCKET_TYPE_HOUR = 'hour';
const BUCKET_TYPE_DAY = 'day';
const DEFAULT_HOURLY_WINDOW = '24h';
const DEFAULT_DAILY_WINDOW = '14d';

/**
 * Options extracted from CLI tokens for trajectory display.
 */
interface TrajectoryCommandOptions {
    rootDir: string;
    targetFile?: string;
    isSummaryOnly?: boolean;
    isJson?: boolean;
    since?: string;
    bucket?: TimelineBucketType;
    outputFilePath?: string;
    withSparkline?: boolean;
}

/**
 * Checks if a target path exists asynchronously.
 */
async function checkPathExists(targetPath: string): Promise<boolean> {
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
    if (await checkPathExists(directPath)) {
        return directPath;
    }
    const subprojectPath = path.join(rootDir, PROJECT_SUBDIR_NAME, TRAJECTORY_DIR_NAME);
    if (await checkPathExists(subprojectPath)) {
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
        if (token.startsWith('-') || token === CMD_TRAJECTORY_SUBCOMMAND) continue;
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
    const withSparkline = args.includes('--sparkline') || args.includes('--spark');
    const isHourly = args.includes('--hourly');
    const isDaily = args.includes('--daily');

    let bucket = parseBucketType(findOptionValue(args, '--bucket'));
    let since = findOptionValue(args, '--since');

    if (isHourly && !bucket) {
        bucket = BUCKET_TYPE_HOUR;
        if (!since) since = DEFAULT_HOURLY_WINDOW;
    } else if (isDaily && !bucket) {
        bucket = BUCKET_TYPE_DAY;
        if (!since) since = DEFAULT_DAILY_WINDOW;
    }

    const outputFilePath = findOptionValue(args, '--out');
    const targetFile = findTargetFile(args);

    return {
        rootDir,
        targetFile,
        isSummaryOnly,
        isJson,
        since,
        bucket,
        outputFilePath,
        withSparkline,
    };
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
        const activeScores = timelineReport.buckets
            .filter((b) => !b.isIdleFold && b.runsCount > 0)
            .map((b) => b.weightedMeanScore);
        const sparkline = renderSparkline(activeScores);
        if (options.isSummaryOnly) {
            return JSON.stringify({ lifetime, rolling: telemetry }, null, 2);
        }
        return JSON.stringify(
            { lifetime, rolling: telemetry, timeline: { ...timelineReport, sparkline } },
            null,
            2,
        );
    }

    const {
        LOC_TO_EQUIV_RATIO,
        MILLION_DIVISOR,
        LINE_CONTENT_WIDTH,
        NUM_THOUSAND,
        TARGET_SCOPE_WIDTH,
    } = TRAJECTORY_FORMAT_METRICS;

    const lines: string[] = [];
    lines.push(TRAJECTORY_BORDERS.TOP);
    lines.push(`│ 🚀 AUTO-REFACTOR INTEGRATED TRAJECTORY TELEMETRY                            │`);
    lines.push(TRAJECTORY_BORDERS.MIDDLE);
    lines.push(
        `│ Target Scope : ${rootDir.padEnd(TARGET_SCOPE_WIDTH).slice(0, TARGET_SCOPE_WIDTH)} │`,
    );

    if (lifetime) {
        const equivalentLocMillions = (
            (lifetime.eloc.processedTotal * LOC_TO_EQUIV_RATIO) /
            MILLION_DIVISOR
        ).toFixed(2);
        const lifetimeLine = `Lifetime Totals: ${lifetime.totalRuns} runs | ${lifetime.eloc.processedTotal.toLocaleString()} ELOC (~${equivalentLocMillions}M eqLOC) | Net: +${lifetime.debt.totalResolved - lifetime.debt.totalAdded} pts`;
        const floorScore = lifetime.stability?.scoreFloor ?? lifetime.meanCompositeScore;
        const scoreLine = `Quality Baseline: Mean ${lifetime.meanCompositeScore} / 100 | Floor ${floorScore} | Pass Rate: ${lifetime.gatePassRate}%`;
        lines.push(`│ ${lifetimeLine.padEnd(LINE_CONTENT_WIDTH)} │`);
        lines.push(`│ ${scoreLine.padEnd(LINE_CONTENT_WIDTH)} │`);
    }

    const sampleSummary = `Recent Interval: ${timelineReport.totalSampledRuns} sampled runs | Semantic ELOC: ${(timelineReport.totalSemanticEloc / NUM_THOUSAND).toFixed(1)}k | Net: ${timelineReport.netDebtCleared >= 0 ? '+' : ''}${timelineReport.netDebtCleared} pts`;
    lines.push(`│ ${sampleSummary.padEnd(LINE_CONTENT_WIDTH)} │`);

    lines.push(...renderRollingMomentsSection(rootDir));
    if (!options.isSummaryOnly) {
        lines.push(...renderTimelineTableSection(timelineReport, options.withSparkline));
    }

    lines.push(TRAJECTORY_BORDERS.BOTTOM);

    if (timelineReport.malformedLinesCount > 0) {
        lines.push(
            `[Notice: Isolated and skipped ${timelineReport.malformedLinesCount} malformed NDJSON log line(s)]`,
        );
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
 * Dispatches the trajectory subcommand.
 *
 * @param args CLI argument tokens.
 * @returns Result object containing text presentation and exit code.
 * ASYNC-CONCURRENCY: stateless over the ledger; concurrent runs meet only on the caller-chosen
 * output file.
 */
export async function executeTrajectoryCommand(
    args: string[],
): Promise<{ text: string; code: number }> {
    const options = parseTrajectoryArgs(args);

    if (options.targetFile) {
        const fileTrajectoryText = buildFileTrajectoryText(options.targetFile);
        if (options.outputFilePath) {
            const writtenNotice = await writeOutputToFile(
                options.outputFilePath,
                fileTrajectoryText,
            );
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

export { executeTrajectoryCommand as trajectoryCommand };
