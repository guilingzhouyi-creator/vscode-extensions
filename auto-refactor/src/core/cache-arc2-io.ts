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
    ARC2_KIND_STORE,
    ARC2_KIND_WAL,
    ensureL2EntryDecoded,
    loadArc2L1Index,
    loadArc2L2Container,
    serializeArc2L1Index,
    serializeArc2L2Container,
    serializeArc2L2FramesOnly,
} from './cache-arc2';

export { ensureL2EntryDecoded };

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
        let syncedJsonlBytes = 0;
        const storeHeader = loadArc2L2Container(storeBuf, onEntry, true);
        if (!storeHeader) return false;
        syncedJsonlBytes = storeHeader.legacyJsonlBytes;

        if (SyncIoBarrier.exists(walPath)) {
            const walBuf = SyncIoBarrier.readBytes(walPath);
            const walHeader = loadArc2L2Container(walBuf, onEntry, true);
            if (walHeader && walHeader.legacyJsonlBytes > syncedJsonlBytes) {
                syncedJsonlBytes = walHeader.legacyJsonlBytes;
            }
        }

        const currentJsonlBytes = SyncIoBarrier.statSize(resultsPath);
        if (currentJsonlBytes > syncedJsonlBytes && syncedJsonlBytes >= 0) {
            onOutdated?.();
        }
        return true;
    } catch {
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
    const storeBuf = serializeArc2L2Container(entriesList, ARC2_KIND_STORE, {
        maxEntries: opts.maxEntries,
        maxAgeDays: opts.maxAgeDays,
        legacyJsonlBytes: jsonlSize,
    });
    writeBytesAtomic(paths.l2StoreArcPath, storeBuf);
    SyncIoBarrier.remove(paths.l2DeltaWalPath);
}

/**
 * Synchronously appends dirty L2 entries to the delta WAL (or initializes it).
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
    if (!SyncIoBarrier.exists(paths.l2DeltaWalPath)) {
        const walBuf = serializeArc2L2Container(dirtyList, ARC2_KIND_WAL, {
            maxEntries: opts.maxEntries,
            maxAgeDays: opts.maxAgeDays,
            legacyJsonlBytes: jsonlSize,
        });
        writeBytesAtomic(paths.l2DeltaWalPath, walBuf);
    } else {
        appendBytesSafe(paths.l2DeltaWalPath, serializeArc2L2FramesOnly(dirtyList));
    }
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
        await writeBytesAtomicAsync(
            paths.l2StoreArcPath,
            serializeArc2L2Container(entriesList, ARC2_KIND_STORE, {
                maxEntries: opts.maxEntries,
                maxAgeDays: opts.maxAgeDays,
                legacyJsonlBytes: jsonlSize,
            }),
        );
        SyncIoBarrier.remove(paths.l2DeltaWalPath);
    } else {
        const dirtyList = Array.from(dirtyEntries);
        if (!SyncIoBarrier.exists(paths.l2DeltaWalPath)) {
            await writeBytesAtomicAsync(
                paths.l2DeltaWalPath,
                serializeArc2L2Container(dirtyList, ARC2_KIND_WAL, {
                    maxEntries: opts.maxEntries,
                    maxAgeDays: opts.maxAgeDays,
                    legacyJsonlBytes: jsonlSize,
                }),
            );
        } else {
            await appendBytesSafeAsync(paths.l2DeltaWalPath, serializeArc2L2FramesOnly(dirtyList));
        }
    }
}
