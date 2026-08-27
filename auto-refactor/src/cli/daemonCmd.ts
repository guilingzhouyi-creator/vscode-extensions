import * as child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { projectHashFor, readRegistry, clearRegistry, pipeNameFor } from '../daemon/registry';
import { DaemonClient } from '../daemon/client';

/**
 * `auto-refactor daemon start|stop|status` (docs/warm-scan-design.md §A4.2).
 *
 *   start  — spawn a detached daemon server process for --root (or cwd), wait until it is
 *            registered + answering ping, then print status.
 *   stop   — ask the running daemon to shut down (via shutdown message) + clear registry.
 *   status — read the registry, ping the daemon, print pid/pipe/uptime or "not running".
 */

export interface DaemonCliResult {
  code: number;
  text: string;
}

function serverJsPath(): string {
  return path.join(__dirname, '..', 'daemon', 'server.js');
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** CLI entry: `auto-refactor daemon start|stop|status [--root <dir>]`. */
export async function daemonCommand(argv: string[]): Promise<DaemonCliResult> {
  const sub = argv[0] || 'status';
  const rootIdx = argv.indexOf('--root');
  const root = rootIdx >= 0 && argv[rootIdx + 1] ? argv[rootIdx + 1] : process.cwd();
  const projectHash = projectHashFor(root);

  if (sub === 'start') {
    return startDaemon(root, projectHash);
  }
  if (sub === 'stop') {
    return stopDaemon(root, projectHash);
  }
  if (sub === 'status') {
    return statusDaemon(root, projectHash);
  }
  return { code: 2, text: `unknown daemon subcommand "${sub}" (expected start|stop|status)` };
}

/**
 * Ensure a daemon is running for `root` (used by CLI `--daemon` and `scanWarm({daemon:'on'})`).
 * Returns true when a daemon answers ping after start/probe, false otherwise (caller degrades).
 */
export async function ensureDaemon(root: string): Promise<boolean> {
  const projectHash = projectHashFor(root);
  const res = await startDaemon(root, projectHash);
  return res.code === 0;
}

async function startDaemon(root: string, projectHash: string): Promise<DaemonCliResult> {
  const existing = readRegistry(projectHash);
  if (existing) {
    const probe = new DaemonClient(root, projectHash);
    try {
      await probe.connect(300);
      await probe.ping(300);
      probe.close();
      return { code: 0, text: `daemon already running (pid ${existing.pid}, pipe ${existing.pipe})` };
    } catch {
      // Registry exists but the process is dead — stale entry; proceed to start fresh.
      clearRegistry(projectHash);
    }
  }

  const serverJs = serverJsPath();
  if (!fs.existsSync(serverJs)) {
    return { code: 2, text: `daemon server not found: ${serverJs} (build first: npm run build)` };
  }
  const child = child_process.spawn(process.execPath, [serverJs, '--root', root], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();

  // Wait for the registry + a successful ping (up to ~5s).
  for (let i = 0; i < 50; i++) {
    await sleep(100);
    const reg = readRegistry(projectHash);
    if (reg) {
      const probe = new DaemonClient(root, projectHash);
      try {
        await probe.connect(500);
        await probe.ping(500);
        probe.close();
        return { code: 0, text: `daemon started (pid ${reg.pid}, pipe ${reg.pipe})` };
      } catch {
        /* not ready yet — keep polling */
      }
    }
  }
  return { code: 1, text: `daemon failed to become ready within 5s (root=${root})` };
}

async function stopDaemon(root: string, projectHash: string): Promise<DaemonCliResult> {
  const reg = readRegistry(projectHash);
  if (!reg) {
    return { code: 0, text: 'daemon not running (no registry)' };
  }
  const client = new DaemonClient(root, projectHash);
  try {
    await client.connect(500);
    client.shutdown();
    // Give it a moment to exit + clear its registry.
    for (let i = 0; i < 30; i++) {
      await sleep(100);
      if (!readRegistry(projectHash)) break;
    }
    clearRegistry(projectHash);
    return { code: 0, text: `daemon stopped (was pid ${reg.pid})` };
  } catch (e) {
    // Daemon unreachable — treat as stopped (stale registry).
    clearRegistry(projectHash);
    return { code: 0, text: `daemon not reachable (${e instanceof Error ? e.message : String(e)}); registry cleared` };
  } finally {
    client.close();
  }
}

async function statusDaemon(root: string, projectHash: string): Promise<DaemonCliResult> {
  const reg = readRegistry(projectHash);
  if (!reg) {
    return { code: 1, text: `daemon: NOT RUNNING (root=${root})` };
  }
  const client = new DaemonClient(root, projectHash);
  try {
    await client.connect(500);
    await client.ping(500);
    const uptimeSec = Math.max(0, Math.round((Date.now() - new Date(reg.startedAt).getTime()) / 1000));
    client.close();
    return {
      code: 0,
      text: `daemon: RUNNING (pid ${reg.pid}, pipe ${reg.pipe}, uptime ${uptimeSec}s, v${reg.version} p${reg.protocol}, log ${reg.logFile})`,
    };
  } catch {
    client.close();
    return { code: 1, text: `daemon: STALE (registry pid ${reg.pid} but not responding; run "daemon stop" or "daemon start")` };
  }
}
