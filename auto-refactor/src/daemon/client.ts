/**
 * Module: Daemon — Warm-Scan IPC Client (docs/01-architecture/02-pipeline-and-caching.md §A2.4)
 * File Path: src/daemon/client.ts
 * Architecture Role: Client-side adapter over the daemon NDJSON protocol; owns registry
 *   discovery, socket connect, hello handshake and per-request reply correlation.
 * Dependencies & Triggers: Node `net`, ../core/types, ./protocol (versions, codecs) and
 *   ./registry (readRegistry, projectHashFor); invoked by src/api.ts warm scans and by daemon
 *   start/status/stop in src/cli/daemonCmd.ts when a registry entry already exists.
 * Responsibilities: Resolve the project registry and reject on protocol drift, negotiate
 *   hello/hello_ack while capturing capabilities, run scan / scan_diff / ping with per-request
 *   timers, buffer and decode NDJSON lines, and reject every in-flight request when the socket
 *   errors or closes before its reply.
 * Exit Semantics & Design Rationale: Never auto-starts a daemon and never masks failures:
 *   connect/scan/ping reject with NO_DAEMON, VERSION_DRIFT, *_TIMEOUT or DAEMON_DISCONNECT so
 *   callers degrade to a cold scan; the one-shot tryWarmScan/tryWarmScanDiff wrappers convert
 *   any such failure to null because warm-scan is an accelerator, not a correctness guarantee.
 */

import * as net from 'net';
import type { ScanConfig, ScanReport, WarmStats } from '../core/types';
import type { Logger } from '../core/logger';
import type { RegistryInfo } from './registry';
import { readRegistry, projectHashFor } from './registry';
import type {
    DaemonMessage,
    HelloAckMessage,
    ScanDoneMessage,
    ErrorMessage,
    PongMessage,
} from './protocol';
import { PROTOCOL_VERSION, PROTOCOL_SOFTWARE_VERSION, encodeMessage, decodeLine } from './protocol';

const CONNECT_TIMEOUT_MS = 500;
const HANDSHAKE_TIMEOUT_MS = 500;
const SCAN_TIMEOUT_MS = 120_000;

/** Default ping timeout in milliseconds when the caller does not pass an explicit one. */
const DEFAULT_PING_TIMEOUT_MS = 1000;

/** Rejection message used when the socket is missing or already destroyed. */
const NOT_CONNECTED_ERROR = 'NOT_CONNECTED';

/** Message and event type string literals for wire protocol messages. */
const MSG_TYPE_CONNECT = 'connect';
const MSG_TYPE_HELLO = 'hello';
const MSG_TYPE_SCAN = 'scan';
const MSG_TYPE_SCAN_DIFF = 'scan_diff';
const MSG_TYPE_PING = 'ping';
const MSG_TYPE_SHUTDOWN = 'shutdown';
const MSG_TYPE_CLIENT_REQUEST = 'client-request';

function formatDaemonOptions(options: DaemonScanOptions): DaemonScanOptions {
    return {
        cache: options.cache,
        cacheDir: options.cacheDir,
        cacheCustom: options.cacheCustom,
        workers: options.workers,
        parser: options.parser,
    };
}

function formatDaemonDiffOptions(options: DaemonScanDiffOptions): DaemonScanDiffOptions {
    return {
        ...formatDaemonOptions(options),
        verifyDiskContent: options.verifyDiskContent,
        delta: options.delta,
    };
}

/**
 * Result of a successful warm scan: the report bytes a cold scan would produce plus the daemon
 * cache/incremental statistics kept outside ScanReport.
 */
export interface WarmScanResult {
    report: ScanReport;
    stats: WarmStats;
}

/** Configuration options for single-run warm scans sent to daemon */
export interface DaemonScanOptions {
    cache: boolean;
    cacheDir?: string;
    cacheCustom?: boolean;
    workers?: number;
    parser?: string;
}

/** Configuration options for incremental diff scans sent to daemon */
export interface DaemonScanDiffOptions extends DaemonScanOptions {
    verifyDiskContent: boolean;
    delta: boolean;
}

/**
 * Client-side connection to one warm-scan daemon: registry lookup, socket and hello handshake,
 * per-request reply correlation, and rejection of in-flight work when the socket errors or
 * closes. Instances are single-connection and are not safe for concurrent requests, since each
 * request kind has one pending slot; create one client per warm attempt, call connect(), then
 * await scan()/scanDiff()/ping(), and finish with close() or shutdown().
 */
export class DaemonClient {
    private socket: net.Socket | null = null;
    private registry: RegistryInfo | null = null;
    private buffer = '';
    private nextId = 0;
    private pendingHello: {
        resolve: (ack: HelloAckMessage) => void;
        reject: (error: Error) => void;
    } | null = null;
    private pendingScan: {
        resolve: (scanResult: WarmScanResult) => void;
        reject: (error: Error) => void;
    } | null = null;
    private pendingScanDiff: {
        resolve: (diffResult: { report: unknown; stats: unknown }) => void;
        reject: (error: Error) => void;
    } | null = null;
    private pendingPong: { resolve: () => void; reject: (error: Error) => void } | null = null;
    private caps: { cache: boolean; stream: boolean; maxWorkers: number; diff?: boolean } | null =
        null;

    constructor(
        readonly root: string,
        readonly projectHash: string = projectHashFor(root),
    ) {}

    private handleInFlightRejections(error: Error): void {
        if (this.pendingScan) {
            this.pendingScan.reject(error);
            this.pendingScan = null;
        }
        if (this.pendingScanDiff) {
            this.pendingScanDiff.reject(error);
            this.pendingScanDiff = null;
        }
        if (this.pendingPong) {
            this.pendingPong.reject(error);
            this.pendingPong = null;
        }
    }

    private attachSocketHandlers(
        socket: net.Socket,
        timer: NodeJS.Timeout,
        resolve: () => void,
        reject: (error: Error) => void,
    ): void {
        let settled = false;
        const fail = (error: Error) => {
            if (settled) return;
            settled = true;
            try {
                socket.destroy();
            } catch {
                /* ignore */
            }
            reject(error);
        };

        socket.on(MSG_TYPE_CONNECT, () => {
            this.pendingHello = {
                resolve: (_ack) => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timer);
                    resolve();
                },
                reject: fail,
            };
            this.sendDaemonMessage({
                v: 1,
                id: ++this.nextId,
                type: MSG_TYPE_HELLO,
                version: PROTOCOL_SOFTWARE_VERSION,
                protocol: PROTOCOL_VERSION,
                projectHash: this.projectHash,
            });
            setTimeout(() => {
                if (!settled) fail(new Error('HANDSHAKE_TIMEOUT'));
            }, HANDSHAKE_TIMEOUT_MS);
        });

        socket.on('data', (chunk: Buffer) => this.onData(chunk.toString('utf8')));
        socket.on('error', (err) => {
            if (!settled) fail(new Error(`CONNECT_ERROR: ${err.message}`));
            this.handleInFlightRejections(new Error(`DAEMON_DISCONNECT: ${err.message}`));
        });
        socket.on('close', () => {
            if (!settled) fail(new Error('CONNECTION_CLOSED'));
            this.handleInFlightRejections(new Error('DAEMON_DISCONNECT: connection closed'));
        });
    }

    /** Look up the registry + connect + handshake. Rejects on ANY failure (→ caller degrades). */
    connect(timeoutMs: number = CONNECT_TIMEOUT_MS): Promise<void> {
        return new Promise((resolve, reject) => {
            const registry = readRegistry(this.projectHash);
            if (!registry) {
                reject(new Error('NO_DAEMON: no daemon registry for project'));
                return;
            }
            if (registry.protocol !== PROTOCOL_VERSION) {
                reject(
                    new Error(
                        `VERSION_DRIFT: daemon protocol ${registry.protocol} != client ${PROTOCOL_VERSION}`,
                    ),
                );
                return;
            }
            this.registry = registry;

            const socket = net.connect(registry.pipe);
            this.socket = socket;
            const timer = setTimeout(() => {
                try {
                    socket.destroy();
                } catch {
                    /* ignore */
                }
                reject(new Error(`CONNECT_TIMEOUT after ${timeoutMs}ms`));
            }, timeoutMs);

            this.attachSocketHandlers(socket, timer, resolve, reject);
        });
    }

    private executeTimedRequest<T>(
        timeoutMs: number,
        timeoutMessage: string,
        registerPending: (pending: { resolve: (payload: T) => void; reject: (err: Error) => void }) => void,
        dispatchSend: (messageId: number, requestId: string) => void,
    ): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            if (!this.socket || this.socket.destroyed) {
                reject(new Error(NOT_CONNECTED_ERROR));
                return;
            }
            const requestId = `r${++this.nextId}`;
            const messageId = this.nextId;
            let settled = false;
            const timer = setTimeout(() => {
                if (!settled) {
                    settled = true;
                    reject(new Error(timeoutMessage));
                }
            }, timeoutMs);
            registerPending({
                resolve: (resultPayload: T) => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timer);
                    resolve(resultPayload);
                },
                reject: (err: Error) => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timer);
                    reject(err);
                },
            });
            dispatchSend(messageId, requestId);
        });
    }

    /** Run one warm scan. Must be connected first. Rejects on daemon error/timeout/close. */
    scan(config: ScanConfig, options: DaemonScanOptions): Promise<WarmScanResult> {
        return this.executeTimedRequest<WarmScanResult>(
            SCAN_TIMEOUT_MS,
            'SCAN_TIMEOUT',
            (pending) => {
                this.pendingScan = pending;
            },
            (messageId, requestId) => {
                this.sendDaemonMessage({
                    v: 1,
                    id: messageId,
                    type: MSG_TYPE_SCAN,
                    params: {
                        requestId,
                        config: config as unknown as Record<string, unknown>,
                        options: formatDaemonOptions(options),
                    },
                });
            },
        );
    }

    /** Whether the connected daemon advertised the `diff` capability (old daemons don't). */
    hasDiffCap(): boolean {
        return !!(this.caps && this.caps.diff === true);
    }

    /** Run one diff scan (scanDiff / scanDiffDelta). Must be connected first. */
    scanDiff(
        config: ScanConfig,
        diffs: Array<Record<string, unknown>>,
        options: DaemonScanDiffOptions,
    ): Promise<{ report: unknown; stats: unknown }> {
        return this.executeTimedRequest<{ report: unknown; stats: unknown }>(
            SCAN_TIMEOUT_MS,
            'SCAN_TIMEOUT',
            (pending) => {
                this.pendingScanDiff = pending;
            },
            (messageId, requestId) => {
                this.sendDaemonMessage({
                    v: 1,
                    id: messageId,
                    type: MSG_TYPE_SCAN_DIFF,
                    params: {
                        requestId,
                        config: config as unknown as Record<string, unknown>,
                        diffs,
                        options: formatDaemonDiffOptions(options),
                    },
                });
            },
        );
    }

    /** Ping the daemon (status command). Rejects when not running / no response. */
    ping(timeoutMs: number = DEFAULT_PING_TIMEOUT_MS): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!this.socket || this.socket.destroyed) {
                reject(new Error(NOT_CONNECTED_ERROR));
                return;
            }
            let settled = false;
            const timer = setTimeout(() => {
                if (!settled) {
                    settled = true;
                    reject(new Error('PING_TIMEOUT'));
                }
            }, timeoutMs);
            this.pendingPong = {
                resolve: () => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timer);
                    resolve();
                },
                reject: (error) => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timer);
                    reject(error);
                },
            };
            this.sendDaemonMessage({ v: 1, id: ++this.nextId, type: MSG_TYPE_PING });
        });
    }

    /** Ask the daemon to shut down (daemon stop). Best-effort. */
    shutdown(): void {
        try {
            this.sendDaemonMessage({
                v: 1,
                id: ++this.nextId,
                type: MSG_TYPE_SHUTDOWN,
                reason: MSG_TYPE_CLIENT_REQUEST,
            });
        } catch {
            /* ignore */
        }
        try {
            this.socket?.destroy();
        } catch {
            /* ignore */
        }
        this.socket = null;
    }

    close(): void {
        try {
            this.socket?.removeListener('data', () => {});
            this.socket?.destroy();
        } catch {
            /* ignore */
        }
        this.socket = null;
    }

    /** Disposes client socket connections and drains active event subscriptions. */
    dispose(): void {
        this.caps = null;
        this.registry = null;
        this.close();
    }

    private sendDaemonMessage(msg: DaemonMessage): void {
        if (!this.socket || this.socket.destroyed) throw new Error(NOT_CONNECTED_ERROR);
        this.socket.write(encodeMessage(msg as DaemonMessage));
    }

    private onData(chunk: string): void {
        this.buffer += chunk;
        let idx: number;
        while ((idx = this.buffer.indexOf('\n')) >= 0) {
            const line = this.buffer.slice(0, idx).trim();
            this.buffer = this.buffer.slice(idx + 1);
            if (!line) continue;
            let msg: DaemonMessage;
            try {
                msg = decodeLine(line);
            } catch {
                continue; // ignore malformed lines
            }
            this.onMessage(msg);
        }
    }

    private handleHelloAck(msg: HelloAckMessage): void {
        if (msg.protocol !== PROTOCOL_VERSION || msg.version !== PROTOCOL_SOFTWARE_VERSION) {
            this.pendingHello?.reject(
                new Error(
                    `VERSION_DRIFT: daemon ${msg.version}/p${msg.protocol} != client ${PROTOCOL_SOFTWARE_VERSION}/p${PROTOCOL_VERSION}`,
                ),
            );
        } else {
            this.caps = msg.caps;
            this.pendingHello?.resolve(msg);
        }
        this.pendingHello = null;
    }

    private handleScanDone(msg: ScanDoneMessage): void {
        if (this.pendingScanDiff) {
            this.pendingScanDiff.resolve({ report: msg.report, stats: msg.stats });
            this.pendingScanDiff = null;
            return;
        }
        if (this.pendingScan) {
            this.pendingScan.resolve({
                report: msg.report as unknown as ScanReport,
                stats: msg.stats as unknown as WarmStats,
            });
            this.pendingScan = null;
        }
    }

    private handleError(msg: ErrorMessage): void {
        if (msg.requestId) {
            if (this.pendingScanDiff) {
                this.pendingScanDiff.reject(new Error(`DAEMON_ERROR(${msg.code}): ${msg.message}`));
            }
            if (this.pendingScan) {
                this.pendingScan.reject(new Error(`DAEMON_ERROR(${msg.code}): ${msg.message}`));
            }
        }
        this.pendingScanDiff = null;
        this.pendingScan = null;
    }

    private handlePong(_msg: PongMessage): void {
        this.pendingPong?.resolve();
        this.pendingPong = null;
    }

    private onMessage(msg: DaemonMessage): void {
        switch (msg.type) {
            case 'hello_ack':
                this.handleHelloAck(msg);
                break;
            case 'scan_done':
                this.handleScanDone(msg);
                break;
            case 'error':
                this.handleError(msg);
                break;
            case 'pong':
                this.handlePong(msg);
                break;
            default:
                break;
        }
    }
}

/** Parameters for executing a one-shot warm scan against daemon */
export interface WarmScanParams {
    readonly root: string;
    readonly config: ScanConfig;
    readonly options: DaemonScanOptions;
    readonly logger?: Logger;
}

/**
 * One-shot convenience: connect, run one warm scan, and close the client. Returns null instead
 * of throwing whenever the daemon is missing, drifts, times out, or disconnects, so the caller
 * can degrade to a cold scan. Each call owns its client and shares no state across calls.
 *
 * @param params - Structured WarmScanParams bundle containing root, config, options, and logger.
 * @returns Warm-scan result, or null when the daemon path is unusable; this async call resolves
 *          after the client closes.
 */
export async function tryWarmScan(params: WarmScanParams): Promise<WarmScanResult | null> {
    const client = new DaemonClient(params.root);
    try {
        await client.connect();
        const warmScanResult = await client.scan(params.config, params.options);
        client.close();
        return warmScanResult;
    } catch (error) {
        client.close();
        params.logger?.debug(
            `warm scan fallback to cold scan: ${error instanceof Error ? error.message : String(error)}`,
        );
        return null;
    }
}

/** Parameters for executing a one-shot warm diff scan against daemon */
export interface WarmScanDiffParams {
    readonly root: string;
    readonly config: ScanConfig;
    readonly diffs: Array<Record<string, unknown>>;
    readonly options: DaemonScanDiffOptions;
    readonly logger?: Logger;
}

/**
 * One-shot diff scan: connect, verify the daemon advertises the `diff` capability, run one
 * scan_diff, and close. Returns null instead of throwing when the daemon is unusable or lacks
 * that capability, so callers fall back to an in-process diff scan. Each call owns its client
 * and shares no state across calls.
 *
 * @param params - Structured WarmScanDiffParams bundle containing root, config, diffs,
 *                 options, and logger.
 * @returns Diff-scan result `{ report, stats }`, or null when unusable; this async call
 *          resolves after the client closes.
 */
export async function tryWarmScanDiff(
    params: WarmScanDiffParams,
): Promise<{ report: unknown; stats: unknown } | null> {
    const client = new DaemonClient(params.root);
    try {
        await client.connect();
        if (!client.hasDiffCap()) {
            client.close();
            params.logger?.debug('warm scan diff rejected: daemon lacks diff capability');
            return null;
        }
        const diffScanResult = await client.scanDiff(params.config, params.diffs, params.options);
        client.close();
        return diffScanResult;
    } catch (error) {
        client.close();
        params.logger?.debug(
            `warm scan diff fallback to cold scan: ${error instanceof Error ? error.message : String(error)}`,
        );
        return null;
    }
}
