import * as path from 'path';
import type { ScanConfig, ScanReport, WarmStats, DiffInput, DiffStats } from '../core/types';
import type { WarmSession } from '../core/analyzer';
import { Scanner, WorkerPoolManager, createWarmSession } from '../core/analyzer';
import { CacheStore } from '../core/cache';
import { Logger } from '../core/logger';

/**
 * Module: Daemon — Warm/Diff Scan Handler
 * File Path: src/daemon/scanHandler.ts
 * Architecture Role: Daemon-side orchestration layer that wires long-lived assets into the
 *   shared Scanner pipeline, mirroring the cold-scan entry path.
 * Dependencies & Triggers: ../core/types, ../core/analyzer (Scanner, WorkerPoolManager,
 *   WarmSession, createWarmSession), ../core/cache and ../core/logger; triggered per `scan` /
 *   `scan_diff` frame by ./server, which also uses the exported default context factory.
 * Responsibilities: Clone the resolved config and apply worker/parser overrides, select a
 *   cached or disabled CacheStore, create a per-scan Logger, run scanWithCache or scanWithDiff
 *   with the daemon's shared pools/session, deduplicate diff hints by file path, and stamp
 *   daemonUsed/daemonMs timings onto the returned stats.
 * Exit Semantics & Design Rationale: Async handlers await the shared pipeline and let errors
 *   propagate to the server, which turns them into SCAN_FAILED frames; loggers are closed when
 *   a run resolves. Reusing Scanner.scanWithCache/scanWithDiff (the same aggregation path as cold)
 *   makes warm results byte-equivalent by construction rather than a forked implementation.
 *
 * Assets: pools = persistent worker pools sharded by config fingerprint (T03);
 *   session = per-fingerprint per-file results (L1 hit means zero reads on a repeat scan);
 *   cache = one CacheStore per project, loaded once and kept in memory.
 */

/**
 * Long-lived daemon assets shared by every scan request: persistent worker pools, the
 * per-fingerprint warm session, and a memoized per-project cache factory.
 */
export interface DaemonScanContext {
    pools: WorkerPoolManager;
    session: WarmSession;
    getCache(root: string, cacheDir?: string): CacheStore;
}

/**
 * Per-request transport options taken from a scan/scan_diff frame; the handler applies them
 * only where it explicitly allows an override of the resolved config.
 */
export interface DaemonScanOptions {
    cache: boolean;
    cacheDir?: string;
    cacheCustom?: boolean;
    workers?: number;
    parser?: string;
}

/**
 * Execute one warm scan against the daemon's shared pools and session.
 *
 * This routine is async: it awaits Scanner.scanWithCache, which reuses the persistent worker
 * pool and warm session, and it closes its per-call Logger before resolving. Each invocation
 * builds its own Logger and Scanner around a shallow config clone, so concurrent requests do
 * not race on handler state; the shared pool itself owns worker-level serialization.
 *
 * @param ctx - Daemon assets (worker pools, warm session, cache factory) shared across runs.
 * @param config - Fully resolved scan config; cloned by the handler, never mutated in place.
 * @param options - Transport overrides: cache toggle/dir/custom flag, a positive worker count
 *   and an optional `oxc`/`typescript` parser; unsupported values are ignored.
 * @returns A promise resolving to the aggregated report and stats stamped with daemonUsed and
 *   daemonMs; await it and handle rejection from the underlying scan.
 */
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

/**
 * Execute one daemon-side diff scan (scanDiff or scanDiffDelta) over the same shared assets.
 *
 * This routine is async: it awaits Scanner.scanWithDiff and closes its per-call Logger before
 * resolving. Concurrent callers may overlap; each keeps its own Logger, Scanner and config
 * clone, while the shared pool/session assets are the intended synchronization boundary. The
 * supplied diff hints are only read: duplicate filePaths collapse to the first-seen entry and
 * disk verification is on unless explicitly disabled.
 *
 * @param ctx - Daemon assets (worker pools, warm session, cache factory) shared across runs.
 * @param config - Fully resolved scan config; cloned before worker/parser overrides apply.
 * @param diffs - Raw diff hints (JSON-serialized DiffInput); entries without a string filePath
 *   are ignored and only the first entry per filePath contributes.
 * @param options - Per-request diff options; see the nested tags for each flag.
 * @param options.cache - When true, reuse the project CacheStore; false disables caching.
 * @param options.cacheDir - Optional cache directory override; defaults to the project cache.
 * @param options.cacheCustom - Forwards custom-cache permission to the cache layer.
 * @param options.workers - Positive worker count override; non-positive values are ignored.
 * @param options.parser - Parser override; only `oxc` and `typescript` are accepted.
 * @param options.verifyDiskContent - Keep disk-content verification on (default true).
 * @param options.delta - When true, report only the changed-file subset (scanDiffDelta).
 * @returns A promise resolving to the diff report and stats with daemonUsed/daemonMs set;
 *   await it and handle rejection from the underlying scan.
 */
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

/**
 * Build the default per-daemon scan context: one shared worker-pool manager, one warm
 * session, and a lazily created CacheStore per resolved cache directory.
 *
 * @returns A context whose `getCache(root, cacheDir)` memoizes by absolute cache directory
 *   (or `<root>/.auto-refactor-cache`) so repeat scans share the same in-memory instance.
 */
export function createDaemonContext(): DaemonScanContext {
    const pools = new WorkerPoolManager();
    const session: WarmSession = createWarmSession();
    const cacheByKey = new Map<string, CacheStore>();
    return {
        pools,
        session,
        getCache(root: string, cacheDir?: string): CacheStore {
            const key = cacheDir
                ? path.resolve(cacheDir)
                : path.join(path.resolve(root), '.auto-refactor-cache');
            let c = cacheByKey.get(key);
            if (!c) {
                c = new CacheStore(cacheDir, root);
                cacheByKey.set(key, c);
            }
            return c;
        },
    };
}
