import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { sha256Hex } from '../core/cacheKey';

/**
 * Module: Daemon — Per-Project Discovery Registry
 * File Path: src/daemon/registry.ts
 * Architecture Role: Discovery adapter mapping one canonical project root to one daemon
 *   endpoint; the registry file is the sole rendezvous point for CLI clients
 *   (docs/01-architecture/02-pipeline-and-caching.md §A1.3).
 * Dependencies & Triggers: Node fs/os/path plus ../core/cacheKey (sha256Hex); triggered by
 *   `daemon start`, client connect, `daemon stop` and log-path resolution.
 * Responsibilities: Derive a stable 24-hex project hash from the resolved root, compute the
 *   user-scoped registry dir and per-project daemon registry file path, build the
 *   sanitized named-pipe or Unix-socket endpoint, and read/write/clear metadata
 *   (pid, pipe, versions, log file).
 * Exit Semantics & Design Rationale: Every I/O is best-effort and never throws - writes use an
 *   atomic tmp+rename, reads return null for missing/corrupt/stale-format files so callers fall
 *   back to a cold scan, and clear falls back to a rename when rmSync is blocked by a Windows
 *   lock. Keeping this metadata-only (business caches stay in the project) lets stale state heal.
 *
 * Layout: one daemon instance serves ONE project; the registry holds daemon metadata only.
 *   win32: %LOCALAPPDATA%\auto-refactor\daemon-*.json, where * is the 24-hex project hash
 *   posix: ~/.cache/auto-refactor/daemon-*.json
 * Business caches live in the project itself (.auto-refactor-cache, pipeline doc §B3).
 */

/** Number of hex characters retained from the SHA-256 project root hash. */
const PROJECT_HASH_LENGTH = 24;

/** Maximum sanitized OS user-name length embedded in a Windows named pipe. */
const PIPE_USER_MAX_LENGTH = 32;

/** Radix used to encode the random suffix in registry temp/stale file names. */
const RANDOM_SUFFIX_RADIX = 36;

/** Exclusive end index of the random suffix in a `0.<base36>` temp-file token. */
const TMP_SUFFIX_END_INDEX = 8;

/** Exclusive end index of the random suffix in a `0.<base36>` stale-file token. */
const STALE_SUFFIX_END_INDEX = 6;

/**
 * Daemon rendezvous metadata persisted per project. The record is only a hint: callers must
 * probe the advertised endpoint before trusting it, and any read that fails shape validation
 * falls back to a cold scan.
 */
export interface RegistryInfo {
    /** OS process id of the daemon, probed by clients to confirm liveness. */
    pid: number;
    /** Platform-native IPC endpoint the daemon listens on (named pipe or Unix socket). */
    pipe: string;
    /** ISO-8601 start timestamp; diagnostics only, never used for liveness checks. */
    startedAt: string;
    /** Package/daemon version label, surfaced by daemon status for operator triage. */
    version: string;
    /** Numeric IPC protocol revision advertised to clients as the wire generation. */
    protocol: number;
    /** Absolute path of the daemon log file, surfaced by daemon status. */
    logFile: string;
}

/**
 * Derive the daemon's project identity: the first 24 hex chars of the SHA-256 hash of the
 * resolved absolute root path. Different spellings of one directory (relative vs absolute)
 * therefore collapse to a single registry entry.
 *
 * @param root - Project root supplied by the caller; resolved against the process cwd and
 *   normalized before hashing.
 * @returns Stable 24-hex identity used in registry file names and endpoint names.
 */
export function projectHashFor(root: string): string {
    const abs = path.resolve(root);
    return sha256Hex(abs).slice(0, PROJECT_HASH_LENGTH);
}

/**
 * Resolve the per-user directory holding daemon registries and logs. This is control-plane
 * state only; project business caches stay under the project root.
 *
 * @returns Absolute platform-specific directory path; the directory is not created here.
 */
export function registryDir(): string {
    if (process.platform === 'win32') {
        const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
        return path.join(local, 'auto-refactor');
    }
    return path.join(os.homedir(), '.cache', 'auto-refactor');
}

/**
 * Build the metadata file path for one project's daemon.
 *
 * @param projectHash - 24-hex project identity produced by projectHashFor.
 * @returns Absolute registry JSON path; existence is not checked.
 */
export function registryPath(projectHash: string): string {
    return path.join(registryDir(), `daemon-${projectHash}.json`);
}

/**
 * Sanitize the OS user name for embedding in a Windows named-pipe path. Characters outside
 * `[A-Za-z0-9._-]` become `_` and the token is capped at 32 chars; the result is never empty.
 *
 * @returns Pipe-safe user token, or 'user' when the environment exposes no usable name.
 */
export function pipeUser(): string {
    const raw =
        process.env.USERNAME ||
        process.env.USER ||
        (os.userInfo && os.userInfo().username) ||
        'user';
    return raw.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, PIPE_USER_MAX_LENGTH) || 'user';
}

/**
 * Derive the IPC endpoint this project's daemon should listen on: a Windows named pipe or a
 * POSIX Unix-domain socket under XDG_RUNTIME_DIR / the OS temp dir. The address is stable for
 * a given (user token, project hash) pair and is not probed for liveness.
 *
 * Windows endpoints are named pipes built from the sanitized user token and project hash;
 * POSIX endpoints are Unix socket files named from the project hash under XDG_RUNTIME_DIR or
 * os.tmpdir(). Node's `net` module speaks both APIs, but AF_UNIX sockets are not usable on
 * Windows.
 *
 * @param projectHash - 24-hex project identity produced by projectHashFor.
 * @returns Platform-native endpoint string accepted by Node's `net` module.
 */
export function pipeNameFor(projectHash: string): string {
    if (process.platform === 'win32') {
        return `\\\\.\\pipe\\auto-refactor-warmscan-${pipeUser()}-${projectHash}`;
    }
    const base = process.env.XDG_RUNTIME_DIR || os.tmpdir();
    return path.join(base, `auto-refactor-warmscan-${projectHash}.sock`);
}

/**
 * Persist the daemon rendezvous record with an atomic tmp-file + rename, so readers never
 * observe a partially written JSON document. Best-effort by contract: any filesystem failure
 * is swallowed and clients simply degrade to a cold scan.
 *
 * @param projectHash - 24-hex project identity produced by projectHashFor.
 * @param info - Full daemon metadata snapshot to publish.
 */
export function writeRegistry(projectHash: string, info: RegistryInfo): void {
    try {
        fs.mkdirSync(registryDir(), { recursive: true });
        const file = registryPath(projectHash);
        const tmp = `${file}.tmp-${process.pid}-${Math.random()
            .toString(RANDOM_SUFFIX_RADIX)
            .slice(2, TMP_SUFFIX_END_INDEX)}`;
        fs.writeFileSync(tmp, JSON.stringify(info, null, 2), 'utf8');
        fs.renameSync(tmp, file);
    } catch {
        /* Best-effort: registry write failure is non-fatal (client degrades to cold) */
    }
}

/**
 * Read and minimally validate the daemon rendezvous record. Missing files, malformed JSON, and
 * records lacking numeric `pid`/`protocol` or a string `pipe` all mean "no daemon": failing
 * soft lets callers fall back to a cold scan instead of aborting.
 *
 * @param projectHash - 24-hex project identity produced by projectHashFor.
 * @returns Parsed metadata, or null when the record is absent, unreadable, or shape-invalid.
 */
export function readRegistry(projectHash: string): RegistryInfo | null {
    try {
        const raw = fs.readFileSync(registryPath(projectHash), 'utf8');
        const o = JSON.parse(raw);
        if (
            o &&
            typeof o.pid === 'number' &&
            typeof o.pipe === 'string' &&
            typeof o.protocol === 'number'
        ) {
            return o as RegistryInfo;
        }
        return null;
    } catch {
        return null;
    }
}

/**
 * Best-effort removal of the daemon rendezvous record, called on graceful stop or shutdown. If
 * `rmSync` is blocked (for example by a Windows file lock or a read-only directory), the record
 * is renamed aside so subsequent reads still see "no daemon" and the next start self-heals.
 *
 * @param projectHash - 24-hex project identity produced by projectHashFor.
 */
export function clearRegistry(projectHash: string): void {
    const file = registryPath(projectHash);
    try {
        fs.rmSync(file, { force: true });
    } catch {
        // rmSync can be blocked (Windows file-lock, a safe-delete guard, or a read-only dir).
        // A renamed-away registry is as good as a deleted one: the next readRegistry() returns
        // null and the next daemon start self-heals by writing a fresh registry.
        try {
            const stale = `${file}.stale-${Date.now()}-${Math.random()
                .toString(RANDOM_SUFFIX_RADIX)
                .slice(2, STALE_SUFFIX_END_INDEX)}`;
            fs.renameSync(file, stale);
        } catch {
            /* ignore */
        }
    }
}

/**
 * Resolve the log destination a daemon instance should write to: PROJECTHASH-daemon.log inside
 * the directory returned by registryDir(). The logging layer creates the file lazily; this
 * helper only computes the path.
 *
 * @param projectHash - 24-hex project identity produced by projectHashFor.
 * @returns Absolute log-file path under the directory returned by registryDir.
 */
export function logFilePath(projectHash: string): string {
    return path.join(registryDir(), `${projectHash}-daemon.log`);
}
