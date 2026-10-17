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
import { Logger } from '../core/logger';
import type { DaemonMessage, HelloAckMessage, HelloMessage } from './protocol';
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
const EVENT_END = 'end';
const EVENT_CLOSE = 'close';
const ERROR_EVENT = 'error';

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
    write: (m: DaemonMessage) => void;
    close: () => void;
    id: () => number;
}

interface BufferState {
    buffer: string;
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
    readonly io: { write: (m: DaemonMessage) => void };
    readonly socket?: net.Socket;
}

interface ScanDiffTask {
    readonly id: number;
    readonly requestId: string;
    readonly configJson: Record<string, unknown>;
    readonly diffs: Array<Record<string, unknown>>;
    readonly options: ScanDiffTaskOptions;
    readonly io: { write: (m: DaemonMessage) => void };
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
    private idleTimer: NodeJS.Timeout | null = null;
    private pending: Map<string, PendingScan> = new Map();
    private nextId = 0;

    constructor(root: string, opts: { stdio?: boolean; logFile?: string } = {}) {
        this.root = path.resolve(root);
        this.projectHash = projectHashFor(this.root);
        this.pipe = pipeNameFor(this.projectHash);
        this.logFile = opts.logFile || logFilePath(this.projectHash);
        this.stdioMode = opts.stdio === true;
        this.ctx = createDaemonContext();
        this.logger = new Logger(DEFAULT_LOG_LEVEL, this.stdioMode ? undefined : this.logFile);
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
            srv.on(ERROR_EVENT, (e) => {
                this.logger.error(`daemon server error: ${e.message}`);
                reject(e);
            });
            srv.listen(this.pipe, onReady);
        });
    }

    private processIncomingChunk(
        chunk: string,
        bufferState: BufferState,
        io: TransportIo,
        socket?: net.Socket,
    ): void {
        bufferState.buffer += chunk;
        let newlineIndex: number;
        while ((newlineIndex = bufferState.buffer.indexOf('\n')) >= 0) {
            const rawLine = bufferState.buffer.slice(0, newlineIndex).trim();
            bufferState.buffer = bufferState.buffer.slice(newlineIndex + 1);
            if (!rawLine) continue;

            let decodedMessage: DaemonMessage;
            try {
                decodedMessage = decodeLine(rawLine);
            } catch {
                io.write({
                    v: 1,
                    id: 0,
                    type: MESSAGE_TYPE_ERROR,
                    code: CODE_PROTOCOL_PARSE,
                    message: MSG_MALFORMED_NDJSON,
                });
                continue;
            }
            this.handleMessage(decodedMessage, io, socket);
        }
    }

    private runStdioServer(): void {
        const stdin = process.stdin;
        const stdout = process.stdout;
        const bufferState: BufferState = { buffer: '' };
        const io: TransportIo = {
            write: (m: DaemonMessage) => stdout.write(encodeMessage(m)),
            close: () => {},
            id: () => 0,
        };
        stdin.setEncoding(ENCODING_UTF8);
        stdin.on(EVENT_DATA, (chunk: string) => this.processIncomingChunk(chunk, bufferState, io));
        stdin.on(EVENT_END, () => this.shutdown(REASON_STDIO_EOF));
    }

    private handleConnection(socket: net.Socket): void {
        this.scheduleIdle();
        const bufferState: BufferState = { buffer: '' };
        socket.setEncoding(ENCODING_UTF8);
        const write = (m: DaemonMessage) => {
            if (!socket.destroyed) socket.write(encodeMessage(m));
        };
        const io: TransportIo = {
            write,
            close: () => socket.destroy(),
            id: () => this.nextId++,
        };
        socket.on(EVENT_DATA, (chunk: string) =>
            this.processIncomingChunk(chunk, bufferState, io, socket),
        );
        socket.on(EVENT_CLOSE, () => {
            this.abortSocketPending(socket);
            this.scheduleIdle();
        });
        socket.on(ERROR_EVENT, () => {
            this.abortSocketPending(socket);
            this.scheduleIdle();
        });
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

    private handleHello(msg: HelloMessage, io: TransportIo): void {
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
        io.write(ack);
        this.scheduleIdle();
    }

    /** Dispatch one decoded NDJSON message (shared by net + stdio transports). */
    private handleMessage(msg: DaemonMessage, io: TransportIo, socket?: net.Socket): void {
        switch (msg.type) {
            case MSG_TYPE_HELLO:
                this.handleHello(msg, io);
                break;
            case MSG_TYPE_PING:
                io.write({ v: 1, id: msg.id, type: MSG_TYPE_PONG });
                this.scheduleIdle();
                break;
            case MSG_TYPE_SCAN:
                this.scheduleIdle();
                this.runScan({
                    id: msg.id,
                    requestId: msg.params.requestId,
                    configJson: msg.params.config,
                    options: msg.params.options,
                    io,
                    socket,
                }).catch((err: unknown) => {
                    this.logger.error(
                        `unhandled error during scan ${msg.params.requestId}: ${String(err)}`,
                    );
                });
                break;
            case MSG_TYPE_SCAN_DIFF:
                this.scheduleIdle();
                this.runScanDiff({
                    id: msg.id,
                    requestId: msg.params.requestId,
                    configJson: msg.params.config,
                    diffs: msg.params.diffs,
                    options: msg.params.options,
                    io,
                    socket,
                }).catch((err: unknown) => {
                    this.logger.error(
                        `unhandled error during scan_diff ${msg.params.requestId}: ${String(err)}`,
                    );
                });
                break;
            case MSG_TYPE_SHUTDOWN:
                this.logger.info(
                    `shutdown requested (${msg.reason || REASON_CLIENT_DEFAULT}); exiting`,
                );
                this.shutdown(msg.reason || REASON_CLIENT_REQUEST);
                break;
            default:
                io.write({
                    v: 1,
                    id: msg.id,
                    type: MESSAGE_TYPE_ERROR,
                    code: CODE_UNKNOWN_MESSAGE,
                    message: `unknown type ${String((msg as { type?: unknown }).type)}`,
                });
        }
    }

    private async runScan(task: ScanTask): Promise<void> {
        const { id, requestId, configJson, options, socket } = task;
        const config = configJson as unknown as ScanConfig;
        const abortController = new AbortController();
        this.pending.set(requestId, {
            requestId,
            id,
            kind: MSG_TYPE_SCAN,
            socket,
            startedAt: Date.now(),
            abortController,
        });

        try {
            const { report, stats } = await handleScan(this.ctx, config, options);
            this.handleScanSuccess(task, report, stats);
        } catch (e) {
            this.handleScanError(task, e);
        } finally {
            this.pending.delete(requestId);
        }
    }

    private async runScanDiff(task: ScanDiffTask): Promise<void> {
        const { id, requestId, configJson, diffs, options, socket } = task;
        const config = configJson as unknown as ScanConfig;
        const abortController = new AbortController();
        this.pending.set(requestId, {
            requestId,
            id,
            kind: MSG_TYPE_SCAN_DIFF,
            socket,
            startedAt: Date.now(),
            abortController,
        });

        try {
            const { report, stats } = await handleScanDiff(this.ctx, config, diffs, options);
            this.handleScanSuccess(task, report, stats);
        } catch (e) {
            this.handleScanError(task, e);
        } finally {
            this.pending.delete(requestId);
        }
    }

    private handleScanSuccess(
        task: ScanTask | ScanDiffTask,
        report: unknown,
        stats: unknown,
    ): void {
        task.io.write({
            v: 1,
            id: task.id,
            type: MSG_TYPE_SCAN_DONE,
            requestId: task.requestId,
            report: report as unknown as Record<string, unknown>,
            stats: stats as unknown as Record<string, unknown>,
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
        this.idleTimer = setTimeout(() => {
            this.logger.info(`idle ${IDLE_TIMEOUT_MS / MS_PER_SECOND}s — exiting`);
            this.shutdown(REASON_IDLE_TIMEOUT);
        }, IDLE_TIMEOUT_MS);
        if (this.idleTimer.unref) this.idleTimer.unref();
    }

    /** Graceful exit: stop accepting, release pools, remove registry, exit(0). */
    shutdown(reason = REASON_UNKNOWN): void {
        if (this.shuttingDown) return;
        this.shuttingDown = true;
        if (this.idleTimer) clearTimeout(this.idleTimer);
        for (const scan of this.pending.values()) {
            try {
                scan.abortController.abort();
            } catch {
                /* ignore */
            }
        }
        this.pending.clear();
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
        this.logger.info(`daemon exiting (${reason})`);
        try {
            this.logger.close();
        } catch {
            /* ignore */
        }
        setImmediate(() => process.exit(0));
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
    const rootArg = argv.find((a, i) => a === FLAG_ROOT && argv[i + 1])
        ? argv[argv.indexOf(FLAG_ROOT) + 1]
        : process.cwd();
    const stdio = argv.includes(FLAG_STDIO);
    const server = new DaemonServer(rootArg, { stdio });
    try {
        await server.startListening();
    } catch (e) {
        process.stderr.write(
            `[auto-refactor daemon] failed to listen: ${e instanceof Error ? e.message : String(e)}\n`,
        );
        process.exit(1);
    }
    process.on(SIGNAL_SIGTERM, () => server.shutdown(REASON_SIGTERM));
    process.on(SIGNAL_SIGINT, () => server.shutdown(REASON_SIGINT));
    process.on(EVENT_UNCAUGHT_EXCEPTION, (e) => {
        process.stderr.write(`[auto-refactor daemon] uncaught: ${e && e.stack ? e.stack : e}\n`);
        server.shutdown(REASON_UNCAUGHT_EXCEPTION);
    });
    process.on(EVENT_UNHANDLED_REJECTION, (reason: unknown) => {
        const msg = reason instanceof Error ? reason.stack || reason.message : String(reason);
        process.stderr.write(`[auto-refactor daemon] unhandledRejection: ${msg}\n`);
    });
}

/** Legacy CLI entry alias for backward compatibility. */
export const daemonMain = runDaemonMain;

if (require.main === module) {
    runDaemonMain(process.argv.slice(2)).catch((err: unknown) => {
        process.stderr.write(`[auto-refactor daemon] fatal: ${String(err)}\n`);
        process.exit(1);
    });
}
