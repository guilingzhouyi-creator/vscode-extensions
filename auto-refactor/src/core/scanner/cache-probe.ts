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
import * as fs from 'fs';
import * as path from 'path';
import type { ScanConfig, Issue, FileMetric } from '../types';
import type { CacheStore, CachedResult, Fingerprint } from '../cache';
import type { WorkerAnalyzerDesc } from '../analyzer-registry';
import type { WorkerPoolManager } from '../worker-pool';
import { sha256Hex } from '../cache-key';
import { route, countLines } from '../diff/incremental';
import { IncrementalFileState, touchIncremental } from '../diff/incremental-state';
import type { ScannerContext } from './scanner-context';
import type { WarmSession, CacheFingerprintContext, StatResultEntry } from './cache-key-helper';
import { remapCachedResult } from './cache-key-helper';
import {
    effectiveWorkers,
    computeHybridK,
    dispatchBatches,
    runWorkerPool,
} from './worker-scheduler';
import { isFreshL1Hit, hasWorkerPool } from './scan-guards';

const MODE_INCREMENTAL = 'incremental' as const;
const ENCODING_UTF8 = 'utf8' as const;

/** Options accepted by executeScanWithCache. */
export interface ScanWithCacheOptions {
    cache: CacheStore;
    session?: WarmSession;
    pool?: WorkerPoolManager;
    cacheCustom?: boolean;
}

/** Index-aligned work lists collected while probing files against the two cache levels. */
export interface CacheAnalysisQueue {
    toAnalyze: { idx: number; rel: string; fpHash: string; contentHash: string; buf?: Buffer }[];
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

/** Options for probing a single file against L1 and L2 caches. */
export interface ProbeSingleFileOptions {
    statEntry: StatResultEntry;
    absRoot: string;
    cache: CacheStore;
    fpContext: CacheFingerprintContext;
    sessionBucket: Map<string, { issues: Issue[]; metric: FileMetric | null }>;
    incBucket: Map<string, IncrementalFileState>;
    perFile: ({ issues: Issue[]; metric: FileMetric | null } | null)[];
    queue: CacheAnalysisQueue;
    incEnabled: boolean;
    incMinLines: number;
}

/** Options for executing analysis on cache miss files. */
export interface ExecuteCacheMissesOptions {
    scanner: ScannerContext;
    toAnalyze: CacheAnalysisQueue['toAnalyze'];
    files: string[];
    absRoot: string;
    cfg: ScanConfig;
    poolFp: string;
    l2Enabled: boolean;
    opts: ScanWithCacheOptions;
    sessionBucket: Map<string, { issues: Issue[]; metric: FileMetric | null }>;
    perFile: ({ issues: Issue[]; metric: FileMetric | null } | null)[];
    fpByRel: Map<string, Fingerprint>;
    cache: CacheStore;
}

/** Options for analyzing files eligible for incremental subtree reuse. */
export interface ExecuteIncrementalFilesOptions {
    scanner: ScannerContext;
    toIncremental: CacheAnalysisQueue['toIncremental'];
    incBucket: Map<string, IncrementalFileState>;
    l2Enabled: boolean;
    sessionBucket: Map<string, { issues: Issue[]; metric: FileMetric | null }>;
    perFile: ({ issues: Issue[]; metric: FileMetric | null } | null)[];
    fpByRel: Map<string, Fingerprint>;
    cache: CacheStore;
}

interface ProbeL1Context {
    rel: string;
    fingerprint: Fingerprint | null | undefined;
    l1: ReturnType<CacheStore['lookupL1']>;
    sessionBucket: Map<string, { issues: Issue[]; metric: FileMetric | null }>;
    cache: CacheStore;
    fpContext: CacheFingerprintContext;
}

interface QueueIncrementalContext {
    rel: string;
    idx: number;
    fpHash: string;
    contentHash: string;
    buf: Buffer;
    incBucket: Map<string, IncrementalFileState>;
    queue: CacheAnalysisQueue;
    incEnabled: boolean;
    incMinLines: number;
}

interface L2PathContext {
    cache: CacheStore;
    fpContext: CacheFingerprintContext;
    fpHash: string;
    rel: string;
    mtimeMs: number;
    size: number;
}

interface DispatchMissContext {
    scanner: ScannerContext;
    missFiles: string[];
    absRoot: string;
    cfg: ScanConfig;
    poolFp: string;
    opts: ScanWithCacheOptions;
    preloadedBufferMap: Map<string, Buffer>;
    workerDescs: WorkerAnalyzerDesc[];
    effWorkers: number;
}

interface RecordAnalyzedContext {
    toAnalyze: CacheAnalysisQueue['toAnalyze'];
    results: { issues: Issue[]; metric: FileMetric | null }[];
    perFile: ({ issues: Issue[]; metric: FileMetric | null } | null)[];
    sessionBucket: Map<string, { issues: Issue[]; metric: FileMetric | null }>;
    l2Enabled: boolean;
    cache: CacheStore;
    fpByRel: Map<string, Fingerprint>;
}

function lookupFreshL2ByPath(context: L2PathContext): (CachedResult & { p: string }) | null {
    if (!context.fpContext.l2Enabled) return null;
    return context.cache.lookupL2ByPath(context.fpHash, context.rel, context.mtimeMs, context.size);
}

function lookupFreshL2(
    cache: CacheStore,
    fpContext: CacheFingerprintContext,
    fpHash: string,
    contentHash: string,
): (CachedResult & { p: string }) | null {
    return fpContext.l2Enabled ? cache.lookupL2(fpHash, contentHash) : null;
}

function tryProbeL1Hit(
    context: ProbeL1Context,
): { issues: Issue[]; metric: FileMetric | null } | null {
    const { rel, fingerprint, l1, sessionBucket, cache, fpContext } = context;
    if (fingerprint == null || !isFreshL1Hit(fingerprint.mtimeMs, fingerprint.size, l1))
        return null;
    const cached = sessionBucket.get(rel);
    if (cached) return cached;

    const fpHash = fpContext.fpHashFor(rel);
    const byPath = lookupFreshL2ByPath({
        cache,
        fpContext,
        fpHash,
        rel,
        mtimeMs: fingerprint.mtimeMs,
        size: fingerprint.size,
    });
    if (!byPath) return null;

    const cachedResultPayload = remapCachedResult(
        { issues: byPath.issues, metric: byPath.metric },
        byPath.p,
        rel,
    );
    sessionBucket.set(rel, cachedResultPayload);
    return cachedResultPayload;
}

function tryQueueIncremental(context: QueueIncrementalContext): boolean {
    const { rel, idx, fpHash, contentHash, buf, incBucket, queue, incEnabled, incMinLines } =
        context;
    if (!incEnabled) return false;
    const newContent = buf.toString(ENCODING_UTF8);
    if (countLines(newContent) < incMinLines) return false;

    const oldState = incBucket.get(rel);
    if (oldState) {
        touchIncremental(incBucket, rel);
        const incrementalRoute = route(rel, oldState.content, newContent, oldState, {
            enabled: true,
            minLines: incMinLines,
        });
        if (incrementalRoute.mode === MODE_INCREMENTAL) {
            oldState.prepare(newContent, contentHash);
            queue.toIncremental.push({
                idx,
                rel,
                fpHash,
                contentHash,
                state: oldState,
                content: newContent,
            });
            return true;
        }
    }
    const freshState = new IncrementalFileState(newContent, contentHash);
    freshState.prepare(newContent, contentHash);
    incBucket.set(rel, freshState);
    queue.toIncremental.push({
        idx,
        rel,
        fpHash,
        contentHash,
        state: freshState,
        content: newContent,
    });
    return true;
}

/**
 * Probe a single file against L1 session state and L2 disk cache.
 *
 * @param options - Probe parameters including cache, buckets and target file.
 */
export async function probeSingleFileCache(options: ProbeSingleFileOptions): Promise<void> {
    const {
        statEntry,
        absRoot,
        cache,
        fpContext,
        sessionBucket,
        incBucket,
        perFile,
        queue,
        incEnabled,
        incMinLines,
    } = options;
    const fileIndex = statEntry.idx;
    const rel = statEntry.rel;
    if (statEntry.fp) queue.l1Fps.push({ rel, fp: statEntry.fp });

    const l1Hit = tryProbeL1Hit({
        rel,
        fingerprint: statEntry.fp,
        l1: cache.lookupL1(rel),
        sessionBucket,
        cache,
        fpContext,
    });
    if (l1Hit) {
        perFile[fileIndex] = l1Hit;
        queue.l1Hit++;
        return;
    }

    let buf: Buffer;
    try {
        buf = await fs.promises.readFile(path.join(absRoot, rel));
    } catch {
        perFile[fileIndex] = { issues: [] as Issue[], metric: null as FileMetric | null };
        return;
    }

    const contentHash = sha256Hex(buf);
    const fpHash = fpContext.fpHashFor(rel);
    const l2 = lookupFreshL2(cache, fpContext, fpHash, contentHash);
    if (l2) {
        const cachedResultPayload = remapCachedResult(
            { issues: l2.issues, metric: l2.metric },
            l2.p,
            rel,
        );
        perFile[fileIndex] = cachedResultPayload;
        sessionBucket.set(rel, cachedResultPayload);
        queue.l2Hit++;
        queue.l2Refresh.push({
            fpHash,
            contentHash,
            rel,
            result: cachedResultPayload,
            fp: statEntry.fp || undefined,
        });
        return;
    }

    if (
        tryQueueIncremental({
            rel,
            idx: fileIndex,
            fpHash,
            contentHash,
            buf,
            incBucket,
            queue,
            incEnabled,
            incMinLines,
        })
    ) {
        return;
    }

    queue.toAnalyze.push({ idx: fileIndex, rel, fpHash, contentHash, buf });
}

async function runWithPersistentPool(
    context: DispatchMissContext,
): Promise<{ results: { issues: Issue[]; metric: FileMetric | null }[]; poolWarm: boolean }> {
    const {
        scanner,
        missFiles,
        absRoot,
        cfg,
        poolFp,
        opts,
        preloadedBufferMap,
        workerDescs,
        effWorkers,
    } = context;
    const entry = opts.pool!.getOrCreate(poolFp, cfg, workerDescs, effWorkers);
    const poolWarm = entry.warm;
    let hybridKValue = 0;
    if (!entry.warm) {
        hybridKValue = computeHybridK(cfg, missFiles.length, entry.n);
    }
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
            hybridK: hybridKValue,
            keepAlive: true,
            fp: poolFp,
            preloaded: preloadedBufferMap,
        });
        entry.warm = true;
        entry.lastUsed = Date.now();
        opts.pool!.touch(poolFp);
    } catch (e) {
        scanner.logger.warn(
            `persistent worker pool failed (${String(e)}); falling back to in-process`,
        );
        opts.pool!.destroy(poolFp);
        results = await scanner.runInProcess(missFiles, absRoot, preloadedBufferMap);
    }
    opts.pool!.rssGuard();
    return { results, poolWarm };
}

async function runWithTransientPool(
    context: DispatchMissContext,
): Promise<{ results: { issues: Issue[]; metric: FileMetric | null }[]; poolWarm: boolean }> {
    const { scanner, missFiles, absRoot, cfg, preloadedBufferMap, workerDescs, effWorkers } =
        context;
    let results: { issues: Issue[]; metric: FileMetric | null }[];
    try {
        results = await runWorkerPool({
            files: missFiles,
            absRoot,
            config: cfg,
            descs: workerDescs,
            numWorkers: effWorkers,
            logger: scanner.logger,
            runAnalyzersFn: (rel, content) => scanner.runAnalyzers(rel, content),
            preloaded: preloadedBufferMap,
        });
    } catch (e) {
        scanner.logger.warn(`worker pool failed (${String(e)}); falling back to in-process scan`);
        results = await scanner.runInProcess(missFiles, absRoot, preloadedBufferMap);
    }
    return { results, poolWarm: false };
}

async function dispatchMissBatch(
    context: DispatchMissContext,
): Promise<{ results: { issues: Issue[]; metric: FileMetric | null }[]; poolWarm: boolean }> {
    const useWorkers = context.effWorkers > 1;
    if (hasWorkerPool(useWorkers, context.opts)) return runWithPersistentPool(context);
    if (useWorkers) return runWithTransientPool(context);
    const inProcResults = await context.scanner.runInProcess(
        context.missFiles,
        context.absRoot,
        context.preloadedBufferMap,
    );
    return { results: inProcResults, poolWarm: false };
}

function recordAnalyzedResults(context: RecordAnalyzedContext): number {
    const { toAnalyze, results, perFile, sessionBucket, l2Enabled, cache, fpByRel } = context;
    let analyzed = 0;
    for (let targetIndex = 0; targetIndex < toAnalyze.length; targetIndex++) {
        const targetItem = toAnalyze[targetIndex];
        perFile[targetItem.idx] = results[targetIndex];
        sessionBucket.set(targetItem.rel, results[targetIndex]);
        analyzed++;
        if (l2Enabled) {
            cache.writeL2(
                targetItem.fpHash,
                targetItem.contentHash,
                targetItem.rel,
                results[targetIndex],
                fpByRel.get(targetItem.rel),
            );
        }
    }
    return analyzed;
}

/**
 * Analyze the files the probe could not serve from either cache level.
 *
 * @param options - Execution context and files scheduled for full analysis.
 * @returns Number of analyzed files and pool warm status.
 */
export async function executeCacheMisses(
    options: ExecuteCacheMissesOptions,
): Promise<{ analyzed: number; poolWarm: boolean }> {
    const {
        scanner,
        toAnalyze,
        files,
        absRoot,
        cfg,
        poolFp,
        l2Enabled,
        opts,
        sessionBucket,
        perFile,
        fpByRel,
        cache,
    } = options;
    if (toAnalyze.length === 0) return { analyzed: 0, poolWarm: false };
    const missFiles = toAnalyze.map((queueItem) => files[queueItem.idx]);
    const workerDescs: WorkerAnalyzerDesc[] = scanner.plan.map((planItem) => ({
        name: planItem.name,
        modulePath: planItem.modulePath,
        options: (planItem.options ?? {}) as Record<string, any>,
    }));
    const effWorkers = effectiveWorkers(cfg.workers, missFiles.length);
    const preloadedBufferMap = new Map<string, Buffer>(
        toAnalyze
            .filter((item): item is typeof item & { buf: Buffer } => item.buf !== undefined)
            .map((item) => [item.rel, item.buf]),
    );

    const batchResult = await dispatchMissBatch({
        scanner,
        missFiles,
        absRoot,
        cfg,
        poolFp,
        opts,
        preloadedBufferMap,
        workerDescs,
        effWorkers,
    });

    const analyzed = recordAnalyzedResults({
        toAnalyze,
        results: batchResult.results,
        perFile,
        sessionBucket,
        l2Enabled,
        cache,
        fpByRel,
    });
    return { analyzed, poolWarm: batchResult.poolWarm };
}

async function runSingleIncrementalAnalysis(
    scanner: ScannerContext,
    fileQueueItem: CacheAnalysisQueue['toIncremental'][number],
    incBucket: Map<string, IncrementalFileState>,
): Promise<{ issues: Issue[]; metric: FileMetric | null }> {
    try {
        return await scanner.runAnalyzers(
            fileQueueItem.rel,
            fileQueueItem.content,
            fileQueueItem.state,
        );
    } catch (e) {
        return runIncrementalRecovery(scanner, fileQueueItem, incBucket, e);
    }
}

async function runIncrementalRecovery(
    scanner: ScannerContext,
    fileQueueItem: CacheAnalysisQueue['toIncremental'][number],
    incBucket: Map<string, IncrementalFileState>,
    initialError: unknown,
): Promise<{ issues: Issue[]; metric: FileMetric | null }> {
    scanner.logger.warn(
        `line-level incremental failed on ${fileQueueItem.rel}: ${String(initialError)}; full rescan`,
    );
    fileQueueItem.state.finalize();
    const freshState = new IncrementalFileState(fileQueueItem.content, fileQueueItem.contentHash);
    freshState.prepare(fileQueueItem.content, fileQueueItem.contentHash);
    incBucket.set(fileQueueItem.rel, freshState);
    try {
        return await scanner.runAnalyzers(fileQueueItem.rel, fileQueueItem.content, freshState);
    } catch (e2) {
        scanner.logger.warn(
            `seeded materialization failed on ${fileQueueItem.rel}: ${String(e2)}; unseeded rescan`,
        );
        return scanner.runAnalyzers(fileQueueItem.rel, fileQueueItem.content);
    }
}

/**
 * Analyze the files whose changed line ranges allow subtree reuse.
 *
 * @param options - Incremental execution parameters and files to process.
 * @returns Execution statistics for incremental files.
 */
export async function executeIncrementalFiles(
    options: ExecuteIncrementalFilesOptions,
): Promise<{ incrementalFiles: number; incrementalHit: number }> {
    const { scanner, toIncremental, incBucket, l2Enabled, sessionBucket, perFile, fpByRel, cache } =
        options;
    let incrementalFiles = 0;
    let incrementalHit = 0;

    for (const fileQueueItem of toIncremental) {
        const routedAnalysisResult = await runSingleIncrementalAnalysis(
            scanner,
            fileQueueItem,
            incBucket,
        );
        fileQueueItem.state.finalize();
        perFile[fileQueueItem.idx] = routedAnalysisResult;
        sessionBucket.set(fileQueueItem.rel, routedAnalysisResult);
        incrementalHit += fileQueueItem.state.reuseHits;
        incrementalFiles++;
        if (l2Enabled) {
            cache.writeL2(
                fileQueueItem.fpHash,
                fileQueueItem.contentHash,
                fileQueueItem.rel,
                routedAnalysisResult,
                fpByRel.get(fileQueueItem.rel),
            );
        }
    }
    return { incrementalFiles, incrementalHit };
}
