import * as child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { projectHashFor, readRegistry, clearRegistry } from '../daemon/registry';
import { DaemonClient } from '../daemon/client';

/**
 * Module: CLI — Daemon Lifecycle Commands
 * File Path: src/cli/daemonCmd.ts
 * Architecture Role: CLI adapter over the daemon registry and IPC client; each subcommand maps
 *                     to a daemon lifecycle operation (spawn, shutdown, or health probe).
 * Dependencies & Triggers: Top-level CLI dispatch for `auto-refactor daemon start|stop|status`;
 *                     depends on `../daemon/registry` (project hash, read/clear) and
 *                     `../daemon/client` (connect/ping/shutdown), plus child_process, fs, path.
 * Responsibilities: start launches/reuses a detached daemon and probes registry+ping; stop
 *                     requests shutdown and clears registry state; status reports RUNNING/
 *                     NOT RUNNING/STALE; ensureDaemon offers a `--daemon` readiness probe.
 * Exit Semantics & Design Rationale: Returns a structured `{ code, text }` result instead of
 *                     calling process.exit, so 0 success, 1 failure/not ready/stale, and 2
 *                     unknown subcommand or missing built server stay composable and testable;
 *                     the top-level CLI owns final output/process-exit mapping. stop treats an
 *                     unreachable daemon as already stopped so stale registries cannot wedge CI.
 *
 * Usage:
 *   start: spawn a detached server for --root/cwd, wait for registry + ping, report status.
 *   stop: ask the running daemon to shut down and clear its registry.
 *   status: read the registry, ping the daemon, report pid/pipe/uptime or "not running".
 *   Docs: docs/01-architecture/02-pipeline-and-caching.md §A4.2
 */

/** Timeout for connect/ping probes against an already-registered daemon, in milliseconds. */
const DAEMON_PROBE_TIMEOUT_MS = 300;

/** Number of 100 ms polls used to wait for a freshly spawned daemon to publish its registry. */
const DAEMON_START_MAX_ATTEMPTS = 50;

/** Number of 100 ms polls used to wait for a stopped daemon to clear its registry. */
const DAEMON_STOP_MAX_ATTEMPTS = 30;

/** Poll interval between daemon registry/readiness checks, in milliseconds. */
const DAEMON_POLL_INTERVAL_MS = 100;

/** Milliseconds in one second; converts the registry start timestamp into uptime seconds. */
const MS_PER_SECOND = 1000;

/** Connect/ping timeout for start/stop/status lifecycle commands, in milliseconds. */
const DAEMON_LIFECYCLE_TIMEOUT_MS = 500;

/**
 * Structured outcome of a daemon lifecycle subcommand.
 * `code` is the process exit code the top-level CLI should return (0 success, 1 not ready or
 * stale, 2 usage error or missing build); `text` is the ready-to-print human-readable report.
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

/**
 * CLI entry for `auto-refactor daemon start|stop|status [--root DIR]`.
 * Subcommands run asynchronously and their results are awaited by the caller; `start` may
 * spawn a detached process, `stop` is idempotent for an already-stopped daemon, and an
 * unknown subcommand returns code 2 without probing anything.
 *
 * @param argv - Arguments after `daemon`; `argv[0]` selects the subcommand, defaulting to status.
 * @returns The subcommand outcome carrying the process code the top-level CLI should exit with.
 */
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
 * The async probe awaits start plus a ping and is idempotent for a live daemon: an existing
 * healthy registry entry is reused instead of spawning another server. It returns true once a
 * daemon answers, and false otherwise so the caller can degrade to an in-process scan.
 *
 * @param root - Workspace root whose project hash keys the daemon registry entry.
 * @returns True once a daemon answers a ping; false when startup or registration fails.
 */
export async function ensureDaemon(root: string): Promise<boolean> {
    const projectHash = projectHashFor(root);
    const res = await startDaemon(root, projectHash);
    return res.code === 0;
}

/**
 * Spawn or reuse the daemon for `root` and await registry visibility plus a ping.
 * An existing registry entry is probed first; a dead one is cleared before starting fresh.
 *
 * @param root - Workspace root passed to the detached server process.
 * @param projectHash - Registry key derived from `root`.
 * @returns The lifecycle result, with code 2 when the built server file is missing.
 */
async function startDaemon(root: string, projectHash: string): Promise<DaemonCliResult> {
    const existing = readRegistry(projectHash);
    if (existing) {
        const probe = new DaemonClient(root, projectHash);
        try {
            await probe.connect(DAEMON_PROBE_TIMEOUT_MS);
            await probe.ping(DAEMON_PROBE_TIMEOUT_MS);
            probe.close();
            return {
                code: 0,
                text: `daemon already running (pid ${existing.pid}, pipe ${existing.pipe})`,
            };
        } catch {
            // Registry exists but the process is dead — stale entry; proceed to start fresh.
            clearRegistry(projectHash);
        }
    }

    const serverJs = serverJsPath();
    if (!fs.existsSync(serverJs)) {
        return {
            code: 2,
            text: `daemon server not found: ${serverJs} (build first: npm run build)`,
        };
    }
    const child = child_process.spawn(process.execPath, [serverJs, '--root', root], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
    });
    child.unref();

    // Wait for the registry + a successful ping (up to ~5s).
    for (let i = 0; i < DAEMON_START_MAX_ATTEMPTS; i++) {
        await sleep(DAEMON_POLL_INTERVAL_MS);
        const reg = readRegistry(projectHash);
        if (reg) {
            const probe = new DaemonClient(root, projectHash);
            try {
                await probe.connect(DAEMON_LIFECYCLE_TIMEOUT_MS);
                await probe.ping(DAEMON_LIFECYCLE_TIMEOUT_MS);
                probe.close();
                return { code: 0, text: `daemon started (pid ${reg.pid}, pipe ${reg.pipe})` };
            } catch {
                /* Expected: not ready yet — keep polling */
            }
        }
    }
    return { code: 1, text: `daemon failed to become ready within 5s (root=${root})` };
}

/**
 * Ask the daemon for `root` to shut down and await registry cleanup.
 * An unreachable daemon is treated as already stopped, and its stale registry entry is cleared.
 *
 * @param root - Workspace root used to build the IPC client.
 * @param projectHash - Registry key derived from `root`.
 * @returns A success result whether or not a live daemon was reachable.
 */
async function stopDaemon(root: string, projectHash: string): Promise<DaemonCliResult> {
    const reg = readRegistry(projectHash);
    if (!reg) {
        return { code: 0, text: 'daemon not running (no registry)' };
    }
    const client = new DaemonClient(root, projectHash);
    try {
        await client.connect(DAEMON_LIFECYCLE_TIMEOUT_MS);
        client.shutdown();
        // Give it a moment to exit + clear its registry.
        for (let i = 0; i < DAEMON_STOP_MAX_ATTEMPTS; i++) {
            await sleep(DAEMON_POLL_INTERVAL_MS);
            if (!readRegistry(projectHash)) break;
        }
        clearRegistry(projectHash);
        return { code: 0, text: `daemon stopped (was pid ${reg.pid})` };
    } catch (e) {
        // Daemon unreachable — treat as stopped (stale registry).
        clearRegistry(projectHash);
        return {
            code: 0,
            text: `daemon not reachable (${e instanceof Error ? e.message : String(e)}); registry cleared`,
        };
    } finally {
        client.close();
    }
}

/**
 * Probe the registered daemon for `root` and await a ping to classify it as running or stale.
 * Reports code 1 when no registry entry exists or the registered process no longer answers.
 *
 * @param root - Workspace root used to build the IPC client.
 * @param projectHash - Registry key derived from `root`.
 * @returns The status text plus code 0 for RUNNING and 1 for NOT RUNNING or STALE.
 */
async function statusDaemon(root: string, projectHash: string): Promise<DaemonCliResult> {
    const reg = readRegistry(projectHash);
    if (!reg) {
        return { code: 1, text: `daemon: NOT RUNNING (root=${root})` };
    }
    const client = new DaemonClient(root, projectHash);
    try {
        await client.connect(DAEMON_LIFECYCLE_TIMEOUT_MS);
        await client.ping(DAEMON_LIFECYCLE_TIMEOUT_MS);
        const uptimeSec = Math.max(
            0,
            Math.round((Date.now() - new Date(reg.startedAt).getTime()) / MS_PER_SECOND),
        );
        client.close();
        return {
            code: 0,
            text: `daemon: RUNNING (pid ${reg.pid}, pipe ${reg.pipe}, uptime ${uptimeSec}s, v${reg.version} p${reg.protocol}, log ${reg.logFile})`,
        };
    } catch {
        client.close();
        return {
            code: 1,
            text: `daemon: STALE (registry pid ${reg.pid} but not responding; run "daemon stop" or "daemon start")`,
        };
    }
}
