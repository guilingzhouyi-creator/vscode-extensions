import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { sha256Hex } from '../core/cacheKey';

/**
 * Daemon discovery registry (docs/01-architecture/02-pipeline-and-caching.md §A1.3).
 *
 * One daemon instance serves ONE project (identified by a hash of the canonical root path).
 * Its endpoint + pid are recorded in a per-project registry file so any CLI process can find
 * it without scanning the process table:
 *
 *   win32: %LOCALAPPDATA%\auto-refactor\daemon-<projectHash>.json
 *   posix: ~/.cache/auto-refactor/daemon-<projectHash>.json
 *
 * The registry only ever holds daemon metadata (pid/pipe/startedAt/version/protocol/logFile) —
 * business caches live in the project itself (.auto-refactor-cache, docs/01-architecture/02-pipeline-and-caching.md §B3).
 */

export interface RegistryInfo {
  pid: number;
  pipe: string;
  startedAt: string;
  version: string;
  protocol: number;
  logFile: string;
}

/** Hash of the canonical absolute root path — the daemon's project identity. */
export function projectHashFor(root: string): string {
  const abs = path.resolve(root);
  return sha256Hex(abs).slice(0, 24);
}

/** User-scoped cache directory for daemon registries/logs (NOT business cache). */
export function registryDir(): string {
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(local, 'auto-refactor');
  }
  return path.join(os.homedir(), '.cache', 'auto-refactor');
}

export function registryPath(projectHash: string): string {
  return path.join(registryDir(), `daemon-${projectHash}.json`);
}

/** Sanitize the OS user name for embedding in a named-pipe path (no backslashes/spaces). */
export function pipeUser(): string {
  const raw =
    process.env.USERNAME ||
    process.env.USER ||
    (os.userInfo && os.userInfo().username) ||
    'user';
  return raw.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 32) || 'user';
}

/**
 * Endpoint path for this project's daemon.
 *   win32: named pipe  \\.\pipe\auto-refactor-warmscan-<user>-<projectHash>
 *   posix: Unix socket $XDG_RUNTIME_DIR|os.tmpdir()/auto-refactor-warmscan-<projectHash>.sock
 * (Node `net` speaks both through the same API; AF_UNIX is NOT usable on Windows.)
 */
export function pipeNameFor(projectHash: string): string {
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\auto-refactor-warmscan-${pipeUser()}-${projectHash}`;
  }
  const base = process.env.XDG_RUNTIME_DIR || os.tmpdir();
  return path.join(base, `auto-refactor-warmscan-${projectHash}.sock`);
}

/** Write the registry (atomic tmp+rename). Best-effort: never throws. */
export function writeRegistry(projectHash: string, info: RegistryInfo): void {
  try {
    fs.mkdirSync(registryDir(), { recursive: true });
    const file = registryPath(projectHash);
    const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
    fs.writeFileSync(tmp, JSON.stringify(info, null, 2), 'utf8');
    fs.renameSync(tmp, file);
  } catch {
    /* registry write failure is non-fatal (client degrades to cold) */
  }
}

/** Read the registry; returns null when missing/corrupt/stale-format. */
export function readRegistry(projectHash: string): RegistryInfo | null {
  try {
    const raw = fs.readFileSync(registryPath(projectHash), 'utf8');
    const o = JSON.parse(raw);
    if (o && typeof o.pid === 'number' && typeof o.pipe === 'string' && typeof o.protocol === 'number') {
      return o as RegistryInfo;
    }
    return null;
  } catch {
    return null;
  }
}

/** Remove the registry (daemon stop / graceful exit). Best-effort. */
export function clearRegistry(projectHash: string): void {
  const file = registryPath(projectHash);
  try {
    fs.rmSync(file, { force: true });
  } catch {
    // rmSync can be blocked (Windows file-lock, a safe-delete guard, or a read-only dir).
    // A renamed-away registry is as good as a deleted one: the next readRegistry() returns
    // null and the next daemon start self-heals by writing a fresh registry.
    try {
      const stale = `${file}.stale-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      fs.renameSync(file, stale);
    } catch {
      /* ignore */
    }
  }
}

/** Log file path for a daemon instance (registryDir/<projectHash>-daemon.log). */
export function logFilePath(projectHash: string): string {
  return path.join(registryDir(), `${projectHash}-daemon.log`);
}
