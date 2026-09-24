/**
 * Module: Programmatic API — Scan Orchestration & Post-Scan Finalization
 * File Path: src/api.ts
 * Architecture Role: Public library surface and orchestration layer; CLI and Node scripts call
 *     scan/scanWarm/scanDiff/scanDiffDelta/scanAndRender, which wrap the core Scanner.
 * Dependencies & Triggers: Loaded by the src/index.ts CLI and external Node consumers; depends
 *     on core/config, core/analyzer, core/cache, core/reporters, core/logger, core/utf8 and
 *     core/dependencyGraph; lazily requires daemon/client and cli/daemonCmd for warm runs.
 * Responsibilities: Resolve layered config; run cold, cached, diff, delta and daemon-warm scans;
 *     decode Buffer diff inputs; finalize reports with suppressions, dependency-graph cycle
 *     checks and baseline ratchet annotations; render to stdout or --out; expose quality
 *     scoring, review memory, trajectory and agent-constraint helpers; re-export core modules.
 * Exit Semantics & Design Rationale: The scan APIs resolve reports and propagate engine errors;
 *     scanAndRender never throws, mapping outcomes to exit code 0 (ok), 1 (gate hit) or 2
 *     (config/runtime error). Warm scans degrade to cold on any daemon failure so report bytes
 *     stay identical, and lazy daemon imports keep the default cold path free of net/child_process.
 */
import * as fs from 'fs';
import type {
    ScanConfig,
    ScanReport,
    OutputFormat,
    LogLevel,
    ParserKind,
    WarmStats,
    DiffInput,
    DiffStats,
    DiffDeltaReport,
    ScanDiffOptions,
    Issue,
    CommentLevel,
    SecurityLevel,
    UnsupportedLanguageSeverity,
    MaturityTier,
    ProjectProfile,
} from './core/types';
import { resolveConfig, TOOL_VERSION } from './core/config';
import { Scanner } from './core/analyzer';
import { CacheStore } from './core/cache';
import { render } from './core/reporters';
import { Logger, AutoRefactorError } from './core/logger';
import { decodeContent } from './core/utf8';
import type { BASELINE_GRANULARITY_GROUPED } from './core/reporting/reportFinalizer';
import type { QualityScoreBreakdown } from './core/scoring/scoringTypes';
import {
    finalizeReport,
    POST_SCAN_SCOPE_FULL,
    POST_SCAN_SCOPE_INCREMENTAL,
} from './core/reporting/reportFinalizer';
// NOTE: daemon client / daemonCmd are imported LAZILY inside scanWarm/scanAndRender so the
// default scan() path (and CLI boot) never pays for the daemon module graph (net, child_process).
// This preserves the "single-run zero cost" guarantee
// (docs/01-architecture/02-pipeline-and-caching.md §A4.3).

/**
 * Scale factor that converts a 0..1 confidence/score fraction into a percentage.
 */
const PERCENT_SCALE = 100;

/**
 * Minimum column width for a quality-dimension label in the score report.
 */
const QUALITY_DIMENSION_LABEL_WIDTH = 26;

/**
 * Maximum number of quality rationales printed by `--score`, highest-impact first.
 */
const MAX_QUALITY_RATIONALES = 8;

/** Diff input kind whose record carries both the old and the new file content. */
const DIFF_INPUT_KIND_FULL = 'full';

/** Daemon mode that probes an existing daemon only and never auto-starts one. */
const DAEMON_MODE_AUTO = 'auto';

/** Daemon mode that auto-starts a missing daemon for watch/CI warm-up. */
const DAEMON_MODE_ON = 'on';

/** Daemon mode that never connects to or starts a daemon. */
const DAEMON_MODE_OFF = 'off';

/**
 * Options accepted by the programmatic API. A strict subset of ScanConfig — everything not
 * provided falls back to the layered defaults (built-in → config file → these overrides).
 * This is the single entry point for both CLI and script/Node consumers.
 *
 * WARM-SCAN (docs/01-architecture/02-pipeline-and-caching.md §A4.1): all warm options default OFF
 * so `scan()` keeps its
 * historical semantics — no daemon connection, no cache writes, zero implicit disk I/O for
 * library callers.
 */
export interface ScanOptions {
    /** Root directory to scan. Default: cwd. */
    root?: string;
    /** Path to a declarative auto-refactor.config.json. */
    configFile?: string;
    /** Output format. Default: 'text'. */
    format?: OutputFormat;
    /** Allow-list of analyzer names to run. Other declared analyzers are disabled for this run. */
    analyzers?: string[];
    /** Exit/return non-zero if any 'error' issue exists. */
    failOnIssue?: boolean;
    /** Generalized severity gate: exit non-zero if any issue >= this level blocks. */
    failOnSeverity?: 'info' | 'warning' | 'error';
    include?: string[];
    exclude?: string[];
    logLevel?: LogLevel;
    logFile?: string;
    concurrency?: number;
    /** Worker-thread parallelism for parse+analyze. 0=auto, 1=in-process, N=thread count. */
    workers?: number;
    /** Respect a root-level .gitignore when discovering files (default true). */
    respectGitignore?: boolean;
    failOnAnalyzerError?: boolean;
    /**
     * TS/JS-family parser: 'typescript' (default) or 'oxc' (Rust oxc-parser, byte-equivalent
     * normalized output). Rust files are unaffected.
     */
    parser?: ParserKind;
    /** Write the rendered report to this file instead of stdout (machine-readable output). */
    out?: string;

    // ---- dynamic diff & baseline options ----
    /** Incremental dynamic mode: scan only git modified/staged/untracked files. */
    diff?: boolean;
    /** Path to baseline.json for ratchet comparison (fails only on NEW issues). */
    baseline?: string;
    /** Save current scan issues into a new baseline.json. */
    updateBaseline?: string;
    /**
     * Ratchet comparison granularity: 'id' (exact issue id) | 'grouped' (analyzer|rule|file
     * counts). Default from config ('id').
     */
    baselineGranularity?: 'id' | typeof BASELINE_GRANULARITY_GROUPED;
    /**
     * Enforce downward-only ratchet on updateBaseline (pruning resolved groups,
     * forbidding growth).
     */
    baselineRatchetDown?: boolean;
    /** Allow baseline expansion when updating baseline. */
    forceBaselineExpand?: boolean;

    // ---- warm-scan (all default OFF) ----
    /** Enable the two-level incremental cache (scan() only; default false). */
    cache?: boolean;
    /** Cache directory (default `<root>/.auto-refactor-cache`). */
    cacheDir?: string;
    /** Allow L2 caching for custom analyzers by hashing module content (default false). */
    cacheCustom?: boolean;
    /** Daemon mode: 'off' (default) never connects; 'auto' probes an EXISTING daemon only;
     *  'on' auto-starts the daemon when missing (watch/CI warm-up). */
    daemon?: typeof DAEMON_MODE_AUTO | typeof DAEMON_MODE_ON | typeof DAEMON_MODE_OFF;
    /** scan(): also try an existing daemon (report-only; stats discarded). Default false. */
    warm?: boolean;
    /** Leveled comment audit: 'off' | 'basic' | 'standard' | 'strict'. */
    commentLevel?: CommentLevel;
    /** Leveled security audit: 'off' | 'basic' | 'full'. */
    securityLevel?: SecurityLevel;
    /** Fail-closed guard severity for extensions no adapter claims (default 'error'). */
    unsupportedLanguage?: UnsupportedLanguageSeverity;
    /** Automatically tune thresholds based on project scale. */
    autoTuneScale?: boolean;
    /** Display the auto-detected project profile and partition details. */
    showProfile?: boolean;
    /** Display the transparent multi-dimensional quality assessment breakdown. */
    showScore?: boolean;
    /** Enable review memory & semantic reuse. */
    memory?: boolean;
    /** Active Agent UID performing or commanding this scan. */
    agentUid?: string;
    /** Custom dimension weights for transparent quality scoring. */
    scoringWeights?: Record<string, number>;
    /** Optional AbortSignal for cooperative cancellation. */
    signal?: AbortSignal;
    /**
     * Evaluated or specified project maturity tier ('demo' | 'prototype' | 'production' |
     * 'industrial').
     */
    maturityTier?: MaturityTier;
    /** Enable semantic literal classification (URLs, ports, status codes, paths, SVGs). */
    classifyLiterals?: boolean;
    /** Enable granular rule names for classified literals. */
    granularRules?: boolean;
}

const MODULE_DAEMON_CLIENT = './daemon/client';
const MODULE_CLI_DAEMON_CMD = './cli/daemonCmd';

interface LazyWarmScanOptions {
    cache: boolean;
    cacheDir?: string;
    cacheCustom?: boolean;
    workers?: number;
    parser?: string;
}

interface LazyWarmScanDiffOptions extends LazyWarmScanOptions {
    verifyDiskContent: boolean;
    delta: boolean;
}

function buildWarmOptions(options: ScanOptions, defaultCache: boolean): LazyWarmScanOptions {
    return {
        cache: defaultCache ? options.cache !== false : options.cache === true,
        cacheDir: options.cacheDir,
        cacheCustom: options.cacheCustom,
        workers: options.workers,
        parser: options.parser,
    };
}

/** Lazy daemon-client access (keeps the default scan() module graph daemon-free). */
function lazyTryWarmScan(
    root: string,
    config: ScanConfig,
    options: LazyWarmScanOptions,
): Promise<{ report: ScanReport; stats: WarmStats } | null> {
    const { tryWarmScan } = require(MODULE_DAEMON_CLIENT);
    return tryWarmScan(root, config, options);
}

/** Lazy daemon auto-start access (only used by daemon:'on'). */
function lazyEnsureDaemon(root: string): Promise<boolean> {
    const { ensureDaemon } = require(MODULE_CLI_DAEMON_CMD);
    return ensureDaemon(root);
}

/** Lazy diff-daemon access (keeps the default scan() module graph daemon-free). */
function lazyTryWarmScanDiff(
    root: string,
    config: ScanConfig,
    diffs: DiffInput[],
    options: LazyWarmScanDiffOptions,
): Promise<{ report: ScanReport | DiffDeltaReport; stats: DiffStats } | null> {
    const { tryWarmScanDiff } = require(MODULE_DAEMON_CLIENT);
    return tryWarmScanDiff(root, config, diffs, options);
}

/**
 * Programmatic entry point. Call `await scan(...)` with root and options; inspect
 * `report.summary.bySeverity.error` to evaluate gate outcomes.
 *
 * This async entry point awaits config resolution and the scan while keeping no shared mutable
 * scan state; callers must serialize writes to a shared `cacheDir`. Semantics are unchanged
 * from the pre-warm-scan engine: no daemon, no cache unless the caller explicitly opts in via
 * `cache`/`warm`.
 *
 * @param options - API overrides layered over built-in defaults and any config file; omitted
 *                    fields keep their layered values.
 * @returns Completed scan report; this async call resolves once the chosen scan path finishes.
 * @throws Error when `options.signal` is already aborted, or when config resolution or the
 *               underlying scan fails; those errors propagate unchanged.
 */
export async function scan(options: ScanOptions = {}): Promise<ScanReport> {
    if (options.signal?.aborted) {
        throw new Error('Scan aborted by user');
    }
    const config = resolveConfig(options);
    const logger = new Logger(config.logLevel, config.logFile);
    const scanner = new Scanner(config, logger);

    let report!: ScanReport;
    // A warm/daemon report originates in another process, so this process's `scanner` holds an
    // empty graph: leave `reportScanner` null and let the post-scan pipeline rebuild it. A
    // cold/cache pass fills it in so the cycle pass can reuse the graph already built.
    let reportScanner: Scanner | null = null;
    const runColdPass = async (): Promise<void> => {
        if (options.cache) {
            const cache = new CacheStore(options.cacheDir, config.root);
            const r = await scanner.scanWithCache({ cache, cacheCustom: options.cacheCustom });
            report = r.report;
        } else {
            report = await scanner.scan();
        }
        reportScanner = scanner;
    };

    if (options.warm && options.daemon !== DAEMON_MODE_OFF) {
        const mode = options.daemon || DAEMON_MODE_AUTO;
        if (mode === DAEMON_MODE_ON) await lazyEnsureDaemon(config.root);
        const warm = await lazyTryWarmScan(config.root, config, buildWarmOptions(options, false));
        if (warm) {
            report = warm.report;
        } else {
            await runColdPass();
        }
    } else {
        await runColdPass();
    }

    // The post-scan pipeline (suppressions / dependency graph / baseline) is part of scan(), so
    // library callers and the CLI observe exactly the same report.
    await finalizeReport(report, config, options, logger, reportScanner);
    logger.close();
    return report;
}

/**
 * Explicit warm-scan session (docs/01-architecture/02-pipeline-and-caching.md §A4.1): attempt
 * a daemon scan and, on ANY failure, degrade to a cold scan. The report is byte-identical
 * between warm and cold; stats are a sibling field (never part of ScanReport) so output bytes
 * never change. This async call awaits the daemon attempt and then, if needed, the cold path;
 * it holds no shared scan state, but callers must not share one cache directory concurrently.
 *
 * @param options - Warm-scan overrides; `cache` defaults to enabled and `daemon` to 'auto'.
 * @returns Report plus warm statistics; this async result reports `daemonUsed: false` when the
 *          cold fallback ran.
 * @throws Error when config resolution or the cold fallback scan fails; daemon failures are
 *               converted into that cold fallback and never propagated.
 */
export async function scanWarm(
    options: ScanOptions = {},
): Promise<{ report: ScanReport; stats: WarmStats }> {
    const config = resolveConfig(options);
    const mode = options.daemon || DAEMON_MODE_AUTO;
    const logger = new Logger(config.logLevel, config.logFile);

    if (mode !== DAEMON_MODE_OFF) {
        if (mode === DAEMON_MODE_ON) await lazyEnsureDaemon(config.root);
        const warm = await lazyTryWarmScan(config.root, config, buildWarmOptions(options, true));
        if (warm) {
            // Daemon reports arrive unfinalized (the daemon runs the raw scanner), so apply the
            // same post-scan pipeline here with no in-process graph to reuse.
            await finalizeReport(warm.report, config, options, logger, null);
            logger.close();
            return warm;
        }
    }

    // ---- degrade to cold ----
    const scanner = new Scanner(config, logger);
    if (options.cache !== false) {
        const cache = new CacheStore(options.cacheDir, config.root);
        const r = await scanner.scanWithCache({ cache, cacheCustom: options.cacheCustom });
        await finalizeReport(r.report, config, options, logger, scanner);
        logger.close();
        return r;
    }
    const report = await scanner.scan();
    await finalizeReport(report, config, options, logger, scanner);
    logger.close();
    return {
        report,
        stats: {
            daemonUsed: false,
            l1Hit: 0,
            l2Hit: 0,
            cacheHit: 0,
            cacheTotal: report.summary.filesScanned,
            analyzed: report.summary.filesScanned,
            poolWarm: false,
            daemonMs: 0,
            incrementalFiles: 0,
            incrementalHit: 0,
        },
    };
}

/** Decode any Buffer content fields in DiffInput[] to UTF-16 strings (JSON-safe for daemon). */
function decodeDiffs(diffs: DiffInput[]): DiffInput[] {
    return diffs.map((d) => {
        if (d.kind === DIFF_INPUT_KIND_FULL) {
            return {
                ...d,
                oldContent: decodeContent(d.oldContent as unknown as string | Buffer),
                newContent: decodeContent(d.newContent as unknown as string | Buffer),
            };
        }
        return {
            ...d,
            newContent: decodeContent(d.newContent as unknown as string | Buffer),
            oldContent:
                d.oldContent !== undefined
                    ? decodeContent(d.oldContent as unknown as string | Buffer)
                    : undefined,
        };
    });
}

/** Shared daemon-or-cold dispatch for scanDiff / scanDiffDelta. */
async function runDiff(
    diffs: DiffInput[],
    options: ScanDiffOptions,
    delta: boolean,
): Promise<{ report: ScanReport | DiffDeltaReport; stats: DiffStats }> {
    const config = resolveConfig(options);
    const norm = decodeDiffs(diffs);
    const logger = new Logger(config.logLevel, config.logFile);

    const mode = options.daemon || DAEMON_MODE_AUTO;
    if (mode !== DAEMON_MODE_OFF) {
        if (mode === DAEMON_MODE_ON) await lazyEnsureDaemon(config.root);
        const warm = await lazyTryWarmScanDiff(config.root, config, norm, {
            cache: options.cache !== false,
            cacheDir: options.cacheDir,
            cacheCustom: options.cacheCustom,
            workers: options.workers,
            parser: options.parser,
            verifyDiskContent: options.verifyDiskContent !== false,
            delta,
        });
        if (warm) {
            // Incremental reports never carry cross-file passes (partial file set); they still
            // get reasoned suppressions and baseline annotations, exactly like a full scan.
            await finalizeReport(
                warm.report as ScanReport,
                config,
                options as ScanOptions,
                logger,
                null,
                POST_SCAN_SCOPE_INCREMENTAL,
            );
            logger.close();
            return warm;
        }
    }

    // ---- degrade to in-process ----
    const scanner = new Scanner(config, logger);
    const cache =
        options.cache === false
            ? new CacheStore(undefined, config.root, { disabled: true })
            : new CacheStore(options.cacheDir, config.root);
    const diffHints = new Map<string, DiffInput>();
    for (const d of norm) if (!diffHints.has(d.filePath)) diffHints.set(d.filePath, d);
    const baseDiffOpts = {
        cache,
        cacheCustom: options.cacheCustom,
        diffHints,
        verifyDiskContent: options.verifyDiskContent !== false,
    };
    const r = delta
        ? await scanner.scanWithDiff({ ...baseDiffOpts, deltaOnly: true })
        : await scanner.scanWithDiff({ ...baseDiffOpts, deltaOnly: false });
    await finalizeReport(
        r.report as ScanReport,
        config,
        options as ScanOptions,
        logger,
        scanner,
        POST_SCAN_SCOPE_INCREMENTAL,
    );
    logger.close();
    return { report: r.report, stats: r.stats };
}

/**
 * Full diff scan (docs/03-incremental-and-diff/02-diff-interface-spec.md §1.4): returns a report
 * over ALL discovered files that is byte-identical to a cold rescan, using the diff inputs only
 * to accelerate changed files. Changed files are routed byteEqual/incremental/full; unchanged
 * files keep the L1/L2 path. This async call awaits daemon-or-cold dispatch and keeps no shared
 * scan state; concurrent callers must not share a cache directory.
 *
 * @param diffs - Changed-file inputs; when a path repeats, the first hint wins.
 * @param options - Diff-scan overrides for daemon, cache, parser, workers, and streaming.
 * @returns Full-scan report plus diff/cache stats; this async result matches a cold scan.
 * @throws Error when config resolution or the in-process diff scan fails; daemon failures
 *               degrade to the in-process path instead of propagating.
 */
export async function scanDiff(
    diffs: DiffInput[],
    options: ScanDiffOptions = {},
): Promise<{ report: ScanReport; stats: DiffStats }> {
    const r = await runDiff(diffs, options, false);
    return { report: r.report as ScanReport, stats: r.stats };
}

/**
 * Delta diff scan (docs/03-incremental-and-diff/02-diff-interface-spec.md §1.5): returns only
 * the changed-file SUBSET. Its contract is `delta.report ≡ filter(scanDiff.report,
 * changed-file set)` — every issue/metric is byte-identical to the full report's corresponding
 * entry, in the same relative order. It is not byte-equivalent to a cold scan by itself.
 * This async call awaits daemon-or-cold dispatch; concurrent callers must not share a cache.
 *
 * @param diffs - Changed-file inputs; when a path repeats, the first hint wins.
 * @param options - Diff-scan overrides for daemon, cache, parser, workers, and streaming.
 * @returns Delta report (changed files only) plus diff/cache stats.
 * @throws Error when config resolution or the in-process delta scan fails; daemon failures
 *               degrade to the in-process path instead of propagating.
 */
export async function scanDiffDelta(
    diffs: DiffInput[],
    options: ScanDiffOptions = {},
): Promise<{ report: DiffDeltaReport; stats: DiffStats }> {
    const r = await runDiff(diffs, options, true);
    return { report: r.report as DiffDeltaReport, stats: r.stats };
}

/**
 * Print the resolved project stack profile to stdout: language, build systems, frameworks,
 * scale grade, polyglot flag, and partition names.
 *
 * @param profile - Resolved project profile whose partitions are summarized.
 * @param scaleGrade - Optional scale grade label; defaults to 'standard' when omitted.
 */
function printProjectStackProfile(profile: ProjectProfile, scaleGrade?: string): void {
    process.stdout.write(`\n=== Project Stack Profile ===\n`);
    process.stdout.write(`Primary Language: ${profile.primaryLanguage}\n`);
    process.stdout.write(`Build Systems:    ${profile.buildSystems.join(', ') || 'none'}\n`);
    process.stdout.write(`Frameworks:       ${profile.frameworks.join(', ') || 'none'}\n`);
    process.stdout.write(`Scale Grade:      ${scaleGrade || 'standard'}\n`);
    process.stdout.write(`Is Polyglot:      ${profile.isPolyglot}\n`);
    if (profile.partitions.length > 0) {
        process.stdout.write(
            `Partitions:       ${profile.partitions.map((p) => p.name).join(', ')}\n`,
        );
    }
    process.stdout.write(`=============================\n\n`);
}

async function collectGitChangedFiles(root: string): Promise<string[]> {
    const changedFiles: string[] = [];
    try {
        const cp = require('child_process');
        const { promisify } = require('util');
        const execFileAsync = promisify(cp.execFile);
        const { stdout: out } = await execFileAsync('git', ['status', '--porcelain'], {
            cwd: root,
            encoding: 'utf8',
        });
        for (const line of (out || '').split(/\r?\n/)) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            const parts = trimmed.split(/\s+/);
            const raw = parts.slice(1).join(' ').replace(/^"|"$/g, '');
            // Renames arrive as `old -> new`; only the destination is scanned.
            const target = (raw.includes(' -> ') ? raw.split(' -> ').pop()! : raw).trim();
            if (target) changedFiles.push(target.replace(/\\/g, '/'));
        }
    } catch (_gitErr) {
        // Ignore: git unavailable, not a repository, or execution error.
    }
    return changedFiles;
}

function createEmptyDiffReport(config: ScanConfig): ScanReport {
    return {
        tool: 'auto-refactor',
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

async function executeDiffScanMode(
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

async function executeStandardScanMode(
    config: ScanConfig,
    options: ScanOptions,
    logger: Logger,
    mode: string,
): Promise<{ report: ScanReport; stats: WarmStats | null; scanner: Scanner | null }> {
    if (mode !== DAEMON_MODE_OFF) {
        if (mode === DAEMON_MODE_ON) await lazyEnsureDaemon(config.root);
        const warm = await lazyTryWarmScan(config.root, config, {
            cache: options.cache === true,
            cacheDir: options.cacheDir,
            cacheCustom: options.cacheCustom,
            workers: options.workers,
            parser: options.parser,
        });
        if (warm) {
            return { report: warm.report, stats: warm.stats, scanner: null };
        }
    }
    const scanner = new Scanner(config, logger);
    if (options.cache) {
        const cache = new CacheStore(options.cacheDir, config.root);
        const r = await scanner.scanWithCache({ cache, cacheCustom: options.cacheCustom });
        return { report: r.report, stats: r.stats, scanner };
    }
    const report = await scanner.scan();
    return { report, stats: null, scanner };
}

function printQualityScoreAssessment(q: QualityScoreBreakdown): void {
    process.stdout.write(`\n=== Transparent Code Quality Assessment ===\n`);
    process.stdout.write(
        `Composite Quality Index: ${q.compositeScore.toFixed(1)} / 100 [Grade: ${q.grade}] (Confidence: ${(q.confidence * PERCENT_SCALE).toFixed(0)}%)\n`,
    );
    process.stdout.write(`-------------------------------------------\n`);
    for (const [dim, val] of Object.entries(q.indices)) {
        process.stdout.write(
            `  • ${dim.padEnd(QUALITY_DIMENSION_LABEL_WIDTH)}: ${(val as number).toFixed(1)}\n`,
        );
    }
    if (q.rationales && q.rationales.length > 0) {
        process.stdout.write(`-------------------------------------------\n`);
        process.stdout.write(`Key Deductions & Rationales:\n`);
        for (const r of q.rationales.slice(0, MAX_QUALITY_RATIONALES)) {
            process.stdout.write(
                `  [${r.delta} pts] ${r.dimension}: ${r.reason}${r.line ? ` (L${r.line})` : ''}\n`,
            );
        }
    }
    process.stdout.write(`===========================================\n\n`);
}

async function outputRenderedReport(
    report: ScanReport,
    config: ScanConfig,
    logger: Logger,
): Promise<void> {
    const text = render(report, config.format);
    if (config.out) {
        await fs.promises.writeFile(config.out, text + '\n', 'utf8');
        logger.info(`report written to ${config.out}`);
    } else {
        process.stdout.write(text + '\n');
    }
}

function evaluateGateExitCode(report: ScanReport, config: ScanConfig): number {
    const ratchetUsed = report.summary.ratchetBaselineUsed === true;
    // A suppressed finding stays in the report for auditing but never decides a gate: that is
    // the documented contract of `suppression` (report.schema.json) and what gate-self.js
    // already assumed, so the exit code must agree with it instead of counting the finding.
    const blockingPool: Issue[] = report.issues.filter(
        (i) => !i.suppression && (!ratchetUsed || i.isNew === true),
    );
    const rank = { info: 0, warning: 1, error: 2 } as const;
    if (config.failOnIssue && blockingPool.some((i) => i.severity === 'error')) return 1;
    if (config.failOnSeverity) {
        const threshold = rank[config.failOnSeverity];
        if (blockingPool.some((i) => rank[i.severity] >= threshold)) return 1;
    }
    return 0;
}

/**
 * Emits warm scan statistics to logger if present.
 *
 * @param logger - Active logger instance.
 * @param stats - Optional warm stats payload.
 */
function logWarmStats(logger: Logger, stats?: WarmStats | null): void {
    if (!stats) return;
    logger.info(
        `warm: daemonUsed=${stats.daemonUsed} cacheHit=${stats.cacheHit}/${stats.cacheTotal} ` +
            `l1=${stats.l1Hit} l2=${stats.l2Hit} analyzed=${stats.analyzed} poolWarm=${stats.poolWarm} daemonMs=${stats.daemonMs}`,
    );
}

/**
 * Maps uncaught scan exceptions to formatted stderr output and exit code 2.
 *
 * @param e - Unknown thrown error.
 * @returns Error exit code 2.
 */
function handleScanError(e: unknown): number {
    const msg = e instanceof Error ? e.message : String(e);
    const code = e instanceof AutoRefactorError ? e.code : 'SCAN_FAILED';
    process.stderr.write(`[auto-refactor] ERROR (${code}): ${msg}\n`);
    return 2;
}

/**
 * Convenience wrapper that scans AND renders. Returns the process exit code:
 *   0 = ok (or only info/warning when failOnIssue is false)
 *   1 = error-level issues found (and failOnIssue true)
 *   2 = configuration / runtime error before scan completed
 * Used by the CLI; scripts may also call it to reuse exit semantics.
 * Concurrency: reentrant and idempotent; each call resolves its own configuration and logger.
 *
 * @param options - Scan/render overrides; writes to stdout unless `out` is set.
 * @returns Exit code after awaiting scan, finalization, and render; never rejects.
 */
export async function scanAndRender(options: ScanOptions = {}): Promise<number> {
    try {
        const config = resolveConfig(options);
        const logger = new Logger(config.logLevel, config.logFile);
        const mode = options.daemon || DAEMON_MODE_OFF;

        if (options.showProfile && config.profile) {
            printProjectStackProfile(config.profile, config.scaleGrade);
        }

        const scanResult = options.diff
            ? await executeDiffScanMode(config, logger)
            : await executeStandardScanMode(config, options, logger, mode);

        const { report, stats, scanner } = scanResult;
        logWarmStats(logger, stats);

        const scope = options.diff ? POST_SCAN_SCOPE_INCREMENTAL : POST_SCAN_SCOPE_FULL;
        await finalizeReport(report, config, options, logger, scanner, scope);

        await outputRenderedReport(report, config, logger);

        if (options.showScore && report.qualityScore) {
            printQualityScoreAssessment(report.qualityScore);
        }
        logger.close();
        return evaluateGateExitCode(report, config);
    } catch (e) {
        return handleScanError(e);
    }
}

export { finalizeReport, recomputeSummary, groupCounts } from './core/reporting/reportFinalizer';

export { resolveConfig, Scanner, Logger, AutoRefactorError, render, CacheStore };
export { scanDiffStream } from './core/stream';
export { CircularDiffBuffer } from './core/ring-buffer';
export { PraxisRollbackEngine, revertDiffHunk, revertTaskCard } from './core/rollback';
export {
    fnv1a32,
    hashLines,
    hashLinesDirect,
    computeLineStartsAndHashes,
    myersDiff,
    histogramDiff,
    fastDiff,
    computeDetailedHunks,
    formatUnifiedDiff,
    computeEditRanges,
    computeEditRangesWithOps,
    computeLineStarts,
    linesOf,
    getLine,
    countLines,
} from './core/edit-diff';
export { ModuleDependencyGraph, runCyclePass, findImportCycles } from './core/dependency-graph';
export { GovernanceAnalyzer } from './analyzers/governance';
export { ArchitectureAnalyzer } from './analyzers/architecture';
export { PerformanceAnalyzer } from './analyzers/performance';
export { CommentAnalyzer } from './analyzers/comments';
export { HygieneAnalyzer } from './analyzers/hygiene';
export { SecurityAnalyzer } from './analyzers/security';
export { DataArchitectureAnalyzer } from './analyzers/data-architecture';
export { TestModernityAnalyzer } from './analyzers/test-modernity';
export { DependencyLayoutAnalyzer } from './analyzers/dependency-layout';
export * from './core/intelligence/semanticComplexity';
export * from './core/intelligence/dataArchitecture';
export * from './core/intelligence/testModernity';
export * from './core/intelligence/dependencyLayout';
export * from './core/intelligence/semanticArchitecture';
export { detectProjectProfile, inferDirectorySemantic } from './core/profiler/projectProfiler';
export {
    evaluateScaleGrade,
    getTunedThresholds,
    getTunedAnalyzerOptions,
} from './core/profiler/scaleTuner';
export * from './core/governance';
export * from './core/swar';
export * from './core/praxis';
export * from './core/types';
export * from './core/memory/types';
export * from './core/memory/reviewMemory';
export * from './core/memory/domainFingerprint';
export * from './core/memory/semanticMatcher';
export * from './core/scoring/scoringTypes';
export * from './core/scoring/qualityScorer';
export * from './core/trajectory/types';
export * from './core/trajectory/changeTrajectory';
export * from './core/trajectory/anomalyDetector';
export * from './core/guidance/agentConstraintGenerator';
export * from './core/router/diffClassifier';
export * from './core/router/sparseRuleRouter';
export * from './core/profiler/loadGovernor';
export * from './core/pipeline/escalationChannel';
export * from './core/pipeline/dualTrackPipeline';
export * from './core/rules/registry';
export * as messages from './core/messages';
export * from './core/messages';

export {
    evaluateQualityScore,
    getReviewMemory,
    resolveReviewMemoryDir,
    getChangeTrajectory,
    querySymbols,
    queryContextSlice,
    queryAgentConstraints,
    scanAsymmetric,
} from './core/intelligence/apiQueries';

// ---- Re-export Pluggable & Governance Extensions ----
export * from './core/governance/semanticLiterals';
export * from './core/reporters/reporterRegistry';
export * from './core/memory/trainingExporter';
export {
    detectMaturityTier,
    detectProjectArchetype,
    ProjectArchetype,
} from './core/profiler/projectProfiler';
export {
    routeArchetypeToAnalyzers,
    ARCHETYPE_ANALYZER_MATRIX,
} from './core/router/sparseRuleRouter';
export type { ActivatedReviewersSummary } from './core/types';
export {
    getMaturityTunedThresholds,
    getMaturityTunedAnalyzerOptions,
} from './core/profiler/scaleTuner';
export { ImportedSymbolRef, SymbolImpactAnalysis } from './core/dependency-graph';
export { NEED_RUNTIME_EVIDENCE, IssueEvidence } from './core/types';
export {
    LifecycleStage,
    LifetimeKind,
    TransferType,
    DataFlowNode,
    DataFlowEdge,
    DataFlowGraphStats,
    DataFlowGraph,
    detectUnboundedGrowth,
    computeEffectiveLoc,
    computeCoupling,
    computeComplexityProxy,
    computeIncrementalMetrics,
    countDuplicateLines,
    IncrementalMetrics,
    IncrementalOptions,
} from './core/intelligence/dataFlow';
export { buildContextSlice } from './core/intelligence/contextSlice';
export type {
    ContextSlice,
    ContextSliceRegion,
    ContextSliceOptions,
} from './core/intelligence/contextSlice';
export * from './core/intelligence/dataArchitecture';
// ---- Quality Quantification & Scoring Engine ----
export * from './core/scoring';

// ---- Audit Snapshot & Sandbox Baseline Extensions ----
export * from './core/snapshot/types';
export * from './core/snapshot/snapshotManager';

// ---- Unified Semantic IR & Topology Graph ----
export * from './core/semantic/types';
export * from './core/semantic/semanticGraph';
export * from './core/semantic/adapters';

// ---- Universal Rule Pyramid & Hierarchy ----
export * from './core/rules/pyramid';

// ---- Praxis Diff Governance Subsystem Facade & SPI ----
export * from './core/praxis';

// ---- Semantic Architecture Graph & Meta-Architecture Rules ----
export * from './core/architecture';

// ---- Change Trajectory & Multi-Agent Coordination ----
export * from './core/trajectory';

// ---- Fine-Grained AST Slice & Sparse MoE Router ----
export * from './core/router/sliceTypes';
export * from './core/router/sliceExtractor';
export * from './core/router/sparseMoEGate';
export * from './core/intelligence/callChainImpactTracer';
