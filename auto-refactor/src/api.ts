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
import * as path from 'path';
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
    SuppressionRule,
    CommentLevel,
    SecurityLevel,
    UnsupportedLanguageSeverity,
    MaturityTier,
} from './core/types';
import { resolveConfig } from './core/config';
import type {
    SymbolDefinition,
    SymbolReference,
    SymbolIndexStats,
} from './core/intelligence/symbolIndex';
import { Scanner, summarizeUncertainty } from './core/analyzer';
import { CacheStore } from './core/cache';
import { render } from './core/reporters';
import { Logger, AutoRefactorError } from './core/logger';
import { decodeContent } from './core/utf8';
import { globToRegExp } from './core/fileDiscovery';
import { runCyclePass } from './core/dependencyGraph';
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

/**
 * Baseline ratchet granularity that compares per-(analyzer|rule|file) counts instead of exact
 * issue ids, so line-number drift never surfaces as a new finding.
 */
const BASELINE_GRANULARITY_GROUPED = 'grouped';

/** Diff input kind whose record carries both the old and the new file content. */
const DIFF_INPUT_KIND_FULL = 'full';

/** Post-scan scope that sees the complete module set, so cross-file passes are allowed. */
const POST_SCAN_SCOPE_FULL = 'full';

/** Post-scan scope limited to a changed-file subset, so cross-file passes are skipped. */
const POST_SCAN_SCOPE_INCREMENTAL = 'incremental';

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

/** Lazy daemon-client access (keeps the default scan() module graph daemon-free). */
function lazyTryWarmScan(
    root: string,
    config: ScanConfig,
    options: {
        cache: boolean;
        cacheDir?: string;
        cacheCustom?: boolean;
        workers?: number;
        parser?: string;
    },
): Promise<{ report: ScanReport; stats: WarmStats } | null> {
    const { tryWarmScan } = require('./daemon/client');
    return tryWarmScan(root, config, options);
}

/** Lazy daemon auto-start access (only used by daemon:'on'). */
function lazyEnsureDaemon(root: string): Promise<boolean> {
    const { ensureDaemon } = require('./cli/daemonCmd');
    return ensureDaemon(root);
}

/** Lazy diff-daemon access (keeps the default scan() module graph daemon-free). */
function lazyTryWarmScanDiff(
    root: string,
    config: ScanConfig,
    diffs: DiffInput[],
    options: {
        cache: boolean;
        cacheDir?: string;
        cacheCustom?: boolean;
        workers?: number;
        parser?: string;
        verifyDiskContent: boolean;
        delta: boolean;
    },
): Promise<{ report: ScanReport | DiffDeltaReport; stats: DiffStats } | null> {
    const { tryWarmScanDiff } = require('./daemon/client');
    return tryWarmScanDiff(root, config, diffs, options);
}

/**
 * Programmatic entry point. Use from a Node script:
 *
 *   const { scan } = require('auto-refactor');
 *   const report = await scan({ root: './src', format: 'json' });
 *   if (report.summary.bySeverity.error > 0) process.exit(1);
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
        const warm = await lazyTryWarmScan(config.root, config, {
            cache: options.cache === true,
            cacheDir: options.cacheDir,
            cacheCustom: options.cacheCustom,
            workers: options.workers,
            parser: options.parser,
        });
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
        const warm = await lazyTryWarmScan(config.root, config, {
            cache: options.cache !== false,
            cacheDir: options.cacheDir,
            cacheCustom: options.cacheCustom,
            workers: options.workers,
            parser: options.parser,
        });
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
    const r = await scanner.scanWithDiff({
        cache,
        cacheCustom: options.cacheCustom,
        diffHints,
        verifyDiskContent: options.verifyDiskContent !== false,
        deltaOnly: delta,
    } as any);
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
 * Convenience wrapper that scans AND renders. Returns the process exit code:
 *   0 = ok (or only info/warning when failOnIssue is false)
 *   1 = error-level issues found (and failOnIssue true)
 *   2 = configuration / runtime error before scan completed
 * Used by the CLI; scripts may also call it to reuse exit semantics.
 *
 * The CLI passes `daemon: 'auto'|'on'` (probe existing / auto-start) and `cache: true`
 * by default; library callers keep the conservative defaults (no daemon, no cache).
 *
 * @param options - Scan/render overrides; writes to stdout unless `out` is set.
 * @returns Exit code after awaiting scan, finalization, and render; this async wrapper never
 *          rejects because failures are mapped to 2.
 */
export async function scanAndRender(options: ScanOptions = {}): Promise<number> {
    try {
        const config = resolveConfig(options);
        const logger = new Logger(config.logLevel, config.logFile);
        const mode = options.daemon || DAEMON_MODE_OFF;

        if (options.showProfile && config.profile) {
            process.stdout.write(`\n=== Project Stack Profile ===\n`);
            process.stdout.write(`Primary Language: ${config.profile.primaryLanguage}\n`);
            process.stdout.write(
                `Build Systems:    ${config.profile.buildSystems.join(', ') || 'none'}\n`,
            );
            process.stdout.write(
                `Frameworks:       ${config.profile.frameworks.join(', ') || 'none'}\n`,
            );
            process.stdout.write(`Scale Grade:      ${config.scaleGrade || 'standard'}\n`);
            process.stdout.write(`Is Polyglot:      ${config.profile.isPolyglot}\n`);
            if (config.profile.partitions.length > 0) {
                process.stdout.write(
                    `Partitions:       ${config.profile.partitions.map((p) => p.name).join(', ')}\n`,
                );
            }
            process.stdout.write(`=============================\n\n`);
        }

        let report: ScanReport | null = null;
        let stats: WarmStats | null = null;
        let reportScanner: Scanner | null = null;

        // ---- Dynamic diff mode (diff scan) ----
        if (options.diff) {
            const changedFiles: string[] = [];
            try {
                const cp = require('child_process');
                const { promisify } = require('util');
                const execFileAsync = promisify(cp.execFile);
                const { stdout: out } = await execFileAsync('git', ['status', '--porcelain'], {
                    cwd: config.root,
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
                // Ignore: git unavailable, not a repository, or execution error — the
                // changed set degrades to empty and the full scan stays the fallback.
            }

            if (changedFiles.length === 0) {
                report = {
                    tool: 'auto-refactor',
                    version: '0.3.0',
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
            } else {
                // Changed-set mode scans exactly the changed files. Matching by basename would
                // also pull in same-named files elsewhere in the tree, so the include list holds
                // the precise repository-relative paths (deduplicated and sorted for determinism).
                const include = [...new Set(changedFiles)].sort();
                const scanner = new Scanner({ ...config, include }, logger);
                report = await scanner.scan();
                reportScanner = scanner;
            }
        }

        if (!report && mode !== DAEMON_MODE_OFF) {
            if (mode === DAEMON_MODE_ON) await lazyEnsureDaemon(config.root);
            const warm = await lazyTryWarmScan(config.root, config, {
                cache: options.cache === true,
                cacheDir: options.cacheDir,
                cacheCustom: options.cacheCustom,
                workers: options.workers,
                parser: options.parser,
            });
            if (warm) {
                report = warm.report;
                stats = warm.stats;
            }
        }

        if (!report) {
            const scanner = new Scanner(config, logger);
            reportScanner = scanner;
            if (options.cache) {
                const cache = new CacheStore(options.cacheDir, config.root);
                const r = await scanner.scanWithCache({ cache, cacheCustom: options.cacheCustom });
                report = r.report;
                stats = r.stats;
            } else {
                report = await scanner.scan();
            }
        }

        if (stats) {
            logger.info(
                `warm: daemonUsed=${stats.daemonUsed} cacheHit=${stats.cacheHit}/${stats.cacheTotal} ` +
                    `l1=${stats.l1Hit} l2=${stats.l2Hit} analyzed=${stats.analyzed} poolWarm=${stats.poolWarm} daemonMs=${stats.daemonMs}`,
            );
        }

        // ---- Post-scan pipeline (suppressions / dependency graph / baseline): part of
        // scan(), shared by every caller ----
        await finalizeReport(
            report,
            config,
            options,
            logger,
            reportScanner,
            options.diff ? POST_SCAN_SCOPE_INCREMENTAL : POST_SCAN_SCOPE_FULL,
        );

        const text = render(report, config.format);
        if (config.out) {
            await fs.promises.writeFile(config.out, text + '\n', 'utf8');
            logger.info(`report written to ${config.out}`);
        } else {
            process.stdout.write(text + '\n');
        }

        if (options.showScore && (report as any).qualityScore) {
            const q = (report as any).qualityScore;
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
        logger.close();
        // Blocking is decided from finalizeReport's annotations: with a baseline only new
        // (isNew) issues count; without one, every issue counts.
        const ratchetUsed = (report.summary as any).ratchetBaselineUsed === true;
        const blockingPool: Issue[] = ratchetUsed
            ? report.issues.filter((i) => (i as any).isNew === true)
            : report.issues;
        const rank = { info: 0, warning: 1, error: 2 } as const;
        if (config.failOnIssue && blockingPool.some((i) => i.severity === 'error')) return 1;
        if (config.failOnSeverity) {
            const threshold = rank[config.failOnSeverity];
            if (blockingPool.some((i) => rank[i.severity] >= threshold)) return 1;
        }
        return 0;
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const code = e instanceof AutoRefactorError ? e.code : 'SCAN_FAILED';
        process.stderr.write(`[auto-refactor] ERROR (${code}): ${msg}\n`);
        return 2;
    }
}

/**
 * Post-scan pipeline (part of scan(), not CLI-specific):
 *   config self-check -> reasoned suppressions -> dependency-graph global pass
 *   (import cycles / unused exports) -> baseline ratchet annotation.
 * Programmatic scan() callers and the CLI get exactly the same processing.
 * Annotations: issue.isNew (ratchet-new), issue.suppression (suppression trail),
 *   summary.suppressedCount / warnings / ratchetBaselineUsed / disabledAnalyzers.
 */
/**
 * Marks a report that already went through the post-scan pipeline. A symbol (rather than a
 * string key) keeps the marker non-enumerable for JSON.stringify, so report bytes never change;
 * the flag makes the pipeline idempotent, because the cycle pass appends issues and would
 * duplicate them if a report were ever finalized twice.
 */
/** Post-scan scope: a full scan may use cross-file facts; an incremental one may not. */
type PostScanScope = typeof POST_SCAN_SCOPE_FULL | typeof POST_SCAN_SCOPE_INCREMENTAL;

const FINALIZED = Symbol('auto-refactor:finalized');

async function finalizeReport(
    report: ScanReport,
    config: ScanConfig,
    options: ScanOptions,
    logger: Logger,
    reportScanner: Scanner | null,
    scope: PostScanScope = POST_SCAN_SCOPE_FULL,
): Promise<void> {
    if ((report as unknown as Record<symbol, boolean>)[FINALIZED]) return;
    (report as unknown as Record<symbol, boolean>)[FINALIZED] = true;
    const postScanPasses: string[] = [];

    // ---- Config self-check (detect silently ineffective globs) ----
    // The scanner already recorded analyzer-coverage notes (disabled packs); keep them and add
    // the finalize-stage checks on top instead of overwriting either side.
    const warnings: string[] = [...(report.summary.warnings ?? [])];
    if (report.summary.filesScanned === 0) {
        warnings.push(
            'include globs matched 0 files — declared analyzers cannot fire; check include/exclude and the scanned root',
        );
    }

    // ---- Dependency-graph global checks: import cycles + unused exports (post-scan,
    // gated by analyzer options). Cross-file facts need the complete module set, so an
    // incremental scan (changed-file subset) must not run them — a partial graph would
    // report phantom cycles and miss real ones. ----
    const dgDecl =
        scope === POST_SCAN_SCOPE_FULL ? config.analyzers['dependency-graph'] : undefined;
    if (scope !== POST_SCAN_SCOPE_FULL) {
        warnings.push(
            'incremental scope: cross-file passes (import cycles / unused exports) are skipped — run a full scan for those signals',
        );
    }
    if (dgDecl?.enabled) {
        postScanPasses.push('dependency-graph');
        const prebuilt = reportScanner ? reportScanner.getDependencyGraph() : null;
        const covered =
            prebuilt !== null && prebuilt.getModules().length >= report.fileMetrics.length;
        const cycle = await runCyclePass(report, config, logger, covered ? prebuilt : null);
        // Warn only when a prebuilt graph exists but is incomplete: partial seeding makes
        // the reread genuinely informative. A pure cache-hit path (prebuilt === null)
        // always rereads, which is expected, so it should not add warning noise.
        if (!covered && prebuilt !== null) {
            warnings.push('dependency-graph: 扫描图覆盖不全（缓存命中路径），回退重读建图');
        }
        report.issues.push(...cycle.issues);
        warnings.push(...cycle.warnings);
        recomputeSummary(report);
        if (cycle.issues.length > 0) {
            logger.info(`dependency-graph: ${cycle.issues.length} import-cycle issue(s)`);
        }
    }

    // ---- Cross-file literal clusters (post-scan, opt-in): the shared literal store already
    // holds every literal site, so this answers "is this value shared, and does it mean one
    // thing?" without re-reading a single file. Cross-file facts need the complete file set.
    const litDecl = scope === POST_SCAN_SCOPE_FULL ? config.analyzers['constants'] : undefined;
    const litOpts = litDecl?.options as Record<string, unknown> | undefined;
    if (litDecl?.enabled && litOpts?.['crossFileLiteralClusters'] === true) {
        postScanPasses.push('literal-clusters');
        if (reportScanner === null) {
            warnings.push(
                'literal-clusters: 缓存命中路径没有共享字面量索引，跳过（请执行完整扫描）',
            );
        } else {
            const clusterIssues = reportScanner.getLiteralClusterIssues();
            report.issues.push(...clusterIssues);
            recomputeSummary(report);
            if (clusterIssues.length > 0) {
                logger.info(
                    `literal-clusters: ${clusterIssues.length} cross-file literal cluster issue(s)`,
                );
            }
        }
    }

    // ---- Error propagation chains (post-scan, opt-in): combines the shared literal store
    // (error-code literals) with the call graph (upward caller chains) to locate codes that are
    // duplicated across raisers or that propagate far up the call tree without handling.
    const errorDecl = scope === POST_SCAN_SCOPE_FULL ? config.analyzers['hygiene'] : undefined;
    const errorOpts = errorDecl?.options as Record<string, unknown> | undefined;
    if (errorDecl?.enabled && errorOpts?.['errorPropagation'] === true) {
        postScanPasses.push('error-flow');
        if (reportScanner === null) {
            warnings.push('error-flow: 缓存命中路径没有共享调用图索引，跳过（请执行完整扫描）');
        } else {
            const errorIssues = reportScanner.getErrorFlowIssues(errorOpts);
            report.issues.push(...errorIssues);
            recomputeSummary(report);
            if (errorIssues.length > 0) {
                logger.info(`error-flow: ${errorIssues.length} error propagation chain issue(s)`);
            }
        }
    }

    // ---- Reasoned suppressions (post-scan, after the dependency-graph pass so cycle and
    // unused findings are suppressible too; pre-baseline so the ratchet sees final severities) ----
    // ---- Reasoned suppressions (post-scan, pre-baseline; hits are recorded, never silent) ----
    // Pre-index candidates by matchAnalyzer plus a general bucket for unqualified rules,
    // so each issue scans only its matching bucket instead of every suppression (O(N x S)).
    const suppressions: SuppressionRule[] = config.suppressions ?? [];
    let suppressedCount = 0;
    postScanPasses.push('suppressions');
    if (suppressions.length > 0) {
        const byAnalyzer = new Map<string, SuppressionRule[]>();
        const general: SuppressionRule[] = [];
        const orderIdx = new Map<SuppressionRule, number>();
        // `matchFile` accepts an exact path or a glob (`scripts/**`, `app/cli/*.py`); compile each
        // pattern once instead of rebuilding a regex per issue.
        const fileMatchers = new Map<SuppressionRule, RegExp>();
        suppressions.forEach((s, i) => {
            orderIdx.set(s, i);
            if (s.matchFile) {
                fileMatchers.set(s, globToRegExp(s.matchFile.replace(/\\/g, '/')));
            }
            if (s.matchAnalyzer) {
                const bucket = byAnalyzer.get(s.matchAnalyzer) ?? [];
                bucket.push(s);
                byAnalyzer.set(s.matchAnalyzer, bucket);
            } else {
                general.push(s);
            }
        });
        // Order-preserving merge: candidates follow the original config array order,
        // exactly matching the old suppressions.find() semantics. An analyzer-specific
        // bucket must not always precede the general bucket, or a hit's downgradeTo could
        // flip and change the gate exit code. Each analyzer's merged list is therefore
        // built once during preprocessing: rebuilding and sorting it per issue was
        // O(S log S) and could end up slower than the old linear find as suppressions grew.
        const analyzerCandidates = new Map<string, SuppressionRule[]>();
        for (const analyzer of byAnalyzer.keys()) {
            analyzerCandidates.set(
                analyzer,
                [...(byAnalyzer.get(analyzer) ?? []), ...general].sort(
                    (a, b) => (orderIdx.get(a) ?? 0) - (orderIdx.get(b) ?? 0),
                ),
            );
        }
        const generalOnly = [...general].sort(
            (a, b) => (orderIdx.get(a) ?? 0) - (orderIdx.get(b) ?? 0),
        );
        for (const issue of report.issues) {
            const symbol =
                typeof issue.detail?.function === 'string'
                    ? issue.detail.function
                    : typeof issue.detail?.name === 'string'
                      ? issue.detail.name
                      : '';
            const hit = (analyzerCandidates.get(issue.analyzer) ?? generalOnly).find(
                (s) =>
                    (!s.matchFile ||
                        fileMatchers.get(s)!.test(issue.location.file.replace(/\\/g, '/'))) &&
                    (!s.matchRule || issue.rule === s.matchRule) &&
                    (!s.matchSymbol ||
                        symbol === s.matchSymbol ||
                        symbol.endsWith('.' + s.matchSymbol)),
            );
            if (hit) {
                suppressedCount++;
                (issue as any).suppression = { reason: hit.reason, downgraded: !!hit.downgradeTo };
                if (hit.downgradeTo) issue.severity = hit.downgradeTo;
            }
        }
        recomputeSummary(report);
    }
    (report.summary as any).suppressedCount = suppressedCount;
    report.summary.postScanPasses = postScanPasses;
    if (warnings.length > 0) (report.summary as any).warnings = warnings;

    // ---- Baseline update and comparison (ratchet) ----
    const granularity = options.baselineGranularity || config.baselineGranularity || 'id';
    if (options.updateBaseline || (options.baseline && fs.existsSync(options.baseline))) {
        postScanPasses.push('baseline');
    }
    if (options.updateBaseline) {
        const baselineData =
            granularity === BASELINE_GRANULARITY_GROUPED
                ? {
                      version: '1.1.0',
                      granularity,
                      timestamp: new Date().toISOString(),
                      groups: groupCounts(report.issues),
                  }
                : {
                      version: '1.0.0',
                      timestamp: new Date().toISOString(),
                      issues: report.issues.map((i) => i.id),
                  };
        await fs.promises.writeFile(
            options.updateBaseline,
            JSON.stringify(baselineData, null, 2) + '\n',
            'utf8',
        );
        logger.info(`baseline written to ${options.updateBaseline} (granularity=${granularity})`);
    }

    if (options.baseline && fs.existsSync(options.baseline)) {
        try {
            const raw = await fs.promises.readFile(options.baseline, 'utf8');
            const baselineData = JSON.parse(raw);
            let newIssues: Issue[];
            if (
                baselineData.granularity === BASELINE_GRANULARITY_GROUPED &&
                Array.isArray(baselineData.groups)
            ) {
                // Grouped-count comparison: immune to line-number drift; existing
                // findings may only shrink, never grow.
                const baseMap = new Map<string, number>(
                    (baselineData.groups as Array<{ key: string; count?: number }>).map((g) => [
                        g.key,
                        g.count ?? 0,
                    ]),
                );
                const consumed = new Map<string, number>();
                newIssues = report.issues.filter((i) => {
                    const k = `${i.analyzer}|${i.rule}|${i.location.file.replace(/\\/g, '/')}`;
                    const used = consumed.get(k) ?? 0;
                    consumed.set(k, used + 1);
                    return used >= (baseMap.get(k) ?? 0);
                });
            } else {
                // Exact id-set comparison (legacy format / granularity=id).
                const baselineSet = new Set<string>(baselineData.issues || []);
                newIssues = report.issues.filter((i) => !baselineSet.has(i.id));
            }
            for (const i of newIssues) (i as any).isNew = true;
            (report.summary as any).ratchetBaselineUsed = true;
            logger.info(
                `baseline ratchet(${baselineData.granularity ?? 'id'}): accepted=${
                    baselineData.granularity === BASELINE_GRANULARITY_GROUPED
                        ? (baselineData.groups || []).length
                        : (baselineData.issues || []).length
                } newIssues=${newIssues.length}`,
            );
        } catch (e) {
            logger.warn(`Failed to read baseline file: ${e}`);
        }
    }
}

// ─────────────────────────────────────────────────────────────
// Post-scan pipeline helpers (suppressions / cycles / baseline)
// ─────────────────────────────────────────────────────────────

function recomputeSummary(report: ScanReport): void {
    const by = { info: 0, warning: 0, error: 0 };
    for (const i of report.issues) by[i.severity]++;
    report.summary.bySeverity = by;
    report.summary.issuesTotal = report.issues.length;
    // Post-scan passes append findings AFTER Scanner.scan() built the summary, so every aggregate
    // derived from the issue list must be recomputed here — `uncertainty` included, or the report
    // would publish a count that describes an earlier revision of its own issue list.
    report.summary.uncertainty = summarizeUncertainty(report.issues);
}

function groupCounts(issues: Issue[]): Array<{ key: string; count: number }> {
    return [
        ...issues.reduce((m, i) => {
            const key = `${i.analyzer}|${i.rule}|${i.location.file.replace(/\\/g, '/')}`;
            m.set(key, (m.get(key) ?? 0) + 1);
            return m;
        }, new Map<string, number>()),
    ].map(([key, count]) => ({ key, count }));
}

export { resolveConfig, Scanner, Logger, AutoRefactorError, render, CacheStore };
export { scanDiffStream } from './core/stream';
export { CircularDiffBuffer } from './core/ringBuffer';
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
} from './core/editDiff';
export { ModuleDependencyGraph, runCyclePass, findImportCycles } from './core/dependencyGraph';
export { GovernanceAnalyzer } from './analyzers/governance';
export { ArchitectureAnalyzer } from './analyzers/architecture';
export { PerformanceAnalyzer } from './analyzers/performance';
export { CommentAnalyzer } from './analyzers/comments';
export { HygieneAnalyzer } from './analyzers/hygiene';
export { SecurityAnalyzer } from './analyzers/security';
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
export * as messages from './core/messages';
export * from './core/messages';

import { ReviewMemoryManager } from './core/memory/reviewMemory';
import { QualityScorer } from './core/scoring/qualityScorer';
import { ChangeTrajectoryManager } from './core/trajectory/changeTrajectory';
import type {
    AgentConstraintOptions,
    AgentConstraintPrompt,
} from './core/guidance/agentConstraintGenerator';
import { AgentConstraintGenerator } from './core/guidance/agentConstraintGenerator';
import type { QualityWeights, QualityScoreBreakdown } from './core/scoring/scoringTypes';
import type { FileChangeTrajectory } from './core/trajectory/types';
import type {
    DiffFileInput,
    DualTrackExecution,
    DualTrackOptions,
} from './core/pipeline/dualTrackPipeline';
import { executeDualTrack } from './core/pipeline/dualTrackPipeline';

/**
 * Evaluate the transparent quality score for an entire scan report using optional dimension
 * weights; omitted weights keep the scorer's defaults.
 *
 * @param report - Completed scan report whose issues and config drive the score.
 * @param weights - Optional per-dimension weight overrides merged over the defaults.
 * @returns Quality breakdown computed for the pseudo-file 'PROJECT'.
 */
export function evaluateQualityScore(
    report: ScanReport,
    weights?: Partial<QualityWeights>,
): QualityScoreBreakdown {
    const scorer = new QualityScorer(weights);
    return scorer.evaluateFile('PROJECT', report.issues, null, report.config);
}

/**
 * Open the review-memory manager for a cache directory.
 *
 * @param cacheDir - Cache root holding review-memory records; defaults to an
 *                   `.auto-refactor-cache` directory under the current working directory.
 * @returns Manager backed by the resolved cache directory.
 */
export function getReviewMemory(cacheDir?: string): ReviewMemoryManager {
    return new ReviewMemoryManager(cacheDir || resolveReviewMemoryDir());
}

/** Directory name every scan writes its review memory into, relative to the scan root. */
const REVIEW_MEMORY_DIR_NAME = '.auto-refactor-cache';

/**
 * Resolve the review-memory directory a query should read.
 *
 * A scan writes `<scanRoot>/.auto-refactor-cache`, so a query that simply used the process cwd
 * returned an empty store whenever the agent ran from a subdirectory (`guide`, `trajectory` and
 * `memory` all go through `getReviewMemory`). This walks UP from `startDir` to the first ancestor
 * that already holds a cache — the same discovery rule a tool uses for a project manifest — and
 * falls back to `startDir/.auto-refactor-cache` so a first run still creates the store in place.
 *
 * @param startDir - Directory to start from; defaults to the process cwd.
 * @returns Absolute path of the review-memory directory to read or create.
 */
export function resolveReviewMemoryDir(startDir: string = process.cwd()): string {
    const origin = path.resolve(startDir);
    let current = origin;
    for (;;) {
        const candidate = path.join(current, REVIEW_MEMORY_DIR_NAME);
        if (fs.existsSync(candidate)) return candidate;
        const parent = path.dirname(current);
        if (parent === current) return path.join(origin, REVIEW_MEMORY_DIR_NAME);
        current = parent;
    }
}

/**
 * Query the recorded change trajectory of one file from review memory.
 *
 * @param filePath - File whose revision history should be replayed in order.
 * @param cacheDir - Optional review-memory cache root; defaults to the cwd cache.
 * @returns Trajectory object, or undefined when no revision has been recorded yet.
 */
export function getChangeTrajectory(
    filePath: string,
    cacheDir?: string,
): FileChangeTrajectory | undefined {
    const memory = getReviewMemory(cacheDir);
    const revisions = memory.getRevisions(filePath);
    if (revisions.length === 0) return undefined;
    const trajManager = new ChangeTrajectoryManager();
    for (const rev of revisions) {
        trajManager.recordRevision(filePath, rev);
    }
    return trajManager.getTrajectory(filePath);
}

/**
 * Resolve a cross-file symbol against a repository.
 *
 * Runs the scanner (cold, in-process) so the symbol index is filled from the same single traversal
 * the analyzers use, then answers the definition/reference/impact questions a reviewer or agent
 * needs. No second parse happens: the index is a by-product of the scan.
 *
 * This entry point builds its own scanner and logger per call, so concurrent invocations
 * share no scan state; the returned data is a snapshot and callers must not mutate it.
 *
 * @param name - Declared or called symbol name to resolve.
 * @param options - Scan overrides; `root` selects the repository.
 * @returns The resolved definitions, every recorded call site, the cross-file subset, and the
 *   index coverage counters (including whether the tree was materialized or projected).
 * Concurrency: reentrant, idempotent and side-effect free - every call constructs its own
 *     scanner over a read-only snapshot, keeps no shared mutable state, and needs no external
 *     synchronization.
 */
export async function querySymbols(
    name: string,
    options: ScanOptions = {},
): Promise<{
    definitions: SymbolDefinition[];
    references: SymbolReference[];
    crossFileReferences: SymbolReference[];
    stats: SymbolIndexStats;
}> {
    const config = resolveConfig(options);
    const logger = new Logger(config.logLevel, config.logFile);
    const scanner = new Scanner(config, logger);
    try {
        await scanner.scan();
        const index = scanner.getSymbolIndex();
        const resolved = index.resolve(name);
        const crossFile = [
            ...new Set(
                resolved.definitions.flatMap((definition) =>
                    index.crossFileReferencesTo(name, definition.file),
                ),
            ),
        ];
        return {
            definitions: resolved.definitions,
            references: resolved.references,
            crossFileReferences: crossFile,
            stats: index.stats(),
        };
    } finally {
        logger.close();
    }
}

/**
 * Build localized engineering constraints for an agent about to modify a file, blending review
 * memory with that file's recorded change trajectory.
 *
 * @param options - Query target: file path plus optional domain, line, layer, and agent UID.
 * @param cacheDir - Optional review-memory cache root; defaults to the cwd cache.
 * @returns Rendered constraint prompt with hard rules, pitfalls, and recommended patterns.
 */
export function queryAgentConstraints(
    options: AgentConstraintOptions,
    cacheDir?: string,
): AgentConstraintPrompt {
    const memoryManager = getReviewMemory(cacheDir);
    const rec = memoryManager.getRecord(options.filePath);
    const traj = getChangeTrajectory(options.filePath, cacheDir);
    const gen = new AgentConstraintGenerator();
    return gen.generate(options, rec, traj);
}

/**
 * Asymmetric dual-track scan API.
 *
 * @experimental Not on the production path yet: no CLI subcommand, consumer runner or CI gate
 *   calls this entry point, so the sparse reviewer routing, escalation channel and deep track it
 *   drives are exercised only by `validate-asymmetric-routing.js`. Treat the returned verdict as
 *   advisory until the reviewer-activation batch (plan B5) wires it to an IDE/agent caller with
 *   old/new content inputs; the asynchronous `deepPromise` must be awaited by such a caller.
 *
 * The foreground FastTrack returns a speculative verdict, quality score, and agent guidance,
 * while the returned `deepPromise` resolves later with
 * graph impact and cycle analysis; callers must await or otherwise handle that promise.
 * This async entry point awaits only the fast track, creates its own logger per call, and
 * therefore keeps no shared scan state across concurrent invocations.
 *
 * @param inputs - Changed files with old/new content and optional changed-line hints.
 * @param options - Scan overrides plus dual-track knobs (governor, escalation, author, graph).
 * @returns Fast-track verdict plus the in-flight deep-track promise.
 * @throws Error when config resolution or the foreground fast track fails; deep-track failures
 *               surface asynchronously through the returned `deepPromise`.
 */
export async function scanAsymmetric(
    inputs: DiffFileInput[],
    options: ScanOptions & DualTrackOptions = {},
): Promise<DualTrackExecution> {
    const config = resolveConfig(options);
    const logger = new Logger(config.logLevel, config.logFile);
    const scanner = new Scanner(config, logger);
    const execution = await executeDualTrack(scanner, inputs, options);
    execution.deepPromise.finally(() => logger.close());
    return execution;
}

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
export { ImportedSymbolRef, SymbolImpactAnalysis } from './core/dependencyGraph';
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
