/**
 * Module: Core Engine — Two-Level Incremental Cache Store
 * File Path: src/core/cache.ts
 * Architecture Role: Local persistence adapter that owns the manifest, L1 fingerprint, L2
 *   result, and L3 path-index files plus their in-memory mirrors for warm scans.
 * Dependencies & Triggers: Imports `fs`, `path`, core `Issue`/`FileMetric` types,
 *   `TOOL_VERSION`, and cacheKey helpers (`CACHE_FORMAT_VERSION`, `sha256Hex`,
 *   `canonicalJson`, `l2Key`); constructed by the CLI/daemon when cache options are
 *   resolved and used by `Scanner.scanWithCache` and `Scanner.scanWithDiff`.
 * Responsibilities: Initialize the cache directory, probe writability, create/rebuild the
 *   manifest, load L1/L2/L3 with corrupt-line recovery and an L2 size guard, buffer writes,
 *   flush atomically via `.tmp` + rename, clear the store, lookup/write L1 and L2, maintain
 *   the fingerprint-keyed byPath index, namespace shared cache dirs per project, and run
 *   TTL/LRU trimming with `size()`/`dump()` diagnostics.
 * Exit Semantics & Design Rationale: The cache is strictly best-effort: unwritable dirs
 *   auto-disable it, bad manifests rebuild empty, corrupt lines are skipped, oversized
 *   result files are not loaded, `flush()` swallows write failures, and `clear()` returns
 *   false instead of throwing; atomic renames ensure a crash can lose only the newest
 *   entries, never corrupt older ones.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { Issue, FileMetric } from './types';
import { TOOL_VERSION } from './config';
import { CACHE_FORMAT_VERSION, sha256Hex, canonicalJson, l2Key } from './cache-key';

/**
 * Two-level incremental cache (docs/01-architecture/02-pipeline-and-caching.md Part B).
 *
 * Layout (project-local by default; `--cache-dir` overrides):
 *   <dir>/
 *     manifest.json      { formatVersion, toolVersion, createdAt, maxEntries, maxAgeDays }
 *     fingerprints.jsonl L1: {"t":"f","p":"src/a.ts","m":<mtimeMs>,"s":<size>,"i":<ino?>}
 *     results.jsonl      L2: {"t":"r","k":"v1:<fpHash>:<contentHash>","p":...,"issues":[...],
 *                       "metric":{...},"ts":<lastHitMs>}
 *
 * Semantics:
 *   - L1 hit = file unchanged (mtime+size, optional ino) → session results map reuse (0 reads).
 *   - L2 hit = content unchanged (sha256 of raw bytes) → cached issues/metric reuse.
 *   - Writes are buffered in memory and flushed ATOMICALLY (.tmp-<pid>-<rand> + rename);
 *     a crash can only lose the latest scan's entries, never corrupt prior ones.
 *   - Corrupt lines are skipped on load (recover); an invalid manifest triggers a full rebuild.
 *   - Unwritable directory ⇒ cache auto-disabled (every lookup misses, every write no-ops) so
 *     a read-only project never breaks the scan.
 */

/**
 * L1 identity tuple persisted for one file: modification time, size, and an optional inode.
 * The hit check compares mtimeMs and size; `ino` is retained for hosts that report it.
 */
export interface Fingerprint {
    /** Last-modification time in milliseconds since the Unix epoch. */
    mtimeMs: number;
    /** File size in bytes. */
    size: number;
    /** Platform inode number when available; absent means the host did not report one. */
    ino?: number;
}

/**
 * Cached analyzer output for one file: the issues found plus its aggregate metric.
 * `metric` is null when the producing scan did not request file metrics.
 */
export interface CachedResult {
    /** Issues emitted for the file, preserved in analyzer emission order. */
    issues: Issue[];
    /** Aggregate file metric, or null when metrics were not computed for this scan. */
    metric: FileMetric | null;
}

interface L2Entry {
    k: string;
    p: string;
    issues: Issue[];
    metric: FileMetric | null;
    ts: number;
    /** Write-time L1 fingerprint (mtimeMs/size) — the byPath index is keyed on it so a file
     *  modified-then-restored can never reuse a stale result. Optional on disk (back-compat). */
    fm?: number;
    fs?: number;
}

/**
 * Optional limits and kill switch for {@link CacheStore}. Every field is optional; the store
 * substitutes the documented defaults when a field is omitted.
 */
export interface CacheStoreOptions {
    /** Maximum L2 entries before lazy trim. Default 100_000. */
    maxEntries?: number;
    /** Maximum entry age in days before lazy trim. Default 30. */
    maxAgeDays?: number;
    /** Do not load L2 results into memory when results.jsonl exceeds this size (bytes). */
    maxL2LoadBytes?: number;
    /** Hard-disable the cache (no mkdir, no manifest, every lookup misses, writes no-op). */
    disabled?: boolean;
}

const DEFAULT_MAX_ENTRIES = 100_000;
const DEFAULT_MAX_AGE_DAYS = 30;
/** Number of bytes in one kibibyte (2^10); unit base for the L2 load-size cap. */
const BYTES_PER_KIB = 1024;
/** Number of kibibytes in one mebibyte (2^10); unit step for the L2 load-size cap. */
const KIB_PER_MIB = 1024;
/** Default maximum results.jsonl size to load into memory, expressed in mebibytes (64 MiB). */
const DEFAULT_MAX_L2_LOAD_MIB = 64;
const DEFAULT_MAX_L2_LOAD_BYTES = DEFAULT_MAX_L2_LOAD_MIB * BYTES_PER_KIB * KIB_PER_MIB;
/** Number of hexadecimal characters retained from SHA-256(abs(root)) for cache namespacing. */
const PROJECT_HASH_HEX_CHARS = 24;
/** Radix of the base-36 alphanumeric random suffix appended to atomic tmp file names. */
const RANDOM_STRING_RADIX = 36;
/**
 * Exclusive end index of the random suffix in `.tmp-<pid>-<rand>` file names
 * (6 characters starting at index 2).
 */
const TMP_SUFFIX_END_INDEX = 8;
/**
 * Exclusive end index of the random suffix in moved-aside cache directory names
 * (4 characters starting at index 2).
 */
const CACHE_CLEAR_SUFFIX_END_INDEX = 6;
/** Number of hours in a day, one factor of the `maxAgeDays` → milliseconds conversion. */
const HOURS_PER_DAY = 24;
/** Number of seconds in an hour, one factor of the `maxAgeDays` → milliseconds conversion. */
const SECONDS_PER_HOUR = 3600;
/** Number of milliseconds in a second, one factor of the `maxAgeDays` → milliseconds conversion. */
const MILLIS_PER_SECOND = 1000;

/** `typeof` tag for persisted string fields; corrupt-line guards on cache loads. */
const TYPEOF_STRING = 'string';

/** `typeof` tag for persisted numeric fields; corrupt-line guards on cache loads. */
const TYPEOF_NUMBER = 'number';

/**
 * Hash of the canonical root path — used to namespace shared --cache-dir targets.
 *
 * @param root - Project root path; resolved against the process cwd before hashing.
 * @returns First 24 hex characters of SHA-256(abs(root)), stable across runs on one machine.
 */
export function projectHashFor(root: string): string {
    const abs = path.resolve(root);
    return sha256Hex(abs).slice(0, PROJECT_HASH_HEX_CHARS);
}

/**
 * Best-effort two-level cache for warm scans: L1 fingerprints detect unchanged files without
 * reads, L2 results reuse previously computed issues/metrics, and L3 indexes L2 hits by path.
 * Lookups return null on a miss, corrupt records are skipped during load, and write/flush
 * failures degrade to a cache miss rather than surfacing to the caller.
 */
export class CacheStore {
    readonly dir: string;
    enabled: boolean;
    private readonly maxEntries: number;
    private readonly maxAgeDays: number;
    private readonly maxL2LoadBytes: number;
    /** L1: relPath -> fingerprint (in-memory mirror of fingerprints.jsonl). */
    private l1 = new Map<string, Fingerprint>();
    /** L2: l2key -> entry (in-memory mirror of results.jsonl). */
    private l2 = new Map<string, L2Entry>();
    /** L2-by-path index: `${fpHash}\u0000${relPath}` -> most-recent entry
     *  (fresh-process L1 hits). */
    private l2ByPath = new Map<string, L2Entry>();
    /** Pending L1 writes since last flush. */
    private dirtyL1 = new Map<string, Fingerprint>();
    /** Pending L2 writes since last flush. */
    private dirtyL2 = new Map<string, L2Entry>();
    private readonly manifestPath: string;
    private readonly fingerprintsPath: string;
    private readonly resultsPath: string;
    /** L3 index (`paths.jsonl`): persists the byPath map so a FRESH process can rebuild it
     *  without re-reading file contents (the design's "L1 hit = skip" across processes). */
    private readonly pathsPath: string;
    private loaded = false;

    /**
     * Open or create the cache at the resolved directory.
     *
     * @param dir - Cache directory; omitted selects the project-local .auto-refactor-cache dir.
     * @param root - Project root used for shared-dir namespacing and the default directory.
     * @param opts - Optional limits/kill switch; omitted fields use the documented defaults.
     */
    constructor(dir?: string, root?: string, opts: CacheStoreOptions = {}) {
        const projectRoot = root || process.cwd();
        const explicit = dir || path.join(projectRoot, '.auto-refactor-cache');
        // A shared --cache-dir (basename != .auto-refactor-cache) gets a per-project subdir.
        const isDefaultLayout = path.basename(path.resolve(explicit)) === '.auto-refactor-cache';
        this.dir = isDefaultLayout
            ? path.resolve(explicit)
            : path.join(path.resolve(explicit), projectHashFor(projectRoot));
        this.maxEntries = opts.maxEntries ?? DEFAULT_MAX_ENTRIES;
        this.maxAgeDays = opts.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS;
        this.maxL2LoadBytes = opts.maxL2LoadBytes ?? DEFAULT_MAX_L2_LOAD_BYTES;
        this.manifestPath = path.join(this.dir, 'manifest.json');
        this.fingerprintsPath = path.join(this.dir, 'fingerprints.jsonl');
        this.resultsPath = path.join(this.dir, 'results.jsonl');
        this.pathsPath = path.join(this.dir, 'paths.jsonl');
        if (opts.disabled === true) {
            this.enabled = false;
            return;
        }
        this.enabled = this.init();
        if (this.enabled) this.load();
    }

    /** Ensure the cache dir exists + manifest is valid. Returns false → auto-disable. */
    private init(): boolean {
        try {
            fs.mkdirSync(this.dir, { recursive: true });
        } catch {
            return false;
        }
        if (!this.probeWritable()) return false;
        return this.rebuildOrAdoptManifest();
    }

    /**
     * Verify the cache directory is writable, using a FIXED probe name so failed unlinks
     * (transient Windows file-lock) cannot accumulate per-pid files; the leftover 2-byte probe
     * is harmless and overwritten next init.
     *
     * @returns True when the probe write succeeded (cleanup is best-effort).
     */
    private probeWritable(): boolean {
        try {
            const probe = path.join(this.dir, '.probe');
            // Write first, clean up only after a successful write: a failed write must not spend a
            // syscall on cleanup, and the probe file is overwritten on the next init anyway.
            return this.writeProbe(probe) && this.removeProbe(probe);
        } catch {
            return false;
        }
    }

    /**
     * Write the fixed probe file.
     *
     * @param probe - Absolute probe path.
     * @returns True when the write succeeded.
     */
    private writeProbe(probe: string): boolean {
        try {
            fs.writeFileSync(probe, 'ok', 'utf8');
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Remove the probe file, best-effort.
     *
     * @param probe - Absolute probe path.
     * @returns Always true: a failed unlink must never fail the caller.
     */
    private removeProbe(probe: string): boolean {
        try {
            fs.rmSync(probe, { force: true });
        } catch {
            /* probe cleanup is best-effort */
        }
        return true;
    }

    /**
     * Read the manifest and adopt its limits, rebuilding it when absent, invalid or older-format
     * (an empty cache is never a correctness issue).
     *
     * @returns True once a usable manifest is in place.
     */
    private rebuildOrAdoptManifest(): boolean {
        try {
            const raw = fs.readFileSync(this.manifestPath, 'utf8');
            const m = JSON.parse(raw);
            if (
                m &&
                m.formatVersion === CACHE_FORMAT_VERSION &&
                typeof m.toolVersion === TYPEOF_STRING &&
                typeof m.maxEntries === TYPEOF_NUMBER &&
                typeof m.maxAgeDays === TYPEOF_NUMBER
            ) {
                return true;
            }
            this.rebuildManifest();
            return true;
        } catch {
            this.rebuildManifest();
            return true;
        }
    }

    private rebuildManifest(): void {
        const manifest = {
            formatVersion: CACHE_FORMAT_VERSION,
            toolVersion: TOOL_VERSION,
            createdAt: new Date().toISOString(),
            maxEntries: this.maxEntries,
            maxAgeDays: this.maxAgeDays,
        };
        this.writeFileAtomic(this.manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    }

    /** Load L1 + L2 from disk; corrupt lines are skipped and counted (never fatal). */
    private load(): void {
        if (this.loaded) return;
        this.loaded = true;
        this.loadFingerprints();
        this.loadResults();
        this.loadPaths();
    }

    private readLinesSafe(filePath: string): string[] {
        try {
            return fs.readFileSync(filePath, 'utf8').split('\n');
        } catch {
            return [];
        }
    }

    private loadFingerprints(): void {
        const lines = this.readLinesSafe(this.fingerprintsPath);
        for (const line of lines) {
            if (!line.trim()) continue;
            this.parseL1Line(line);
        }
    }

    private parseL1Line(line: string): void {
        try {
            const o = JSON.parse(line);
            if (!this.isValidL1(o)) return;
            this.l1.set(o.p, {
                mtimeMs: o.m,
                size: o.s,
                ino: typeof o.i === TYPEOF_NUMBER ? o.i : undefined,
            });
        } catch {
            /* Best-effort: skip corrupt line */
        }
    }

    private isValidL1(o: any): boolean {
        return Boolean(
            o &&
            o.t === 'f' &&
            typeof o.p === TYPEOF_STRING &&
            typeof o.m === TYPEOF_NUMBER &&
            typeof o.s === TYPEOF_NUMBER,
        );
    }

    private loadResults(): void {
        try {
            const st = fs.statSync(this.resultsPath);
            if (st.size > this.maxL2LoadBytes) return;
        } catch {
            return;
        }
        const lines = this.readLinesSafe(this.resultsPath);
        for (const line of lines) {
            if (!line.trim()) continue;
            this.parseL2Line(line);
        }
    }

    private parseL2Line(line: string): void {
        try {
            const o = JSON.parse(line);
            if (!this.isValidL2(o)) return;
            const entry: L2Entry = {
                k: o.k,
                p: o.p,
                issues: o.issues,
                metric: o.metric || null,
                ts: typeof o.ts === TYPEOF_NUMBER ? o.ts : 0,
                fm: typeof o.fm === TYPEOF_NUMBER ? o.fm : undefined,
                fs: typeof o.fs === TYPEOF_NUMBER ? o.fs : undefined,
            };
            this.l2.set(o.k, entry);
            this.indexL2ByPath(entry);
        } catch {
            /* Best-effort: skip corrupt line */
        }
    }

    private isValidL2(o: any): boolean {
        return Boolean(
            o &&
            o.t === 'r' &&
            typeof o.k === TYPEOF_STRING &&
            typeof o.p === TYPEOF_STRING &&
            Array.isArray(o.issues),
        );
    }

    private loadPaths(): void {
        const lines = this.readLinesSafe(this.pathsPath);
        for (const line of lines) {
            if (!line.trim()) continue;
            this.parsePathLine(line);
        }
    }

    private parsePathLine(line: string): void {
        try {
            const o = JSON.parse(line);
            if (!this.isValidPathEntry(o)) return;
            const e = this.l2.get(o.k);
            if (e) this.l2ByPath.set(o.pk, e);
        } catch {
            /* Best-effort: skip corrupt line */
        }
    }

    private isValidPathEntry(o: any): boolean {
        return Boolean(
            o && o.t === 'x' && typeof o.pk === TYPEOF_STRING && typeof o.k === TYPEOF_STRING,
        );
    }

    /** Atomic write: .tmp-<pid>-<rand> + rename (Windows MoveFileEx(REPLACE_EXISTING)). */
    private writeFileAtomic(file: string, data: string): void {
        const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(RANDOM_STRING_RADIX).slice(2, TMP_SUFFIX_END_INDEX)}`;
        fs.writeFileSync(tmp, data, 'utf8');
        try {
            fs.renameSync(tmp, file);
        } catch (e) {
            this.cleanupTmpFile(tmp);
            throw e;
        }
    }

    private cleanupTmpFile(tmp: string): void {
        try {
            fs.rmSync(tmp, { force: true });
        } catch {
            /* ignore */
        }
    }

    /**
     * L1 lookup by repo-relative path.
     *
     * @param relPath - Path as stored by writeL1, using the caller's normalized separators.
     * @returns The cached fingerprint, or null when unknown or the cache is disabled.
     */
    lookupL1(relPath: string): Fingerprint | null {
        if (!this.enabled) return null;
        return this.l1.get(relPath) || null;
    }

    /**
     * L2 lookup by (fpHash, contentHash). Returns cached issues+metric plus the relPath the
     * cached entry was originally computed for (`p`) — callers must remap path-embedded data
     * (issue ids / locations / metric.file) to the CURRENT file when p differs.
     *
     * @param fpHashValue - Fingerprint hash from the current cache-key derivation.
     * @param contentHash - SHA-256 hex digest of the file's raw bytes.
     * @returns Cached issues/metric plus the producing rel path, or null on a miss.
     */
    lookupL2(fpHashValue: string, contentHash: string): (CachedResult & { p: string }) | null {
        if (!this.enabled) return null;
        const key = l2Key(fpHashValue, contentHash);
        const e = this.l2.get(key);
        if (!e) return null;
        // Refresh the hit timestamp lazily (used by cleanup LRU/TTL trimming).
        const now = Date.now();
        if (now - e.ts > 60_000) {
            e.ts = now;
            this.dirtyL2.set(key, e);
        }
        return { issues: e.issues, metric: e.metric, p: e.p };
    }

    /**
     * Buffer an L1 fingerprint write; flush() persists it atomically.
     *
     * @param relPath - Repo-relative path whose fingerprint is being updated.
     * @param fp - Fingerprint observed for the file after this scan.
     */
    writeL1(relPath: string, fp: Fingerprint): void {
        if (!this.enabled) return;
        this.l1.set(relPath, fp);
        this.dirtyL1.set(relPath, fp);
    }

    /**
     * Buffer an L2 result write; flush() persists it atomically.
     *
     * @param fpHashValue - Fingerprint hash from the current cache-key derivation.
     * @param contentHash - SHA-256 hex digest of the file's raw bytes.
     * @param relPath - Repo-relative path the cached result belongs to.
     * @param result - Analyzer issues and metric produced for the file.
     * @param fp - Current L1 fingerprint; when absent the byPath index stores wildcards.
     */
    writeL2(
        fpHashValue: string,
        contentHash: string,
        relPath: string,
        result: CachedResult,
        fp?: Fingerprint,
    ): void {
        if (!this.enabled) return;
        const key = l2Key(fpHashValue, contentHash);
        const entry: L2Entry = {
            k: key,
            p: relPath,
            issues: result.issues,
            metric: result.metric,
            ts: Date.now(),
            fm: fp ? fp.mtimeMs : undefined,
            fs: fp ? fp.size : undefined,
        };
        this.l2.set(key, entry);
        this.dirtyL2.set(key, entry);
        this.indexL2ByPath(entry);
    }

    /** Maintain the `${fpHash}\u0000${relPath}\u0000${mtimeMs}\u0000${size}` → most-recent index.
     *  Keying on the write-time fingerprint is what makes the fast path safe: a file that was
     *  modified then restored has DIFFERENT fingerprints for the old and new results, so the
     *  L1-hit reuse can only match the result produced for the CURRENT file state. */
    private indexL2ByPath(entry: L2Entry): void {
        const pathKey = this.pathKeyFor(entry.k, entry.p, entry.fm, entry.fs);
        const existing = this.l2ByPath.get(pathKey);
        if (!existing || entry.ts >= existing.ts) this.l2ByPath.set(pathKey, entry);
    }

    /** Recover the fpHash half of an L2 key (`v1:<fpHash>:<contentHash>`). */
    private fpHashOfL2Key(k: string): string {
        const m = /^v1:([0-9a-f]+):[0-9a-f]+$/.exec(k);
        return m ? m[1] : '';
    }

    private pathKeyFor(l2key: string, relPath: string, mtimeMs?: number, size?: number): string {
        const fm = typeof mtimeMs === TYPEOF_NUMBER ? String(mtimeMs) : '*';
        const fs = typeof size === TYPEOF_NUMBER ? String(size) : '*';
        return `${this.fpHashOfL2Key(l2key)}\u0000${relPath}\u0000${fm}\u0000${fs}`;
    }

    /**
     * Fast L1-hit reuse for FRESH processes (no session): the L1 fingerprint proves the file
     * is unchanged since the last scan, so the L2 entry written for THIS exact fingerprint is
     * still valid — reuse it WITHOUT reading the file (0 disk reads, matching the design's
     * "L1 hit = skip"). Returns null when no entry exists for this (fpHash, fingerprint).
     *
     * @param fpHashValue - Fingerprint hash from the current cache-key derivation.
     * @param relPath - Repo-relative path to look up.
     * @param mtimeMs - Current mtime in milliseconds, one half of the L1 index key.
     * @param size - Current file size in bytes, the other half of the L1 index key.
     * @returns Cached issues/metric plus the producing rel path, or null on a miss.
     */
    lookupL2ByPath(
        fpHashValue: string,
        relPath: string,
        mtimeMs: number,
        size: number,
    ): (CachedResult & { p: string }) | null {
        if (!this.enabled) return null;
        const e = this.l2ByPath.get(`${fpHashValue}\u0000${relPath}\u0000${mtimeMs}\u0000${size}`);
        if (!e) return null;
        return { issues: e.issues, metric: e.metric, p: e.p };
    }

    /** Write pending L1/L2 entries to disk atomically. Best-effort: never throws upward. */
    flush(): void {
        if (!this.enabled) return;
        try {
            if (this.dirtyL1.size > 0 || this.dirtyL2.size > 0) {
                this.cleanupIfNeeded();
            }
            if (this.dirtyL1.size > 0) {
                this.writeFileAtomic(this.fingerprintsPath, this.serializeL1());
                this.dirtyL1.clear();
            }
            if (this.dirtyL2.size > 0) {
                this.writeFileAtomic(this.resultsPath, this.serializeL2());
                this.writeFileAtomic(this.pathsPath, this.serializePaths());
                this.dirtyL2.clear();
            }
        } catch {
            /* Best-effort: a cache write failure is never fatal — the scan stands on its own */
        }
    }

    /** L3: persist the per-rel byPath index (fpHash\u0000rel\u0000mtime\u0000size → l2 key). */
    private serializePaths(): string {
        const lines: string[] = [];
        for (const [pk, e] of this.l2ByPath) {
            lines.push(JSON.stringify({ t: 'x', pk, k: e.k }));
        }
        return lines.join('\n') + (lines.length ? '\n' : '');
    }

    private serializeL1(): string {
        const lines: string[] = [];
        for (const [p, fp] of this.l1) {
            const o: Record<string, any> = { t: 'f', p, m: fp.mtimeMs, s: fp.size };
            if (fp.ino !== undefined) o.i = fp.ino;
            lines.push(JSON.stringify(o));
        }
        return lines.join('\n') + (lines.length ? '\n' : '');
    }

    private serializeL2(): string {
        const lines: string[] = [];
        for (const e of this.l2.values()) {
            const o: Record<string, any> = {
                t: 'r',
                k: e.k,
                p: e.p,
                issues: e.issues,
                metric: e.metric,
                ts: e.ts,
            };
            if (e.fm !== undefined) o.fm = e.fm;
            if (e.fs !== undefined) o.fs = e.fs;
            lines.push(JSON.stringify(o));
        }
        return lines.join('\n') + (lines.length ? '\n' : '');
    }

    /** Lazy LRU+TTL trim: drop entries past maxAgeDays, then oldest-hit entries past maxEntries. */
    cleanupIfNeeded(): void {
        if (!this.enabled || this.l2.size <= this.maxEntries) return;
        if (this.maxAgeDays > 0) {
            const maxAgeMs = this.maxAgeDays * HOURS_PER_DAY * SECONDS_PER_HOUR * MILLIS_PER_SECOND;
            this.trimTtlEntries(Date.now(), maxAgeMs);
        }
        this.trimLruExcess();
    }

    private removeL2Entry(e: L2Entry): void {
        this.l2.delete(e.k);
        const pathKey = this.pathKeyFor(e.k, e.p, e.fm, e.fs);
        if (this.l2ByPath.get(pathKey) === e) {
            this.l2ByPath.delete(pathKey);
        }
    }

    private trimTtlEntries(now: number, maxAgeMs: number): void {
        for (const e of this.l2.values()) {
            if (now - e.ts > maxAgeMs) {
                this.removeL2Entry(e);
            }
        }
    }

    private trimLruExcess(): void {
        let excess = this.l2.size - this.maxEntries;
        if (excess <= 0) return;

        const sorted = [...this.l2.values()].sort((a, b) => a.ts - b.ts);
        for (const e of sorted) {
            if (excess <= 0) break;
            this.removeL2Entry(e);
            excess--;
        }
    }

    /**
     * Delete the whole cache directory (--cache-clear). Falls back to a same-volume rename when
     * rmSync is blocked (Windows file-lock or a sandbox bulk-delete guard) — a moved-away cache
     * is as good as a deleted one.
     *
     * @returns True when the directory was removed or moved aside and init succeeded; false when
     *          deletion failed.
     */
    clear(): boolean {
        try {
            if (!this.removeCacheDir(this.dir)) return false;
            this.resetMemoryMaps();
            this.enabled = this.init();
            if (this.enabled) this.rebuildManifest();
            return this.enabled;
        } catch {
            return false;
        }
    }

    private removeCacheDir(dir: string): boolean {
        if (!fs.existsSync(dir)) return true;
        try {
            fs.rmSync(dir, { recursive: true, force: true });
            return true;
        } catch {
            return this.renameStaleCacheDir(dir);
        }
    }

    private renameStaleCacheDir(dir: string): boolean {
        try {
            const stale = path.join(
                path.dirname(dir),
                `.auto-refactor-cache-clear-${Date.now()}-${Math.random().toString(RANDOM_STRING_RADIX).slice(2, CACHE_CLEAR_SUFFIX_END_INDEX)}`,
            );
            fs.renameSync(dir, stale);
            return true;
        } catch {
            return false;
        }
    }

    private resetMemoryMaps(): void {
        this.l1.clear();
        this.l2.clear();
        this.l2ByPath.clear();
        this.dirtyL1.clear();
        this.dirtyL2.clear();
    }

    /**
     * Report current in-memory entry counts for debug/status output.
     *
     * @returns Fresh object with the live L1 and L2 map sizes.
     */
    size(): { l1: number; l2: number } {
        return { l1: this.l1.size, l2: this.l2.size };
    }

    /**
     * Serialize the whole in-memory store for tests.
     *
     * @returns Canonical JSON with L1 entries and L2 entry objects in map insertion order.
     */
    dump(): string {
        return canonicalJson({ l1: [...this.l1.entries()], l2: [...this.l2.values()] });
    }
}

/**
 * Resolve the effective cache directory for a project (shared dirs get a hash subdir).
 *
 * @param cacheDir - Explicit cache directory from CLI/config; falsy values select the default.
 * @param root - Project root used when `cacheDir` is omitted.
 * @returns `cacheDir` when non-empty, otherwise the project-local .auto-refactor-cache dir.
 */
export function resolveCacheDir(cacheDir: string | undefined, root: string): string {
    return cacheDir || path.join(root, '.auto-refactor-cache');
}
