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
import type { Logger } from './logger';
import { TOOL_VERSION } from './config/config';
import { CACHE_FORMAT_VERSION, sha256Hex, canonicalJson, l2Key } from './cache-key';
import {
    TYPEOF_STRING,
    TYPEOF_NUMBER,
    type L2EntryRecord,
    readTextFileSync,
    readLinesSafe,
    writeFileAtomic,
    probeWritable,
    parseL1Line,
    isValidL2,
    isValidPathEntry,
    serializeL1,
    serializeL2,
    serializePaths,
    removeCacheDir,
} from './cache-persistence';

export interface Fingerprint {
    /** Last-modification time in milliseconds since the Unix epoch. */
    mtimeMs: number;
    /** File size in bytes. */
    size: number;
    /** Platform inode number when available; absent means the host did not report one. */
    ino?: number;
}

export interface CachedResult {
    /** Issues emitted for the file, preserved in analyzer emission order. */
    issues: Issue[];
    /** Aggregate file metric, or null when metrics were not computed for this scan. */
    metric: FileMetric | null;
}

type L2Entry = L2EntryRecord;

export interface CacheStoreOptions {
    maxEntries?: number;
    maxAgeDays?: number;
    maxL2LoadBytes?: number;
    disabled?: boolean;
    logger?: Logger;
}

const DEFAULT_MAX_ENTRIES = 100_000;
const DEFAULT_MAX_AGE_DAYS = 30;
const BYTES_PER_KIB = 1024;
const KIB_PER_MIB = 1024;
const DEFAULT_MAX_L2_LOAD_MIB = 64;
const DEFAULT_MAX_L2_LOAD_BYTES = DEFAULT_MAX_L2_LOAD_MIB * BYTES_PER_KIB * KIB_PER_MIB;
const PROJECT_HASH_HEX_CHARS = 24;
const HOURS_PER_DAY = 24;
const SECONDS_PER_HOUR = 3600;
const MILLIS_PER_SECOND = 1000;

export function projectHashFor(root: string): string {
    const abs = path.resolve(root);
    return sha256Hex(abs).slice(0, PROJECT_HASH_HEX_CHARS);
}

/**
 * Best-effort two-level cache for warm scans.
 */
export class CacheStore {
    readonly dir: string;
    enabled: boolean;
    private readonly maxEntries: number;
    private readonly maxAgeDays: number;
    private readonly maxL2LoadBytes: number;
    private l1 = new Map<string, Fingerprint>();
    private l2 = new Map<string, L2Entry>();
    private l2ByPath = new Map<string, L2Entry>();
    private dirtyL1 = new Map<string, Fingerprint>();
    private dirtyL2 = new Map<string, L2Entry>();
    private readonly manifestPath: string;
    private readonly fingerprintsPath: string;
    private readonly resultsPath: string;
    private readonly pathsPath: string;
    private loaded = false;
    private l2LoadLevel: 'full' | 'hot' | 'metadata' | 'disabled' = 'full';
    private readonly logger?: Logger;

    constructor(dir?: string, root?: string, opts: CacheStoreOptions = {}) {
        const projectRoot = root || process.cwd();
        const explicit = dir || path.join(projectRoot, '.auto-refactor-cache');
        const isDefaultLayout = path.basename(path.resolve(explicit)) === '.auto-refactor-cache';
        this.dir = isDefaultLayout
            ? path.resolve(explicit)
            : path.join(path.resolve(explicit), projectHashFor(projectRoot));
        this.maxEntries = opts.maxEntries ?? DEFAULT_MAX_ENTRIES;
        this.maxAgeDays = opts.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS;
        this.maxL2LoadBytes = opts.maxL2LoadBytes ?? DEFAULT_MAX_L2_LOAD_BYTES;
        this.logger = opts.logger;
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

    private init(): boolean {
        try {
            fs.mkdirSync(this.dir, { recursive: true });
        } catch {
            return false;
        }
        if (!probeWritable(this.dir)) return false;
        return this.rebuildOrAdoptManifest();
    }

    private rebuildOrAdoptManifest(): boolean {
        try {
            const raw = readTextFileSync(this.manifestPath);
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
        writeFileAtomic(this.manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    }

    private load(): void {
        if (this.loaded) return;
        this.loaded = true;
        this.loadFingerprints();
        this.loadResults();
        this.loadPaths();
    }

    private loadFingerprints(): void {
        const lines = readLinesSafe(this.fingerprintsPath);
        for (const line of lines) {
            if (!line.trim()) continue;
            parseL1Line(line, this.l1);
        }
    }

    private isHotEntry(entry: L2Entry, cutoff: number): boolean {
        if (entry.ts && entry.ts >= cutoff) return true;
        if (entry.issues && Array.isArray(entry.issues)) {
            return entry.issues.some((i: Issue) => i.severity === 'error');
        }
        return false;
    }

    private loadResults(): void {
        let fileSize: number;
        try {
            const st = fs.statSync(this.resultsPath);
            fileSize = st.size;
        } catch {
            return;
        }

        const ratio = fileSize / this.maxL2LoadBytes;

        if (ratio <= 0.7) {
            this.loadResultsFull();
            this.l2LoadLevel = 'full';
            return;
        }
        if (ratio <= 1.0) {
            const cutoff = Date.now() - 7 * HOURS_PER_DAY * SECONDS_PER_HOUR * MILLIS_PER_SECOND;
            this.loadResultsFiltered((entry: L2Entry) => this.isHotEntry(entry, cutoff));
            this.l2LoadLevel = 'hot';
            return;
        }
        if (ratio <= 2.0) {
            this.loadResultsMetadataOnly();
            this.l2LoadLevel = 'metadata';
            return;
        }
        this.l2LoadLevel = 'disabled';
        if (this.logger) {
            this.logger.warn(
                `L2 cache too large (${(fileSize / BYTES_PER_KIB / KIB_PER_MIB).toFixed(1)} MiB), skipping load`,
            );
        }
    }

    private loadResultsFull(): void {
        const lines = readLinesSafe(this.resultsPath);
        for (const line of lines) {
            if (!line.trim()) continue;
            this.parseL2Line(line);
        }
    }

    private loadResultsFiltered(predicate: (entry: L2Entry) => boolean): void {
        const lines = readLinesSafe(this.resultsPath);
        for (const line of lines) {
            if (!line.trim()) continue;
            try {
                const o = JSON.parse(line);
                if (!isValidL2(o)) continue;
                const entry: L2Entry = {
                    k: o.k,
                    p: o.p,
                    issues: o.issues,
                    metric: o.metric || null,
                    ts: typeof o.ts === TYPEOF_NUMBER ? (o.ts as number) : 0,
                    fm: typeof o.fm === TYPEOF_NUMBER ? (o.fm as number) : undefined,
                    fs: typeof o.fs === TYPEOF_NUMBER ? (o.fs as number) : undefined,
                };
                if (predicate(entry)) {
                    this.l2.set(o.k, entry);
                    this.indexL2ByPath(entry);
                }
            } catch {
                /* Best-effort: skip corrupt line */
            }
        }
    }

    private loadResultsMetadataOnly(): void {
        const lines = readLinesSafe(this.resultsPath);
        for (const line of lines) {
            if (!line.trim()) continue;
            try {
                const o = JSON.parse(line);
                if (!isValidL2(o)) continue;
                const entry: L2Entry = {
                    k: o.k,
                    p: o.p,
                    issues: [],
                    metric: null,
                    ts: typeof o.ts === TYPEOF_NUMBER ? (o.ts as number) : 0,
                };
                this.l2.set(o.k, entry);
                this.indexL2ByPath(entry);
            } catch {
                /* Best-effort: skip corrupt line */
            }
        }
    }

    private parseL2Line(line: string): void {
        try {
            const o = JSON.parse(line);
            if (!isValidL2(o)) return;
            const entry: L2Entry = {
                k: o.k,
                p: o.p,
                issues: o.issues,
                metric: o.metric || null,
                ts: typeof o.ts === TYPEOF_NUMBER ? (o.ts as number) : 0,
                fm: typeof o.fm === TYPEOF_NUMBER ? (o.fm as number) : undefined,
                fs: typeof o.fs === TYPEOF_NUMBER ? (o.fs as number) : undefined,
            };
            this.l2.set(o.k, entry);
            this.indexL2ByPath(entry);
        } catch {
            /* Best-effort: skip corrupt line */
        }
    }

    private loadPaths(): void {
        const lines = readLinesSafe(this.pathsPath);
        for (const line of lines) {
            if (!line.trim()) continue;
            this.parsePathLine(line);
        }
    }

    private parsePathLine(line: string): void {
        try {
            const o = JSON.parse(line);
            if (!isValidPathEntry(o)) return;
            const e = this.l2.get(o.k);
            if (e) this.l2ByPath.set(o.pk, e);
        } catch {
            /* Best-effort: skip corrupt line */
        }
    }

    lookupL1(relPath: string): Fingerprint | null {
        if (!this.enabled) return null;
        return this.l1.get(relPath) || null;
    }

    lookupL2(fpHashValue: string, contentHash: string): (CachedResult & { p: string }) | null {
        if (!this.enabled) return null;
        const key = l2Key(fpHashValue, contentHash);
        const e = this.l2.get(key);
        if (!e) return null;
        if (e.issues.length === 0 && e.metric === null && this.l2LoadLevel === 'metadata') {
            return null;
        }
        const now = Date.now();
        if (now - e.ts > 60_000) {
            e.ts = now;
            this.dirtyL2.set(key, e);
        }
        return { issues: e.issues, metric: e.metric, p: e.p };
    }

    writeL1(relPath: string, fp: Fingerprint): void {
        if (!this.enabled) return;
        this.l1.set(relPath, fp);
        this.dirtyL1.set(relPath, fp);
    }

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

    private indexL2ByPath(entry: L2Entry): void {
        const pathKey = this.pathKeyFor(entry.k, entry.p, entry.fm, entry.fs);
        const existing = this.l2ByPath.get(pathKey);
        if (!existing || entry.ts >= existing.ts) this.l2ByPath.set(pathKey, entry);
    }

    private fpHashOfL2Key(k: string): string {
        const m = /^v1:([0-9a-f]+):[0-9a-f]+$/.exec(k);
        return m ? m[1] : '';
    }

    private pathKeyFor(l2key: string, relPath: string, mtimeMs?: number, size?: number): string {
        const fm = typeof mtimeMs === TYPEOF_NUMBER ? String(mtimeMs) : '*';
        const fs = typeof size === TYPEOF_NUMBER ? String(size) : '*';
        return `${this.fpHashOfL2Key(l2key)}\u0000${relPath}\u0000${fm}\u0000${fs}`;
    }

    lookupL2ByPath(
        fpHashValue: string,
        relPath: string,
        mtimeMs: number,
        size: number,
    ): (CachedResult & { p: string }) | null {
        if (!this.enabled) return null;
        const e = this.l2ByPath.get(`${fpHashValue}\u0000${relPath}\u0000${mtimeMs}\u0000${size}`);
        if (!e) return null;
        if (e.issues.length === 0 && e.metric === null && this.l2LoadLevel === 'metadata') {
            return null;
        }
        return { issues: e.issues, metric: e.metric, p: e.p };
    }

    flush(): void {
        if (!this.enabled) return;
        try {
            if (this.dirtyL1.size > 0 || this.dirtyL2.size > 0) {
                this.cleanupIfNeeded();
            }
            if (this.dirtyL1.size > 0) {
                writeFileAtomic(this.fingerprintsPath, serializeL1(this.l1));
                this.dirtyL1.clear();
            }
            if (this.dirtyL2.size > 0) {
                writeFileAtomic(this.resultsPath, serializeL2(this.l2));
                writeFileAtomic(this.pathsPath, serializePaths(this.l2ByPath));
                this.dirtyL2.clear();
            }
        } catch {
            /* Best-effort: scan stands on its own */
        }
    }

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

    clear(): boolean {
        try {
            if (!removeCacheDir(this.dir)) return false;
            this.resetMemoryMaps();
            this.enabled = this.init();
            if (this.enabled) this.rebuildManifest();
            return this.enabled;
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

    size(): { l1: number; l2: number; l2LoadLevel: string } {
        return { l1: this.l1.size, l2: this.l2.size, l2LoadLevel: this.l2LoadLevel };
    }

    getLoadLevel(): 'full' | 'hot' | 'metadata' | 'disabled' {
        return this.l2LoadLevel;
    }

    dump(): string {
        return canonicalJson({ l1: [...this.l1.entries()], l2: [...this.l2.values()] });
    }
}

export function resolveCacheDir(cacheDir: string | undefined, root: string): string {
    return cacheDir || path.join(root, '.auto-refactor-cache');
}
