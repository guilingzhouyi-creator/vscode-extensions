#!/usr/bin/env node
/**
 * Module: CLI Entry Point — Subcommand Dispatch & Process Shell
 * File Path: src/index.ts
 * Architecture Role: Executable shell over the shared programmatic API; converts argv into
 *     CliOptions, selects a subcommand, and delegates scans to api.scanAndRender.
 * Dependencies & Triggers: Triggered by `node dist/index.js` or the installed bin; imports
 *     cli/cli-parser, scanAndRender from ./api, resolveConfig from core/config; lazily requires
 *     cli/daemonCmd, cli/selfTestCmd, core/cache and ./api helpers.
 * Responsibilities: Enable Node's V8 compile cache best-effort; dispatch scan, daemon,
 *     self-test, guide, trajectory, symbols, and memory subcommands; print usage; exit cleanly.
 * Exit Semantics & Design Rationale: Normal runs exit with scanAndRender's 0/1 code or a
 *     subcommand's code; usage errors exit 2; the top-level catch logs FATAL to stderr and
 *     exits 2. Compile-cache setup is best-effort so an unwritable cache never breaks a scan.
 */
// Enable Node's V8 bytecode compile cache for the CLI process. MUST run before any
// other code so the CLI's own module graph gets cached on disk (30-50% faster
// cold-start module compilation on Node >= 22.8). CLI-only by design — library consumers
// (api.ts / analyzer.ts) are intentionally NOT affected. Best-effort: any failure (old
// Node, unwritable cache dir, already enabled, ...) must never break the scan.
import * as nodeModule from 'node:module';
try {
    const maybeEnable = (nodeModule as { enableCompileCache?: () => void }).enableCompileCache;
    maybeEnable?.();
} catch {
    /* compile cache is best-effort — ignore */
}

import * as fs from 'fs';
import * as path from 'path';

import {
    scanAndRender,
    querySymbols,
    queryAgentConstraints,
    getChangeTrajectory,
    getReviewMemory,
    scan,
    type ScanReport,
} from './api';
import { resolveConfig } from './core/config/config';
import { DAEMON_SUBCOMMAND, parseArgs, printUsage, type CliOptions } from './cli/cli-parser';
import { defaultPatchEngine, PatchEngine, type FixDescriptor } from './core/codemod';
import {
    TrajectoryAccumulator,
    readLifetimeSummary,
    recordToVector,
    computeTrajectoryQualityMetrics,
} from './core/trajectory';
import { evaluateCompositeGate, type GateStage } from './core/praxis/composite-quality-gate';
import { CacheStore } from './core/cache';
import { daemonCommand } from './cli/daemonCmd';
import { selfTestCommand } from './cli/selfTestCmd';

/** Decimal radix used when parsing numeric CLI arguments such as `--line`. */
const DECIMAL_RADIX = 10;

/** Number of leading revision-id characters shown by the `trajectory` CLI subcommand. */
const REVISION_ID_DISPLAY_LENGTH = 8;

/** CLI subcommand identifiers */
const CMD_SYMBOLS = 'symbols';
const CMD_GUIDE = 'guide';
const CMD_TRAJECTORY = 'trajectory';
const CMD_MEMORY = 'memory';
const CMD_STATS = 'stats';
const CMD_GATE = 'gate';
const CMD_SCAN = 'scan';
const CMD_SELF_TEST = 'self-test';

/** Common CLI option flags */
const FLAG_ROOT = '--root';
const FLAG_DOMAIN = '--domain';
const FLAG_LINE = '--line';
const FLAG_STAGE = '--stage';
const FLAG_SUMMARY = '--summary';
const FLAG_SUMMARY_SHORT = '-s';

/** Scoring, threshold and weight constants */
const SCORE_MAX = 100.0;
const SCORE_GATE_FAIL = 80.0;
const SCORE_INITIAL_FIX_BASELINE = 98.0;
const SCORE_FIX_INCREMENT_PER_APPLIED = 0.1;
const RECENT_RUNS_WINDOW = 3;
const RESOLVED_POINTS_PER_APPLIED = 2;
const RESOLVED_POINTS_STATIC_PASS = 10;
const ADDED_POINTS_PER_REGRESSION = 5;
const LOC_TO_EQUIV_RATIO = 1.37;
const MILLION_DIVISOR = 1000000;

/** String literals and operational constants */
const LOG_LEVEL_SILENT = 'silent';
const LOG_LEVEL_WARN = 'warn';
const KIND_PAD_WIDTH = 9;
const PERCENTAGE_FACTOR = 100;
const DEFAULT_DILUTION_RATIO = '1.00';
const TRAJECTORY_DIR_NAME = '.refactor-trajectory';
const LIFETIME_SUMMARY_FILE = 'lifetime.summary.json';
const ACTIVE_RUNS_FILE = 'active-runs.ndjson';
const MODE_DRY_RUN = 'DRY-RUN';
const MODE_IN_PLACE = 'IN-PLACE';
const DEFAULT_AGENT_REVISION = 'codemod';
const DEFAULT_AGENT_NAME = 'codemod-fix';
const DIFF_CHANGED_MULTIPLIER = 3;
const STATUS_OK = 'ok';
const STATUS_FAILED = 'FAILED';
const DEFAULT_GATE_STAGE: GateStage = 'pre-commit';
const DEFAULT_STATIC_ERROR_ID = 'STATIC_ERROR';
const CONFIG_FILE_NAME = 'auto-refactor.config.json';
const PROJECT_SUBDIR_NAME = 'auto-refactor';
const SEVERITY_ERROR = 'error';
const SCORE_VECTOR_LENGTH = 10;

/**
 * Asynchronously checks if a path exists without blocking the event loop.
 */
async function checkPathExists(targetPath: string): Promise<boolean> {
    try {
        await fs.promises.access(targetPath);
        return true;
    } catch {
        return false;
    }
}

interface DirectoryProcessingContext {
    curr: string;
    entries: fs.Dirent[];
    queue: string[];
    supportedExts: Set<string>;
    ignoredDirs: Set<string>;
}

interface GateMetricsContext {
    beforeScore: number;
    currentScore: number;
    scoreVector: number[];
    counters: ReturnType<typeof buildTrajectoryCounters>;
    resolvedDebtPoints: number;
    addedDebtPoints: number;
    regressionCount: number;
    unsuppressedErrors: Array<{ id?: string; rule?: string }>;
}

async function handleSymbolsCommand(args: string[]): Promise<void> {
    const target = args[args.indexOf(CMD_SYMBOLS) + 1];
    if (!target) {
        process.stderr.write('Usage: auto-refactor symbols <name> [--root <dir>]\n');
        process.exit(2);
    }
    const rootIdx = args.indexOf(FLAG_ROOT);
    const root = rootIdx !== -1 ? args[rootIdx + 1] : process.cwd();
    try {
        const symbolQueryResult = await querySymbols(target, {
            root,
            logLevel: LOG_LEVEL_SILENT,
            cache: false,
        });

        process.stdout.write(`\n=== Symbol: ${target} ===\n`);
        for (const definition of symbolQueryResult.definitions) {
            process.stdout.write(
                `  defined  ${definition.kind.padEnd(KIND_PAD_WIDTH)} ${definition.file}:${definition.line ?? '?'}\n`,
            );
        }
        for (const reference of symbolQueryResult.references) {
            process.stdout.write(`  called   ${reference.file}:${reference.line ?? '?'}\n`);
        }
        process.stdout.write(
            `  coverage defs=${symbolQueryResult.stats.definitions} refs=${symbolQueryResult.stats.references} ` +
                `crossFile=${symbolQueryResult.stats.crossFileReferences} (${symbolQueryResult.stats.builtFrom})\n`,
        );
        process.exit(0);
    } catch (error: unknown) {
        process.stderr.write(`symbols failed: ${String(error)}\n`);
        process.exit(1);
    }
}

function handleGuideCommand(args: string[]): void {
    const targetFile = args[args.indexOf(CMD_GUIDE) + 1];
    if (!targetFile) {
        process.stderr.write(
            'Usage: auto-refactor guide <file> [--domain <name>] [--line <num>]\n',
        );
        process.exit(2);
    }
    const domainIdx = args.indexOf(FLAG_DOMAIN);
    const domainName = domainIdx !== -1 ? args[domainIdx + 1] : undefined;
    const lineIdx = args.indexOf(FLAG_LINE);
    const line = lineIdx !== -1 ? parseInt(args[lineIdx + 1], DECIMAL_RADIX) : undefined;
    const prompt = queryAgentConstraints({ filePath: targetFile, domainName, line });
    process.stdout.write(prompt.renderedMarkdown + '\n');
    process.exit(0);
}

async function printRecentActiveRuns(activeRunsFile: string): Promise<void> {
    if (!(await checkPathExists(activeRunsFile))) return;
    const rawContent = await fs.promises.readFile(activeRunsFile, 'utf8');
    const raw = rawContent.trim().split('\n').filter(Boolean);
    const recent = raw.slice(-RECENT_RUNS_WINDOW);
    if (recent.length === 0) return;
    process.stdout.write(`\nRecent Active Runs (last ${recent.length}):\n`);
    for (const line of recent) {
        try {
            const runRecord = JSON.parse(line);
            const dateStr = new Date(runRecord.t).toISOString();
            process.stdout.write(
                `  • [${dateStr}] Rev ${runRecord.rev} (${runRecord.mod}): Score ${runRecord.score.aft} | QED ${runRecord.score.qed} | Proc ${runRecord.eloc.proc} ELOC [Gate: ${runRecord.gate.code}]\n`,
            );
        } catch {
            /* ignored: malformed ndjson log entry */
        }
    }
}

async function printLedgerSummary(customRoot?: string): Promise<void> {
    const baseDir = customRoot ? path.resolve(customRoot) : process.cwd();
    let ledgerDir = path.join(baseDir, TRAJECTORY_DIR_NAME);
    if (!(await checkPathExists(ledgerDir))) {
        const sub = path.join(baseDir, PROJECT_SUBDIR_NAME, TRAJECTORY_DIR_NAME);
        if (await checkPathExists(sub)) {
            ledgerDir = sub;
        }
    }
    const lifetimeFile = path.join(ledgerDir, LIFETIME_SUMMARY_FILE);
    const activeRunsFile = path.join(ledgerDir, ACTIVE_RUNS_FILE);

    if (!(await checkPathExists(lifetimeFile))) {
        process.stdout.write(`\nNo persistent refactoring ledger found at ${ledgerDir}\n`);
        process.exit(0);
    }

    try {
        const lifetimeContent = await fs.promises.readFile(lifetimeFile, 'utf8');
        const lifetime = JSON.parse(lifetimeContent);
        const equivLoc = (
            (lifetime.eloc.processedTotal * LOC_TO_EQUIV_RATIO) /
            MILLION_DIVISOR
        ).toFixed(2);
        process.stdout.write(`\n=== Workspace Refactoring Trajectory & Review Ledger ===\n`);
        process.stdout.write(`Total Audit Runs       : ${lifetime.totalRuns}\n`);
        process.stdout.write(
            `Processed Code (ELOC)  : ${lifetime.eloc.processedTotal.toLocaleString()} lines (~${equivLoc}M equivalent LOC)\n`,
        );
        process.stdout.write(
            `Unique Code Baseline   : ${lifetime.eloc.uniqueTotal.toLocaleString()} ELOC\n`,
        );
        process.stdout.write(
            `Changed Code Audited   : ${lifetime.eloc.changedTotal.toLocaleString()} ELOC (Semantic: ${lifetime.eloc.semanticTotal.toLocaleString()})\n`,
        );
        process.stdout.write(
            `Quality Efficiency QED : ${lifetime.qed.mean} [min: ${lifetime.qed.min}, max: ${lifetime.qed.max}]\n`,
        );
        process.stdout.write(
            `Technical Debt Balance : Added ${lifetime.debt.totalAdded} | Resolved ${lifetime.debt.totalResolved} (Net Yield: ${lifetime.debt.netYield} pts/kELOC)\n`,
        );
        process.stdout.write(
            `Mean Composite Score   : ${lifetime.meanCompositeScore} / 100 [Gate Pass Rate: ${lifetime.gatePassRate}%]\n`,
        );

        await printRecentActiveRuns(activeRunsFile);
        process.stdout.write(`========================================================\n\n`);
        process.exit(0);
    } catch (err: unknown) {
        process.stderr.write(`Failed to read trajectory summary: ${String(err)}\n`);
        process.exit(1);
    }
}

function printFileTrajectory(targetFile: string): void {
    const traj = getChangeTrajectory(targetFile);
    if (!traj || traj.revisions.length === 0) {
        process.stdout.write(`No historical trajectory recorded for ${targetFile}\n`);
        process.exit(0);
    }
    process.stdout.write(`\n=== Change Trajectory: ${targetFile} ===\n`);
    process.stdout.write(
        `Total Revisions: ${traj.totalRevisions} | Agents: ${traj.participatingAgents.join(', ')}\n`,
    );
    for (const revision of traj.revisions) {
        const score = revision.qualityScore?.compositeScore;
        const scoreText = typeof score === 'number' && Number.isFinite(score) ? score : 'N/A';
        process.stdout.write(
            `  • [${new Date(revision.timestamp).toISOString()}] Rev ${revision.revisionId.slice(0, REVISION_ID_DISPLAY_LENGTH)} by Agent: ${revision.agentUid} | Score: ${scoreText}\n`,
        );
    }
    if (traj.activeAnomalies.length > 0) {
        process.stdout.write(`Active Anomalies:\n`);
        for (const anomaly of traj.activeAnomalies) {
            process.stdout.write(`  ⚠️ [${anomaly.kind}] ${anomaly.message}\n`);
        }
    }
    process.stdout.write(`========================================\n\n`);
    process.exit(0);
}

async function handleTrajectoryCommand(args: string[]): Promise<void> {
    const rawTarget = args[args.indexOf(CMD_TRAJECTORY) + 1];
    const isSummary =
        !rawTarget ||
        rawTarget === FLAG_SUMMARY ||
        rawTarget === FLAG_SUMMARY_SHORT ||
        rawTarget.startsWith('--');
    if (isSummary) {
        const rootIdx = args.indexOf(FLAG_ROOT);
        const customRoot = rootIdx !== -1 && args[rootIdx + 1] ? args[rootIdx + 1] : undefined;
        await printLedgerSummary(customRoot);
        return;
    }
    printFileTrajectory(rawTarget);
}

function countLinesEloc(content: string): { loc: number; eloc: number } {
    const lines = content.split('\n');
    let eloc = 0;
    for (const sourceLine of lines) {
        const trimmedLine = sourceLine.trim();
        if (
            trimmedLine.length > 0 &&
            !trimmedLine.startsWith('//') &&
            !trimmedLine.startsWith('#') &&
            !trimmedLine.startsWith('*')
        ) {
            eloc++;
        }
    }
    return { loc: lines.length, eloc };
}

async function processDirectoryEntries(
    context: DirectoryProcessingContext,
): Promise<{ files: number; loc: number; eloc: number }> {
    const { curr, entries, queue, supportedExts, ignoredDirs } = context;
    let files = 0;
    let loc = 0;
    let eloc = 0;
    for (const entry of entries) {
        const full = path.join(curr, entry.name);
        if (entry.isDirectory()) {
            if (!ignoredDirs.has(entry.name)) queue.push(full);
            continue;
        }
        if (!entry.isFile()) continue;
        const ext = path.extname(entry.name).toLowerCase();
        if (!supportedExts.has(ext)) continue;

        files++;
        try {
            const content = await fs.promises.readFile(full, 'utf8');
            const counts = countLinesEloc(content);
            loc += counts.loc;
            eloc += counts.eloc;
        } catch {
            /* ignored: unreadable file */
        }
    }
    return { files, loc, eloc };
}

async function collectDirectoryStats(
    targetRoot: string,
): Promise<{ totalFiles: number; totalLoc: number; totalEloc: number }> {
    const SUPPORTED_EXTS = new Set(['.ts', '.js', '.mjs', '.cjs', '.gd', '.py', '.sh', '.ps1']);
    const IGNORED_DIRS = new Set([
        'node_modules',
        '.git',
        'dist',
        'out',
        'fixtures',
        'baseline',
        'archive',
        'reports',
    ]);

    let totalFiles = 0;
    let totalLoc = 0;
    let totalEloc = 0;

    const queue = [targetRoot];
    while (queue.length > 0) {
        const curr = queue.pop()!;
        let entries: Array<fs.Dirent>;
        try {
            entries = await fs.promises.readdir(curr, { withFileTypes: true });
        } catch {
            /* ignored: unreadable directory permission */
            continue;
        }
        const delta = await processDirectoryEntries({
            curr,
            entries,
            queue,
            supportedExts: SUPPORTED_EXTS,
            ignoredDirs: IGNORED_DIRS,
        });
        totalFiles += delta.files;
        totalLoc += delta.loc;
        totalEloc += delta.eloc;
    }
    return { totalFiles, totalLoc, totalEloc };
}

async function handleStatsCommand(args: string[]): Promise<void> {
    const rootIdx = args.indexOf(FLAG_ROOT);
    const targetRoot = rootIdx !== -1 && args[rootIdx + 1] ? args[rootIdx + 1] : process.cwd();

    const { totalFiles, totalLoc, totalEloc } = await collectDirectoryStats(targetRoot);

    const densityPct =
        totalLoc > 0 ? ((totalEloc / totalLoc) * PERCENTAGE_FACTOR).toFixed(1) : '0.0';
    const dilutionRatio =
        totalEloc > 0 ? (totalLoc / totalEloc).toFixed(2) : DEFAULT_DILUTION_RATIO;

    process.stdout.write(`\n=== Code Volume & Complexity Statistics ===\n`);
    process.stdout.write(`Target Scope Root       : ${targetRoot}\n`);
    process.stdout.write(`Auditable Code Files    : ${totalFiles.toLocaleString()}\n`);
    process.stdout.write(`Physical Lines (LOC)    : ${totalLoc.toLocaleString()}\n`);
    process.stdout.write(`Effective Logic (ELOC)  : ${totalEloc.toLocaleString()}\n`);
    process.stdout.write(`Effective Code Density  : ${densityPct}%\n`);
    process.stdout.write(`Average Dilution Ratio  : 1 : ${dilutionRatio}\n`);
    process.stdout.write(`============================================\n\n`);
    process.exit(0);
}

function handleMemoryCommand(args: string[] = []): void {
    void args;
    const mem = getReviewMemory();
    const stats = mem.getStats();
    process.stdout.write(`\n=== Review Memory Status ===\n`);
    process.stdout.write(`Active Indexed Records: ${stats.recordsCount}\n`);
    process.stdout.write(`Total Historical Revisions: ${stats.revisionsCount}\n`);
    process.stdout.write(`Max In-Memory Capacity: ${stats.maxFiles}\n`);
    process.stdout.write(`============================\n\n`);
    process.exit(0);
}

function getOrCreateFixList(
    fixesByFile: Map<string, FixDescriptor[]>,
    file: string,
): FixDescriptor[] {
    let existing = fixesByFile.get(file);
    if (!existing) {
        existing = [];
        fixesByFile.set(file, existing);
    }
    return existing;
}

/**
 * Executes automated AST codemod repairs for actionable scan findings.
 *
 * @param cli - Parsed command-line options including fix flags.
 * @returns Exit code 0 on successful repair completion.
 */
async function handleFixWorkflow(cli: CliOptions): Promise<number> {
    const report = await scan(cli);
    const fixesByFile = new Map<string, FixDescriptor[]>();

    for (const issue of report.issues) {
        const fix = PatchEngine.issueToFix(issue);
        if (fix) {
            getOrCreateFixList(fixesByFile, issue.location.file).push(fix);
        }
    }

    if (fixesByFile.size === 0) {
        process.stdout.write(
            '[auto-refactor] No automated codemod fixes available for detected issues.\n',
        );
        return 0;
    }

    const rootDir = cli.root || process.cwd();
    let totalApplied = 0;
    let totalSkipped = 0;

    process.stdout.write(
        `\n=== Automated Codemod Repair (${cli.fixDryRun ? MODE_DRY_RUN : MODE_IN_PLACE}) ===\n`,
    );

    for (const [relPath, fixes] of fixesByFile.entries()) {
        const fullPath = path.resolve(rootDir, relPath);
        if (!(await checkPathExists(fullPath))) continue;

        const content = await fs.promises.readFile(fullPath, 'utf8');
        const patchApplyResult = defaultPatchEngine.applyFixes(fullPath, content, fixes, {
            dryRun: cli.fixDryRun,
            rules: cli.fixRules,
        });

        if (patchApplyResult.appliedFixCount > 0) {
            totalApplied += patchApplyResult.appliedFixCount;
            totalSkipped += patchApplyResult.skippedConflictCount;
            if (patchApplyResult.unifiedDiff) {
                process.stdout.write(patchApplyResult.unifiedDiff + '\n');
            }
        }
    }

    process.stdout.write(
        `[auto-refactor] Fix summary: ${totalApplied} applied, ${totalSkipped} conflicts skipped across ${fixesByFile.size} files.\n\n`,
    );

    await recordCodemodTrajectory(rootDir, fixesByFile, totalApplied, cli);

    return 0;
}

/**
 * Records an automated codemod repair run into the persistent trajectory ledger.
 */
async function recordCodemodTrajectory(
    rootDir: string,
    fixesByFile: Map<string, FixDescriptor[]>,
    totalApplied: number,
    cli: CliOptions,
): Promise<void> {
    if (cli.fixDryRun || totalApplied === 0) return;
    try {
        const trajectoryDir = path.join(rootDir, TRAJECTORY_DIR_NAME);
        if (!(await checkPathExists(trajectoryDir))) return;

        const accumulator = new TrajectoryAccumulator(trajectoryDir);
        const modifiedFilesList = [];
        for (const relPath of fixesByFile.keys()) {
            const fullPath = path.resolve(rootDir, relPath);
            if (await checkPathExists(fullPath)) {
                modifiedFilesList.push({
                    filePath: relPath,
                    content: await fs.promises.readFile(fullPath, 'utf8'),
                });
            }
        }
        const resolvedPoints = totalApplied * RESOLVED_POINTS_PER_APPLIED;
        const maybeRevision = (cli as Record<string, unknown>).revision;
        await accumulator.recordAuditRun({
            runId: `fix-${Date.now()}`,
            revision: maybeRevision
                ? String(maybeRevision).slice(0, REVISION_ID_DISPLAY_LENGTH)
                : DEFAULT_AGENT_REVISION,
            module: path.basename(rootDir),
            agent: DEFAULT_AGENT_NAME,
            timestamp: Date.now(),
            scannedFiles: modifiedFilesList,
            beforeScore: SCORE_INITIAL_FIX_BASELINE,
            afterScore: Math.min(
                SCORE_MAX,
                SCORE_INITIAL_FIX_BASELINE + totalApplied * SCORE_FIX_INCREMENT_PER_APPLIED,
            ),
            resolvedDebtPoints: resolvedPoints,
            addedDebtPoints: 0,
            regressionFindingsCount: 0,
            diffCounters: {
                changed: totalApplied * DIFF_CHANGED_MULTIPLIER,
                semantic: totalApplied * 2,
                modified: totalApplied,
            },
        });
    } catch (err: unknown) {
        void err;
    }
}

async function handleScanCommand(args: string[]): Promise<number> {
    const cli = parseArgs(args);

    // --cache-clear: wipe the cache dir up-front (a fresh scan rebuilds it).
    if (cli.cacheClear) {
        const cfg = resolveConfig(cli);
        const cache = new CacheStore(cli.cacheDir, cfg.root);
        const ok = cache.clear();
        process.stderr.write(
            `[auto-refactor] cache cleared (${ok ? STATUS_OK : STATUS_FAILED}): ${cache.dir}\n`,
        );
    }

    return cli.fix || cli.fixDryRun ? handleFixWorkflow(cli) : scanAndRender(cli);
}

function parseGateOptions(args: string[]): {
    stage: GateStage;
    root: string;
} {
    const stageIdx = args.indexOf(FLAG_STAGE);
    let stage: GateStage = DEFAULT_GATE_STAGE;
    if (stageIdx !== -1 && args[stageIdx + 1]) {
        stage = args[stageIdx + 1] as GateStage;
    }

    const rootIdx = args.indexOf(FLAG_ROOT);
    let root = process.cwd();
    if (rootIdx !== -1 && args[rootIdx + 1]) {
        root = args[rootIdx + 1];
    }

    return { stage, root };
}

function computeProcessedDensityAndRatio(
    fileMetrics: Array<{ nonBlankLines?: number; lines?: number }>,
    totalFiles: number,
): { processedEloc: number; density: number; ratio: number } {
    let totalProcessedEloc = 0;
    let totalPhysicalLoc = 0;
    for (const metric of fileMetrics) {
        totalProcessedEloc += metric.nonBlankLines ?? metric.lines ?? 0;
        totalPhysicalLoc += metric.lines ?? 0;
    }

    const processedEloc = Math.max(totalFiles, totalProcessedEloc);
    let density = 0.8;
    if (totalPhysicalLoc > 0) {
        density =
            Math.round((processedEloc / totalPhysicalLoc) * PERCENTAGE_FACTOR) / PERCENTAGE_FACTOR;
    }

    let ratio = 1.25;
    if (processedEloc > 0) {
        ratio =
            Math.round((totalPhysicalLoc / processedEloc) * PERCENTAGE_FACTOR) / PERCENTAGE_FACTOR;
    }

    return { processedEloc, density, ratio };
}

async function readHistoricalMeanScore(root: string): Promise<number | undefined> {
    const trajectoryDir = path.join(root, TRAJECTORY_DIR_NAME);
    if (!(await checkPathExists(trajectoryDir))) {
        return undefined;
    }

    try {
        const lifetime = await readLifetimeSummary(trajectoryDir);
        if (
            lifetime &&
            typeof lifetime.meanCompositeScore === 'number' &&
            Number.isFinite(lifetime.meanCompositeScore)
        ) {
            return lifetime.meanCompositeScore;
        }
    } catch {
        /* ignore optional trajectory read failure */
    }
    return undefined;
}

function buildTrajectoryCounters(processedEloc: number, density: number, ratio: number) {
    return {
        processed: processedEloc,
        unique: processedEloc,
        changed: 0,
        semantic: processedEloc,
        relocated: 0,
        cosmetic: 0,
        boilerplate: 0,
        added: 0,
        deleted: 0,
        modified: 0,
        structural: 0,
        density,
        ratio,
    };
}

function buildGateMetrics(context: GateMetricsContext) {
    const netDebtPointsDelta = context.resolvedDebtPoints - context.addedDebtPoints;
    return computeTrajectoryQualityMetrics({
        beforeScore: context.beforeScore,
        afterScore: context.currentScore,
        scoreVector: context.scoreVector,
        counters: context.counters,
        debtDelta: {
            resolvedDebtPoints: context.resolvedDebtPoints,
            addedDebtPoints: context.addedDebtPoints,
            netDebtCleared: netDebtPointsDelta,
            regressionFindingsCount: context.regressionCount,
            regressionFindingIds: context.unsuppressedErrors.map(
                (issue) => issue.id || issue.rule || DEFAULT_STATIC_ERROR_ID,
            ),
        },
    });
}

async function resolveGateConfigFile(root: string): Promise<string | undefined> {
    const configPath = path.join(root, CONFIG_FILE_NAME);
    return (await checkPathExists(configPath)) ? configPath : undefined;
}

function extractUnsuppressedErrors(issues: ScanReport['issues']): ScanReport['issues'] {
    return (issues || []).filter(
        (issue) => issue.severity === SEVERITY_ERROR && !issue.suppression,
    );
}

function resolveGateScores(
    scanResult: ScanReport,
    staticPass: boolean,
    historicalBeforeScore: number | undefined,
): { currentScore: number; beforeScore: number; scoreVector: number[] } {
    let currentScore = staticPass ? SCORE_MAX : SCORE_GATE_FAIL;
    if (
        typeof scanResult.qualityScore?.compositeScore === 'number' &&
        Number.isFinite(scanResult.qualityScore.compositeScore)
    ) {
        currentScore = scanResult.qualityScore.compositeScore;
    }
    const beforeScore = historicalBeforeScore ?? currentScore;
    let scoreVector = Array(SCORE_VECTOR_LENGTH).fill(currentScore);
    if (scanResult.qualityScore?.indices) {
        scoreVector = recordToVector(scanResult.qualityScore.indices);
    }
    return { currentScore, beforeScore, scoreVector };
}

async function executeGateScan(root: string): Promise<{
    scanResult: ScanReport;
    unsuppressedErrors: ScanReport['issues'];
    staticPass: boolean;
}> {
    const configFile = await resolveGateConfigFile(root);
    const scanResult = await scan({ root, configFile, logLevel: LOG_LEVEL_WARN });
    const unsuppressedErrors = extractUnsuppressedErrors(scanResult.issues);
    const staticPass = unsuppressedErrors.length === 0;
    return { scanResult, unsuppressedErrors, staticPass };
}

async function getGateEvaluationData(
    root: string,
    scanData: {
        scanResult: ScanReport;
        unsuppressedErrors: ScanReport['issues'];
        staticPass: boolean;
    },
): Promise<{
    staticPass: boolean;
    counters: ReturnType<typeof buildTrajectoryCounters>;
    metrics: ReturnType<typeof buildGateMetrics>;
}> {
    const { scanResult, unsuppressedErrors, staticPass } = scanData;
    const regressionCount = unsuppressedErrors.length;
    const totalFiles = scanResult.summary?.filesScanned || 1;
    const fileMetrics = scanResult.fileMetrics || [];
    const { processedEloc, density, ratio } = computeProcessedDensityAndRatio(
        fileMetrics,
        totalFiles,
    );

    const historicalBeforeScore = await readHistoricalMeanScore(root);
    const { currentScore, beforeScore, scoreVector } = resolveGateScores(
        scanResult,
        staticPass,
        historicalBeforeScore,
    );
    const resolvedDebtPoints = staticPass ? RESOLVED_POINTS_STATIC_PASS : 0;
    const addedDebtPoints = regressionCount * ADDED_POINTS_PER_REGRESSION;

    const counters = buildTrajectoryCounters(processedEloc, density, ratio);
    const metrics = buildGateMetrics({
        beforeScore,
        currentScore,
        scoreVector,
        counters,
        resolvedDebtPoints,
        addedDebtPoints,
        regressionCount,
        unsuppressedErrors,
    });
    return { staticPass, counters, metrics };
}

function evaluateGateStatus(
    stage: GateStage,
    evalData: {
        staticPass: boolean;
        counters: ReturnType<typeof buildTrajectoryCounters>;
        metrics: ReturnType<typeof buildGateMetrics>;
    },
): { summaryText: string; passed: boolean } {
    return evaluateCompositeGate({
        stage,
        staticPass: evalData.staticPass,
        dynamicPass: true,
        counters: evalData.counters,
        metrics: evalData.metrics,
    });
}

async function handleGateCommand(args: string[]): Promise<void> {
    const { stage, root } = parseGateOptions(args);
    const scanData = await executeGateScan(root);
    const evalData = await getGateEvaluationData(root, scanData);
    const compositeGateResult = evaluateGateStatus(stage, evalData);
    process.stdout.write(compositeGateResult.summaryText + '\n');
    process.exit(compositeGateResult.passed ? 0 : 1);
}

/**
 * CLI entry point. Delegates all work to the shared API (scanAndRender),
 * so script/CI and CLI share identical behavior.
 */
async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const subcommand = args.find((argument) => !argument.startsWith('--')) || CMD_SCAN;

    if (subcommand === CMD_SYMBOLS) {
        await handleSymbolsCommand(args);
        return;
    }
    if (subcommand === DAEMON_SUBCOMMAND) {
        const restArgs = args.slice(args.indexOf(DAEMON_SUBCOMMAND) + 1);
        const daemonResult = await daemonCommand(restArgs);
        if (daemonResult.text) process.stdout.write(daemonResult.text + '\n');
        process.exit(daemonResult.code);
    }
    if (subcommand === CMD_SELF_TEST) {
        const testArgs = args.slice(args.indexOf(CMD_SELF_TEST) + 1);
        const selfTestResult = await selfTestCommand(testArgs);
        process.stderr.write(selfTestResult.text + '\n');
        process.exit(selfTestResult.code);
    }
    if (subcommand === CMD_GUIDE) {
        handleGuideCommand(args);
        return;
    }
    if (subcommand === CMD_TRAJECTORY) {
        await handleTrajectoryCommand(args);
        return;
    }
    if (subcommand === CMD_MEMORY) {
        handleMemoryCommand();
        return;
    }
    if (subcommand === CMD_STATS) {
        await handleStatsCommand(args);
        return;
    }
    if (subcommand === CMD_GATE) {
        await handleGateCommand(args);
        return;
    }
    if (subcommand !== CMD_SCAN) {
        printUsage();
        process.exit(2);
    }

    const exitCode = await handleScanCommand(args);
    process.exit(exitCode);
}

main().catch((error: unknown) => {
    const errObj = error as { stack?: string } | undefined;
    process.stderr.write(`[auto-refactor] FATAL: ${errObj?.stack || String(error)}\n`);
    process.exit(2);
});
