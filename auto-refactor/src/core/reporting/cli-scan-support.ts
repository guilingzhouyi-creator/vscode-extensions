/**
 * Module: Core Reporting — CLI Scan Diff, AAS Rendering & Trajectory Persistence Support
 * File Path: src/core/reporting/cli-scan-support.ts
 * Architecture Role: Cohesive asynchronous orchestration layer backing `scanAndRender` in
 *   `src/api.ts`: Git porcelain diff discovery, path-confined AAS anchor preloading, rendered
 *   report output, CLI trajectory persistence, and severity-driven CI gate exit evaluation.
 * Dependencies & Triggers: Consumes fs.promises, child_process.execFile, ../analyzer, ../reporters,
 *   ./aas-reporter, ../trajectory, and ../intelligence/elastic-debt-budget; invoked by src/api.ts.
 * Responsibilities:
 *   1. Discover modified/staged/untracked Git files with isolated GIT_CONFIG_* environment guards.
 *   2. Preload root-confined file buffers asynchronously for AAS inline code anchors.
 *   3. Persist objective CLI scan trajectories (`--record-trajectory`) into `.refactor-trajectory`.
 *   4. Write rendered output (`--out` or stdout) and compute severity-driven gate exit codes.
 * Exit Semantics & Design Rationale: Strictly asynchronous I/O (zero *Sync calls); enforces root
 *   directory prefix confinement before reading any file referenced by an Issue or FileMetric.
 */

import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import type { ScanConfig, ScanReport, WarmStats } from '../types';
import { TOOL_VERSION } from '../config/config';
import { Scanner } from '../analyzer';
import { pMap } from '../scanner/worker-scheduler';
import { render } from '../reporters';
import { toAasJson } from './aas-reporter';
import { TrajectoryAccumulator, readLifetimeSummary, recordToVector } from '../trajectory';
import { buildDebtLedger, calculateStructuralDebtDelta } from '../intelligence/elastic-debt-budget';
import { AutoRefactorError, type Logger } from '../logger';

const execFileAsync = promisify(cp.execFile);

const ENCODING_UTF8 = 'utf8';
const TOOL_NAME_AUTO_REFACTOR = 'auto-refactor';
const DEFAULT_CLI_SCAN_AGENT = 'cli-scan';
const DIR_TRAJECTORY = '.refactor-trajectory';
const FILE_BASELINE_SIGNATURES = 'baseline-signatures.json';
const FORMAT_AAS = 'aas';
/** Anchor source reads kept in flight at once, bounded to avoid descriptor exhaustion. */
const ANCHOR_READ_CONCURRENCY = 16;
/** Source reads kept in flight when a trajectory record needs every scanned file's text. */
const FILE_READ_CONCURRENCY = 16;
const SEVERITY_ERROR = 'error';
const MSG_REPORT_WRITTEN_PREFIX = 'report written to ';
const DEFAULT_ERROR_CODE_SCAN_FAILED = 'SCAN_FAILED';
const EXIT_CODE_RUNTIME_ERROR = 2;

const GIT_RENAME_ARROW_SEPARATOR = ' -> ';
const GIT_RENAME_ARROW_LENGTH = 4;
const NUL_PATH_WIN32 = 'NUL';
const NUL_PATH_POSIX = '/dev/null';
const GIT_PROMPT_DISABLED = '0';
const PLATFORM_WIN32 = 'win32';
const GIT_SUBCOMMAND_STATUS = 'status';
const GIT_FLAG_PORCELAIN = '--porcelain';

const SEVERITY_GATE_RANK = Object.freeze({
    info: 0,
    warning: 1,
    error: 2,
    disabled: 99,
});

const GIT_RENAME_STATUS_PREFIXES = new Set([
    'R',
    'RM',
    'RD',
    'RC',
    'RA',
    'R ',
    ' R',
    'MR',
    'DR',
    'CR',
    'C',
]);

function isGitRenameStatus(status: string): boolean {
    return GIT_RENAME_STATUS_PREFIXES.has(status) || status.startsWith('R');
}

function parseGitPorcelainLine(line: string): string | null {
    const trimmed = line.trim();
    if (!trimmed) return null;
    const parts = trimmed.split(/\s+/);
    const raw = parts.slice(1).join(' ').replace(/^"|"$/g, '');
    const arrowIndex = isGitRenameStatus(parts[0]) ? raw.indexOf(GIT_RENAME_ARROW_SEPARATOR) : -1;
    const target = (
        arrowIndex !== -1 ? raw.slice(arrowIndex + GIT_RENAME_ARROW_LENGTH) : raw
    ).trim();
    return target ? target.replace(/\\/g, '/') : null;
}

async function collectGitChangedFiles(root: string): Promise<string[]> {
    try {
        const nulPath = process.platform === PLATFORM_WIN32 ? NUL_PATH_WIN32 : NUL_PATH_POSIX;
        const gitEnv = {
            ...process.env,
            GIT_TERMINAL_PROMPT: GIT_PROMPT_DISABLED,
            GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL || nulPath,
            GIT_CONFIG_SYSTEM: process.env.GIT_CONFIG_SYSTEM || nulPath,
        };
        const { stdout: commandOutput } = await execFileAsync(
            'git',
            [GIT_SUBCOMMAND_STATUS, GIT_FLAG_PORCELAIN],
            {
                cwd: root,
                encoding: ENCODING_UTF8,
                env: gitEnv,
            },
        );
        const changedFiles: string[] = [];
        for (const line of (commandOutput || '').split(/\r?\n/)) {
            const parsed = parseGitPorcelainLine(line);
            if (parsed) changedFiles.push(parsed);
        }
        return changedFiles;
    } catch {
        return [];
    }
}

function createEmptyDiffReport(config: ScanConfig): ScanReport {
    return {
        tool: TOOL_NAME_AUTO_REFACTOR,
        version: TOOL_VERSION,
        generatedAt: new Date().toISOString(),
        root: config.root,
        config,
        summary: {
            filesScanned: 0,
            issuesTotal: 0,
            bySeverity: { info: 0, warning: 0, error: 0 },
            byAnalyzer: {},
            durationMs: 1,
        },
        issues: [],
        fileMetrics: [],
    };
}
/**
 * Executes an incremental Git working-tree diff scan (`--diff`) scoped to modified/untracked files.
 * Concurrency: Reentrant and read-only across working-tree status inspection and file scanning.
 *
 * @param config - Resolved scan configuration.
 * @param logger - Active logger instance.
 * @returns Scan report, null warm stats, and active Scanner (or null when tree is clean).
 */
export async function executeDiffScanMode(
    config: ScanConfig,
    logger: Logger,
): Promise<{ report: ScanReport; stats: WarmStats | null; scanner: Scanner | null }> {
    const changedFiles = await collectGitChangedFiles(config.root);
    if (changedFiles.length === 0) {
        return { report: createEmptyDiffReport(config), stats: null, scanner: null };
    }
    const include = [...new Set(changedFiles)].sort();
    const scanner = new Scanner({ ...config, include }, logger);
    const report = await scanner.scan();
    return { report, stats: null, scanner };
}
/**
 * Selects the files whose source text an anchor slice can actually quote.
 *
 * Anchor slices are reserved for blocking and T1 findings, so preloading every file that owns any
 * finding reads far more than the payload can consume.
 *
 * @param report - Finalized scan report.
 * @param includeWarningAnchors - Whether warning-level anchors were requested.
 * @returns Repository-relative paths eligible for anchor extraction.
 */
function selectAnchorCandidateFiles(report: ScanReport, includeWarningAnchors: boolean): string[] {
    const candidates = new Set<string>();
    for (const issueItem of report.issues) {
        if (issueItem.clusteredInto) continue;
        const relFile = issueItem.location?.file;
        if (!relFile) continue;
        const isBlocking = issueItem.severity === 'error';
        const isTopTier = issueItem.adjudicatedTier === 'T1';
        if (isBlocking || isTopTier || includeWarningAnchors) {
            candidates.add(relFile);
        }
    }
    return [...candidates];
}

async function tryReadUtf8Async(filePath: string): Promise<string | undefined> {
    try {
        return await fs.promises.readFile(filePath, ENCODING_UTF8);
    } catch {
        return undefined;
    }
}
/**
 * Preloads the source text of files that can actually appear in the AAS payload.
 *
 * Only files that survive emission reach an anchor slice, so reading every file that merely owns a
 * finding wasted 3.5x the bytes on a real scan (401 files read vs 81 emitted).
 *
 * @param filePaths - Repository-relative files selected for emission.
 * @param rootDir - Scan root used to confine reads.
 * @returns Map of normalized relative path to file content.
 */
async function buildAasAnchorFileMap(
    filePaths: readonly string[],
    rootDir: string,
): Promise<Map<string, string>> {
    const resolvedRoot = path.resolve(rootDir);
    const rootPrefix = resolvedRoot.endsWith(path.sep) ? resolvedRoot : resolvedRoot + path.sep;
    const uniquePaths = [...new Set(filePaths)];
    // Bounded fan-out: anchors cover most files on a T1-heavy scan, so an unbounded `Promise.all`
    // would open one handle per file and exhaust descriptors on a large repository.
    const contents = await mapWithBoundedConcurrency(
        uniquePaths,
        ANCHOR_READ_CONCURRENCY,
        async (relFile) => {
            const fullPath = path.resolve(resolvedRoot, relFile);
            if (fullPath !== resolvedRoot && !fullPath.startsWith(rootPrefix)) return undefined;
            const content = await tryReadUtf8Async(fullPath);
            return content === undefined
                ? undefined
                : { rel: relFile.replaceAll('\\', '/'), content };
        },
    );

    const fileContentMap = new Map<string, string>();
    for (const entry of contents) {
        if (entry) fileContentMap.set(entry.rel, entry.content);
    }
    return fileContentMap;
}

async function collectTrajectoryScannedFiles(
    fileMetrics: readonly NonNullable<ScanReport['fileMetrics']>[number][],
    resolvedRoot: string,
): Promise<Array<{ filePath: string; content: string }>> {
    const rootPrefix = resolvedRoot.endsWith(path.sep) ? resolvedRoot : resolvedRoot + path.sep;
    const confined = fileMetrics
        .map((metric) => metric.file)
        .filter((relFile) => {
            const fullPath = path.resolve(resolvedRoot, relFile);
            return fullPath === resolvedRoot || fullPath.startsWith(rootPrefix);
        });
    // A trajectory run reports every scanned file, so a 600-file repository issued 600 sequential
    // reads and paid one round-trip each. The reads are independent, so they run with bounded
    // fan-out rather than an unbounded `Promise.all` that would exhaust handles on a large repo.
    const contents = await mapWithBoundedConcurrency(confined, FILE_READ_CONCURRENCY, (relFile) =>
        tryReadUtf8Async(path.resolve(resolvedRoot, relFile)),
    );
    const scannedFiles: Array<{ filePath: string; content: string }> = [];
    for (let index = 0; index < confined.length; index++) {
        const content = contents[index];
        if (content !== undefined) scannedFiles.push({ filePath: confined[index], content });
    }
    return scannedFiles;
}
/**
 * Maps an array through an async transform with a fixed ceiling on in-flight operations.
 *
 * Delegates to the scheduler's `pMap` so this module shares one concurrency contract with the
 * analyzer loop instead of maintaining a second implementation of the same bounded fan-out.
 *
 * @param items - Inputs to transform.
 * @param limit - Maximum concurrent operations.
 * @param transform - Async work applied to each item.
 * @returns Results in the same order as `items`.
 */
function mapWithBoundedConcurrency<T, R>(
    items: readonly T[],
    limit: number,
    transform: (item: T) => Promise<R>,
): Promise<R[]> {
    return pMap([...items], limit, (item) => transform(item));
}

async function resolveTrajectoryDebtDelta(options: {
    readonly trajectoryDir: string;
    readonly activeIssues: ScanReport['issues'];
    readonly debtByTier: ReturnType<typeof buildDebtLedger>['debtByTier'];
    readonly logger: Logger;
}): Promise<{ resolvedDebtPoints: number; addedDebtPoints: number }> {
    const sigPath = path.join(options.trajectoryDir, FILE_BASELINE_SIGNATURES);
    const rawSig = await tryReadUtf8Async(sigPath);
    if (rawSig === undefined) {
        return { resolvedDebtPoints: 0, addedDebtPoints: 0 };
    }
    try {
        const parsedSig = JSON.parse(rawSig) as { files?: Record<string, unknown> };
        if (parsedSig && typeof parsedSig.files === 'object') {
            return calculateStructuralDebtDelta({
                prevFilesMap: parsedSig.files,
                currentIssues: options.activeIssues,
                currentDebtByTier: options.debtByTier,
            });
        }
    } catch (parseErr) {
        options.logger.debug(
            `trajectory: ignoring malformed baseline signatures (${String(parseErr)})`,
        );
    }
    return { resolvedDebtPoints: 0, addedDebtPoints: 0 };
}
/**
 * Persists a CLI scan run (`--record-trajectory`) into `.refactor-trajectory`.
 * Concurrency: Requires external synchronization per workspace trajectory directory.
 *
 * @param report - Finalized scan report.
 * @param config - Resolved scan configuration.
 * @param logger - Active logger instance.
 */
export async function persistCliScanTrajectory(
    report: ScanReport,
    config: ScanConfig,
    logger: Logger,
): Promise<void> {
    const compositeScore = report.qualityScore?.compositeScore;
    if (typeof compositeScore !== 'number' || !Number.isFinite(compositeScore)) return;
    const trajectoryDir = path.join(config.root, DIR_TRAJECTORY);
    await fs.promises.mkdir(trajectoryDir, { recursive: true });
    const lifetime = await readLifetimeSummary(trajectoryDir);
    const beforeScore = lifetime?.meanCompositeScore ?? compositeScore;
    const resolvedRoot = path.resolve(config.root);
    const scannedFiles = await collectTrajectoryScannedFiles(
        report.fileMetrics ?? [],
        resolvedRoot,
    );
    const activeIssues = report.issues.filter((issueItem) => !issueItem.clusteredInto);
    const { debtByTier } = buildDebtLedger(activeIssues);
    const { resolvedDebtPoints, addedDebtPoints } = await resolveTrajectoryDebtDelta({
        trajectoryDir,
        activeIssues,
        debtByTier,
        logger,
    });
    const scoreVector = report.qualityScore?.indices
        ? recordToVector(report.qualityScore.indices)
        : undefined;
    const accumulator = new TrajectoryAccumulator(trajectoryDir, config.root);
    await accumulator.recordAuditRun({
        runId: `scan-${Date.now()}`,
        revision: TOOL_VERSION,
        module: path.basename(resolvedRoot) || TOOL_NAME_AUTO_REFACTOR,
        agent: config.agentUid || DEFAULT_CLI_SCAN_AGENT,
        timestamp: Date.now(),
        scannedFiles,
        beforeScore,
        afterScore: compositeScore,
        scoreVector,
        resolvedDebtPoints,
        addedDebtPoints,
        regressionFindingsCount: activeIssues.filter(
            (issueItem) => issueItem.severity === SEVERITY_ERROR && !issueItem.suppression,
        ).length,
    });
    logger.info(`trajectory recorded to ${trajectoryDir}`);
}
/**
 * Renders a finalized ScanReport (preloading root-confined anchors for AAS format) to `--out` or
 * stdout.
 * Concurrency: Reentrant when distinct output paths are used.
 *
 * @param report - Finalized scan report.
 * @param config - Effective scan configuration.
 * @param logger - Active logger instance.
 */
export async function writeRenderedReport(
    report: ScanReport,
    config: ScanConfig,
    logger: Logger,
): Promise<void> {
    let text: string;
    if (config.format === FORMAT_AAS) {
        const anchorCandidates = selectAnchorCandidateFiles(report, false);
        const anchorFileMap = await buildAasAnchorFileMap(anchorCandidates, config.root);
        text = toAasJson(report, {
            baseDir: config.root,
            includeDimensionDetails: true,
            pretty: config.pretty === true,
            fileReader: (relativeFilePath) =>
                anchorFileMap.get(relativeFilePath.replaceAll('\\', '/')),
        });
    } else {
        text = render(report, config.format);
    }
    if (config.out) {
        await fs.promises.writeFile(config.out, text + '\n', ENCODING_UTF8);
        logger.info(`${MSG_REPORT_WRITTEN_PREFIX}${config.out}`);
    } else {
        process.stdout.write(text + '\n');
    }
}

function resolveGateThreshold(config: ScanConfig): number | null {
    if (config.failOnSeverity) return SEVERITY_GATE_RANK[config.failOnSeverity];
    if (config.failOnIssue) return SEVERITY_GATE_RANK.error;
    return null;
}
/**
 * Decides the CI exit code from the configured severity threshold, honoring suppressions and
 * baseline ratchets.
 *
 * @param report - Completed scan report.
 * @param config - Effective scan configuration carrying fail-on settings.
 * @returns 0 when nothing blocks, 1 when an unsuppressed blocking finding exists.
 */
export function evaluateGateExitCode(report: ScanReport, config: ScanConfig): number {
    const threshold = resolveGateThreshold(config);
    if (threshold === null) return 0;
    const ratchetUsed = report.summary.ratchetBaselineUsed === true;
    for (const issue of report.issues) {
        if (issue.suppression || (ratchetUsed && issue.isNew !== true)) continue;
        if (SEVERITY_GATE_RANK[issue.severity] >= threshold) return 1;
    }
    return 0;
}
/**
 * Emits warm scan cache/daemon statistics to the active logger when present.
 *
 * @param logger - Active logger instance.
 * @param stats - Optional warm stats payload.
 */
export function logWarmStats(logger: Logger, stats?: WarmStats | null): void {
    if (!stats) return;
    logger.info(
        `warm: daemonUsed=${stats.daemonUsed} cacheHit=${stats.cacheHit}/${stats.cacheTotal} ` +
            `l1=${stats.l1Hit} l2=${stats.l2Hit} analyzed=${stats.analyzed} ` +
            `poolWarm=${stats.poolWarm} daemonMs=${stats.daemonMs}`,
    );
}
/**
 * Maps uncaught scan exceptions to formatted stderr output and exit code 2.
 *
 * @param error - Thrown error value.
 * @returns Runtime error exit code 2.
 */
export function handleScanError(error: unknown): number {
    const msg = error instanceof Error ? error.message : String(error);
    const code = error instanceof AutoRefactorError ? error.code : DEFAULT_ERROR_CODE_SCAN_FAILED;
    process.stderr.write(`[auto-refactor] ERROR (${code}): ${msg}\n`);
    return EXIT_CODE_RUNTIME_ERROR;
}
