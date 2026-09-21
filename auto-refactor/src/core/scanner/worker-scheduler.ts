/**
 * Module: Core Engine — Worker Thread Scheduler & Dispatcher
 * File Path: src/core/scanner/worker-scheduler.ts
 * Architecture Role: Parallel execution and thread pool scheduling layer for file scanning.
 * Dependencies & Triggers: worker_threads, os, path, fs, ../types, ../logger, ../resultCodec;
 *   invoked by Scanner during scan, scanWithCache, and scanWithDiff execution.
 * Responsibilities: Scale worker threads, batch file reads, manage hybrid startup offloading,
 *   transfer zero-copy buffers, and reassemble ordered analyzer outputs.
 * Exit Semantics & Design Rationale: Bounded concurrency mapper preserves file ordering;
 *   worker pool failures fall back cleanly and unreadable files yield empty results.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Worker } from 'worker_threads';
import type { ScanConfig, Issue, FileMetric } from '../types';
import type { WorkerAnalyzerDesc } from '../analyzer-registry';
import type { Logger } from '../logger';
import { decodeResults } from '../result-codec';

const DEFAULT_WORKER_FLUSH_TIMEOUT_MS = 3000;

/** Scale factor turning a 0-1 elapsed-time ratio into a whole percentage (AR-TIMING). */
const TIMING_PERCENT_SCALE = 100;

/** Maximum worker count auto mode (`workers <= 0`) starts, capped by available cores. */
export const AUTO_WORKER_MAX = 8;

/**
 * Files one worker must receive before auto mode adds another thread. A thread only pays for
 * itself once its share of the batch amortizes worker startup and result serialization: measured
 * on 12 x 2600-line files, 4 threads were 29% SLOWER than one, while a 300-file corpus was 26%
 * faster on eight. Scaling by file count instead of jumping straight to the core count keeps both
 * shapes fast.
 */
export const AUTO_WORKER_FILES_PER_THREAD = 24;

/** Timeline lines per AR-TIMING console batch, keeping each debug line readable. */
const TIMING_BATCH_LINES = 8;

/** Files per worker message batch (amortizes postMessage round-trips). */
export const WORKER_BATCH_SIZE = 32;

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
 * WARM-SCAN: hybrid exists only to mask the worker cold-import dead time (~300ms ts).
 * A WARM pool (already imported + JIT'ed) gets K=0 — otherwise the main thread would steal
 * files from workers and slow the hot path.
 */
const HYBRID_FILES_TS = 500;
const HYBRID_FILES_OXC = 200;

/** Bounded concurrency for the hybrid in-process phase (overlaps readFile on the libuv pool). */
const HYBRID_CONCURRENCY = 16;

/** Debug instrumentation flag for worker pipeline (AR_TIMING=1). */
export const AR_TIMING = process.env.AR_TIMING === '1';

/** High-resolution millisecond timestamp supplier for performance telemetry. */
export const nowMs = (): number =>
    typeof performance !== 'undefined' ? performance.now() : Date.now();

/**
 * Pick the worker count for one parse+analyze batch.
 *
 * Explicit counts (`workers = 1` or `N > 1`) are honoured as written. Auto mode (`workers <= 0`)
 * scales with the batch size: `fileCount / AUTO_WORKER_FILES_PER_THREAD`, capped by the core count
 * and `AUTO_WORKER_MAX`, and never below one (the single-process path).
 *
 * @param requested - `cfg.workers`: 1 in-process, 0 auto, N > 1 an explicit thread count.
 * @param fileCount - Files in this batch (discovered files, or cache-miss files on the warm path).
 * @returns Effective worker count; 1 keeps the in-process pMap path.
 */
export function effectiveWorkers(requested: number, fileCount: number): number {
    if (requested > 0) return requested;
    const cores = os.availableParallelism ? os.availableParallelism() : os.cpus().length;
    const byFiles = Math.floor(fileCount / AUTO_WORKER_FILES_PER_THREAD);
    return Math.max(1, Math.min(cores, AUTO_WORKER_MAX, byFiles));
}

/**
 * Generic bounded-concurrency async mapper. Runs `fn` over `items` with at most `limit`
 * in flight. Order of results is preserved (index-aligned) regardless of completion order.
 *
 * @param items - Items to map over.
 * @param limit - Concurrency ceiling.
 * @param fn - Asynchronous mapping function.
 * @param signal - Optional AbortSignal to cancel in-flight work.
 * @returns Results in the same index order as `items`.
 * Concurrency: bounded parallel async execution; safe for single-threaded runtime.
 */
export async function pMap<T, U>(
    items: T[],
    limit: number,
    fn: (item: T) => Promise<U>,
    signal?: AbortSignal,
): Promise<U[]> {
    const out: U[] = new Array(items.length);
    let idx = 0;
    const worker = async () => {
        while (idx < items.length) {
            if (signal?.aborted) {
                throw new Error('Scan aborted by user');
            }
            const cur = idx++;
            out[cur] = await fn(items[cur]);
        }
    };
    const n = Math.max(1, Math.min(limit, items.length));
    await Promise.all(Array.from({ length: n }, () => worker()));
    return out;
}

/**
 * Diagnose analyzer coverage so a silently skipped rule family is never mistaken for a clean
 * result. Every analyzer the effective config leaves disabled is named in the summary, plus a
 * targeted note when a language/format pack is off while files of exactly that language were
 * scanned — the trap that makes a preset look green when it merely never ran.
 *
 * @param cfg - Effective scan config carrying the per-analyzer enabled flags.
 * @param fileMetrics - Per-file metrics of this scan; their extensions describe the languages.
 * @returns Summary fields: the disabled analyzer ids, plus coverage notes when relevant.
 */
export function analyzerCoverage(
    cfg: ScanConfig,
    fileMetrics: FileMetric[],
): { disabledAnalyzers: string[]; warnings?: string[] } {
    const disabledAnalyzers = Object.entries(cfg.analyzers)
        .filter(([, decl]) => decl?.enabled === false)
        .map(([name]) => name);
    const warnings: string[] = [];
    const extensions = new Set(
        fileMetrics.map((metric) => path.extname(metric.file).toLowerCase()),
    );
    if (extensions.has('.py') && disabledAnalyzers.includes('python-modern')) {
        warnings.push(
            "analyzer coverage: Python files were scanned but analyzers['python-modern'] is disabled — the Python modernization pack did not run",
        );
    }
    if (extensions.has('.md') && disabledAnalyzers.includes('docs')) {
        warnings.push(
            'analyzer coverage: Markdown files were scanned but analyzers.docs is disabled — document rules did not run',
        );
    }
    return warnings.length > 0 ? { disabledAnalyzers, warnings } : { disabledAnalyzers };
}

/**
 * Ensure a Buffer is backed by its own ArrayBuffer so it can be transferred to a worker
 * with zero-copy semantics. `fs.readFile` may return a pooled buffer (byteOffset > 0)
 * for small files; transferring a pooled buffer would detach the WHOLE shared pool and
 * corrupt other buffers — so copy such buffers into a standalone allocation first.
 *
 * @param buf - Input buffer to verify.
 * @returns Self-contained transferable Buffer.
 */
export function toTransferable(buf: Buffer): Buffer {
    if (buf.byteOffset === 0 && buf.byteLength === buf.buffer.byteLength) return buf;
    const copy = Buffer.allocUnsafeSlow(buf.byteLength);
    buf.copy(copy);
    return copy;
}

/**
 * Parser-aware hybrid K for a fresh (cold) pool.
 *
 * @param config - Scan configuration.
 * @param filesLen - Total file count.
 * @param n - Worker thread count.
 * @returns Number of files to process via hybrid startup.
 */
export function computeHybridK(config: ScanConfig, filesLen: number, n: number): number {
    const availCores = os.availableParallelism ? os.availableParallelism() : os.cpus().length;
    const baseHybridK = config.parser === 'oxc' ? HYBRID_FILES_OXC : HYBRID_FILES_TS;
    return process.env.AR_HYBRID === '0' || availCores < n * 2
        ? 0
        : Math.min(Number(process.env.AR_HYBRID_FILES || baseHybridK) | 0, filesLen);
}

/** Configuration and runtime parameters for worker thread batch dispatching. */
export interface DispatchOpts {
    /** Pre-created workers (persistent pool). When absent, workers are spawned here (cold). */
    workers?: Worker[];
    workerIdx?: Map<Worker, number>;
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
 * @param opts - Dispatch configuration and collaborators.
 * @returns One index-aligned `{ issues, metric }` entry per input file.
 * Concurrency: multi-threaded worker dispatch; safe for single-threaded coordinator.
 */
export async function dispatchBatches(
    opts: DispatchOpts,
): Promise<{ issues: Issue[]; metric: FileMetric | null }[]> {
    const { files, absRoot, config, descs, numWorkers, runAnalyzersFn, hybridK, keepAlive, fp } =
        opts;
    if (files.length === 0) return [];
    const workerPath = path.resolve(__dirname, '..', 'worker.js');
    const n = Math.max(1, Math.min(numWorkers, files.length));
    const idxByFile = new Map<string, number>();
    files.forEach((f, i) => idxByFile.set(f, i));
    const results: ({ issues: Issue[]; metric: FileMetric | null } | null)[] = new Array(
        files.length,
    );

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

    const workerIdx = opts.workerIdx || new Map<Worker, number>();

    return new Promise((resolve, reject) => {
        const workers: Worker[] = opts.workers || [];
        let nextIdx = 0;
        let completed = 0;
        let failed = false;

        const fail = (e: unknown) => {
            if (failed) return;
            failed = true;
            for (const w of workers)
                try {
                    w.terminate();
                } catch {
                    /* ignore */
                }
            reject(e);
        };

        /** AR_TIMING: print the main-thread pipeline table. */
        const printMainTable = (): void => {
            if (!T) return;
            const wall = nowMs() - T.poolStart;
            const spawnTotal = T.spawnMs.reduce((a, b) => a + b, 0);
            const busy = spawnTotal + T.readTotal + T.dispatchSyncTotal + T.mergeTotal;
            const idle = Math.max(0, wall - busy);
            const pct = (v: number): string =>
                ((v / Math.max(1, wall)) * TIMING_PERCENT_SCALE).toFixed(1);
            console.error(
                `[AR-TIMING main] poolWall=${wall.toFixed(1)}ms busy=${busy.toFixed(1)}ms(${pct(busy)}%) ` +
                    `idle=${idle.toFixed(1)}ms(${pct(idle)}%)`,
            );
            console.error(
                `[AR-TIMING main] spawn=[${T.spawnMs.map((x) => x.toFixed(1)).join(',')}]ms firstMsg=[${T.firstMsgMs
                    .map((x) => x.toFixed(1))
                    .join(
                        ',',
                    )}]ms read=${T.readTotal.toFixed(1)}ms(${T.readCount} batches, avg=${(T.readTotal / Math.max(1, T.readCount)).toFixed(1)}, max=${Math.max(...T.readTimes, 0).toFixed(1)}) ` +
                    `dispatchSync=${T.dispatchSyncTotal.toFixed(1)}ms merge=${T.mergeTotal.toFixed(1)}ms`,
            );
            console.error(
                `[AR-TIMING main] hybrid: k=${T.hybridK} files=${T.hybridFiles} done=${T.hybridDone} ` +
                    `doneBeforeFirstWorkerMsg=${T.hybridDoneAtFirstMsg} ms=${T.hybridMs.toFixed(1)}ms`,
            );
            const perWorkerBusy: number[] = new Array(n).fill(0);
            const perWorkerGaps: number[] = new Array(n).fill(0);
            const lastArrive: number[] = new Array(n).fill(-1);
            const rtAll: number[] = [];
            for (const e of T.timeline) {
                if (e.arrive >= 0) {
                    perWorkerBusy[e.worker] += e.rt;
                    rtAll.push(e.rt);
                    if (lastArrive[e.worker] >= 0)
                        perWorkerGaps[e.worker] += e.dispatch - lastArrive[e.worker];
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
            const lines: string[] = [];
            for (const e of T.timeline) {
                lines.push(
                    `b${e.seq} w${e.worker} +${e.dispatch.toFixed(0)}ms->+${e.arrive.toFixed(0)}ms rt=${e.rt.toFixed(1)}ms`,
                );
            }
            for (let i = 0; i < lines.length; i += TIMING_BATCH_LINES) {
                console.error(
                    `[AR-TIMING main] batch: ${lines.slice(i, i + TIMING_BATCH_LINES).join(' | ')}`,
                );
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
            await Promise.race([
                Promise.all(acks),
                new Promise<void>((r) => setTimeout(r, DEFAULT_WORKER_FLUSH_TIMEOUT_MS)),
            ]);
        };

        const finishIfDone = (): boolean => {
            if (completed < files.length) return false;
            if (!T) {
                if (!keepAlive)
                    for (const x of workers)
                        try {
                            x.terminate();
                        } catch {
                            /* ignore */
                        }
                resolve(results as { issues: Issue[]; metric: FileMetric | null }[]);
                return true;
            }
            if (!T.flushing) {
                T.flushing = true;
                printMainTable();
                void flushWorkers().then(() => {
                    if (!keepAlive)
                        for (const x of workers)
                            try {
                                x.terminate();
                            } catch {
                                /* ignore */
                            }
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
                const pre = opts.preloaded && opts.preloaded.get(rel);
                const buf = pre || (await fs.promises.readFile(absPath));
                return { file: rel, absPath, buf: toTransferable(buf) };
            } catch {
                results[idx] = { issues: [] as Issue[], metric: null as FileMetric | null };
                completed++;
                return null;
            }
        };

        /** Hybrid startup: process the pre-reserved [0, hybridK) files in-process. */
        const processHybrid = async (batch: { idx: number; rel: string }[]): Promise<void> => {
            if (T) T.hybridFiles = batch.length;
            const tH0 = T ? nowMs() : 0;
            await pMap(batch, HYBRID_CONCURRENCY, async (b) => {
                if (failed) return;
                const absPath = path.join(absRoot, b.rel);
                let content: string;
                try {
                    const pre = opts.preloaded && opts.preloaded.get(b.rel);
                    content = pre
                        ? pre.toString('utf8')
                        : await fs.promises.readFile(absPath, 'utf8');
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

        let inflightRead: Promise<ReadyBatch> | null = null;

        const dispatch = async (w: Worker) => {
            if (failed) return;
            let ready: ReadyBatch | null = null;
            if (inflightRead) {
                const p = inflightRead;
                inflightRead = null;
                ready = await p;
            }
            if (!ready) {
                if (nextIdx >= files.length) {
                    if (!T && !keepAlive)
                        try {
                            w.terminate();
                        } catch {
                            /* ignore */
                        }
                    return;
                }
                ready = await readNextBatch();
            }
            if (ready.tasks.length === 0) {
                if (finishIfDone()) return;
                void dispatch(w);
                return;
            }
            if (nextIdx < files.length && !inflightRead) {
                inflightRead = readNextBatch();
            }
            const tPost0 = T ? nowMs() : 0;
            const msg: any = { tasks: ready.tasks };
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
                T.timeline.push({
                    seq,
                    worker: k,
                    dispatch: tPost1 - T.poolStart,
                    arrive: -1,
                    rt: -1,
                });
            }
        };

        const hybridBatch: { idx: number; rel: string }[] = [];
        while (hybridBatch.length < hybridK && nextIdx < files.length) {
            const i = nextIdx++;
            hybridBatch.push({ idx: i, rel: files[i] });
        }
        void processHybrid(hybridBatch);

        const wire = (w: Worker, k: number, tSpawn0: number) => {
            workerIdx.set(w, k);
            w.on('online', () => {
                if (T) T.spawnMs[k] = nowMs() - tSpawn0;
            });
            w.on(
                'message',
                (res: {
                    results: { file: string; issues: Issue[]; metric: FileMetric | null }[];
                }) => {
                    const tArr = T ? nowMs() : 0;
                    if (T) {
                        const wk = workerIdx.get(w) ?? 0;
                        if (T.firstMsgMs[wk] === undefined) {
                            T.firstMsgMs[wk] = tArr - T.poolStart;
                            if (T.hybridDoneAtFirstMsg === -1)
                                T.hybridDoneAtFirstMsg = T.hybridDone;
                        }
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
                    if (
                        resArr !== undefined &&
                        resArr !== null &&
                        typeof resArr !== 'object' &&
                        !Array.isArray(resArr)
                    ) {
                        resArr = [];
                    }
                    if (ArrayBuffer.isView(resArr) && !Array.isArray(resArr)) {
                        resArr = decodeResults(resArr as unknown as Uint8Array);
                    }
                    resArr ||= [];
                    for (const r of resArr) {
                        const i = idxByFile.get(r.file);
                        if (i !== undefined)
                            results[i] = { issues: r.issues || [], metric: r.metric || null };
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
            for (let k = 0; k < opts.workers.length; k++) {
                wire(opts.workers[k], k, 0);
            }
        } else {
            for (let k = 0; k < n; k++) {
                let w: Worker;
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
 * Cold-path worker pool: spawns fresh worker threads, runs batch dispatcher, and terminates them.
 *
 * @param files - Relative file paths to process.
 * @param absRoot - Absolute root path.
 * @param config - Scan configuration.
 * @param descs - Analyzer descriptors.
 * @param numWorkers - Worker thread count.
 * @param logger - Operational logger.
 * @param runAnalyzersFn - Fallback in-process analyzer callback.
 * @param preloaded - Preloaded buffers for cache reuse.
 * @returns One index-aligned `{ issues, metric }` entry per input file.
 * Concurrency: manages worker threads asynchronously; safe for single-threaded caller.
 */
export async function runWorkerPool(
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
