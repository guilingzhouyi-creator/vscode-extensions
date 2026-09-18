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

import * as path from 'path';
import type { ScanReport, Issue, FileMetric, WarmStats } from '../types';
import type { Fingerprint } from '../cache';
import { incrementalEnabled, incrementalMinLines } from '../incremental';
import {
    pruneIncrementalBucket,
    incrementalRssGuard,
    incrementalMaxFiles,
} from '../incrementalState';
import { globToRegExp, collectFiles } from '../fileDiscovery';
import { loadGitignore } from '../gitignore';
import type { ScannerContext } from './scannerContext';
import {
    createWarmSession,
    buildCacheFingerprintContext,
    resolveSessionBuckets,
    collectStatFingerprints,
} from './cacheKeyHelper';

// Public option surface stays here for callers; the interfaces themselves now live with the
// probe stage that consumes them.
export type { ScanWithCacheOptions } from './cacheProbe';

import {
    probeSingleFileCache,
    executeCacheMisses,
    executeIncrementalFiles,
    type CacheAnalysisQueue,
    type ScanWithCacheOptions,
} from './cacheProbe';

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
