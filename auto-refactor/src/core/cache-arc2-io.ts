/**
 * Module: Core Engine — ARC2 Binary Cache Persistence & I/O Coordinator
 * File Path: src/core/cache-arc2-io.ts
 * Architecture Role: Coordinates binary disk persistence, atomic snapshot writing,
 *   and append-only delta logging for the ARC2 container format.
 * Dependencies & Triggers: ./cache, ./cache-persistence, ./cache-arc2;
 *   invoked by CacheStore during binary load, flush, and compaction cycles.
 * Responsibilities:
 *   1. Atomic snapshot writing for L1 index (`l1-index.aridx`) and L2 store (`l2-store.arc`).
 *   2. Append-only delta WAL logging (`l2-delta.arwal`) for fast incremental writes.
 *   3. Deserialization and fallback synchronization from disk.
 * Exit Semantics & Design Rationale: DeCouples binary file I/O operations from CacheStore logic
 *   while maintaining strict atomic write safety and fallback recovery.
 */

import * as fs from 'fs';
import type { Fingerprint } from './cache';
import {
    SyncIoBarrier,
    writeBytesAtomic,
    writeBytesAtomicAsync,
    appendBytesSafe,
    appendBytesSafeAsync,
    type L2EntryRecord,
} from './cache-persistence';
import {
    ARC2_HEADER_BYTES,
    ARC2_KIND_STORE,
    ARC2_KIND_WAL,
    decodeArc2Header,
    ensureL2EntryDecoded,
    loadArc2L1Index,
    loadArc2L2Container,
    serializeArc2L1Index,
    serializeArc2L2Container,
    serializeArc2L2FramesOnly,
} from './cache-arc2';

export { ensureL2EntryDecoded };

const Arc2SyncFsBarrier = {
    openReadSync: (filePath: string): number => fs['openSync'](filePath, 'r'),
    readSync: (fd: number, buf: Buffer, offset: number, length: number, pos: number): number =>
        fs['readSync'](fd, buf, offset, length, pos),
    closeSync: (fd: number): void => fs['closeSync'](fd),
    truncateSync: (filePath: string, len: number): void => fs['truncateSync'](filePath, len),
};

const NOOP_L2_ENTRY = (_entry: L2EntryRecord): void => {};

function readArc2StoreGenerationSync(storePath: string): number {
    if (!SyncIoBarrier.exists(storePath)) return 0;
    let fd: number | undefined;
    try {
        fd = Arc2SyncFsBarrier.openReadSync(storePath);
        const buf = Buffer.allocUnsafe(ARC2_HEADER_BYTES);
        const bytesRead = Arc2SyncFsBarrier.readSync(fd, buf, 0, ARC2_HEADER_BYTES, 0);
        if (bytesRead < ARC2_HEADER_BYTES) return 0;
        const header = decodeArc2Header(buf, ARC2_KIND_STORE);
        return header ? header.storeGeneration : 0;
    } catch {
        return 0;
    } finally {
        if (fd !== undefined) {
            try {
                Arc2SyncFsBarrier.closeSync(fd);
            } catch {
                /* best-effort close */
            }
        }
    }
}

async function readArc2StoreGenerationAsync(storePath: string): Promise<number> {
    let handle: fs.promises.FileHandle | undefined;
    try {
        handle = await fs.promises.open(storePath, 'r');
        const buf = Buffer.allocUnsafe(ARC2_HEADER_BYTES);
        const { bytesRead } = await handle.read(buf, 0, ARC2_HEADER_BYTES, 0);
        if (bytesRead < ARC2_HEADER_BYTES) return 0;
        const header = decodeArc2Header(buf, ARC2_KIND_STORE);
        return header ? header.storeGeneration : 0;
    } catch {
        return 0;
    } finally {
        if (handle !== undefined) {
            try {
                await handle.close();
            } catch {
                /* best-effort close */
            }
        }
    }
}

function nextArc2StoreGeneration(previousGeneration: number): number {
    const next = ((previousGeneration >>> 0) + 1) >>> 0;
    return next === 0 ? 1 : next;
}

function isWalAlignedWithStore(walGeneration: number, storeGeneration: number): boolean {
    if (storeGeneration === 0) return walGeneration === 0;
    return walGeneration === storeGeneration;
}

/** Path bundle required for ARC2 container disk coordination. */
export interface Arc2SyncPaths {
    l1IndexArcPath: string;
    l2StoreArcPath: string;
    l2DeltaWalPath: string;
    fingerprintsPath: string;
    resultsPath: string;
}

/** Retention and size bounds metadata encoded into container headers. */
export interface Arc2SyncOptions {
    maxEntries: number;
    maxAgeDays: number;
}

/**
 * Attempts to load the binary L1 index from disk into the target fingerprint map.
 *
 * @param l1IndexPath - Path to the `l1-index.aridx` file.
 * @param fingerprintsPath - Path to the fallback `fingerprints.jsonl`.
 * @param targetMap - Map populated with loaded fingerprints.
 * @param onOutdated - Callback invoked when fallback jsonl has newer appended bytes.
 * @returns True if successfully loaded and parsed.
 */
export function tryLoadArc2L1Index(
    l1IndexPath: string,
    fingerprintsPath: string,
    targetMap: Map<string, Fingerprint>,
    onOutdated?: () => void,
): boolean {
    if (!SyncIoBarrier.exists(l1IndexPath)) return false;
    try {
        const buf = SyncIoBarrier.readBytes(l1IndexPath);
        const header = loadArc2L1Index(buf, targetMap);
        if (!header) return false;
        const jsonlSize = SyncIoBarrier.statSize(fingerprintsPath);
        if (jsonlSize > header.legacyJsonlBytes && header.legacyJsonlBytes >= 0) {
            onOutdated?.();
        }
        return true;
    } catch {
        return false;
    }
}

function replayAlignedWalSync(
    walPath: string,
    storeGeneration: number,
    syncedJsonlBytes: number,
    onEntry: (entry: L2EntryRecord) => void,
): number {
    if (!SyncIoBarrier.exists(walPath)) return syncedJsonlBytes;
    const walBuf = SyncIoBarrier.readBytes(walPath);
    const walHeader = decodeArc2Header(walBuf, ARC2_KIND_WAL);
    if (!walHeader || !isWalAlignedWithStore(walHeader.storeGeneration, storeGeneration)) {
        return syncedJsonlBytes;
    }
    const walResult = loadArc2L2Container(walBuf, onEntry, true);
    if (walResult && walResult.header.legacyJsonlBytes > syncedJsonlBytes) {
        return walResult.header.legacyJsonlBytes;
    }
    return syncedJsonlBytes;
}

/**
 * Attempts to load the binary L2 store and delta WAL from disk into the store.
 *
 * @param storePath - Path to `l2-store.arc`.
 * @param walPath - Path to `l2-delta.arwal`.
 * @param resultsPath - Path to fallback `results.jsonl`.
 * @param maxLoadBytes - Maximum permissible container byte size.
 * @param onEntry - Callback invoked for each validated L2 record.
 * @param onOutdated - Callback invoked when fallback jsonl has newer appended bytes.
 * @returns True if the store container was loaded successfully.
 */
export function tryLoadArc2L2Container(
    storePath: string,
    walPath: string,
    resultsPath: string,
    maxLoadBytes: number,
    onEntry: (entry: L2EntryRecord) => void,
    onOutdated?: () => void,
): boolean {
    if (!SyncIoBarrier.exists(storePath)) return false;
    try {
        const storeBuf = SyncIoBarrier.readBytes(storePath);
        if (storeBuf.length > maxLoadBytes * 2) return false;
        const storeResult = loadArc2L2Container(storeBuf, onEntry, true);
        if (!storeResult) return false;

        const syncedJsonlBytes = replayAlignedWalSync(
            walPath,
            storeResult.header.storeGeneration,
            storeResult.header.legacyJsonlBytes,
            onEntry,
        );
        const currentJsonlBytes = SyncIoBarrier.statSize(resultsPath);
        if (currentJsonlBytes > syncedJsonlBytes && syncedJsonlBytes >= 0) {
            onOutdated?.();
        }
        return true;
    } catch (error) {
        /* Expected: corrupt containers fall back cleanly to JSONL recovery */
        void error;
        return false;
    }
}

/**
 * Synchronously writes a complete ARC2 L1 snapshot atomically.
 *
 * @param paths - Container path bundle.
 * @param l1Map - Current in-memory L1 fingerprint index.
 * @param opts - Container retention limits.
 */
export function writeArc2L1SnapshotSync(
    paths: Arc2SyncPaths,
    l1Map: Map<string, Fingerprint>,
    opts: Arc2SyncOptions,
): void {
    const jsonlSize = Math.max(0, SyncIoBarrier.statSize(paths.fingerprintsPath));
    const arcBuf = serializeArc2L1Index(l1Map, {
        maxEntries: opts.maxEntries,
        maxAgeDays: opts.maxAgeDays,
        legacyJsonlBytes: jsonlSize,
    });
    writeBytesAtomic(paths.l1IndexArcPath, arcBuf);
}

/**
 * Synchronously writes a complete compacted ARC2 L2 store atomically and removes the delta WAL.
 *
 * @param paths - Container path bundle.
 * @param l2Entries - Complete collection of active L2 entry records.
 * @param opts - Container retention limits.
 */
export function writeArc2L2SnapshotSync(
    paths: Arc2SyncPaths,
    l2Entries: Iterable<L2EntryRecord>,
    opts: Arc2SyncOptions,
): void {
    const entriesList = Array.from(l2Entries);
    for (const entry of entriesList) {
        ensureL2EntryDecoded(entry);
    }
    const jsonlSize = Math.max(0, SyncIoBarrier.statSize(paths.resultsPath));
    const prevGeneration = readArc2StoreGenerationSync(paths.l2StoreArcPath);
    const storeGeneration = nextArc2StoreGeneration(prevGeneration);
    const storeBuf = serializeArc2L2Container(entriesList, ARC2_KIND_STORE, {
        maxEntries: opts.maxEntries,
        maxAgeDays: opts.maxAgeDays,
        legacyJsonlBytes: jsonlSize,
        storeGeneration,
    });
    writeBytesAtomic(paths.l2StoreArcPath, storeBuf);
    SyncIoBarrier.remove(paths.l2DeltaWalPath);
}

function tryAppendExistingWalSync(
    walPath: string,
    storeGeneration: number,
    dirtyList: L2EntryRecord[],
): boolean {
    if (!SyncIoBarrier.exists(walPath)) return false;
    try {
        const walBuf = SyncIoBarrier.readBytes(walPath);
        const loaded = loadArc2L2Container(walBuf, NOOP_L2_ENTRY, true);
        if (!loaded || !isWalAlignedWithStore(loaded.header.storeGeneration, storeGeneration)) {
            return false;
        }
        if (loaded.validBytes < walBuf.length) {
            Arc2SyncFsBarrier.truncateSync(walPath, loaded.validBytes);
        }
        appendBytesSafe(walPath, serializeArc2L2FramesOnly(dirtyList));
        return true;
    } catch (error) {
        /* Expected: corrupt or unreadable WAL triggers clean atomic replacement below */
        void error;
        return false;
    }
}

/**
 * Synchronously appends dirty L2 entries to the delta WAL (or initializes it).
 * Truncate-repairs any torn tail and replaces stale-generation or corrupt WAL files
 * before appending new frames.
 *
 * @param paths - Container path bundle.
 * @param dirtyEntries - Dirty L2 entries to append.
 * @param opts - Container retention limits.
 */
export function appendArc2L2WalSync(
    paths: Arc2SyncPaths,
    dirtyEntries: Iterable<L2EntryRecord>,
    opts: Arc2SyncOptions,
): void {
    const dirtyList = Array.from(dirtyEntries);
    const jsonlSize = Math.max(0, SyncIoBarrier.statSize(paths.resultsPath));
    const storeGeneration = readArc2StoreGenerationSync(paths.l2StoreArcPath);
    if (tryAppendExistingWalSync(paths.l2DeltaWalPath, storeGeneration, dirtyList)) {
        return;
    }

    const walBuf = serializeArc2L2Container(dirtyList, ARC2_KIND_WAL, {
        maxEntries: opts.maxEntries,
        maxAgeDays: opts.maxAgeDays,
        legacyJsonlBytes: jsonlSize,
        storeGeneration,
    });
    writeBytesAtomic(paths.l2DeltaWalPath, walBuf);
}

/**
 * Asynchronously writes an ARC2 L1 index snapshot atomically.
 *
 * @param paths - Container path bundle.
 * @param l1Map - Current in-memory L1 fingerprint index.
 * @param opts - Container retention limits.
 */
export async function flushArc2L1Async(
    paths: Arc2SyncPaths,
    l1Map: Map<string, Fingerprint>,
    opts: Arc2SyncOptions,
): Promise<void> {
    const jsonlSize = Math.max(0, SyncIoBarrier.statSize(paths.fingerprintsPath));
    await writeBytesAtomicAsync(
        paths.l1IndexArcPath,
        serializeArc2L1Index(l1Map, {
            maxEntries: opts.maxEntries,
            maxAgeDays: opts.maxAgeDays,
            legacyJsonlBytes: jsonlSize,
        }),
    );
}

async function tryAppendExistingWalAsync(
    walPath: string,
    storeGeneration: number,
    dirtyList: L2EntryRecord[],
): Promise<boolean> {
    if (!SyncIoBarrier.exists(walPath)) return false;
    try {
        const walBuf = await fs.promises.readFile(walPath);
        const loaded = loadArc2L2Container(walBuf, NOOP_L2_ENTRY, true);
        if (!loaded || !isWalAlignedWithStore(loaded.header.storeGeneration, storeGeneration)) {
            return false;
        }
        if (loaded.validBytes < walBuf.length) {
            await fs.promises.truncate(walPath, loaded.validBytes);
        }
        const frames = serializeArc2L2FramesOnly(dirtyList);
        await appendBytesSafeAsync(walPath, frames);
        return true;
    } catch (error) {
        /* Expected: corrupt or unreadable WAL triggers clean atomic replacement below */
        void error;
        return false;
    }
}

/**
 * Asynchronously flushes ARC2 L2 either via full snapshot compaction or delta WAL append.
 *
 * @param paths - Container path bundle.
 * @param l2Entries - Complete collection of active L2 entry records.
 * @param dirtyEntries - Dirty L2 entries awaiting persistence.
 * @param isRewrite - Whether to execute full snapshot compaction rewrite.
 * @param opts - Container retention limits.
 */
export async function flushArc2L2Async(
    paths: Arc2SyncPaths,
    l2Entries: Iterable<L2EntryRecord>,
    dirtyEntries: Iterable<L2EntryRecord>,
    isRewrite: boolean,
    opts: Arc2SyncOptions,
): Promise<void> {
    const jsonlSize = Math.max(0, SyncIoBarrier.statSize(paths.resultsPath));
    if (isRewrite) {
        const entriesList = Array.from(l2Entries);
        for (const entry of entriesList) {
            ensureL2EntryDecoded(entry);
        }
        const storeGeneration = nextArc2StoreGeneration(
            await readArc2StoreGenerationAsync(paths.l2StoreArcPath),
        );
        await writeBytesAtomicAsync(
            paths.l2StoreArcPath,
            serializeArc2L2Container(entriesList, ARC2_KIND_STORE, {
                maxEntries: opts.maxEntries,
                maxAgeDays: opts.maxAgeDays,
                legacyJsonlBytes: jsonlSize,
                storeGeneration,
            }),
        );
        SyncIoBarrier.remove(paths.l2DeltaWalPath);
        return;
    }

    const dirtyList = Array.from(dirtyEntries);
    const storeGeneration = await readArc2StoreGenerationAsync(paths.l2StoreArcPath);
    if (await tryAppendExistingWalAsync(paths.l2DeltaWalPath, storeGeneration, dirtyList)) {
        return;
    }

    await writeBytesAtomicAsync(
        paths.l2DeltaWalPath,
        serializeArc2L2Container(dirtyList, ARC2_KIND_WAL, {
            maxEntries: opts.maxEntries,
            maxAgeDays: opts.maxAgeDays,
            legacyJsonlBytes: jsonlSize,
            storeGeneration,
        }),
    );
}
