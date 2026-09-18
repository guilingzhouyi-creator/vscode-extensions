/**
 * Module: Core Engine — Cache Probe & Miss Execution
 * File Path: src/core/scanner/cacheProbe.ts
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
import type { WorkerPoolManager } from '../workerPool';
import { sha256Hex } from '../cacheKey';
import { route, countLines } from '../incremental';
import { IncrementalFileState, touchIncremental } from '../incrementalState';
import type { ScannerContext } from './scannerContext';
import type { WarmSession, CacheFingerprintContext, StatResultEntry } from './cacheKeyHelper';
import { remapCachedResult } from './cacheKeyHelper';
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
 * Probe one file against L1 and L2 and queue the work its routing decision requires.
 *
 * @param s - Pre-read stat fingerprint and index of the file.
 * @param absRoot - Absolute root used to read the file when it must be analyzed.
 * @param cache - Two-level cache store backing the L1/L2 lookups.
 * @param fpContext - Pool fingerprint context of the current scan.
 * @param sessionBucket - Warm session results bucket of the pool fingerprint.
 * @param incBucket - Per-file incremental state bucket of the pool fingerprint.
 * @param perFile - Index-aligned per-file results the caller merges into the report.
 * @param queue - Routing work lists accumulated across the probed files.
 * @param incEnabled - Whether line-level incremental routing is enabled.
 * @param incMinLines - Minimum line count for incremental routing eligibility.
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
