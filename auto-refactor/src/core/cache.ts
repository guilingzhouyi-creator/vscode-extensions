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
import { L1Journal } from './cache-l1-journal';
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
import {
    ensureL2EntryDecoded,
    tryLoadArc2L1Index,
    tryLoadArc2L2Container,
    writeArc2L1SnapshotSync,
    writeArc2L2SnapshotSync,
    appendArc2L2WalSync,
    flushArc2L1Async,
    flushArc2L2Async,
    type Arc2SyncPaths,
    type Arc2SyncOptions,
} from './cache-arc2-io';

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
    /** Cross-file symbol definitions and references for this file. */
    symbols?: {
        definitions: import('./intelligence/symbolIndex').SymbolDefinition[];
        references: import('./intelligence/symbolIndex').SymbolReference[];
    };
    /** Cross-file literal occurrences for this file. */
    literals?: import('./intelligence/literalIndex').LiteralOccurrence[];
    /** Loop sites collected for cross-function polynomial complexity checks. */
    loopSites?: import('./intelligence/semanticComplexity').LoopSite[];
    /** Module dependency graph summary for this file. */
    graphEdges?: import('./dependency-graph').ModuleGraphFileSummary;
}

type L2Entry = L2EntryRecord;

/** Parameter options context for writing L2 secondary cache records. */
export interface L2WriteOptions {
    readonly fpHashValue: string;
    readonly contentHash: string;
    readonly relPath: string;
    readonly scanResult: CachedResult;
    readonly fileFingerprint?: Fingerprint;
}

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
const FILE_L1_INDEX_ARC = 'l1-index.aridx';
const FILE_L2_STORE_ARC = 'l2-store.arc';
const FILE_L2_DELTA_WAL = 'l2-delta.arwal';
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
    private l2RemovalGeneration = 0;
    private l2PersistedRemovalGeneration = 0;
    private flushInFlight?: Promise<void>;
    private flushRequested = false;
    /** Last best-effort persistence failure; cleared after a successful retry. */
    lastFlushError?: unknown;
    private readonly manifestPath: string;
    private readonly fingerprintsPath: string;
    private readonly resultsPath: string;
    private readonly pathsPath: string;
    private readonly l1Journal: L1Journal;
    private readonly l1IndexArcPath: string;
    private readonly l2StoreArcPath: string;
    private readonly l2DeltaWalPath: string;
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
        this.l1Journal = new L1Journal(this.dir);
        this.l1IndexArcPath = path.join(this.dir, FILE_L1_INDEX_ARC);
        this.l2StoreArcPath = path.join(this.dir, FILE_L2_STORE_ARC);
        this.l2DeltaWalPath = path.join(this.dir, FILE_L2_DELTA_WAL);
        if (opts.disabled === true) {
            this.enabled = false;
            return;
        }
        this.enabled = this.initializeCache();
        if (this.enabled) this.loadCacheFromDisk();
    }

    /**
     * Ensures the cache directory exists and probes write permissions before adopting the manifest.
     *
     * @returns True when the directory is writable and the manifest is valid or rebuilt.
     */
    private initializeCache(): boolean {
        try {
            SyncIoBarrier.mkdir(this.dir);
        } catch {
            return false;
        }
        return probeWritable(this.dir) ? this.runAdoptOrRebuildManifest() : false;
    }

    /**
     * Validates an existing `manifest.json` against the current format version or rebuilds it.
     *
     * @returns True once a valid manifest is present on disk.
     */
    private runAdoptOrRebuildManifest(): boolean {
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
            this.runRebuildCacheManifest();
            return true;
        } catch {
            this.runRebuildCacheManifest();
            return true;
        }
    }

    /**
     * Writes a fresh `manifest.json` atomically with current retention parameters.
     */
    private runRebuildCacheManifest(): void {
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
        if (!this.l1Journal.load(this.l1) && !this.tryLoadBinaryL1()) {
            this.loadFingerprints();
        }
        if (!this.tryLoadBinaryL2()) {
            this.loadResults();
            this.loadPaths();
        }
    }

    private tryLoadBinaryL1(): boolean {
        return tryLoadArc2L1Index(this.l1IndexArcPath, this.fingerprintsPath, this.l1, () => {
            this.loadFingerprints();
        });
    }

    private tryLoadBinaryL2(): boolean {
        const ok = tryLoadArc2L2Container(
            this.l2StoreArcPath,
            this.l2DeltaWalPath,
            this.resultsPath,
            this.maxL2LoadBytes,
            (entry) => {
                this.l2.set(entry.k, entry);
                this.indexSecondaryCacheByPath(entry);
            },
            () => {
                this.loadResultsFull();
            },
        );
        if (ok) {
            this.l2LoadLevel = CACHE_LOAD_LEVEL_FULL;
        }
        return ok;
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
                `L2 cache too large (${(fileSize / BYTES_PER_KIB / KIB_PER_MIB).toFixed(1)} MiB), auto-recovering through compaction`,
            );
        }
        try {
            writeFileAtomic(this.resultsPath, '');
            writeFileAtomic(this.pathsPath, '');
            this.l2LoadLevel = CACHE_LOAD_LEVEL_FULL;
            this.appendedL2Count = 0;
        } catch (err) {
            void err;
            /* Keep disabled if filesystem write fails */
        }
    }

    private extractL2OptionalExtras(
        rawObject: Record<string, unknown>,
        metadataOnly: boolean,
    ): Partial<Pick<L2Entry, 'symbols' | 'literals' | 'loopSites' | 'graphEdges'>> {
        if (metadataOnly) return {};
        const extras: Partial<Pick<L2Entry, 'symbols' | 'literals' | 'loopSites' | 'graphEdges'>> =
            {};
        if (rawObject.symbols) extras.symbols = rawObject.symbols as L2Entry['symbols'];
        if (rawObject.literals) extras.literals = rawObject.literals as L2Entry['literals'];
        if (rawObject.loopSites) extras.loopSites = rawObject.loopSites as L2Entry['loopSites'];
        if (rawObject.graphEdges) extras.graphEdges = rawObject.graphEdges as L2Entry['graphEdges'];
        return extras;
    }

    private parseL2Record(line: string, metadataOnly = false): L2Entry | null {
        try {
            const rawObject = JSON.parse(line) as Record<string, unknown>;
            if (!isValidL2(rawObject)) return null;
            return {
                k: rawObject.k,
                p: rawObject.p,
                issues: metadataOnly ? EMPTY_METADATA_ISSUES : rawObject.issues,
                metric: metadataOnly ? null : rawObject.metric || null,
                ts: typeof rawObject.ts === TYPEOF_NUMBER ? (rawObject.ts as number) : 0,
                fm: typeof rawObject.fm === TYPEOF_NUMBER ? (rawObject.fm as number) : undefined,
                fs: typeof rawObject.fs === TYPEOF_NUMBER ? (rawObject.fs as number) : undefined,
                ...this.extractL2OptionalExtras(rawObject, metadataOnly),
                decoded: true,
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
        return this.enabled ? this.l1.get(relPath) || null : null;
    }

    lookupL1(relPath: string): Fingerprint | null {
        if (!this.enabled || !relPath) return null;
        const cached = this.l1.get(relPath);
        return cached ? { ...cached } : null;
    }

    private isMetadataOnlyStale(entryRecord: L2Entry): boolean {
        return (
            entryRecord.issues.length === 0 &&
            entryRecord.metric === null &&
            this.l2LoadLevel === CACHE_LOAD_LEVEL_METADATA
        );
    }

    private materializeCachedResult(entryRecord: L2Entry): CachedResult & { p: string } {
        ensureL2EntryDecoded(entryRecord);
        return {
            issues: entryRecord.issues,
            metric: entryRecord.metric,
            p: entryRecord.p,
            ...(entryRecord.symbols ? { symbols: entryRecord.symbols } : {}),
            ...(entryRecord.literals ? { literals: entryRecord.literals } : {}),
            ...(entryRecord.loopSites ? { loopSites: entryRecord.loopSites } : {}),
            ...(entryRecord.graphEdges ? { graphEdges: entryRecord.graphEdges } : {}),
        };
    }

    lookupSecondaryCache(
        fpHashValue: string,
        contentHash: string,
    ): (CachedResult & { p: string }) | null {
        if (!this.enabled) return null;
        const keyString = l2Key(fpHashValue, contentHash);
        const entryRecord = this.l2.get(keyString);
        if (!entryRecord || this.isMetadataOnlyStale(entryRecord)) return null;
        const nowMs = Date.now();
        if (nowMs - entryRecord.ts > REFRESH_TIMESTAMP_INTERVAL_MS) {
            entryRecord.ts = nowMs;
            this.dirtyL2.set(keyString, entryRecord);
        }
        return this.materializeCachedResult(entryRecord);
    }

    lookupL2(fpHashValue: string, contentHash: string): (CachedResult & { p: string }) | null {
        if (!this.enabled || !fpHashValue || !contentHash) return null;
        const cached = this.lookupSecondaryCache(fpHashValue, contentHash);
        if (!cached) return null;
        return {
            ...cached,
            issues: cached.issues.slice(),
        };
    }

    writePrimaryCache(relPath: string, fileFingerprint: Fingerprint): void {
        if (!this.enabled || !relPath || !fileFingerprint) return;
        this.l1.set(relPath, fileFingerprint);
        this.dirtyL1.set(relPath, fileFingerprint);
    }

    writeL1(relPath: string, fileFingerprint: Fingerprint): void {
        if (!this.enabled || !relPath || !fileFingerprint) return;
        const clonedFingerprint: Fingerprint = {
            mtimeMs: fileFingerprint.mtimeMs,
            size: fileFingerprint.size,
            ino: fileFingerprint.ino,
        };
        this.writePrimaryCache(relPath, clonedFingerprint);
    }

    private executeCommitSecondaryEntry(options: L2WriteOptions): void {
        if (!this.enabled) return;
        const keyString = l2Key(options.fpHashValue, options.contentHash);
        const entryRecord: L2Entry = {
            k: keyString,
            p: options.relPath,
            issues: options.scanResult.issues,
            metric: options.scanResult.metric,
            ts: Date.now(),
            fm: options.fileFingerprint ? options.fileFingerprint.mtimeMs : undefined,
            fs: options.fileFingerprint ? options.fileFingerprint.size : undefined,
            ...(options.scanResult.symbols ? { symbols: options.scanResult.symbols } : {}),
            ...(options.scanResult.literals ? { literals: options.scanResult.literals } : {}),
            ...(options.scanResult.loopSites ? { loopSites: options.scanResult.loopSites } : {}),
            ...(options.scanResult.graphEdges ? { graphEdges: options.scanResult.graphEdges } : {}),
            decoded: true,
        };
        this.l2.set(keyString, entryRecord);
        this.dirtyL2.set(keyString, entryRecord);
        this.indexSecondaryCacheByPath(entryRecord);
    }

    private resolveAndWriteSecondaryCache(
        writeContextOrFpHash: L2WriteOptions | string,
        extraArgs: [string?, string?, CachedResult?, Fingerprint?],
    ): void {
        if (typeof writeContextOrFpHash === 'object') {
            this.executeCommitSecondaryEntry(writeContextOrFpHash);
            return;
        }
        const [contentHash, relPath, scanResult, fileFingerprint] = extraArgs;
        if (!contentHash || !relPath || !scanResult) return;
        this.executeCommitSecondaryEntry({
            fpHashValue: writeContextOrFpHash,
            contentHash,
            relPath,
            scanResult,
            fileFingerprint,
        });
    }

    writeSecondaryCache(
        writeContextOrFpHash: L2WriteOptions | string,
        ...extraArgs: [string?, string?, CachedResult?, Fingerprint?]
    ): void {
        if (!this.enabled) return;
        this.resolveAndWriteSecondaryCache(writeContextOrFpHash, extraArgs);
    }

    writeL2(
        writeContextOrFpHash: L2WriteOptions | string,
        ...extraArgs: [string?, string?, CachedResult?, Fingerprint?]
    ): void {
        if (!this.enabled || !writeContextOrFpHash) return;
        this.resolveAndWriteSecondaryCache(writeContextOrFpHash, extraArgs);
    }

    private getEntryPathKey(entryRecord: L2Entry): string {
        return computePathKey(entryRecord.k, entryRecord.p, entryRecord.fm, entryRecord.fs);
    }

    private indexSecondaryCacheByPath(entryRecord: L2Entry): void {
        const pathKey = this.getEntryPathKey(entryRecord);
        const existing = this.l2ByPath.get(pathKey);
        if (!existing || entryRecord.ts >= existing.ts) {
            this.l2ByPath.set(pathKey, entryRecord);
        }
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
        if (!entryRecord || this.isMetadataOnlyStale(entryRecord)) return null;
        return this.materializeCachedResult(entryRecord);
    }

    lookupL2ByPath(
        fpHashValue: string,
        relPath: string,
        mtimeMs: number,
        size: number,
    ): (CachedResult & { p: string }) | null {
        if (!this.enabled || !fpHashValue || !relPath) return null;
        const cached = this.lookupSecondaryCacheByPath(fpHashValue, relPath, mtimeMs, size);
        if (!cached) return null;
        return {
            ...cached,
            issues: cached.issues.slice(),
        };
    }

    private get arc2Paths(): Arc2SyncPaths {
        return {
            l1IndexArcPath: this.l1IndexArcPath,
            l2StoreArcPath: this.l2StoreArcPath,
            l2DeltaWalPath: this.l2DeltaWalPath,
            fingerprintsPath: this.fingerprintsPath,
            resultsPath: this.resultsPath,
        };
    }

    private get arc2Opts(): Arc2SyncOptions {
        return {
            maxEntries: this.maxEntries,
            maxAgeDays: this.maxAgeDays,
        };
    }

    private writeArc2L1SnapshotSync(): void {
        writeArc2L1SnapshotSync(this.arc2Paths, this.l1, this.arc2Opts);
    }

    private writeArc2L2SnapshotSync(): void {
        writeArc2L2SnapshotSync(this.arc2Paths, this.l2.values(), this.arc2Opts);
    }

    private appendArc2L2WalSync(): void {
        appendArc2L2WalSync(this.arc2Paths, this.dirtyL2.values(), this.arc2Opts);
    }

    /**
     * Compacts the cache on disk, performing a complete atomic snapshot rewrite
     * and resetting the WAL append log counter.
     */
    runCompactCache(): void {
        if (this.flushInFlight || this.l1Journal.busy)
            throw new Error('Cache writer busy: asynchronous flush active');
        if (!this.enabled) return;
        try {
            for (const entry of this.l2.values()) {
                ensureL2EntryDecoded(entry);
            }
            writeFileAtomic(this.fingerprintsPath, serializeL1(this.l1));
            writeFileAtomic(this.resultsPath, serializeL2(this.l2));
            writeFileAtomic(this.pathsPath, serializePaths(this.l2ByPath));
            this.writeArc2L1SnapshotSync();
            this.l1Journal.checkpointSync(this.l1);
            this.writeArc2L2SnapshotSync();
            this.appendedL1Count = 0;
            this.appendedL2Count = 0;
            this.dirtyL1.clear();
            this.dirtyL2.clear();
        } catch {
            /* Best-effort */
        }
    }

    /** Backward-compatible property alias for runCompactCache. */
    readonly compact: () => void = (): void => {
        this.runCompactCache();
    };

    private executeFlushPreparation(): boolean {
        if (!this.enabled) return false;
        if (
            this.dirtyL1.size === 0 &&
            this.dirtyL2.size === 0 &&
            this.l2RemovalGeneration === this.l2PersistedRemovalGeneration
        )
            return false;
        this.executeCleanupIfNeeded();
        return true;
    }

    private shouldRewriteL1Snapshot(): boolean {
        const fileSize = SyncIoBarrier.statSize(this.fingerprintsPath);
        const isOverPhysicalThreshold = fileSize > 0 && fileSize >= this.maxL2LoadBytes * 0.25;
        return (
            isOverPhysicalThreshold ||
            this.appendedL1Count >= COMPACTION_THRESHOLD_L1_ENTRIES ||
            !SyncIoBarrier.exists(this.fingerprintsPath)
        );
    }

    private shouldRewriteL2Snapshot(): boolean {
        const fileSize = SyncIoBarrier.statSize(this.resultsPath);
        const isOverPhysicalThreshold = fileSize > 0 && fileSize >= this.maxL2LoadBytes * 0.75;
        return (
            this.l2RemovalGeneration !== this.l2PersistedRemovalGeneration ||
            isOverPhysicalThreshold ||
            this.appendedL2Count >= COMPACTION_THRESHOLD_L2_ENTRIES ||
            !SyncIoBarrier.exists(this.resultsPath)
        );
    }

    private flushDirtyL1ToDisk(): void {
        if (this.dirtyL1.size === 0) return;
        const migrating = !this.l1Journal.ready;
        const compacting = !this.l1Journal.busy && this.shouldRewriteL1Snapshot();
        if (compacting) {
            writeFileAtomic(this.fingerprintsPath, serializeL1(this.l1));
            this.appendedL1Count = 0;
            this.l1Journal.checkpointSync(this.l1);
        } else {
            appendLinesSafe(this.fingerprintsPath, serializeL1(this.dirtyL1));
            this.appendedL1Count += this.dirtyL1.size;
            this.l1Journal.appendSync(this.dirtyL1, this.l1);
        }
        if (migrating || compacting) this.writeArc2L1SnapshotSync();
        this.dirtyL1.clear();
    }

    private flushDirtyL2ToDisk(): void {
        const hasPendingRemoval = this.l2RemovalGeneration !== this.l2PersistedRemovalGeneration;
        if (this.dirtyL2.size === 0 && !hasPendingRemoval) return;
        if (this.shouldRewriteL2Snapshot()) {
            for (const entry of this.l2.values()) {
                ensureL2EntryDecoded(entry);
            }
            writeFileAtomic(this.resultsPath, serializeL2(this.l2));
            writeFileAtomic(this.pathsPath, serializePaths(this.l2ByPath));
            this.writeArc2L2SnapshotSync();
            this.l2PersistedRemovalGeneration = this.l2RemovalGeneration;
            this.appendedL2Count = 0;
        } else {
            appendLinesSafe(this.resultsPath, serializeL2(this.dirtyL2));
            appendLinesSafe(this.pathsPath, serializeDirtyPaths(this.dirtyL2.values()));
            this.appendArc2L2WalSync();
            this.appendedL2Count += this.dirtyL2.size;
        }
        this.dirtyL2.clear();
    }

    /**
     * Flushes dirty entries to disk using Append-Only WAL or periodic compaction snapshot.
     */
    flushCacheToDisk(): void {
        if (this.flushInFlight) {
            this.flushRequested = true;
            return;
        }
        if (!this.executeFlushPreparation()) return;
        try {
            this.flushDirtyL1ToDisk();
            this.flushDirtyL2ToDisk();
        } catch {
            /* Best-effort: scan stands on its own */
        }
    }

    flush(): void {
        if (!this.enabled) return;
        this.flushCacheToDisk();
    }

    private async flushL1Async(): Promise<void> {
        if (this.dirtyL1.size === 0) return;
        const batch = this.dirtyL1;
        this.dirtyL1 = new Map();
        try {
            const migrating = !this.l1Journal.ready;
            if (migrating && this.shouldRewriteL1Snapshot()) {
                await writeFileAtomicAsync(this.fingerprintsPath, serializeL1(this.l1));
                this.appendedL1Count = 0;
            } else {
                await appendLinesSafeAsync(this.fingerprintsPath, serializeL1(batch));
                this.appendedL1Count += batch.size;
            }
            await this.l1Journal.appendAsync(batch, this.l1);
            if (migrating) await flushArc2L1Async(this.arc2Paths, this.l1, this.arc2Opts);
        } catch (error) {
            for (const [key, value] of batch) {
                if (!this.dirtyL1.has(key)) this.dirtyL1.set(key, value);
            }
            throw error;
        }
    }

    private restoreInterruptedL2Batch(batch: Map<string, L2Entry>): void {
        for (const [key, value] of batch) {
            if (this.l2.get(key) === value && !this.dirtyL2.has(key)) {
                this.dirtyL2.set(key, value);
            }
        }
    }

    private async flushL2Async(): Promise<void> {
        if (
            this.dirtyL2.size === 0 &&
            this.l2RemovalGeneration === this.l2PersistedRemovalGeneration
        )
            return;
        const removalGeneration = this.l2RemovalGeneration;
        const batch = this.dirtyL2;
        this.dirtyL2 = new Map();
        try {
            const isRewrite = this.shouldRewriteL2Snapshot();
            if (isRewrite) {
                await writeFileAtomicAsync(this.resultsPath, serializeL2(this.l2));
                await writeFileAtomicAsync(this.pathsPath, serializePaths(this.l2ByPath));
                this.appendedL2Count = 0;
            } else {
                await appendLinesSafeAsync(this.resultsPath, serializeL2(batch));
                await appendLinesSafeAsync(this.pathsPath, serializeDirtyPaths(batch.values()));
                this.appendedL2Count += batch.size;
            }
            await flushArc2L2Async(
                this.arc2Paths,
                this.l2.values(),
                batch.values(),
                isRewrite,
                this.arc2Opts,
            );
            this.l2PersistedRemovalGeneration = removalGeneration;
        } catch (error) {
            this.restoreInterruptedL2Batch(batch);
            throw error;
        }
    }

    /**
     * Serialize writers and drain requests received during an active flush. Failed batches remain
     * dirty for retry; newer values take precedence when restoring an interrupted batch.
     */
    flushCacheToDiskAsync(): Promise<void> {
        this.flushRequested = true;
        if (this.flushInFlight) return this.flushInFlight;
        this.flushInFlight = Promise.resolve()
            .then(async () => {
                do {
                    this.flushRequested = false;
                    try {
                        await this.l1Journal.publishCheckpointAsync();
                        this.lastFlushError = this.l1Journal.lastError;
                        if (!this.executeFlushPreparation()) break;
                        await this.flushL1Async();
                        await this.flushL2Async();
                        this.lastFlushError = this.l1Journal.lastError;
                    } catch (error) {
                        this.lastFlushError = error;
                        break;
                    }
                } while (this.flushRequested);
            })
            .finally(() => {
                this.flushInFlight = undefined;
            });
        return this.flushInFlight;
    }

    async flushAsync(): Promise<void> {
        await this.flushCacheToDiskAsync();
    }

    /** Drain both queued writes and any background checkpoint before an orderly shutdown. */
    async settleAsync(): Promise<void> {
        await this.flushAsync();
        await this.l1Journal.waitForCheckpoint();
        await this.flushAsync();
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
        if (!this.enabled) return;
        this.executeCleanupIfNeeded();
    }

    private removeSecondaryCacheEntry(entryRecord: L2Entry): void {
        if (!this.l2.delete(entryRecord.k)) return;
        this.dirtyL2.delete(entryRecord.k);
        this.l2RemovalGeneration++;
        if (this.flushInFlight) this.flushRequested = true;
        const pathKey = this.getEntryPathKey(entryRecord);
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

        const sorted = [...this.l2.values()].sort((entryA, entryB) => entryA.ts - entryB.ts);
        for (const entryRecord of sorted) {
            if (excess <= 0) break;
            this.removeSecondaryCacheEntry(entryRecord);
            excess--;
        }
    }

    clear(): boolean {
        if (this.flushInFlight || this.l1Journal.busy) return false;
        try {
            if (!removeCacheDir(this.dir)) return false;
            this.resetMemoryMaps();
            this.l1Journal.reset();
            this.appendedL1Count = 0;
            this.appendedL2Count = 0;
            this.enabled = this.initializeCache();
            if (this.enabled) this.runRebuildCacheManifest();
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
        if (!this.enabled) {
            return { l1: 0, l2: 0, l2LoadLevel: this.l2LoadLevel };
        }
        return this.getCacheMetrics();
    }

    getLoadLevel(): 'full' | 'hot' | 'metadata' | 'disabled' {
        return this.l2LoadLevel;
    }

    dumpCacheState(): string {
        return canonicalJson({ l1: [...this.l1.entries()], l2: [...this.l2.values()] });
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
