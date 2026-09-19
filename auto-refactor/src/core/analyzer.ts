/**
 * Module: Core Engine — Scan Orchestration & Analyzer Execution
 * File Path: src/core/analyzer.ts
 * Architecture Role: Central scan engine: the Scanner facade that turns a ScanConfig into
 *   a ScanReport and owns cold, warm-cache, diff, worker-pool, and in-process paths.
 * Dependencies & Triggers: Imports types plus analyzerRegistry, workerPool, dependencyGraph,
 *   logger, gitignore, fileDiscovery, loadAnalyzer, traverse, adapters, multilang, cacheKey,
 *   cache, resultCodec, incremental/diff helpers, review memory, scoring, and trajectory
 *   modules; invoked by CLI/API scan commands and the daemon via Scanner.scan,
 *   scanWithCache, and scanWithDiff, and it spawns worker.js for parallel parsing.
 * Responsibilities: Discover files; select and run the worker pool, hybrid, or in-process
 *   parse+analyze path; dispatch file batches with pre-read zero-copy Buffers; run streaming
 *   analyzers in one deterministic traversal plus legacy analyze() analyzers; route L1/L2
 *   cache and line-level incremental work; enforce diff byte-equivalence; aggregate and sort
 *   issues; record review memory, quality scores, and trajectories; build the final report.
 * Exit Semantics & Design Rationale: User abort throws, but worker-pool failures fall back to
 *   in-process analysis, unreadable files yield empty results, and cache/incremental faults
 *   degrade to a full rescan so output stays byte-identical; analyzer errors become issues
 *   instead of killing the scan; `typescript` is required lazily so oxc-only runs stay light.
 */
import * as fs from 'fs';
import * as path from 'path';
import type {
    ScanConfig,
    ScanReport,
    Issue,
    FileMetric,
    WarmStats,
    DiffStats,
    DiffDeltaReport,
    ProjectArchetype,
    ActivatedReviewersSummary,
} from './types';
// NOTE: `../utils/ast` (and therefore `typescript`) stays lazily required so an oxc +
// no-legacy scan never loads it; that require now lives in scanner/analyzerRunner.ts.
import type { ResolvedAnalyzer } from './analyzerRegistry';
import { resolveAnalyzers } from './analyzerRegistry';
import { ModuleDependencyGraph } from './dependencyGraph';
import { Logger } from './logger';
import { loadGitignore } from './gitignore';
import { globToRegExp, collectFiles } from './fileDiscovery';
import type { IncrementalFileState } from './incrementalState';
import { ReviewMemoryManager } from './memory/reviewMemory';
import { SymbolIndex } from './intelligence/symbolIndex';
import { LiteralIndex } from './intelligence/literalIndex';
import { CallGraph } from './intelligence/callGraph';
import {
    buildLiteralClusterIssues,
    type LiteralClusterOptions,
} from './intelligence/literalClusters';
import { buildErrorFlowIssues, type ErrorFlowOptions } from './intelligence/errorFlow';
import { QualityScorer } from './scoring/qualityScorer';
import { ChangeTrajectoryManager } from './trajectory/changeTrajectory';
import { detectProjectArchetype } from './profiler/projectProfiler';
import { ALL_BUILTIN_ANALYZERS, routeArchetypeToAnalyzers } from './router/sparseRuleRouter';

// Re-export the analyzer contract so existing analyzer modules can keep importing
// `Analyzer` / `AnalyzerContext` from this engine file (backward-compatible surface).
export { Analyzer, AnalyzerContext } from './types';

export {
    ResolvedAnalyzer,
    WorkerAnalyzerDesc,
    resolveAnalyzers,
    BUILTIN_FACTORIES,
    BUILTIN_MODULE_PATHS,
} from './analyzerRegistry';
export { WorkerPoolManager, WorkerPoolEntry } from './workerPool';

import { pMap, AR_TIMING, nowMs } from './scanner/workerScheduler';
import { runFileAnalyzers } from './scanner/analyzerRunner';
import {
    mergePerFileResults,
    printScanTiming,
    runParseAnalyzeStage,
    sortIssues,
} from './scanner/scanStage';
import { buildScanReport } from './reporting/reportBuilder';
import type { ScanWithCacheOptions } from './scanner/cacheScanner';
import { executeScanWithCache } from './scanner/cacheScanner';
import type { ScanWithDiffOptions } from './scanner/diffScanner';
import { executeScanWithDiff } from './scanner/diffScanner';
import type { ScannerContext } from './scanner/scannerContext';

export { WarmSession, createWarmSession } from './scanner/cacheKeyHelper';
export type { ScanWithCacheOptions } from './scanner/cacheScanner';
export type { ScanWithDiffOptions } from './scanner/diffScanner';
export { summarizeUncertainty } from './reporting/uncertaintySummary';

/**
 * Facade for the scan pipeline: resolves analyzers once per instance and exposes cold,
 * warm-cache, and diff entry points that all emit the same report shape.
 *
 * The public `scan*` routines are async: they await worker threads or the in-process
 * scheduler and return only after every issue, metric, and cache write is merged. Cache and
 * session state live in caller objects, but the memory/trajectory writers are per-instance,
 * so concurrent calls on one instance would race and must be serialized by the caller.
 *
 * @param config - Resolved scan configuration; also seeds analyzer resolution and logging.
 * @param logger - Optional caller logger; when omitted a logger is built from `config`.
 */
export class Scanner implements ScannerContext {
    public plan: ResolvedAnalyzer[];
    public logger: Logger;
    /**
     * Import graph seeded during the scan (in-process path only); the consumer compares
     * its module count against fileMetrics to decide whether the graph is reusable.
     */
    private readonly graph = new ModuleDependencyGraph();
    private readonly reviewMemory: ReviewMemoryManager;
    /** Cross-file symbol store filled by the single traversal (see collectSymbols). */
    private readonly symbolIndex = new SymbolIndex();

    /** Cross-file literal store filled by the same traversal as the symbol index. */
    private readonly literalIndex = new LiteralIndex();
    private readonly trajectory = new ChangeTrajectoryManager();
    private readonly scorer: QualityScorer;
    private readonly archetype: ProjectArchetype;
    private readonly activatedReviewersSummary: ActivatedReviewersSummary;

    constructor(
        public config: ScanConfig,
        logger?: Logger,
    ) {
        this.logger = logger || new Logger(config.logLevel, config.logFile);
        this.plan = resolveAnalyzers(config, config.baseDir || process.cwd());
        this.reviewMemory = new ReviewMemoryManager(this.reviewMemoryDir(config));
        this.scorer = new QualityScorer(config.scoringWeights as any);

        const detectedArchetype =
            config.archetype ??
            config.profile?.archetype ??
            detectProjectArchetype(config.root, config.profile);
        this.archetype = detectedArchetype;

        const sparseResult = routeArchetypeToAnalyzers(detectedArchetype, {
            customAnalyzers: config.customAnalyzers?.map((c) => c.name),
        });
        // The routing decision is always computed so the report can explain the archetype, but it
        // only changes the analyzer set when sparseRouting is on. The `applied` flag marks that
        // difference so a reader never mistakes the advice for the set that actually ran.
        this.activatedReviewersSummary = {
            archetype: detectedArchetype,
            active: Array.from(sparseResult.activeAnalyzers).sort(),
            skipped: Array.from(sparseResult.skippedAnalyzers).sort(),
            activationRatio: sparseResult.activationRatio,
            reason: sparseResult.reason,
            applied: config.sparseRouting === true,
        };

        if (config.sparseRouting === true) {
            const activeSet = sparseResult.activeAnalyzers;
            const sparseConfig: ScanConfig = {
                ...config,
                analyzers: { ...config.analyzers },
            };
            for (const name of ALL_BUILTIN_ANALYZERS) {
                sparseConfig.analyzers[name] = {
                    ...(sparseConfig.analyzers[name] || {}),
                    enabled: activeSet.has(name),
                };
            }
            this.plan = resolveAnalyzers(sparseConfig, config.baseDir || process.cwd());
            this.logger.info(
                `sparse routing applied for archetype "${detectedArchetype}": ` +
                    `${this.plan.length} active, ${sparseResult.skippedAnalyzers.size} skipped`,
            );
        }

        this.logger.debug(
            `resolved ${this.plan.length} analyzer(s): ${this.plan.map((p) => p.name).join(', ') || '(none)'}`,
        );
    }

    /**
     * Resolve the review-memory directory for this scan.
     *
     * `cache: false` (`--no-cache`) promises that a scan leaves no trace on disk, so review memory
     * stays in-process: the dual-track pipeline still gets its records, but no
     * `.auto-refactor-cache/memory.jsonl` is read, appended or compacted. The load/append/compact
     * cycle measured ~4% of wall time on a 300-file scan, and writing a cache the caller disabled
     * was the real defect; the saving is a side effect of honouring the flag.
     *
     * @param config - Resolved scan config carrying the cache switch.
     * @returns Directory backing the manager, or `undefined` for a memory-only manager.
     */
    private reviewMemoryDir(config: ScanConfig): string | undefined {
        if (config.cacheEnabled === false) return undefined;
        return path.join(config.root, '.auto-refactor-cache');
    }

    /**
     * Expose the cross-file symbol index built during this scan.
     *
     * @returns The live index; callers may query it and must not mutate it.
     */
    getSymbolIndex(): SymbolIndex {
        return this.symbolIndex;
    }

    getReviewMemory(): ReviewMemoryManager {
        return this.reviewMemory;
    }

    getTrajectoryManager(): ChangeTrajectoryManager {
        return this.trajectory;
    }

    getQualityScorer(): QualityScorer {
        return this.scorer;
    }

    getPlan(): ResolvedAnalyzer[] {
        return this.plan;
    }

    getConfig(): ScanConfig {
        return this.config;
    }

    getArchetype(): ProjectArchetype {
        return this.archetype;
    }

    getActivatedReviewers(): ActivatedReviewersSummary {
        return this.activatedReviewersSummary;
    }

    /**
     * Cross-file literal clusters from the shared literal store (read-only).
     *
     * @param options - Optional thresholds forwarded to the cluster findings builder.
     * @returns Review findings for shared multi-meaning values.
     */
    getLiteralClusterIssues(
        options: LiteralClusterOptions = {},
    ): ReturnType<typeof buildLiteralClusterIssues> {
        return buildLiteralClusterIssues(this.literalIndex, options);
    }

    /**
     * Shared literal store filled by the scan traversal (read-only).
     *
     * @returns The cross-file literal index.
     */
    getLiteralIndex(): LiteralIndex {
        return this.literalIndex;
    }

    /**
     * Cross-file call graph derived from the shared symbol index.
     *
     * @returns The call graph instance.
     */
    getCallGraph(): CallGraph {
        return new CallGraph(this.symbolIndex);
    }

    /**
     * Error propagation chain issues derived from the shared literal store and call graph.
     *
     * @param options - Optional thresholds and patterns forwarded to the error-flow builder.
     * @returns Review findings for duplicated or far-propagating error codes.
     */
    getErrorFlowIssues(options: ErrorFlowOptions = {}): ReturnType<typeof buildErrorFlowIssues> {
        return buildErrorFlowIssues(this.literalIndex, this.getCallGraph(), options);
    }

    /**
     * Accessor for the import graph seeded during the scan.
     * Returns null when this instance seeded nothing (e.g. every file was a cache hit).
     * The consumer (api-level post-scan) must compare the module count with fileMetrics
     * and reuse the graph only when coverage is complete; otherwise it rereads the files.
     */
    getDependencyGraph(): ModuleDependencyGraph | null {
        return this.graph.getModules().length > 0 ? this.graph : null;
    }
    /**
     * Execute the scan pipeline.
     *
     * Pipeline (serial stages) + scheduling policy:
     *   1. discover files          (serial, sorted)
     *   2. for each file (parallel, up to `concurrency`):
     *        a. parse to SourceFile
     *        b. run analyzers via the single-pass multiplexed traversal — every streaming
     *           analyzer shares ONE descent over the normalized tree, dispatched serially
     *           in topological order (deterministic); legacy `analyze`-only analyzers run
     *           afterwards, still serially.
     *   3. aggregate issues + metrics (serial)
     *   4. build report
     *
     * Files are independent of each other → safe to parallelize at the file level.
     * Analyzers are pure functions of (sourceFile, ctx) → Issues, so they are also independent
     * within a file; they run in a single serial pass to keep output deterministic.
     *
     * This method is async and awaits the worker threads or the in-process scheduler; it
     * mutates only this Scanner's memory/trajectory writers, so concurrent scans on one
     * instance must be serialized by the caller.
     *
     * @returns The assembled scan report: sorted issues, per-file metrics, and summary counts.
     * @throws Error - When `config.signal` is already aborted at entry; the rejection message
     *     is 'Scan aborted by user'.
     */
    async scan(): Promise<ScanReport> {
        const cfg = this.config;
        if (cfg.signal?.aborted) {
            throw new Error('Scan aborted by user');
        }
        const t0 = Date.now();
        const absRoot = path.resolve(cfg.root);
        const includeRx = cfg.include.map(globToRegExp);
        const excludeRx = cfg.exclude.map(globToRegExp);
        const giIgnore = cfg.respectGitignore ? loadGitignore(absRoot) : null;
        const files = collectFiles(absRoot, includeRx, excludeRx, giIgnore);
        this.logger.info(`discovered ${files.length} file(s) under ${absRoot}`);
        // AR_TIMING uses performance.now() (module-level nowMs) so all stage deltas share one base.
        const startAt = AR_TIMING ? nowMs() : 0;

        const perFile = await runParseAnalyzeStage(this, files, absRoot);
        const parseAnalyzeAt = AR_TIMING ? nowMs() : 0;

        const { issues, fileMetrics } = mergePerFileResults(perFile);
        sortIssues(issues);
        const sortedAt = AR_TIMING ? nowMs() : 0;

        const durationMs = Date.now() - t0;
        const report = this.buildReport(files.length, issues, fileMetrics, durationMs);
        this.logger.info(
            `done in ${durationMs}ms: ${report.summary.issuesTotal} issue(s) ` +
                `[error=${report.summary.bySeverity.error}, warning=${report.summary.bySeverity.warning}, info=${report.summary.bySeverity.info}]`,
        );
        printScanTiming({ startAt, discoverAt: startAt, parseAnalyzeAt, sortedAt, durationMs });
        return report;
    }

    /**
     * Warm-scan pipeline (docs/01-architecture/02-pipeline-and-caching.md §B5): the SAME
     * aggregation as `scan()` but with
     * L1 stat skip + L2 content-hash reuse before the worker pool dispatch. Only L2-miss files
     * are analyzed. Cached per-file results are placed into the SAME index-aligned perFile
     * array, then `issues.sort` + `buildReport` run unchanged → byte-identical output.
     *
     * With an empty cache this degenerates to a full cold scan (every file L2-miss → analyzed).
     * Cache writes are buffered and flushed atomically at the end (never fatal on failure);
     * the method is async and awaits the worker pool before returning the assembled report.
     *
     * @param opts - Caller-owned cache plus the optional cross-scan session/pool and the
     *     custom-analyzer L2 opt-in; the scanner reads and writes these collaborators but
     *     never constructs or disposes them.
     * @returns The assembled report paired with `WarmStats` counters: L1/L2 cache hits,
     *     analyzed files, pool warmth, and incremental reuse.
     * @throws Error - When `config.signal` is already aborted at entry; the rejection message
     *     is 'Scan aborted by user'.
     */
    async scanWithCache(
        opts: ScanWithCacheOptions,
    ): Promise<{ report: ScanReport; stats: WarmStats }> {
        return executeScanWithCache(this, opts);
    }

    /**
     * Diff-scan pipeline (docs/03-incremental-and-diff/02-diff-interface-spec.md §1.7 / §3).
     * Additive to `scanWithCache`:
     * changed files from `diffHints` are pre-routed (byteEqual → L2 reuse, incremental → subtree
     * reuse, full → plain rescan) BEFORE the L1/L2 decision; unchanged files keep the normal warm
     * path. `deltaOnly=true` (scanDiffDelta) restricts the report to the diff files and skips the
     * unchanged-file discovery/L1/L2 entirely — its report is a subset of the full report, with
     * every (file, issue) byte-identical to the full scan's corresponding entry.
     *
     * Byte-equivalence invariants (§3.3): the report covers ALL discovered files (full mode); the
     * canonical newContent is the DISK content (the diff system's newContent is only a hint, and a
     * mismatch triggers a plain full rescan); L2 writes hash the disk bytes; filePath is normalized
     * to a rel path and non-discovered entries are dropped (diffIgnored).
     *
     * The overload set is async: the implementation awaits the same worker pool as
     * `scanWithCache` and returns only after the report and stats are fully assembled.
     *
     * @param opts - Diff hints plus the warm-scan collaborators and the optional `deltaOnly`
     *     switch that restricts the report to the changed files.
     * @returns The full report, or the delta report when `deltaOnly` is true, paired with
     *     `DiffStats` routing counters (byteEqual/incremental/full and ignored inputs).
     */
    async scanWithDiff(
        opts: ScanWithDiffOptions & { deltaOnly?: false },
    ): Promise<{ report: ScanReport; stats: DiffStats }>;
    async scanWithDiff(
        opts: ScanWithDiffOptions & { deltaOnly: true },
    ): Promise<{ report: DiffDeltaReport; stats: DiffStats }>;
    async scanWithDiff(
        opts: ScanWithDiffOptions & { deltaOnly?: boolean },
    ): Promise<{ report: ScanReport | DiffDeltaReport; stats: DiffStats }> {
        return executeScanWithDiff(this, opts);
    }

    /**
     * Parse+analyze one file via the single-pass multiplexed traversal (language-agnostic).
     *
     * The file's language adapter is selected by extension; the adapter parses the content into
     * a normalized tree and all streaming analyzers (those implementing `visit`/`finalize`) share
     * ONE descent over it, driven by `runStreaming`, together with a `FileMetricCollector` that
     * produces the per-file `FileMetric`. Each streaming analyzer gets a FRESH instance so its
     * visit/finalize state is never shared across concurrently scanned files. Analyzers without
     * `visit` keep using the legacy `analyze` path (e.g. external plug-ins) — those are
     * TypeScript-only by contract, so they run only when a ts.SourceFile exists.
     *
     * The routine is async and awaits parser/analyzer work; each concurrent file call gets fresh
     * streaming instances, so the method is reentrant across await points.
     *
     * @param rel - Repository-relative POSIX path that selects the language adapter.
     * @param content - Raw file content already read by the caller; no second disk read happens.
     * @param seed - Previous incremental state for this file; when present it forces the
     *     materialized parse path so unchanged subtrees can be reused.
     * @param activeAnalyzers - Optional allow-list of analyzer names; omitted means the full
     *     resolved plan runs.
     * @returns The file's issues and its per-file metric summary.
     */
    public async runAnalyzers(
        rel: string,
        content: string,
        seed?: IncrementalFileState,
        activeAnalyzers?: Set<string>,
    ): Promise<{ issues: Issue[]; metric: FileMetric | null }> {
        return runFileAnalyzers(
            {
                config: this.config,
                plan: this.plan,
                logger: this.logger,
                graph: this.graph,
                symbolIndex: this.symbolIndex,
                literalIndex: this.literalIndex,
            },
            rel,
            content,
            seed,
            activeAnalyzers,
        );
    }

    /**
     * Single-process execution of the parse+analyze stage (also the automatic fallback when the
     * worker pool is unavailable). Reads + parses each file on the main thread, bounded by
     * `concurrency` in-flight files; the multiplexed traversal runs once per file.
     * `preloaded` (cache path) supplies already-read buffers to avoid a second read.
     *
     * The method is async and awaits the bounded pMap scheduler; each file task owns its parser
     * state, but the call still shares this Scanner's dependency graph, so callers must
     * serialize scans on one instance.
     *
     * @param files - Relative paths of files to parse and analyze.
     * @param absRoot - Absolute root path of the project.
     * @param preloaded - Optional pre-read buffers to avoid reading files from disk again.
     * @returns Array of issues and metrics for each file.
     *
     * Concurrency: Concurrency-safe across independent file tasks via pMap.
     */
    public async runInProcess(
        files: string[],
        absRoot: string,
        preloaded?: Map<string, Buffer>,
    ): Promise<{ issues: Issue[]; metric: FileMetric | null }[]> {
        const cfg = this.config;
        return pMap(files, Math.max(1, cfg.concurrency | 0), async (rel) => {
            const abs = path.join(absRoot, rel);
            let content: string;
            try {
                const pre = preloaded && preloaded.get(rel);
                content = pre ? pre.toString('utf8') : await fs.promises.readFile(abs, 'utf8');
            } catch (e) {
                this.logger.warn(`skip unreadable file ${rel}: ${String(e)}`);
                return { issues: [] as Issue[], metric: null as FileMetric | null };
            }
            return this.runAnalyzers(rel, content);
        });
    }

    /**
     * Build unified ScanReport from scanned files, collected issues, and metrics.
     *
     * @param filesScanned - Total count of files scanned.
     * @param issues - Aggregated issues list.
     * @param fileMetrics - Per-file metric records.
     * @param durationMs - Total scan duration in milliseconds.
     * @returns Assembled ScanReport structure.
     */
    public buildReport(
        filesScanned: number,
        issues: Issue[],
        fileMetrics: FileMetric[],
        durationMs: number,
    ): ScanReport {
        return buildScanReport(
            {
                config: this.config,
                scorer: this.scorer,
                reviewMemory: this.reviewMemory,
                trajectory: this.trajectory,
                symbolIndex: this.symbolIndex,
                literalIndex: this.literalIndex,
                activatedReviewers: this.activatedReviewersSummary,
            },
            filesScanned,
            issues,
            fileMetrics,
            durationMs,
        );
    }
}
