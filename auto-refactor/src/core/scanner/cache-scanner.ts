/**
 * Module: Core Engine — Two-Level Cache Scanner Pipeline
 * File Path: src/core/scanner/cache-scanner.ts
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
import { incrementalEnabled, incrementalMinLines } from '../diff/incremental';
import {
    pruneIncrementalBucket,
    incrementalRssGuard,
    incrementalMaxFiles,
} from '../diff/incremental-state';
import { globToRegExp, collectFiles } from '../file-discovery';
import { loadGitignore } from '../policy/gitignore';
import type { ScannerContext } from './scanner-context';
import {
    createWarmSession,
    buildCacheFingerprintContext,
    resolveSessionBuckets,
    collectStatFingerprints,
} from './cache-key-helper';

// Public option surface stays here for callers; the interfaces themselves now live with the
// probe stage that consumes them.
export type { ScanWithCacheOptions } from './cache-probe';

import {
    probeSingleFileCache,
    executeCacheMisses,
    executeIncrementalFiles,
    type CacheAnalysisQueue,
    type ScanWithCacheOptions,
} from './cache-probe';

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
    const startTimeMs = Date.now();
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

    const statResults = await collectStatFingerprints(absRoot, files);
    for (const statEntry of statResults) {
        await probeSingleFileCache({
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
        });
    }

    const fpByRel = new Map<string, Fingerprint>(queue.l1Fps.map((entry) => [entry.rel, entry.fp]));
    const missStats = await executeCacheMisses({
        scanner,
        toAnalyze: queue.toAnalyze,
        files,
        absRoot,
        cfg,
        poolFp: fpContext.poolFp,
        l2Enabled: fpContext.l2Enabled,
        opts,
        sessionBucket,
        perFile,
        fpByRel,
        cache,
    });

    const incStats = await executeIncrementalFiles({
        scanner,
        toIncremental: queue.toIncremental,
        incBucket,
        l2Enabled: fpContext.l2Enabled,
        sessionBucket,
        perFile,
        fpByRel,
        cache,
    });

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

    for (const entry of queue.l1Fps) cache.writeL1(entry.rel, entry.fp);
    for (const item of queue.l2Refresh)
        cache.writeL2(item.fpHash, item.contentHash, item.rel, item.result, item.fp);
    await cache.flushAsync();

    const issues: Issue[] = [];
    const fileMetrics: FileMetric[] = [];
    for (const result of perFile) {
        if (!result) continue;
        scanner.ingestFileSummaries?.(result);
        issues.push(...result.issues);
        if (result.metric) fileMetrics.push(result.metric);
    }
    issues.sort((issueA, issueB) => {
        if (issueA.location.file !== issueB.location.file)
            return issueA.location.file < issueB.location.file ? -1 : 1;
        if (issueA.location.start.line !== issueB.location.start.line) {
            return issueA.location.start.line - issueB.location.start.line;
        }
        if (issueA.analyzer !== issueB.analyzer) return issueA.analyzer < issueB.analyzer ? -1 : 1;
        return issueA.rule < issueB.rule ? -1 : 1;
    });

    const durationMs = Date.now() - startTimeMs;
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
