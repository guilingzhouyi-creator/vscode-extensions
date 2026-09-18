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
import type * as ts from 'typescript';
import type {
    ScanConfig,
    ScanReport,
    Issue,
    Severity,
    FileMetric,
    AnalyzerContext,
    WarmStats,
    DiffStats,
    DiffDeltaReport,
    ProjectArchetype,
    ActivatedReviewersSummary,
} from './types';
// NOTE: `../utils/ast` (and therefore `typescript`) is intentionally NOT imported at the
// top level — the worker side stays lazy, and the MAIN process follows the same rule
// so an oxc + no-legacy scan never loads `typescript`. The only consumer is the
// legacy plug-in branch below, which requires it lazily (same pattern as worker.ts).
import { countLineStats } from '../utils/linestats';
import type { ResolvedAnalyzer } from './analyzerRegistry';
import { resolveAnalyzers } from './analyzerRegistry';
import { ModuleDependencyGraph } from './dependencyGraph';
import { Logger } from './logger';
import { loadGitignore } from './gitignore';
import { globToRegExp, collectFiles } from './fileDiscovery';
import type { StreamingEntry } from './traverse';
import {
    runStreaming,
    runStreamingProjected,
    FileMetricCollector,
    tryCreateProjector,
} from './traverse';
import { adapterFor } from './adapters';
import { unsupportedLanguageDiagnostic } from './languageSupport';
import type { NodeProjector, NormalizedAst, NormalizedNode } from './multilang';
import { sha256Hex } from './cacheKey';
import type { IncrementalFileState } from './incrementalState';
import { ReviewMemoryManager } from './memory/reviewMemory';
import { SymbolIndex, collectSymbols } from './intelligence/symbolIndex';
import { LiteralIndex } from './intelligence/literalIndex';
import { CallGraph } from './intelligence/callGraph';
import {
    buildLiteralClusterIssues,
    type LiteralClusterOptions,
} from './intelligence/literalClusters';
import { buildErrorFlowIssues, type ErrorFlowOptions } from './intelligence/errorFlow';
import { extractCodeDomains, computeAstDigest } from './memory/domainFingerprint';
import { QualityScorer } from './scoring/qualityScorer';
import { ChangeTrajectoryManager } from './trajectory/changeTrajectory';
import type { ReviewMemoryRecord } from './memory/types';
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

const REVISION_ID_LENGTH = 16;
const TYPEOF_FUNCTION = 'function';

import {
    effectiveWorkers,
    pMap,
    analyzerCoverage,
    runWorkerPool,
    AR_TIMING,
    nowMs,
} from './scanner/workerScheduler';
import type { ScanWithCacheOptions } from './scanner/cacheScanner';
import { executeScanWithCache } from './scanner/cacheScanner';
import type { ScanWithDiffOptions } from './scanner/diffScanner';
import { executeScanWithDiff } from './scanner/diffScanner';
import { summarizeUncertainty } from './scanner/uncertaintyHelper';
import type { ScannerContext } from './scanner/scannerContext';

export { WarmSession, createWarmSession } from './scanner/cacheKeyHelper';
export type { ScanWithCacheOptions } from './scanner/cacheScanner';
export type { ScanWithDiffOptions } from './scanner/diffScanner';
export { summarizeUncertainty } from './scanner/uncertaintyHelper';

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
        this.activatedReviewersSummary = {
            archetype: detectedArchetype,
            active: Array.from(sparseResult.activeAnalyzers).sort(),
            skipped: Array.from(sparseResult.skippedAnalyzers).sort(),
            activationRatio: sparseResult.activationRatio,
            reason: sparseResult.reason,
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
        const ts0 = AR_TIMING ? nowMs() : 0;
        const tDiscover = ts0;

        // Descriptors for the worker pool: each analyzer's module path + its merged options.
        // Unused in single-process mode. This is what lets workers reconstruct analyzers
        // without sharing the main process's live instances.
        const descs = this.plan.map((p) => ({
            name: p.name,
            modulePath: p.modulePath,
            options: p.options,
        }));

        // Choose execution strategy for the parse+analyze stage.
        //   - workers === 1 (or auto with too few files)  -> single-process pMap
        // - workers === 0 (auto)                         -> up to min(availableParallelism, 8);
        // needs >= 8 files
        //   - workers === N (>1)                           -> exactly N threads (any file count)
        const effWorkers = effectiveWorkers(cfg.workers, files.length);
        const useWorkers = effWorkers > 1;

        let perFile: { issues: Issue[]; metric: FileMetric | null }[];
        if (useWorkers) {
            try {
                perFile = await runWorkerPool(
                    files,
                    absRoot,
                    cfg,
                    descs,
                    effWorkers,
                    this.logger,
                    this.runAnalyzers.bind(this),
                );
                this.logger.debug(
                    `parse+analyze stage ran across ${effWorkers} worker thread(s) (in-process fallback available)`,
                );
            } catch (e) {
                this.logger.warn(
                    `worker pool failed (${String(e)}); falling back to in-process scan`,
                );
                perFile = await this.runInProcess(files, absRoot);
            }
        } else {
            perFile = await this.runInProcess(files, absRoot);
        }
        const tParseAnalyze = AR_TIMING ? nowMs() : 0;

        const issues: Issue[] = [];
        const fileMetrics: FileMetric[] = [];
        for (const r of perFile) {
            issues.push(...r.issues);
            if (r.metric) fileMetrics.push(r.metric);
        }

        // deterministic ordering: file, then line, then analyzer, then rule
        issues.sort((a, b) => {
            if (a.location.file !== b.location.file)
                return a.location.file < b.location.file ? -1 : 1;
            if (a.location.start.line !== b.location.start.line)
                return a.location.start.line - b.location.start.line;
            if (a.analyzer !== b.analyzer) return a.analyzer < b.analyzer ? -1 : 1;
            return a.rule < b.rule ? -1 : 1;
        });
        const tSorted = AR_TIMING ? nowMs() : 0;

        const durationMs = Date.now() - t0;
        const report = this.buildReport(files.length, issues, fileMetrics, durationMs);
        this.logger.info(
            `done in ${durationMs}ms: ${report.summary.issuesTotal} issue(s) ` +
                `[error=${report.summary.bySeverity.error}, warning=${report.summary.bySeverity.warning}, info=${report.summary.bySeverity.info}]`,
        );
        if (AR_TIMING) {
            console.error(
                `[AR-TIMING scan] wall=${durationMs}ms discover=${(tDiscover - ts0).toFixed(1)}ms ` +
                    `parseAnalyze=${(tParseAnalyze - tDiscover).toFixed(1)}ms ` +
                    `merge+sort=${(tSorted - tParseAnalyze).toFixed(1)}ms ` +
                    `report=${(nowMs() - tSorted).toFixed(1)}ms`,
            );
        }
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
        return executeScanWithDiff(this, opts) as Promise<{ report: any; stats: DiffStats }>;
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
        const cfg = this.config;
        const adapter = adapterFor(rel, cfg.parser);
        const streaming = this.plan.filter((p) => {
            if (activeAnalyzers && !activeAnalyzers.has(p.name)) return false;
            return (
                typeof (p.instance as any).visit === TYPEOF_FUNCTION ||
                typeof (p.instance as any).finalize === TYPEOF_FUNCTION
            );
        });
        const legacy = this.plan.filter((p) => {
            if (activeAnalyzers && !activeAnalyzers.has(p.name)) return false;
            return (
                typeof (p.instance as any).visit !== TYPEOF_FUNCTION &&
                typeof (p.instance as any).finalize !== TYPEOF_FUNCTION
            );
        });

        // ── Dependency-graph seeding: register import edges while the content is in hand,
        //    so the api-level post-scan cycle/unused pass can reuse them without a second
        //    disk read. Only the in-process path seeds; worker and cache-hit paths never
        //    pass through here, so the consumer checks coverage and rereads when short. ──
        if (this.graph) {
            try {
                this.graph.registerFromContent(rel, content);
            } catch {
                /* Best-effort: a seeding failure must not abort the analysis */
            }
        }

        // The ts.SourceFile is only needed by legacy TS-only plug-ins; materialize it lazily.
        // Both TS-family adapters (typescript / oxc) parse TS/JS-family files, so legacy
        // plug-ins keep working regardless of which parser is selected.
        // Lazy require: `../utils/ast` (and therefore `typescript`) is only loaded when a legacy
        // plug-in actually needs a real SourceFile — the oxc + built-in analyzers path (the
        // common case) never triggers this require.
        let sf: ts.SourceFile | undefined;
        if (legacy.length > 0 && (adapter.id === 'typescript' || adapter.id === 'oxc'))
            sf = require('../utils/ast').createSourceFile(rel, content);

        // Lazy-projection fast path. When eligible, build a NodeProjector (no normalized
        // tree) and run the shared traversal over it; on ANY projector failure fall back to the
        // materialized path (never crashes). Gate is closed by default (AR_FASTPATH unset/0).
        // When a line-level incremental seed is present we FORCE the materialized path —
        // subtree reuse happens inside `adapter.parse(content, rel, seed)` (mapNode), which the
        // raw-driven projector cannot do cross-parse (new raw nodes have no identity across scans).
        let proj: NodeProjector | null = null;
        if (!seed) {
            proj = tryCreateProjector(
                adapter,
                content,
                rel,
                streaming.map((p) => p.name),
                legacy.length,
            );
        }
        let ast: NormalizedAst | null = null;
        let rootForCtx: NormalizedNode;
        if (proj) {
            // ctx.root must be the REAL SourceFile projection (L/M detect top-level children via
            // parent.kind === SourceFile) — never the placeholder.
            rootForCtx = proj.project(proj.root, undefined, undefined);
        } else {
            ast = adapter.parse(content, rel, seed);
            rootForCtx = ast.root;
        }

        // Compute line stats ONCE per file so every analyzer shares a single pass: the
        // metric collector always needs them, and large-file reads them when enabled.
        const lineStats = countLineStats(content);
        // Entries are built through this closure so the projection-fallback path can
        // rebuild them with FRESH analyzer instances (see the catch below). `metric` is the
        // per-run FileMetricCollector — also rebuilt on fallback so its counters never
        // accumulate partial state from an interrupted projected traversal.
        let metricCollector = new FileMetricCollector();
        const buildEntries = (
            metric: FileMetricCollector,
            rootForEntries: NormalizedNode,
        ): StreamingEntry[] => {
            const es: StreamingEntry[] = [];
            for (const p of streaming) {
                const fresh = p.factory();
                es.push({
                    analyzer: fresh as any,
                    ctx: {
                        filePath: rel,
                        content,
                        root: rootForEntries,
                        adapter,
                        sourceFile: sf,
                        config: cfg,
                        options: p.options,
                        lineStats,
                        incremental: seed,
                    },
                });
            }
            es.push({
                analyzer: metric as any,
                ctx: {
                    filePath: rel,
                    content,
                    root: rootForEntries,
                    adapter,
                    sourceFile: sf,
                    config: cfg,
                    options: {},
                    lineStats,
                    incremental: seed,
                },
            });
            return es;
        };
        const entries = buildEntries(metricCollector, rootForCtx);

        const issues: Issue[] = [];
        // Fail closed: when no adapter claims this extension the file is still analyzed by the
        // line-based rules, but the scan must never look clean about the missing AST signal.
        const languageIssue = unsupportedLanguageDiagnostic(rel, cfg);
        if (languageIssue) issues.push(languageIssue);
        if (entries.length > 0) {
            if (proj) {
                try {
                    issues.push(
                        ...runStreamingProjected(proj, entries, (node, caller) => {
                            try {
                                const collected = collectSymbols(node, rel, caller);
                                this.symbolIndex.addDefinitions(collected.definitions);
                                this.symbolIndex.addReferences(collected.references);
                                this.literalIndex.addTree(rel, node);
                                this.symbolIndex.markBuiltFrom('projection');
                            } catch {
                                /* Best-effort: index building must not abort the scan */
                            }
                        }),
                    );
                } catch (e) {
                    // Projector failure → materialized fallback (mirrors worker-pool → in-process
                    // fallback semantics): same output, only a performance regression.
                    this.logger.warn(
                        `lazy projection failed on ${rel}: ${String(e)}; falling back to materialized path`,
                    );
                    // NEVER reuse the outer entries — the interrupted projected traversal has
                    // already accumulated state in those analyzer instances (constants' literals,
                    // complexity's issues, the metric collector's counters). Rebuild FRESH
                    // instances
                    // (+ a fresh metric collector) so the fallback runStreaming sees a clean slate.
                    ast = adapter.parse(content, rel);
                    metricCollector = new FileMetricCollector();
                    const freshEntries = buildEntries(metricCollector, ast.root);
                    issues.push(...runStreaming(adapter, ast.root, freshEntries));
                }
            } else {
                issues.push(...runStreaming(adapter, ast!.root!, entries));
            }
        }

        // Legacy analyzers (no streaming hooks) keep the original per-analyzer `analyze` contract.
        for (const p of legacy) {
            if (!sf) continue; // external plug-ins cannot analyze non-TypeScript files
            const ctx: AnalyzerContext = {
                filePath: rel,
                content,
                root: ast?.root || rootForCtx,
                adapter,
                sourceFile: sf,
                config: cfg,
                options: p.options,
                lineStats,
            };
            try {
                issues.push(...p.instance.analyze(sf, ctx));
            } catch (e) {
                const sev: Severity = cfg.failOnAnalyzerError ? 'error' : 'info';
                this.logger.error(`analyzer "${p.name}" threw on ${rel}: ${String(e)}`);
                issues.push({
                    id: `core:analyzer-error:${rel}:1`,
                    analyzer: p.name,
                    rule: 'analyzer-error',
                    severity: sev,
                    message: `Analyzer "${p.name}" threw: ${(e as Error).message}`,
                    location: {
                        file: rel,
                        start: { line: 1, column: 1 },
                        end: { line: 1, column: 1 },
                    },
                    detail: { error: String(e) },
                });
            }
        }

        // ── Symbol-index seeding runs AFTER the analyzers: on the lazy-projection path the
        // tree only materializes its children while the shared traversal walks them, so
        // collecting here sees the same nodes the analyzers did — and still without a second
        // parse. The projection path records its provenance instead of implying the
        // materialized completeness it never had. ──
        try {
            const collected =
                proj === null
                    ? collectSymbols(rootForCtx, rel)
                    : { definitions: [], references: [] };
            this.symbolIndex.addDefinitions(collected.definitions);
            this.symbolIndex.addReferences(collected.references);
            this.literalIndex.addTree(rel, rootForCtx);
            if (proj !== null) this.symbolIndex.markBuiltFrom('projection');
            this.literalIndex.markBuiltFrom(proj !== null ? 'projection' : 'materialized');
        } catch {
            /* Best-effort: index building must not abort the scan */
        }

        return { issues, metric: metricCollector.metric };
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
        const cfg = this.config;
        const bySeverity: Record<Severity, number> = { info: 0, warning: 0, error: 0 };
        const byAnalyzer: Record<string, number> = {};
        for (const it of issues) {
            bySeverity[it.severity]++;
            byAnalyzer[it.analyzer] = (byAnalyzer[it.analyzer] || 0) + 1;
        }

        // ── Review Memory, Transparent Quality Scoring, and Trajectory Recording ──
        const fileQualityScores: Record<
            string,
            import('./scoring/scoringTypes').QualityScoreBreakdown
        > = {};
        const issuesByFile = new Map<string, Issue[]>();
        for (const it of issues) {
            const f = it.location?.file;
            if (f) {
                let list = issuesByFile.get(f);
                if (!list) {
                    list = [];
                    issuesByFile.set(f, list);
                }
                list.push(it);
            }
        }

        for (const m of fileMetrics) {
            const fIssues = issuesByFile.get(m.file) || [];
            const score = this.scorer.evaluateFile(m.file, fIssues, m, cfg);
            fileQualityScores[m.file] = score;

            if (cfg.memory !== false) {
                const domains = extractCodeDomains(undefined, '', fIssues);
                const record: ReviewMemoryRecord = {
                    filePath: m.file,
                    fileHash: sha256Hex(m.file + ':' + m.lines),
                    astDigest: computeAstDigest(undefined, m.file),
                    codeDomains: domains,
                    ruleHits: fIssues.map((it) => ({
                        id: it.id,
                        analyzer: it.analyzer,
                        rule: it.rule,
                        severity: it.severity,
                        line: it.location?.start?.line ?? 1,
                        message: it.message,
                    })),
                    qualityScores: score,
                    lastAudited: Date.now(),
                    revisionId: sha256Hex(
                        m.file + ':' + score.compositeScore + ':' + Date.now(),
                    ).slice(0, REVISION_ID_LENGTH),
                    agentUid: cfg.agentUid || 'default-agent',
                    contextWindows: {
                        imports: [],
                        exports: [],
                        layer: cfg.profile?.directorySemantics?.[path.dirname(m.file)],
                    },
                    fixResults: [],
                };
                this.reviewMemory.saveRecord(record);
                this.reviewMemory.evictStable(m.file);

                // Register to Trajectory
                this.trajectory.recordRevision(m.file, {
                    revisionId: record.revisionId,
                    timestamp: record.lastAudited,
                    agentUid: record.agentUid || 'default-agent',
                    fileHash: record.fileHash,
                    astDigest: record.astDigest,
                    qualityScore: score,
                    ruleHitIds: record.ruleHits.map((h) => h.id),
                });
            }
        }

        const projectQualityScore = this.scorer.evaluateFile('PROJECT_OVERALL', issues, null, cfg);

        // A scan is the natural durability boundary for review memory: the records are upserted
        // while the report is assembled above, so the buffered audits are written (and the log
        // compacted) exactly once here, at the end — flushing at the start of this method would
        // have written the PREVIOUS scan's batch and left this one in memory.
        this.reviewMemory.flush();
        return {
            tool: 'auto-refactor',
            version: '0.3.0',
            generatedAt: new Date().toISOString(),
            root: path.resolve(cfg.root),
            config: cfg,
            summary: {
                filesScanned,
                issuesTotal: issues.length,
                bySeverity,
                byAnalyzer,
                durationMs,
                symbolIndex: this.symbolIndex.stats(),
                literalIndex: this.literalIndex.stats(),
                callGraph: new CallGraph(this.symbolIndex).stats(),
                activatedReviewers: this.activatedReviewersSummary,
                uncertainty: summarizeUncertainty(issues),
                ...analyzerCoverage(cfg, fileMetrics),
            },
            issues,
            fileMetrics,
            qualityScore: projectQualityScore,
            fileQualityScores,
        };
    }
}
