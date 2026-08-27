import * as fs from 'fs';
import {
  ScanConfig,
  ScanReport,
  OutputFormat,
  LogLevel,
  ParserKind,
  WarmStats,
  DiffInput,
  DiffStats,
  DiffDeltaReport,
} from './core/types';
import { resolveConfig } from './core/config';
import { Scanner } from './core/analyzer';
import { CacheStore } from './core/cache';
import { render } from './core/reporters';
import { Logger, AutoRefactorError } from './core/logger';
import { decodeContent } from './core/utf8';
// NOTE: daemon client / daemonCmd are imported LAZILY inside scanWarm/scanAndRender so the
// default scan() path (and CLI boot) never pays for the daemon module graph (net, child_process).
// This preserves the "single-run zero cost" guarantee (docs/warm-scan-design.md §A4.3).

/**
 * Options accepted by the programmatic API. A strict subset of ScanConfig — everything not
 * provided falls back to the layered defaults (built-in → config file → these overrides).
 * This is the single entry point for both CLI and script/Node consumers.
 *
 * WARM-SCAN (docs/warm-scan-design.md §A4.1): all warm options default OFF so `scan()` keeps its
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

  // ---- warm-scan (all default OFF) ----
  /** Enable the two-level incremental cache (scan() only; default false). */
  cache?: boolean;
  /** Cache directory (default `<root>/.auto-refactor-cache`). */
  cacheDir?: string;
  /** Allow L2 caching for custom analyzers by hashing module content (default false). */
  cacheCustom?: boolean;
  /** Daemon mode: 'off' (default) never connects; 'auto' probes an EXISTING daemon only;
   *  'on' auto-starts the daemon when missing (watch/CI warm-up). */
  daemon?: 'auto' | 'on' | 'off';
  /** scan(): also try an existing daemon (report-only; stats discarded). Default false. */
  warm?: boolean;
}

/** Lazy daemon-client access (keeps the default scan() module graph daemon-free). */
function lazyTryWarmScan(
  root: string,
  config: ScanConfig,
  options: { cache: boolean; cacheDir?: string; cacheCustom?: boolean; workers?: number; parser?: string },
): Promise<{ report: ScanReport; stats: WarmStats } | null> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { tryWarmScan } = require('./daemon/client');
  return tryWarmScan(root, config, options);
}

/** Lazy daemon auto-start access (only used by daemon:'on'). */
function lazyEnsureDaemon(root: string): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { ensureDaemon } = require('./cli/daemonCmd');
  return ensureDaemon(root);
}

/** Lazy diff-daemon access (keeps the default scan() module graph daemon-free). */
function lazyTryWarmScanDiff(
  root: string,
  config: ScanConfig,
  diffs: DiffInput[],
  options: { cache: boolean; cacheDir?: string; cacheCustom?: boolean; workers?: number; parser?: string; verifyDiskContent: boolean; delta: boolean },
): Promise<{ report: ScanReport | DiffDeltaReport; stats: DiffStats } | null> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
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
 * Semantics are UNCHANGED from the pre-warm-scan engine: no daemon, no cache unless the
 * caller explicitly opts in via `cache`/`warm`.
 */
export async function scan(options: ScanOptions = {}): Promise<ScanReport> {
  const config = resolveConfig(options);
  const logger = new Logger(config.logLevel, config.logFile);
  const scanner = new Scanner(config, logger);

  let report: ScanReport;
  if (options.warm && options.daemon !== 'off') {
    const mode = options.daemon || 'auto';
    if (mode === 'on') await lazyEnsureDaemon(config.root);
    const warm = await lazyTryWarmScan(config.root, config, {
      cache: options.cache === true,
      cacheDir: options.cacheDir,
      cacheCustom: options.cacheCustom,
      workers: options.workers,
      parser: options.parser,
    });
    if (warm) {
      report = warm.report;
      logger.close();
      return report;
    }
  }

  if (options.cache) {
    const cache = new CacheStore(options.cacheDir, config.root);
    const r = await scanner.scanWithCache({ cache, cacheCustom: options.cacheCustom });
    report = r.report;
  } else {
    report = await scanner.scan();
  }
  logger.close();
  return report;
}

/**
 * Explicit warm-scan session (docs/warm-scan-design.md §A4.1): attempts a daemon scan and, on ANY
 * failure, degrades to a cold scan — returning `{ report, stats: { daemonUsed: false, ... } }`.
 * The report is byte-identical between warm and cold; stats are a sibling field (never part
 * of ScanReport) so output bytes never change.
 */
export async function scanWarm(options: ScanOptions = {}): Promise<{ report: ScanReport; stats: WarmStats }> {
  const config = resolveConfig(options);
  const mode = options.daemon || 'auto';

  if (mode !== 'off') {
    if (mode === 'on') await lazyEnsureDaemon(config.root);
    const warm = await lazyTryWarmScan(config.root, config, {
      cache: options.cache !== false,
      cacheDir: options.cacheDir,
      cacheCustom: options.cacheCustom,
      workers: options.workers,
      parser: options.parser,
    });
    if (warm) return warm;
  }

  // ---- degrade to cold ----
  const logger = new Logger(config.logLevel, config.logFile);
  const scanner = new Scanner(config, logger);
  if (options.cache !== false) {
    const cache = new CacheStore(options.cacheDir, config.root);
    const r = await scanner.scanWithCache({ cache, cacheCustom: options.cacheCustom });
    logger.close();
    return r;
  }
  const report = await scanner.scan();
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

/**
 * Options for the diff-scan APIs (docs/diff-interface-spec.md §1.4). Inherits `ScanOptions`;
 * adds the disk-content verification toggle.
 */
export interface ScanDiffOptions extends ScanOptions {
  /** Verify each changed file's newContent against disk bytes (default true). */
  verifyDiskContent?: boolean;
}

/** Decode any Buffer content fields in DiffInput[] to UTF-16 strings (JSON-safe for daemon). */
function decodeDiffs(diffs: DiffInput[]): DiffInput[] {
  return diffs.map((d) => {
    if (d.kind === 'full') {
      return {
        ...d,
        oldContent: decodeContent(d.oldContent as unknown as string | Buffer),
        newContent: decodeContent(d.newContent as unknown as string | Buffer),
      };
    }
    return {
      ...d,
      newContent: decodeContent(d.newContent as unknown as string | Buffer),
      oldContent: d.oldContent !== undefined ? decodeContent(d.oldContent as unknown as string | Buffer) : undefined,
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

  const mode = options.daemon || 'auto';
  if (mode !== 'off') {
    if (mode === 'on') await lazyEnsureDaemon(config.root);
    const warm = await lazyTryWarmScanDiff(config.root, config, norm, {
      cache: options.cache !== false,
      cacheDir: options.cacheDir,
      cacheCustom: options.cacheCustom,
      workers: options.workers,
      parser: options.parser,
      verifyDiskContent: options.verifyDiskContent !== false,
      delta,
    });
    if (warm) return warm;
  }

  // ---- degrade to in-process ----
  const logger = new Logger(config.logLevel, config.logFile);
  const scanner = new Scanner(config, logger);
  const cache = options.cache === false
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
  logger.close();
  return { report: r.report, stats: r.stats };
}

/**
 * Full diff scan (docs/diff-interface-spec.md §1.4): returns a report over ALL discovered files
 * that is byte-identical to a cold rescan, using the diff inputs only to accelerate the changed
 * files. Changed files are routed byteEqual/incremental/full; unchanged files keep the L1/L2 path.
 */
export async function scanDiff(
  diffs: DiffInput[],
  options: ScanDiffOptions = {},
): Promise<{ report: ScanReport; stats: DiffStats }> {
  const r = await runDiff(diffs, options, false);
  return { report: r.report as ScanReport, stats: r.stats };
}

/**
 * Delta diff scan (docs/diff-interface-spec.md §1.5): returns only the changed-file SUBSET.
 * Its contract is `delta.report ≡ filter(scanDiff.report, changed-file set)` — every issue/metric
 * is byte-identical to the full report's corresponding entry, in the same relative order. Not
 * byte-equivalent to a cold scan by itself (it is a subset).
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
 */
export async function scanAndRender(options: ScanOptions = {}): Promise<number> {
  try {
    const config = resolveConfig(options);
    const logger = new Logger(config.logLevel, config.logFile);
    const mode = options.daemon || 'off';

    let report: ScanReport | null = null;
    let stats: WarmStats | null = null;

    if (mode !== 'off') {
      if (mode === 'on') await lazyEnsureDaemon(config.root);
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

    const text = render(report, config.format);
    if (config.out) {
      fs.writeFileSync(config.out, text + '\n', 'utf8');
      logger.info(`report written to ${config.out}`);
    } else {
      process.stdout.write(text + '\n');
    }
    logger.close();
    if (config.failOnIssue && report.summary.bySeverity.error > 0) return 1;
    return 0;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const code = e instanceof AutoRefactorError ? e.code : 'SCAN_FAILED';
    process.stderr.write(`[auto-refactor] ERROR (${code}): ${msg}\n`);
    return 2;
  }
}

export { resolveConfig, Scanner, Logger, AutoRefactorError, render, CacheStore };
export * from './core/types';
