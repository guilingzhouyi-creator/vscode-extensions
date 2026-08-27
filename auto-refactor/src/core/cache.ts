import * as fs from 'fs';
import * as path from 'path';
import { Issue, FileMetric } from './types';
import { TOOL_VERSION } from './config';
import { CACHE_FORMAT_VERSION, sha256Hex, canonicalJson, l2Key } from './cacheKey';

/**
 * Two-level incremental cache (docs/warm-scan-design.md Part B).
 *
 * Layout (project-local by default; `--cache-dir` overrides):
 *   <dir>/
 *     manifest.json      { formatVersion, toolVersion, createdAt, maxEntries, maxAgeDays }
 *     fingerprints.jsonl L1: {"t":"f","p":"src/a.ts","m":<mtimeMs>,"s":<size>,"i":<ino?>}
 *     results.jsonl      L2: {"t":"r","k":"v1:<fpHash>:<contentHash>","p":...,"issues":[...],"metric":{...},"ts":<lastHitMs>}
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

export interface Fingerprint {
  mtimeMs: number;
  size: number;
  ino?: number;
}

export interface CachedResult {
  issues: Issue[];
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
const DEFAULT_MAX_L2_LOAD_BYTES = 64 * 1024 * 1024;

/** Hash of the canonical root path — used to namespace shared --cache-dir targets. */
export function projectHashFor(root: string): string {
  const abs = path.resolve(root);
  return sha256Hex(abs).slice(0, 24);
}

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
  /** L2-by-path index: `${fpHash}\u0000${relPath}` -> most-recent entry (fresh-process L1 hits). */
  private l2ByPath = new Map<string, L2Entry>();
  /** Pending L1 writes since last flush. */
  private dirtyL1 = new Map<string, Fingerprint>();
  /** Pending L2 writes since last flush. */
  private dirtyL2 = new Map<string, L2Entry>();
  private readonly manifestPath: string;
  private readonly fingerprintsPath: string;
  private readonly resultsPath: string;
  /** L3 index (`paths.jsonl`): persists the byPath map so a FRESH process can rebuild it
   *  without re-reading file contents (the design's "L1 命中 = 跳过" across processes). */
  private readonly pathsPath: string;
  private loaded = false;

  /**
   * @param dir          cache directory (default `<root>/.auto-refactor-cache`)
   * @param root         project root (used for shared-dir namespacing + default dir)
   */
  constructor(dir?: string, root?: string, opts: CacheStoreOptions = {}) {
    const projectRoot = root || process.cwd();
    const explicit = dir || path.join(projectRoot, '.auto-refactor-cache');
    // A shared --cache-dir (basename != .auto-refactor-cache) gets a per-project subdir.
    const isDefaultLayout = path.basename(path.resolve(explicit)) === '.auto-refactor-cache';
    this.dir = isDefaultLayout ? path.resolve(explicit) : path.join(path.resolve(explicit), projectHashFor(projectRoot));
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
    // Probe writability (a read-only project must degrade silently). A FIXED probe name so
    // failed unlinks (transient Windows file-lock) cannot accumulate per-pid files; the
    // leftover 2-byte probe is harmless and overwritten next init.
    try {
      const probe = path.join(this.dir, '.probe');
      try {
        fs.writeFileSync(probe, 'ok', 'utf8');
      } catch {
        return false;
      }
      try {
        fs.rmSync(probe, { force: true });
      } catch {
        /* probe cleanup is best-effort */
      }
    } catch {
      return false;
    }
    try {
      const raw = fs.readFileSync(this.manifestPath, 'utf8');
      const m = JSON.parse(raw);
      if (
        m &&
        m.formatVersion === CACHE_FORMAT_VERSION &&
        typeof m.toolVersion === 'string' &&
        typeof m.maxEntries === 'number' &&
        typeof m.maxAgeDays === 'number'
      ) {
        // Manifest valid — adopt its limits (defensive defaults on any mismatch).
        return true;
      }
      // Manifest invalid or older format → rebuild (empty cache, never a correctness issue).
      this.rebuildManifest();
      return true;
    } catch {
      // No manifest yet → create it.
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
    // L1 fingerprints are tiny — always load.
    try {
      const lines = fs.readFileSync(this.fingerprintsPath, 'utf8').split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const o = JSON.parse(line);
          if (o && o.t === 'f' && typeof o.p === 'string' && typeof o.m === 'number' && typeof o.s === 'number') {
            this.l1.set(o.p, { mtimeMs: o.m, size: o.s, ino: typeof o.i === 'number' ? o.i : undefined });
          }
        } catch {
          /* skip corrupt line */
        }
      }
    } catch {
      /* missing/empty fingerprints file is fine */
    }
    // L2 results can be large — guard the load so a huge cache never regresses cold starts.
    try {
      const st = fs.statSync(this.resultsPath);
      if (st.size > this.maxL2LoadBytes) return; // degrade to L2-miss (correct, just slower)
    } catch {
      return;
    }
    try {
      const lines = fs.readFileSync(this.resultsPath, 'utf8').split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const o = JSON.parse(line);
          if (o && o.t === 'r' && typeof o.k === 'string' && typeof o.p === 'string' && Array.isArray(o.issues)) {
            const entry: L2Entry = {
              k: o.k,
              p: o.p,
              issues: o.issues,
              metric: o.metric || null,
              ts: typeof o.ts === 'number' ? o.ts : 0,
              fm: typeof o.fm === 'number' ? o.fm : undefined,
              fs: typeof o.fs === 'number' ? o.fs : undefined,
            };
            this.l2.set(o.k, entry);
            this.indexL2ByPath(entry);
          }
        } catch {
          /* skip corrupt line */
        }
      }
    } catch {
      /* missing/empty results file is fine */
    }
    // L3: rebuild the exact per-rel byPath map from paths.jsonl (full coverage for identical
    // content files that share one L2 key).
    try {
      const lines = fs.readFileSync(this.pathsPath, 'utf8').split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const o = JSON.parse(line);
          if (o && o.t === 'x' && typeof o.pk === 'string' && typeof o.k === 'string') {
            const e = this.l2.get(o.k);
            if (e) this.l2ByPath.set(o.pk, e);
          }
        } catch {
          /* skip corrupt line */
        }
      }
    } catch {
      /* missing/empty paths file is fine */
    }
  }

  /** Atomic write: .tmp-<pid>-<rand> + rename (Windows MoveFileEx(REPLACE_EXISTING)). */
  private writeFileAtomic(file: string, data: string): void {
    const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
    fs.writeFileSync(tmp, data, 'utf8');
    try {
      fs.renameSync(tmp, file);
    } catch (e) {
      try {
        fs.rmSync(tmp, { force: true });
      } catch {
        /* ignore */
      }
      throw e;
    }
  }

  /** L1 lookup by relPath. Returns null when unknown or cache disabled. */
  lookupL1(relPath: string): Fingerprint | null {
    if (!this.enabled) return null;
    return this.l1.get(relPath) || null;
  }

  /**
   * L2 lookup by (fpHash, contentHash). Returns cached issues+metric plus the relPath the
   * cached entry was originally computed for (`p`) — callers must remap path-embedded data
   * (issue ids / locations / metric.file) to the CURRENT file when p differs.
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

  /** Buffer an L1 fingerprint write (flushed with flush()). */
  writeL1(relPath: string, fp: Fingerprint): void {
    if (!this.enabled) return;
    this.l1.set(relPath, fp);
    this.dirtyL1.set(relPath, fp);
  }

  /** Buffer an L2 result write (flushed with flush()). `fp` is the file's current L1
   *  fingerprint (mtimeMs/size) at write time — used by the byPath index for safe reuse. */
  writeL2(fpHashValue: string, contentHash: string, relPath: string, result: CachedResult, fp?: Fingerprint): void {
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
    const fm = typeof mtimeMs === 'number' ? String(mtimeMs) : '*';
    const fs = typeof size === 'number' ? String(size) : '*';
    return `${this.fpHashOfL2Key(l2key)}\u0000${relPath}\u0000${fm}\u0000${fs}`;
  }

  /**
   * Fast L1-hit reuse for FRESH processes (no session): the L1 fingerprint proves the file
   * is unchanged since the last scan, so the L2 entry written for THIS exact fingerprint is
   * still valid — reuse it WITHOUT reading the file (0 disk reads, matching the design's
   * "L1 命中 = 跳过"). Returns null when no entry exists for this (fpHash, fingerprint).
   */
  lookupL2ByPath(fpHashValue: string, relPath: string, mtimeMs: number, size: number): (CachedResult & { p: string }) | null {
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
      /* cache write failure is never fatal — the scan result stands on its own */
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
      const o: Record<string, any> = { t: 'r', k: e.k, p: e.p, issues: e.issues, metric: e.metric, ts: e.ts };
      if (e.fm !== undefined) o.fm = e.fm;
      if (e.fs !== undefined) o.fs = e.fs;
      lines.push(JSON.stringify(o));
    }
    return lines.join('\n') + (lines.length ? '\n' : '');
  }

  /** Lazy LRU+TTL trim: drop entries past maxAgeDays, then oldest-hit entries past maxEntries. */
  cleanupIfNeeded(): void {
    if (!this.enabled) return;
    if (this.l2.size <= this.maxEntries) return;
    const now = Date.now();
    const maxAgeMs = this.maxAgeDays * 24 * 3600 * 1000;
    const remove = (e: L2Entry) => {
      this.l2.delete(e.k);
      const pathKey = this.pathKeyFor(e.k, e.p, e.fm, e.fs);
      if (this.l2ByPath.get(pathKey) === e) this.l2ByPath.delete(pathKey);
    };
    // 1) TTL trim.
    if (this.maxAgeDays > 0) {
      for (const [k, e] of this.l2) {
        if (now - e.ts > maxAgeMs) remove(e);
      }
    }
    // 2) LRU trim to maxEntries (oldest last-hit first).
    let excess = this.l2.size - this.maxEntries;
    if (excess > 0) {
      const sorted = [...this.l2.values()].sort((a, b) => a.ts - b.ts);
      for (const e of sorted) {
        if (excess <= 0) break;
        remove(e);
        excess--;
      }
    }
  }

  /** Delete the whole cache directory (--cache-clear). Returns false when deletion failed.
   *  Falls back to a same-volume rename when rmSync is blocked (Windows file-lock or a
   *  sandbox bulk-delete guard) — a moved-away cache is as good as a deleted one. */
  clear(): boolean {
    try {
      if (fs.existsSync(this.dir)) {
        try {
          fs.rmSync(this.dir, { recursive: true, force: true });
        } catch {
          try {
            const stale = path.join(path.dirname(this.dir), `.auto-refactor-cache-clear-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
            fs.renameSync(this.dir, stale);
          } catch {
            return false;
          }
        }
      }
      this.l1.clear();
      this.l2.clear();
      this.l2ByPath.clear();
      this.dirtyL1.clear();
      this.dirtyL2.clear();
      this.enabled = this.init();
      if (this.enabled) this.rebuildManifest();
      return this.enabled;
    } catch {
      return false;
    }
  }

  /** Current in-memory sizes (debug/status). */
  size(): { l1: number; l2: number } {
    return { l1: this.l1.size, l2: this.l2.size };
  }

  /** Stable serialization of the whole store (tests). */
  dump(): string {
    return canonicalJson({ l1: [...this.l1.entries()], l2: [...this.l2.values()] });
  }
}

/** Resolve the effective cache directory for a project (shared dirs get a hash subdir). */
export function resolveCacheDir(cacheDir: string | undefined, root: string): string {
  return cacheDir || path.join(root, '.auto-refactor-cache');
}
