import * as net from 'net';
import { ScanConfig, ScanReport, WarmStats } from '../core/types';
import { readRegistry, RegistryInfo, projectHashFor } from './registry';
import {
  DaemonMessage,
  PROTOCOL_VERSION,
  PROTOCOL_SOFTWARE_VERSION,
  encodeMessage,
  decodeLine,
} from './protocol';

/**
 * Daemon client (docs/01-architecture/02-pipeline-and-caching.md §A2.4).
 *
 * Discover → connect → hello handshake → scan. ANY failure (registry missing, connect error,
 * handshake timeout, version/protocol drift, scan timeout, mid-scan socket death) rejects —
 * the caller (scanWarm / CLI) degrades to a cold scan. The client NEVER auto-starts a daemon
 * (that is the explicit `--daemon` / `daemon start` path).
 */

const CONNECT_TIMEOUT_MS = 500;
const HANDSHAKE_TIMEOUT_MS = 500;
const SCAN_TIMEOUT_MS = 120_000;

export interface WarmScanResult {
  report: ScanReport;
  stats: WarmStats;
}

export class DaemonClient {
  private socket: net.Socket | null = null;
  private registry: RegistryInfo | null = null;
  private buffer = '';
  private nextId = 0;
  private pendingHello: { resolve: (ack: any) => void; reject: (e: Error) => void } | null = null;
  private pendingScan: { resolve: (r: WarmScanResult) => void; reject: (e: Error) => void } | null = null;
  private pendingScanDiff: { resolve: (r: { report: any; stats: any }) => void; reject: (e: Error) => void } | null = null;
  private pendingPong: { resolve: () => void; reject: (e: Error) => void } | null = null;
  private caps: { cache: boolean; stream: boolean; maxWorkers: number; diff?: boolean } | null = null;

  constructor(readonly root: string, readonly projectHash: string = projectHashFor(root)) {}

  /** Look up the registry + connect + handshake. Rejects on ANY failure (→ caller degrades). */
  connect(timeoutMs: number = CONNECT_TIMEOUT_MS): Promise<void> {
    return new Promise((resolve, reject) => {
      const registry = readRegistry(this.projectHash);
      if (!registry) {
        reject(new Error('NO_DAEMON: no daemon registry for project'));
        return;
      }
      if (registry.protocol !== PROTOCOL_VERSION) {
        reject(new Error(`VERSION_DRIFT: daemon protocol ${registry.protocol} != client ${PROTOCOL_VERSION}`));
        return;
      }
      this.registry = registry;

      const socket = net.connect(registry.pipe);
      this.socket = socket;
      let settled = false;
      const fail = (e: Error) => {
        if (settled) return;
        settled = true;
        try {
          socket.destroy();
        } catch {
          /* ignore */
        }
        reject(e);
      };

      const timer = setTimeout(() => fail(new Error(`CONNECT_TIMEOUT after ${timeoutMs}ms`)), timeoutMs);

      socket.on('connect', () => {
        // Connected — start the hello handshake.
        this.pendingHello = {
          resolve: (ack) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve();
          },
          reject: fail,
        };
        this.send({ v: 1, id: ++this.nextId, type: 'hello', version: PROTOCOL_SOFTWARE_VERSION, protocol: PROTOCOL_VERSION, projectHash: this.projectHash });
        // Handshake deadline (in addition to the connect deadline).
        setTimeout(() => {
          if (!settled) fail(new Error('HANDSHAKE_TIMEOUT'));
        }, HANDSHAKE_TIMEOUT_MS);
      });

      socket.on('data', (chunk: Buffer) => this.onData(chunk.toString('utf8')));
      socket.on('error', (e) => {
        if (!settled) fail(new Error(`CONNECT_ERROR: ${e.message}`));
        // Mid-scan daemon crash: reject any in-flight request so the caller degrades to cold.
        if (this.pendingScan) {
          this.pendingScan.reject(new Error(`DAEMON_DISCONNECT: ${e.message}`));
          this.pendingScan = null;
        }
        if (this.pendingScanDiff) {
          this.pendingScanDiff.reject(new Error(`DAEMON_DISCONNECT: ${e.message}`));
          this.pendingScanDiff = null;
        }
        if (this.pendingPong) {
          this.pendingPong.reject(new Error(`DAEMON_DISCONNECT: ${e.message}`));
          this.pendingPong = null;
        }
      });
      socket.on('close', () => {
        if (!settled) fail(new Error('CONNECTION_CLOSED'));
        if (this.pendingScan) {
          this.pendingScan.reject(new Error('DAEMON_DISCONNECT: connection closed before scan_done'));
          this.pendingScan = null;
        }
        if (this.pendingScanDiff) {
          this.pendingScanDiff.reject(new Error('DAEMON_DISCONNECT: connection closed before scan_done'));
          this.pendingScanDiff = null;
        }
        if (this.pendingPong) {
          this.pendingPong.reject(new Error('DAEMON_DISCONNECT: connection closed'));
          this.pendingPong = null;
        }
      });
    });
  }

  /** Run one warm scan. Must be connected first. Rejects on daemon error/timeout/close. */
  scan(config: ScanConfig, options: { cache: boolean; cacheDir?: string; cacheCustom?: boolean; workers?: number; parser?: string }): Promise<WarmScanResult> {
    return new Promise((resolve, reject) => {
      if (!this.socket || this.socket.destroyed) {
        reject(new Error('NOT_CONNECTED'));
        return;
      }
      const requestId = `r${++this.nextId}`;
      const id = this.nextId;
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error('SCAN_TIMEOUT'));
        }
      }, SCAN_TIMEOUT_MS);
      this.pendingScan = {
        resolve: (r) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(r);
        },
        reject: (e) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(e);
        },
      };
      this.send({
        v: 1,
        id,
        type: 'scan',
        params: {
          requestId,
          config: config as unknown as Record<string, any>,
          options: {
            cache: options.cache,
            cacheDir: options.cacheDir,
            cacheCustom: options.cacheCustom,
            workers: options.workers,
            parser: options.parser,
          },
        },
      });
    });
  }

  /** Whether the connected daemon advertised the `diff` capability (old daemons don't). */
  hasDiffCap(): boolean {
    return !!(this.caps && this.caps.diff === true);
  }

  /** Run one diff scan (scanDiff / scanDiffDelta). Must be connected first. */
  scanDiff(
    config: ScanConfig,
    diffs: Array<Record<string, any>>,
    options: { cache: boolean; cacheDir?: string; cacheCustom?: boolean; workers?: number; parser?: string; verifyDiskContent: boolean; delta: boolean },
  ): Promise<{ report: any; stats: any }> {
    return new Promise((resolve, reject) => {
      if (!this.socket || this.socket.destroyed) {
        reject(new Error('NOT_CONNECTED'));
        return;
      }
      const requestId = `r${++this.nextId}`;
      const id = this.nextId;
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error('SCAN_TIMEOUT'));
        }
      }, SCAN_TIMEOUT_MS);
      this.pendingScanDiff = {
        resolve: (r) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(r);
        },
        reject: (e) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(e);
        },
      };
      this.send({
        v: 1,
        id,
        type: 'scan_diff',
        params: {
          requestId,
          config: config as unknown as Record<string, any>,
          diffs,
          options: {
            cache: options.cache,
            cacheDir: options.cacheDir,
            cacheCustom: options.cacheCustom,
            workers: options.workers,
            parser: options.parser,
            verifyDiskContent: options.verifyDiskContent,
            delta: options.delta,
          },
        },
      });
    });
  }

  /** Ping the daemon (status command). Rejects when not running / no response. */
  ping(timeoutMs: number = 1000): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.socket || this.socket.destroyed) {
        reject(new Error('NOT_CONNECTED'));
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
        reject: (e) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(e);
        },
      };
      this.send({ v: 1, id: ++this.nextId, type: 'ping' });
    });
  }

  /** Ask the daemon to shut down (daemon stop). Best-effort. */
  shutdown(): void {
    try {
      this.send({ v: 1, id: ++this.nextId, type: 'shutdown', reason: 'client-request' });
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
      this.socket?.destroy();
    } catch {
      /* ignore */
    }
    this.socket = null;
  }

  private send(msg: Record<string, any>): void {
    if (!this.socket || this.socket.destroyed) throw new Error('NOT_CONNECTED');
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

  private onMessage(msg: DaemonMessage): void {
    switch (msg.type) {
      case 'hello_ack':
        if (msg.protocol !== PROTOCOL_VERSION || msg.version !== PROTOCOL_SOFTWARE_VERSION) {
          this.pendingHello?.reject(
            new Error(`VERSION_DRIFT: daemon ${msg.version}/p${msg.protocol} != client ${PROTOCOL_SOFTWARE_VERSION}/p${PROTOCOL_VERSION}`),
          );
        } else {
          this.caps = msg.caps as any;
          this.pendingHello?.resolve(msg);
        }
        this.pendingHello = null;
        break;
      case 'scan_done':
        if (this.pendingScanDiff) {
          this.pendingScanDiff.resolve({ report: msg.report, stats: msg.stats });
          this.pendingScanDiff = null;
        } else if (this.pendingScan) {
          this.pendingScan.resolve({ report: msg.report as unknown as ScanReport, stats: msg.stats as unknown as WarmStats });
          this.pendingScan = null;
        }
        break;
      case 'error':
        if (msg.requestId) {
          if (this.pendingScanDiff) this.pendingScanDiff.reject(new Error(`DAEMON_ERROR(${msg.code}): ${msg.message}`));
          if (this.pendingScan) this.pendingScan.reject(new Error(`DAEMON_ERROR(${msg.code}): ${msg.message}`));
        }
        this.pendingScanDiff = null;
        this.pendingScan = null;
        break;
      case 'pong':
        this.pendingPong?.resolve();
        this.pendingPong = null;
        break;
      default:
        break;
    }
  }
}

/** One-shot convenience: connect + scan + close. Returns null when the daemon is unusable. */
export async function tryWarmScan(
  root: string,
  config: ScanConfig,
  options: { cache: boolean; cacheDir?: string; cacheCustom?: boolean; workers?: number; parser?: string },
): Promise<WarmScanResult | null> {
  const client = new DaemonClient(root);
  try {
    await client.connect();
    const result = await client.scan(config, options);
    client.close();
    return result;
  } catch {
    client.close();
    return null;
  }
}

/**
 * One-shot diff scan. Returns null when the daemon is unusable OR lacks the `diff` capability
 * (old daemon → the caller degrades to an in-process diff scan, never errors).
 */
export async function tryWarmScanDiff(
  root: string,
  config: ScanConfig,
  diffs: Array<Record<string, any>>,
  options: { cache: boolean; cacheDir?: string; cacheCustom?: boolean; workers?: number; parser?: string; verifyDiskContent: boolean; delta: boolean },
): Promise<{ report: any; stats: any } | null> {
  const client = new DaemonClient(root);
  try {
    await client.connect();
    if (!client.hasDiffCap()) {
      client.close();
      return null;
    }
    const result = await client.scanDiff(config, diffs, options);
    client.close();
    return result;
  } catch {
    client.close();
    return null;
  }
}
