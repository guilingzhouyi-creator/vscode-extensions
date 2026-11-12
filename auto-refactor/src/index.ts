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
    getReviewMemory,
    scan,
    type ScanReport,
} from './api';
import { resolveConfig } from './core/config/config';
import { DAEMON_SUBCOMMAND, parseArgs, printUsage } from './cli/cli-parser';
import {
    readLifetimeSummary,
    recordToVector,
    computeTrajectoryQualityMetrics,
} from './core/trajectory';
import { ALL_QUALITY_DIMENSIONS } from './core/scoring/scoringTypes';
import { evaluateCompositeGate, type GateStage } from './core/praxis/composite-quality-gate';
import { CacheStore } from './core/cache';
import { daemonCommand } from './cli/daemonCmd';
import { runSelfTestCommand } from './cli/selfTestCmd';
import { reviewCommand } from './cli/review-cmd';
import { handleFixWorkflow } from './cli/fix-cmd';
import { trajectoryCommand } from './cli/trajectory-cmd';
import { analyzeCodeDensity } from './core/intelligence/code-density-analyzer';
import {
    buildDebtLedger,
    calculateStructuralDebtDelta,
} from './core/intelligence/elastic-debt-budget';

/** Decimal radix used when parsing numeric CLI arguments such as `--line`. */
const DECIMAL_RADIX = 10;

/** CLI subcommand identifiers */
const CMD_SYMBOLS = 'symbols';
const CMD_GUIDE = 'guide';
const CMD_TRAJECTORY = 'trajectory';
const CMD_MEMORY = 'memory';
const CMD_STATS = 'stats';
const CMD_GATE = 'gate';
const CMD_SCAN = 'scan';
const CMD_SELF_TEST = 'self-test';
const CMD_REVIEW = 'review';

/** Common CLI option flags */
const FLAG_ROOT = '--root';
const FLAG_DOMAIN = '--domain';
const FLAG_LINE = '--line';
const FLAG_STAGE = '--stage';

/** Scoring, threshold and weight constants */
const SCORE_MAX = 100.0;
const SCORE_GATE_FAIL = 80.0;
const DYNAMIC_GATE_FLOOR = 80.0;

/** String literals and operational constants */
const LOG_LEVEL_WARN = 'warn';
const LOG_LEVEL_SILENT = 'silent';
const KIND_PAD_WIDTH = 9;
const PERCENTAGE_FACTOR = 100;
const DEFAULT_DILUTION_RATIO = '1.00';
const TRAJECTORY_DIR_NAME = '.refactor-trajectory';
const STATUS_OK = 'ok';
const STATUS_FAILED = 'FAILED';
const DEFAULT_GATE_STAGE: GateStage = 'pre-commit';
const DEFAULT_STATIC_ERROR_ID = 'STATIC_ERROR';
const CONFIG_FILE_NAME = 'auto-refactor.config.json';
const SEVERITY_ERROR = 'error';

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

/**
 * Context for directory traversal during codebase file collection.
 */
interface DirectoryProcessingContext {
    /** Current directory path being enumerated. */
    curr: string;
    /** Directory entry items returned by readdir. */
    entries: fs.Dirent[];
    /** Traversal FIFO directory queue. */
    queue: string[];
    /** Set of supported file extensions. */
    supportedExts: Set<string>;
    /** Set of directories ignored during recursive traversal. */
    ignoredDirs: Set<string>;
}

/**
 * Context bundling telemetry metrics for Praxis composite gate evaluation.
 */
interface GateMetricsContext {
    /** Quality score prior to current execution. */
    beforeScore: number;
    /** Evaluated composite score for current codebase state. */
    currentScore: number;
    /** Multi-dimensional quality vector across evaluated planes. */
    scoreVector: number[];
    /** Trajectory counters tracking added, resolved, and regression deltas. */
    counters: ReturnType<typeof buildTrajectoryCounters>;
    /** Net technical debt points successfully resolved. */
    resolvedDebtPoints: number;
    /** Technical debt points newly introduced. */
    addedDebtPoints: number;
    /** Count of secondary regressions observed. */
    regressionCount: number;
    /** List of unsuppressed gate error findings. */
    unsuppressedErrors: Array<{ id?: string; rule?: string }>;
}

/**
 * Dispatches the `symbols` subcommand to query cross-file definitions and call sites.
 *
 * @param args CLI arguments array containing target symbol identifier and optional options.
 */
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

/**
 * Dispatches the `guide` subcommand to render contextual rule guidance for a file or line.
 *
 * @param args CLI arguments array containing target file path and optional domain/line flags.
 */
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

/**
 * Dispatches the `trajectory` subcommand to query ledger or file history.
 *
 * @param args CLI arguments array.
 */
async function handleTrajectoryCommand(args: string[]): Promise<void> {
    const result = await trajectoryCommand(args);
    if (result.text) {
        process.stdout.write(result.text + '\n');
    }
    process.exit(result.code);
}

/**
 * Computes raw physical lines of code and effective logical code lines.
 *
 * @param content Source code string.
 * @param filePath Optional file path for language-aware parsing.
 * @returns Object with physical LOC and effective ELOC.
 */
function countLinesEloc(content: string, filePath?: string): { loc: number; eloc: number } {
    const metrics = analyzeCodeDensity(content, filePath);
    return {
        loc: metrics.physicalLines,
        eloc: Math.round(metrics.effectiveCodeLines),
    };
}

/**
 * Traverses entries within a directory and accumulates file counts and line metrics.
 *
 * @param context Directory enumeration context.
 * @returns Delta counts for discovered files, LOC, and ELOC.
 */
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
            const counts = countLinesEloc(content, full);
            loc += counts.loc;
            eloc += counts.eloc;
        } catch {
            /* ignored: unreadable file */
        }
    }
    return { files, loc, eloc };
}

/**
 * Recursively scans target directory to accumulate project-level file and line statistics.
 *
 * @param targetRoot Root directory path to inspect.
 * @returns Aggregated file count, physical LOC, and effective ELOC totals.
 */
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

async function handleScanCommand(args: string[]): Promise<number> {
    const cli = parseArgs(args);

    // --cache-clear: wipe the cache dir up-front (a fresh scan rebuilds it).
    if (cli.cacheClear) {
        const cfg = resolveConfig(cli);
        const cache = new CacheStore(cli.cacheDir, cfg.root);
        const clearedOk = cache.clear();
        process.stderr.write(
            `[auto-refactor] cache cleared (${clearedOk ? STATUS_OK : STATUS_FAILED}): ${cache.dir}\n`,
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
    // The vector length comes from the canonical dimension list rather than a local literal: a
    // second copy of the number would keep producing ten-element vectors after the model grew an
    // eleventh axis, and the shortfall would read as an unmeasured dimension instead of a bug.
    let scoreVector = Array(ALL_QUALITY_DIMENSIONS.length).fill(currentScore);
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

async function resolveGateDebtDelta(
    root: string,
    issues: ScanReport['issues'],
): Promise<{ resolvedDebtPoints: number; addedDebtPoints: number }> {
    const sigPath = path.join(root, TRAJECTORY_DIR_NAME, 'baseline-signatures.json');
    if (await checkPathExists(sigPath)) {
        try {
            const raw = await fs.promises.readFile(sigPath, 'utf8');
            const parsed = JSON.parse(raw) as { files?: Record<string, unknown> };
            if (parsed && typeof parsed.files === 'object') {
                const activeIssues = (issues || []).filter((issueItem) => !issueItem.clusteredInto);
                const { debtByTier } = buildDebtLedger(activeIssues);
                const delta = calculateStructuralDebtDelta({
                    prevFilesMap: parsed.files,
                    currentIssues: activeIssues,
                    currentDebtByTier: debtByTier,
                });
                return {
                    resolvedDebtPoints: delta.resolvedDebtPoints,
                    addedDebtPoints: delta.addedDebtPoints,
                };
            }
        } catch {
            return { resolvedDebtPoints: 0, addedDebtPoints: 0 };
        }
    }
    return { resolvedDebtPoints: 0, addedDebtPoints: 0 };
}

function resolveDynamicGatePass(scanResult: ScanReport, staticPass: boolean): boolean {
    const dynamicScore = (
        scanResult.qualityScore as { dynamic?: { compositeDynamicScore?: number } } | undefined
    )?.dynamic?.compositeDynamicScore;
    if (typeof dynamicScore === 'number' && Number.isFinite(dynamicScore)) {
        return dynamicScore >= DYNAMIC_GATE_FLOOR;
    }
    return staticPass;
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
    dynamicPass: boolean;
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
    const { resolvedDebtPoints, addedDebtPoints } = await resolveGateDebtDelta(
        root,
        scanResult.issues,
    );

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
    const dynamicPass = resolveDynamicGatePass(scanResult, staticPass);
    return { staticPass, dynamicPass, counters, metrics };
}

function evaluateGateStatus(
    stage: GateStage,
    evalData: {
        staticPass: boolean;
        dynamicPass: boolean;
        counters: ReturnType<typeof buildTrajectoryCounters>;
        metrics: ReturnType<typeof buildGateMetrics>;
    },
): { summaryText: string; passed: boolean } {
    return evaluateCompositeGate({
        stage,
        staticPass: evalData.staticPass,
        dynamicPass: evalData.dynamicPass,
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
        const selfTestResult = await runSelfTestCommand(testArgs);
        process.stderr.write(selfTestResult.text + '\n');
        process.exit(selfTestResult.code);
    }
    if (subcommand === CMD_REVIEW) {
        const reviewArgs = args.slice(args.indexOf(CMD_REVIEW) + 1);
        const reviewResult = reviewCommand(reviewArgs);
        process.stdout.write(reviewResult.text + '\n');
        process.exit(reviewResult.code);
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
