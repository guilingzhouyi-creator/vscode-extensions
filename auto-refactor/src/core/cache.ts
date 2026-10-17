/**
 * Module: Core Engine — Two-Level Incremental Cache Store
 * File Path: src/core/cache.ts
 * Architecture Role: Local persistence adapter that owns the manifest, L1 fingerprint, L2
 *   result, and L3 path-index files plus their in-memory mirrors for warm scans.
 * Dependencies & Triggers: Imports `path`, core `Issue`/`FileMetric` types,
 *   `TOOL_VERSION`, and cacheKey helpers (`CACHE_FORMAT_VERSION`, `sha256Hex`,
 *   `canonicalJson`, `l2Key`); constructed by the CLI/daemon when cache options are
 *   resolved and used by `Scanner.scanWithCache` and `Scanner.scanWithDiff`.
 * Responsibilities: Initialize cache directory, probe writability, create/rebuild manifest,
 *   load L1/L2/L3 with corrupt-line recovery, support Append-Only (WAL) updates and periodic
 *   compaction to eliminate I/O amplification, buffer writes, flush atomically via `.tmp` + rename,
 *   clear the store, maintain path index, namespace per project, and run TTL/LRU trimming.
 * Exit Semantics & Design Rationale: The cache is strictly best-effort: unwritable dirs
 *   auto-disable it, bad manifests rebuild empty, corrupt lines are skipped, oversized
 *   result files are not loaded, `flush()` swallows write failures, and `clear()` returns
 *   false instead of throwing; atomic renames and append-only WAL ensure a crash can lose only
 *   the newest entries, never corrupt older ones.
 */
import * as path from 'path';
import type { Issue, FileMetric } from './types';
import type { Logger } from './logger';
import { TOOL_VERSION } from './config/config';
import { CACHE_FORMAT_VERSION, sha256Hex, canonicalJson, l2Key } from './cache-key';
import {
    TYPEOF_STRING,
    TYPEOF_NUMBER,
    NEWLINE_CHAR,
    type L2EntryRecord,
    SyncIoBarrier,
    readTextFileSync,
    readLinesSafe,
    writeFileAtomic,
    writeFileAtomicAsync,
    appendLinesSafe,
    appendLinesSafeAsync,
    probeWritable,
    parseL1Line,
    isValidL2,
    isValidPathEntry,
    serializeL1,
    serializeL2,
    serializePaths,
    serializeDirtyPaths,
    computePathKey,
    removeCacheDir,
} from './cache-persistence';

/** File metadata fingerprint used for L1 freshness checks. */
export interface Fingerprint {
    /** Last-modification time in milliseconds since the Unix epoch. */
    mtimeMs: number;
    /** File size in bytes. */
    size: number;
    /** Platform inode number when available; absent means the host did not report one. */
    ino?: number;
}

/** Scan result cached for a file in L2 storage. */
export interface CachedResult {
    /** Issues emitted for the file, preserved in analyzer emission order. */
    issues: Issue[];
    /** Aggregate file metric, or null when metrics were not computed for this scan. */
    metric: FileMetric | null;
}

type L2Entry = L2EntryRecord;

/** Configuration options controlling CacheStore retention and sizing. */
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
const EMPTY_METADATA_ISSUES: Issue[] = Object.freeze([]) as unknown as Issue[];

const FILE_MANIFEST_JSON = 'manifest.json';
const FILE_FINGERPRINTS_JSONL = 'fingerprints.jsonl';
const FILE_RESULTS_JSONL = 'results.jsonl';
const FILE_PATHS_JSONL = 'paths.jsonl';
const DEFAULT_CACHE_DIR_NAME = '.auto-refactor-cache';

const CACHE_LOAD_LEVEL_FULL = 'full';
const CACHE_LOAD_LEVEL_HOT = 'hot';
const CACHE_LOAD_LEVEL_METADATA = 'metadata';
const CACHE_LOAD_LEVEL_DISABLED = 'disabled';

const SEVERITY_STR_ERROR = 'error';
const RETENTION_HOT_DAYS = 7;
const REFRESH_TIMESTAMP_INTERVAL_MS = 60_000;

/** Compaction threshold: cumulative appended records before triggering compaction snapshot. */
const COMPACTION_THRESHOLD_L1_ENTRIES = 1000;
const COMPACTION_THRESHOLD_L2_ENTRIES = 500;

/**
 * Computes a deterministic truncated SHA-256 hash identifying a project root.
 *
 * @param root - Project root directory path.
 * @returns 24-character hexadecimal digest.
 */
export function projectHashFor(root: string): string {
    const abs = path.resolve(root);
    return sha256Hex(abs).slice(0, PROJECT_HASH_HEX_CHARS);
}

/**
 * Best-effort two-level cache with WAL Append-Only persistence for warm scans.
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
    private l2LoadLevel: 'full' | 'hot' | 'metadata' | 'disabled' = CACHE_LOAD_LEVEL_FULL;
    private readonly logger?: Logger;
    private appendedL1Count = 0;
    private appendedL2Count = 0;

    constructor(dir?: string, root?: string, opts: CacheStoreOptions = {}) {
        const projectRoot = root || process.cwd();
        const explicit = dir || path.join(projectRoot, DEFAULT_CACHE_DIR_NAME);
        const isDefaultLayout = path.basename(path.resolve(explicit)) === DEFAULT_CACHE_DIR_NAME;
        this.dir = isDefaultLayout
            ? path.resolve(explicit)
            : path.join(path.resolve(explicit), projectHashFor(projectRoot));
        this.maxEntries = opts.maxEntries ?? DEFAULT_MAX_ENTRIES;
        this.maxAgeDays = opts.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS;
        this.maxL2LoadBytes = opts.maxL2LoadBytes ?? DEFAULT_MAX_L2_LOAD_BYTES;
        this.logger = opts.logger;
        this.manifestPath = path.join(this.dir, FILE_MANIFEST_JSON);
        this.fingerprintsPath = path.join(this.dir, FILE_FINGERPRINTS_JSONL);
        this.resultsPath = path.join(this.dir, FILE_RESULTS_JSONL);
        this.pathsPath = path.join(this.dir, FILE_PATHS_JSONL);
        if (opts.disabled === true) {
            this.enabled = false;
            return;
        }
        this.enabled = this.initializeCache();
        if (this.enabled) this.loadCacheFromDisk();
    }

    private initializeCache(): boolean {
        try {
            SyncIoBarrier.mkdir(this.dir);
        } catch {
            return false;
        }
        if (!probeWritable(this.dir)) return false;
        return this.adoptOrRebuildManifest();
    }

    private adoptOrRebuildManifest(): boolean {
        try {
            const raw = readTextFileSync(this.manifestPath);
            const parsedManifest = JSON.parse(raw);
            if (
                parsedManifest &&
                parsedManifest.formatVersion === CACHE_FORMAT_VERSION &&
                typeof parsedManifest.toolVersion === TYPEOF_STRING &&
                typeof parsedManifest.maxEntries === TYPEOF_NUMBER &&
                typeof parsedManifest.maxAgeDays === TYPEOF_NUMBER
            ) {
                return true;
            }
            this.rebuildCacheManifest();
            return true;
        } catch {
            this.rebuildCacheManifest();
            return true;
        }
    }

    private rebuildCacheManifest(): void {
        const manifest = {
            formatVersion: CACHE_FORMAT_VERSION,
            toolVersion: TOOL_VERSION,
            createdAt: new Date().toISOString(),
            maxEntries: this.maxEntries,
            maxAgeDays: this.maxAgeDays,
        };
        writeFileAtomic(this.manifestPath, JSON.stringify(manifest, null, 2) + NEWLINE_CHAR);
    }

    private loadCacheFromDisk(): void {
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

    private isHotEntry(entry: L2Entry, cutoffMs: number): boolean {
        if (entry.ts && entry.ts >= cutoffMs) return true;
        if (entry.issues && Array.isArray(entry.issues)) {
            return entry.issues.some(
                (issueItem: Issue) => issueItem.severity === SEVERITY_STR_ERROR,
            );
        }
        return false;
    }

    private loadResults(): void {
        const fileSize = SyncIoBarrier.statSize(this.resultsPath);
        if (fileSize < 0) return;

        const ratio = fileSize / this.maxL2LoadBytes;

        if (ratio <= 0.7) {
            this.loadResultsFull();
            this.l2LoadLevel = CACHE_LOAD_LEVEL_FULL;
            return;
        }
        if (ratio <= 1.0) {
            const cutoffMs =
                Date.now() -
                RETENTION_HOT_DAYS * HOURS_PER_DAY * SECONDS_PER_HOUR * MILLIS_PER_SECOND;
            this.loadResultsFiltered((entry: L2Entry) => this.isHotEntry(entry, cutoffMs));
            this.l2LoadLevel = CACHE_LOAD_LEVEL_HOT;
            return;
        }
        if (ratio <= 2.0) {
            this.loadResultsMetadataOnly();
            this.l2LoadLevel = CACHE_LOAD_LEVEL_METADATA;
            return;
        }
        this.l2LoadLevel = CACHE_LOAD_LEVEL_DISABLED;
        if (this.logger) {
            this.logger.warn(
                `L2 cache too large (${(fileSize / BYTES_PER_KIB / KIB_PER_MIB).toFixed(1)} MiB), skipping load`,
            );
        }
    }

    private parseL2Record(line: string, metadataOnly = false): L2Entry | null {
        try {
            const rawObject = JSON.parse(line);
            if (!isValidL2(rawObject)) return null;
            return {
                k: rawObject.k,
                p: rawObject.p,
                issues: metadataOnly ? EMPTY_METADATA_ISSUES : rawObject.issues,
                metric: metadataOnly ? null : rawObject.metric || null,
                ts: typeof rawObject.ts === TYPEOF_NUMBER ? (rawObject.ts as number) : 0,
                fm: typeof rawObject.fm === TYPEOF_NUMBER ? (rawObject.fm as number) : undefined,
                fs: typeof rawObject.fs === TYPEOF_NUMBER ? (rawObject.fs as number) : undefined,
            };
        } catch {
            return null;
        }
    }

    private loadResultsFull(): void {
        const lines = readLinesSafe(this.resultsPath);
        for (const line of lines) {
            if (!line.trim()) continue;
            const entryRecord = this.parseL2Record(line, false);
            if (!entryRecord) continue;
            this.l2.set(entryRecord.k, entryRecord);
            this.indexSecondaryCacheByPath(entryRecord);
        }
    }

    private loadResultsFiltered(predicate: (entry: L2Entry) => boolean): void {
        const lines = readLinesSafe(this.resultsPath);
        for (const line of lines) {
            if (!line.trim()) continue;
            const entryRecord = this.parseL2Record(line, false);
            if (!entryRecord || !predicate(entryRecord)) continue;
            this.l2.set(entryRecord.k, entryRecord);
            this.indexSecondaryCacheByPath(entryRecord);
        }
    }

    private loadResultsMetadataOnly(): void {
        const lines = readLinesSafe(this.resultsPath);
        for (const line of lines) {
            if (!line.trim()) continue;
            const entryRecord = this.parseL2Record(line, true);
            if (!entryRecord) continue;
            this.l2.set(entryRecord.k, entryRecord);
            this.indexSecondaryCacheByPath(entryRecord);
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
            const rawObject = JSON.parse(line);
            if (!isValidPathEntry(rawObject)) return;
            const entryRecord = this.l2.get(rawObject.k);
            if (entryRecord) this.l2ByPath.set(rawObject.pk, entryRecord);
        } catch {
            /* Best-effort: skip corrupt line */
        }
    }

    lookupPrimaryCache(relPath: string): Fingerprint | null {
        if (!this.enabled) return null;
        return this.l1.get(relPath) || null;
    }

    lookupL1(relPath: string): Fingerprint | null {
        return this.lookupPrimaryCache(relPath);
    }

    lookupSecondaryCache(
        fpHashValue: string,
        contentHash: string,
    ): (CachedResult & { p: string }) | null {
        if (!this.enabled) return null;
        const keyString = l2Key(fpHashValue, contentHash);
        const entryRecord = this.l2.get(keyString);
        if (!entryRecord) return null;
        if (
            entryRecord.issues.length === 0 &&
            entryRecord.metric === null &&
            this.l2LoadLevel === CACHE_LOAD_LEVEL_METADATA
        ) {
            return null;
        }
        const nowMs = Date.now();
        if (nowMs - entryRecord.ts > REFRESH_TIMESTAMP_INTERVAL_MS) {
            entryRecord.ts = nowMs;
            this.dirtyL2.set(keyString, entryRecord);
        }
        return { issues: entryRecord.issues, metric: entryRecord.metric, p: entryRecord.p };
    }

    lookupL2(fpHashValue: string, contentHash: string): (CachedResult & { p: string }) | null {
        return this.lookupSecondaryCache(fpHashValue, contentHash);
    }

    writePrimaryCache(relPath: string, fileFingerprint: Fingerprint): void {
        if (!this.enabled) return;
        this.l1.set(relPath, fileFingerprint);
        this.dirtyL1.set(relPath, fileFingerprint);
    }

    writeL1(relPath: string, fileFingerprint: Fingerprint): void {
        this.writePrimaryCache(relPath, fileFingerprint);
    }

    writeSecondaryCache(
        fpHashValue: string,
        contentHash: string,
        relPath: string,
        scanResult: CachedResult,
        fileFingerprint?: Fingerprint,
    ): void {
        if (!this.enabled) return;
        const keyString = l2Key(fpHashValue, contentHash);
        const entryRecord: L2Entry = {
            k: keyString,
            p: relPath,
            issues: scanResult.issues,
            metric: scanResult.metric,
            ts: Date.now(),
            fm: fileFingerprint ? fileFingerprint.mtimeMs : undefined,
            fs: fileFingerprint ? fileFingerprint.size : undefined,
        };
        this.l2.set(keyString, entryRecord);
        this.dirtyL2.set(keyString, entryRecord);
        this.indexSecondaryCacheByPath(entryRecord);
    }

    writeL2(
        fpHashValue: string,
        contentHash: string,
        relPath: string,
        scanResult: CachedResult,
        fileFingerprint?: Fingerprint,
    ): void {
        this.writeSecondaryCache(fpHashValue, contentHash, relPath, scanResult, fileFingerprint);
    }

    private indexSecondaryCacheByPath(entryRecord: L2Entry): void {
        const pathKey = computePathKey(
            entryRecord.k,
            entryRecord.p,
            entryRecord.fm,
            entryRecord.fs,
        );
        const existing = this.l2ByPath.get(pathKey);
        if (!existing || entryRecord.ts >= existing.ts) this.l2ByPath.set(pathKey, entryRecord);
    }

    lookupSecondaryCacheByPath(
        fpHashValue: string,
        relPath: string,
        mtimeMs: number,
        size: number,
    ): (CachedResult & { p: string }) | null {
        if (!this.enabled) return null;
        const lookupPathKey = `${fpHashValue}\u0000${relPath}\u0000${mtimeMs}\u0000${size}`;
        const entryRecord = this.l2ByPath.get(lookupPathKey);
        if (!entryRecord) return null;
        if (
            entryRecord.issues.length === 0 &&
            entryRecord.metric === null &&
            this.l2LoadLevel === CACHE_LOAD_LEVEL_METADATA
        ) {
            return null;
        }
        return { issues: entryRecord.issues, metric: entryRecord.metric, p: entryRecord.p };
    }

    lookupL2ByPath(
        fpHashValue: string,
        relPath: string,
        mtimeMs: number,
        size: number,
    ): (CachedResult & { p: string }) | null {
        return this.lookupSecondaryCacheByPath(fpHashValue, relPath, mtimeMs, size);
    }

    /**
     * Compacts the cache on disk, performing a complete atomic snapshot rewrite
     * and resetting the WAL append log counter.
     */
    compactCache(): void {
        if (!this.enabled) return;
        try {
            writeFileAtomic(this.fingerprintsPath, serializeL1(this.l1));
            writeFileAtomic(this.resultsPath, serializeL2(this.l2));
            writeFileAtomic(this.pathsPath, serializePaths(this.l2ByPath));
            this.appendedL1Count = 0;
            this.appendedL2Count = 0;
            this.dirtyL1.clear();
            this.dirtyL2.clear();
        } catch {
            /* Best-effort */
        }
    }

    compact(): void {
        this.compactCache();
    }

    /**
     * Flushes dirty entries to disk using Append-Only WAL or periodic compaction snapshot.
     */
    flushCacheToDisk(): void {
        if (!this.enabled) return;
        try {
            if (this.dirtyL1.size > 0 || this.dirtyL2.size > 0) {
                this.executeCleanupIfNeeded();
            }
            if (this.dirtyL1.size > 0) {
                if (
                    this.appendedL1Count >= COMPACTION_THRESHOLD_L1_ENTRIES ||
                    !SyncIoBarrier.exists(this.fingerprintsPath)
                ) {
                    writeFileAtomic(this.fingerprintsPath, serializeL1(this.l1));
                    this.appendedL1Count = 0;
                } else {
                    appendLinesSafe(this.fingerprintsPath, serializeL1(this.dirtyL1));
                    this.appendedL1Count += this.dirtyL1.size;
                }
                this.dirtyL1.clear();
            }
            if (this.dirtyL2.size > 0) {
                if (
                    this.appendedL2Count >= COMPACTION_THRESHOLD_L2_ENTRIES ||
                    !SyncIoBarrier.exists(this.resultsPath)
                ) {
                    writeFileAtomic(this.resultsPath, serializeL2(this.l2));
                    writeFileAtomic(this.pathsPath, serializePaths(this.l2ByPath));
                    this.appendedL2Count = 0;
                } else {
                    appendLinesSafe(this.resultsPath, serializeL2(this.dirtyL2));
                    appendLinesSafe(this.pathsPath, serializeDirtyPaths(this.dirtyL2.values()));
                    this.appendedL2Count += this.dirtyL2.size;
                }
                this.dirtyL2.clear();
            }
        } catch {
            /* Best-effort: scan stands on its own */
        }
    }

    flush(): void {
        this.flushCacheToDisk();
    }

    /**
     * Flushes dirty entries asynchronously using Append-Only WAL or periodic compaction snapshot.
     */
    async flushCacheToDiskAsync(): Promise<void> {
        if (!this.enabled) return;
        try {
            if (this.dirtyL1.size > 0 || this.dirtyL2.size > 0) {
                this.executeCleanupIfNeeded();
            }
            if (this.dirtyL1.size > 0) {
                if (
                    this.appendedL1Count >= COMPACTION_THRESHOLD_L1_ENTRIES ||
                    !SyncIoBarrier.exists(this.fingerprintsPath)
                ) {
                    await writeFileAtomicAsync(this.fingerprintsPath, serializeL1(this.l1));
                    this.appendedL1Count = 0;
                } else {
                    await appendLinesSafeAsync(this.fingerprintsPath, serializeL1(this.dirtyL1));
                    this.appendedL1Count += this.dirtyL1.size;
                }
                this.dirtyL1.clear();
            }
            if (this.dirtyL2.size > 0) {
                if (
                    this.appendedL2Count >= COMPACTION_THRESHOLD_L2_ENTRIES ||
                    !SyncIoBarrier.exists(this.resultsPath)
                ) {
                    await writeFileAtomicAsync(this.resultsPath, serializeL2(this.l2));
                    await writeFileAtomicAsync(this.pathsPath, serializePaths(this.l2ByPath));
                    this.appendedL2Count = 0;
                } else {
                    await appendLinesSafeAsync(this.resultsPath, serializeL2(this.dirtyL2));
                    await appendLinesSafeAsync(
                        this.pathsPath,
                        serializeDirtyPaths(this.dirtyL2.values()),
                    );
                    this.appendedL2Count += this.dirtyL2.size;
                }
                this.dirtyL2.clear();
            }
        } catch {
            /* Best-effort */
        }
    }

    async flushAsync(): Promise<void> {
        await this.flushCacheToDiskAsync();
    }

    executeCleanupIfNeeded(): void {
        if (!this.enabled || this.l2.size <= this.maxEntries) return;
        if (this.maxAgeDays > 0) {
            const maxAgeMs = this.maxAgeDays * HOURS_PER_DAY * SECONDS_PER_HOUR * MILLIS_PER_SECOND;
            this.trimExpiredEntries(Date.now(), maxAgeMs);
        }
        this.trimLruExcess();
    }

    cleanupIfNeeded(): void {
        this.executeCleanupIfNeeded();
    }

    private removeSecondaryCacheEntry(entryRecord: L2Entry): void {
        this.l2.delete(entryRecord.k);
        const pathKey = computePathKey(
            entryRecord.k,
            entryRecord.p,
            entryRecord.fm,
            entryRecord.fs,
        );
        if (this.l2ByPath.get(pathKey) === entryRecord) {
            this.l2ByPath.delete(pathKey);
        }
    }

    private trimExpiredEntries(nowMs: number, maxAgeMs: number): void {
        for (const entryRecord of this.l2.values()) {
            if (nowMs - entryRecord.ts > maxAgeMs) {
                this.removeSecondaryCacheEntry(entryRecord);
            }
        }
    }

    private trimLruExcess(): void {
        let excess = this.l2.size - this.maxEntries;
        if (excess <= 0) return;

        const sorted = [...this.l2.values()].sort((a, b) => a.ts - b.ts);
        for (const entryRecord of sorted) {
            if (excess <= 0) break;
            this.removeSecondaryCacheEntry(entryRecord);
            excess--;
        }
    }

    clear(): boolean {
        try {
            if (!removeCacheDir(this.dir)) return false;
            this.resetMemoryMaps();
            this.appendedL1Count = 0;
            this.appendedL2Count = 0;
            this.enabled = this.initializeCache();
            if (this.enabled) this.rebuildCacheManifest();
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

    getCacheMetrics(): {
        l1: number;
        l2: number;
        l2LoadLevel: string;
        appendedL1: number;
        appendedL2: number;
    } {
        return {
            l1: this.l1.size,
            l2: this.l2.size,
            l2LoadLevel: this.l2LoadLevel,
            appendedL1: this.appendedL1Count,
            appendedL2: this.appendedL2Count,
        };
    }

    size(): { l1: number; l2: number; l2LoadLevel: string } {
        return this.getCacheMetrics();
    }

    getLoadLevel(): 'full' | 'hot' | 'metadata' | 'disabled' {
        return this.l2LoadLevel;
    }

    dumpCacheState(): string {
        return canonicalJson({ l1: [...this.l1.entries()], l2: [...this.l2.values()] });
    }

    dump(): string {
        return this.dumpCacheState();
    }
}

/**
 * Resolves effective cache directory path from user option or default.
 *
 * @param cacheDir - Explicitly configured cache directory.
 * @param root - Project root directory path.
 * @returns Resolved cache directory path.
 */
export function resolveCacheDir(cacheDir: string | undefined, root: string): string {
    return cacheDir || path.join(root, DEFAULT_CACHE_DIR_NAME);
}
