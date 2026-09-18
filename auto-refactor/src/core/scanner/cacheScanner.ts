/**
 * Module: Core Engine — Two-Level Cache Scanner Pipeline
 * File Path: src/core/scanner/cacheScanner.ts
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
import type { ScanConfig, ScanReport, Issue, FileMetric, WarmStats } from '../types';
import type { CacheStore, CachedResult, Fingerprint } from '../cache';
import type { WorkerPoolManager } from '../workerPool';
import { sha256Hex } from '../cacheKey';
import { route, incrementalEnabled, incrementalMinLines, countLines } from '../incremental';
import {
    IncrementalFileState,
    touchIncremental,
    pruneIncrementalBucket,
    incrementalRssGuard,
    incrementalMaxFiles,
} from '../incrementalState';
import { globToRegExp, collectFiles } from '../fileDiscovery';
import { loadGitignore } from '../gitignore';
import type { ScannerContext } from './scannerContext';
import type { WarmSession, CacheFingerprintContext, StatResultEntry } from './cacheKeyHelper';
import {
    createWarmSession,
    buildCacheFingerprintContext,
    resolveSessionBuckets,
    collectStatFingerprints,
    remapCachedResult,
} from './cacheKeyHelper';
import {
    effectiveWorkers,
    computeHybridK,
    dispatchBatches,
    runWorkerPool,
} from './workerScheduler';

/** Options accepted by executeScanWithCache. */
export interface ScanWithCacheOptions {
    cache: CacheStore;
    session?: WarmSession;
    pool?: WorkerPoolManager;
    cacheCustom?: boolean;
}

interface CacheAnalysisQueue {
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

async function probeSingleFileCache(
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
    const l1 = cache.lookupL1(rel);
    if (s.fp && l1 && l1.mtimeMs === s.fp.mtimeMs && l1.size === s.fp.size) {
        const cached = sessionBucket.get(rel);
        if (cached) {
            perFile[i] = cached;
            queue.l1Hit++;
            return;
        }
        const fph = fpContext.fpHashFor(rel);
        const byPath = fpContext.l2Enabled
            ? cache.lookupL2ByPath(fph, rel, s.fp.mtimeMs, s.fp.size)
            : null;
        if (byPath) {
            const result = remapCachedResult(
                { issues: byPath.issues, metric: byPath.metric },
                byPath.p,
                rel,
            );
            perFile[i] = result;
            sessionBucket.set(rel, result);
            queue.l1Hit++;
            return;
        }
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
    const l2 = fpContext.l2Enabled ? cache.lookupL2(fph, contentHash) : null;
    if (l2) {
        const result = remapCachedResult({ issues: l2.issues, metric: l2.metric }, l2.p, rel);
        perFile[i] = result;
        sessionBucket.set(rel, result);
        queue.l2Hit++;
        queue.l2Refresh.push({ fpHash: fph, contentHash, rel, result, fp: s.fp || undefined });
        return;
    }
    if (incEnabled && countLines(buf.toString('utf8')) >= incMinLines) {
        const newContent = buf.toString('utf8');
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
                    idx: i,
                    rel,
                    fpHash: fph,
                    contentHash,
                    state: oldState,
                    content: newContent,
                });
                return;
            }
        }
        const fresh = new IncrementalFileState(newContent, contentHash);
        fresh.prepare(newContent, contentHash);
        incBucket.set(rel, fresh);
        queue.toIncremental.push({
            idx: i,
            rel,
            fpHash: fph,
            contentHash,
            state: fresh,
            content: newContent,
        });
        return;
    }
    queue.toAnalyze.push({ idx: i, rel, fpHash: fph, contentHash, buf });
}

async function executeCacheMisses(
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
    const workerDescs = scanner.plan.map((p) => ({
        name: p.name,
        modulePath: p.modulePath,
        options: p.options,
    }));
    const effWorkers = effectiveWorkers(cfg.workers, missFiles.length);
    const useWorkers = effWorkers > 1;
    const preloaded = new Map<string, Buffer>();
    for (const t of toAnalyze) if (t.buf) preloaded.set(t.rel, t.buf);

    let results: { issues: Issue[]; metric: FileMetric | null }[];
    let poolWarm = false;

    if (useWorkers && opts.pool) {
        const entry = opts.pool.getOrCreate(poolFp, cfg, workerDescs, effWorkers);
        poolWarm = entry.warm;
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
            opts.pool.touch(poolFp);
        } catch (e) {
            scanner.logger.warn(
                `persistent worker pool failed (${String(e)}); falling back to in-process`,
            );
            opts.pool.destroy(poolFp);
            results = await scanner.runInProcess(missFiles, absRoot, preloaded);
        }
        opts.pool.rssGuard();
    } else if (useWorkers) {
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
            scanner.logger.warn(
                `worker pool failed (${String(e)}); falling back to in-process scan`,
            );
            results = await scanner.runInProcess(missFiles, absRoot, preloaded);
        }
    } else {
        results = await scanner.runInProcess(missFiles, absRoot, preloaded);
    }

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
    return { analyzed, poolWarm };
}

async function executeIncrementalFiles(
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
        let result: { issues: Issue[]; metric: FileMetric | null };
        try {
            result = await scanner.runAnalyzers(t.rel, t.content, t.state);
        } catch (e) {
            scanner.logger.warn(
                `line-level incremental failed on ${t.rel}: ${String(e)}; full rescan`,
            );
            t.state.finalize();
            const fresh = new IncrementalFileState(t.content, t.contentHash);
            fresh.prepare(t.content, t.contentHash);
            incBucket.set(t.rel, fresh);
            try {
                result = await scanner.runAnalyzers(t.rel, t.content, fresh);
            } catch (e2) {
                scanner.logger.warn(
                    `seeded materialization failed on ${t.rel}: ${String(e2)}; unseeded rescan`,
                );
                result = await scanner.runAnalyzers(t.rel, t.content);
            }
        }
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
 * Execute a cached scan run over project files using L1/L2 caches and worker dispatch.
 *
 * @param scanner - Scanner execution context.
 * @param opts - Cache scan options including cache store, pool, and session.
 * @returns The assembled report paired with warm-scan stats (L1/L2 hits, analyzed, incremental).
 * Concurrency: asynchronous coordinator; safe for single-threaded caller.
 */
export async function executeScanWithCache(
    scanner: ScannerContext,
    opts: ScanWithCacheOptions,
): Promise<{ report: ScanReport; stats: WarmStats }> {
    const cfg = scanner.config;
    if (cfg.signal?.aborted) {
        throw new Error('Scan aborted by user');
    }
    const cache = opts.cache;
    const t0 = Date.now();
    const absRoot = path.resolve(cfg.root);
    const includeRx = cfg.include.map(globToRegExp);
    const excludeRx = cfg.exclude.map(globToRegExp);
    const giIgnore = cfg.respectGitignore ? loadGitignore(absRoot) : null;
    const files = collectFiles(absRoot, includeRx, excludeRx, giIgnore);
    scanner.logger.info(`discovered ${files.length} file(s) under ${absRoot}`);

    const fpContext = buildCacheFingerprintContext(cfg, scanner.plan, opts.cacheCustom);
    const session = opts.session || createWarmSession();
    const { sessionBucket, incBucket } = resolveSessionBuckets(session, fpContext.poolFp);

    const perFile: ({ issues: Issue[]; metric: FileMetric | null } | null)[] = new Array(
        files.length,
    );
    const incEnabled = incrementalEnabled() || cfg.incremental === true;
    const incMinLines = cfg.incrementalMinLines ?? incrementalMinLines();

    const queue: CacheAnalysisQueue = {
        toAnalyze: [],
        toIncremental: [],
        l2Refresh: [],
        l1Fps: [],
        l1Hit: 0,
        l2Hit: 0,
    };

    const statResults = collectStatFingerprints(absRoot, files);
    for (const s of statResults) {
        await probeSingleFileCache(
            s,
            absRoot,
            cache,
            fpContext,
            sessionBucket,
            incBucket,
            perFile,
            queue,
            incEnabled,
            incMinLines,
        );
    }

    const fpByRel = new Map<string, Fingerprint>(queue.l1Fps.map((w) => [w.rel, w.fp]));
    const missStats = await executeCacheMisses(
        scanner,
        queue.toAnalyze,
        files,
        absRoot,
        cfg,
        fpContext.poolFp,
        fpContext.l2Enabled,
        opts,
        sessionBucket,
        perFile,
        fpByRel,
        cache,
    );

    const incStats = await executeIncrementalFiles(
        scanner,
        queue.toIncremental,
        incBucket,
        fpContext.l2Enabled,
        sessionBucket,
        perFile,
        fpByRel,
        cache,
    );

    const incPruned = pruneIncrementalBucket(incBucket, incrementalMaxFiles());
    const incRssEvicted = incrementalRssGuard(session);
    if (incPruned > 0) {
        scanner.logger.debug(
            `incremental LRU: evicted ${incPruned} file state(s) (bucket=${incBucket.size})`,
        );
    }
    if (incRssEvicted > 0) {
        scanner.logger.warn(`incremental RSS guard: cleared ${incRssEvicted} file state(s)`);
    }

    for (const w of queue.l1Fps) cache.writeL1(w.rel, w.fp);
    for (const w of queue.l2Refresh) cache.writeL2(w.fpHash, w.contentHash, w.rel, w.result, w.fp);
    cache.flush();

    const issues: Issue[] = [];
    const fileMetrics: FileMetric[] = [];
    for (const r of perFile) {
        if (!r) continue;
        issues.push(...r.issues);
        if (r.metric) fileMetrics.push(r.metric);
    }
    issues.sort((a, b) => {
        if (a.location.file !== b.location.file) return a.location.file < b.location.file ? -1 : 1;
        if (a.location.start.line !== b.location.start.line) {
            return a.location.start.line - b.location.start.line;
        }
        if (a.analyzer !== b.analyzer) return a.analyzer < b.analyzer ? -1 : 1;
        return a.rule < b.rule ? -1 : 1;
    });

    const durationMs = Date.now() - t0;
    const report = scanner.buildReport(files.length, issues, fileMetrics, durationMs);
    const totalAnalyzed = missStats.analyzed + incStats.incrementalFiles;
    scanner.logger.info(
        `done in ${durationMs}ms: ${report.summary.issuesTotal} issue(s) ` +
            `[cache l1=${queue.l1Hit} l2=${queue.l2Hit} analyzed=${totalAnalyzed}/${files.length}]`,
    );

    const stats: WarmStats = {
        daemonUsed: false,
        l1Hit: queue.l1Hit,
        l2Hit: queue.l2Hit,
        cacheHit: queue.l1Hit + queue.l2Hit,
        cacheTotal: files.length,
        analyzed: totalAnalyzed,
        poolWarm: missStats.poolWarm,
        daemonMs: 0,
        incrementalFiles: incStats.incrementalFiles,
        incrementalHit: incStats.incrementalHit,
    };
    return { report, stats };
}
