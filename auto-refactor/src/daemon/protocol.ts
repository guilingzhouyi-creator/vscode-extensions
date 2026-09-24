/**
 * Module: Daemon — IPC Wire Protocol Contract
 * File Path: src/daemon/protocol.ts
 * Architecture Role: Single source of truth for daemon message shapes and the protocol /
 *   software version constants shared by ./client, ./server and stdio embedded mode.
 * Dependencies & Triggers: No runtime imports (interfaces plus constants); consumed by ./client
 *   on every connect handshake and by ./server on every decoded frame, per
 *   docs/01-architecture/02-pipeline-and-caching.md §A2.
 * Responsibilities: Declare hello/hello_ack, scan/scan_diff, scan_data, scan_done, error, ping,
 *   pong and shutdown payloads plus the DaemonMessage union; provide encodeMessage (JSON plus
 *   newline), decodeLine (JSON.parse that throws) and createIdGenerator for id correlation.
 * Exit Semantics & Design Rationale: Pure serialization helpers with no sockets or state beyond
 *   the generator closure; decodeLine throws on malformed JSON so the client skips a bad line
 *   while the server answers PROTOCOL_PARSE, and version constants live here so client/daemon
 *   drift is detected at handshake time instead of corrupting a scan.
 *
 * Transport: NDJSON (one JSON object per line, UTF-8, `\n` separated) over a `net` socket
 * (Windows named pipe / POSIX Unix socket) or over stdio in embedded mode (`--stdio`).
 * Message types: client -> daemon: hello / scan / scan_diff / ping / shutdown;
 *   daemon -> client: hello_ack / scan_data / scan_done / error / pong.
 * Every message carries `{ v, id }`; `id` correlates request/response pairs. `scan` is the only
 * streaming request: zero or more `scan_data` chunks then exactly one `scan_done` (or `error`).
 */

/**
 * Wire-protocol version exchanged in hello/hello_ack. Peers must match exactly, because a
 * different value implies changed message shapes and invalid request/response semantics.
 */
export const PROTOCOL_VERSION = 1;
/**
 * Software build string exchanged in hello/hello_ack and written to the registry. The
 * client rejects a hello_ack whose build differs (strict equality), so this acts as a
 * build-identity check; PROTOCOL_VERSION remains the wire-compatibility gate.
 */
export const PROTOCOL_SOFTWARE_VERSION = '0.1.0';

/**
 * Opening client frame; advertises the client build/protocol plus the project hash used for
 * endpoint discovery. Routing already happened through the named pipe/socket, so the hash is
 * informational here and may be ignored by the peer.
 */
export interface HelloMessage {
    v: number;
    id: number;
    type: 'hello';
    version: string;
    protocol: number;
    projectHash: string;
}

/**
 * Daemon handshake reply echoing the negotiated build/protocol plus capability flags:
 * cache reuse, streaming, maximum worker count and diff-scan support.
 */
export interface HelloAckMessage {
    v: number;
    id: number;
    type: 'hello_ack';
    version: string;
    protocol: number;
    caps: { cache: boolean; stream: boolean; maxWorkers: number; diff: boolean };
}

/**
 * Streaming scan request. The client sends a fully resolved ScanConfig so the daemon never
 * re-reads config files; the daemon answers with zero or more scan_data chunks followed by
 * exactly one scan_done (or an error frame).
 */
export interface ScanMessage {
    v: number;
    id: number;
    type: 'scan';
    params: {
        requestId: string;
        /** Full resolved ScanConfig JSON (client-side resolveConfig) — the daemon never re-reads
         *  config files, eliminating client/daemon config drift. */
        config: Record<string, unknown>;
        options: {
            cache: boolean;
            cacheDir?: string;
            cacheCustom?: boolean;
            workers?: number;
            parser?: string;
        };
    };
}

/**
 * Diff scan request (docs/03-incremental-and-diff/02-diff-interface-spec.md §3.4).
 * Same `scan_done` response as `scan`.
 */
export interface ScanDiffMessage {
    v: number;
    id: number;
    type: 'scan_diff';
    params: {
        requestId: string;
        config: Record<string, unknown>;
        /** DiffInput[] (JSON-serialized; content fields are already UTF-16 strings). */
        diffs: Array<Record<string, unknown>>;
        options: {
            cache: boolean;
            cacheDir?: string;
            cacheCustom?: boolean;
            workers?: number;
            parser?: string;
            verifyDiskContent?: boolean;
            /** true = scanDiffDelta (changed-file subset only). */
            delta?: boolean;
        };
    };
}

/**
 * One streamed batch of scan output for a request: `seq` orders chunks, `files` lists the
 * scanned paths covered by the batch, and `issues`/`metrics` carry the incremental payload.
 */
export interface ScanDataMessage {
    v: number;
    id: number;
    type: 'scan_data';
    requestId: string;
    seq: number;
    files: string[];
    issues: unknown[];
    metrics: unknown[];
}

/**
 * Terminal success frame for a streaming scan (shared by scan and scan_diff); carries the
 * aggregated report and run stats and marks the end of the requestId stream.
 */
export interface ScanDoneMessage {
    v: number;
    id: number;
    type: 'scan_done';
    requestId: string;
    report: Record<string, unknown>;
    stats: Record<string, unknown>;
}

/**
 * Terminal failure frame. `code` is a stable machine-readable identifier, `message` is
 * human-readable, and `detail` optionally carries structured context for diagnostics.
 */
export interface ErrorMessage {
    v: number;
    id: number;
    type: 'error';
    requestId?: string;
    code: string;
    message: string;
    detail?: Record<string, unknown>;
}

/**
 * Liveness probe sent by a client; the daemon answers exactly one matching pong.
 */
export interface PingMessage {
    v: number;
    id: number;
    type: 'ping';
}

/**
 * Liveness reply carrying the id of the ping it answers.
 */
export interface PongMessage {
    v: number;
    id: number;
    type: 'pong';
}

/**
 * Graceful shutdown request; `reason` is optional logging context and the daemon stops
 * accepting new requests once it has handled the frame.
 */
export interface ShutdownMessage {
    v: number;
    id: number;
    type: 'shutdown';
    reason?: string;
}

/**
 * Discriminated union of all legal wire frames. Narrow on `type` before reading
 * type-specific fields; the shared `v`/`id` envelope carries version and request
 * correlation metadata for every variant.
 */
export type DaemonMessage =
    | HelloMessage
    | HelloAckMessage
    | ScanMessage
    | ScanDiffMessage
    | ScanDataMessage
    | ScanDoneMessage
    | ErrorMessage
    | PingMessage
    | PongMessage
    | ShutdownMessage;

/**
 * Serialize one message to a single NDJSON line.
 *
 * @param msg - Any JSON-serializable frame; the declared DaemonMessage shapes round-trip
 *   losslessly, including their nested payload records.
 * @returns The serialized JSON text terminated by exactly one trailing newline, ready for a
 *   single socket write in the NDJSON stream.
 * @throws When `msg` contains a circular reference, JSON.stringify raises TypeError; callers
 *   should keep payloads acyclic as the wire contract requires.
 */
export function encodeMessage(msg: DaemonMessage | Record<string, unknown>): string {
    return JSON.stringify(msg) + '\n';
}

/**
 * Parse one NDJSON line into a message object.
 *
 * @param line - A single line produced by `encodeMessage`; JSON.parse tolerates surrounding
 *   whitespace but not framing bytes or concatenated lines.
 * @returns The parsed frame, nominally typed as DaemonMessage; the wire contract is trusted
 *   rather than schema-validated here.
 * @throws When the line is not valid JSON (SyntaxError). The client skips such a line while
 *   the server converts it into a PROTOCOL_PARSE error response.
 */
export function decodeLine(line: string): DaemonMessage {
    return JSON.parse(line) as DaemonMessage;
}

/**
 * Create the request/response id allocator for one client connection.
 *
 * @returns A zero-argument closure yielding 1, 2, 3, ... in call order; the counter lives in
 *   the closure, so generators are independent and require no external synchronization.
 */
export function createIdGenerator(): () => number {
    let n = 0;
    return () => ++n;
}
