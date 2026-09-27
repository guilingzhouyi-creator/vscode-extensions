/**
 * Module: Core Engine — Cache Probe & Miss Execution
 * File Path: src/core/scanner/cache-probe.ts
 * Architecture Role: Warm-cache scan orchestrator coordinating L1/L2 cache and incremental.
 * Dependencies & Triggers: fs, path, ../types, ../cache, ../cacheKey, ../incremental,
 *   ../fileDiscovery, ./scannerContext, ./cacheKeyHelper, ./workerScheduler.
 * Responsibilities: Resolve cache keys, probe stat fingerprints, dispatch L2 cache misses,
 *   execute line-level incremental subtrees, and flush updated cache entries.
 * Exit Semantics & Design Rationale: Decomposes scanWithCache into focused sub-steps to guarantee
 *   low cyclomatic complexity and ensure byte-identical results with cold scans.
 */
import { isFreshL1Hit } from './scan-guards';
import { hasWorkerPool } from './scan-guards';

import * as fs from 'fs';
import * as path from 'path';
import type { ScanConfig, Issue, FileMetric } from '../types';
import type { CacheStore, CachedResult, Fingerprint } from '../cache';
import type { WorkerAnalyzerDesc } from '../analyzer-registry';
import type { WorkerPoolManager } from '../worker-pool';
import { sha256Hex } from '../cache-key';
import { route, countLines } from '../incremental';
import { IncrementalFileState, touchIncremental } from '../incremental-state';
import type { ScannerContext } from './scanner-context';
import type { WarmSession, CacheFingerprintContext, StatResultEntry } from './cache-key-helper';
import { remapCachedResult } from './cache-key-helper';
import {
    effectiveWorkers,
    computeHybridK,
    dispatchBatches,
    runWorkerPool,
} from './worker-scheduler';

/** Options accepted by executeScanWithCache. */
export interface ScanWithCacheOptions {
    cache: CacheStore;
    session?: WarmSession;
    pool?: WorkerPoolManager;
    cacheCustom?: boolean;
}

/**
 * Index-aligned work lists collected while probing files against the two cache levels.
 *
 * Every list carries the file index so the caller can rebuild the per-file result array in the
 * original discovery order, which is what keeps warm and cached reports byte-identical.
 */
export interface CacheAnalysisQueue {
    toAnalyze: {
        idx: number;
        rel: string;
        fpHash: string;
        contentHash: string;
        buf?: Buffer;
    }[];
    toIncremental: {
        idx: number;
        rel: string;
        fpHash: string;
        contentHash: string;
        state: IncrementalFileState;
        content: string;
    }[];
    l2Refresh: {
        fpHash: string;
        contentHash: string;
        rel: string;
        result: CachedResult;
        fp?: Fingerprint;
    }[];
    l1Fps: { rel: string; fp: Fingerprint }[];
    l1Hit: number;
    l2Hit: number;
}

/**
 * Probe one file against L1 and fallback to fresh L2 by path.
 *
 * @param rel - Relative path of target file.
 * @param fp - Fingerprint of the file.
 * @param l1 - L1 cache lookup result.
 * @param sessionBucket - In-memory session bucket cache.
 * @param cache - CacheStore instance.
 * @param fpContext - Cache fingerprint context.
 *
 * Concurrency: synchronous cache lookup; safe for single-threaded caller.
 * @returns Cached issues and metric if hit, otherwise null.
 */
function tryProbeL1Hit(
    rel: string,
    fp: Fingerprint | null | undefined,
    l1: ReturnType<CacheStore['lookupL1']>,
    sessionBucket: Map<string, { issues: Issue[]; metric: FileMetric | null }>,
    cache: CacheStore,
    fpContext: CacheFingerprintContext,
): { issues: Issue[]; metric: FileMetric | null } | null {
    if (fp == null || !isFreshL1Hit(fp.mtimeMs, fp.size, l1)) return null;
    const cached = sessionBucket.get(rel);
    if (cached) return cached;

    const fph = fpContext.fpHashFor(rel);
    const byPath = lookupFreshL2ByPath(cache, fpContext, fph, rel, fp.mtimeMs, fp.size);
    if (!byPath) return null;

    const result = remapCachedResult(
        { issues: byPath.issues, metric: byPath.metric },
        byPath.p,
        rel,
    );
    sessionBucket.set(rel, result);
    return result;
}

function tryQueueIncremental(
    rel: string,
    idx: number,
    fph: string,
    contentHash: string,
    buf: Buffer,
    incBucket: Map<string, IncrementalFileState>,
    queue: CacheAnalysisQueue,
    incEnabled: boolean,
    incMinLines: number,
): boolean {
    if (!incEnabled) return false;
    const newContent = buf.toString('utf8');
    if (countLines(newContent) < incMinLines) return false;

    const oldState = incBucket.get(rel);
    if (oldState) {
        touchIncremental(incBucket, rel);
        const r = route(rel, oldState.content, newContent, oldState, {
            enabled: true,
            minLines: incMinLines,
        });
        if (r.mode === 'incremental') {
            oldState.prepare(newContent, contentHash);
            queue.toIncremental.push({
                idx,
                rel,
                fpHash: fph,
                contentHash,
                state: oldState,
                content: newContent,
            });
            return true;
        }
    }
    const fresh = new IncrementalFileState(newContent, contentHash);
    fresh.prepare(newContent, contentHash);
    incBucket.set(rel, fresh);
    queue.toIncremental.push({
        idx,
        rel,
        fpHash: fph,
        contentHash,
        state: fresh,
        content: newContent,
    });
    return true;
}

/**
 * Probe a single file against L1 session state and L2 disk cache.
 *
 * @param s - Stat probe entry containing normalized path, size, and mtime.
 * @param absRoot - Absolute root of the project.
 * @param cache - Two-level cache store backing the L1/L2 lookups.
 * @param fpContext - Pool fingerprint context of the current scan.
 * @param sessionBucket - Warm session results bucket of the pool fingerprint.
 * @param incBucket - Per-file incremental state bucket of the pool fingerprint.
 * @param perFile - Index-aligned per-file results the caller merges into the report.
 * @param queue - Routing work lists accumulated across the probed files.
 * @param incEnabled - Whether line-level incremental routing is enabled.
 * @param incMinLines - Minimum line count for incremental routing eligibility.
 *
 * Concurrency: asynchronous cache probe; safe for single-threaded caller.
 * @returns Resolves once the file is routed and its queue entry recorded.
 */
export async function probeSingleFileCache(
    s: StatResultEntry,
    absRoot: string,
    cache: CacheStore,
    fpContext: CacheFingerprintContext,
    sessionBucket: Map<string, { issues: Issue[]; metric: FileMetric | null }>,
    incBucket: Map<string, IncrementalFileState>,
    perFile: ({ issues: Issue[]; metric: FileMetric | null } | null)[],
    queue: CacheAnalysisQueue,
    incEnabled: boolean,
    incMinLines: number,
): Promise<void> {
    const i = s.idx;
    const rel = s.rel;
    if (s.fp) queue.l1Fps.push({ rel, fp: s.fp });

    const l1Hit = tryProbeL1Hit(rel, s.fp, cache.lookupL1(rel), sessionBucket, cache, fpContext);
    if (l1Hit) {
        perFile[i] = l1Hit;
        queue.l1Hit++;
        return;
    }

    let buf: Buffer;
    try {
        buf = await fs.promises.readFile(path.join(absRoot, rel));
    } catch {
        perFile[i] = { issues: [] as Issue[], metric: null as FileMetric | null };
        return;
    }

    const contentHash = sha256Hex(buf);
    const fph = fpContext.fpHashFor(rel);
    const l2 = lookupFreshL2(cache, fpContext, fph, contentHash);
    if (l2) {
        const result = remapCachedResult({ issues: l2.issues, metric: l2.metric }, l2.p, rel);
        perFile[i] = result;
        sessionBucket.set(rel, result);
        queue.l2Hit++;
        queue.l2Refresh.push({ fpHash: fph, contentHash, rel, result, fp: s.fp || undefined });
        return;
    }

    if (
        tryQueueIncremental(
            rel,
            i,
            fph,
            contentHash,
            buf,
            incBucket,
            queue,
            incEnabled,
            incMinLines,
        )
    ) {
        return;
    }

    queue.toAnalyze.push({ idx: i, rel, fpHash: fph, contentHash, buf });
}

async function runWithPersistentPool(
    scanner: ScannerContext,
    missFiles: string[],
    absRoot: string,
    cfg: ScanConfig,
    poolFp: string,
    opts: ScanWithCacheOptions,
    preloaded: Map<string, Buffer>,
    workerDescs: WorkerAnalyzerDesc[],
    effWorkers: number,
): Promise<{ results: { issues: Issue[]; metric: FileMetric | null }[]; poolWarm: boolean }> {
    const entry = opts.pool!.getOrCreate(poolFp, cfg, workerDescs, effWorkers);
    const poolWarm = entry.warm;
    let results: { issues: Issue[]; metric: FileMetric | null }[];
    try {
        results = await dispatchBatches({
            workers: entry.workers,
            workerIdx: entry.workerIdx,
            files: missFiles,
            absRoot,
            config: cfg,
            descs: workerDescs,
            numWorkers: entry.n,
            logger: scanner.logger,
            runAnalyzersFn: (rel, content) => scanner.runAnalyzers(rel, content),
            hybridK: entry.warm ? 0 : computeHybridK(cfg, missFiles.length, entry.n),
            keepAlive: true,
            fp: poolFp,
            preloaded,
        });
        entry.warm = true;
        entry.lastUsed = Date.now();
        opts.pool!.touch(poolFp);
    } catch (e) {
        scanner.logger.warn(
            `persistent worker pool failed (${String(e)}); falling back to in-process`,
        );
        opts.pool!.destroy(poolFp);
        results = await scanner.runInProcess(missFiles, absRoot, preloaded);
    }
    opts.pool!.rssGuard();
    return { results, poolWarm };
}

async function runWithTransientPool(
    scanner: ScannerContext,
    missFiles: string[],
    absRoot: string,
    cfg: ScanConfig,
    preloaded: Map<string, Buffer>,
    workerDescs: WorkerAnalyzerDesc[],
    effWorkers: number,
): Promise<{ results: { issues: Issue[]; metric: FileMetric | null }[]; poolWarm: boolean }> {
    let results: { issues: Issue[]; metric: FileMetric | null }[];
    try {
        results = await runWorkerPool(
            missFiles,
            absRoot,
            cfg,
            workerDescs,
            effWorkers,
            scanner.logger,
            (rel, content) => scanner.runAnalyzers(rel, content),
            preloaded,
        );
    } catch (e) {
        scanner.logger.warn(`worker pool failed (${String(e)}); falling back to in-process scan`);
        results = await scanner.runInProcess(missFiles, absRoot, preloaded);
    }
    return { results, poolWarm: false };
}

function recordAnalyzedResults(
    toAnalyze: CacheAnalysisQueue['toAnalyze'],
    results: { issues: Issue[]; metric: FileMetric | null }[],
    perFile: ({ issues: Issue[]; metric: FileMetric | null } | null)[],
    sessionBucket: Map<string, { issues: Issue[]; metric: FileMetric | null }>,
    l2Enabled: boolean,
    cache: CacheStore,
    fpByRel: Map<string, Fingerprint>,
): number {
    let analyzed = 0;
    for (let k = 0; k < toAnalyze.length; k++) {
        const t = toAnalyze[k];
        perFile[t.idx] = results[k];
        sessionBucket.set(t.rel, results[k]);
        analyzed++;
        if (l2Enabled) {
            cache.writeL2(t.fpHash, t.contentHash, t.rel, results[k], fpByRel.get(t.rel));
        }
    }
    return analyzed;
}

/**
 * Analyze the files the probe could not serve from either cache level.
 *
 * @param scanner - Scanner execution context supplying config and fallbacks.
 * @param toAnalyze - Files queued for a full parse+analyze pass.
 * @param files - Full discovered-file list, used for pool dispatch sizing.
 * @param absRoot - Absolute root of the project.
 * @param cfg - Effective scan configuration.
 * @param poolFp - Pool fingerprint of the current scan.
 * @param l2Enabled - Whether L2 cache writes are enabled for this pool.
 * @param opts - Cache scan options (session, pool, custom-analyzer L2 switch).
 * @param sessionBucket - Warm session results bucket of the pool fingerprint.
 * @param perFile - Index-aligned per-file results the caller merges into the report.
 * @param fpByRel - Per-file cache fingerprint used when writing L2 entries.
 * @param cache - Two-level cache store backing the writes.
 * Concurrency: asynchronous coordinator dispatching to worker pool; safe for
 *   single-threaded caller.
 * @returns Files analyzed and whether the worker pool was reused.
 */
export async function executeCacheMisses(
    scanner: ScannerContext,
    toAnalyze: CacheAnalysisQueue['toAnalyze'],
    files: string[],
    absRoot: string,
    cfg: ScanConfig,
    poolFp: string,
    l2Enabled: boolean,
    opts: ScanWithCacheOptions,
    sessionBucket: Map<string, { issues: Issue[]; metric: FileMetric | null }>,
    perFile: ({ issues: Issue[]; metric: FileMetric | null } | null)[],
    fpByRel: Map<string, Fingerprint>,
    cache: CacheStore,
): Promise<{ analyzed: number; poolWarm: boolean }> {
    if (toAnalyze.length === 0) return { analyzed: 0, poolWarm: false };
    const missFiles = toAnalyze.map((t) => files[t.idx]);
    const workerDescs: WorkerAnalyzerDesc[] = scanner.plan.map((p) => ({
        name: p.name,
        modulePath: p.modulePath,
        options: (p.options ?? {}) as Record<string, any>,
    }));
    const effWorkers = effectiveWorkers(cfg.workers, missFiles.length);
    const useWorkers = effWorkers > 1;
    const preloaded = new Map<string, Buffer>();
    for (const t of toAnalyze) if (t.buf) preloaded.set(t.rel, t.buf);

    let batchResult: {
        results: { issues: Issue[]; metric: FileMetric | null }[];
        poolWarm: boolean;
    };
    if (hasWorkerPool(useWorkers, opts)) {
        batchResult = await runWithPersistentPool(
            scanner,
            missFiles,
            absRoot,
            cfg,
            poolFp,
            opts,
            preloaded,
            workerDescs,
            effWorkers,
        );
    } else if (useWorkers) {
        batchResult = await runWithTransientPool(
            scanner,
            missFiles,
            absRoot,
            cfg,
            preloaded,
            workerDescs,
            effWorkers,
        );
    } else {
        const inProcResults = await scanner.runInProcess(missFiles, absRoot, preloaded);
        batchResult = { results: inProcResults, poolWarm: false };
    }

    const analyzed = recordAnalyzedResults(
        toAnalyze,
        batchResult.results,
        perFile,
        sessionBucket,
        l2Enabled,
        cache,
        fpByRel,
    );
    return { analyzed, poolWarm: batchResult.poolWarm };
}

async function runSingleIncrementalAnalysis(
    scanner: ScannerContext,
    t: CacheAnalysisQueue['toIncremental'][number],
    incBucket: Map<string, IncrementalFileState>,
): Promise<{ issues: Issue[]; metric: FileMetric | null }> {
    try {
        return await scanner.runAnalyzers(t.rel, t.content, t.state);
    } catch (e) {
        return recoverIncrementalAnalysis(scanner, t, incBucket, e);
    }
}

async function recoverIncrementalAnalysis(
    scanner: ScannerContext,
    t: CacheAnalysisQueue['toIncremental'][number],
    incBucket: Map<string, IncrementalFileState>,
    initialError: unknown,
): Promise<{ issues: Issue[]; metric: FileMetric | null }> {
    scanner.logger.warn(
        `line-level incremental failed on ${t.rel}: ${String(initialError)}; full rescan`,
    );
    t.state.finalize();
    const fresh = new IncrementalFileState(t.content, t.contentHash);
    fresh.prepare(t.content, t.contentHash);
    incBucket.set(t.rel, fresh);
    try {
        return await scanner.runAnalyzers(t.rel, t.content, fresh);
    } catch (e2) {
        scanner.logger.warn(
            `seeded materialization failed on ${t.rel}: ${String(e2)}; unseeded rescan`,
        );
        return scanner.runAnalyzers(t.rel, t.content);
    }
}

/**
 * Analyze the files whose changed line ranges allow subtree reuse.
 *
 * @param scanner - Scanner execution context supplying config and analyzers.
 * @param toIncremental - Files queued for line-level incremental analysis.
 * @param incBucket - Per-file incremental state bucket of the pool fingerprint.
 * @param l2Enabled - Whether L2 cache writes are enabled for this pool.
 * @param sessionBucket - Warm session results bucket of the pool fingerprint.
 * @param perFile - Index-aligned per-file results the caller merges into the report.
 * @param fpByRel - Per-file cache fingerprint used when writing L2 entries.
 * @param cache - Two-level cache store backing the writes.
 *
 * Concurrency: asynchronous execution; safe for single-threaded caller.
 * @returns Incremental file count and how many subtrees were reused.
 */
export async function executeIncrementalFiles(
    scanner: ScannerContext,
    toIncremental: CacheAnalysisQueue['toIncremental'],
    incBucket: Map<string, IncrementalFileState>,
    l2Enabled: boolean,
    sessionBucket: Map<string, { issues: Issue[]; metric: FileMetric | null }>,
    perFile: ({ issues: Issue[]; metric: FileMetric | null } | null)[],
    fpByRel: Map<string, Fingerprint>,
    cache: CacheStore,
): Promise<{ incrementalFiles: number; incrementalHit: number }> {
    let incrementalFiles = 0;
    let incrementalHit = 0;

    for (const t of toIncremental) {
        const result = await runSingleIncrementalAnalysis(scanner, t, incBucket);
        t.state.finalize();
        perFile[t.idx] = result;
        sessionBucket.set(t.rel, result);
        incrementalHit += t.state.reuseHits;
        incrementalFiles++;
        if (l2Enabled) {
            cache.writeL2(t.fpHash, t.contentHash, t.rel, result, fpByRel.get(t.rel));
        }
    }
    return { incrementalFiles, incrementalHit };
}

/**
 * Look up an L2 entry by path, honouring the per-pool L2 switch.
 *
 * @param cache - Two-level cache store backing the lookup.
 * @param fpContext - Pool fingerprint context carrying the L2 switch.
 * @param fph - Pool fingerprint hash of the current scan.
 * @param rel - Repository-relative path of the probed file.
 * @param mtimeMs - Modification time recorded for the file.
 * @param size - Byte size recorded for the file.
 * @returns The cached entry, or null when L2 is disabled or misses.
 */
function lookupFreshL2ByPath(
    cache: CacheStore,
    fpContext: CacheFingerprintContext,
    fph: string,
    rel: string,
    mtimeMs: number,
    size: number,
) {
    return fpContext.l2Enabled ? cache.lookupL2ByPath(fph, rel, mtimeMs, size) : null;
}

/**
 * Look up an L2 entry by content hash, honouring the per-pool L2 switch.
 *
 * @param cache - Two-level cache store backing the lookup.
 * @param fpContext - Pool fingerprint context carrying the L2 switch.
 * @param fph - Pool fingerprint hash of the current scan.
 * @param contentHash - Content hash of the probed file.
 * @returns The cached entry, or null when L2 is disabled or misses.
 */
function lookupFreshL2(
    cache: CacheStore,
    fpContext: CacheFingerprintContext,
    fph: string,
    contentHash: string,
) {
    return fpContext.l2Enabled ? cache.lookupL2(fph, contentHash) : null;
}
