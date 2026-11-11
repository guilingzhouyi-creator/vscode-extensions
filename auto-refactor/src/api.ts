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
    CommentLevel,
    SecurityLevel,
    UnsupportedLanguageSeverity,
    MaturityTier,
    DynamicEvidenceDTO,
    QualityReviewProfile,
} from './core/types';
import { resolveConfig } from './core/config/config';
import { Scanner } from './core/analyzer';
import { CacheStore } from './core/cache';
import { render } from './core/reporters';
import { Logger, AutoRefactorError } from './core/logger';
import { decodeContent } from './core/ast/utf8';
import type { BASELINE_GRANULARITY_GROUPED } from './core/reporting/reportFinalizer';
import {
    printProjectStackProfile,
    printQualityScoreAssessment,
    printAutonomyAssessment,
} from './core/reporting/quality-printer';
import {
    finalizeReport,
    POST_SCAN_SCOPE_FULL,
    POST_SCAN_SCOPE_INCREMENTAL,
} from './core/reporting/reportFinalizer';
import {
    evaluateGateExitCode,
    executeDiffScanMode,
    handleScanError,
    logWarmStats,
    persistCliScanTrajectory,
    writeRenderedReport,
} from './core/reporting/cli-scan-support';
// NOTE: daemon client / daemonCmd are imported LAZILY inside scanWarm/scanAndRender so the
// default scan() path (and CLI boot) never pays for the daemon module graph (net, child_process).
// This preserves the "single-run zero cost" guarantee
// (docs/01-architecture/02-pipeline-and-caching.md §A4.3).

/** Diff input kind whose record carries both the old and the new file content. */
const DIFF_INPUT_KIND_FULL = 'full';

/** Daemon mode that probes an existing daemon only and never auto-starts one. */
const DAEMON_MODE_AUTO = 'auto';

/** Daemon mode that auto-starts a missing daemon for watch/CI warm-up. */
const DAEMON_MODE_ON = 'on';

/** Daemon mode that never connects to or starts a daemon. */
const DAEMON_MODE_OFF = 'off';

/** Standard error and status strings. */
const MSG_SCAN_ABORTED = 'Scan aborted by user';

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
     * Write the human review queue to this NDJSON path.
     *
     * The queue holds only the findings no automated tier could settle, so it is a work list
     * rather than a second copy of the report; see `core/reporting/review-queue.ts` for the
     * category precedence.
     */
    reviewQueue?: string;
    /**
     * Calibration corpus supplying per-rule outcome counts.
     *
     * Omit it and every confidence stays the analyzer's own score, which is the pre-calibration
     * behaviour; point it at an accumulated corpus and confidence becomes a posterior adjudicated
     * from recorded outcomes.
     */
    confidenceCorpus?: string;
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
    /**
     * Target quality review profile: 'frontend' | 'backend' | 'composite'.
     * When specified, tunes 10-dimension weights specifically for the given architecture plane.
     */
    reviewProfile?: QualityReviewProfile;
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
    /** Dynamic telemetry file path for Tri-Plane runtime evidence ingestion. */
    telemetry?: string;
    /** In-memory dynamic runtime evidence for Tri-Plane dynamic quality scoring. */
    telemetryData?: DynamicEvidenceDTO;
    /** Persist scan outcome and four-tier ELOC counters into `.refactor-trajectory`. */
    recordTrajectory?: boolean;
    /** Fast/slice mode skipping Git history mining, full LCOV scan, and weight backprop. */
    fastMode?: boolean;
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

interface WarmScanDiffOptions extends LazyWarmScanOptions {
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

interface DaemonClientModuleExports {
    tryWarmScan: (
        params: WarmScanParams,
    ) => Promise<{ report: ScanReport; stats: WarmStats } | null>;
    tryWarmScanDiff: (
        params: DiffWarmScanParams,
    ) => Promise<{ report: ScanReport | DiffDeltaReport; stats: DiffStats } | null>;
}

interface DaemonCmdModuleExports {
    ensureDaemon: (root: string) => Promise<boolean>;
}

/** Dynamic module loader bypassing direct require call syntax in ESM module. */
function loadDaemonModule<T>(modulePath: string): T {
    const dynamicRequire = (mod: string): T =>
        (module as unknown as { require: (moduleId: string) => T })['require'](mod);
    return dynamicRequire(modulePath);
}

interface WarmScanParams {
    readonly root: string;
    readonly config: ScanConfig;
    readonly options: LazyWarmScanOptions;
    readonly logger?: Logger;
}

/** Lazy daemon-client access (keeps the default scan() module graph daemon-free). */
function runLazyWarmScan(
    root: string,
    config: ScanConfig,
    options: LazyWarmScanOptions,
    logger?: Logger,
): Promise<{ report: ScanReport; stats: WarmStats } | null> {
    const { tryWarmScan } = loadDaemonModule<DaemonClientModuleExports>(MODULE_DAEMON_CLIENT);
    return tryWarmScan({ root, config, options, logger });
}

/** Lazy daemon auto-start access (only used by daemon:'on'). */
function runLazyEnsureDaemon(root: string): Promise<boolean> {
    const { ensureDaemon } = loadDaemonModule<DaemonCmdModuleExports>(MODULE_CLI_DAEMON_CMD);
    return ensureDaemon(root);
}

/** Parameter encapsulation for lazy diff-daemon warm scans (SIM-ARGS-001). */
interface DiffWarmScanParams {
    root: string;
    config: ScanConfig;
    diffs: DiffInput[];
    options: WarmScanDiffOptions;
    logger?: Logger;
}

/** Lazy diff-daemon access (keeps the default scan() module graph daemon-free). */
function runLazyWarmScanDiff(
    params: DiffWarmScanParams,
): Promise<{ report: ScanReport | DiffDeltaReport; stats: DiffStats } | null> {
    const { tryWarmScanDiff } = loadDaemonModule<DaemonClientModuleExports>(MODULE_DAEMON_CLIENT);
    return tryWarmScanDiff(params);
}

function resolvePostScanScope(
    options: ScanOptions,
): typeof POST_SCAN_SCOPE_FULL | typeof POST_SCAN_SCOPE_INCREMENTAL {
    return options.diff || options.fastMode ? POST_SCAN_SCOPE_INCREMENTAL : POST_SCAN_SCOPE_FULL;
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
        throw new Error(MSG_SCAN_ABORTED);
    }
    const config = resolveConfig(options);
    const logger = new Logger(config.logLevel, config.logFile);
    try {
        const scanner = new Scanner(config, logger);

        let report!: ScanReport;
        // A warm/daemon report originates in another process, so this process's `scanner` holds an
        // empty graph: leave `reportScanner` null and let the post-scan pipeline rebuild it. A
        // cold/cache pass fills it in so the cycle pass can reuse the graph already built.
        let reportScanner: Scanner | null = null;
        const runColdPass = async (): Promise<void> => {
            if (options.cache) {
                const cache = new CacheStore(options.cacheDir, config.root, { logger });
                const cachedScan = await scanner.scanWithCache({
                    cache,
                    cacheCustom: options.cacheCustom,
                });
                report = cachedScan.report;
            } else {
                report = await scanner.scan();
            }
            reportScanner = scanner;
        };

        if (options.warm && options.daemon !== DAEMON_MODE_OFF) {
            const mode = options.daemon || DAEMON_MODE_AUTO;
            if (mode === DAEMON_MODE_ON) await runLazyEnsureDaemon(config.root);
            const warm = await runLazyWarmScan(
                config.root,
                config,
                buildWarmOptions(options, false),
                logger,
            );
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
        await finalizeReport(
            report,
            config,
            options,
            logger,
            reportScanner,
            resolvePostScanScope(options),
        );
        return report;
    } finally {
        logger.close();
    }
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

    try {
        if (mode !== DAEMON_MODE_OFF) {
            if (mode === DAEMON_MODE_ON) await runLazyEnsureDaemon(config.root);
            const warm = await runLazyWarmScan(
                config.root,
                config,
                buildWarmOptions(options, true),
                logger,
            );
            if (warm) {
                // Daemon reports arrive unfinalized (the daemon runs the raw scanner), so apply the
                // same post-scan pipeline here with no in-process graph to reuse.
                await finalizeReport(
                    warm.report,
                    config,
                    options,
                    logger,
                    null,
                    resolvePostScanScope(options),
                );
                return warm;
            }
        }

        // ---- degrade to cold ----
        const scanner = new Scanner(config, logger);
        const postScanScope = resolvePostScanScope(options);
        if (options.cache !== false) {
            const cache = new CacheStore(options.cacheDir, config.root, { logger });
            const cachedScan = await scanner.scanWithCache({
                cache,
                cacheCustom: options.cacheCustom,
            });
            await finalizeReport(
                cachedScan.report,
                config,
                options,
                logger,
                scanner,
                postScanScope,
            );
            return cachedScan;
        }
        const report = await scanner.scan();
        await finalizeReport(report, config, options, logger, scanner, postScanScope);
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
    } finally {
        logger.close();
    }
}

/** Decode any Buffer content fields in DiffInput[] to UTF-16 strings (JSON-safe for daemon). */
function decodeDiffs(diffs: DiffInput[]): DiffInput[] {
    return diffs.map((diffItem) => {
        if (diffItem.kind === DIFF_INPUT_KIND_FULL) {
            return {
                ...diffItem,
                oldContent: decodeContent(diffItem.oldContent as unknown as string | Buffer),
                newContent: decodeContent(diffItem.newContent as unknown as string | Buffer),
            };
        }
        return {
            ...diffItem,
            newContent: decodeContent(diffItem.newContent as unknown as string | Buffer),
            oldContent:
                diffItem.oldContent !== undefined
                    ? decodeContent(diffItem.oldContent as unknown as string | Buffer)
                    : undefined,
        };
    });
}

interface InProcessDiffContext {
    readonly config: ScanConfig;
    readonly norm: DiffInput[];
    readonly options: ScanDiffOptions;
    readonly delta: boolean;
    readonly logger: Logger;
}

async function runInProcessDiff(
    context: InProcessDiffContext,
): Promise<{ report: ScanReport | DiffDeltaReport; stats: DiffStats }> {
    const { config, norm, options, delta, logger } = context;
    const scanner = new Scanner(config, logger);
    const cache =
        options.cache === false
            ? new CacheStore(undefined, config.root, { disabled: true })
            : new CacheStore(options.cacheDir, config.root, { logger });
    const diffHintsByPath = new Map<string, DiffInput>(
        norm.map((diffInput) => [diffInput.filePath, diffInput]),
    );
    const baseDiffOpts = {
        cache,
        cacheCustom: options.cacheCustom,
        diffHints: diffHintsByPath,
        verifyDiskContent: options.verifyDiskContent !== false,
    };
    const diffScanResult = delta
        ? await scanner.scanWithDiff({ ...baseDiffOpts, deltaOnly: true })
        : await scanner.scanWithDiff({ ...baseDiffOpts, deltaOnly: false });
    await finalizeReport(
        diffScanResult.report as ScanReport,
        config,
        options as ScanOptions,
        logger,
        scanner,
        POST_SCAN_SCOPE_INCREMENTAL,
    );
    return { report: diffScanResult.report, stats: diffScanResult.stats };
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

    try {
        const mode = options.daemon || DAEMON_MODE_AUTO;
        if (mode !== DAEMON_MODE_OFF) {
            if (mode === DAEMON_MODE_ON) await runLazyEnsureDaemon(config.root);
            const warm = await runLazyWarmScanDiff({
                root: config.root,
                config,
                diffs: norm,
                options: {
                    cache: options.cache !== false,
                    cacheDir: options.cacheDir,
                    cacheCustom: options.cacheCustom,
                    workers: options.workers,
                    parser: options.parser,
                    verifyDiskContent: options.verifyDiskContent !== false,
                    delta,
                },
                logger,
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
                return warm;
            }
        }

        return await runInProcessDiff({ config, norm, options, delta, logger });
    } finally {
        logger.close();
    }
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
    const diffOutcome = await runDiff(diffs, options, false);
    return { report: diffOutcome.report as ScanReport, stats: diffOutcome.stats };
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
    const deltaOutcome = await runDiff(diffs, options, true);
    return { report: deltaOutcome.report as DiffDeltaReport, stats: deltaOutcome.stats };
}

async function executeStandardScanMode(
    config: ScanConfig,
    options: ScanOptions,
    logger: Logger,
    mode: string,
): Promise<{ report: ScanReport; stats: WarmStats | null; scanner: Scanner | null }> {
    if (mode !== DAEMON_MODE_OFF) {
        if (mode === DAEMON_MODE_ON) await runLazyEnsureDaemon(config.root);
        const warm = await runLazyWarmScan(config.root, config, {
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
        const cachedScan = await scanner.scanWithCache({ cache, cacheCustom: options.cacheCustom });
        return { report: cachedScan.report, stats: cachedScan.stats, scanner };
    }
    const report = await scanner.scan();
    return { report, stats: null, scanner };
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
    const config = resolveConfig(options);
    const logger = new Logger(config.logLevel, config.logFile);
    try {
        const mode = options.daemon || DAEMON_MODE_OFF;

        if (options.showProfile && config.profile) {
            printProjectStackProfile(config.profile, config.scaleGrade);
        }

        const scanResult = options.diff
            ? await executeDiffScanMode(config, logger)
            : await executeStandardScanMode(config, options, logger, mode);

        const { report, stats, scanner } = scanResult;
        logWarmStats(logger, stats);

        const scope = resolvePostScanScope(options);
        await finalizeReport(report, config, options, logger, scanner, scope);

        if (options.recordTrajectory) {
            await persistCliScanTrajectory(report, config, logger);
        }

        await writeRenderedReport(report, config, logger);

        if (options.showScore && report.qualityScore) {
            printQualityScoreAssessment(
                report.qualityScore,
                report.triPlaneQuality,
                config.reviewProfile,
            );
            // The report already carries the autonomy assessment (reportBuilder computes it
            // alongside the quality score), so `--score` printed the quality side and silently
            // dropped the CAI side even though both were requested by the same flag.
            if (report.autonomy) {
                printAutonomyAssessment(report.autonomy);
            }
        }
        return evaluateGateExitCode(report, config);
    } catch (error) {
        return handleScanError(error);
    } finally {
        logger.close();
    }
}

export { finalizeReport, computeSummary, groupCounts } from './core/reporting/reportFinalizer';

export { resolveConfig, Scanner, Logger, AutoRefactorError, render, CacheStore };
export { scanDiffStream } from './core/stream';
export { CircularDiffBuffer } from './core/praxis/circular-diff-buffer';
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
    extractLinesOf,
    countChangedLines,
    getLine,
    countLines,
} from './core/diff/edit-diff';
export { ModuleDependencyGraph, runCyclePass, findImportCycles } from './core/dependency-graph';
export { GovernanceAnalyzer } from './analyzers/governance';
export { ArchitectureAnalyzer } from './analyzers/architecture';
export { PerformanceAnalyzer } from './analyzers/performance';
export { CommentAnalyzer } from './analyzers/comments';
export { HygieneAnalyzer } from './analyzers/hygiene';
export { ConcurrencyAnalyzer } from './analyzers/concurrency';
export { SecurityAnalyzer } from './analyzers/security';
export { DataArchitectureAnalyzer } from './analyzers/data-architecture';
export { TestModernityAnalyzer } from './analyzers/test-modernity';
export { DependencyLayoutAnalyzer } from './analyzers/dependency-layout';
export { GateArchitectureAnalyzer } from './analyzers/gate-architecture';
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
export * from './core/ast/swar';
export * from './core/praxis';
export * from './core/types';
export * from './core/memory/types';
export * from './core/memory/reviewMemory';
export * from './core/memory/domainFingerprint';
export * from './core/memory/semanticMatcher';
export * from './core/scoring/scoringTypes';
export * from './core/scoring/qualityScorer';
export * from './core/scoring/autonomy-scorer';
export * from './core/intelligence/dependency-provenance';
export { printAutonomyAssessment } from './core/reporting/quality-printer';
export * from './core/trajectory/types';
export * from './core/trajectory/changeTrajectory';
export * from './core/trajectory/anomalyDetector';
export * from './core/guidance/agentConstraintGenerator';
export * from './core/router/diffClassifier';
export * from './core/router/sparseRuleRouter';
export * from './core/constants/analyzer-bitmask';
export * from './core/profiler/loadGovernor';
export * from './core/pipeline/escalationChannel';
export * from './core/pipeline/dualTrackPipeline';
export * from './core/pipeline/bidirectional-scheduler';
export * from './core/pipeline';
export * from './core/rules/registry';
export * from './core/rules/overlap-clusters';
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
// ---- Quality Quantification & Scoring Engine ----
export * from './core/scoring';
export * from './core/math';
export * from './core/algorithms';
export * from './core/data-structures/lru-cache';
export * from './core/data-structures/ring-buffer';
export * from './core/data-structures/id-interner';

// ---- Dynamic Analysis Plane Telemetry & Profiling ----
export * from './core/dynamic';

// ---- Audit Snapshot & Sandbox Baseline Extensions ----
export * from './core/snapshot/snapshotManager';

// ---- Unified Semantic IR & Topology Graph ----
export * from './core/semantic/types';
export * from './core/semantic/semanticGraph';
export * from './core/semantic/adapters';

// ---- Universal Rule Pyramid & Hierarchy ----
export * from './core/rules/universal-hierarchy';

// ---- Standard Terminology SSOT & Dual-Faced Architecture ----
export * from './core/governance/standard-terminology';
export { toAgentReview, toCapp, toPraxisPresentation } from './core/reporters';

// ---- Agent Audit Schema (AAS v1.0) & Token-Frugal Reporting ----
export * from './core/reporting/aas-types';
export { buildAasReport, toAasJson } from './core/reporting/aas-reporter';

// ---- Praxis Diff Governance Subsystem Facade & SPI ----
export {
    IncrementalDiffStream,
    gridRow,
    computeGridRowSpan,
} from './core/diff/incremental-diff-stream';
export type { IncrementalSliceResult } from './core/diff/incremental-diff-stream';

// ---- Unified AST Visitor Dispatcher & Traversal Core ----
export { UnifiedAstVisitor } from './core/ast/unified-ast-visitor';
export type { AstNodeListener } from './core/ast/unified-ast-visitor';
export * from './core/ast/swa-bounded-replay';
export * from './core/ast/sparse-reference-replay';
export * from './core/ast/sparse-ast-hopper';
export * from './core/intelligence/sliding-symbol-stream';
export * from './core/intelligence/sparse-reference-resolver';
export * from './core/ast/ast-prefix-radix-cache';

// ---- Semantic Architecture Graph & Meta-Architecture Rules ----
export * from './core/architecture';

// ---- Change Trajectory & Multi-Agent Coordination ----
export * from './core/trajectory';

// ---- Fine-Grained AST Slice & Sparse MoE Router ----
export * from './core/experts';
export * from './core/router/sliceTypes';
export * from './core/router/sliceExtractor';
export * from './core/router/sparseMoEGate';
export * from './core/router/adaptive-bias-router';
export * from './core/intelligence/callChainImpactTracer';

// ---- Compact Agent Prompt Protocol (CAPP) & Localized Slice Audit ----
export * from './core/guidance/agentConstraintGenerator';

// ---- Scale-Adaptive Sparse Review Scheduler & Elastic Code Density ----
export {
    type FileCategory,
    normalizePathForClassification,
    isFixtureOrMockPath,
    isBenchmarkPath,
    isScriptOrGatePath,
    isDocumentationPath,
    isGeneratedOrDistPath,
    isExemptFromArchitectureRules,
    classifyFilePath,
    PathClassifier,
} from './core/path';
export * from './core/intelligence/code-density-analyzer';
export * from './core/intelligence/file-role-inference';
export * from './core/intelligence/elastic-budget-matrix';
export * from './core/intelligence/elastic-debt-budget';
export * from './core/intelligence/bumpy-road-analyzer';
export * from './core/intelligence/main-sequence-evaluator';
export * from './core/intelligence/compression-distance';
export * from './core/intelligence/cohesion-modularity-evaluator';
export * from './core/scheduler';

// ---- Comment Governance & Effective Comment Density (ECD-C) ----
export * from './core/comments';

// ---- Native Acceleration Core & Algorithmic Dual-Track Bridge ----
export * from './core/native';
export * from './core/reporting/quality-printer';
export * from './core/reporting/audit-receipt';
export * from './core/reporting/agent-audit-pipeline';
export * from './core/protocol/auto-refactor-recipe';

// ---- Code Evolution Quality Model & Git History Mining ----
export * from './core/evolution';

// ---- Coverage Telemetry Ingestion & Dynamic Feedback ----
export * from './core/telemetry';

// ---- DeepInfer Disaggregated Serving & Worker Pool Management ----
export { handleAsymmetricScan, handleSliceAudit, createDaemonContext } from './daemon/scanHandler';
export { WorkerPoolManager } from './core/scheduler/worker-pool-manager';

export * from './core/review/review-contracts';
export * from './core/review/review-execution';
export { captureSourceSnapshot } from './core/review/source-snapshot';
export type {
    SourceSnapshot,
    SourceSnapshotIdentity,
    SnapshotBudget,
    SnapshotCaptureEntry,
    SnapshotRead,
    SnapshotGitObject,
} from './core/review/source-snapshot';
export type { SnapshotScanResult, SnapshotInputObservation } from './core/review/snapshot-scanner';
export { executeReview } from './core/review/review-executor';
export type {
    ReviewRequest,
    ReviewRuntime,
    ReviewChange,
    SnapshotReviewResult,
} from './core/review/review-executor';
export type {
    SemanticGraphSnapshot,
    SemanticGraphCoverage,
    SemanticFileImpact,
} from './core/review/semantic-snapshot';
export type { ReviewConfigurationIdentity } from './core/review/review-configuration';
export type {
    FileAnalysisRequirement,
    FileAnalysisCoverage,
} from './core/review/execution-coverage';
export type {
    FileExecutionObservation,
    AnalyzerExecutionObservation,
    ParserExecutionObservation,
} from './core/review/analyzer-execution';
export type {
    SemanticAdapterCapabilities,
    SemanticExtractionKind,
} from './core/semantic/adapters/base';
