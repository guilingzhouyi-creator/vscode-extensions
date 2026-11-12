/**
 * Module: Daemon — Persistent Server & CLI Entry
 * File Path: src/daemon/server.ts
 * Architecture Role: Process entry and transport adapter for the per-project daemon; maps
 *   NDJSON frames from a named pipe/Unix socket or stdio onto the warm/diff scan handlers.
 * Dependencies & Triggers: Node net/fs/path, ../core/logger, ../core/analyzer, ./protocol and
 *   ./registry for framing/discovery, and ./scanHandler for scan work; started by `daemon start`,
 *   the CLI `--daemon` flag, `--stdio` embedding or direct node execution.
 * Responsibilities: Bind the endpoint (unlinking a stale POSIX socket first), write the
 *   registry, serve net/stdio transports with per-line decoding, answer hello/ping, dispatch
 *   scan/scan_diff, convert handler failures to SCAN_FAILED frames, and own idle/signal exit.
 * Exit Semantics & Design Rationale: Graceful paths (idle timeout, SIGTERM/SIGINT, shutdown
 *   frame, stdio EOF, uncaughtException) release pools, clear the registry (net mode only) and
 *   exit(0); a bind failure exits(1) after a stderr message; idle timers are unref'd so the
 *   daemon never keeps a host alive, and registry cleanup prevents stale discovery entries.
 *
 * Lifecycle (docs/01-architecture/02-pipeline-and-caching.md §A1/A3): started via `daemon
 * start` / CLI `--daemon` (detached child) or `--stdio` embedded mode (child spawned by a
 * client, used by tests/automation); binds a per-project named pipe or Unix socket and spawns
 * zero workers until the first scan; each scan runs through handleScan -> Scanner.scanWithCache
 * with persistent pools/cache/session reuse and returns one `scan_done` packet; idle 10min
 * with no connections or a shutdown signal exits gracefully.
 */
import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import type { ScanConfig } from '../core/types';
import type { CacheStore } from '../core/cache';
import { Logger } from '../core/logger';
import type { DaemonMessage, HelloAckMessage, HelloMessage, PongMessage } from './protocol';
import { PROTOCOL_VERSION, PROTOCOL_SOFTWARE_VERSION, encodeMessage, decodeLine } from './protocol';
import type { RegistryInfo } from './registry';
import { projectHashFor, pipeNameFor, writeRegistry, clearRegistry, logFilePath } from './registry';
import type { DaemonScanContext } from './scanHandler';
import { createDaemonContext, handleScan, handleScanDiff } from './scanHandler';

/** Number of idle minutes before the daemon shuts itself down. */
const IDLE_TIMEOUT_MINUTES = 10;

/** Seconds in one minute, used to convert the idle timeout to milliseconds. */
const SECONDS_PER_MINUTE = 60;

/** Milliseconds in one second, used to convert the idle timeout to milliseconds. */
const MS_PER_SECOND = 1000;

/** Maximum worker count advertised to clients in the hello_ack capabilities. */
const DAEMON_MAX_WORKERS = 8;

/** Default logging verbosity level. */
const DEFAULT_LOG_LEVEL = 'info';

/** Platform check token for Windows. */
const PLATFORM_WIN32 = 'win32';

/** Stream encoding. */
const ENCODING_UTF8 = 'utf8';

/** Node stream/socket event names. */
const EVENT_DATA = 'data';
const EVENT_DRAIN = 'drain';
const EVENT_END = 'end';
const EVENT_CLOSE = 'close';
const ERROR_EVENT = 'error';

/** Default upper bounds (16 MiB / 32 MiB) for incoming NDJSON frame and transport buffer. */
const MIB_BYTES = 1024 * 1024;
export const DEFAULT_MAX_FRAME_BYTES = 16 * MIB_BYTES;
export const DEFAULT_MAX_BUFFER_BYTES = 32 * MIB_BYTES;

/** Node process event and signal names. */
const SIGNAL_SIGTERM = 'SIGTERM';
const SIGNAL_SIGINT = 'SIGINT';
const EVENT_UNCAUGHT_EXCEPTION = 'uncaughtException';
const EVENT_UNHANDLED_REJECTION = 'unhandledRejection';

/** Protocol message types. */
const MSG_TYPE_HELLO = 'hello';
const MSG_TYPE_HELLO_ACK = 'hello_ack';
const MSG_TYPE_PING = 'ping';
const MSG_TYPE_PONG = 'pong';
const MSG_TYPE_SCAN = 'scan';
const MSG_TYPE_SCAN_DIFF = 'scan_diff';
const MSG_TYPE_SCAN_DONE = 'scan_done';
const MSG_TYPE_SHUTDOWN = 'shutdown';
const MESSAGE_TYPE_ERROR = 'error';

/** Protocol error codes and message descriptions. */
const CODE_PROTOCOL_PARSE = 'PROTOCOL_PARSE';
const CODE_FRAME_TOO_LARGE = 'FRAME_TOO_LARGE';
const CODE_BUFFER_OVERFLOW = 'BUFFER_OVERFLOW';
const CODE_SCAN_FAILED = 'SCAN_FAILED';
const CODE_UNKNOWN_MESSAGE = 'UNKNOWN_MESSAGE';
const MSG_MALFORMED_NDJSON = 'malformed NDJSON line';

/** Daemon exit and shutdown reasons. */
const REASON_IDLE_TIMEOUT = 'idle-timeout';
const REASON_CLIENT_REQUEST = 'client-request';
const REASON_STDIO_EOF = 'stdio-eof';
const REASON_UNKNOWN = 'unknown';
const REASON_SIGTERM = 'sigterm';
const REASON_SIGINT = 'sigint';
const REASON_UNCAUGHT_EXCEPTION = 'uncaught-exception';
const REASON_CLIENT_DEFAULT = 'client';

const IDLE_TIMEOUT_MS = IDLE_TIMEOUT_MINUTES * SECONDS_PER_MINUTE * MS_PER_SECOND;
const SHUTDOWN_DRAIN_TIMEOUT_MS = 10_000;

/**
 * Represents an in-flight background scan or scan_diff task tracked by the daemon server.
 */
export interface PendingScan {
    requestId: string;
    id: number;
    kind: 'scan' | 'scan_diff';
    socket?: net.Socket;
    startedAt: number;
    abortController: AbortController;
}

interface TransportIo {
    write: (message: DaemonMessage) => void;
    close: () => void;
    id: () => number;
}

interface BufferState {
    buffer: string;
    closed?: boolean;
}

interface QueuedWriter {
    write: (msg: DaemonMessage) => void;
    dispose: () => void;
}

function createBackpressureWriter(
    stream: NodeJS.WritableStream,
    onPause?: () => void,
    onResume?: () => void,
): QueuedWriter {
    const queue: string[] = [];
    let draining = false;
    let disposed = false;
    const pump = (): void => {
        draining = false;
        if (disposed || !(stream as net.Socket).writable) {
            queue.length = 0;
            onResume?.();
            return;
        }
        while (queue.length > 0 && stream.write(queue.shift()!)) {}
        if (queue.length > 0) {
            draining = true;
            stream.once(EVENT_DRAIN, pump);
        } else {
            onResume?.();
        }
    };
    return {
        write: (msg: DaemonMessage): void => {
            if (disposed || !(stream as net.Socket).writable) return;
            const payload = encodeMessage(msg);
            if (draining || queue.length > 0) {
                queue.push(payload);
                return;
            }
            if (!stream.write(payload)) {
                draining = true;
                onPause?.();
                stream.once(EVENT_DRAIN, pump);
            }
        },
        dispose: (): void => {
            disposed = true;
            queue.length = 0;
            draining = false;
            stream.removeListener(EVENT_DRAIN, pump);
        },
    };
}

interface BaseScanTaskOptions {
    cache: boolean;
    cacheDir?: string;
    cacheCustom?: boolean;
    workers?: number;
    parser?: string;
}

interface ScanDiffTaskOptions extends BaseScanTaskOptions {
    verifyDiskContent?: boolean;
    delta?: boolean;
}

interface ScanTask {
    readonly id: number;
    readonly requestId: string;
    readonly configJson: Record<string, unknown>;
    readonly options: BaseScanTaskOptions;
    readonly io: { write: (message: DaemonMessage) => void };
    readonly socket?: net.Socket;
}

interface ScanDiffTask {
    readonly id: number;
    readonly requestId: string;
    readonly configJson: Record<string, unknown>;
    readonly diffs: Array<Record<string, unknown>>;
    readonly options: ScanDiffTaskOptions;
    readonly io: { write: (message: DaemonMessage) => void };
    readonly socket?: net.Socket;
}

/**
 * Per-project daemon instance: owns the bound net server (or stdio transport), the persistent
 * scan context that keeps caches and worker pools warm across requests, and the shutdown state.
 * One instance serves one project root; `startListening()` binds once and `shutdown()` is
 * idempotent because it flips `shuttingDown` before releasing pools and clearing the registry,
 * so repeated signals or a shutdown frame cannot double-release shared resources.
 */
export class DaemonServer {
    readonly root: string;
    readonly projectHash: string;
    readonly pipe: string;
    readonly logFile: string;
    readonly ctx: DaemonScanContext;
    readonly logger: Logger;
    private server: net.Server | null = null;
    private stdioMode = false;
    private shuttingDown = false;
    private shutdownTask?: Promise<void>;
    private idleTimer: NodeJS.Timeout | null = null;
    private pending: Map<string, PendingScan> = new Map();
    private readonly activeScans = new Set<Promise<void>>();
    private nextId = 0;
    private onSigTerm?: () => void;
    private onSigInt?: () => void;
    private readonly maxFrameBytes: number;
    private readonly maxBufferBytes: number;
    private readonly observedCaches = new Set<CacheStore>();
    private readonly writers = new Set<QueuedWriter>();

    constructor(
        root: string,
        opts: {
            stdio?: boolean;
            logFile?: string;
            maxFrameBytes?: number;
            maxBufferBytes?: number;
        } = {},
    ) {
        this.root = path.resolve(root);
        this.projectHash = projectHashFor(this.root);
        this.pipe = pipeNameFor(this.projectHash);
        this.logFile = opts.logFile || logFilePath(this.projectHash);
        this.stdioMode = opts.stdio === true;
        this.maxFrameBytes = opts.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES;
        this.maxBufferBytes = opts.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES;
        this.ctx = createDaemonContext();
        const origGetCache = this.ctx.getCache.bind(this.ctx);
        this.ctx.getCache = (cacheRoot: string, cacheDir?: string): CacheStore => {
            const store = origGetCache(cacheRoot, cacheDir);
            this.observedCaches.add(store);
            return store;
        };
        this.logger = new Logger(DEFAULT_LOG_LEVEL, this.stdioMode ? undefined : this.logFile);
    }

    /** Returns the first non-cleared cache persistence failure message observed by the daemon. */
    public getLastFlushError(): string | undefined {
        for (const cache of this.observedCaches) {
            const err = cache.lastFlushError;
            if (err !== undefined) return err instanceof Error ? err.message : String(err);
        }
        return undefined;
    }

    /** Returns daemon runtime status, including cache flush failure visibility. */
    public getStatus(): {
        shuttingDown: boolean;
        pendingScans: number;
        activeScans: number;
        poolCount: number;
        lastFlushError?: string;
    } {
        const lastFlushError = this.getLastFlushError();
        return {
            shuttingDown: this.shuttingDown,
            pendingScans: this.pending.size,
            activeScans: this.activeScans.size,
            poolCount: this.ctx.pools.size(),
            ...(lastFlushError ? { lastFlushError } : {}),
        };
    }

    /** Returns the map of currently pending scan requests. */
    public getPendingScans(): ReadonlyMap<string, PendingScan> {
        return this.pending;
    }

    /** Start listening (net or stdio) + register. Resolves once bound. */
    async startListening(): Promise<void> {
        if (this.stdioMode) {
            this.server = null;
            this.runStdioServer();
            this.scheduleIdle();
            this.logger.info(
                `daemon listening on ${this.pipe} (pid ${process.pid}, stdio=${this.stdioMode})`,
            );
            return;
        }

        if (process.platform !== PLATFORM_WIN32) {
            try {
                await fs.promises.rm(this.pipe, { force: true });
            } catch {
                /* ignore */
            }
        }

        return new Promise<void>((resolve, reject) => {
            const onReady = () => {
                this.scheduleIdle();
                const registryEntry: RegistryInfo = {
                    pid: process.pid,
                    pipe: this.pipe,
                    startedAt: new Date().toISOString(),
                    version: String(PROTOCOL_SOFTWARE_VERSION),
                    protocol: Number(PROTOCOL_VERSION),
                    logFile: this.logFile,
                };
                writeRegistry(this.projectHash, registryEntry);
                this.logger.info(
                    `daemon listening on ${this.pipe} (pid ${process.pid}, stdio=${this.stdioMode})`,
                );
                resolve();
            };

            const srv = net.createServer((socket) => this.handleConnection(socket));
            this.server = srv;
            srv.on(ERROR_EVENT, (error) => {
                this.logger.error(`daemon server error: ${error.message}`);
                reject(error);
            });
            srv.listen(this.pipe, onReady);
        });
    }

    private abortOverflow(state: BufferState, io: TransportIo, code: string, msg: string): void {
        state.buffer = '';
        state.closed = true;
        this.logger.warn(`closing daemon transport due to ${code}: ${msg}`);
        io.write({ v: 1, id: 0, type: MESSAGE_TYPE_ERROR, code, message: msg });
        io.close();
    }

    private processIncomingChunk(
        chunk: string,
        bufferState: BufferState,
        transportIo: TransportIo,
        socket?: net.Socket,
    ): void {
        if (bufferState.closed) return;
        if (bufferState.buffer.length + chunk.length > this.maxBufferBytes) {
            this.abortOverflow(bufferState, transportIo, CODE_BUFFER_OVERFLOW, 'buffer overflow');
            return;
        }
        bufferState.buffer += chunk;
        let newlineIndex: number;
        while ((newlineIndex = bufferState.buffer.indexOf('\n')) >= 0) {
            if (newlineIndex > this.maxFrameBytes) {
                this.abortOverflow(
                    bufferState,
                    transportIo,
                    CODE_FRAME_TOO_LARGE,
                    'frame too large',
                );
                return;
            }
            const rawLine = bufferState.buffer.slice(0, newlineIndex).trim();
            bufferState.buffer = bufferState.buffer.slice(newlineIndex + 1);
            if (!rawLine) continue;

            let decodedMessage: DaemonMessage;
            try {
                decodedMessage = decodeLine(rawLine);
            } catch {
                transportIo.write({
                    v: 1,
                    id: 0,
                    type: MESSAGE_TYPE_ERROR,
                    code: CODE_PROTOCOL_PARSE,
                    message: MSG_MALFORMED_NDJSON,
                });
                continue;
            }
            this.handleMessage(decodedMessage, transportIo, socket);
        }
        if (!bufferState.closed && bufferState.buffer.length > this.maxFrameBytes) {
            this.abortOverflow(bufferState, transportIo, CODE_FRAME_TOO_LARGE, 'frame too large');
        }
    }

    private runStdioServer(): void {
        const stdin = process.stdin;
        const bufferState: BufferState = { buffer: '' };
        const writer = createBackpressureWriter(process.stdout);
        this.writers.add(writer);
        const transportIo: TransportIo = {
            write: writer.write,
            close: () => {
                bufferState.closed = true;
                writer.dispose();
                this.writers.delete(writer);
                stdin.pause();
            },
            id: () => 0,
        };
        stdin.setEncoding(ENCODING_UTF8);
        stdin.on(EVENT_DATA, (chunk: string) =>
            this.processIncomingChunk(chunk, bufferState, transportIo),
        );
        stdin.on(EVENT_END, () => {
            writer.dispose();
            this.writers.delete(writer);
            void this.shutdown(REASON_STDIO_EOF);
        });
    }

    private handleConnection(socket: net.Socket): void {
        this.scheduleIdle();
        const bufferState: BufferState = { buffer: '' };
        socket.setEncoding(ENCODING_UTF8);
        const writer = createBackpressureWriter(
            socket,
            () => {
                if (!socket.destroyed) socket.pause();
            },
            () => {
                if (!socket.destroyed) socket.resume();
            },
        );
        this.writers.add(writer);
        const transportIo: TransportIo = {
            write: writer.write,
            close: () => {
                bufferState.closed = true;
                writer.dispose();
                this.writers.delete(writer);
                socket.destroy();
            },
            id: () => this.nextId++,
        };
        const onDone = (): void => {
            writer.dispose();
            this.writers.delete(writer);
            this.abortSocketPending(socket);
            this.scheduleIdle();
        };
        socket.on(EVENT_DATA, (chunk: string) =>
            this.processIncomingChunk(chunk, bufferState, transportIo, socket),
        );
        socket.on(EVENT_CLOSE, onDone);
        socket.on(ERROR_EVENT, onDone);
    }

    private abortSocketPending(socket: net.Socket): void {
        for (const [requestId, scan] of this.pending.entries()) {
            if (scan.socket === socket) {
                try {
                    scan.abortController.abort();
                } catch {
                    /* ignore */
                }
                this.pending.delete(requestId);
            }
        }
    }

    private handleHello(msg: HelloMessage, transportIo: TransportIo): void {
        const ack: HelloAckMessage = {
            v: 1,
            id: msg.id,
            type: MSG_TYPE_HELLO_ACK,
            version: String(PROTOCOL_SOFTWARE_VERSION),
            protocol: Number(PROTOCOL_VERSION),
            caps: {
                cache: true,
                stream: true,
                maxWorkers: DAEMON_MAX_WORKERS,
                diff: true,
            },
        };
        transportIo.write(ack);
        this.scheduleIdle();
    }

    /** Dispatch one decoded NDJSON message (shared by net + stdio transports). */
    private handleMessage(msg: DaemonMessage, transportIo: TransportIo, socket?: net.Socket): void {
        if (this.shuttingDown) {
            transportIo.write({
                v: 1,
                id: msg.id,
                type: MESSAGE_TYPE_ERROR,
                code: 'SHUTTING_DOWN',
                message: 'Daemon is shutting down',
            });
            return;
        }
        switch (msg.type) {
            case MSG_TYPE_HELLO:
                this.handleHello(msg, transportIo);
                break;
            case MSG_TYPE_PING: {
                const lastFlushError = this.getLastFlushError();
                const pongMessage: DaemonMessage = {
                    v: 1,
                    id: msg.id,
                    type: MSG_TYPE_PONG,
                    ...(lastFlushError !== undefined ? { lastFlushError } : {}),
                } as PongMessage;
                transportIo.write(pongMessage);
                this.scheduleIdle();
                break;
            }
            case MSG_TYPE_SCAN:
                this.scheduleIdle();
                this.trackScan(
                    this.runScan({
                        id: msg.id,
                        requestId: msg.params.requestId,
                        configJson: msg.params.config,
                        options: msg.params.options,
                        io: transportIo,
                        socket,
                    }),
                );
                break;
            case MSG_TYPE_SCAN_DIFF:
                this.scheduleIdle();
                this.trackScan(
                    this.runScanDiff({
                        id: msg.id,
                        requestId: msg.params.requestId,
                        configJson: msg.params.config,
                        diffs: msg.params.diffs,
                        options: msg.params.options,
                        io: transportIo,
                        socket,
                    }),
                );
                break;
            case MSG_TYPE_SHUTDOWN:
                this.logger.info(
                    `shutdown requested (${msg.reason || REASON_CLIENT_DEFAULT}); exiting`,
                );
                this.shutdown(msg.reason || REASON_CLIENT_REQUEST);
                break;
            default:
                transportIo.write({
                    v: 1,
                    id: msg.id,
                    type: MESSAGE_TYPE_ERROR,
                    code: CODE_UNKNOWN_MESSAGE,
                    message: `unknown type ${String((msg as { type?: unknown }).type)}`,
                });
        }
    }

    private trackScan(operation: Promise<void>): void {
        this.activeScans.add(operation);
        void operation.then(
            () => {
                this.activeScans.delete(operation);
            },
            (error: unknown) => {
                this.activeScans.delete(operation);
                this.logger.error(`unhandled scan failure: ${String(error)}`);
            },
        );
    }

    private async runScan(task: ScanTask): Promise<void> {
        const { id: taskId, requestId, configJson, options, socket } = task;
        const config = configJson as unknown as ScanConfig;
        const abortController = new AbortController();
        this.pending.set(requestId, {
            requestId,
            id: taskId,
            kind: MSG_TYPE_SCAN,
            socket,
            startedAt: Date.now(),
            abortController,
        });

        try {
            const { report, stats } = await handleScan(this.ctx, config, {
                ...options,
                signal: abortController.signal,
            });
            abortController.signal.throwIfAborted();
            this.handleScanSuccess(task, report, stats);
        } catch (error) {
            this.handleScanError(task, error);
        } finally {
            this.pending.delete(requestId);
            if (!this.shuttingDown) this.ctx.pools.rssGuard();
        }
    }

    private async runScanDiff(task: ScanDiffTask): Promise<void> {
        const { id: taskId, requestId, configJson, diffs, options, socket } = task;
        const config = configJson as unknown as ScanConfig;
        const abortController = new AbortController();
        this.pending.set(requestId, {
            requestId,
            id: taskId,
            kind: MSG_TYPE_SCAN_DIFF,
            socket,
            startedAt: Date.now(),
            abortController,
        });

        try {
            const { report, stats } = await handleScanDiff(this.ctx, config, diffs, {
                ...options,
                signal: abortController.signal,
            });
            abortController.signal.throwIfAborted();
            this.handleScanSuccess(task, report, stats);
        } catch (error) {
            this.handleScanError(task, error);
        } finally {
            this.pending.delete(requestId);
            if (!this.shuttingDown) this.ctx.pools.rssGuard();
        }
    }

    private resolveTaskFlushError(task: ScanTask | ScanDiffTask): string | undefined {
        const rootValue = task.configJson?.root;
        if (task.options?.cache && typeof rootValue === 'string' && rootValue) {
            const err = this.ctx.getCache(rootValue, task.options.cacheDir).lastFlushError;
            if (err !== undefined) return err instanceof Error ? err.message : String(err);
        }
        return this.getLastFlushError();
    }

    private handleScanSuccess(
        task: ScanTask | ScanDiffTask,
        report: unknown,
        stats: unknown,
    ): void {
        const lastFlushError = this.resolveTaskFlushError(task);
        if (lastFlushError !== undefined) {
            this.logger.warn(`cache flush error recorded after scan: ${lastFlushError}`);
        }
        const baseStats =
            stats && typeof stats === 'object' ? (stats as Record<string, unknown>) : {};
        task.io.write({
            v: 1,
            id: task.id,
            type: MSG_TYPE_SCAN_DONE,
            requestId: task.requestId,
            report: report as unknown as Record<string, unknown>,
            stats: lastFlushError !== undefined ? { ...baseStats, lastFlushError } : baseStats,
        });
        this.scheduleIdle();
    }

    private handleScanError(task: ScanTask | ScanDiffTask, err: unknown): void {
        const message = err instanceof Error ? err.message : String(err);
        task.io.write({
            v: 1,
            id: task.id,
            type: MESSAGE_TYPE_ERROR,
            requestId: task.requestId,
            code: CODE_SCAN_FAILED,
            message,
            detail: { stack: err instanceof Error ? err.stack : undefined },
        });
        this.scheduleIdle();
    }

    private scheduleIdle(): void {
        if (this.idleTimer) clearTimeout(this.idleTimer);
        if (!this.shuttingDown) this.ctx.pools.rssGuard();
        this.idleTimer = setTimeout(() => {
            this.logger.info(`idle ${IDLE_TIMEOUT_MS / MS_PER_SECOND}s — exiting`);
            this.shutdown(REASON_IDLE_TIMEOUT);
        }, IDLE_TIMEOUT_MS);
        if (this.idleTimer.unref) this.idleTimer.unref();
    }

    private abortPendingScans(): void {
        for (const scan of this.pending.values()) {
            try {
                scan.abortController.abort();
            } catch {
                /* ignore */
            }
        }
        this.pending.clear();
    }

    private releaseDaemonResources(): void {
        for (const writer of this.writers) writer.dispose();
        this.writers.clear();
        try {
            this.ctx.pools.shutdown();
        } catch {
            /* ignore */
        }
        if (!this.stdioMode) clearRegistry(this.projectHash);
        if (this.server) {
            try {
                this.server.close();
            } catch {
                /* ignore */
            }
        }
    }

    private detachSignalHandlers(): void {
        try {
            if (this.onSigTerm) process.off(SIGNAL_SIGTERM, this.onSigTerm);
            if (this.onSigInt) process.off(SIGNAL_SIGINT, this.onSigInt);
        } catch {
            /* ignore */
        }
    }

    private async settleOwnedWork(): Promise<void> {
        const results = await Promise.allSettled([...this.activeScans]);
        await this.ctx.settleCaches();
        const failures = results.filter((result) => result.status === 'rejected');
        if (failures.length > 0) {
            throw new AggregateError(
                failures.map((result) => result.reason),
                'Active scan drain failed',
            );
        }
    }

    private async drainBeforeExit(): Promise<void> {
        let timer: NodeJS.Timeout | undefined;
        try {
            await Promise.race([
                this.settleOwnedWork(),
                new Promise<never>((_resolve, reject) => {
                    timer = setTimeout(
                        () => reject(new Error('Daemon shutdown drain timed out')),
                        SHUTDOWN_DRAIN_TIMEOUT_MS,
                    );
                }),
            ]);
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    private async finishShutdown(reason: string): Promise<void> {
        let exitCode = 0;
        try {
            await this.drainBeforeExit();
        } catch (error) {
            exitCode = 1;
            this.logger.error(`daemon shutdown failed: ${String(error)}`);
        }
        this.releaseDaemonResources();
        this.detachSignalHandlers();
        this.logger.info(`daemon exiting (${reason}), status=${exitCode}`);
        this.logger.close();
        setImmediate(() => process.exit(exitCode));
    }

    /** Stop requests, drain durable caches, then release owned resources and exit. */
    shutdown(reason = REASON_UNKNOWN): Promise<void> {
        if (this.shutdownTask) return this.shutdownTask;
        this.shuttingDown = true;
        if (this.idleTimer) clearTimeout(this.idleTimer);
        this.abortPendingScans();
        this.shutdownTask = this.finishShutdown(reason);
        return this.shutdownTask;
    }

    /** Registers signal handlers so they can be detached during shutdown. */
    public setSignalHandlers(sigTerm: () => void, sigInt: () => void): void {
        this.onSigTerm = sigTerm;
        this.onSigInt = sigInt;
    }

    /** Disposes server resources and detaches active listeners. */
    dispose(): void {
        this.shutdown(REASON_CLIENT_REQUEST);
    }
}

const FLAG_ROOT = '--root';
const FLAG_STDIO = '--stdio';

/**
 * CLI entry: `node dist/daemon/server.js --root DIR [--stdio]`.
 *
 * Async by contract: awaits the one-time endpoint bind before wiring signal handlers, then
 * returns while the process stays alive on the listening server or the stdio stream.
 *
 * @param argv - CLI arguments after the script name; `--root DIR` selects the project root
 *   (falling back to `process.cwd()`) and `--stdio` selects the embedded stdio transport.
 * @returns Resolves once the endpoint is bound and SIGTERM/SIGINT/uncaughtException handlers
 *   are installed; a bind failure writes to stderr and calls `process.exit(1)` instead.
 */
export async function runDaemonMain(argv: string[]): Promise<void> {
    const rootArg = argv.find((argStr, i) => argStr === FLAG_ROOT && argv[i + 1])
        ? argv[argv.indexOf(FLAG_ROOT) + 1]
        : process.cwd();
    const stdio = argv.includes(FLAG_STDIO);
    const server = new DaemonServer(rootArg, { stdio });
    try {
        await server.startListening();
    } catch (error) {
        process.stderr.write(
            `[auto-refactor daemon] failed to listen: ${error instanceof Error ? error.message : String(error)}\n`,
        );
        process.exit(1);
    }
    const onSigTerm = (): void => {
        void server.shutdown(REASON_SIGTERM);
    };
    const onSigInt = (): void => {
        void server.shutdown(REASON_SIGINT);
    };
    server.setSignalHandlers(onSigTerm, onSigInt);
    process.on(SIGNAL_SIGTERM, onSigTerm);
    process.on(SIGNAL_SIGINT, onSigInt);
    process.on(EVENT_UNCAUGHT_EXCEPTION, (error) => {
        process.stderr.write(
            `[auto-refactor daemon] uncaught: ${error && (error as Error).stack ? (error as Error).stack : error}\n`,
        );
        server.shutdown(REASON_UNCAUGHT_EXCEPTION);
    });
    process.on(EVENT_UNHANDLED_REJECTION, (reason: unknown) => {
        const msg = reason instanceof Error ? reason.stack || reason.message : String(reason);
        process.stderr.write(`[auto-refactor daemon] unhandledRejection: ${msg}\n`);
    });
}

/**
 * Boots the background IPC daemon server for the provided CLI argv slice.
 *
 * @param argv - Command-line arguments forwarded to daemon option parsing.
 * @returns Promise resolving once the IPC socket listener and signal handlers are bound.
 */
export const daemonMain = runDaemonMain;

if (require.main === module) {
    runDaemonMain(process.argv.slice(2)).catch((err: unknown) => {
        process.stderr.write(`[auto-refactor daemon] fatal: ${String(err)}\n`);
        process.exit(1);
    });
}
