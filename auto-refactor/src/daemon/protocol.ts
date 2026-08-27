/**
 * Daemon IPC protocol (docs/warm-scan-design.md §A2).
 *
 * Transport: NDJSON (one JSON object per line, UTF-8, `\n` separated) over a `net` socket
 * (Windows named pipe / POSIX Unix socket) or over stdio in embedded mode (`--stdio`).
 *
 * Message types:
 *   client → daemon: hello / scan / ping / shutdown
 *   daemon → client: hello_ack / scan_data / scan_done / error / pong
 *
 * Every message carries `{ v, id }`; `id` correlates request/response pairs. `scan` is the
 * only streaming request: the daemon may emit zero or more `scan_data` chunks followed by
 * exactly one `scan_done` (or one `error`).
 */

export const PROTOCOL_VERSION = 1;
export const PROTOCOL_SOFTWARE_VERSION = '0.1.0';

export interface HelloMessage {
  v: number;
  id: number;
  type: 'hello';
  version: string;
  protocol: number;
  projectHash: string;
}

export interface HelloAckMessage {
  v: number;
  id: number;
  type: 'hello_ack';
  version: string;
  protocol: number;
  caps: { cache: boolean; stream: boolean; maxWorkers: number; diff: boolean };
}

export interface ScanMessage {
  v: number;
  id: number;
  type: 'scan';
  params: {
    requestId: string;
    /** Full resolved ScanConfig JSON (client-side resolveConfig) — the daemon never re-reads
     *  config files, eliminating client/daemon config drift. */
    config: Record<string, any>;
    options: {
      cache: boolean;
      cacheDir?: string;
      cacheCustom?: boolean;
      workers?: number;
      parser?: string;
    };
  };
}

/** Diff scan request (docs/diff-interface-spec.md §3.4). Same `scan_done` response as `scan`. */
export interface ScanDiffMessage {
  v: number;
  id: number;
  type: 'scan_diff';
  params: {
    requestId: string;
    config: Record<string, any>;
    /** DiffInput[] (JSON-serialized; content fields are already UTF-16 strings). */
    diffs: Array<Record<string, any>>;
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

export interface ScanDataMessage {
  v: number;
  id: number;
  type: 'scan_data';
  requestId: string;
  seq: number;
  files: string[];
  issues: any[];
  metrics: any[];
}

export interface ScanDoneMessage {
  v: number;
  id: number;
  type: 'scan_done';
  requestId: string;
  report: Record<string, any>;
  stats: Record<string, any>;
}

export interface ErrorMessage {
  v: number;
  id: number;
  type: 'error';
  requestId?: string;
  code: string;
  message: string;
  detail?: Record<string, any>;
}

export interface PingMessage {
  v: number;
  id: number;
  type: 'ping';
}

export interface PongMessage {
  v: number;
  id: number;
  type: 'pong';
}

export interface ShutdownMessage {
  v: number;
  id: number;
  type: 'shutdown';
  reason?: string;
}

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

/** Serialize one message to an NDJSON line (trailing `\n`). */
export function encodeMessage(msg: DaemonMessage | Record<string, any>): string {
  return JSON.stringify(msg) + '\n';
}

/** Parse one NDJSON line; throws on malformed JSON (caller decides: skip or error). */
export function decodeLine(line: string): DaemonMessage {
  return JSON.parse(line) as DaemonMessage;
}

/** Incrementing id generator for a client connection. */
export function createIdGenerator(): () => number {
  let n = 0;
  return () => ++n;
}
