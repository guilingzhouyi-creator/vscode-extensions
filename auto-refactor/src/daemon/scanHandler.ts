import * as path from 'path';
import { ScanConfig, ScanReport, WarmStats, DiffInput, DiffStats } from '../core/types';
import { Scanner, WorkerPoolManager, WarmSession, createWarmSession } from '../core/analyzer';
import { CacheStore } from '../core/cache';
import { Logger } from '../core/logger';

/**
 * Daemon-side warm scan (docs/01-architecture/02-pipeline-and-caching.md §B5 / Part C).
 *
 * The daemon keeps three cross-scan assets:
 *   - pools:     persistent worker pools sharded by config fingerprint (T03)
 *   - session:   per-fingerprint per-file results (L1-hit reuse → 0 reads on warm-2nd)
 *   - cache:     one CacheStore per project (loaded once, kept in memory)
 *
 * The actual L1→L2→dispatch-miss→aggregate pipeline lives in Scanner.scanWithCache (the
 * SAME aggregation code path as cold), so byte-equivalence is structural, not accidental.
 * This module is the daemon-side entry that wires the shared assets into that pipeline.
 */

export interface DaemonScanContext {
  pools: WorkerPoolManager;
  session: WarmSession;
  getCache(root: string, cacheDir?: string): CacheStore;
}

export interface DaemonScanOptions {
  cache: boolean;
  cacheDir?: string;
  cacheCustom?: boolean;
  workers?: number;
  parser?: string;
}

export async function handleScan(
  ctx: DaemonScanContext,
  config: ScanConfig,
  options: DaemonScanOptions,
): Promise<{ report: ScanReport; stats: WarmStats }> {
  const t0 = Date.now();
  const cfg = { ...config } as ScanConfig;
  if (typeof options.workers === 'number' && options.workers > 0) cfg.workers = options.workers;
  if (options.parser === 'oxc' || options.parser === 'typescript') cfg.parser = options.parser;

  const cache = options.cache
    ? ctx.getCache(cfg.root, options.cacheDir)
    : new CacheStore(undefined, cfg.root, { disabled: true });

  const logger = new Logger(cfg.logLevel || 'silent', cfg.logFile);
  const scanner = new Scanner(cfg, logger);
  const result = await scanner.scanWithCache({
    cache,
    session: ctx.session,
    pool: ctx.pools,
    cacheCustom: options.cacheCustom === true,
  });
  logger.close();

  result.stats.daemonUsed = true;
  result.stats.daemonMs = Date.now() - t0;
  return result;
}

/** Daemon-side diff scan (scanDiff / scanDiffDelta). Shares the same cross-scan assets. */
export async function handleScanDiff(
  ctx: DaemonScanContext,
  config: ScanConfig,
  diffs: Array<Record<string, any>>,
  options: {
    cache: boolean;
    cacheDir?: string;
    cacheCustom?: boolean;
    workers?: number;
    parser?: string;
    verifyDiskContent?: boolean;
    delta?: boolean;
  },
): Promise<{ report: ScanReport | any; stats: DiffStats }> {
  const t0 = Date.now();
  const cfg = { ...config } as ScanConfig;
  if (typeof options.workers === 'number' && options.workers > 0) cfg.workers = options.workers;
  if (options.parser === 'oxc' || options.parser === 'typescript') cfg.parser = options.parser;

  const cache = options.cache
    ? ctx.getCache(cfg.root, options.cacheDir)
    : new CacheStore(undefined, cfg.root, { disabled: true });

  const logger = new Logger(cfg.logLevel || 'silent', cfg.logFile);
  const scanner = new Scanner(cfg, logger);

  const diffHints = new Map<string, DiffInput>();
  for (const d of diffs) {
    if (d && typeof d.filePath === 'string' && !diffHints.has(d.filePath)) {
      diffHints.set(d.filePath, d as unknown as DiffInput);
    }
  }

  const result = await scanner.scanWithDiff({
    cache,
    session: ctx.session,
    pool: ctx.pools,
    cacheCustom: options.cacheCustom === true,
    diffHints,
    verifyDiskContent: options.verifyDiskContent !== false,
    deltaOnly: options.delta === true,
  } as any);
  logger.close();

  result.stats.daemonUsed = true;
  result.stats.daemonMs = Date.now() - t0;
  return { report: result.report, stats: result.stats as DiffStats };
}

/** Default daemon context factory (used by server.ts). */
export function createDaemonContext(): DaemonScanContext {
  const pools = new WorkerPoolManager();
  const session: WarmSession = createWarmSession();
  const cacheByKey = new Map<string, CacheStore>();
  return {
    pools,
    session,
    getCache(root: string, cacheDir?: string): CacheStore {
      const key = cacheDir ? path.resolve(cacheDir) : path.join(path.resolve(root), '.auto-refactor-cache');
      let c = cacheByKey.get(key);
      if (!c) {
        c = new CacheStore(cacheDir, root);
        cacheByKey.set(key, c);
      }
      return c;
    },
  };
}
