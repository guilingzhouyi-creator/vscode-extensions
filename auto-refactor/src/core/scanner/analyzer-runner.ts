/**
 * Module: Core Engine — Per-File Analyzer Runner
 * File Path: src/core/scanner/analyzer-runner.ts
 * Architecture Role: Single-file parse + analyzer execution stage of the scan pipeline.
 * Dependencies & Triggers: ../adapters, ../languageSupport, ../multilang, ../traverse,
 *   ../dependencyGraph, ../intelligence/symbolIndex, ../intelligence/literalIndex,
 *   ../../utils/linestats; invoked by Scanner.runAnalyzers for every collected file.
 * Responsibilities: Partition the resolved plan into streaming and legacy analyzers, prepare the
 *   lazy projector or the materialized AST, build per-file analyzer contexts, run the shared
 *   traversal with a materialized fallback, run legacy analyzers, and seed the dependency,
 *   symbol, and literal stores.
 * Exit Semantics & Design Rationale: Projector failures degrade to the materialized path (same
 *   output, only a performance regression) and analyzer errors become issues instead of aborting
 *   the scan; index seeding stays best-effort so it can never fail a scan.
 */

import type * as ts from 'typescript';
import type { Analyzer, AnalyzerContext, FileMetric, Issue, ScanConfig } from '../types';
import type { ResolvedAnalyzer } from '../analyzer-registry';
import type { IncrementalFileState } from '../incremental-state';
import type { Logger } from '../logger';
import type { ModuleDependencyGraph } from '../dependency-graph';
import type { SymbolIndex } from '../intelligence/symbolIndex';
import { collectSymbols } from '../intelligence/symbolIndex';
import type { LiteralIndex } from '../intelligence/literalIndex';
import type { LanguageAdapter, NodeProjector, NormalizedAst, NormalizedNode } from '../multilang';
import { countLineStats } from '../../utils/linestats';
import { adapterFor } from '../adapters';
import { unsupportedLanguageDiagnostic } from '../language-support';
import type { StreamingEntry } from '../traverse';
import {
    FileMetricCollector,
    runStreaming,
    runStreamingProjected,
    tryCreateProjector,
} from '../traverse';

/** `typeof` tag for callable visit/finalize analyzer methods (streaming vs legacy). */
const TYPEOF_FUNCTION = 'function';

export type { FileContextBase, ParseState, StreamingOutcome };

import { materializeSourceFile, runLegacyPhase } from './legacy-analyzers';

/**
 * Host surface the runner needs from the Scanner: the resolved plan plus the cross-file stores
 * it seeds while the file content is in hand.
 *
 * The stores are passed in rather than imported so this stage stays free of the concrete
 * Scanner class and of any import cycle back into analyzer.ts.
 */
export interface AnalyzerHost {
    config: ScanConfig;
    plan: ResolvedAnalyzer[];
    logger: Logger;
    /** Import graph seeded on the in-process path; null when graph seeding is disabled. */
    graph: ModuleDependencyGraph | null;
    symbolIndex: SymbolIndex;
    literalIndex: LiteralIndex;
}

/** Streaming/legacy split of the resolved plan for one file. */
interface PlanPartition {
    streaming: ResolvedAnalyzer[];
    legacy: ResolvedAnalyzer[];
}

/** Parse artifacts shared by the streaming and legacy analyzer phases. */
interface ParseState {
    proj: NodeProjector | null;
    ast: NormalizedAst | null;
    rootForCtx: NormalizedNode;
}

/** Per-file values every analyzer context of this file shares. */
interface FileContextBase {
    rel: string;
    content: string;
    adapter: LanguageAdapter;
    sourceFile: ts.SourceFile | undefined;
    config: ScanConfig;
    lineStats: { lines: number; nonBlankLines: number };
    seed?: IncrementalFileState;
}

/** Outcome of the streaming phase, including the state the legacy phase must reuse. */
interface StreamingOutcome {
    issues: Issue[];
    metric: FileMetricCollector;
    /** Materialized AST; the fallback replaces it so legacy analyzers see the same tree. */
    ast: NormalizedAst | null;
}

/**
 * Decide whether an analyzer instance participates in the shared streaming traversal.
 *
 * @param instance - Resolved analyzer instance from the plan.
 * @returns True when the instance implements `visit` or `finalize`.
 */
function hasStreamingHooks(instance: Analyzer): boolean {
    const hooks: { visit?: unknown; finalize?: unknown } = instance;
    return typeof hooks.visit === TYPEOF_FUNCTION || typeof hooks.finalize === TYPEOF_FUNCTION;
}

/**
 * Split the resolved plan into streaming and legacy analyzers, honouring an optional allow-list.
 *
 * @param plan - Resolved analyzer plan of the scanner.
 * @param activeAnalyzers - Optional allow-list of analyzer names; omitted means the full plan.
 * @returns Streaming and legacy subsets, each preserving the original plan order.
 */
function partitionPlan(plan: ResolvedAnalyzer[], activeAnalyzers?: Set<string>): PlanPartition {
    const allowed = plan.filter((p) => !activeAnalyzers || activeAnalyzers.has(p.name));
    return {
        streaming: allowed.filter((p) => hasStreamingHooks(p.instance)),
        legacy: allowed.filter((p) => !hasStreamingHooks(p.instance)),
    };
}

/**
 * Seed the dependency graph while the file content is in hand, so the api-level post-scan
 * cycle/unused pass can reuse the edges without a second disk read.
 *
 * @param host - Runner host carrying the dependency graph.
 * @param rel - Repository-relative POSIX path of the file.
 * @param content - Raw file content already read by the caller.
 */
function seedDependencyGraph(host: AnalyzerHost, rel: string, content: string): void {
    if (!host.graph) return;
    try {
        host.graph.registerFromContent(rel, content);
    } catch {
        /* Best-effort: a seeding failure must not abort the analysis */
    }
}

/**
 * Prepare the lazy projector or the materialized AST for one file.
 *
 * When eligible, a NodeProjector is built (no normalized tree) and the shared traversal runs
 * over it; on ANY projector failure the caller falls back to the materialized path. The gate is
 * closed by default (AR_FASTPATH unset/0). A line-level incremental seed FORCES the materialized
 * path: subtree reuse happens inside `adapter.parse(content, rel, seed)`, which the raw-driven
 * projector cannot do cross-parse (new raw nodes have no identity across scans).
 *
 * @param adapter - Language adapter selected for the file.
 * @param content - Raw file content already read by the caller.
 * @param rel - Repository-relative POSIX path of the file.
 * @param seed - Previous incremental state; when present the materialized path is forced.
 * @param partition - Streaming/legacy split used by the projector eligibility gate.
 * @returns Projector (or null), materialized AST (or null), and the context root node.
 */
function prepareParse(
    adapter: LanguageAdapter,
    content: string,
    rel: string,
    seed: IncrementalFileState | undefined,
    partition: PlanPartition,
): ParseState {
    const proj = seed
        ? null
        : tryCreateProjector(
              adapter,
              content,
              rel,
              partition.streaming.map((p) => p.name),
              partition.legacy.length,
          );
    if (proj) {
        // ctx.root must be the REAL SourceFile projection (L/M detect top-level children via
        // parent.kind === SourceFile) — never the placeholder.
        return { proj, ast: null, rootForCtx: proj.project(proj.root, undefined, undefined) };
    }
    const ast = adapter.parse(content, rel, seed);
    return { proj: null, ast, rootForCtx: ast.root };
}

/**
 * Build one analyzer context from the shared per-file values.
 *
 * @param base - Shared per-file context values.
 * @param root - Root node this context exposes to its analyzer.
 * @param options - Analyzer-specific options resolved from the plan.
 * @returns A context whose streaming fields match the pipeline contract exactly.
 */
function makeContext(
    base: FileContextBase,
    root: NormalizedNode,
    options: Record<string, unknown>,
): AnalyzerContext {
    return {
        filePath: base.rel,
        content: base.content,
        root,
        adapter: base.adapter,
        sourceFile: base.sourceFile,
        config: base.config,
        options,
        lineStats: base.lineStats,
        incremental: base.seed,
    };
}

/**
 * Build the streaming entries: one fresh analyzer instance per streaming analyzer, plus the
 * per-run metric collector as the final entry.
 *
 * @param partition - Streaming/legacy split; only streaming analyzers get entries.
 * @param metric - Per-run metric collector appended as the last entry.
 * @param root - Root node the entries traverse.
 * @param base - Shared per-file context values.
 * @returns Fresh entries; state never leaks between files or between projection attempts.
 */
function buildStreamingEntries(
    partition: PlanPartition,
    metric: FileMetricCollector,
    root: NormalizedNode,
    base: FileContextBase,
): StreamingEntry[] {
    const entries: StreamingEntry[] = [];
    for (const p of partition.streaming) {
        entries.push({ analyzer: p.factory(), ctx: makeContext(base, root, p.options) });
    }
    entries.push({ analyzer: metric, ctx: makeContext(base, root, {}) });
    return entries;
}

/**
 * Collect the symbol/literal indexes of one projected node during the shared traversal.
 *
 * @param host - Runner host carrying the cross-file stores.
 * @param rel - Repository-relative POSIX path of the file being analyzed.
 * @param node - Node visited by the projected traversal.
 * @param caller - Enclosing function name reported by the traversal, when known.
 */
function indexProjectedNode(
    host: AnalyzerHost,
    rel: string,
    node: NormalizedNode,
    caller: string | null,
): void {
    try {
        const collected = collectSymbols(node, rel, caller);
        host.symbolIndex.addDefinitions(collected.definitions);
        host.symbolIndex.addReferences(collected.references);
        host.literalIndex.addTree(rel, node);
        host.symbolIndex.markBuiltFrom('projection');
    } catch {
        /* Best-effort: index building must not abort the scan */
    }
}

/**
 * Run the streaming phase, falling back to the materialized traversal on projector failure.
 *
 * @param host - Runner host carrying the logger.
 * @param adapter - Language adapter selected for the file.
 * @param parse - Parse artifacts prepared for this file.
 * @param partition - Streaming/legacy split.
 * @param base - Shared per-file context values.
 * @returns Emitted issues plus the metric collector and AST the legacy phase must reuse.
 */
function runStreamingPhase(
    host: AnalyzerHost,
    adapter: LanguageAdapter,
    parse: ParseState,
    partition: PlanPartition,
    base: FileContextBase,
): StreamingOutcome {
    const issues: Issue[] = [];
    let metric = new FileMetricCollector();
    const entries = buildStreamingEntries(partition, metric, parse.rootForCtx, base);
    if (entries.length === 0) return { issues, metric, ast: parse.ast };
    if (!parse.proj) {
        issues.push(...runStreaming(adapter, parse.ast!.root!, entries));
        return { issues, metric, ast: parse.ast };
    }
    try {
        issues.push(
            ...runStreamingProjected(parse.proj, entries, (node, caller) =>
                indexProjectedNode(host, base.rel, node, caller),
            ),
        );
        return { issues, metric, ast: parse.ast };
    } catch (e) {
        // Projector failure → materialized fallback (mirrors worker-pool → in-process fallback
        // semantics): same output, only a performance regression.
        host.logger.warn(
            `lazy projection failed on ${base.rel}: ${String(e)}; falling back to materialized path`,
        );
        // NEVER reuse the outer entries — the interrupted projected traversal has already
        // accumulated state in those analyzer instances (constants' literals, complexity's
        // issues, the metric collector's counters). Rebuild FRESH instances (+ a fresh metric
        // collector) so the fallback runStreaming sees a clean slate.
        const ast = adapter.parse(base.content, base.rel);
        metric = new FileMetricCollector();
        const freshEntries = buildStreamingEntries(partition, metric, ast.root, base);
        issues.push(...runStreaming(adapter, ast.root, freshEntries));
        return { issues, metric, ast };
    }
}

/**
 * Seed the cross-file symbol and literal indexes after the analyzers have run.
 *
 * Running AFTER the analyzers matters on the lazy-projection path: the tree only materializes
 * its children while the shared traversal walks them, so collecting here sees the same nodes the
 * analyzers did — and still without a second parse. The projection path records its provenance
 * instead of implying the materialized completeness it never had.
 *
 * @param host - Runner host carrying the cross-file stores.
 * @param rel - Repository-relative POSIX path of the file.
 * @param rootForCtx - Materialized root node used when no projector ran.
 * @param proj - Projector that ran for this file, or null on the materialized path.
 */
function seedIndexes(
    host: AnalyzerHost,
    rel: string,
    rootForCtx: NormalizedNode,
    proj: NodeProjector | null,
): void {
    try {
        const collected =
            proj === null ? collectSymbols(rootForCtx, rel) : { definitions: [], references: [] };
        host.symbolIndex.addDefinitions(collected.definitions);
        host.symbolIndex.addReferences(collected.references);
        host.literalIndex.addTree(rel, rootForCtx);
        if (proj !== null) host.symbolIndex.markBuiltFrom('projection');
        host.literalIndex.markBuiltFrom(proj !== null ? 'projection' : 'materialized');
    } catch {
        /* Best-effort: index building must not abort the scan */
    }
}

/**
 * Parse+analyze one file via the single-pass multiplexed traversal (language-agnostic).
 *
 * The file's language adapter is selected by extension; the adapter parses the content into a
 * normalized tree and all streaming analyzers share ONE descent over it, together with a
 * `FileMetricCollector` that produces the per-file `FileMetric`. Each streaming analyzer gets a
 * FRESH instance so its visit/finalize state is never shared across concurrently scanned files.
 * Analyzers without `visit` keep using the legacy `analyze` path (e.g. external plug-ins).
 *
 * @param host - Scanner-provided plan, config, logger, and cross-file stores.
 * @param rel - Repository-relative POSIX path that selects the language adapter.
 * @param content - Raw file content already read by the caller; no second disk read happens.
 * @param seed - Previous incremental state for this file; when present it forces the
 *     materialized parse path so unchanged subtrees can be reused.
 * @param activeAnalyzers - Optional allow-list of analyzer names; omitted means the full
 *     resolved plan runs.
 * Concurrency: asynchronous per-file execution; safe for concurrent execution on separate files.
 * @returns The file's issues and its per-file metric summary.
 */
export async function runFileAnalyzers(
    host: AnalyzerHost,
    rel: string,
    content: string,
    seed?: IncrementalFileState,
    activeAnalyzers?: Set<string>,
): Promise<{ issues: Issue[]; metric: FileMetric | null }> {
    const cfg = host.config;
    const adapter = adapterFor(rel, cfg.parser);
    const partition = partitionPlan(host.plan, activeAnalyzers);
    seedDependencyGraph(host, rel, content);
    const sourceFile = materializeSourceFile(rel, content, partition.legacy, adapter);
    const parse = prepareParse(adapter, content, rel, seed, partition);
    // Compute line stats ONCE per file so every analyzer shares a single pass: the metric
    // collector always needs them, and large-file reads them when enabled.
    const base: FileContextBase = {
        rel,
        content,
        adapter,
        sourceFile,
        config: cfg,
        lineStats: countLineStats(content),
        seed,
    };

    const issues: Issue[] = [];
    // Fail closed: when no adapter claims this extension the file is still analyzed by the
    // line-based rules, but the scan must never look clean about the missing AST signal.
    const languageIssue = unsupportedLanguageDiagnostic(rel, cfg);
    if (languageIssue) issues.push(languageIssue);

    const outcome = runStreamingPhase(host, adapter, parse, partition, base);
    issues.push(...outcome.issues);
    issues.push(...runLegacyPhase(host, partition.legacy, outcome, parse, base));
    seedIndexes(host, rel, parse.rootForCtx, parse.proj);

    return { issues, metric: outcome.metric.metric };
}
