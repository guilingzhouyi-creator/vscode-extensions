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
import type { Worker } from 'worker_threads';
import * as workerThreads from 'worker_threads';
import type { ScanConfig, Issue, FileMetric } from '../types';
import type { WorkerAnalyzerDesc } from '../analyzer-registry';
import type { Logger } from '../logger';
import type { SymbolDefinition, SymbolReference } from '../intelligence/symbolIndex';
import { decodeResults } from '../result-codec';

/**
 * Extracted AST symbol definitions and references produced by worker threads.
 */
export interface WorkerSymbolsPayload {
    definitions: SymbolDefinition[];
    references: SymbolReference[];
}

/**
 * Raw scanning results emitted by an isolated worker thread for a single processed file.
 */
export type WorkerRawResultItem = {
    file: string;
    issues: Issue[];
    metric: FileMetric | null;
    symbols?: WorkerSymbolsPayload;
};

/**
 * Structured message payload emitted by a worker thread batch completion.
 */
export interface WorkerMessagePayload {
    results: WorkerRawResultItem[];
    symbolsMap?: { file: string; symbols?: WorkerSymbolsPayload }[];
}

const DEFAULT_WORKER_FLUSH_TIMEOUT_MS = 3000;
const TYPEOF_OBJECT = 'object';
const KEY_FLUSHED = 'flushed';
const EVENT_ERROR = 'error';
const EVENT_EXIT = 'exit';
const EVENT_MESSAGE = 'message';
const EVENT_ONLINE = 'online';

const EXT_PYTHON = '.py';
const EXT_MARKDOWN = '.md';
const ANALYZER_NAME_PYTHON_MODERN = 'python-modern';
const ANALYZER_NAME_DOCS = 'docs';
const WORKER_SCRIPT_FILE = 'worker.js';
const WORKER_TERMINATION_GRACE_PERIOD_MS = 500;

const DEFAULT_AUTO_WORKER_MIN = 4;
const DEFAULT_AUTO_WORKER_MAX = 8;
const DEFAULT_FALLBACK_CPUS = 8;

/** Scale factor turning a 0-1 elapsed-time ratio into a whole percentage (AR-TIMING). */
const TIMING_PERCENT_SCALE = 100;

/**
 * Maximum worker count auto mode (`workers <= 0`) starts, dynamically scaling
 * with available hardware cores.
 */
export const AUTO_WORKER_MAX = Math.min(
    DEFAULT_AUTO_WORKER_MAX,
    Math.max(
        DEFAULT_AUTO_WORKER_MIN,
        (os.availableParallelism
            ? os.availableParallelism()
            : os.cpus().length || DEFAULT_FALLBACK_CPUS) - 1,
    ),
);

/**
 * Files one worker must receive before auto mode adds another thread. A thread only pays for
 * itself once its share of the batch amortizes worker startup and result serialization: measured
 * on 12 x 2600-line files, 4 threads were 29% SLOWER than one, while a 300-file corpus was 26%
 * faster on eight. Scaling by file count instead of jumping straight to the core count keeps both
 * shapes fast.
 */
export const AUTO_WORKER_FILES_PER_THREAD = 64;

/** Timeline lines per AR-TIMING console batch, keeping each debug line readable. */
const TIMING_BATCH_LINES = 8;

/** Files per worker message batch (amortizes postMessage round-trips). */
export const WORKER_BATCH_SIZE = 32;

/**
 * Hybrid startup: the first K files are parsed in-process on the main thread while the workers
 * import `typescript` (~223ms dead time per fresh isolate). K is parser-aware and capped by each
 * thread's fair share (`filesLen / (n + 1)`) so the main thread never starves booted workers.
 *
 * WARM-SCAN: hybrid exists only to mask the worker cold-import dead time (~300ms ts).
 * A WARM pool (already imported + JIT'ed) gets K=0 — otherwise the main thread would steal
 * files from workers and slow the hot path.
 */
const HYBRID_FILES_TS = 64;
const HYBRID_FILES_OXC = 48;

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
export function getEffectiveWorkers(requested: number, fileCount: number): number {
    if (requested > 0) return requested;
    const cores = os.availableParallelism ? os.availableParallelism() : os.cpus().length;
    const byFiles = Math.floor(fileCount / AUTO_WORKER_FILES_PER_THREAD);
    return Math.max(1, Math.min(cores, AUTO_WORKER_MAX, byFiles));
}
export { getEffectiveWorkers as effectiveWorkers };

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
export async function runParallelMap<T, U>(
    items: T[],
    limit: number,
    fn: (item: T) => Promise<U>,
    signal?: AbortSignal,
): Promise<U[]> {
    const out: U[] = [];
    out.length = items.length;
    let idx = 0;
    const worker = async () => {
        while (idx < items.length) {
            if (signal?.aborted) {
                throw new Error('Scan aborted by user');
            }
            const currentItemIndex = idx++;
            out[currentItemIndex] = await fn(items[currentItemIndex]);
        }
    };
    const concurrencyLimit = Math.max(1, Math.min(limit, items.length));
    await Promise.all(Array.from({ length: concurrencyLimit }, () => worker()));
    return out;
}
export { runParallelMap as pMap };

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
export function getAnalyzerCoverage(
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
    if (extensions.has(EXT_PYTHON) && disabledAnalyzers.includes(ANALYZER_NAME_PYTHON_MODERN)) {
        warnings.push(
            "analyzer coverage: Python files were scanned but analyzers['python-modern'] is disabled — the Python modernization pack did not run",
        );
    }
    if (extensions.has(EXT_MARKDOWN) && disabledAnalyzers.includes(ANALYZER_NAME_DOCS)) {
        warnings.push(
            'analyzer coverage: Markdown files were scanned but analyzers.docs is disabled — document rules did not run',
        );
    }
    return warnings.length > 0 ? { disabledAnalyzers, warnings } : { disabledAnalyzers };
}
export { getAnalyzerCoverage as analyzerCoverage };

/**
 * Ensure a Buffer is backed by its own ArrayBuffer so it can be transferred to a worker
 * with zero-copy semantics. `fs.readFile` may return a pooled buffer (byteOffset > 0)
 * for small files; transferring a pooled buffer would detach the WHOLE shared pool and
 * corrupt other buffers — so copy such buffers into a standalone allocation first.
 *
 * @param rawBuffer - Input buffer to verify.
 * @returns Self-contained transferable Buffer.
 */
export function toTransferable(rawBuffer: Buffer): Buffer {
    if (rawBuffer.byteOffset === 0 && rawBuffer.byteLength === rawBuffer.buffer.byteLength) {
        return rawBuffer;
    }
    const copy = Buffer.allocUnsafeSlow(rawBuffer.byteLength);
    rawBuffer.copy(copy);
    return copy;
}

/**
 * Parser-aware hybrid K for a fresh (cold) pool.
 *
 * @param config - Scan configuration.
 * @param filesLen - Total file count.
 * @param workerCount - Worker thread count.
 * @returns Number of files to process via hybrid startup.
 */
export function computeHybridK(config: ScanConfig, filesLen: number, workerCount: number): number {
    const availCores = os.availableParallelism ? os.availableParallelism() : os.cpus().length;
    const baseHybridK = config.parser === 'oxc' ? HYBRID_FILES_OXC : HYBRID_FILES_TS;
    const fairCap = Math.floor(filesLen / Math.max(2, workerCount + 1));
    if (process.env.AR_HYBRID === '0' || availCores < workerCount * 2) {
        return 0;
    }
    return Math.min(Number(process.env.AR_HYBRID_FILES || baseHybridK) | 0, fairCap);
}

/** Base configuration shared across worker pool dispatch and scheduling options. */
export interface WorkerPoolBaseOptions {
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
    /** Pre-read file contents (Buffer) — avoids the double-read on the cache path. */
    preloaded?: Map<string, Buffer>;
}

/** Configuration and runtime parameters for worker thread batch dispatching. */
export interface DispatchOpts extends WorkerPoolBaseOptions {
    /** Pre-created workers (persistent pool). When absent, workers are spawned here (cold). */
    workers?: Worker[];
    workerIdx?: Map<Worker, number>;
    /** Files claimed by the main thread for hybrid in-process processing (0 = disabled). */
    hybridK: number;
    /** false (cold) → terminate workers when the batch finishes; true → keep them alive. */
    keepAlive: boolean;
    /** Pool/config fingerprint sent with each message so workers cache loaded modules by fp. */
    fp?: string;
}

/** A batch whose files are already read into transferable buffers. */
interface ReadyBatch {
    tasks: { file: string; absPath: string; buf: Buffer }[];
    transfer: ArrayBuffer[];
}

interface SingleHybridOutcome {
    result: { issues: Issue[]; metric: FileMetric | null };
    error?: unknown;
}

async function processSingleHybridFile(
    fileItem: { idx: number; rel: string },
    absRoot: string,
    optsPreloaded: Map<string, Buffer> | undefined,
    runAnalyzersFn: (
        rel: string,
        content: string,
    ) => Promise<{ issues: Issue[]; metric: FileMetric | null }>,
): Promise<SingleHybridOutcome> {
    const absPath = path.join(absRoot, fileItem.rel);
    let content: string;
    try {
        const pre = optsPreloaded && optsPreloaded.get(fileItem.rel);
        content = pre ? pre.toString('utf8') : await fs.promises.readFile(absPath, 'utf8');
    } catch {
        return { result: { issues: [], metric: null } };
    }
    try {
        const analyzerExecutionResult = await runAnalyzersFn(fileItem.rel, content);
        return { result: analyzerExecutionResult };
    } catch (error: unknown) {
        return { result: { issues: [], metric: null }, error };
    }
}

/** Parameters for the detached top-level hybrid stage execution. */
export interface HybridStageContext {
    batch: { idx: number; rel: string }[];
    absRoot: string;
    preloaded?: Map<string, Buffer>;
    runAnalyzersFn: (
        rel: string,
        content: string,
    ) => Promise<{ issues: Issue[]; metric: FileMetric | null }>;
    isAborted: () => boolean;
    onResult: (idx: number, result: { issues: Issue[]; metric: FileMetric | null }) => void;
    onError: (err: unknown) => void;
    onProgress?: () => void;
}

/**
 * Top-level orchestration of the hybrid startup stage.
 * Processes initial files concurrently without deeply nested closures (Depth <= 2).
 *
 * Concurrency note: asynchronous file processing bounded by HYBRID_CONCURRENCY.
 * @param ctx - Context object configuring the hybrid execution stage.
 * @returns Promise resolving when all batch files finish processing.
 */
export async function executeHybridStage(ctx: HybridStageContext): Promise<void> {
    const { batch, absRoot, preloaded, runAnalyzersFn, isAborted, onResult, onError, onProgress } =
        ctx;
    await runParallelMap(batch, HYBRID_CONCURRENCY, async (fileItem) => {
        if (isAborted()) return;
        const { result, error } = await processSingleHybridFile(
            fileItem,
            absRoot,
            preloaded,
            runAnalyzersFn,
        );
        if (error) {
            onError(error);
            return;
        }
        if (isAborted()) return;
        onResult(fileItem.idx, result);
        if (onProgress) {
            onProgress();
        }
    });
}

function normalizeWorkerResults(
    rawResults: unknown,
): { file: string; issues: Issue[]; metric: FileMetric | null }[] {
    let resArr = rawResults;
    if (
        resArr !== undefined &&
        resArr !== null &&
        typeof resArr !== TYPEOF_OBJECT &&
        !Array.isArray(resArr)
    ) {
        resArr = [];
    }
    if (ArrayBuffer.isView(resArr) && !Array.isArray(resArr)) {
        resArr = decodeResults(resArr as unknown as Uint8Array);
    }
    return (resArr as { file: string; issues: Issue[]; metric: FileMetric | null }[]) || [];
}

interface WorkerTelemetrySnapshot {
    poolStart: number;
    spawnMs: number[];
    firstMsgMs: number[];
    readTotal: number;
    readCount: number;
    readTimes: number[];
    dispatchSyncTotal: number;
    mergeTotal: number;
    timeline: {
        seq: number;
        worker: number;
        dispatch: number;
        arrive: number;
        rt: number;
    }[];
    lastDispatch: number[];
    seqCounter: number;
    flushing: boolean;
    hybridK: number;
    hybridFiles: number;
    hybridDone: number;
    hybridMs: number;
    hybridDoneAtFirstMsg: number;
}

function updateArrivalTelemetry(
    telemetry: WorkerTelemetrySnapshot | null,
    workerIndex: number,
    workerArrivalTimestampMs: number,
): void {
    if (!telemetry) return;
    if (telemetry.firstMsgMs[workerIndex] === undefined) {
        telemetry.firstMsgMs[workerIndex] = workerArrivalTimestampMs - telemetry.poolStart;
        if (telemetry.hybridDoneAtFirstMsg === -1) {
            telemetry.hybridDoneAtFirstMsg = telemetry.hybridDone;
        }
    }
    for (let i = telemetry.timeline.length - 1; i >= 0; i--) {
        const entry = telemetry.timeline[i];
        if (entry.worker === workerIndex && entry.arrive < 0) {
            entry.arrive = workerArrivalTimestampMs - telemetry.poolStart;
            entry.rt = workerArrivalTimestampMs - telemetry.lastDispatch[workerIndex];
            break;
        }
    }
}

/** Options for spawning a pool of worker threads. */
export interface SpawnWorkerPoolOptions {
    count: number;
    workerPath: string;
    config: ScanConfig;
    descs: WorkerAnalyzerDesc[];
    trackTelemetry?: boolean;
}

/**
 * Spawns a pool of worker threads.
 *
 * @param options - Parameter object with configuration options.
 * @returns Spawned workers, spawn start times, and any spawn error encountered.
 */
export function spawnWorkerPoolThreads(options: SpawnWorkerPoolOptions): {
    workers: Worker[];
    spawnStartTimes: number[];
    error?: unknown;
} {
    const { count, workerPath, config, descs, trackTelemetry = false } = options;
    const workers: Worker[] = [];
    const spawnStartTimes: number[] = [];
    for (let workerIdxNum = 0; workerIdxNum < count; workerIdxNum++) {
        const workerSpawnStartTimeMs = trackTelemetry ? nowMs() : 0;
        try {
            const workerInstance = new workerThreads.Worker(workerPath, {
                workerData: { config, analyzerDescs: descs },
            });
            workers.push(workerInstance);
            spawnStartTimes.push(workerSpawnStartTimeMs);
        } catch (spawnError: unknown) {
            return { workers, spawnStartTimes, error: spawnError };
        }
    }
    return { workers, spawnStartTimes };
}

function stopWorkerGroup(workers: Worker[]): void {
    for (const workerInstance of workers) {
        try {
            workerInstance.postMessage({ exit: true });
        } catch {
            /* ignore worker termination errors */
        }
        const timer = setTimeout(() => {
            try {
                workerInstance.terminate();
            } catch {
                /* ignore */
            }
        }, WORKER_TERMINATION_GRACE_PERIOD_MS);
        if (typeof timer.unref === 'function') {
            timer.unref();
        }
    }
}

function printTimelineBatches(
    timeline: WorkerTelemetrySnapshot['timeline'],
    logger?: Logger,
): void {
    const lines: string[] = [];
    for (const entry of timeline) {
        lines.push(
            `b${entry.seq} w${entry.worker} +${entry.dispatch.toFixed(0)}ms->+${entry.arrive.toFixed(0)}ms rt=${entry.rt.toFixed(1)}ms`,
        );
    }
    for (let i = 0; i < lines.length; i += TIMING_BATCH_LINES) {
        const text = `[AR-TIMING main] batch: ${lines.slice(i, i + TIMING_BATCH_LINES).join(' | ')}`;
        if (logger) {
            logger.debug(text);
        } else {
            console.error(text);
        }
    }
}

function printMainTelemetryTable(
    timingTelemetry: WorkerTelemetrySnapshot,
    workerCount: number,
    logger?: Logger,
): void {
    const wall = nowMs() - timingTelemetry.poolStart;
    const spawnTotal = timingTelemetry.spawnMs.reduce(
        (sumVal, currentVal) => sumVal + currentVal,
        0,
    );
    const busy =
        spawnTotal +
        timingTelemetry.readTotal +
        timingTelemetry.dispatchSyncTotal +
        timingTelemetry.mergeTotal;
    const idle = Math.max(0, wall - busy);
    const formatPercentage = (valueNum: number): string =>
        ((valueNum / Math.max(1, wall)) * TIMING_PERCENT_SCALE).toFixed(1);

    const logLine = (msg: string): void => {
        if (logger) {
            logger.debug(msg);
        } else {
            console.error(msg);
        }
    };

    logLine(
        `[AR-TIMING main] poolWall=${wall.toFixed(1)}ms busy=${busy.toFixed(1)}ms(${formatPercentage(busy)}%) ` +
            `idle=${idle.toFixed(1)}ms(${formatPercentage(idle)}%)`,
    );
    logLine(
        `[AR-TIMING main] spawn=[${timingTelemetry.spawnMs.map((timingVal) => timingVal.toFixed(1)).join(',')}]ms firstMsg=[${timingTelemetry.firstMsgMs
            .map((timingVal) => timingVal.toFixed(1))
            .join(
                ',',
            )}]ms read=${timingTelemetry.readTotal.toFixed(1)}ms(${timingTelemetry.readCount} batches, avg=${(timingTelemetry.readTotal / Math.max(1, timingTelemetry.readCount)).toFixed(1)}, max=${Math.max(...timingTelemetry.readTimes, 0).toFixed(1)}) ` +
            `dispatchSync=${timingTelemetry.dispatchSyncTotal.toFixed(1)}ms merge=${timingTelemetry.mergeTotal.toFixed(1)}ms`,
    );
    logLine(
        `[AR-TIMING main] hybrid: k=${timingTelemetry.hybridK} files=${timingTelemetry.hybridFiles} done=${timingTelemetry.hybridDone} ` +
            `doneBeforeFirstWorkerMsg=${timingTelemetry.hybridDoneAtFirstMsg} ms=${timingTelemetry.hybridMs.toFixed(1)}ms`,
    );
    const perWorkerBusy: number[] = Array.from({ length: workerCount }, () => 0);
    const perWorkerGaps: number[] = Array.from({ length: workerCount }, () => 0);
    const lastArrive: number[] = Array.from({ length: workerCount }, () => -1);
    const rtAll: number[] = [];
    for (const entry of timingTelemetry.timeline) {
        if (entry.arrive >= 0) {
            perWorkerBusy[entry.worker] += entry.rt;
            rtAll.push(entry.rt);
            if (lastArrive[entry.worker] >= 0) {
                perWorkerGaps[entry.worker] += entry.dispatch - lastArrive[entry.worker];
            }
            lastArrive[entry.worker] = entry.arrive;
        }
    }
    const rtAvg = rtAll.length
        ? rtAll.reduce((sumVal, currentVal) => sumVal + currentVal, 0) / rtAll.length
        : 0;
    const rtMax = rtAll.length ? Math.max(...rtAll) : 0;
    logLine(
        `[AR-TIMING main] roundTrips n=${rtAll.length} avg=${rtAvg.toFixed(1)}ms max=${rtMax.toFixed(1)}ms ` +
            `perWorkerBusy=[${perWorkerBusy.map((busyVal) => busyVal.toFixed(0)).join(',')}]ms ` +
            `perWorkerWaitGaps=[${perWorkerGaps.map((gapVal) => gapVal.toFixed(0)).join(',')}]ms`,
    );
    printTimelineBatches(timingTelemetry.timeline, logger);
}


async function flushWorkerTelemetry(
    timingTelemetry: WorkerTelemetrySnapshot | null,
    workers: Worker[],
): Promise<void> {
    if (!timingTelemetry || workers.length === 0) return;
    const acks = workers.map(
        (activeWorker) =>
            new Promise<void>((resolvePromise) => {
                const onMsg = (incomingMessage: unknown): void => {
                    if (
                        incomingMessage &&
                        typeof incomingMessage === TYPEOF_OBJECT &&
                        Boolean((incomingMessage as Record<string, unknown>)[KEY_FLUSHED])
                    ) {
                        activeWorker.off(EVENT_MESSAGE, onMsg);
                        resolvePromise();
                    }
                };
                activeWorker.on(EVENT_MESSAGE, onMsg);
                try {
                    activeWorker.postMessage({ flush: true });
                } catch {
                    resolvePromise();
                }
            }),
    );
    const pendingAcks = Promise.all(acks);
    await Promise.race([
        pendingAcks,
        new Promise<void>((resolveTimeout) =>
            setTimeout(resolveTimeout, DEFAULT_WORKER_FLUSH_TIMEOUT_MS),
        ),
    ]);
}

function buildIndexedWorkerResult(
    resultItem: WorkerRawResultItem,
    fallbackSymbols: WorkerSymbolsPayload | undefined,
): { issues: Issue[]; metric: FileMetric | null; symbols?: WorkerSymbolsPayload } {
    return {
        issues: resultItem.issues || [],
        metric: resultItem.metric || null,
        symbols: resultItem.symbols ?? fallbackSymbols,
    };
}

function applyWorkerMessageResults(
    messagePayload: WorkerMessagePayload,
    idxByFile: Map<string, number>,
    results: ({
        issues: Issue[];
        metric: FileMetric | null;
        symbols?: WorkerSymbolsPayload;
    } | null)[],
): number {
    const resArr = normalizeWorkerResults(messagePayload.results);
    for (let itemIdx = 0; itemIdx < resArr.length; itemIdx++) {
        const resultItem = resArr[itemIdx] as WorkerRawResultItem;
        const fileIndex = idxByFile.get(resultItem.file);
        if (fileIndex !== undefined) {
            results[fileIndex] = buildIndexedWorkerResult(
                resultItem,
                messagePayload.symbolsMap?.[itemIdx]?.symbols,
            );
        }
    }
    return resArr.length;
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
): Promise<{ issues: Issue[]; metric: FileMetric | null; symbols?: WorkerSymbolsPayload }[]> {
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
    const workerPath = path.resolve(__dirname, '..', WORKER_SCRIPT_FILE);
    const workerCount = Math.max(1, Math.min(numWorkers, files.length));
    const idxByFile = new Map<string, number>();
    files.forEach((filePath, fileIndex) => idxByFile.set(filePath, fileIndex));
    const results: ({
        issues: Issue[];
        metric: FileMetric | null;
        symbols?: WorkerSymbolsPayload;
    } | null)[] = [];
    results.length = files.length;
    results.fill(null);

    // AR_TIMING state: per-stage / per-batch pipeline instrumentation (no-op when disabled).
    const timingTelemetry: WorkerTelemetrySnapshot | null = AR_TIMING
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
        let cleanedUp = false;

        interface WorkerListenerBinding {
            worker: Worker;
            onMessage: (messagePayload: WorkerMessagePayload) => void;
            onError: (err: unknown) => void;
            onExit: (exitCode: number) => void;
        }
        const listenerBindings: WorkerListenerBinding[] = [];

        const cleanupListeners = (): void => {
            if (cleanedUp) return;
            cleanedUp = true;
            for (const binding of listenerBindings) {
                binding.worker.off(EVENT_MESSAGE, binding.onMessage);
                binding.worker.off(EVENT_ERROR, binding.onError);
                binding.worker.off(EVENT_EXIT, binding.onExit);
            }
            listenerBindings.length = 0;
        };

        const fail = (failureError: unknown) => {
            if (failed) return;
            failed = true;
            cleanupListeners();
            stopWorkerGroup(workers);
            reject(failureError);
        };

        const finalizeAndResolve = (): void => {
            if (!keepAlive) {
                stopWorkerGroup(workers);
            }
            resolve(
                results as {
                    issues: Issue[];
                    metric: FileMetric | null;
                    symbols?: WorkerSymbolsPayload;
                }[],
            );
        };

        const finishIfDone = (): boolean => {
            if (completed < files.length) return false;
            cleanupListeners();
            if (!timingTelemetry) {
                finalizeAndResolve();
                return true;
            }
            if (!timingTelemetry.flushing) {
                timingTelemetry.flushing = true;
                printMainTelemetryTable(timingTelemetry, workerCount, logger);
                void flushWorkerTelemetry(timingTelemetry, workers).then(() => {
                    finalizeAndResolve();
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
                const fileBuffer = pre ? Buffer.from(pre) : await fs.promises.readFile(absPath);
                return { file: rel, absPath, buf: toTransferable(fileBuffer) };
            } catch {
                results[idx] = { issues: [] as Issue[], metric: null as FileMetric | null };
                completed++;
                return null;
            }
        };

        /** Hybrid startup: process the pre-reserved [0, hybridK) files in-process. */
        const processHybrid = async (batch: { idx: number; rel: string }[]): Promise<void> => {
            if (timingTelemetry) timingTelemetry.hybridFiles = batch.length;
            const hybridStartTimeMs = timingTelemetry ? nowMs() : 0;
            await executeHybridStage({
                batch,
                absRoot,
                preloaded: opts.preloaded,
                runAnalyzersFn,
                isAborted: () => failed,
                onResult: (fileIndex, scanResult) => {
                    results[fileIndex] = scanResult;
                    completed++;
                },
                onError: (err) => fail(err),
                onProgress: timingTelemetry
                    ? () => {
                          timingTelemetry.hybridDone++;
                      }
                    : undefined,
            });
            if (timingTelemetry) timingTelemetry.hybridMs = nowMs() - hybridStartTimeMs;
            finishIfDone();
        };

        /** Claim + pre-read one batch of files (index order preserved, guided self-scheduling). */
        const readNextBatch = async (): Promise<ReadyBatch> => {
            const readBatchStartTimeMs = timingTelemetry ? nowMs() : 0;
            const remaining = files.length - nextIdx;
            const guidedSize = Math.ceil(remaining / (2 * workerCount));
            const batchSize = Math.max(1, Math.min(WORKER_BATCH_SIZE, guidedSize));
            const batch: { idx: number; rel: string }[] = [];
            while (batch.length < batchSize && nextIdx < files.length) {
                const i = nextIdx++;
                batch.push({ idx: i, rel: files[i] });
            }
            const reads = await Promise.all(
                batch.map((batchItem) => readTask(batchItem.idx, batchItem.rel)),
            );
            const tasks: { file: string; absPath: string; buf: Buffer }[] = [];
            const transfer: ArrayBuffer[] = [];
            for (const readItem of reads) {
                if (readItem) {
                    tasks.push({
                        file: readItem.file,
                        absPath: readItem.absPath,
                        buf: readItem.buf,
                    });
                    transfer.push(readItem.buf.buffer as ArrayBuffer);
                }
            }
            if (timingTelemetry) {
                const durationMs = nowMs() - readBatchStartTimeMs;
                timingTelemetry.readTotal += durationMs;
                timingTelemetry.readCount++;
                timingTelemetry.readTimes.push(durationMs);
            }
            return { tasks, transfer };
        };

        let inflightRead: Promise<ReadyBatch> | null = null;

        const acquireReadyBatch = async (targetWorker: Worker): Promise<ReadyBatch | null> => {
            if (inflightRead) {
                const pendingBatchPromise = inflightRead;
                inflightRead = null;
                return await pendingBatchPromise;
            }
            if (nextIdx >= files.length) {
                if (!timingTelemetry && !keepAlive) {
                    try {
                        targetWorker.postMessage({ exit: true });
                    } catch {
                        /* ignore */
                    }
                }
                return null;
            }
            return await readNextBatch();
        };

        const postBatchToWorker = (targetWorker: Worker, ready: ReadyBatch): void => {
            const postMessageStartTimeMs = timingTelemetry ? nowMs() : 0;
            const msg: Record<string, unknown> = { tasks: ready.tasks };
            if (fp !== undefined) {
                msg.fp = fp;
                msg.config = config;
                msg.descs = descs;
            }
            targetWorker.postMessage(msg, ready.transfer);
            if (timingTelemetry) {
                const postMessageEndTimeMs = nowMs();
                timingTelemetry.dispatchSyncTotal += postMessageEndTimeMs - postMessageStartTimeMs;
                const workerSequenceId = workerIdx.get(targetWorker) ?? 0;
                const seq = ++timingTelemetry.seqCounter;
                timingTelemetry.lastDispatch[workerSequenceId] = postMessageEndTimeMs;
                timingTelemetry.timeline.push({
                    seq,
                    worker: workerSequenceId,
                    dispatch: postMessageEndTimeMs - timingTelemetry.poolStart,
                    arrive: -1,
                    rt: -1,
                });
            }
        };

        const dispatch = async (targetWorker: Worker) => {
            if (failed) return;
            const ready = await acquireReadyBatch(targetWorker);
            if (!ready) return;
            if (ready.tasks.length === 0) {
                if (finishIfDone()) return;
                void dispatch(targetWorker);
                return;
            }
            if (nextIdx < files.length && !inflightRead) {
                inflightRead = readNextBatch();
            }
            postBatchToWorker(targetWorker, ready);
        };

        const hybridBatch: { idx: number; rel: string }[] = [];
        while (hybridBatch.length < hybridK && nextIdx < files.length) {
            const i = nextIdx++;
            hybridBatch.push({ idx: i, rel: files[i] });
        }
        void processHybrid(hybridBatch);

        const wire = (
            targetWorker: Worker,
            workerIndex: number,
            workerSpawnStartTimeMs: number,
        ) => {
            workerIdx.set(targetWorker, workerIndex);
            if (!opts.workers) {
                targetWorker.once(EVENT_ONLINE, () => {
                    if (timingTelemetry) {
                        timingTelemetry.spawnMs[workerIndex] = nowMs() - workerSpawnStartTimeMs;
                    }
                });
            }
            const onMessage = (messagePayload: WorkerMessagePayload) => {
                const workerArrivalTimestampMs = timingTelemetry ? nowMs() : 0;
                const currentWorkerIdx = workerIdx.get(targetWorker) ?? 0;
                updateArrivalTelemetry(timingTelemetry, currentWorkerIdx, workerArrivalTimestampMs);

                completed += applyWorkerMessageResults(messagePayload, idxByFile, results);
                if (timingTelemetry) {
                    timingTelemetry.mergeTotal += nowMs() - workerArrivalTimestampMs;
                }
                if (finishIfDone()) return;
                void dispatch(targetWorker);
            };
            const onError = (err: unknown) => {
                fail(err);
            };
            const onExit = (exitCode: number) => {
                if (exitCode !== 0 && !failed) {
                    fail(
                        new Error(
                            `Worker ${workerIndex} exited unexpectedly with code ${exitCode}`,
                        ),
                    );
                }
            };
            targetWorker.on(EVENT_MESSAGE, onMessage);
            targetWorker.on(EVENT_ERROR, onError);
            targetWorker.on(EVENT_EXIT, onExit);
            listenerBindings.push({ worker: targetWorker, onMessage, onError, onExit });
            void dispatch(targetWorker);
        };

        if (opts.workers && opts.workers.length > 0) {
            for (let workerIdxNum = 0; workerIdxNum < opts.workers.length; workerIdxNum++) {
                wire(opts.workers[workerIdxNum], workerIdxNum, 0);
            }
            return;
        }

        if (nextIdx >= files.length) {
            return;
        }

        const spawned = spawnWorkerPoolThreads({
            count: workerCount,
            workerPath,
            config,
            descs,
            trackTelemetry: Boolean(timingTelemetry),
        });
        for (const spawnedWorker of spawned.workers) {
            workers.push(spawnedWorker);
        }
        if (spawned.error) {
            fail(spawned.error);
            return;
        }
        for (let workerIdxNum = 0; workerIdxNum < spawned.workers.length; workerIdxNum++) {
            wire(
                spawned.workers[workerIdxNum],
                workerIdxNum,
                spawned.spawnStartTimes[workerIdxNum],
            );
        }
    });
}

/** Parameter object for cold-path worker pool execution. */
export type RunWorkerPoolOptions = WorkerPoolBaseOptions;

/**
 * Cold-path worker pool: spawns fresh worker threads, runs batch dispatcher, and terminates them.
 *
 * @param options - Parameter object with pool configuration and collaborators.
 * @returns One index-aligned `{ issues, metric }` entry per input file.
 * Concurrency: manages worker threads asynchronously; safe for single-threaded caller.
 */
export async function runWorkerPool(
    options: RunWorkerPoolOptions,
): Promise<{ issues: Issue[]; metric: FileMetric | null; symbols?: WorkerSymbolsPayload }[]> {
    const { files, absRoot, config, descs, numWorkers, logger, runAnalyzersFn, preloaded } =
        options;
    if (files.length === 0) return [];
    const workerCount = Math.max(1, Math.min(numWorkers, files.length));
    const hybridK = computeHybridK(config, files.length, workerCount);
    return dispatchBatches({
        files,
        absRoot,
        config,
        descs,
        numWorkers: workerCount,
        logger,
        runAnalyzersFn,
        hybridK,
        keepAlive: false,
        preloaded,
    });
}
