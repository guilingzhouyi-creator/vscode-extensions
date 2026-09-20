import { parentPort, workerData } from 'worker_threads';
import * as fs from 'fs';
import type * as ts from 'typescript';
// ts-free modules only — importing `../utils/ast` here would pull `typescript` into every
// worker isolate, even when the oxc parser + built-in analyzers never touch it.
import { countLineStats } from '../utils/linestats';
import { instantiateAnalyzer } from './load-analyzer';
import type { AnalyzerContext, Issue, FileMetric, ScanConfig } from './types';
import {
    runStreaming,
    runStreamingProjected,
    FileMetricCollector,
    tryCreateProjector,
} from './traverse';
import { adapterFor } from './adapters';
import { unsupportedLanguageDiagnostic } from './language-support';
import type { LanguageAdapter, NodeProjector, NormalizedAst, NormalizedNode } from './multilang';
import { encodeResults, BINARY_RESULT_ENABLED } from './result-codec';

type LineStats = ReturnType<typeof countLineStats>;

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
 *
 * Worker entry for the parse+analyze stage.
 *
 * One worker is spawned per desired thread. It receives, via `workerData`, the resolved
 * `ScanConfig` and the list of analyzer descriptors (module path + merged options) and
 * pre-loads those modules once. Each incoming task is a single file: read it, parse it with
 * the file's language adapter, run every analyzer across ONE shared descent (driven by
 * `runStreaming`) plus a `FileMetricCollector`, and post the result back. Parsing CPU work
 * happens here, off the main thread, which is what parallelizes the scan across cores.
 *
 * Warm scans extend the message protocol with `{ tasks, fp, config, descs }` so a
 * PERSISTENT worker (daemon pool) can serve multiple scans/configuration fingerprints:
 *   - `fp` selects the per-fingerprint module cache (`Map<fp, LoadedAnalyzer[]>`); a hit
 *     reuses the already-required analyzer modules, a miss requires them once and caches.
 *   - `config`/`descs` let a scan switch the active configuration without respawning.
 * Instances are STILL created per file (`runOne` → `instantiateAnalyzer`/`p.factory()`),
 * so no mutable analyzer state ever leaks across files or scans.
 *
 * The legacy cold protocol (no `fp` in the message) keeps working: it uses the workerData
 * config/descs loaded at spawn time.
 */

interface Desc {
    name: string;
    modulePath: string;
    options: Record<string, any>;
}

interface LoadedAnalyzer {
    name: string;
    analyzer: {
        name: string;
        analyze(sf: ts.SourceFile, ctx: AnalyzerContext): Issue[];
        visit?: (...args: any[]) => unknown;
        finalize?: (...args: any[]) => unknown;
    };
    options: Record<string, any>;
    mod: any;
}

const workerDataConfig = (workerData && (workerData as any).config) as ScanConfig | undefined;
const workerDataDescs = ((workerData && (workerData as any).analyzerDescs) || []) as Desc[];

/**
 * AR_TIMING debug instrumentation (OFF unless AR_TIMING=1). Adds timing only — the produced
 * results are byte-identical either way.
 */
const AR_TIMING = process.env.AR_TIMING === '1';
const nowMs = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Decimal places for per-file AR-TIMING averages; aggregated totals keep one decimal. */
const TIMING_PER_FILE_DECIMALS = 3;

/** `typeof` tag detecting analyzer visit()/finalize() methods (streaming vs legacy). */
const TYPEOF_FUNCTION = 'function';

/** Multiplier that converts a ratio into a percentage. */
const PERCENT_SCALE = 100;

/** Maximum message durations printed in full before the timing list is truncated. */
const MSG_DURATION_FULL_LIST_LIMIT = 6;

/** Number of leading message durations retained when the timing list is truncated. */
const MSG_DURATION_HEAD_COUNT = 4;

/** Number of trailing message durations retained when the timing list is truncated. */
const MSG_DURATION_TAIL_COUNT = 2;

/** Per-fingerprint module cache for warm scans: fp → already-required analyzer modules. */
const loadedByFp = new Map<string, LoadedAnalyzer[]>();

function loadDescs(descs: Desc[]): LoadedAnalyzer[] {
    return descs.map((d) => {
        const mod = require(d.modulePath);
        return {
            name: d.name,
            analyzer: instantiateAnalyzer(mod, d.name),
            options: d.options,
            mod,
        };
    });
}

// Load the spawn-time analyzers (cold path / first message of a persistent pool).
const tLoad0 = nowMs();
const initialInstances: LoadedAnalyzer[] = loadDescs(workerDataDescs);
const tLoad1 = nowMs();

interface WorkerPerf {
    started: number;
    loadMs: number;
    lastMsgEnd: number;
    msgCount: number;
    msgWall: number; // receive -> post back, per message
    msgDurs: number[]; // per-message processing duration (receive -> post back)
    decodeTotal: number;
    runOneTotal: number;
    idleTotal: number; // between messages (incl. startup->first msg)
    files: number;
    adapterParse: number;
    /** Time spent building the lazy NodeProjector (fast path). Observational only. */
    adapterProject: number;
    countLineStats: number;
    filterTotal: number;
    filterCalls: number;
    createSourceFile: number;
    instantiateTotal: number;
    instantiateCalls: number;
    runStreaming: number;
    legacy: number;
}

const perf: WorkerPerf = AR_TIMING
    ? {
          started: nowMs(),
          loadMs: tLoad1 - tLoad0,
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
          createSourceFile: 0,
          instantiateTotal: 0,
          instantiateCalls: 0,
          runStreaming: 0,
          legacy: 0,
      }
    : (null as unknown as WorkerPerf);

/** AR_TIMING: print this worker's accumulated table to stderr. */
function printWorkerTable(): void {
    if (!AR_TIMING) return;
    const wall = nowMs() - perf.started;
    const busy = perf.msgWall;
    const idle = perf.idleTotal;
    const pct = (v: number): string => ((v / Math.max(1, wall)) * PERCENT_SCALE).toFixed(1);
    const f = perf.files || 1;
    const sub =
        perf.adapterParse +
        perf.adapterProject +
        perf.countLineStats +
        perf.filterTotal +
        perf.createSourceFile +
        perf.instantiateTotal +
        perf.runStreaming +
        perf.legacy;
    console.error(
        `[AR-TIMING worker] wall=${wall.toFixed(1)}ms busy=${busy.toFixed(1)}ms(${pct(busy)}%) ` +
            `idle=${idle.toFixed(1)}ms(${pct(idle)}%) msgs=${perf.msgCount} files=${perf.files} load=${perf.loadMs.toFixed(1)}ms`,
    );
    // Per-message durations: first 4 + last 2, to expose the first-message warmup spike.
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
                  'mLast-1',
                  'mLast',
              ];
    console.error(
        `[AR-TIMING worker] msgDurs: ${show.map((d, i) => `${labels[i]}=${d.toFixed(1)}ms`).join(' ')}`,
    );
    console.error(
        `[AR-TIMING worker] per-file avg (${perf.files} files): ` +
            `parse/mat=${(perf.adapterParse / f).toFixed(TIMING_PER_FILE_DECIMALS)}ms ` +
            `adapterProject=${(perf.adapterProject / f).toFixed(TIMING_PER_FILE_DECIMALS)}ms ` +
            `countLines=${(perf.countLineStats / f).toFixed(TIMING_PER_FILE_DECIMALS)}ms ` +
            `filter=${(perf.filterTotal / f).toFixed(TIMING_PER_FILE_DECIMALS)}ms(${perf.filterCalls} calls) ` +
            `instantiate=${(perf.instantiateTotal / f).toFixed(TIMING_PER_FILE_DECIMALS)}ms(${perf.instantiateCalls}) ` +
            `createSourceFile=${(perf.createSourceFile / f).toFixed(TIMING_PER_FILE_DECIMALS)}ms ` +
            `runStreaming=${(perf.runStreaming / f).toFixed(TIMING_PER_FILE_DECIMALS)}ms ` +
            `legacy=${(perf.legacy / f).toFixed(TIMING_PER_FILE_DECIMALS)}ms ` +
            `other=${(Math.max(0, busy - sub) / f).toFixed(TIMING_PER_FILE_DECIMALS)}ms`,
    );
    console.error(
        `[AR-TIMING worker] totals: parse/mat=${perf.adapterParse.toFixed(1)}ms ` +
            `adapterProject=${perf.adapterProject.toFixed(1)}ms ` +
            `countLines=${perf.countLineStats.toFixed(1)}ms filter=${perf.filterTotal.toFixed(1)}ms ` +
            `instantiate=${perf.instantiateTotal.toFixed(1)}ms createSourceFile=${perf.createSourceFile.toFixed(1)}ms ` +
            `runStreaming=${perf.runStreaming.toFixed(1)}ms legacy=${perf.legacy.toFixed(1)}ms ` +
            `decode=${perf.decodeTotal.toFixed(1)}ms`,
    );
}

/**
 * Loads file content from the pre-read string buffer or reads directly from disk.
 */
function loadFileContent(absPath: string | undefined, content: string | undefined): string | null {
    if (content !== undefined) {
        return content;
    }
    if (!absPath) {
        return null;
    }
    try {
        return fs.readFileSync(absPath, 'utf8');
    } catch {
        return null;
    }
}

/**
 * Splits loaded analyzer instances into streaming analyzers vs legacy SourceFile analyzers.
 */
function splitAnalyzers(instances: LoadedAnalyzer[]): {
    streaming: LoadedAnalyzer[];
    legacy: LoadedAnalyzer[];
} {
    const streaming = instances.filter(
        (a) =>
            typeof (a.analyzer as any).visit === TYPEOF_FUNCTION ||
            typeof (a.analyzer as any).finalize === TYPEOF_FUNCTION,
    );
    const legacy = instances.filter(
        (a) =>
            typeof (a.analyzer as any).visit !== TYPEOF_FUNCTION &&
            typeof (a.analyzer as any).finalize !== TYPEOF_FUNCTION,
    );
    return { streaming, legacy };
}

/**
 * Initializes AST or lazy projector, attempting fast-path projection first.
 */
function initAstOrProjector(
    adapter: LanguageAdapter,
    content: string,
    file: string,
    streamingNames: string[],
    legacyCount: number,
): { proj: NodeProjector | null; ast: NormalizedAst | null; rootForCtx: NormalizedNode } {
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
        const tP0 = AR_TIMING ? nowMs() : 0;
        ast = adapter.parse(content, file);
        if (AR_TIMING) perf.adapterParse += nowMs() - tP0;
        rootForCtx = ast.root;
    }
    return { proj, ast, rootForCtx };
}

/**
 * Builds analyzer execution entries binding each fresh analyzer instance to its context.
 */
function createAnalyzerEntries(
    streaming: LoadedAnalyzer[],
    metric: FileMetricCollector,
    rootForEntries: NormalizedNode,
    file: string,
    content: string,
    adapter: LanguageAdapter,
    sourceFile: ts.SourceFile | undefined,
    config: ScanConfig,
    lineStats: LineStats,
): { analyzer: any; ctx: AnalyzerContext }[] {
    const tInst0 = AR_TIMING ? nowMs() : 0;
    const es: { analyzer: any; ctx: AnalyzerContext }[] = [];
    for (const a of streaming) {
        const fresh = instantiateAnalyzer(a.mod, a.name);
        es.push({
            analyzer: fresh,
            ctx: {
                filePath: file,
                content,
                root: rootForEntries,
                adapter,
                sourceFile,
                config,
                options: a.options,
                lineStats,
            },
        });
    }
    es.push({
        analyzer: metric,
        ctx: {
            filePath: file,
            content,
            root: rootForEntries,
            adapter,
            sourceFile,
            config,
            options: {},
            lineStats,
        },
    });
    if (AR_TIMING) perf.instantiateTotal += nowMs() - tInst0;
    return es;
}

/**
 * Runs streaming analyzers via lazy projector with transparent fallback to full parse.
 */
function executeStreamingAnalyzers(
    proj: NodeProjector | null,
    entries: { analyzer: any; ctx: AnalyzerContext }[],
    adapter: LanguageAdapter,
    ast: NormalizedAst | null,
    content: string,
    file: string,
    streaming: LoadedAnalyzer[],
    sourceFile: ts.SourceFile | undefined,
    config: ScanConfig,
    lineStats: LineStats,
): { issues: Issue[]; metricCollector: FileMetricCollector } {
    const issues: Issue[] = [];
    let metricCollector = entries[entries.length - 1]?.analyzer as FileMetricCollector;

    if (entries.length === 0) {
        return { issues, metricCollector: metricCollector || new FileMetricCollector() };
    }

    if (proj) {
        try {
            issues.push(...runStreamingProjected(proj, entries));
        } catch {
            // Projector failure → materialized fallback (never crash, only a perf regression).
            // Rebuild fresh instances (+ fresh metric collector) so fallback sees clean slate.
            const fallbackAst = adapter.parse(content, file);
            metricCollector = new FileMetricCollector();
            const freshEntries = createAnalyzerEntries(
                streaming,
                metricCollector,
                fallbackAst.root,
                file,
                content,
                adapter,
                sourceFile,
                config,
                lineStats,
            );
            issues.push(...runStreaming(adapter, fallbackAst.root, freshEntries));
        }
    } else {
        issues.push(...runStreaming(adapter, (ast as NormalizedAst).root, entries));
    }

    return { issues, metricCollector };
}

/**
 * Runs legacy TypeScript analyzers that require an explicit SourceFile AST.
 */
function executeLegacyAnalyzers(
    legacy: LoadedAnalyzer[],
    sourceFile: ts.SourceFile | undefined,
    file: string,
    content: string,
    root: NormalizedNode,
    adapter: LanguageAdapter,
    config: ScanConfig,
    lineStats: LineStats,
): Issue[] {
    const issues: Issue[] = [];
    if (!sourceFile) return issues;

    for (const a of legacy) {
        const ctx: AnalyzerContext = {
            filePath: file,
            content,
            root,
            adapter,
            sourceFile,
            config,
            options: a.options,
            lineStats,
        };
        try {
            issues.push(...a.analyzer.analyze(sourceFile, ctx));
        } catch (e) {
            const sev: 'error' | 'info' = config.failOnAnalyzerError ? 'error' : 'info';
            issues.push({
                id: `core:analyzer-error:${file}:1`,
                analyzer: a.name,
                rule: 'analyzer-error',
                severity: sev,
                message: `Analyzer "${a.name}" threw: ${(e as Error).message}`,
                location: { file, start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
                detail: { error: String(e) },
            });
        }
    }

    return issues;
}

function runOne(
    file: string,
    absPath: string | undefined,
    content: string | undefined,
    cfg: ScanConfig,
    instances: LoadedAnalyzer[],
): { file: string; issues: Issue[]; metric: FileMetric | null } {
    const c = loadFileContent(absPath, content);
    if (c === null) {
        return { file, issues: [] as Issue[], metric: null as FileMetric | null };
    }

    const adapter = adapterFor(file, cfg.parser);

    const tFilter0 = AR_TIMING ? nowMs() : 0;
    const { streaming, legacy } = splitAnalyzers(instances);
    const tFilter1 = AR_TIMING ? nowMs() : 0;

    const { proj, ast, rootForCtx } = initAstOrProjector(
        adapter,
        c,
        file,
        streaming.map((a) => a.name),
        legacy.length,
    );

    const issues: Issue[] = [];
    const languageIssue = unsupportedLanguageDiagnostic(file, cfg);
    if (languageIssue) issues.push(languageIssue);

    let sf: ts.SourceFile | undefined;
    const tSf0 = AR_TIMING ? nowMs() : 0;
    if (legacy.length > 0 && (adapter.id === 'typescript' || adapter.id === 'oxc')) {
        sf = require('../utils/ast').createSourceFile(file, c);
    }
    const tSf1 = AR_TIMING ? nowMs() : 0;

    const tLine0 = AR_TIMING ? nowMs() : 0;
    const lineStats = countLineStats(c);
    const tLine1 = AR_TIMING ? nowMs() : 0;

    const metricCollector = new FileMetricCollector();
    const entries = createAnalyzerEntries(
        streaming,
        metricCollector,
        rootForCtx,
        file,
        c,
        adapter,
        sf,
        cfg,
        lineStats,
    );

    const tStream0 = AR_TIMING ? nowMs() : 0;
    const streamResult = executeStreamingAnalyzers(
        proj,
        entries,
        adapter,
        ast,
        c,
        file,
        streaming,
        sf,
        cfg,
        lineStats,
    );
    issues.push(...streamResult.issues);
    const tStream1 = AR_TIMING ? nowMs() : 0;

    const tLegacy0 = AR_TIMING ? nowMs() : 0;
    issues.push(
        ...executeLegacyAnalyzers(
            legacy,
            sf,
            file,
            c,
            ast?.root || rootForCtx,
            adapter,
            cfg,
            lineStats,
        ),
    );
    const tLegacy1 = AR_TIMING ? nowMs() : 0;

    if (AR_TIMING) {
        perf.files++;
        perf.countLineStats += tLine1 - tLine0;
        perf.filterTotal += tFilter1 - tFilter0;
        perf.filterCalls += 2;
        perf.createSourceFile += tSf1 - tSf0;
        perf.instantiateCalls += streaming.length;
        perf.runStreaming += tStream1 - tStream0;
        perf.legacy += tLegacy1 - tLegacy0;
    }

    const metric = streamResult.metricCollector.metric;
    return { file, issues, metric };
}

if (parentPort) {
    // One message carries a batch of tasks so postMessage round-trips are amortized; each
    // file is pre-read by the main thread and transferred as a Buffer, and one reply
    // carries all results for the batch. The old per-file protocol ({ file, absPath }) is
    // still honored via the absPath fallback.
    //
    // A message may also carry { fp, config, descs } so a persistent worker serves a
    // per-fingerprint module cache and per-scan configuration.
    //
    // NOTE: after an ArrayBuffer transfer the payload arrives as a `Uint8Array`, NOT a
    // Buffer — calling `.toString('utf8')` on it would fall through to Array.prototype and
    // produce comma-joined byte numbers. Always decode via Buffer.from(...) over the
    // transferred ArrayBuffer (a zero-copy view, correct for both Uint8Array and Buffer).
    parentPort.on(
        'message',
        (msg: {
            tasks?: { file: string; absPath?: string; buf?: Uint8Array }[];
            flush?: boolean;
            fp?: string;
            config?: ScanConfig;
            descs?: Desc[];
        }) => {
            if (AR_TIMING && msg && msg.flush) {
                printWorkerTable();
                parentPort!.postMessage({ flushed: true });
                return;
            }
            const tMsg = AR_TIMING ? nowMs() : 0;
            // Resolve the active configuration + analyzer set for this message.
            const cfg: ScanConfig = (msg && msg.config) || workerDataConfig || ({} as ScanConfig);
            let instances: LoadedAnalyzer[];
            if (msg && msg.fp) {
                let arr = loadedByFp.get(msg.fp);
                if (!arr) {
                    arr = loadDescs((msg && msg.descs) || workerDataDescs);
                    loadedByFp.set(msg.fp, arr);
                }
                instances = arr;
            } else {
                instances = initialInstances;
            }
            const tasks = msg.tasks || [];
            const tDecode0 = AR_TIMING ? nowMs() : 0;
            const contents: (string | undefined)[] = tasks.map((t) => {
                if (t.buf !== undefined) {
                    return Buffer.from(t.buf.buffer, t.buf.byteOffset, t.buf.byteLength).toString(
                        'utf8',
                    );
                }
                return undefined;
            });
            const tDecode1 = AR_TIMING ? nowMs() : 0;
            const results = tasks.map((t, i) =>
                runOne(t.file, t.absPath, contents[i], cfg, instances),
            );
            const tRun1 = AR_TIMING ? nowMs() : 0;
            if (AR_TIMING) {
                perf.msgCount++;
                perf.decodeTotal += tDecode1 - tDecode0;
                perf.runOneTotal += tRun1 - tDecode1;
                perf.msgWall += tRun1 - tMsg;
                perf.msgDurs.push(tRun1 - tMsg);
                const idle = perf.lastMsgEnd ? tMsg - perf.lastMsgEnd : tMsg - perf.started;
                perf.idleTotal += idle;
                perf.lastMsgEnd = tRun1;
            }
            if (BINARY_RESULT_ENABLED) {
                const buf = encodeResults(results);
                parentPort!.postMessage({ results: buf }, [buf.buffer as ArrayBuffer]);
            } else {
                parentPort!.postMessage({ results });
            }
        },
    );
}
