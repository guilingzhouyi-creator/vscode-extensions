import { parentPort, workerData } from 'worker_threads';
import * as fs from 'fs';
import type * as ts from 'typescript';
// ts-free modules only — importing `../utils/ast` here would pull `typescript` into every
// worker isolate, even when the oxc parser + built-in analyzers never touch it.
import { countLineStats } from '../utils/linestats';
import { instantiateAnalyzer } from './loadAnalyzer';
import { AnalyzerContext, Issue, FileMetric, ScanConfig } from './types';
import { runStreaming, runStreamingProjected, FileMetricCollector, tryCreateProjector } from './traverse';
import { adapterFor } from './adapters';
import { NodeProjector, NormalizedAst, NormalizedNode } from './multilang';
import { encodeResults, BINARY_RESULT_ENABLED } from './resultCodec';

/**
 * Worker entry for the parse+analyze stage.
 *
 * One worker is spawned per desired thread. It receives, via `workerData`, the resolved
 * `ScanConfig` and the list of analyzer descriptors (module path + merged options) and
 * pre-loads those modules once. Each incoming task is a single file: read it, parse it with
 * the file's language adapter, run every analyzer across ONE shared descent (driven by
 * `runStreaming`) plus a `FileMetricCollector`, and post the result back. Parsing CPU work
 * happens here, off the main thread, which is what parallelizes the scan across cores.
 *
 * WARM-SCAN (T03): the message protocol is extended with `{ tasks, fp, config, descs }` so a
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
    visit?: Function;
    finalize?: Function;
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
const nowMs = (): number =>
  typeof performance !== 'undefined' ? performance.now() : Date.now();

/** Per-fingerprint module cache (T03): fp → already-required analyzer modules. */
const loadedByFp = new Map<string, LoadedAnalyzer[]>();

function loadDescs(descs: Desc[]): LoadedAnalyzer[] {
  return descs.map((d) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
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
  /** P1-1: time spent building the lazy NodeProjector (fast path). Observational only. */
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
  const pct = (v: number): string => ((v / Math.max(1, wall)) * 100).toFixed(1);
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
  const show = durs.length <= 6 ? durs : [...durs.slice(0, 4), ...durs.slice(-2)];
  const labels = durs.length <= 6 ? show.map((_, i) => `m${i + 1}`) : [...show.slice(0, 4).map((_, i) => `m${i + 1}`), 'mLast-1', 'mLast'];
  console.error(
    `[AR-TIMING worker] msgDurs: ${show.map((d, i) => `${labels[i]}=${d.toFixed(1)}ms`).join(' ')}`,
  );
  console.error(
    `[AR-TIMING worker] per-file avg (${perf.files} files): ` +
      `parse/mat=${(perf.adapterParse / f).toFixed(3)}ms ` +
      `adapterProject=${(perf.adapterProject / f).toFixed(3)}ms ` +
      `countLines=${(perf.countLineStats / f).toFixed(3)}ms ` +
      `filter=${(perf.filterTotal / f).toFixed(3)}ms(${perf.filterCalls} calls) ` +
      `instantiate=${(perf.instantiateTotal / f).toFixed(3)}ms(${perf.instantiateCalls}) ` +
      `createSourceFile=${(perf.createSourceFile / f).toFixed(3)}ms ` +
      `runStreaming=${(perf.runStreaming / f).toFixed(3)}ms ` +
      `legacy=${(perf.legacy / f).toFixed(3)}ms ` +
      `other=${(Math.max(0, busy - sub) / f).toFixed(3)}ms`,
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

function runOne(
  file: string,
  absPath: string | undefined,
  content: string | undefined,
  cfg: ScanConfig,
  instances: LoadedAnalyzer[],
): { file: string; issues: Issue[]; metric: FileMetric | null } {
  let c: string;
  if (content !== undefined) {
    // P0-5 Step 2: the main thread pre-read the file and transferred the Buffer.
    c = content;
  } else {
    try {
      c = fs.readFileSync(absPath!, 'utf8');
    } catch (e) {
      return { file, issues: [] as Issue[], metric: null as FileMetric | null };
    }
  }

  const adapter = adapterFor(file, cfg.parser);

  const tFilter0 = AR_TIMING ? nowMs() : 0;
  const streaming = instances.filter((a) => typeof (a.analyzer as any).visit === 'function');
  const legacy = instances.filter((a) => typeof (a.analyzer as any).visit !== 'function');
  const tFilter1 = AR_TIMING ? nowMs() : 0;

  // P1-1: lazy-projection fast path — same routing gate as the in-process scanner
  // (traverse.ts tryCreateProjector). Building the projector skips the normalized-tree
  // materialization; any failure falls back to parse()+runStreaming() below.
  const tProj0 = AR_TIMING ? nowMs() : 0;
  let proj: NodeProjector | null = tryCreateProjector(
    adapter,
    c,
    file,
    streaming.map((a) => a.name),
    legacy.length,
  );
  const tProj1 = AR_TIMING ? nowMs() : 0;
  let ast: NormalizedAst | null = null;
  let rootForCtx: NormalizedNode;
  if (proj) {
    rootForCtx = proj.project(proj.root, undefined, undefined);
    if (AR_TIMING) perf.adapterProject += nowMs() - tProj0;
  } else {
    // Materialized path: adapter.parse() (createSourceFile + full normalized-tree mapNode).
    const tP0 = AR_TIMING ? nowMs() : 0;
    ast = adapter.parse(c, file);
    if (AR_TIMING) perf.adapterParse += nowMs() - tP0;
    rootForCtx = ast.root;
  }
  const issues: Issue[] = [];

  // Legacy TS-only plug-ins need a real SourceFile; materialize it lazily. Both TS-family
  // adapters (typescript / oxc) parse TS/JS-family files, so legacy plug-ins keep working
  // regardless of which parser is selected.
  let sf: ts.SourceFile | undefined;
  const tSf0 = AR_TIMING ? nowMs() : 0;
  if (legacy.length > 0 && (adapter.id === 'typescript' || adapter.id === 'oxc'))
    // Lazy: `../utils/ast` (and therefore `typescript`) is only required when a legacy
    // plug-in actually needs a real SourceFile. The pure-oxc + built-in analyzers path
    // (the common case) never triggers this require.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    sf = require('../utils/ast').createSourceFile(file, c);
  const tSf1 = AR_TIMING ? nowMs() : 0;

  // P0-3: compute line stats ONCE per file and share them with every analyzer.
  const tLine0 = AR_TIMING ? nowMs() : 0;
  const lineStats = countLineStats(c);
  const tLine1 = AR_TIMING ? nowMs() : 0;
  // V5.2: entries are built through this closure so the projection-fallback path can
  // rebuild them with FRESH analyzer instances (see the catch below). `metricCollector`
  // is also rebuilt on fallback so its counters never accumulate partial state from an
  // interrupted projected traversal.
  let metricCollector = new FileMetricCollector();
  const buildEntries = (metric: FileMetricCollector, rootForEntries: NormalizedNode): { analyzer: any; ctx: AnalyzerContext }[] => {
    const tInst0 = AR_TIMING ? nowMs() : 0;
    const es: { analyzer: any; ctx: AnalyzerContext }[] = [];
    for (const a of streaming) {
      const fresh = instantiateAnalyzer(a.mod, a.name);
      es.push({
        analyzer: fresh,
        ctx: { filePath: file, content: c, root: rootForEntries, adapter, sourceFile: sf, config: cfg, options: a.options, lineStats },
      });
    }
    es.push({
      analyzer: metric,
      ctx: { filePath: file, content: c, root: rootForEntries, adapter, sourceFile: sf, config: cfg, options: {}, lineStats },
    });
    if (AR_TIMING) perf.instantiateTotal += nowMs() - tInst0;
    return es;
  };
  const entries = buildEntries(metricCollector, rootForCtx);

  const tStream0 = AR_TIMING ? nowMs() : 0;
  if (entries.length > 0) {
    if (proj) {
      try {
        issues.push(...runStreamingProjected(proj, entries));
      } catch (e) {
        // Projector failure → materialized fallback (never crash, only a perf regression).
        // V5.2: NEVER reuse the outer entries — the interrupted projected traversal has
        // already accumulated state in those analyzer instances (constants' literals,
        // complexity's issues, the metric collector's counters). Rebuild FRESH instances
        // (+ a fresh metric collector) so the fallback runStreaming sees a clean slate.
        ast = adapter.parse(c, file);
        metricCollector = new FileMetricCollector();
        const freshEntries = buildEntries(metricCollector, ast.root);
        issues.push(...runStreaming(adapter, ast.root, freshEntries));
      }
    } else {
      issues.push(...runStreaming(adapter, ast.root!, entries));
    }
  }
  const tStream1 = AR_TIMING ? nowMs() : 0;

  const tLegacy0 = AR_TIMING ? nowMs() : 0;
  for (const a of legacy) {
    if (!sf) continue; // external plug-ins cannot analyze non-TypeScript files
    const ctx: AnalyzerContext = {
      filePath: file,
      content: c,
      root: ast.root,
      adapter,
      sourceFile: sf,
      config: cfg,
      options: a.options,
      lineStats,
    };
    try {
      issues.push(...a.analyzer.analyze(sf, ctx));
    } catch (e) {
      const sev: 'error' | 'info' = cfg.failOnAnalyzerError ? 'error' : 'info';
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
  const tLegacy1 = AR_TIMING ? nowMs() : 0;

  if (AR_TIMING) {
    perf.files++;
    // adapterParse/adapterProject are accumulated inside runOne at the parse/project site
    // (see above) so the two fast-path modes are compared honestly.
    perf.countLineStats += tLine1 - tLine0;
    perf.filterTotal += tFilter1 - tFilter0;
    perf.filterCalls += 2;
    perf.createSourceFile += tSf1 - tSf0;
    // instantiateTotal is accumulated INSIDE buildEntries (covers both the main path and
    // the projection-fallback's fresh rebuild); instantiateCalls counts the main path.
    perf.instantiateCalls += streaming.length;
    perf.runStreaming += tStream1 - tStream0;
    perf.legacy += tLegacy1 - tLegacy0;
  }

  const metric = metricCollector.metric;
  return { file, issues, metric };
}

if (parentPort) {
  // P0-5: one message carries a BATCH of tasks (each file pre-read by the main thread and
  // transferred as a Buffer); one reply carries all results for the batch. The old
  // per-file protocol ({ file, absPath }) is still honored via the absPath fallback.
  //
  // T03: message may also carry { fp, config, descs } so a persistent worker serves a
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
          return Buffer.from(t.buf.buffer, t.buf.byteOffset, t.buf.byteLength).toString('utf8');
        }
        return undefined;
      });
      const tDecode1 = AR_TIMING ? nowMs() : 0;
      const results = tasks.map((t, i) => runOne(t.file, t.absPath, contents[i], cfg, instances));
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
