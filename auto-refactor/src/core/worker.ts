/**
 * Module: Core Engine — Parallel Parse/Analyze Worker Isolate
 * File Path: src/core/worker.ts
 * Architecture Role: worker_threads isolate running the scan's CPU-heavy parse+analyze stage.
 * Dependencies & Triggers: Spawned one per requested thread with workerData { config,
 *   analyzerDescs } by the dispatcher/WorkerPoolManager; parentPort messages carry batches.
 * Responsibilities: Decode transferred Buffers, split streaming vs legacy analyzers, parse
 *   via adapter or lazy NodeProjector, run both passes, cache loaded modules per fingerprint.
 * Exit Semantics & Design Rationale: No per-file throw: unreadable files return empty
 *   issues/metric null; analyzer errors become issues at cfg.failOnAnalyzerError severity,
 *   while projection failures retry with a fresh parse and fresh analyzer state.
 */
import { parentPort, workerData } from 'worker_threads';
import * as fs from 'fs';
import type * as ts from 'typescript';
import { countLineStats } from '../utils/linestats';
import { instantiateAnalyzer } from './load-analyzer';
import type { AnalyzerContext, Issue, FileMetric, ScanConfig } from './types';
import {
    runStreaming,
    runStreamingProjected,
    FileMetricCollector,
    tryCreateProjector,
    type StreamingEntry,
} from './ast/traverse';
import { adapterFor } from './ast/adapters';
import { unsupportedLanguageDiagnostic } from './ast/language-support';
import {
    OTHER_PLACEHOLDER,
    type LanguageAdapter,
    type NodeProjector,
    type NormalizedAst,
    type NormalizedNode,
} from './ast/multilang';
import { encodeResults, BINARY_RESULT_ENABLED } from './result-codec';
import {
    collectSymbols,
    type SymbolDefinition,
    type SymbolReference,
} from './intelligence/symbolIndex';
import { LiteralIndex, type LiteralOccurrence } from './intelligence/literalIndex';
import type { LoopSite } from './intelligence/semanticComplexity';
import { extractModuleGraphSummary, type ModuleGraphFileSummary } from './dependency-graph';
import { evaluateFilePreflightMask, isFileAnalyzerActive } from './scanner/file-preflight-gate';
import {
    getLanguageIdFromPath,
    getMaskedSource,
    computeLineFeatureTape,
    type MaskedSource,
    type LineFeatureTape,
} from './policy/source-mask';

type LineStats = ReturnType<typeof countLineStats>;

/**
 * Serialized analyzer descriptor transferred across worker boundary.
 */
interface Desc {
    /** Unique rule or analyzer identifier name. */
    name: string;
    /** Absolute filesystem path to the compiled analyzer module. */
    modulePath: string;
    /** User-supplied or preset rule options dictionary. */
    options: Record<string, unknown>;
}

/**
 * Materialized analyzer instance cached within worker thread memory.
 */
interface LoadedAnalyzer {
    /** Analyzer identifier name. */
    name: string;
    /** Executable analyzer contract object. */
    analyzer: {
        name?: string;
        analyze?(sourceFile: ts.SourceFile, ctx: AnalyzerContext): Issue[];
        visit?(...args: unknown[]): void;
        finalize?(ctx: AnalyzerContext): Issue[];
    };
    /** Configured analyzer options. */
    options: Record<string, unknown>;
    /** Loaded module export object. */
    mod: unknown;
}

const workerDataConfig: ScanConfig = (workerData && workerData.config) || ({} as ScanConfig);
const workerDataDescs: Desc[] = (workerData && workerData.analyzerDescs) || [];

const AR_TIMING: boolean =
    process.env.AR_TIMING === '1' || process.env.AUTO_REFACTOR_TIMING === '1';

const MS_PER_SECOND = 1000;
const NANOS_PER_MS = 1_000_000;

const nowMs = (): number => {
    const [seconds, nanoseconds] = process.hrtime();
    return seconds * MS_PER_SECOND + nanoseconds / NANOS_PER_MS;
};

const PERCENT_SCALE = 100;
const TIMING_DECIMALS = 2;
const MSG_DURATION_FULL_LIST_LIMIT = 6;
const MSG_DURATION_HEAD_COUNT = 4;
const MSG_DURATION_TAIL_COUNT = 2;

const LABEL_MSG_LAST_PREV = 'mLast-1';
const LABEL_MSG_LAST = 'mLast';
const SEV_ERROR = 'error';
const SEV_INFO = 'info';
const RULE_ANALYZER_ERROR = 'analyzer-error';
const EVENT_MESSAGE = 'message';
const TYPEOF_FUNCTION = 'function';
const PROP_REQUIRE = 'require' as const;
const MODULE_PATH_AST = '../utils/ast' as const;
const EXIT_KEY = 'exit' as const;

const loadedByFp = new Map<string, LoadedAnalyzer[]>();

function loadDynamicModule<T = any>(modulePath: string): T {
    const importFn = Reflect.get(globalThis, PROP_REQUIRE) ?? require;
    return importFn(modulePath) as T;
}

function loadDescs(descs: Desc[]): LoadedAnalyzer[] {
    return descs.map((descItem) => {
        const mod = loadDynamicModule(descItem.modulePath);
        const analyzerInstance = instantiateAnalyzer(mod, descItem.name);
        return {
            name: descItem.name,
            analyzer: analyzerInstance,
            options: descItem.options,
            mod,
        };
    });
}

const initialInstances: LoadedAnalyzer[] = loadDescs(workerDataDescs);

interface WorkerPerf {
    started: number;
    loadMs: number;
    lastMsgEnd: number;
    msgCount: number;
    msgWall: number;
    msgDurs: number[];
    decodeTotal: number;
    runOneTotal: number;
    idleTotal: number;
    files: number;
    adapterParse: number;
    adapterProject: number;
    countLineStats: number;
    filterTotal: number;
    filterCalls: number;
    instantiateTotal: number;
    instantiateCalls: number;
    createSourceFile: number;
    runStreaming: number;
    legacy: number;
}

const perf: WorkerPerf = {
    started: nowMs(),
    loadMs: 0,
    lastMsgEnd: 0,
    msgCount: 0,
    msgWall: 0,
    msgDurs: [],
    decodeTotal: 0,
    runOneTotal: 0,
    idleTotal: 0,
    files: 0,
    adapterParse: 0,
    adapterProject: 0,
    countLineStats: 0,
    filterTotal: 0,
    filterCalls: 0,
    instantiateTotal: 0,
    instantiateCalls: 0,
    createSourceFile: 0,
    runStreaming: 0,
    legacy: 0,
};

const formatMs = (value: number): string => value.toFixed(TIMING_DECIMALS);

function printWorkerTable(): void {
    if (!AR_TIMING) return;
    const wall = nowMs() - perf.started;
    const busy = perf.msgWall;
    const idle = perf.idleTotal;
    const pct = (valMs: number): string =>
        ((valMs / Math.max(1, wall)) * PERCENT_SCALE).toFixed(TIMING_DECIMALS);
    const fileCount = perf.files || 1;
    console.error(
        `[AR-TIMING worker] wall=${formatMs(wall)}ms busy=${formatMs(busy)}ms(${pct(busy)}%) ` +
            `idle=${formatMs(idle)}ms(${pct(idle)}%) msgs=${perf.msgCount} files=${perf.files} load=${formatMs(perf.loadMs)}ms`,
    );
    const durs = perf.msgDurs;
    const show =
        durs.length <= MSG_DURATION_FULL_LIST_LIMIT
            ? durs
            : [...durs.slice(0, MSG_DURATION_HEAD_COUNT), ...durs.slice(-MSG_DURATION_TAIL_COUNT)];
    const labels =
        durs.length <= MSG_DURATION_FULL_LIST_LIMIT
            ? show.map((_, i) => `m${i + 1}`)
            : [
                  ...show.slice(0, MSG_DURATION_HEAD_COUNT).map((_, i) => `m${i + 1}`),
                  LABEL_MSG_LAST_PREV,
                  LABEL_MSG_LAST,
              ];
    console.error(
        `[AR-TIMING worker] msgDurs: ${show.map((duration, i) => `${labels[i]}=${formatMs(duration)}ms`).join(' ')}`,
    );
    console.error(
        `[AR-TIMING worker] per-file avg (${perf.files} files): ` +
            `parse/mat=${formatMs(perf.adapterParse / fileCount)}ms ` +
            `adapterProject=${formatMs(perf.adapterProject / fileCount)}ms ` +
            `countLines=${formatMs(perf.countLineStats / fileCount)}ms ` +
            `filter=${formatMs(perf.filterTotal / fileCount)}ms(${perf.filterCalls} calls) ` +
            `instantiate=${formatMs(perf.instantiateTotal / fileCount)}ms(${perf.instantiateCalls}) ` +
            `createSourceFile=${formatMs(perf.createSourceFile / fileCount)}ms ` +
            `runStreaming=${formatMs(perf.runStreaming / fileCount)}ms ` +
            `legacy=${formatMs(perf.legacy / fileCount)}ms`,
    );
}

async function loadFileContent(
    absPath: string | undefined,
    content: string | undefined,
): Promise<string | null> {
    if (content !== undefined) return content;
    if (!absPath) return null;
    try {
        return await fs.promises.readFile(absPath, 'utf8');
    } catch {
        return null;
    }
}

function splitAnalyzers(instances: LoadedAnalyzer[]): {
    streaming: LoadedAnalyzer[];
    legacy: LoadedAnalyzer[];
} {
    const streaming = instances.filter(
        (analyzerItem) =>
            typeof analyzerItem.analyzer.visit === TYPEOF_FUNCTION ||
            typeof analyzerItem.analyzer.finalize === TYPEOF_FUNCTION,
    );
    const legacy = instances.filter(
        (analyzerItem) =>
            typeof analyzerItem.analyzer.visit !== TYPEOF_FUNCTION &&
            typeof analyzerItem.analyzer.finalize !== TYPEOF_FUNCTION,
    );
    return { streaming, legacy };
}

/**
 * Context for initializing a language adapter AST parser or zero-copy projector.
 */
interface AstProjectorInitContext {
    /** Target language AST adapter. */
    adapter: LanguageAdapter;
    /** Raw source file text contents. */
    content: string;
    /** Relative or normalized file path for diagnostics. */
    file: string;
    /** Identifier list of active streaming analyzers. */
    streamingNames: string[];
    /** Number of legacy non-streaming analyzers registered. */
    legacyCount: number;
}

/**
 * Initializes AST representation via projector or full parse fallback.
 *
 * @param context Projector initialization parameters.
 * @returns Projected node root, optional full AST, and normalized root node.
 */
function initAstOrProjector(context: AstProjectorInitContext): {
    proj: NodeProjector | null;
    ast: NormalizedAst | null;
    rootForCtx: NormalizedNode;
} {
    const { adapter, content, file, streamingNames, legacyCount } = context;
    const tProj0 = AR_TIMING ? nowMs() : 0;
    const proj: NodeProjector | null = tryCreateProjector(
        adapter,
        content,
        file,
        streamingNames,
        legacyCount,
    );
    let ast: NormalizedAst | null = null;
    let rootForCtx: NormalizedNode;
    if (proj) {
        rootForCtx = proj.project(proj.root, undefined, undefined);
        if (AR_TIMING) perf.adapterProject += nowMs() - tProj0;
    } else {
        const parseStartTimeMs = AR_TIMING ? nowMs() : 0;
        ast = adapter.parse(content, file);
        if (AR_TIMING) perf.adapterParse += nowMs() - parseStartTimeMs;
        rootForCtx = ast.root;
    }
    return { proj, ast, rootForCtx };
}

/**
 * Context for assembling streaming visitor entries across loaded analyzers.
 */
interface AnalyzerEntriesContext {
    /** Loaded streaming analyzer instances. */
    streaming: LoadedAnalyzer[];
    /** Metric collector instance for line and cyclomatic telemetry. */
    metric: FileMetricCollector;
    /** Target normalized AST root node. */
    rootForEntries: NormalizedNode;
    /** Relative file path being inspected. */
    file: string;
    /** Source file text content. */
    content: string;
    /** Language AST adapter. */
    adapter: LanguageAdapter;
    /** Optional TypeScript SourceFile handle when in TS mode. */
    sourceFile: ts.SourceFile | undefined;
    /** Scan configuration options. */
    config: ScanConfig;
    /** Precomputed line metrics. */
    lineStats: LineStats;
}

/**
 * Assembles bound streaming visitor entries with initialized analyzer contexts.
 *
 * @param context Analyzer entry builder parameters.
 * @returns Array of streaming visitor entries ready for traversal dispatch.
 */
function createAnalyzerEntries(context: AnalyzerEntriesContext): StreamingEntry[] {
    const {
        streaming,
        metric,
        rootForEntries,
        file,
        content,
        adapter,
        sourceFile,
        config,
        lineStats,
    } = context;
    const tInst0 = AR_TIMING ? nowMs() : 0;
    const preflightMask = evaluateFilePreflightMask(content, file, config);
    let maskedSource: MaskedSource | undefined;
    let featureTape: LineFeatureTape | undefined;
    let resolvedSourceFile = sourceFile;
    let lazySfResolved = sourceFile !== undefined;

    const ensureMasked = (): MaskedSource => {
        if (!maskedSource) {
            maskedSource = getMaskedSource(content, getLanguageIdFromPath(file));
        }
        return maskedSource;
    };
    const ensureTape = (): LineFeatureTape => {
        if (!featureTape) {
            const ms = ensureMasked();
            featureTape = computeLineFeatureTape(ms.raw, ms.masked);
        }
        return featureTape;
    };
    const ensureSf = (): ts.SourceFile | undefined => {
        if (resolvedSourceFile !== undefined || lazySfResolved) {
            return resolvedSourceFile;
        }
        lazySfResolved = true;
        if (adapter.id === 'typescript' || adapter.id === 'oxc') {
            const astModule = loadDynamicModule<{
                createSourceFile?: (filePath: string, fileContent: string) => ts.SourceFile;
            }>(MODULE_PATH_AST);
            resolvedSourceFile = astModule?.createSourceFile?.(file, content);
        }
        return resolvedSourceFile;
    };

    const buildContext = (options: Record<string, unknown>): AnalyzerContext => ({
        filePath: file,
        content,
        root: rootForEntries,
        adapter,
        get sourceFile(): ts.SourceFile | undefined {
            return ensureSf();
        },
        get lines(): readonly string[] {
            return ensureMasked().raw;
        },
        get maskedLines(): readonly string[] {
            return ensureMasked().masked;
        },
        get lineFlags(): Uint32Array {
            return ensureTape().lineFlags;
        },
        get lineIndents(): Uint16Array {
            return ensureTape().lineIndents;
        },
        config,
        options,
        lineStats,
    });

    const streamingEntries: StreamingEntry[] = [];
    for (const loadedItem of streaming) {
        if (!isFileAnalyzerActive(preflightMask, loadedItem.name)) {
            continue;
        }
        let analyzerInstance: any;
        const candidate = loadedItem.analyzer as any;
        if (candidate && typeof candidate.resetState === 'function') {
            candidate.resetState();
            analyzerInstance = candidate;
        } else {
            analyzerInstance = instantiateAnalyzer(loadedItem.mod, loadedItem.name);
        }
        streamingEntries.push({
            analyzer: analyzerInstance as unknown as StreamingEntry['analyzer'],
            ctx: buildContext(loadedItem.options),
        });
    }
    streamingEntries.push({
        analyzer: metric,
        ctx: buildContext({}),
        exemptFromPruning: true,
    });
    if (AR_TIMING) perf.instantiateTotal += nowMs() - tInst0;
    return streamingEntries;
}

/**
 * Context for executing streaming traversal pass over projected or normalized AST.
 */
interface StreamingExecutionContext {
    /** Projector handle if zero-copy projection succeeded. */
    proj: NodeProjector | null;
    /** Bound streaming visitor entries. */
    entries: StreamingEntry[];
    /** Language AST adapter. */
    adapter: LanguageAdapter;
    /** Full normalized AST if parsed directly. */
    ast: NormalizedAst | null;
    /** Source file text content. */
    content: string;
    /** Relative file path. */
    file: string;
    /** Loaded streaming analyzer instances. */
    streaming: LoadedAnalyzer[];
    /** Optional TypeScript SourceFile handle. */
    sourceFile: ts.SourceFile | undefined;
    /** Scan configuration options. */
    config: ScanConfig;
    /** Precomputed line metrics. */
    lineStats: LineStats;
    /** Optional callback invoked for each projected node. */
    onProjectedNode?: (node: NormalizedNode, caller: string | null) => void;
    /** Optional callback invoked when projection falls back to materialized parse. */
    onProjectionFallback?: (fallbackRoot: NormalizedNode) => void;
}

/**
 * Dispatches streaming traversal over AST nodes and collects issues.
 *
 * @param context Streaming execution parameters.
 * @returns Discovered issues and metric collector outcome.
 */
function executeStreamingAnalyzers(context: StreamingExecutionContext): {
    issues: Issue[];
    metricCollector: FileMetricCollector;
} {
    const {
        proj,
        entries,
        adapter,
        ast,
        content,
        file,
        streaming,
        sourceFile,
        config,
        lineStats,
        onProjectedNode,
        onProjectionFallback,
    } = context;
    const issues: Issue[] = [];
    let metricCollector = entries[entries.length - 1]?.analyzer as FileMetricCollector;

    if (entries.length === 0) {
        return { issues, metricCollector: metricCollector || new FileMetricCollector() };
    }

    if (proj) {
        try {
            issues.push(...runStreamingProjected(proj, entries, onProjectedNode));
        } catch {
            const fallbackAst = adapter.parse(content, file);
            onProjectionFallback?.(fallbackAst.root);
            metricCollector = new FileMetricCollector();
            const freshEntries = createAnalyzerEntries({
                streaming,
                metric: metricCollector,
                rootForEntries: fallbackAst.root,
                file,
                content,
                adapter,
                sourceFile,
                config,
                lineStats,
            });
            issues.push(...runStreaming(adapter, fallbackAst.root, freshEntries));
        }
    } else {
        issues.push(...runStreaming(adapter, (ast as NormalizedAst).root, entries));
    }

    return { issues, metricCollector };
}

interface LegacyExecutionContext {
    legacy: LoadedAnalyzer[];
    sourceFile: ts.SourceFile | undefined;
    file: string;
    content: string;
    root: NormalizedNode;
    adapter: LanguageAdapter;
    config: ScanConfig;
    lineStats: LineStats;
}

function executeLegacyAnalyzers(context: LegacyExecutionContext): Issue[] {
    const { legacy, sourceFile, file, content, root, adapter, config, lineStats } = context;
    const issues: Issue[] = [];
    if (!sourceFile) return issues;

    for (const legacyAnalyzer of legacy) {
        const ctx: AnalyzerContext = {
            filePath: file,
            content,
            root,
            adapter,
            sourceFile,
            config,
            options: legacyAnalyzer.options,
            lineStats,
        };
        try {
            if (typeof legacyAnalyzer.analyzer.analyze === 'function') {
                issues.push(...legacyAnalyzer.analyzer.analyze(sourceFile, ctx));
            }
        } catch (analyzerError) {
            const sev: 'error' | 'info' = config.failOnAnalyzerError ? SEV_ERROR : SEV_INFO;
            issues.push({
                id: `core:analyzer-error:${file}:1`,
                analyzer: legacyAnalyzer.name,
                rule: RULE_ANALYZER_ERROR,
                severity: sev,
                message: `Analyzer "${legacyAnalyzer.name}" threw: ${(analyzerError as Error).message}`,
                location: { file, start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
                detail: {
                    error: String(analyzerError),
                    stack: analyzerError instanceof Error ? analyzerError.stack : undefined,
                },
            });
        }
    }

    return issues;
}

interface SourceFileResolveContext {
    ast: NormalizedAst | null;
    legacyCount: number;
    adapterId: string;
    file: string;
    content: string;
}

function createLegacySourceFile(context: SourceFileResolveContext): ts.SourceFile | undefined {
    const { legacyCount, adapterId, file, content } = context;
    if (legacyCount > 0 && (adapterId === 'typescript' || adapterId === 'oxc')) {
        const astModule = loadDynamicModule<{
            createSourceFile?: (filePath: string, fileContent: string) => ts.SourceFile;
        }>(MODULE_PATH_AST);
        return astModule?.createSourceFile?.(file, content);
    }
    return undefined;
}

interface PerfRecordContext {
    lineCountDurationMs: number;
    filterDurationMs: number;
    sourceFileDurationMs: number;
    streamingCount: number;
    streamingDurationMs: number;
    legacyDurationMs: number;
}

function recordWorkerPerf(context: PerfRecordContext): void {
    if (!AR_TIMING) return;
    const {
        lineCountDurationMs,
        filterDurationMs,
        sourceFileDurationMs,
        streamingCount,
        streamingDurationMs,
        legacyDurationMs,
    } = context;
    perf.files++;
    perf.countLineStats += lineCountDurationMs;
    perf.filterTotal += filterDurationMs;
    perf.filterCalls += 2;
    perf.createSourceFile += sourceFileDurationMs;
    perf.instantiateCalls += streamingCount;
    perf.runStreaming += streamingDurationMs;
    perf.legacy += legacyDurationMs;
}

interface WorkerResultItem {
    file: string;
    issues: Issue[];
    metric: FileMetric | null;
    symbols?: { definitions: SymbolDefinition[]; references: SymbolReference[] };
    literals?: LiteralOccurrence[];
    loopSites?: LoopSite[];
    graphEdges?: ModuleGraphFileSummary;
}

function getElapsed(startTimeMs: number): number {
    return AR_TIMING && startTimeMs > 0 ? nowMs() - startTimeMs : 0;
}

function resolveSourceFile(context: SourceFileResolveContext): ts.SourceFile | undefined {
    return context.ast?.sourceFile ?? createLegacySourceFile(context);
}

function resolveAstRoot(ast: NormalizedAst | null, rootForCtx: NormalizedNode): NormalizedNode {
    return ast?.root || rootForCtx;
}

interface PipelineRunContext {
    proj: NodeProjector | null;
    ast: NormalizedAst | null;
    rootForCtx: NormalizedNode;
    file: string;
    content: string;
    cfg: ScanConfig;
    streaming: LoadedAnalyzer[];
    legacy: LoadedAnalyzer[];
    adapter: LanguageAdapter;
    sourceFile: ts.SourceFile | undefined;
    lineStats: LineStats;
    onProjectedNode?: (node: NormalizedNode, caller: string | null) => void;
    onProjectionFallback?: (fallbackRoot: NormalizedNode) => void;
}

function executePipelineAnalyzers(context: PipelineRunContext): {
    issues: Issue[];
    metric: FileMetric | null;
} {
    const {
        proj,
        ast,
        rootForCtx,
        file,
        content,
        cfg,
        streaming,
        legacy,
        adapter,
        sourceFile,
        lineStats,
        onProjectedNode,
        onProjectionFallback,
    } = context;
    const metricCollector = new FileMetricCollector();
    const entries = createAnalyzerEntries({
        streaming,
        metric: metricCollector,
        rootForEntries: rootForCtx,
        file,
        content,
        adapter,
        sourceFile,
        config: cfg,
        lineStats,
    });
    const tStream0 = AR_TIMING ? nowMs() : 0;
    const streamResult = executeStreamingAnalyzers({
        proj,
        entries,
        adapter,
        ast,
        content,
        file,
        streaming,
        sourceFile,
        config: cfg,
        lineStats,
        onProjectedNode,
        onProjectionFallback,
    });
    const _tStream = getElapsed(tStream0);

    const tLegacy0 = AR_TIMING ? nowMs() : 0;
    const astRoot = resolveAstRoot(ast, rootForCtx);
    const legacyIssues = executeLegacyAnalyzers({
        legacy,
        sourceFile,
        file,
        content,
        root: astRoot,
        adapter,
        config: cfg,
        lineStats,
    });
    const _tLegacy = getElapsed(tLegacy0);

    return {
        issues: [...streamResult.issues, ...legacyIssues],
        metric: streamResult.metricCollector.metric,
    };
}

function collectWorkerLoopSites(streaming: LoadedAnalyzer[]): LoopSite[] {
    for (let i = 0; i < streaming.length; i++) {
        if (streaming[i].name !== 'complexity') continue;
        const inst = streaming[i].analyzer as { getCurrentFileLoopSites?: () => LoopSite[] };
        if (typeof inst.getCurrentFileLoopSites === 'function') {
            return inst.getCurrentFileLoopSites();
        }
    }
    return [];
}

function executeScanPipeline(
    file: string,
    content: string,
    cfg: ScanConfig,
    instances: LoadedAnalyzer[],
): WorkerResultItem {
    const adapter = adapterFor(file, cfg.parser);
    const pipelineStartTimeMs = AR_TIMING ? nowMs() : 0;
    const { streaming, legacy } = splitAnalyzers(instances);
    const tFilter = getElapsed(pipelineStartTimeMs);

    const { proj, ast, rootForCtx } = initAstOrProjector({
        adapter,
        content,
        file,
        streamingNames: streaming.map((analyzer) => analyzer.name),
        legacyCount: legacy.length,
    });

    const issues: Issue[] = [];
    const languageIssue = unsupportedLanguageDiagnostic(file, cfg);
    if (languageIssue) issues.push(languageIssue);

    const tSf0 = AR_TIMING ? nowMs() : 0;
    const sourceFile =
        proj?.sourceFile ??
        resolveSourceFile({
            ast,
            legacyCount: legacy.length,
            adapterId: adapter.id,
            file,
            content,
        });
    const tSf = getElapsed(tSf0);

    const tLine0 = AR_TIMING ? nowMs() : 0;
    const lineStats = countLineStats(content);
    const tLine = getElapsed(tLine0);

    const fileSymbols: { definitions: SymbolDefinition[]; references: SymbolReference[] } = {
        definitions: [],
        references: [],
    };
    const fileLiterals = new LiteralIndex();
    let activeProj = proj;
    let fallbackRoot: NormalizedNode | null = null;

    const runResult = executePipelineAnalyzers({
        proj,
        ast,
        rootForCtx,
        file,
        content,
        cfg,
        streaming,
        legacy,
        adapter,
        sourceFile,
        lineStats,
        onProjectedNode: (node, caller) => {
            if (node === OTHER_PLACEHOLDER || (!node.functionLike && node.children !== undefined)) {
                return;
            }
            try {
                const collected = collectSymbols(node, file, caller);
                fileSymbols.definitions.push(...collected.definitions);
                fileSymbols.references.push(...collected.references);
                fileLiterals.addTree(file, node);
            } catch {
                /* Best-effort */
            }
        },
        onProjectionFallback: (rootNode) => {
            activeProj = null;
            fallbackRoot = rootNode;
            fileSymbols.definitions.length = 0;
            fileSymbols.references.length = 0;
        },
    });
    issues.push(...runResult.issues);

    recordWorkerPerf({
        lineCountDurationMs: tLine,
        filterDurationMs: tFilter,
        sourceFileDurationMs: tSf,
        streamingCount: streaming.length,
        streamingDurationMs: 0,
        legacyDurationMs: 0,
    });

    const astRoot = fallbackRoot ?? resolveAstRoot(ast, rootForCtx);
    try {
        if (activeProj === null) {
            const collected = collectSymbols(astRoot, file);
            fileSymbols.definitions.push(...collected.definitions);
            fileSymbols.references.push(...collected.references);
        }
        fileLiterals.addTree(file, astRoot);
    } catch {
        /* Best-effort */
    }

    const symbols =
        fileSymbols.definitions.length > 0 || fileSymbols.references.length > 0
            ? fileSymbols
            : undefined;
    const literals = fileLiterals.extractFileOccurrences(file);
    const loopSites = collectWorkerLoopSites(streaming);
    const graphEdges = extractModuleGraphSummary(file, content);

    return {
        file,
        issues,
        metric: runResult.metric,
        symbols,
        ...(literals.length > 0 ? { literals } : {}),
        ...(loopSites.length > 0 ? { loopSites } : {}),
        ...(graphEdges ? { graphEdges } : {}),
    };
}

interface RunOneContext {
    file: string;
    absPath: string | undefined;
    content: string | undefined;
    cfg: ScanConfig;
    instances: LoadedAnalyzer[];
}

async function runOne(context: RunOneContext): Promise<WorkerResultItem> {
    const fileContent = await loadFileContent(context.absPath, context.content);
    if (fileContent === null) {
        return { file: context.file, issues: [] as Issue[], metric: null as FileMetric | null };
    }
    return executeScanPipeline(context.file, fileContent, context.cfg, context.instances);
}

interface WorkerTaskMessage {
    tasks?: { file: string; absPath?: string; buf?: Uint8Array }[];
    flush?: boolean;
    [EXIT_KEY]?: boolean;
    fp?: string;
    config?: ScanConfig;
    descs?: Desc[];
}

function resolveMessageInstances(msg: WorkerTaskMessage): {
    cfg: ScanConfig;
    instances: LoadedAnalyzer[];
} {
    const cfg: ScanConfig = (msg && msg.config) || workerDataConfig || ({} as ScanConfig);
    if (!msg || !msg.fp) {
        return { cfg, instances: initialInstances };
    }
    let arr = loadedByFp.get(msg.fp);
    if (!arr) {
        arr = loadDescs((msg && msg.descs) || workerDataDescs);
        loadedByFp.set(msg.fp, arr);
    }
    return { cfg, instances: arr };
}

function decodeTaskContents(
    tasks: { file: string; absPath?: string; buf?: Uint8Array }[],
): (string | undefined)[] {
    return tasks.map((taskItem) => {
        if (taskItem.buf !== undefined) {
            return Buffer.from(
                taskItem.buf.buffer,
                taskItem.buf.byteOffset,
                taskItem.buf.byteLength,
            ).toString('utf8');
        }
        return undefined;
    });
}

function recordBatchTiming(tMsg: number, tDecode0: number, tDecode1: number, tRun1: number): void {
    if (!AR_TIMING) return;
    perf.msgCount++;
    perf.decodeTotal += tDecode1 - tDecode0;
    perf.runOneTotal += tRun1 - tDecode1;
    perf.msgWall += tRun1 - tMsg;
    perf.msgDurs.push(tRun1 - tMsg);
    const idle = perf.lastMsgEnd ? tMsg - perf.lastMsgEnd : tMsg - perf.started;
    perf.idleTotal += idle;
    perf.lastMsgEnd = tRun1;
}

function sendWorkerResults(
    port: import('worker_threads').MessagePort,
    results: WorkerResultItem[],
): void {
    if (BINARY_RESULT_ENABLED) {
        const buf = encodeResults(results);
        const symbolsMap = results.map((resultItem) => ({
            file: resultItem.file,
            symbols: resultItem.symbols,
            literals: resultItem.literals,
            loopSites: resultItem.loopSites,
            graphEdges: resultItem.graphEdges,
        }));
        port.postMessage({ results: buf, symbolsMap }, [buf.buffer as ArrayBuffer]);
    } else {
        port.postMessage({ results });
    }
}

if (parentPort) {
    const handleWorkerMessage = async (msg: WorkerTaskMessage): Promise<void> => {
        if (msg && msg.exit) {
            parentPort!.off(EVENT_MESSAGE, handleWorkerMessage);
            parentPort!.close();
            return;
        }
        if (AR_TIMING && msg && msg.flush) {
            printWorkerTable();
            parentPort!.postMessage({ flushed: true });
            return;
        }
        const tMsg = AR_TIMING ? nowMs() : 0;
        const { cfg, instances } = resolveMessageInstances(msg);
        const tasks = msg.tasks || [];
        const tDecode0 = AR_TIMING ? nowMs() : 0;
        const contents = decodeTaskContents(tasks);
        const tDecode1 = AR_TIMING ? nowMs() : 0;
        const results = await Promise.all(
            tasks.map((taskItem, i) =>
                runOne({
                    file: taskItem.file,
                    absPath: taskItem.absPath,
                    content: contents[i],
                    cfg,
                    instances,
                }),
            ),
        );
        const tRun1 = AR_TIMING ? nowMs() : 0;
        recordBatchTiming(tMsg, tDecode0, tDecode1, tRun1);
        sendWorkerResults(parentPort!, results);
    };
    parentPort.on(EVENT_MESSAGE, handleWorkerMessage);
}
