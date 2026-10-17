/**
 * Module: Core Engine — Diff & Incremental Scanner Pipeline
 * File Path: src/core/scanner/diff-scanner.ts
 * Architecture Role: Diff-driven scan orchestrator coordinating hint routing, L1/L2, and delta.
 * Dependencies & Triggers: fs, path, ../types, ../cache, ../cacheKey, ../incremental,
 *   ../diff, ../utf8, ./scannerContext, ./cacheKeyHelper, ./workerScheduler.
 * Responsibilities: Normalize and validate diff hints, route byteEqual/incremental changes,
 *   fall back to disk bytes when necessary, and assemble full or delta reports.
 * Exit Semantics & Design Rationale: Decomposes scanWithDiff into isolated processing steps;
 *   guarantees byte-equivalence with full cold scans and caps cyclomatic complexity under 12.
 */
import { hasWorkerPool } from './scan-guards';

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
import type { WorkerAnalyzerDesc } from '../analyzer-registry';
import { incrementalEnabled, incrementalMinLines } from '../diff/incremental';
import {
    IncrementalFileState,
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
    normalizeRelPath,
} from './cache-key-helper';
import {
    effectiveWorkers,
    computeHybridK,
    dispatchBatches,
    runWorkerPool,
} from './worker-scheduler';

// Public option surface stays here for callers; the interface itself now lives with the
// hint-routing stage that consumes it.
export type { ScanWithDiffOptions } from './diff-hints';

import {
    processChangedFileHint,
    processUnchangedFile,
    type DiffRoutingState,
    type ScanWithDiffOptions,
} from './diff-hints';

interface PersistentPoolContext {
    readonly scanner: ScannerContext;
    readonly missFiles: string[];
    readonly absRoot: string;
    readonly cfg: ScanConfig;
    readonly poolFp: string;
    readonly opts: ScanWithDiffOptions;
    readonly preloaded: Map<string, Buffer>;
    readonly workerDescs: WorkerAnalyzerDesc[];
    readonly effWorkers: number;
}

interface TransientPoolContext {
    readonly scanner: ScannerContext;
    readonly missFiles: string[];
    readonly absRoot: string;
    readonly cfg: ScanConfig;
    readonly preloaded: Map<string, Buffer>;
    readonly workerDescs: WorkerAnalyzerDesc[];
    readonly effWorkers: number;
}

interface RecordAnalyzedContext {
    readonly toAnalyze: DiffRoutingState['toAnalyze'];
    readonly results: { issues: Issue[]; metric: FileMetric | null }[];
    readonly perFile: ({ issues: Issue[]; metric: FileMetric | null } | null)[];
    readonly sessionBucket: Map<string, { issues: Issue[]; metric: FileMetric | null }>;
    readonly l2Enabled: boolean;
    readonly cache: CacheStore;
    readonly fpByRel: Map<string, Fingerprint>;
}

interface DiffMissBatchesContext {
    readonly scanner: ScannerContext;
    readonly toAnalyze: DiffRoutingState['toAnalyze'];
    readonly files: string[];
    readonly absRoot: string;
    readonly cfg: ScanConfig;
    readonly poolFp: string;
    readonly l2Enabled: boolean;
    readonly opts: ScanWithDiffOptions;
    readonly sessionBucket: Map<string, { issues: Issue[]; metric: FileMetric | null }>;
    readonly perFile: ({ issues: Issue[]; metric: FileMetric | null } | null)[];
    readonly fpByRel: Map<string, Fingerprint>;
    readonly cache: CacheStore;
}

interface DiffIncrementalFilesContext {
    readonly scanner: ScannerContext;
    readonly toIncremental: DiffRoutingState['toIncremental'];
    readonly incBucket: Map<string, IncrementalFileState>;
    readonly l2Enabled: boolean;
    readonly sessionBucket: Map<string, { issues: Issue[]; metric: FileMetric | null }>;
    readonly perFile: ({ issues: Issue[]; metric: FileMetric | null } | null)[];
    readonly fpByRel: Map<string, Fingerprint>;
    readonly cache: CacheStore;
}

interface CommitRoutingContext {
    readonly routingState: DiffRoutingState;
    readonly cache: CacheStore;
    readonly incBucket: Map<string, IncrementalFileState>;
    readonly session: ReturnType<typeof createWarmSession>;
    readonly scanner: ScannerContext;
}

interface CreateDiffStatsContext {
    readonly routingState: DiffRoutingState;
    readonly totalFiles: number;
    readonly totalAnalyzed: number;
    readonly missStats: { poolWarm: boolean };
    readonly incStats: { incrementalFiles: number; incrementalHit: number };
    readonly diffIgnored: number;
}

async function runWithPersistentPool(
    ctx: PersistentPoolContext,
): Promise<{ results: { issues: Issue[]; metric: FileMetric | null }[]; poolWarm: boolean }> {
    const entry = ctx.opts.pool!.getOrCreate(ctx.poolFp, ctx.cfg, ctx.workerDescs, ctx.effWorkers);
    const poolWarm = entry.warm;
    let results: { issues: Issue[]; metric: FileMetric | null }[];
    try {
        results = await dispatchBatches({
            workers: entry.workers,
            workerIdx: entry.workerIdx,
            files: ctx.missFiles,
            absRoot: ctx.absRoot,
            config: ctx.cfg,
            descs: ctx.workerDescs,
            numWorkers: entry.n,
            logger: ctx.scanner.logger,
            runAnalyzersFn: (rel, content) => ctx.scanner.runAnalyzers(rel, content),
            hybridK: entry.warm ? 0 : computeHybridK(ctx.cfg, ctx.missFiles.length, entry.n),
            keepAlive: true,
            fp: ctx.poolFp,
            preloaded: ctx.preloaded,
        });
        entry.warm = true;
        entry.lastUsed = Date.now();
        ctx.opts.pool!.touch(ctx.poolFp);
    } catch (e) {
        ctx.scanner.logger.warn(
            `persistent worker pool failed (${String(e)}); falling back to in-process`,
        );
        ctx.opts.pool!.destroy(ctx.poolFp);
        results = await ctx.scanner.runInProcess(ctx.missFiles, ctx.absRoot, ctx.preloaded);
    }
    ctx.opts.pool!.rssGuard();
    return { results, poolWarm };
}

async function runWithTransientPool(
    ctx: TransientPoolContext,
): Promise<{ results: { issues: Issue[]; metric: FileMetric | null }[]; poolWarm: boolean }> {
    let results: { issues: Issue[]; metric: FileMetric | null }[];
    try {
        results = await runWorkerPool({
            files: ctx.missFiles,
            absRoot: ctx.absRoot,
            config: ctx.cfg,
            descs: ctx.workerDescs,
            numWorkers: ctx.effWorkers,
            logger: ctx.scanner.logger,
            runAnalyzersFn: (rel, content) => ctx.scanner.runAnalyzers(rel, content),
            preloaded: ctx.preloaded,
        });
    } catch (e) {
        ctx.scanner.logger.warn(
            `worker pool failed (${String(e)}); falling back to in-process scan`,
        );
        results = await ctx.scanner.runInProcess(ctx.missFiles, ctx.absRoot, ctx.preloaded);
    }
    return { results, poolWarm: false };
}

function recordAnalyzedResults(ctx: RecordAnalyzedContext): number {
    let analyzed = 0;
    for (let k = 0; k < ctx.toAnalyze.length; k++) {
        const t = ctx.toAnalyze[k];
        ctx.perFile[t.idx] = ctx.results[k];
        ctx.sessionBucket.set(t.rel, ctx.results[k]);
        analyzed++;
        if (ctx.l2Enabled) {
            ctx.cache.writeL2(
                t.fpHash,
                t.contentHash,
                t.rel,
                ctx.results[k],
                ctx.fpByRel.get(t.rel),
            );
        }
    }
    return analyzed;
}

async function executeDiffMissBatches(
    ctx: DiffMissBatchesContext,
): Promise<{ analyzed: number; poolWarm: boolean }> {
    if (ctx.toAnalyze.length === 0) return { analyzed: 0, poolWarm: false };
    const missFiles = ctx.toAnalyze.map((t) => ctx.files[t.idx]);
    const workerDescs: WorkerAnalyzerDesc[] = ctx.scanner.plan.map((p) => ({
        name: p.name,
        modulePath: p.modulePath,
        options: (p.options ?? {}) as Record<string, any>,
    }));
    const effWorkers = effectiveWorkers(ctx.cfg.workers, missFiles.length);
    const useWorkers = effWorkers > 1;
    const preloaded = new Map<string, Buffer>();
    ctx.toAnalyze.forEach((item) => {
        if (item.buf) preloaded.set(item.rel, item.buf);
    });

    let batchResult: {
        results: { issues: Issue[]; metric: FileMetric | null }[];
        poolWarm: boolean;
    };
    if (hasWorkerPool(useWorkers, ctx.opts)) {
        batchResult = await runWithPersistentPool({
            scanner: ctx.scanner,
            missFiles,
            absRoot: ctx.absRoot,
            cfg: ctx.cfg,
            poolFp: ctx.poolFp,
            opts: ctx.opts,
            preloaded,
            workerDescs,
            effWorkers,
        });
    } else if (useWorkers) {
        batchResult = await runWithTransientPool({
            scanner: ctx.scanner,
            missFiles,
            absRoot: ctx.absRoot,
            cfg: ctx.cfg,
            preloaded,
            workerDescs,
            effWorkers,
        });
    } else {
        const inProcResults = await ctx.scanner.runInProcess(missFiles, ctx.absRoot, preloaded);
        batchResult = { results: inProcResults, poolWarm: false };
    }

    const analyzed = recordAnalyzedResults({
        toAnalyze: ctx.toAnalyze,
        results: batchResult.results,
        perFile: ctx.perFile,
        sessionBucket: ctx.sessionBucket,
        l2Enabled: ctx.l2Enabled,
        cache: ctx.cache,
        fpByRel: ctx.fpByRel,
    });
    return { analyzed, poolWarm: batchResult.poolWarm };
}

async function runSingleIncrementalAnalysis(
    scanner: ScannerContext,
    t: DiffRoutingState['toIncremental'][number],
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
    t: DiffRoutingState['toIncremental'][number],
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

async function executeDiffIncrementalFiles(
    ctx: DiffIncrementalFilesContext,
): Promise<{ incrementalFiles: number; incrementalHit: number }> {
    let incrementalFiles = 0;
    let incrementalHit = 0;

    for (const t of ctx.toIncremental) {
        const result = await runSingleIncrementalAnalysis(ctx.scanner, t, ctx.incBucket);
        t.state.finalize();
        ctx.perFile[t.idx] = result;
        ctx.sessionBucket.set(t.rel, result);
        incrementalHit += t.state.reuseHits;
        incrementalFiles++;
        if (ctx.l2Enabled) {
            ctx.cache.writeL2(t.fpHash, t.contentHash, t.rel, result, ctx.fpByRel.get(t.rel));
        }
    }
    return { incrementalFiles, incrementalHit };
}

function filterDiffHints(
    diffHints: Iterable<DiffInput>,
    discoveredSet: Set<string>,
    absRoot: string,
): { hints: Map<string, DiffInput>; diffIgnored: number } {
    const hints = new Map<string, DiffInput>();
    let diffIgnored = 0;
    for (const d of diffHints) {
        const rel = normalizeRelPath(d.filePath, absRoot);
        if (!rel || !discoveredSet.has(rel)) {
            diffIgnored++;
            continue;
        }
        if (!hints.has(rel)) hints.set(rel, d);
    }
    return { hints, diffIgnored };
}

function compareIssues(a: Issue, b: Issue): number {
    if (a.location.file !== b.location.file) return a.location.file < b.location.file ? -1 : 1;
    if (a.location.start.line !== b.location.start.line) {
        return a.location.start.line - b.location.start.line;
    }
    if (a.analyzer !== b.analyzer) return a.analyzer < b.analyzer ? -1 : 1;
    return a.rule < b.rule ? -1 : 1;
}

function aggregateScanResults(perFile: ({ issues: Issue[]; metric: FileMetric | null } | null)[]): {
    issues: Issue[];
    fileMetrics: FileMetric[];
} {
    const issues: Issue[] = [];
    const fileMetrics: FileMetric[] = [];
    for (const r of perFile) {
        if (!r) continue;
        issues.push(...r.issues);
        if (r.metric) fileMetrics.push(r.metric);
    }
    issues.sort(compareIssues);
    return { issues, fileMetrics };
}

function commitRoutingCaches(ctx: CommitRoutingContext): void {
    const incPruned = pruneIncrementalBucket(ctx.incBucket, incrementalMaxFiles());
    const incRssEvicted = incrementalRssGuard(ctx.session);
    if (incPruned > 0) {
        ctx.scanner.logger.debug(
            `incremental LRU: evicted ${incPruned} file state(s) (bucket=${ctx.incBucket.size})`,
        );
    }
    if (incRssEvicted > 0) {
        ctx.scanner.logger.warn(`incremental RSS guard: cleared ${incRssEvicted} file state(s)`);
    }

    ctx.routingState.l1Fps.forEach((item) => ctx.cache.writeL1(item.rel, item.fp));
    ctx.routingState.l2Refresh.forEach((item) => {
        ctx.cache.writeL2(item.fpHash, item.contentHash, item.rel, item.result, item.fp);
    });
    ctx.cache.flush();
}

function createDiffStats(ctx: CreateDiffStatsContext): DiffStats {
    return {
        daemonUsed: false,
        l1Hit: ctx.routingState.l1Hit,
        l2Hit: ctx.routingState.l2Hit,
        cacheHit: ctx.routingState.l1Hit + ctx.routingState.l2Hit,
        cacheTotal: ctx.totalFiles,
        analyzed: ctx.totalAnalyzed,
        poolWarm: ctx.missStats.poolWarm,
        daemonMs: 0,
        incrementalFiles: ctx.incStats.incrementalFiles,
        incrementalHit: ctx.incStats.incrementalHit,
        diffFiles: ctx.routingState.diffFiles,
        diffIgnored: ctx.diffIgnored,
        byteEqual: ctx.routingState.byteEqual,
        diffIncremental: ctx.routingState.diffIncremental,
        diffFull: ctx.routingState.diffFull,
        rangesProvided: ctx.routingState.rangesProvided,
        rangesFallback: ctx.routingState.rangesFallback,
        oldContentFromDaemon: ctx.routingState.oldContentFromDaemon,
    };
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
    const { hints, diffIgnored } = filterDiffHints(opts.diffHints.values(), discoveredSet, absRoot);

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
    const missStats = await executeDiffMissBatches({
        scanner,
        toAnalyze: routingState.toAnalyze,
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

    const incStats = await executeDiffIncrementalFiles({
        scanner,
        toIncremental: routingState.toIncremental,
        incBucket,
        l2Enabled: fpContext.l2Enabled,
        sessionBucket,
        perFile,
        fpByRel,
        cache,
    });

    commitRoutingCaches({ routingState, cache, incBucket, session, scanner });

    const { issues, fileMetrics } = aggregateScanResults(perFile);
    const durationMs = Date.now() - t0;
    const report = scanner.buildReport(files.length, issues, fileMetrics, durationMs);
    const totalAnalyzed = missStats.analyzed + incStats.incrementalFiles;
    scanner.logger.info(
        `diff scan done in ${durationMs}ms: ${report.summary.issuesTotal} issue(s) ` +
            `[diff=${routingState.diffFiles} byteEqual=${routingState.byteEqual} inc=${routingState.diffIncremental} full=${routingState.diffFull} analyzed=${totalAnalyzed}/${files.length}]`,
    );

    const stats = createDiffStats({
        routingState,
        totalFiles: files.length,
        totalAnalyzed,
        missStats,
        incStats,
        diffIgnored,
    });
    return { report: report as unknown as ScanReport | DiffDeltaReport, stats };
}
