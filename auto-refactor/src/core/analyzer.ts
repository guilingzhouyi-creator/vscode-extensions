import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type * as ts from 'typescript';
import { Worker } from 'worker_threads';
import {
  ScanConfig,
  ScanReport,
  Issue,
  Severity,
  FileMetric,
  AnalyzerId,
  Analyzer,
  AnalyzerContext,
  WarmStats,
  DiffInput,
  DiffStats,
  DiffDeltaReport,
} from './types';
// NOTE: `../utils/ast` (and therefore `typescript`) is intentionally NOT imported at the
// top level — R11 made the worker side lazy, and Q1 extends the same rule to the MAIN
// process so an oxc + no-legacy scan never loads `typescript`. The only consumer is the
// legacy plug-in branch below, which requires it lazily (same pattern as worker.ts).
import { countLineStats } from '../utils/linestats';
import { ConstantsAnalyzer } from '../analyzers/constants';
import { LargeFileAnalyzer } from '../analyzers/largeFile';
import { ComplexityAnalyzer } from '../analyzers/complexity';
import { Logger, AutoRefactorError } from './logger';
import { loadGitignore } from './gitignore';
import { instantiateAnalyzer } from './loadAnalyzer';
import { runStreaming, runStreamingProjected, FileMetricCollector, StreamingEntry, tryCreateProjector } from './traverse';
import { adapterFor } from './adapters';
import { NodeProjector, NormalizedAst, NormalizedNode } from './multilang';
import {
  FingerprintAnalyzerDesc,
  ANALYZER_VERSIONS,
  buildFingerprintPayload,
  fpHash,
  sha256Hex,
  adapterIdFor,
  computeCustomHash,
  buildPoolFingerprint,
} from './cacheKey';
import { CacheStore, CachedResult, Fingerprint } from './cache';
import { decodeResults, BINARY_RESULT_ENABLED } from './resultCodec';
import { route, incrementalEnabled, incrementalMinLines, incrementalMaxChangedLines, countLines } from './incremental';
import { resolveDiff } from './diff';
import { decodeContent } from './utf8';
import {
  IncrementalFileState,
  touchIncremental,
  pruneIncrementalBucket,
  incrementalRssGuard,
  incrementalMaxFiles,
} from './incrementalState';

// Re-export the analyzer contract so existing analyzer modules can keep importing
// `Analyzer` / `AnalyzerContext` from this engine file (backward-compatible surface).
export { Analyzer, AnalyzerContext } from './types';

/**
 * Context handed to each analyzer for a single source file.
 * (Re-declared here to avoid a circular import with types.ts; mirrors AnalyzerContext.)
 */
export interface ResolvedAnalyzer {
  name: AnalyzerId;
  instance: Analyzer;
  options: Record<string, any>;
  /**
   * Module path used to (re)instantiate this analyzer inside a worker thread.
   * Built-ins use a path relative to the engine's `core` dir; custom analyzers
   * use the absolute path resolved at config time. Unused in single-process mode.
   */
  modulePath: string;
  /**
   * Factory that produces a FRESH analyzer instance. Used by the single-pass multiplexed path
   * (which instantiates per file so streaming analyzers never share mutable state across the
   * concurrently scanned files handled by `pMap`). For built-ins this is the class constructor;
   * for custom analyzers it re-`require`s and re-instantiates the module.
   */
  factory: () => Analyzer;
}

/**
 * Built-in analyzer factories. Declaring a name in `ScanConfig.analyzers` resolves to one of these.
 * Adding a built-in analyzer = adding one entry here; user config stays declarative.
 */
const BUILTIN_FACTORIES: Record<string, () => Analyzer> = {
  constants: () => new ConstantsAnalyzer(),
  'large-file': () => new LargeFileAnalyzer(),
  complexity: () => new ComplexityAnalyzer(),
};

/**
 * Module paths (relative to this `core` directory) used to (re)instantiate built-in
 * analyzers inside worker threads. The worker requires these by path so it never needs
 * the main process's analyzer instances.
 *
 * NOTE: these MUST be `../analyzers/...` (not `./analyzers/...`) — at runtime the worker
 * lives at `dist/core/worker.js`, so a `./` path would resolve to `dist/core/analyzers/...`
 * which does not exist and would make every worker silently fail (caught by the
 * in-process fallback). `../` resolves to `dist/analyzers/...`, matching the source layout
 * `src/core/` → `src/analyzers/`.
 */
const BUILTIN_MODULE_PATHS: Record<string, string> = {
  constants: '../analyzers/constants',
  'large-file': '../analyzers/largeFile',
  complexity: '../analyzers/complexity',
};

function loadExternalAnalyzer(
  decl: { name: string; module: string },
  baseDir: string,
): { analyzer: Analyzer; modulePath: string } {
  const modPath = path.isAbsolute(decl.module) ? decl.module : path.resolve(baseDir, decl.module);
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require(modPath);
  let analyzer: Analyzer;
  try {
    analyzer = instantiateAnalyzer(mod, decl.name);
  } catch (e) {
    throw new AutoRefactorError(
      `custom analyzer "${decl.name}" does not export a valid Analyzer from ${modPath}`,
      'MODULE_NOT_FOUND',
    );
  }
  return { analyzer, modulePath: modPath };
}

/**
 * Declarative registration resolver.
 *
 * 1. Iterates `config.analyzers` (the declarative registry). A name matching a built-in factory
 *    is instantiated; its `options` are deep-merged onto the global thresholds to form `ctx.options`.
 * 2. Iterates `config.customAnalyzers` (declarative plug-ins). Each is loaded via `require(module)`
 *    and matched by `name` to its `analyzers` declaration; not-yet-seen names are added.
 *
 * No analyzer is run unless it is explicitly declared (enabled) in config — that is the whole point
 * of declarative registration: the engine never hardcodes "what runs".
 */
export function resolveAnalyzers(config: ScanConfig, baseDir: string): ResolvedAnalyzer[] {
  const plan: ResolvedAnalyzer[] = [];
  const seen = new Set<string>();

  for (const [name, decl] of Object.entries(config.analyzers || {})) {
    if (!decl || decl.enabled === false) continue;
    const factory = BUILTIN_FACTORIES[name];
    if (factory) {
      plan.push({
        name,
        instance: factory(),
        options: { ...config.thresholds, ...(decl.options || {}) },
        modulePath: BUILTIN_MODULE_PATHS[name],
        factory,
      });
      seen.add(name);
    }
  }

  for (const c of config.customAnalyzers || []) {
    if (c.enabled === false) continue;
    if (seen.has(c.name)) continue;
    const { analyzer, modulePath } = loadExternalAnalyzer(c, baseDir);
    const customModulePath = modulePath;
    plan.push({
      name: c.name,
      instance: analyzer,
      options: { ...config.thresholds, ...(c.options || {}) },
      modulePath,
      factory: () => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mod = require(customModulePath);
        return instantiateAnalyzer(mod, c.name);
      },
    });
    seen.add(c.name);
  }

  return topoSort(plan);
}

/**
 * Order the plan so that any analyzer listed in `dependsOn` runs before its dependents.
 * Independent analyzers keep their declared (insertion) order. Cycles are reported and broken
 * (the later node is kept but a warning is logged) rather than throwing, to stay robust.
 */
function topoSort(plan: ResolvedAnalyzer[]): ResolvedAnalyzer[] {
  const byName = new Map<string, ResolvedAnalyzer>();
  for (const p of plan) byName.set(p.name, p);
  const visited = new Set<string>();
  const inProgress = new Set<string>();
  const out: ResolvedAnalyzer[] = [];

  const visit = (p: ResolvedAnalyzer) => {
    if (visited.has(p.name)) return;
    if (inProgress.has(p.name)) {
      // cycle detected — break it
      return;
    }
    inProgress.add(p.name);
    for (const dep of p.instance.dependsOn || []) {
      const d = byName.get(dep);
      if (d) visit(d);
    }
    inProgress.delete(p.name);
    visited.add(p.name);
    out.push(p);
  };

  for (const p of plan) visit(p);
  return out;
}

/** Convert a glob (supporting **, *, ?) to a RegExp anchored to the full relative path. */
function globToRegExp(glob: string): RegExp {
  let re = '';
  let i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i += 2;
        if (glob[i] === '/') i++; // consume separator after **
      } else {
        re += '[^/]*';
        i++;
      }
    } else if (c === '?') {
      re += '[^/]';
      i++;
    } else if ('.+^${}()|[]\\'.includes(c)) {
      re += '\\' + c;
      i++;
    } else {
      re += c;
      i++;
    }
  }
  return new RegExp('^' + re + '$');
}

function matchAny(patterns: RegExp[], p: string): boolean {
  return patterns.some((rx) => rx.test(p));
}

const DEFAULT_EXT = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.rs'];

/**
 * Generic bounded-concurrency async mapper. Runs `fn` over `items` with at most `limit`
 * in flight. Order of results is preserved (index-aligned) regardless of completion order.
 */
async function pMap<T, U>(items: T[], limit: number, fn: (item: T) => Promise<U>): Promise<U[]> {
  const out: U[] = new Array(items.length);
  let idx = 0;
  const worker = async () => {
    while (idx < items.length) {
      const cur = idx++;
      out[cur] = await fn(items[cur]);
    }
  };
  const n = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

/** Lightweight description of an analyzer passed to a worker thread. */
export interface WorkerAnalyzerDesc {
  name: string;
  modulePath: string;
  options: Record<string, any>;
}

/** P0-5: files per worker message batch (amortizes postMessage round-trips). */
const WORKER_BATCH_SIZE = 32;

/**
 * Hybrid startup: the first K files are parsed in-process on the main thread while the workers
 * import `typescript` (~223ms dead time per fresh isolate). K is parser-aware because the
 * optimal offload volume depends on the WORKER-side per-file cost:
 *   - parser='typescript': worker parse+materialize ~1.10-1.38ms/file (slow) -> K=500 is best
 *     (~-9% on 1500-file corpus, w4); larger K regresses (main thread saturates, starves
 *     worker dispatch/read-ahead).
 *   - parser='oxc': worker parse+materialize ~0.90ms/file (fast) -> less offloading needed;
 *     K=200-300 is best, K=500 measured ~zero benefit (oxc worker speedup is inside the worker
 *     isolate; the main-thread in-process rate stays ~1.1ms/file for both parsers).
 * Only applies to the n>1 pool path. Debug knobs: AR_HYBRID=0 disables (A/B baseline),
 * AR_HYBRID_FILES=<n> overrides the parser-selected default.
 *
 * WARM-SCAN (T03): hybrid exists only to mask the worker cold-import dead time (~300ms ts).
 * A WARM pool (already imported + JIT'ed) gets K=0 — otherwise the main thread would steal
 * files from workers and slow the hot path.
 */
const HYBRID_FILES_TS = 500;
const HYBRID_FILES_OXC = 200;
/** Bounded concurrency for the hybrid in-process phase (overlaps readFile on the libuv pool). */
const HYBRID_CONCURRENCY = 16;

/**
 * Debug instrumentation for the worker pipeline (OFF by default; set AR_TIMING=1 to enable).
 * Adds timing only — never changes output bytes. When enabled, tables are printed to stderr
 * at the end of each scan() / worker-pool run.
 */
const AR_TIMING = process.env.AR_TIMING === '1';
const nowMs = (): number =>
  typeof performance !== 'undefined' ? performance.now() : Date.now();

/**
 * Ensure a Buffer is backed by its own ArrayBuffer so it can be transferred to a worker
 * with zero-copy semantics. `fs.readFile` may return a pooled buffer (byteOffset > 0)
 * for small files; transferring a pooled buffer would detach the WHOLE shared pool and
 * corrupt other buffers — so copy such buffers into a standalone allocation first.
 */
function toTransferable(buf: Buffer): Buffer {
  if (buf.byteOffset === 0 && buf.byteLength === buf.buffer.byteLength) return buf;
  const copy = Buffer.allocUnsafeSlow(buf.byteLength);
  buf.copy(copy);
  return copy;
}

/** Parser-aware hybrid K for a fresh (cold) pool. */
function computeHybridK(config: ScanConfig, filesLen: number, n: number): number {
  const availCores = os.availableParallelism ? os.availableParallelism() : os.cpus().length;
  const baseHybridK = config.parser === 'oxc' ? HYBRID_FILES_OXC : HYBRID_FILES_TS;
  return process.env.AR_HYBRID === '0' || availCores < n * 2
    ? 0
    : Math.min(Number(process.env.AR_HYBRID_FILES || baseHybridK) | 0, filesLen);
}

interface DispatchOpts {
  /** Pre-created workers (persistent pool). When absent, workers are spawned here (cold). */
  workers?: any[];
  workerIdx?: Map<any, number>;
  files: string[];
  absRoot: string;
  config: ScanConfig;
  descs: WorkerAnalyzerDesc[];
  numWorkers: number;
  logger: Logger;
  runAnalyzersFn: (
    rel: string,
    content: string,
  ) => Promise<{ issues: Issue[]; metric: FileMetric | null }>;
  /** Files claimed by the main thread for hybrid in-process processing (0 = disabled). */
  hybridK: number;
  /** false (cold) → terminate workers when the batch finishes; true → keep them alive. */
  keepAlive: boolean;
  /** Pool/config fingerprint sent with each message so workers cache loaded modules by fp. */
  fp?: string;
  /** Pre-read file contents (Buffer) — avoids the double-read on the cache path. */
  preloaded?: Map<string, Buffer>;
}

/**
 * Distribute the parse+analyze stage across `numWorkers` worker threads.
 *
 * Why this is the real performance win: `ts.createSourceFile` is synchronous CPU work. A plain
 * in-process `concurrency` pool only parallelizes *between* await points, so all parsing still
 * lands on the single main thread. Spinning up worker threads moves the parse+analyze of each
 * file onto its own core, giving near-linear speedup on multi-core machines for large repos.
 *
 * P0-5: files are dispatched in BATCHES of `WORKER_BATCH_SIZE` — one `postMessage({ tasks })`
 * per batch instead of one message per file. The main thread PRE-READS each batch's files
 * (async, overlapping with worker parsing) and transfers the content Buffers to the worker
 * via the postMessage transfer list (zero-copy ArrayBuffer handoff). Unreadable files are
 * turned into an empty result on the main thread and never dispatched (same semantics as the
 * worker's read-failure fallback). The worker runs all analyzers per file and returns
 * `{ results }` once per batch. Results are reassembled into the original file order via an
 * index map, so the final report is identical to the single-process path.
 *
 * WARM-SCAN (T03): `keepAlive` keeps the workers alive for the next scan (daemon pool);
 * `fp` tags every message so the worker's per-fingerprint module cache (`Map<fp,...>`) is
 * used and the second scan of the same pool skips the import/JIT dead time entirely.
 */
async function dispatchBatches(opts: DispatchOpts): Promise<{ issues: Issue[]; metric: FileMetric | null }[]> {
  const {
    files,
    absRoot,
    config,
    descs,
    numWorkers,
    logger,
    runAnalyzersFn,
    hybridK,
    keepAlive,
    fp,
  } = opts;
  if (files.length === 0) return [];
  const workerPath = path.join(__dirname, 'worker.js');
  const n = Math.max(1, Math.min(numWorkers, files.length));
  const idxByFile = new Map<string, number>();
  files.forEach((f, i) => idxByFile.set(f, i));
  const results: ({ issues: Issue[]; metric: FileMetric | null } | null)[] = new Array(files.length);

  // AR_TIMING state: per-stage / per-batch pipeline instrumentation (no-op when disabled).
  const T = AR_TIMING
    ? {
        poolStart: nowMs(),
        spawnMs: [] as number[],
        firstMsgMs: [] as number[],
        readTotal: 0,
        readCount: 0,
        readTimes: [] as number[],
        dispatchSyncTotal: 0,
        mergeTotal: 0,
        timeline: [] as {
          seq: number;
          worker: number;
          dispatch: number; // ms since poolStart
          arrive: number; // ms since poolStart, -1 until arrival
          rt: number; // round-trip ms
        }[],
        lastDispatch: [] as number[], // per worker: timestamp of last postMessage
        seqCounter: 0,
        flushing: false,
        // hybrid phase accounting
        hybridK,
        hybridFiles: 0,
        hybridDone: 0,
        hybridMs: 0,
        hybridDoneAtFirstMsg: -1, // hybrid completions when the FIRST worker message arrives
      }
    : null;

  const workerIdx = opts.workerIdx || new Map<any, number>();

  return new Promise((resolve, reject) => {
    const workers: any[] = opts.workers || [];
    let nextIdx = 0;
    let completed = 0;
    let failed = false;

    const fail = (e: any) => {
      if (failed) return;
      failed = true;
      for (const w of workers) try { w.terminate(); } catch { /* ignore */ }
      reject(e);
    };

    /** AR_TIMING: print the main-thread pipeline table. */
    const printMainTable = (): void => {
      if (!T) return;
      const wall = nowMs() - T.poolStart;
      const spawnTotal = T.spawnMs.reduce((a, b) => a + b, 0);
      const busy = spawnTotal + T.readTotal + T.dispatchSyncTotal + T.mergeTotal;
      const idle = Math.max(0, wall - busy);
      const pct = (v: number): string => ((v / Math.max(1, wall)) * 100).toFixed(1);
      console.error(
        `[AR-TIMING main] poolWall=${wall.toFixed(1)}ms busy=${busy.toFixed(1)}ms(${pct(busy)}%) ` +
          `idle=${idle.toFixed(1)}ms(${pct(idle)}%)`,
      );
      console.error(
        `[AR-TIMING main] spawn=[${T.spawnMs.map((x) => x.toFixed(1)).join(',')}]ms firstMsg=[${T.firstMsgMs
          .map((x) => x.toFixed(1))
          .join(',')}]ms read=${T.readTotal.toFixed(1)}ms(${T.readCount} batches, avg=${(T.readTotal / Math.max(1, T.readCount)).toFixed(1)}, max=${Math.max(...T.readTimes, 0).toFixed(1)}) ` +
          `dispatchSync=${T.dispatchSyncTotal.toFixed(1)}ms merge=${T.mergeTotal.toFixed(1)}ms`,
      );
      console.error(
        `[AR-TIMING main] hybrid: k=${T.hybridK} files=${T.hybridFiles} done=${T.hybridDone} ` +
          `doneBeforeFirstWorkerMsg=${T.hybridDoneAtFirstMsg} ms=${T.hybridMs.toFixed(1)}ms`,
      );
      // Per-worker busy (sum of round-trips) and inter-batch gaps (worker idle wait).
      const perWorkerBusy: number[] = new Array(n).fill(0);
      const perWorkerGaps: number[] = new Array(n).fill(0);
      const lastArrive: number[] = new Array(n).fill(-1);
      const rtAll: number[] = [];
      for (const e of T.timeline) {
        if (e.arrive >= 0) {
          perWorkerBusy[e.worker] += e.rt;
          rtAll.push(e.rt);
          if (lastArrive[e.worker] >= 0) perWorkerGaps[e.worker] += e.dispatch - lastArrive[e.worker];
          lastArrive[e.worker] = e.arrive;
        }
      }
      const rtAvg = rtAll.length ? rtAll.reduce((a, b) => a + b, 0) / rtAll.length : 0;
      const rtMax = rtAll.length ? Math.max(...rtAll) : 0;
      console.error(
        `[AR-TIMING main] roundTrips n=${rtAll.length} avg=${rtAvg.toFixed(1)}ms max=${rtMax.toFixed(1)}ms ` +
          `perWorkerBusy=[${perWorkerBusy.map((x) => x.toFixed(0)).join(',')}]ms ` +
          `perWorkerWaitGaps=[${perWorkerGaps.map((x) => x.toFixed(0)).join(',')}]ms`,
      );
      // Pipeline timeline (batch-level).
      const lines: string[] = [];
      for (const e of T.timeline) {
        lines.push(
          `b${e.seq} w${e.worker} +${e.dispatch.toFixed(0)}ms->+${e.arrive.toFixed(0)}ms rt=${e.rt.toFixed(1)}ms`,
        );
      }
      for (let i = 0; i < lines.length; i += 8) {
        console.error(`[AR-TIMING main] batch: ${lines.slice(i, i + 8).join(' | ')}`);
      }
    };

    /** AR_TIMING: ask each worker to flush its table, then let the caller terminate them. */
    const flushWorkers = async (): Promise<void> => {
      if (!T || workers.length === 0) return;
      const acks = workers.map(
        (w) =>
          new Promise<void>((res) => {
            const onMsg = (m: any): void => {
              if (m && m.flushed) {
                w.off('message', onMsg);
                res();
              }
            };
            w.on('message', onMsg);
            try {
              w.postMessage({ flush: true });
            } catch {
              res();
            }
          }),
      );
      await Promise.race([Promise.all(acks), new Promise<void>((r) => setTimeout(r, 3000))]);
    };

    const finishIfDone = (): boolean => {
      if (completed < files.length) return false;
      if (!T) {
        if (!keepAlive) for (const x of workers) try { x.terminate(); } catch { /* ignore */ }
        resolve(results as { issues: Issue[]; metric: FileMetric | null }[]);
        return true;
      }
      if (!T.flushing) {
        T.flushing = true;
        printMainTable();
        void flushWorkers().then(() => {
          if (!keepAlive) for (const x of workers) try { x.terminate(); } catch { /* ignore */ }
          resolve(results as { issues: Issue[]; metric: FileMetric | null }[]);
        });
      }
      return true;
    };

    /** Read one file on the main thread; on failure produce an empty result (no dispatch). */
    const readTask = async (
      idx: number,
      rel: string,
    ): Promise<{ file: string; absPath: string; buf: Buffer } | null> => {
      const absPath = path.join(absRoot, rel);
      try {
        // Cache-path optimization: use the buffer already read for hashing (no second read).
        const pre = opts.preloaded && opts.preloaded.get(rel);
        const buf = pre || (await fs.promises.readFile(absPath));
        return { file: rel, absPath, buf: toTransferable(buf) };
      } catch {
        results[idx] = { issues: [] as Issue[], metric: null as FileMetric | null };
        completed++;
        return null;
      }
    };

    /**
     * Hybrid startup: process the pre-reserved [0, hybridK) files in-process on the main thread
     * (same runAnalyzers path as --workers=1) while the workers import `typescript`. Runs fully
     * concurrently with the worker pool; each file writes results[idx] and bumps `completed`, so
     * finishIfDone() fires only when BOTH paths have finished. Read failure -> empty result
     * (mirrors readTask). An analyzer error propagates via fail() (same fallback as a worker crash).
     */
    const processHybrid = async (batch: { idx: number; rel: string }[]): Promise<void> => {
      if (T) T.hybridFiles = batch.length;
      const tH0 = T ? nowMs() : 0;
      await pMap(batch, HYBRID_CONCURRENCY, async (b) => {
        if (failed) return;
        const absPath = path.join(absRoot, b.rel);
        let content: string;
        try {
          const pre = opts.preloaded && opts.preloaded.get(b.rel);
          content = pre ? pre.toString('utf8') : await fs.promises.readFile(absPath, 'utf8');
        } catch {
          results[b.idx] = { issues: [] as Issue[], metric: null as FileMetric | null };
          completed++;
          if (T) T.hybridDone++;
          return;
        }
        try {
          const r = await runAnalyzersFn(b.rel, content);
          results[b.idx] = r;
        } catch (e) {
          fail(e);
          return;
        }
        completed++;
        if (T) T.hybridDone++;
      });
      if (T) T.hybridMs = nowMs() - tH0;
      // CRITICAL: the hybrid phase may be the LAST completer (when K is large enough that the
      // in-process phase outlasts the worker pool). Without this, `completed` can reach
      // `files.length` with no finishIfDone() caller left -> the pool promise never resolves
      // (deadlock). Safe when workers are still in flight: finishIfDone() returns false until
      // completed == files.length.
      finishIfDone();
    };

    /** A batch whose files are already read into transferable buffers. */
    interface ReadyBatch {
      tasks: { file: string; absPath: string; buf: Buffer }[];
      transfer: ArrayBuffer[];
    }

    /** Claim + pre-read one batch of files (index order preserved). */
    const readNextBatch = async (): Promise<ReadyBatch> => {
      const tR0 = T ? nowMs() : 0;
      const batchSize = Math.max(1, Math.min(WORKER_BATCH_SIZE, Math.ceil(files.length / n)));
      const batch: { idx: number; rel: string }[] = [];
      while (batch.length < batchSize && nextIdx < files.length) {
        const i = nextIdx++;
        batch.push({ idx: i, rel: files[i] });
      }
      const reads = await Promise.all(batch.map((b) => readTask(b.idx, b.rel)));
      const tasks: { file: string; absPath: string; buf: Buffer }[] = [];
      const transfer: ArrayBuffer[] = [];
      for (const r of reads) {
        if (r) {
          tasks.push({ file: r.file, absPath: r.absPath, buf: r.buf });
          transfer.push(r.buf.buffer as ArrayBuffer);
        }
      }
      if (T) {
        const d = nowMs() - tR0;
        T.readTotal += d;
        T.readCount++;
        T.readTimes.push(d);
      }
      return { tasks, transfer };
    };

    // P0-5: read-ahead pipeline — while a worker parses batch N, the main thread
    // pre-reads batch N+1 so the file I/O overlaps with worker CPU work (instead of
    // serializing: parse → results → read → dispatch).
    let inflightRead: Promise<ReadyBatch> | null = null;

    const dispatch = async (w: any) => {
      if (failed) return;
      let ready: ReadyBatch | null = null;
      if (inflightRead) {
        // Claim the pre-read batch SYNCHRONOUSLY (set to null before awaiting): if the
        // promise already resolved, two dispatches would otherwise both take the same
        // batch and the second postMessage would re-transfer detached buffers.
        const p = inflightRead;
        inflightRead = null;
        ready = await p;
      }
      if (!ready) {
        if (nextIdx >= files.length) {
          // No more files to claim AND no pre-read batch pending — this worker is done.
          // (When AR_TIMING is on, keep the worker alive so it can flush its table;
          // finishIfDone terminates all workers after the flush.)
          if (!T && !keepAlive) try { w.terminate(); } catch { /* ignore */ }
          return;
        }
        ready = await readNextBatch();
      }
      if (ready.tasks.length === 0) {
        // Every file in this batch was unreadable — nothing was dispatched.
        if (finishIfDone()) return;
        void dispatch(w);
        return;
      }
      // Start reading the NEXT batch while this worker parses the current one.
      if (nextIdx < files.length && !inflightRead) {
        inflightRead = readNextBatch();
      }
      const tPost0 = T ? nowMs() : 0;
      const msg: any = { tasks: ready.tasks };
      // T03: tag the message with the pool fingerprint so the worker reuses its
      // per-fp loaded modules (persistent pools only; cold keeps workerData defaults).
      if (fp !== undefined) {
        msg.fp = fp;
        msg.config = config;
        msg.descs = descs;
      }
      w.postMessage(msg, ready.transfer);
      if (T) {
        const tPost1 = nowMs();
        T.dispatchSyncTotal += tPost1 - tPost0;
        const k = workerIdx.get(w) ?? 0;
        const seq = ++T.seqCounter;
        T.lastDispatch[k] = tPost1;
        T.timeline.push({ seq, worker: k, dispatch: tPost1 - T.poolStart, arrive: -1, rt: -1 });
      }
    };

    // Hybrid startup: reserve [0, hybridK) BEFORE any worker dispatch (nextIdx advances
    // synchronously here, so the pool's readNextBatch starts at hybridK — no double-claim),
    // then kick off the in-process phase concurrently with the workers' typescript import.
    const hybridBatch: { idx: number; rel: string }[] = [];
    while (hybridBatch.length < hybridK && nextIdx < files.length) {
      const i = nextIdx++;
      hybridBatch.push({ idx: i, rel: files[i] });
    }
    void processHybrid(hybridBatch);

    const wire = (w: any, k: number, tSpawn0: number) => {
      workerIdx.set(w, k);
      w.on('online', () => {
        if (T) T.spawnMs[k] = nowMs() - tSpawn0;
      });
      w.on(
        'message',
        (res: { results: { file: string; issues: Issue[]; metric: FileMetric | null }[] }) => {
          const tArr = T ? nowMs() : 0;
          if (T) {
            const wk = workerIdx.get(w) ?? 0;
            if (T.firstMsgMs[wk] === undefined) {
              T.firstMsgMs[wk] = tArr - T.poolStart;
              if (T.hybridDoneAtFirstMsg === -1) T.hybridDoneAtFirstMsg = T.hybridDone;
            }
            // Fill the latest un-arrived timeline entry for this worker.
            for (let i = T.timeline.length - 1; i >= 0; i--) {
              const e = T.timeline[i];
              if (e.worker === wk && e.arrive < 0) {
                e.arrive = tArr - T.poolStart;
                e.rt = tArr - T.lastDispatch[wk];
                break;
              }
            }
          }
          let resArr = res.results;
          if (resArr !== undefined && resArr !== null && typeof resArr !== 'object' && !Array.isArray(resArr)) {
            // Unexpected scalar — treat as empty (defensive).
            resArr = [];
          }
          if (ArrayBuffer.isView(resArr) && !Array.isArray(resArr)) {
            // P2-5: worker transferred a binary result buffer (arrives as Uint8Array).
            resArr = decodeResults(resArr as unknown as Uint8Array);
          }
          resArr = resArr || [];
          for (const r of resArr) {
            const i = idxByFile.get(r.file);
            if (i !== undefined) results[i] = { issues: r.issues || [], metric: r.metric || null };
          }
          completed += resArr.length;
          if (T) T.mergeTotal += nowMs() - tArr;
          if (finishIfDone()) return;
          void dispatch(w);
        },
      );
      w.on('error', fail);
      void dispatch(w);
    };

    if (opts.workers && opts.workers.length > 0) {
      // Persistent pool — workers already spawned; wire + dispatch them.
      for (let k = 0; k < opts.workers.length; k++) {
        wire(opts.workers[k], k, 0);
      }
    } else {
      for (let k = 0; k < n; k++) {
        let w: any;
        const tSpawn0 = T ? nowMs() : 0;
        try {
          w = new Worker(workerPath, { workerData: { config, analyzerDescs: descs } });
        } catch (e) {
          fail(e);
          return;
        }
        workers.push(w);
        wire(w, k, tSpawn0);
      }
    }
  });
}

/**
 * Cold-path worker pool (docs/01-architecture/02-pipeline-and-caching.md §C1): spawns fresh workers, runs the batch
 * dispatcher with the parser-aware hybrid K, and terminates them at the end. This is the
 * EXACT legacy execution path — byte-identical output, only the scheduling differs.
 */
async function runWorkerPool(
  files: string[],
  absRoot: string,
  config: ScanConfig,
  descs: WorkerAnalyzerDesc[],
  numWorkers: number,
  logger: Logger,
  runAnalyzersFn: (
    rel: string,
    content: string,
  ) => Promise<{ issues: Issue[]; metric: FileMetric | null }>,
  preloaded?: Map<string, Buffer>,
): Promise<{ issues: Issue[]; metric: FileMetric | null }[]> {
  if (files.length === 0) return [];
  const n = Math.max(1, Math.min(numWorkers, files.length));
  const hybridK = computeHybridK(config, files.length, n);
  return dispatchBatches({
    files,
    absRoot,
    config,
    descs,
    numWorkers: n,
    logger,
    runAnalyzersFn,
    hybridK,
    keepAlive: false,
    preloaded,
  });
}

/**
 * Persistent worker-pool manager (docs/01-architecture/02-pipeline-and-caching.md §A3).
 *
 * - Pools are sharded by configuration fingerprint (`Map<fp, Worker[]>`); a config change
 *   (parser / analyzer set / thresholds) creates a NEW pool while old pools are LRU-pruned
 *   beyond `maxPools` (4).
 * - Workers are spawned lazily on first use (daemon startup spawns nothing).
 * - `warm` marks pools that completed ≥1 scan → hybrid startup (K) is disabled for them.
 * - RSS self-heal: >512MB terminates idle pools; >768MB gracefully exits (client restarts).
 */
export interface WorkerPoolEntry {
  fp: string;
  workers: any[];
  workerIdx: Map<any, number>;
  n: number;
  lastUsed: number;
  warm: boolean;
}

export class WorkerPoolManager {
  private pools = new Map<string, WorkerPoolEntry>();
  private order: string[] = [];
  readonly maxPools = 4;
  private readonly workerPath = path.join(__dirname, 'worker.js');

  /** Get (or lazily spawn) the pool for a configuration fingerprint. */
  getOrCreate(fp: string, config: ScanConfig, descs: WorkerAnalyzerDesc[], n: number): WorkerPoolEntry {
    let e = this.pools.get(fp);
    if (!e) {
      const workers: any[] = [];
      const workerIdx = new Map<any, number>();
      for (let k = 0; k < n; k++) {
        const w = new Worker(this.workerPath, { workerData: { config, analyzerDescs: descs } });
        workers.push(w);
        workerIdx.set(w, k);
      }
      e = { fp, workers, workerIdx, n, lastUsed: Date.now(), warm: false };
      this.pools.set(fp, e);
      this.order.push(fp);
      this.prune();
    }
    return e;
  }

  /** Mark a pool as most-recently-used (LRU order). */
  touch(fp: string): void {
    const i = this.order.indexOf(fp);
    if (i >= 0) this.order.splice(i, 1);
    this.order.push(fp);
    const e = this.pools.get(fp);
    if (e) e.lastUsed = Date.now();
  }

  /** LRU prune: terminate least-recently-used pools beyond maxPools. */
  prune(): void {
    while (this.order.length > this.maxPools) {
      const victim = this.order.shift();
      if (!victim) break;
      this.destroy(victim);
    }
  }

  /** Terminate + drop a pool (broken workers, LRU eviction, RSS guard). */
  destroy(fp: string): void {
    const e = this.pools.get(fp);
    if (!e) return;
    for (const w of e.workers) try { w.terminate(); } catch { /* ignore */ }
    this.pools.delete(fp);
    const i = this.order.indexOf(fp);
    if (i >= 0) this.order.splice(i, 1);
  }

  /**
   * RSS self-heal (docs/01-architecture/02-pipeline-and-caching.md §A3.4): >512MB → drop idle (non-warm) pools and keep
   * at most the most-recent pool; >768MB → log + graceful exit (the client's next connect
   * auto-restarts it under --daemon).
   */
  rssGuard(): void {
    const rss = process.memoryUsage().rss;
    if (rss > 768 * 1024 * 1024) {
      try {
        process.stderr.write(
          `[auto-refactor daemon] RSS ${(rss / 1048576).toFixed(0)}MB > 768MB — graceful exit (client will restart)\n`,
        );
      } catch {
        /* ignore */
      }
      this.shutdown();
      setImmediate(() => process.exit(0));
      return;
    }
    if (rss > 512 * 1024 * 1024) {
      for (const fp of [...this.order]) {
        const e = this.pools.get(fp);
        if (e && !e.warm) this.destroy(fp);
      }
      while (this.pools.size > 1) {
        const victim = this.order[0];
        if (!victim) break;
        this.destroy(victim);
      }
    }
  }

  shutdown(): void {
    for (const fp of [...this.pools.keys()]) this.destroy(fp);
  }

  size(): number {
    return this.pools.size;
  }
}

/**
 * Session-scoped result cache shared across scans WITHIN one process (the daemon).
 * Keyed by pool fingerprint → relPath → per-file result. L1 hits reuse these results
 * with ZERO disk reads — that is what makes the second scan of a warm daemon <30ms.
 */
export interface WarmSession {
  results: Map<string, Map<string, { issues: Issue[]; metric: FileMetric | null }>>;
  /** Per-file line-level incremental state (subtree caches), keyed by pool fp → rel path. */
  incremental: Map<string, Map<string, IncrementalFileState>>;
}

export function createWarmSession(): WarmSession {
  return { results: new Map(), incremental: new Map() };
}

export interface ScanWithCacheOptions {
  cache: CacheStore;
  /** Cross-scan session results (daemon). Optional — CLI creates a throwaway session. */
  session?: WarmSession;
  /** Persistent pool manager (daemon). Absent → cold create/terminate pool per scan. */
  pool?: WorkerPoolManager;
  /** Enable L2 for custom analyzers by hashing their module content (docs/01-architecture/02-pipeline-and-caching.md §B7). */
  cacheCustom?: boolean;
}

/**
 * Diff-scan options (docs/03-incremental-and-diff/02-diff-interface-spec.md §1.7). Additive to `ScanWithCacheOptions`:
 * the scanner pre-routes changed files from `diffHints` (byteEqual/incremental/full) before
 * the L1/L2 decision, while unchanged files keep the normal warm path.
 */
export interface ScanWithDiffOptions extends ScanWithCacheOptions {
  /** rel → DiffInput for the changed files (deduped + validated by the caller). */
  diffHints: Map<string, DiffInput>;
  /** Verify the diff system's newContent against disk bytes (default true at the API). */
  verifyDiskContent: boolean;
  /** true = `scanDiffDelta` semantics: only the diff files, skip unchanged-file discovery/L1/L2. */
  deltaOnly?: boolean;
}

/** Concurrency constants for the cache probe phase (kept for reference; sync ops used). */
const CACHE_STAT_CONCURRENCY = 32;
const CACHE_READ_CONCURRENCY = 32;

/**
 * Re-map a cached per-file result from the path it was originally computed for to the
 * CURRENT rel path (docs/01-architecture/02-pipeline-and-caching.md §B2/B5). L2 entries are keyed by content hash —
 * identical files SHARE one entry, but issue ids/locations/metric.file embed the source
 * path, so a reuse across files must rewrite those fields. Built-in analyzer messages and
 * detail payloads do not embed the path (only ids + locations do), which is exactly what
 * is rewritten here. (Custom analyzers disable L2 by default — T06 — so this stays safe.)
 */
function remapCachedResult(
  result: CachedResult,
  fromRel: string,
  toRel: string,
): CachedResult {
  if (fromRel === toRel) return result;
  const issues = result.issues.map((it) => {
    const line = it.location && it.location.start ? it.location.start.line : 1;
    return {
      ...it,
      id: `${it.analyzer}:${it.rule}:${toRel}:${line}`,
      location: it.location ? { ...it.location, file: toRel } : it.location,
    };
  });
  const metric = result.metric ? { ...result.metric, file: toRel } : null;
  return { issues, metric };
}

/** Normalize a diff-input filePath to a rel path (POSIX '/') inside root, or null if illegal. */
function normalizeRelPath(filePath: string, absRoot: string): string | null {
  if (!filePath || typeof filePath !== 'string') return null;
  const abs = path.isAbsolute(filePath) ? filePath : path.resolve(absRoot, filePath);
  const rel = path.relative(absRoot, abs);
  if (rel === '' || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join('/');
}

export class Scanner {
  private plan: ResolvedAnalyzer[];
  private logger: Logger;

  constructor(
    private config: ScanConfig,
    logger?: Logger,
  ) {
    this.logger = logger || new Logger(config.logLevel, config.logFile);
    this.plan = resolveAnalyzers(config, config.baseDir || process.cwd());
    this.logger.debug(
      `resolved ${this.plan.length} analyzer(s): ${this.plan.map((p) => p.name).join(', ') || '(none)'}`,
    );
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
   */
  async scan(): Promise<ScanReport> {
    const cfg = this.config;
    const t0 = Date.now();
    const absRoot = path.resolve(cfg.root);
    const includeRx = cfg.include.map(globToRegExp);
    const excludeRx = cfg.exclude.map(globToRegExp);

    const giIgnore = cfg.respectGitignore ? loadGitignore(absRoot) : null;
    const files = this.collectFiles(absRoot, includeRx, excludeRx, giIgnore);
    this.logger.info(`discovered ${files.length} file(s) under ${absRoot}`);
    // AR_TIMING uses performance.now() (module-level nowMs) so all stage deltas share one base.
    const ts0 = AR_TIMING ? nowMs() : 0;
    const tDiscover = ts0;

    const concurrency = Math.max(1, cfg.concurrency | 0);

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
    //   - workers === 0 (auto)                         -> up to min(availableParallelism, 8); needs >= 8 files
    //   - workers === N (>1)                           -> exactly N threads (any file count)
    const effWorkers = cfg.workers <= 0
      ? Math.min(os.availableParallelism ? os.availableParallelism() : os.cpus().length, 8)
      : cfg.workers;
    const auto = cfg.workers <= 0;
    const useWorkers = effWorkers > 1 && files.length >= (auto ? 8 : 1);

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
        this.logger.warn(`worker pool failed (${String(e)}); falling back to in-process scan`);
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
      if (a.location.file !== b.location.file) return a.location.file < b.location.file ? -1 : 1;
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
   * Warm-scan pipeline (docs/01-architecture/02-pipeline-and-caching.md §B5): the SAME aggregation as `scan()` but with
   * L1 stat skip + L2 content-hash reuse before the worker pool dispatch. Only L2-miss files
   * are analyzed. Cached per-file results are placed into the SAME index-aligned perFile
   * array, then `issues.sort` + `buildReport` run unchanged → byte-identical output.
   *
   * With an empty cache this degenerates to a full cold scan (every file L2-miss → analyzed).
   * Cache writes are buffered and flushed atomically at the end (never fatal on failure).
   */
  async scanWithCache(opts: ScanWithCacheOptions): Promise<{ report: ScanReport; stats: WarmStats }> {
    const cfg = this.config;
    const cache = opts.cache;
    const t0 = Date.now();
    const absRoot = path.resolve(cfg.root);
    const includeRx = cfg.include.map(globToRegExp);
    const excludeRx = cfg.exclude.map(globToRegExp);
    const giIgnore = cfg.respectGitignore ? loadGitignore(absRoot) : null;
    const files = this.collectFiles(absRoot, includeRx, excludeRx, giIgnore);
    this.logger.info(`discovered ${files.length} file(s) under ${absRoot}`);

    // ---- cache-key setup ----
    const descs: FingerprintAnalyzerDesc[] = this.plan.map((p) => ({
      name: p.name,
      version: ANALYZER_VERSIONS[p.name] ?? 1,
      modulePath: p.modulePath,
      options: p.options,
      legacy: typeof (p.instance as any).visit !== 'function',
    }));
    const customAnalyzers = (cfg.customAnalyzers || []).filter((c) => c.enabled !== false);
    // T06: custom analyzers disable L2 unless --cache-custom AND the module hash can be
    // computed (unreadable module ⇒ cannot prove purity ⇒ L2 stays off to avoid stale reuse).
    const customHash =
      customAnalyzers.length > 0 && opts.cacheCustom === true ? computeCustomHash(descs) : null;
    const l2Enabled = customAnalyzers.length === 0 || (opts.cacheCustom === true && customHash !== null);

    const poolFp = buildPoolFingerprint(cfg, descs);
    const payloadByAdapter = new Map<string, string>(); // "adapterId|ext" -> fpHash
    const fpHashFor = (rel: string): string => {
      const adapterId = adapterIdFor(rel, cfg.parser);
      // Defensive redundancy: distinguish .d.ts from .ts in the key (docs/01-architecture/02-pipeline-and-caching.md §B7).
      const fileExt = rel.toLowerCase().endsWith('.d.ts') ? '.d.ts' : path.extname(rel).toLowerCase();
      const key = adapterId + '|' + fileExt;
      let h = payloadByAdapter.get(key);
      if (!h) {
        const payload = buildFingerprintPayload(cfg, adapterId, fileExt, descs, customHash);
        h = fpHash(payload);
        payloadByAdapter.set(key, h);
      }
      return h;
    };

    // ---- cross-scan session bucket (daemon) ----
    const session = opts.session || createWarmSession();
    let sessionBucket = session.results.get(poolFp);
    if (!sessionBucket) {
      sessionBucket = new Map<string, { issues: Issue[]; metric: FileMetric | null }>();
      session.results.set(poolFp, sessionBucket);
    }
    // Per-file line-level incremental state (subtree caches), sharded like session results.
    let incBucket = session.incremental.get(poolFp);
    if (!incBucket) {
      incBucket = new Map<string, IncrementalFileState>();
      session.incremental.set(poolFp, incBucket);
    }

    const perFile: ({ issues: Issue[]; metric: FileMetric | null } | null)[] = new Array(files.length);
    let l1Hit = 0;
    let l2Hit = 0;
    let analyzed = 0;
    let poolWarmFlag = false;
    let incrementalFiles = 0;
    let incrementalHit = 0;
    const incEnabled = incrementalEnabled() || cfg.incremental === true;
    const incMinLines = cfg.incrementalMinLines ?? incrementalMinLines();
    const toAnalyze: { idx: number; rel: string; fpHash: string; contentHash: string; buf?: Buffer }[] = [];
    const toIncremental: { idx: number; rel: string; fpHash: string; contentHash: string; state: IncrementalFileState; content: string }[] = [];
    const l2Refresh: { fpHash: string; contentHash: string; rel: string; result: CachedResult; fp?: Fingerprint }[] = [];
    const l1Fps: { rel: string; fp: Fingerprint }[] = [];

    // ---- Step 1: L1 stat (bounded concurrency) ----
    // Sync stat/read: small files through the async libuv threadpool (default 4 threads) are
    // SLOWER than sequential sync calls here — sync keeps the warm path's cache probe cheap.
    const statResults: { rel: string; fp: Fingerprint | null; idx: number }[] = new Array(files.length);
    for (let i = 0; i < files.length; i++) {
      const rel = files[i];
      try {
        const st = fs.statSync(path.join(absRoot, rel));
        statResults[i] = { rel, fp: { mtimeMs: st.mtimeMs, size: st.size, ino: st.ino }, idx: i };
      } catch {
        statResults[i] = { rel, fp: null, idx: i };
      }
    }

    // ---- Step 2: L1/L2 decision per file ----
    for (const s of statResults) {
      const i = s.idx;
      const rel = s.rel;
      if (s.fp) l1Fps.push({ rel, fp: s.fp });
      const l1 = cache.lookupL1(rel);
      if (s.fp && l1 && l1.mtimeMs === s.fp.mtimeMs && l1.size === s.fp.size) {
        // L1 hit: file unchanged — reuse the session result when present (0 reads, 0 hash).
        const cached = sessionBucket.get(rel);
        if (cached) {
          perFile[i] = cached;
          l1Hit++;
          continue;
        }
        // Fresh process (no session): the L1 fingerprint + the L2-by-path index prove the
        // previous result is still valid — reuse WITHOUT reading the file.
        const fph = fpHashFor(rel);
        const byPath = l2Enabled ? cache.lookupL2ByPath(fph, rel, s.fp.mtimeMs, s.fp.size) : null;
        if (byPath) {
          const result = remapCachedResult({ issues: byPath.issues, metric: byPath.metric }, byPath.p, rel);
          perFile[i] = result;
          sessionBucket.set(rel, result);
          l1Hit++;
          continue;
        }
        // No cached result under this fingerprint — fall through to content hash → L2.
      }
      let buf: Buffer;
      try {
        buf = fs.readFileSync(path.join(absRoot, rel));
      } catch {
        perFile[i] = { issues: [] as Issue[], metric: null as FileMetric | null };
        continue;
      }
      const contentHash = sha256Hex(buf);
      const fph = fpHashFor(rel);
      const l2 = l2Enabled ? cache.lookupL2(fph, contentHash) : null;
      if (l2) {
        // Identical files share one L2 entry — remap path-embedded fields to THIS file.
        const result = remapCachedResult({ issues: l2.issues, metric: l2.metric }, l2.p, rel);
        perFile[i] = result;
        sessionBucket.set(rel, result);
        l2Hit++;
        l2Refresh.push({ fpHash: fph, contentHash, rel, result, fp: s.fp || undefined });
        continue;
      }
      // ---- line-level incremental routing (docs/03-incremental-and-diff/01-line-level-incremental.md §4/§7) ----
      // Only big files are candidates; small files keep the file-level L2 path (diff + cache
      // management would be net-negative). A big-file candidate is ALWAYS analyzed in-process
      // (never via the worker pool) so its `IncrementalFileState` subtree caches (with parsed
      // raw nodes) stay in the daemon's main process across scans.
      if (incEnabled && countLines(buf.toString('utf8')) >= incMinLines) {
        const newContent = buf.toString('utf8');
        const oldState = incBucket.get(rel);
        if (oldState) {
          // T02b: refresh LRU recency — this file's incremental state was just consulted.
          touchIncremental(incBucket, rel);
          const r = route(rel, oldState.content, newContent, oldState, {
            enabled: true,
            minLines: incMinLines,
          });
          if (r.mode === 'incremental') {
            oldState.prepare(newContent, contentHash);
            toIncremental.push({ idx: i, rel, fpHash: fph, contentHash, state: oldState, content: newContent });
            continue;
          }
          // Big change (or identical content) → full rescan; replace the state so the next
          // small change can still go incremental (subtrees are rebuilt + re-cached below).
        }
        const fresh = new IncrementalFileState(newContent, contentHash);
        fresh.prepare(newContent, contentHash);
        incBucket.set(rel, fresh);
        toIncremental.push({ idx: i, rel, fpHash: fph, contentHash, state: fresh, content: newContent });
        continue;
      }
      toAnalyze.push({ idx: i, rel, fpHash: fph, contentHash, buf });
    }

    // ---- Step 3: analyze only L2-miss files ----
    const fpByRel = new Map<string, Fingerprint>(l1Fps.map((w) => [w.rel, w.fp]));
    const preloaded = new Map<string, Buffer>();
    for (const t of toAnalyze) if (t.buf) preloaded.set(t.rel, t.buf);
    if (toAnalyze.length > 0) {
      const missFiles = toAnalyze.map((t) => files[t.idx]);
      const workerDescs = this.plan.map((p) => ({ name: p.name, modulePath: p.modulePath, options: p.options }));
      const effWorkers = cfg.workers <= 0
        ? Math.min(os.availableParallelism ? os.availableParallelism() : os.cpus().length, 8)
        : cfg.workers;
      const auto = cfg.workers <= 0;
      const useWorkers = effWorkers > 1 && missFiles.length >= (auto ? 8 : 1);

      let results: { issues: Issue[]; metric: FileMetric | null }[];
      if (useWorkers && opts.pool) {
        const entry = opts.pool.getOrCreate(poolFp, cfg, workerDescs, effWorkers);
        poolWarmFlag = entry.warm;
        try {
          results = await dispatchBatches({
            workers: entry.workers,
            workerIdx: entry.workerIdx,
            files: missFiles,
            absRoot,
            config: cfg,
            descs: workerDescs,
            numWorkers: entry.n,
            logger: this.logger,
            runAnalyzersFn: this.runAnalyzers.bind(this),
            // Hybrid only masks worker COLD-import dead time; warm pools get K=0.
            hybridK: entry.warm ? 0 : computeHybridK(cfg, missFiles.length, entry.n),
            keepAlive: true,
            fp: poolFp,
            preloaded,
          });
          entry.warm = true;
          entry.lastUsed = Date.now();
          opts.pool.touch(poolFp);
        } catch (e) {
          this.logger.warn(`persistent worker pool failed (${String(e)}); falling back to in-process`);
          opts.pool.destroy(poolFp);
          results = await this.runInProcess(missFiles, absRoot, preloaded);
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
            this.logger,
            this.runAnalyzers.bind(this),
            preloaded,
          );
        } catch (e) {
          this.logger.warn(`worker pool failed (${String(e)}); falling back to in-process scan`);
          results = await this.runInProcess(missFiles, absRoot, preloaded);
        }
      } else {
        results = await this.runInProcess(missFiles, absRoot, preloaded);
      }

      for (let k = 0; k < toAnalyze.length; k++) {
        const t = toAnalyze[k];
        perFile[t.idx] = results[k];
        sessionBucket.set(t.rel, results[k]);
        analyzed++;
        if (l2Enabled) cache.writeL2(t.fpHash, t.contentHash, t.rel, results[k], fpByRel.get(t.rel));
      }
    }

    // ---- Step 3b: line-level incremental (in-process; never via the worker pool) ----
    // Big-file candidates carry a `seed` so the adapters can reuse unchanged function subtrees
    // (and re-cache them for the NEXT scan). Any anomaly falls back to a plain full rescan —
    // the produced bytes are identical either way, so this is purely a perf path.
    for (const t of toIncremental) {
      let result: { issues: Issue[]; metric: FileMetric | null };
      try {
        result = await this.runAnalyzers(t.rel, t.content, t.state);
      } catch (e) {
        this.logger.warn(`line-level incremental failed on ${t.rel}: ${String(e)}; full rescan`);
        t.state.finalize();
        const fresh = new IncrementalFileState(t.content, t.contentHash);
        fresh.prepare(t.content, t.contentHash);
        incBucket.set(t.rel, fresh);
        try {
          result = await this.runAnalyzers(t.rel, t.content, fresh);
        } catch (e2) {
          this.logger.warn(`seeded materialization failed on ${t.rel}: ${String(e2)}; unseeded rescan`);
          result = await this.runAnalyzers(t.rel, t.content);
        }
      }
      t.state.finalize();
      perFile[t.idx] = result;
      sessionBucket.set(t.rel, result);
      analyzed++;
      incrementalHit += t.state.reuseHits;
      incrementalFiles++;
      if (l2Enabled) cache.writeL2(t.fpHash, t.contentHash, t.rel, result, fpByRel.get(t.rel));
    }

    // ---- Step 3c: boundedness (T02b) — LRU prune + RSS guard for the incremental buckets.
    // Purely a memory-control pass: evicted files simply lose their subtree/memo caches and
    // fall back to a full rescan on their next change (byte-identical, just slower).
    const incPruned = pruneIncrementalBucket(incBucket, incrementalMaxFiles());
    const incRssEvicted = incrementalRssGuard(session);
    if (incPruned > 0) {
      this.logger.debug(`incremental LRU: evicted ${incPruned} file state(s) (bucket=${incBucket.size})`);
    }
    if (incRssEvicted > 0) {
      this.logger.warn(`incremental RSS guard: cleared ${incRssEvicted} file state(s)`);
    }

    // ---- Step 4: write-back (L1 fingerprints + L2 ts refresh) + atomic flush ----
    for (const w of l1Fps) cache.writeL1(w.rel, w.fp);
    for (const w of l2Refresh) cache.writeL2(w.fpHash, w.contentHash, w.rel, w.result, w.fp);
    cache.flush();

    // ---- Step 5: aggregate (byte-identical to cold) ----
    const issues: Issue[] = [];
    const fileMetrics: FileMetric[] = [];
    for (const r of perFile) {
      if (!r) continue; // unreachable — every path fills perFile[i]
      issues.push(...r.issues);
      if (r.metric) fileMetrics.push(r.metric);
    }
    issues.sort((a, b) => {
      if (a.location.file !== b.location.file) return a.location.file < b.location.file ? -1 : 1;
      if (a.location.start.line !== b.location.start.line)
        return a.location.start.line - b.location.start.line;
      if (a.analyzer !== b.analyzer) return a.analyzer < b.analyzer ? -1 : 1;
      return a.rule < b.rule ? -1 : 1;
    });

    const durationMs = Date.now() - t0;
    const report = this.buildReport(files.length, issues, fileMetrics, durationMs);
    this.logger.info(
      `done in ${durationMs}ms: ${report.summary.issuesTotal} issue(s) ` +
        `[cache l1=${l1Hit} l2=${l2Hit} analyzed=${analyzed}/${files.length}]`,
    );

    const stats: WarmStats = {
      daemonUsed: false, // filled by the daemon layer when applicable
      l1Hit,
      l2Hit,
      cacheHit: l1Hit + l2Hit,
      cacheTotal: files.length,
      analyzed,
      poolWarm: poolWarmFlag,
      daemonMs: 0,
      incrementalFiles,
      incrementalHit,
    };
    return { report, stats };
  }

  /**
   * Diff-scan pipeline (docs/03-incremental-and-diff/02-diff-interface-spec.md §1.7 / §3). Additive to `scanWithCache`:
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
   */
  async scanWithDiff(opts: ScanWithDiffOptions & { deltaOnly?: false }): Promise<{ report: ScanReport; stats: DiffStats }>;
  async scanWithDiff(opts: ScanWithDiffOptions & { deltaOnly: true }): Promise<{ report: DiffDeltaReport; stats: DiffStats }>;
  async scanWithDiff(opts: ScanWithDiffOptions & { deltaOnly?: boolean }): Promise<{ report: ScanReport | DiffDeltaReport; stats: DiffStats }> {
    const cfg = this.config;
    const cache = opts.cache;
    const deltaOnly = opts.deltaOnly === true;
    const t0 = Date.now();
    const absRoot = path.resolve(cfg.root);
    const includeRx = cfg.include.map(globToRegExp);
    const excludeRx = cfg.exclude.map(globToRegExp);
    const giIgnore = cfg.respectGitignore ? loadGitignore(absRoot) : null;

    // ---- normalize + dedupe + discoverability-filter the diff inputs ----
    const discovered = this.collectFiles(absRoot, includeRx, excludeRx, giIgnore);
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

    // deltaOnly → only the (discovered) diff files; full → every discovered file.
    const files: string[] = deltaOnly ? [...hints.keys()].sort() : discovered;
    this.logger.info(`diff scan: ${files.length} file(s) (diffHints=${hints.size}, ignored=${diffIgnored}, deltaOnly=${deltaOnly})`);

    // ---- cache-key setup (mirrors scanWithCache) ----
    const descs: FingerprintAnalyzerDesc[] = this.plan.map((p) => ({
      name: p.name,
      version: ANALYZER_VERSIONS[p.name] ?? 1,
      modulePath: p.modulePath,
      options: p.options,
      legacy: typeof (p.instance as any).visit !== 'function',
    }));
    const customAnalyzers = (cfg.customAnalyzers || []).filter((c) => c.enabled !== false);
    const customHash =
      customAnalyzers.length > 0 && opts.cacheCustom === true ? computeCustomHash(descs) : null;
    const l2Enabled = customAnalyzers.length === 0 || (opts.cacheCustom === true && customHash !== null);
    const poolFp = buildPoolFingerprint(cfg, descs);
    const payloadByAdapter = new Map<string, string>();
    const fpHashFor = (rel: string): string => {
      const adapterId = adapterIdFor(rel, cfg.parser);
      const fileExt = rel.toLowerCase().endsWith('.d.ts') ? '.d.ts' : path.extname(rel).toLowerCase();
      const key = adapterId + '|' + fileExt;
      let h = payloadByAdapter.get(key);
      if (!h) {
        h = fpHash(buildFingerprintPayload(cfg, adapterId, fileExt, descs, customHash));
        payloadByAdapter.set(key, h);
      }
      return h;
    };

    // ---- cross-scan session + incremental buckets ----
    const session = opts.session || createWarmSession();
    let sessionBucket = session.results.get(poolFp);
    if (!sessionBucket) {
      sessionBucket = new Map<string, { issues: Issue[]; metric: FileMetric | null }>();
      session.results.set(poolFp, sessionBucket);
    }
    let incBucket = session.incremental.get(poolFp);
    if (!incBucket) {
      incBucket = new Map<string, IncrementalFileState>();
      session.incremental.set(poolFp, incBucket);
    }

    const perFile: ({ issues: Issue[]; metric: FileMetric | null } | null)[] = new Array(files.length);
    let l1Hit = 0;
    let l2Hit = 0;
    let analyzed = 0;
    let poolWarmFlag = false;
    let incrementalFiles = 0;
    let incrementalHit = 0;
    let diffFiles = 0;
    let byteEqual = 0;
    let diffIncremental = 0;
    let diffFull = 0;
    let rangesProvided = 0;
    let rangesFallback = 0;
    let oldContentFromDaemon = 0;
    const incEnabled = incrementalEnabled() || cfg.incremental === true;
    const incMinLines = cfg.incrementalMinLines ?? incrementalMinLines();
    const toAnalyze: { idx: number; rel: string; fpHash: string; contentHash: string; buf?: Buffer }[] = [];
    const toIncremental: { idx: number; rel: string; fpHash: string; contentHash: string; state: IncrementalFileState; content: string }[] = [];
    const l2Refresh: { fpHash: string; contentHash: string; rel: string; result: CachedResult; fp?: Fingerprint }[] = [];
    const l1Fps: { rel: string; fp: Fingerprint }[] = [];

    // Route a changed file through a PLAIN full rescan (big file → fresh incremental state so a
    // future small change can still go incremental; small file → the worker/in-process pool).
    const routeFull = (
      fph: string,
      contentHash: string,
      rel: string,
      newContent: string,
      buf: Buffer,
      idx: number,
    ): void => {
      if (incEnabled && countLines(newContent) >= incMinLines) {
        const fresh = new IncrementalFileState(newContent, contentHash);
        fresh.prepare(newContent, contentHash);
        incBucket.set(rel, fresh);
        toIncremental.push({ idx, rel, fpHash: fph, contentHash, state: fresh, content: newContent });
      } else {
        toAnalyze.push({ idx, rel, fpHash: fph, contentHash, buf });
      }
    };

    // ---- Step 1: stat (L1 fingerprints; diff files are stat'd too for L2 write-back) ----
    const statResults: { rel: string; fp: Fingerprint | null; idx: number }[] = new Array(files.length);
    for (let i = 0; i < files.length; i++) {
      const rel = files[i];
      try {
        const st = fs.statSync(path.join(absRoot, rel));
        statResults[i] = { rel, fp: { mtimeMs: st.mtimeMs, size: st.size, ino: st.ino }, idx: i };
      } catch {
        statResults[i] = { rel, fp: null, idx: i };
      }
    }

    // ---- Step 2: diff-hint routing (changed files) + L1/L2 (unchanged files) ----
    for (const s of statResults) {
      const i = s.idx;
      const rel = s.rel;
      if (s.fp) l1Fps.push({ rel, fp: s.fp });

      const diffInput = hints.get(rel);
      if (diffInput) {
        diffFiles++;
        let buf: Buffer;
        try {
          buf = fs.readFileSync(path.join(absRoot, rel));
        } catch {
          perFile[i] = { issues: [] as Issue[], metric: null as FileMetric | null };
          diffFull++;
          continue;
        }
        const newContent = buf.toString('utf8');
        const contentHash = sha256Hex(buf);
        const fph = fpHashFor(rel);

        // Canonical newContent = disk bytes. Verify the hint against disk (default on); a
        // mismatch means the diff system's content drifted → plain full rescan of the disk.
        if (opts.verifyDiskContent) {
          const provided = decodeContent((diffInput as any).newContent);
          if (sha256Hex(Buffer.from(provided, 'utf8')) !== contentHash) {
            this.logger.warn(`diff newContent mismatch on ${rel}; falling back to full rescan`);
            diffFull++;
            routeFull(fph, contentHash, rel, newContent, buf, i);
            continue;
          }
        }

        const state = incBucket.get(rel);
        const resolved = resolveDiff(diffInput, {
          enabled: incEnabled,
          minLines: incMinLines,
          maxChangedLines: incrementalMaxChangedLines(),
          state,
          newContent,
          buf,
        });
        if (resolved.rangesProvided) rangesProvided++;
        if (resolved.rangesFallback) rangesFallback++;
        if (resolved.oldContentFromState) oldContentFromDaemon++;

        if (resolved.mode === 'incremental') {
          diffIncremental++;
          state!.prepare(newContent, contentHash);
          toIncremental.push({ idx: i, rel, fpHash: fph, contentHash, state: state!, content: newContent });
          continue;
        }

        if (resolved.mode === 'byteEqual') {
          byteEqual++;
          // No actual content change → reuse L2 by content hash (content-addressed, safe).
          const l2 = l2Enabled ? cache.lookupL2(fph, contentHash) : null;
          if (l2) {
            const result = remapCachedResult({ issues: l2.issues, metric: l2.metric }, l2.p, rel);
            perFile[i] = result;
            sessionBucket.set(rel, result);
            l2Hit++;
            l2Refresh.push({ fpHash: fph, contentHash, rel, result, fp: s.fp || undefined });
            continue;
          }
          // Not cached yet → analyze once; it lands in L2 for the next scan.
          routeFull(fph, contentHash, rel, newContent, buf, i);
          continue;
        }

        diffFull++;
        routeFull(fph, contentHash, rel, newContent, buf, i);
        continue;
      }

      // ---- unchanged file (full mode only; deltaOnly never reaches here) ----
      const l1 = cache.lookupL1(rel);
      if (s.fp && l1 && l1.mtimeMs === s.fp.mtimeMs && l1.size === s.fp.size) {
        const cached = sessionBucket.get(rel);
        if (cached) {
          perFile[i] = cached;
          l1Hit++;
          continue;
        }
        const fph = fpHashFor(rel);
        const byPath = l2Enabled ? cache.lookupL2ByPath(fph, rel, s.fp.mtimeMs, s.fp.size) : null;
        if (byPath) {
          const result = remapCachedResult({ issues: byPath.issues, metric: byPath.metric }, byPath.p, rel);
          perFile[i] = result;
          sessionBucket.set(rel, result);
          l1Hit++;
          continue;
        }
      }
      let buf: Buffer;
      try {
        buf = fs.readFileSync(path.join(absRoot, rel));
      } catch {
        perFile[i] = { issues: [] as Issue[], metric: null as FileMetric | null };
        continue;
      }
      const contentHash = sha256Hex(buf);
      const fph = fpHashFor(rel);
      const l2 = l2Enabled ? cache.lookupL2(fph, contentHash) : null;
      if (l2) {
        const result = remapCachedResult({ issues: l2.issues, metric: l2.metric }, l2.p, rel);
        perFile[i] = result;
        sessionBucket.set(rel, result);
        l2Hit++;
        l2Refresh.push({ fpHash: fph, contentHash, rel, result, fp: s.fp || undefined });
        continue;
      }
      if (incEnabled && countLines(buf.toString('utf8')) >= incMinLines) {
        const newContent = buf.toString('utf8');
        const oldState = incBucket.get(rel);
        if (oldState) {
          touchIncremental(incBucket, rel);
          const r = route(rel, oldState.content, newContent, oldState, { enabled: true, minLines: incMinLines });
          if (r.mode === 'incremental') {
            oldState.prepare(newContent, contentHash);
            toIncremental.push({ idx: i, rel, fpHash: fph, contentHash, state: oldState, content: newContent });
            continue;
          }
        }
        const fresh = new IncrementalFileState(newContent, contentHash);
        fresh.prepare(newContent, contentHash);
        incBucket.set(rel, fresh);
        toIncremental.push({ idx: i, rel, fpHash: fph, contentHash, state: fresh, content: newContent });
        continue;
      }
      toAnalyze.push({ idx: i, rel, fpHash: fph, contentHash, buf });
    }

    // ---- Step 3: analyze L2-miss / full-rescan files (worker pool or in-process) ----
    const fpByRel = new Map<string, Fingerprint>(l1Fps.map((w) => [w.rel, w.fp]));
    const preloaded = new Map<string, Buffer>();
    for (const t of toAnalyze) if (t.buf) preloaded.set(t.rel, t.buf);
    if (toAnalyze.length > 0) {
      const missFiles = toAnalyze.map((t) => files[t.idx]);
      const workerDescs = this.plan.map((p) => ({ name: p.name, modulePath: p.modulePath, options: p.options }));
      const effWorkers = cfg.workers <= 0
        ? Math.min(os.availableParallelism ? os.availableParallelism() : os.cpus().length, 8)
        : cfg.workers;
      const auto = cfg.workers <= 0;
      const useWorkers = effWorkers > 1 && missFiles.length >= (auto ? 8 : 1);

      let results: { issues: Issue[]; metric: FileMetric | null }[];
      if (useWorkers && opts.pool) {
        const entry = opts.pool.getOrCreate(poolFp, cfg, workerDescs, effWorkers);
        poolWarmFlag = entry.warm;
        try {
          results = await dispatchBatches({
            workers: entry.workers, workerIdx: entry.workerIdx, files: missFiles, absRoot,
            config: cfg, descs: workerDescs, numWorkers: entry.n, logger: this.logger,
            runAnalyzersFn: this.runAnalyzers.bind(this),
            hybridK: entry.warm ? 0 : computeHybridK(cfg, missFiles.length, entry.n),
            keepAlive: true, fp: poolFp, preloaded,
          });
          entry.warm = true;
          entry.lastUsed = Date.now();
          opts.pool.touch(poolFp);
        } catch (e) {
          this.logger.warn(`persistent worker pool failed (${String(e)}); falling back to in-process`);
          opts.pool.destroy(poolFp);
          results = await this.runInProcess(missFiles, absRoot, preloaded);
        }
        opts.pool.rssGuard();
      } else if (useWorkers) {
        try {
          results = await runWorkerPool(missFiles, absRoot, cfg, workerDescs, effWorkers, this.logger, this.runAnalyzers.bind(this), preloaded);
        } catch (e) {
          this.logger.warn(`worker pool failed (${String(e)}); falling back to in-process scan`);
          results = await this.runInProcess(missFiles, absRoot, preloaded);
        }
      } else {
        results = await this.runInProcess(missFiles, absRoot, preloaded);
      }

      for (let k = 0; k < toAnalyze.length; k++) {
        const t = toAnalyze[k];
        perFile[t.idx] = results[k];
        sessionBucket.set(t.rel, results[k]);
        analyzed++;
        if (l2Enabled) cache.writeL2(t.fpHash, t.contentHash, t.rel, results[k], fpByRel.get(t.rel));
      }
    }

    // ---- Step 3b: line-level incremental (in-process) ----
    for (const t of toIncremental) {
      let result: { issues: Issue[]; metric: FileMetric | null };
      try {
        result = await this.runAnalyzers(t.rel, t.content, t.state);
      } catch (e) {
        this.logger.warn(`line-level incremental failed on ${t.rel}: ${String(e)}; full rescan`);
        t.state.finalize();
        const fresh = new IncrementalFileState(t.content, t.contentHash);
        fresh.prepare(t.content, t.contentHash);
        incBucket.set(t.rel, fresh);
        try {
          result = await this.runAnalyzers(t.rel, t.content, fresh);
        } catch (e2) {
          this.logger.warn(`seeded materialization failed on ${t.rel}: ${String(e2)}; unseeded rescan`);
          result = await this.runAnalyzers(t.rel, t.content);
        }
      }
      t.state.finalize();
      perFile[t.idx] = result;
      sessionBucket.set(t.rel, result);
      analyzed++;
      incrementalHit += t.state.reuseHits;
      incrementalFiles++;
      if (l2Enabled) cache.writeL2(t.fpHash, t.contentHash, t.rel, result, fpByRel.get(t.rel));
    }

    // ---- Step 3c: boundedness (LRU + RSS) ----
    const incPruned = pruneIncrementalBucket(incBucket, incrementalMaxFiles());
    const incRssEvicted = incrementalRssGuard(session);
    if (incPruned > 0) this.logger.debug(`incremental LRU: evicted ${incPruned} file state(s) (bucket=${incBucket.size})`);
    if (incRssEvicted > 0) this.logger.warn(`incremental RSS guard: cleared ${incRssEvicted} file state(s)`);

    // ---- Step 4: write-back + flush ----
    for (const w of l1Fps) cache.writeL1(w.rel, w.fp);
    for (const w of l2Refresh) cache.writeL2(w.fpHash, w.contentHash, w.rel, w.result, w.fp);
    cache.flush();

    // ---- Step 5: aggregate (byte-identical to cold) ----
    const issues: Issue[] = [];
    const fileMetrics: FileMetric[] = [];
    for (const r of perFile) {
      if (!r) continue;
      issues.push(...r.issues);
      if (r.metric) fileMetrics.push(r.metric);
    }
    issues.sort((a, b) => {
      if (a.location.file !== b.location.file) return a.location.file < b.location.file ? -1 : 1;
      if (a.location.start.line !== b.location.start.line) return a.location.start.line - b.location.start.line;
      if (a.analyzer !== b.analyzer) return a.analyzer < b.analyzer ? -1 : 1;
      return a.rule < b.rule ? -1 : 1;
    });

    const durationMs = Date.now() - t0;
    const report = this.buildReport(files.length, issues, fileMetrics, durationMs);
    this.logger.info(
      `diff scan done in ${durationMs}ms: ${report.summary.issuesTotal} issue(s) ` +
        `[diff=${diffFiles} byteEqual=${byteEqual} inc=${diffIncremental} full=${diffFull} analyzed=${analyzed}/${files.length}]`,
    );

    const stats: DiffStats = {
      daemonUsed: false,
      l1Hit,
      l2Hit,
      cacheHit: l1Hit + l2Hit,
      cacheTotal: files.length,
      analyzed,
      poolWarm: poolWarmFlag,
      daemonMs: 0,
      incrementalFiles,
      incrementalHit,
      diffFiles,
      diffIgnored,
      byteEqual,
      diffIncremental,
      diffFull,
      rangesProvided,
      rangesFallback,
      oldContentFromDaemon,
    };
    return { report: report as unknown as ScanReport | DiffDeltaReport, stats };
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
   */
  private async runAnalyzers(
    rel: string,
    content: string,
    seed?: IncrementalFileState,
  ): Promise<{ issues: Issue[]; metric: FileMetric | null }> {
    const cfg = this.config;
    const adapter = adapterFor(rel, cfg.parser);
    const streaming = this.plan.filter((p) => typeof (p.instance as any).visit === 'function');
    const legacy = this.plan.filter((p) => typeof (p.instance as any).visit !== 'function');

    // The ts.SourceFile is only needed by legacy TS-only plug-ins; materialize it lazily.
    // Both TS-family adapters (typescript / oxc) parse TS/JS-family files, so legacy
    // plug-ins keep working regardless of which parser is selected.
    // Lazy require: `../utils/ast` (and therefore `typescript`) is only loaded when a legacy
    // plug-in actually needs a real SourceFile — the oxc + built-in analyzers path (the
    // common case) never triggers this require.
    let sf: ts.SourceFile | undefined;
    if (legacy.length > 0 && (adapter.id === 'typescript' || adapter.id === 'oxc'))
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      sf = require('../utils/ast').createSourceFile(rel, content);

    // P1-1: lazy-projection fast path. When eligible, build a NodeProjector (no normalized
    // tree) and run the shared traversal over it; on ANY projector failure fall back to the
    // materialized path (never crashes). Gate is closed by default (AR_FASTPATH unset/0).
    // P2-5: when a line-level incremental seed is present we FORCE the materialized path —
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

    // P0-3: compute line stats ONCE per file and share them with every analyzer (the
    // metric collector always needs them; large-file reads them too when enabled).
    const lineStats = countLineStats(content);
    // V5.2: entries are built through this closure so the projection-fallback path can
    // rebuild them with FRESH analyzer instances (see the catch below). `metric` is the
    // per-run FileMetricCollector — also rebuilt on fallback so its counters never
    // accumulate partial state from an interrupted projected traversal.
    let metricCollector = new FileMetricCollector();
    const buildEntries = (metric: FileMetricCollector, rootForEntries: NormalizedNode): StreamingEntry[] => {
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
    if (entries.length > 0) {
      if (proj) {
        try {
          issues.push(...runStreamingProjected(proj, entries));
        } catch (e) {
          // Projector failure → materialized fallback (mirrors worker-pool → in-process
          // fallback semantics): same output, only a performance regression.
          this.logger.warn(
            `lazy projection failed on ${rel}: ${String(e)}; falling back to materialized path`,
          );
          // V5.2: NEVER reuse the outer entries — the interrupted projected traversal has
          // already accumulated state in those analyzer instances (constants' literals,
          // complexity's issues, the metric collector's counters). Rebuild FRESH instances
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
          location: { file: rel, start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
          detail: { error: String(e) },
        });
      }
    }

    return { issues, metric: metricCollector.metric };
  }

  /**
   * Single-process execution of the parse+analyze stage (also the automatic fallback when the
   * worker pool is unavailable). Reads + parses each file on the main thread, bounded by
   * `concurrency` in-flight files; the multiplexed traversal runs once per file.
   * `preloaded` (cache path) supplies already-read buffers to avoid a second read.
   */
  private async runInProcess(
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
        content = pre ? pre.toString('utf8') : fs.readFileSync(abs, 'utf8');
      } catch (e) {
        this.logger.warn(`skip unreadable file ${rel}: ${String(e)}`);
        return { issues: [] as Issue[], metric: null as FileMetric | null };
      }
      return this.runAnalyzers(rel, content);
    });
  }

  private collectFiles(
    absRoot: string,
    includeRx: RegExp[],
    excludeRx: RegExp[],
    gitignore: ((rel: string) => boolean) | null,
  ): string[] {
    const results: string[] = [];
    const walk = (dir: string) => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const abs = path.join(dir, e.name);
        const rel = path.relative(absRoot, abs).split(path.sep).join('/');
        if (e.isDirectory()) {
          if (matchAny(excludeRx, rel) || matchAny(excludeRx, e.name)) continue;
          if (gitignore && gitignore(rel)) continue;
          walk(abs);
        } else if (e.isFile()) {
          if (!matchAny(includeRx, rel)) continue;
          if (matchAny(excludeRx, rel)) continue;
          if (gitignore && gitignore(rel)) continue;
          const ext = path.extname(e.name).toLowerCase();
          if (!DEFAULT_EXT.includes(ext)) continue;
          results.push(rel);
        }
      }
    };
    walk(absRoot);
    return results.sort();
  }

  private buildReport(
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
    return {
      tool: 'auto-refactor',
      version: '0.1.0',
      generatedAt: new Date().toISOString(),
      root: path.resolve(cfg.root),
      config: cfg,
      summary: { filesScanned, issuesTotal: issues.length, bySeverity, byAnalyzer, durationMs },
      issues,
      fileMetrics,
    };
  }
}
