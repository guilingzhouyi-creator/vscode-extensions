/**
 * Module: Core Engine — Diff & Incremental Scanner Pipeline
 * File Path: src/core/scanner/diffScanner.ts
 * Architecture Role: Diff-driven scan orchestrator coordinating hint routing, L1/L2, and delta.
 * Dependencies & Triggers: fs, path, ../types, ../cache, ../cacheKey, ../incremental,
 *   ../diff, ../utf8, ./scannerContext, ./cacheKeyHelper, ./workerScheduler.
 * Responsibilities: Normalize and validate diff hints, route byteEqual/incremental changes,
 *   fall back to disk bytes when necessary, and assemble full or delta reports.
 * Exit Semantics & Design Rationale: Decomposes scanWithDiff into isolated processing steps;
 *   guarantees byte-equivalence with full cold scans and caps cyclomatic complexity under 12.
 */

import * as path from 'path';
import type {
    ScanConfig,
    ScanReport,
    Issue,
    FileMetric,
    DiffInput,
    DiffStats,
    DiffDeltaReport,
} from '../types';
import type { CacheStore, Fingerprint } from '../cache';
import { incrementalEnabled, incrementalMinLines } from '../incremental';
import {
    IncrementalFileState,
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
    normalizeRelPath,
} from './cacheKeyHelper';
import {
    effectiveWorkers,
    computeHybridK,
    dispatchBatches,
    runWorkerPool,
} from './workerScheduler';

// Public option surface stays here for callers; the interface itself now lives with the
// hint-routing stage that consumes it.
export type { ScanWithDiffOptions } from './diffHints';

import {
    processChangedFileHint,
    processUnchangedFile,
    type DiffRoutingState,
    type ScanWithDiffOptions,
} from './diffHints';

async function executeDiffMissBatches(
    scanner: ScannerContext,
    toAnalyze: DiffRoutingState['toAnalyze'],
    files: string[],
    absRoot: string,
    cfg: ScanConfig,
    poolFp: string,
    l2Enabled: boolean,
    opts: ScanWithDiffOptions,
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

async function executeDiffIncrementalFiles(
    scanner: ScannerContext,
    toIncremental: DiffRoutingState['toIncremental'],
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
 * Execute diff-guided scan over project files using diff hints, L1/L2 caches, and incremental.
 *
 * @param scanner - Scanner execution context.
 * @param opts - Diff scan options including diffHints, cache, pool, and deltaOnly.
 * @returns The full or delta report paired with diff-routing and cache stats.
 * Concurrency: asynchronous coordinator; safe for single-threaded caller.
 */
export async function executeScanWithDiff(
    scanner: ScannerContext,
    opts: ScanWithDiffOptions,
): Promise<{ report: ScanReport | DiffDeltaReport; stats: DiffStats }> {
    const cfg = scanner.config;
    const cache = opts.cache;
    const deltaOnly = opts.deltaOnly === true;
    const t0 = Date.now();
    const absRoot = path.resolve(cfg.root);
    const includeRx = cfg.include.map(globToRegExp);
    const excludeRx = cfg.exclude.map(globToRegExp);
    const giIgnore = cfg.respectGitignore ? loadGitignore(absRoot) : null;

    const discovered = collectFiles(absRoot, includeRx, excludeRx, giIgnore);
    const discoveredSet = new Set(discovered);
    const hints = new Map<string, DiffInput>();
    let diffIgnored = 0;
    for (const d of opts.diffHints.values()) {
        const rel = normalizeRelPath(d.filePath, absRoot);
        if (!rel || !discoveredSet.has(rel)) {
            diffIgnored++;
            continue;
        }
        if (!hints.has(rel)) hints.set(rel, d);
    }

    const files: string[] = deltaOnly ? [...hints.keys()].sort() : discovered;
    scanner.logger.info(
        `diff scan: ${files.length} file(s) (diffHints=${hints.size}, ignored=${diffIgnored}, deltaOnly=${deltaOnly})`,
    );

    const fpContext = buildCacheFingerprintContext(cfg, scanner.plan, opts.cacheCustom);
    const session = opts.session || createWarmSession();
    const { sessionBucket, incBucket } = resolveSessionBuckets(session, fpContext.poolFp);

    const perFile: ({ issues: Issue[]; metric: FileMetric | null } | null)[] = new Array(
        files.length,
    );
    const incEnabled = incrementalEnabled() || cfg.incremental === true;
    const incMinLines = cfg.incrementalMinLines ?? incrementalMinLines();

    const routingState: DiffRoutingState = {
        l1Hit: 0,
        l2Hit: 0,
        diffFiles: 0,
        byteEqual: 0,
        diffIncremental: 0,
        diffFull: 0,
        rangesProvided: 0,
        rangesFallback: 0,
        oldContentFromDaemon: 0,
        toAnalyze: [],
        toIncremental: [],
        l2Refresh: [],
        l1Fps: [],
    };

    const statResults = collectStatFingerprints(absRoot, files);
    for (const s of statResults) {
        const i = s.idx;
        const rel = s.rel;
        if (s.fp) routingState.l1Fps.push({ rel, fp: s.fp });

        const diffInput = hints.get(rel);
        if (diffInput) {
            await processChangedFileHint(
                rel,
                diffInput,
                i,
                absRoot,
                fpContext,
                opts,
                incBucket,
                sessionBucket,
                perFile,
                cache,
                routingState,
                incEnabled,
                incMinLines,
                s,
                scanner,
            );
        } else {
            await processUnchangedFile(
                rel,
                i,
                s,
                absRoot,
                fpContext,
                incBucket,
                sessionBucket,
                perFile,
                cache,
                routingState,
                incEnabled,
                incMinLines,
            );
        }
    }

    const fpByRel = new Map<string, Fingerprint>(routingState.l1Fps.map((w) => [w.rel, w.fp]));
    const missStats = await executeDiffMissBatches(
        scanner,
        routingState.toAnalyze,
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

    const incStats = await executeDiffIncrementalFiles(
        scanner,
        routingState.toIncremental,
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

    for (const w of routingState.l1Fps) cache.writeL1(w.rel, w.fp);
    for (const w of routingState.l2Refresh)
        cache.writeL2(w.fpHash, w.contentHash, w.rel, w.result, w.fp);
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
        `diff scan done in ${durationMs}ms: ${report.summary.issuesTotal} issue(s) ` +
            `[diff=${routingState.diffFiles} byteEqual=${routingState.byteEqual} inc=${routingState.diffIncremental} full=${routingState.diffFull} analyzed=${totalAnalyzed}/${files.length}]`,
    );

    const stats: DiffStats = {
        daemonUsed: false,
        l1Hit: routingState.l1Hit,
        l2Hit: routingState.l2Hit,
        cacheHit: routingState.l1Hit + routingState.l2Hit,
        cacheTotal: files.length,
        analyzed: totalAnalyzed,
        poolWarm: missStats.poolWarm,
        daemonMs: 0,
        incrementalFiles: incStats.incrementalFiles,
        incrementalHit: incStats.incrementalHit,
        diffFiles: routingState.diffFiles,
        diffIgnored,
        byteEqual: routingState.byteEqual,
        diffIncremental: routingState.diffIncremental,
        diffFull: routingState.diffFull,
        rangesProvided: routingState.rangesProvided,
        rangesFallback: routingState.rangesFallback,
        oldContentFromDaemon: routingState.oldContentFromDaemon,
    };
    return { report: report as unknown as ScanReport | DiffDeltaReport, stats };
}
