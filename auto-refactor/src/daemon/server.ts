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
import type { DaemonMessage, HelloAckMessage } from './protocol';
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

/** Node EventEmitter event name for server/socket failures. */
const ERROR_EVENT = 'error';

/** Daemon protocol message type reporting a parse or scan failure to the client. */
const MESSAGE_TYPE_ERROR = 'error';

const IDLE_TIMEOUT_MS = IDLE_TIMEOUT_MINUTES * SECONDS_PER_MINUTE * MS_PER_SECOND;

interface PendingScan {
    requestId: string;
    id: number;
    socket: net.Socket;
}

/**
 * Per-project daemon instance: owns the bound net server (or stdio transport), the persistent
 * scan context that keeps caches and worker pools warm across requests, and the shutdown state.
 * One instance serves one project root; `listen()` binds once and `shutdown()` is idempotent
 * because it flips `shuttingDown` before releasing pools and clearing the registry, so repeated
 * signals or a shutdown frame cannot double-release shared resources.
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
        this.logger = new Logger('info', this.stdioMode ? undefined : this.logFile);
    }

    /** Start listening (net or stdio) + register. Resolves once bound. */
    listen(): Promise<void> {
        return new Promise((resolve, reject) => {
            const onReady = () => {
                this.scheduleIdle();
                if (!this.stdioMode) {
                    const info: RegistryInfo = {
                        pid: process.pid,
                        pipe: this.pipe,
                        startedAt: new Date().toISOString(),
                        version: PROTOCOL_SOFTWARE_VERSION,
                        protocol: PROTOCOL_VERSION,
                        logFile: this.logFile,
                    };
                    writeRegistry(this.projectHash, info);
                }
                this.logger.info(
                    `daemon listening on ${this.pipe} (pid ${process.pid}, stdio=${this.stdioMode})`,
                );
                resolve();
            };

            if (this.stdioMode) {
                this.server = null;
                this.serveStdio();
                onReady();
                return;
            }

            // Windows named pipes: remove a stale endpoint file is unnecessary (pipes are
            // volatile); POSIX Unix sockets leave a stale file — unlink best-effort before bind.
            if (process.platform !== 'win32') {
                try {
                    fs.rmSync(this.pipe, { force: true });
                } catch {
                    /* ignore */
                }
            }

            const srv = net.createServer((socket) => this.handleConnection(socket));
            this.server = srv;
            srv.on(ERROR_EVENT, (e) => {
                this.logger.error(`daemon server error: ${e.message}`);
                reject(e);
            });
            srv.listen(this.pipe, onReady);
        });
    }

    private serveStdio(): void {
        const stdin = process.stdin;
        const stdout = process.stdout;
        let buffer = '';
        stdin.setEncoding('utf8');
        stdin.on('data', (chunk: string) => {
            buffer += chunk;
            let idx: number;
            while ((idx = buffer.indexOf('\n')) >= 0) {
                const line = buffer.slice(0, idx).trim();
                buffer = buffer.slice(idx + 1);
                if (!line) continue;
                let msg: DaemonMessage;
                try {
                    msg = decodeLine(line);
                } catch {
                    stdout.write(
                        encodeMessage({
                            v: 1,
                            id: 0,
                            type: MESSAGE_TYPE_ERROR,
                            code: 'PROTOCOL_PARSE',
                            message: 'malformed NDJSON line',
                        }),
                    );
                    continue;
                }
                this.handleMessage(msg, {
                    write: (m: DaemonMessage | Record<string, any>) =>
                        stdout.write(encodeMessage(m)),
                    close: () => {},
                    id: () => 0,
                } as any);
            }
        });
        stdin.on('end', () => this.shutdown('stdio-eof'));
    }

    private handleConnection(socket: net.Socket): void {
        this.touchIdle();
        let buffer = '';
        socket.setEncoding('utf8');
        const write = (m: DaemonMessage | Record<string, any>) => {
            if (!socket.destroyed) socket.write(encodeMessage(m));
        };
        socket.on('data', (chunk: string) => {
            buffer += chunk;
            let idx: number;
            while ((idx = buffer.indexOf('\n')) >= 0) {
                const line = buffer.slice(0, idx).trim();
                buffer = buffer.slice(idx + 1);
                if (!line) continue;
                let msg: DaemonMessage;
                try {
                    msg = decodeLine(line);
                } catch {
                    write({
                        v: 1,
                        id: 0,
                        type: MESSAGE_TYPE_ERROR,
                        code: 'PROTOCOL_PARSE',
                        message: 'malformed NDJSON line',
                    });
                    continue;
                }
                this.handleMessage(msg, {
                    write,
                    close: () => socket.destroy(),
                    id: () => this.nextId++,
                });
            }
        });
        socket.on('close', () => this.touchIdle());
        socket.on(ERROR_EVENT, () => this.touchIdle());
    }

    /** Dispatch one decoded NDJSON message (shared by net + stdio transports). */
    private handleMessage(
        msg: DaemonMessage,
        io: {
            write: (m: DaemonMessage | Record<string, any>) => void;
            close: () => void;
            id: () => number;
        },
    ): void {
        switch (msg.type) {
            case 'hello': {
                const ack: HelloAckMessage = {
                    v: 1,
                    id: msg.id,
                    type: 'hello_ack',
                    version: PROTOCOL_SOFTWARE_VERSION,
                    protocol: PROTOCOL_VERSION,
                    caps: {
                        cache: true,
                        stream: true,
                        maxWorkers: DAEMON_MAX_WORKERS,
                        diff: true,
                    },
                };
                io.write(ack);
                this.touchIdle();
                break;
            }
            case 'ping':
                io.write({ v: 1, id: msg.id, type: 'pong' });
                this.touchIdle();
                break;
            case 'scan':
                this.touchIdle();
                void this.runScan(
                    msg.params.config,
                    msg.params.options,
                    msg.id,
                    msg.params.requestId,
                    io,
                );
                break;
            case 'scan_diff':
                this.touchIdle();
                void this.runScanDiff(
                    msg.params.config,
                    msg.params.diffs,
                    msg.params.options,
                    msg.id,
                    msg.params.requestId,
                    io,
                );
                break;
            case 'shutdown':
                this.logger.info(`shutdown requested (${msg.reason || 'client'}); exiting`);
                this.shutdown(msg.reason || 'client-request');
                break;
            default:
                io.write({
                    v: 1,
                    id: msg.id,
                    type: MESSAGE_TYPE_ERROR,
                    code: 'UNKNOWN_MESSAGE',
                    message: `unknown type ${(msg as any).type}`,
                });
        }
    }

    private async runScan(
        configJson: Record<string, any>,
        options: {
            cache: boolean;
            cacheDir?: string;
            cacheCustom?: boolean;
            workers?: number;
            parser?: string;
        },
        id: number,
        requestId: string,
        io: { write: (m: DaemonMessage | Record<string, any>) => void },
    ): Promise<void> {
        const config = configJson as unknown as ScanConfig;
        try {
            const { report, stats } = await handleScan(this.ctx, config, options);
            io.write({
                v: 1,
                id,
                type: 'scan_done',
                requestId,
                report: report as unknown as Record<string, any>,
                stats,
            });
            this.pending.delete(requestId);
            this.touchIdle();
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            io.write({
                v: 1,
                id,
                type: MESSAGE_TYPE_ERROR,
                requestId,
                code: 'SCAN_FAILED',
                message,
                detail: { stack: e instanceof Error ? e.stack : undefined },
            });
            this.pending.delete(requestId);
            this.touchIdle();
        }
    }

    private async runScanDiff(
        configJson: Record<string, any>,
        diffs: Array<Record<string, any>>,
        options: {
            cache: boolean;
            cacheDir?: string;
            cacheCustom?: boolean;
            workers?: number;
            parser?: string;
            verifyDiskContent?: boolean;
            delta?: boolean;
        },
        id: number,
        requestId: string,
        io: { write: (m: DaemonMessage | Record<string, any>) => void },
    ): Promise<void> {
        const config = configJson as unknown as ScanConfig;
        try {
            const { report, stats } = await handleScanDiff(this.ctx, config, diffs, options);
            io.write({
                v: 1,
                id,
                type: 'scan_done',
                requestId,
                report: report as unknown as Record<string, any>,
                stats,
            });
            this.pending.delete(requestId);
            this.touchIdle();
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            io.write({
                v: 1,
                id,
                type: MESSAGE_TYPE_ERROR,
                requestId,
                code: 'SCAN_FAILED',
                message,
                detail: { stack: e instanceof Error ? e.stack : undefined },
            });
            this.pending.delete(requestId);
            this.touchIdle();
        }
    }

    private touchIdle(): void {
        this.scheduleIdle();
    }

    private scheduleIdle(): void {
        if (this.idleTimer) clearTimeout(this.idleTimer);
        this.idleTimer = setTimeout(() => {
            this.logger.info(`idle ${IDLE_TIMEOUT_MS / MS_PER_SECOND}s — exiting`);
            this.shutdown('idle-timeout');
        }, IDLE_TIMEOUT_MS);
        if (this.idleTimer.unref) this.idleTimer.unref();
    }

    /** Graceful exit: stop accepting, release pools, remove registry, exit(0). */
    shutdown(reason = 'unknown'): void {
        if (this.shuttingDown) return;
        this.shuttingDown = true;
        if (this.idleTimer) clearTimeout(this.idleTimer);
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
        setImmediate(() => process.exit(0));
    }
}

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
export async function daemonMain(argv: string[]): Promise<void> {
    const rootArg = argv.find((a, i) => a === '--root' && argv[i + 1])
        ? argv[argv.indexOf('--root') + 1]
        : process.cwd();
    const stdio = argv.includes('--stdio');
    const server = new DaemonServer(rootArg, { stdio });
    try {
        await server.listen();
    } catch (e) {
        process.stderr.write(
            `[auto-refactor daemon] failed to listen: ${e instanceof Error ? e.message : String(e)}\n`,
        );
        process.exit(1);
    }
    process.on('SIGTERM', () => server.shutdown('sigterm'));
    process.on('SIGINT', () => server.shutdown('sigint'));
    process.on('uncaughtException', (e) => {
        process.stderr.write(`[auto-refactor daemon] uncaught: ${e && e.stack ? e.stack : e}\n`);
        server.shutdown('uncaught-exception');
    });
}

if (require.main === module) {
    void daemonMain(process.argv.slice(2));
}
