/**
 * Module: Core Engine — ARC2 Binary Disk Cache Codec & Lazy Frame Store
 * File Path: src/core/cache-arc2.ts
 * Architecture Role: Custom Little-Endian binary persistence engine for L1 (`l1-index.aridx`),
 *   L2 compacted store (`l2-store.arc`), and L2 append-only WAL (`l2-delta.arwal`).
 * Dependencies & Triggers: crypto, ./types, ./cache, ./cache-persistence, ./result-codec;
 *   invoked by CacheStore during binary load, incremental WAL flush, and zero-reencode compaction.
 * Responsibilities: Encode and validate 64-byte ARC2 headers, serialize/parse 80-byte fixed-stride
 *   L1 index slots with string pool, frame L2 records with 24-byte FRM2 headers + PR50 payloads,
 *   and lazily decode L2 payload slices on cache hits.
 * Exit Semantics & Design Rationale: Corrupt headers, truncated frames, or checksum mismatches
 *   return null/skip cleanly without throwing so CacheStore degrades gracefully to cold scan.
 */

import * as crypto from 'crypto';
import type { Fingerprint } from './cache';
import type { L2EntryRecord } from './cache-persistence';
import {
    encodeSingleFileResult,
    decodeSingleFileResultBuffer,
    type FileResult,
} from './result-codec';

/** Little-endian u32 magic for "ARC2" (0x41 0x52 0x43 0x32). */
export const ARC2_MAGIC = 0x32435241;
/** Current ARC2 binary container specification version. */
export const ARC2_VERSION = 2;
/** Little-endian u32 magic for "FRM2" L2 record frames (0x46 0x52 0x4d 0x32). */
export const ARC2_FRAME_MAGIC = 0x324d5246;

/** Container kind identifier for the L1 path-to-fingerprint index (`l1-index.aridx`). */
export const ARC2_KIND_INDEX = 1;
/** Container kind identifier for the compacted L2 result store (`l2-store.arc`). */
export const ARC2_KIND_STORE = 2;
/** Container kind identifier for the append-only L2 delta log (`l2-delta.arwal`). */
export const ARC2_KIND_WAL = 3;

/** Fixed byte size of the unified ARC2 container header. */
export const ARC2_HEADER_BYTES = 64;
/** Fixed byte size of each L1 index slot entry. */
export const ARC2_SLOT_BYTES = 80;
/** Fixed byte size of each L2 FRM2 frame header. */
export const ARC2_FRAME_HEADER_BYTES = 24;

/** Section bitmask flag indicating the frame carries an issues list. */
export const SECTION_MASK_ISSUES = 1 << 0;
/** Section bitmask flag indicating the frame carries a non-null FileMetric. */
export const SECTION_MASK_METRIC = 1 << 1;
/** Section bitmask flag indicating the frame carries cross-file symbol entries. */
export const SECTION_MASK_SYMBOLS = 1 << 2;
/** Section bitmask flag indicating the frame carries cross-file literal occurrences. */
export const SECTION_MASK_LITERALS = 1 << 3;
/** Section bitmask flag indicating the frame carries loop site complexity descriptors. */
export const SECTION_MASK_LOOP_SITES = 1 << 4;
/** Section bitmask flag indicating the frame carries module dependency graph edges. */
export const SECTION_MASK_GRAPH_EDGES = 1 << 5;

const HASH_PREFIX_BYTES = 16;
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const UINT16_MASK = 0xffff;
const DEFAULT_MAX_AGE_DAYS = 30;
const HEADER_OFFSET_VERSION = 4;
const HEADER_OFFSET_KIND = 6;
const HEADER_OFFSET_RECORD_COUNT = 8;
const HEADER_OFFSET_STRING_POOL = 12;
const HEADER_OFFSET_LEGACY_JSONL = 16;
const HEADER_OFFSET_STORE_GEN = 20;
const HEADER_OFFSET_CREATED_AT = 24;
const HEADER_OFFSET_MAX_ENTRIES = 32;
const HEADER_OFFSET_MAX_AGE_DAYS = 36;
const HEADER_OFFSET_CHECKSUM = 40;
const SLOT_OFFSET_CONTENT_HASH = 16;
const SLOT_OFFSET_RESERVED_A = 32;
const SLOT_OFFSET_MTIME = 40;
const SLOT_OFFSET_SIZE = 48;
const SLOT_OFFSET_INO = 56;
const SLOT_OFFSET_RESERVED_B = 64;
const SLOT_OFFSET_FLAGS = 72;
const SLOT_OFFSET_STR_START = 76;
const FRAME_OFFSET_PAYLOAD_LEN = 4;
const FRAME_OFFSET_CRC = 8;
const FRAME_OFFSET_MASK = 12;
const FRAME_OFFSET_TIMESTAMP = 16;
const FRAME_META_FIXED_BYTES = 18;
const U32_BYTES = 4;
const F64_BYTES = 8;

/** Parsed 64-byte ARC2 container header. */
export interface Arc2Header {
    magic: number;
    version: number;
    kind: number;
    recordCount: number;
    stringPoolOffset: number;
    legacyJsonlBytes: number;
    storeGeneration: number;
    createdAtMs: number;
    maxEntries: number;
    maxAgeDays: number;
    headerChecksum: number;
}

/** Input parameters for building a 64-byte ARC2 header. */
export interface Arc2HeaderInit {
    kind: number;
    recordCount: number;
    stringPoolOffset?: number;
    legacyJsonlBytes?: number;
    storeGeneration?: number;
    createdAtMs?: number;
    maxEntries?: number;
    maxAgeDays?: number;
}

/** Optional metadata parameters when serializing ARC2 containers. */
export interface Arc2ContainerMeta {
    maxEntries?: number;
    maxAgeDays?: number;
    legacyJsonlBytes?: number;
    storeGeneration?: number;
}

/**
 * Validated ARC2 L2 container header and byte offset immediately following the last valid frame.
 */
export interface Arc2L2LoadResult {
    header: Arc2Header;
    validBytes: number;
}

/**
 * Compute fast deterministic 32-bit FNV-1a checksum over a byte range.
 *
 * @param buf - Source binary buffer.
 * @param start - Inclusive start byte offset.
 * @param end - Exclusive end byte offset.
 * @returns Unsigned 32-bit FNV-1a hash value.
 */
export function computeBufferChecksum(buf: Buffer, start = 0, end = buf.length): number {
    let hash = FNV_OFFSET_BASIS;
    for (let i = start; i < end; i++) {
        hash ^= buf[i];
        hash = Math.imul(hash, FNV_PRIME) >>> 0;
    }
    return hash >>> 0;
}

/**
 * Encode a 64-byte Little-Endian ARC2 header.
 *
 * @param init - Header initialization fields.
 * @returns 64-byte Buffer containing the serialized ARC2 header.
 */
export function encodeArc2Header(init: Arc2HeaderInit): Buffer {
    const header = Buffer.alloc(ARC2_HEADER_BYTES);
    header.writeUInt32LE(ARC2_MAGIC, 0);
    header.writeUInt16LE(ARC2_VERSION, HEADER_OFFSET_VERSION);
    header.writeUInt16LE(init.kind & UINT16_MASK, HEADER_OFFSET_KIND);
    header.writeUInt32LE(init.recordCount >>> 0, HEADER_OFFSET_RECORD_COUNT);
    header.writeUInt32LE((init.stringPoolOffset ?? 0) >>> 0, HEADER_OFFSET_STRING_POOL);
    header.writeUInt32LE((init.legacyJsonlBytes ?? 0) >>> 0, HEADER_OFFSET_LEGACY_JSONL);
    header.writeUInt32LE((init.storeGeneration ?? 0) >>> 0, HEADER_OFFSET_STORE_GEN);
    header.writeDoubleLE(init.createdAtMs ?? Date.now(), HEADER_OFFSET_CREATED_AT);
    header.writeUInt32LE((init.maxEntries ?? 100_000) >>> 0, HEADER_OFFSET_MAX_ENTRIES);
    header.writeUInt32LE(
        (init.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS) >>> 0,
        HEADER_OFFSET_MAX_AGE_DAYS,
    );
    const checksum = computeBufferChecksum(header, 0, HEADER_OFFSET_CHECKSUM);
    header.writeUInt32LE(checksum, HEADER_OFFSET_CHECKSUM);
    return header;
}

/**
 * Validate and decode a 64-byte Little-Endian ARC2 header in O(1).
 *
 * @param buf - Buffer containing the candidate ARC2 container.
 * @param expectedKind - Optional container kind identifier to enforce.
 * @returns Decoded Arc2Header or null if magic, version, kind, or checksum fails.
 */
export function decodeArc2Header(buf: Buffer, expectedKind?: number): Arc2Header | null {
    if (buf.length < ARC2_HEADER_BYTES) return null;
    const magic = buf.readUInt32LE(0);
    const version = buf.readUInt16LE(HEADER_OFFSET_VERSION);
    const kind = buf.readUInt16LE(HEADER_OFFSET_KIND);
    if (magic !== ARC2_MAGIC || version !== ARC2_VERSION) return null;
    if (expectedKind !== undefined && kind !== expectedKind) return null;
    const expectedChecksum = computeBufferChecksum(buf, 0, HEADER_OFFSET_CHECKSUM);
    const headerChecksum = buf.readUInt32LE(HEADER_OFFSET_CHECKSUM);
    if (expectedChecksum !== headerChecksum) return null;
    return {
        magic,
        version,
        kind,
        recordCount: buf.readUInt32LE(HEADER_OFFSET_RECORD_COUNT),
        stringPoolOffset: buf.readUInt32LE(HEADER_OFFSET_STRING_POOL),
        legacyJsonlBytes: buf.readUInt32LE(HEADER_OFFSET_LEGACY_JSONL),
        storeGeneration: buf.readUInt32LE(HEADER_OFFSET_STORE_GEN),
        createdAtMs: buf.readDoubleLE(HEADER_OFFSET_CREATED_AT),
        maxEntries: buf.readUInt32LE(HEADER_OFFSET_MAX_ENTRIES),
        maxAgeDays: buf.readUInt32LE(HEADER_OFFSET_MAX_AGE_DAYS),
        headerChecksum,
    };
}

function writeHashPrefix16(target: Buffer, offset: number, text: string): void {
    const digest = crypto.createHash('sha256').update(text).digest();
    digest.copy(target, offset, 0, HASH_PREFIX_BYTES);
}

/**
 * Serialize L1 fingerprint map into `l1-index.aridx` binary format (64B header + 80B slots).
 *
 * @param l1Cache - Map of normalized relative paths to L1 fingerprints.
 * @param meta - Optional container metadata overrides.
 * @returns Complete binary buffer for `l1-index.aridx`.
 */
export function serializeArc2L1Index(
    l1Cache: Map<string, Fingerprint>,
    meta: Arc2ContainerMeta = {},
): Buffer {
    const entries = [...l1Cache.entries()];
    const recordCount = entries.length;
    const slotsBytes = recordCount * ARC2_SLOT_BYTES;
    const stringPoolOffset = ARC2_HEADER_BYTES + slotsBytes;

    const stringBuffers: Buffer[] = [];
    let currentStrOffset = 0;
    const slots = Buffer.alloc(slotsBytes);

    for (let i = 0; i < recordCount; i++) {
        const [relPath, fp] = entries[i];
        const pathBuf = Buffer.from(relPath, 'utf8');
        stringBuffers.push(pathBuf);

        const slotOffset = i * ARC2_SLOT_BYTES;
        writeHashPrefix16(slots, slotOffset, relPath);
        writeHashPrefix16(
            slots,
            slotOffset + SLOT_OFFSET_CONTENT_HASH,
            `${relPath}:${fp.mtimeMs}:${fp.size}`,
        );
        slots.writeBigUInt64LE(0n, slotOffset + SLOT_OFFSET_RESERVED_A);
        slots.writeDoubleLE(fp.mtimeMs, slotOffset + SLOT_OFFSET_MTIME);
        slots.writeDoubleLE(fp.size, slotOffset + SLOT_OFFSET_SIZE);
        slots.writeDoubleLE(fp.ino !== undefined ? fp.ino : -1, slotOffset + SLOT_OFFSET_INO);
        slots.writeBigUInt64LE(0n, slotOffset + SLOT_OFFSET_RESERVED_B);
        slots.writeUInt32LE(0, slotOffset + SLOT_OFFSET_FLAGS);
        slots.writeUInt32LE(currentStrOffset >>> 0, slotOffset + SLOT_OFFSET_STR_START);
        currentStrOffset += pathBuf.length;
    }

    const header = encodeArc2Header({
        kind: ARC2_KIND_INDEX,
        recordCount,
        stringPoolOffset,
        legacyJsonlBytes: meta.legacyJsonlBytes ?? 0,
        maxEntries: meta.maxEntries,
        maxAgeDays: meta.maxAgeDays,
    });

    return Buffer.concat([header, slots, ...stringBuffers]);
}

/**
 * Load L1 fingerprints from an `l1-index.aridx` buffer into `targetMap`.
 *
 * @param buf - Raw buffer read from `l1-index.aridx`.
 * @param targetMap - Destination map populated with decoded path fingerprints.
 * @returns Validated Arc2Header or null if the buffer is invalid/corrupted.
 */
export function loadArc2L1Index(
    buf: Buffer,
    targetMap: Map<string, Fingerprint>,
): Arc2Header | null {
    const header = decodeArc2Header(buf, ARC2_KIND_INDEX);
    if (!header) return null;
    const expectedSlotsEnd = ARC2_HEADER_BYTES + header.recordCount * ARC2_SLOT_BYTES;
    if (buf.length < expectedSlotsEnd || header.stringPoolOffset < expectedSlotsEnd) {
        return null;
    }

    for (let i = 0; i < header.recordCount; i++) {
        const slotOffset = ARC2_HEADER_BYTES + i * ARC2_SLOT_BYTES;
        const mtimeMs = buf.readDoubleLE(slotOffset + SLOT_OFFSET_MTIME);
        const size = buf.readDoubleLE(slotOffset + SLOT_OFFSET_SIZE);
        const inoVal = buf.readDoubleLE(slotOffset + SLOT_OFFSET_INO);
        const strStart =
            header.stringPoolOffset + buf.readUInt32LE(slotOffset + SLOT_OFFSET_STR_START);
        const nextStrStart =
            i + 1 < header.recordCount
                ? header.stringPoolOffset +
                  buf.readUInt32LE(slotOffset + ARC2_SLOT_BYTES + SLOT_OFFSET_STR_START)
                : buf.length;
        if (strStart > buf.length || nextStrStart > buf.length || nextStrStart < strStart) {
            return null;
        }
        const relPath = buf.toString('utf8', strStart, nextStrStart);
        targetMap.set(relPath, {
            mtimeMs,
            size,
            ...(inoVal >= 0 ? { ino: inoVal } : {}),
        });
    }
    return header;
}

function computeSectionMask(entry: L2EntryRecord): number {
    let mask = SECTION_MASK_ISSUES;
    if (entry.metric !== null && entry.metric !== undefined) mask |= SECTION_MASK_METRIC;
    if (entry.symbols !== undefined) mask |= SECTION_MASK_SYMBOLS;
    if (entry.literals !== undefined) mask |= SECTION_MASK_LITERALS;
    if (entry.loopSites !== undefined) mask |= SECTION_MASK_LOOP_SITES;
    if (entry.graphEdges !== undefined) mask |= SECTION_MASK_GRAPH_EDGES;
    return mask >>> 0;
}

/**
 * Ensure an L2EntryRecord whose payload was lazily mapped from disk is decoded in memory.
 *
 * @param entry - L2 cache record to materialize in place.
 * @returns True if decoded (or already decoded), false if payload was corrupted.
 */
export function ensureL2EntryDecoded(entry: L2EntryRecord): boolean {
    if (entry.decoded !== false || !entry.rawPr50Slice) return true;
    try {
        const decoded: FileResult = decodeSingleFileResultBuffer(entry.rawPr50Slice);
        entry.issues = decoded.issues;
        entry.metric = decoded.metric;
        if (decoded.symbols !== undefined) {
            entry.symbols = decoded.symbols as L2EntryRecord['symbols'];
        }
        if (decoded.literals !== undefined) {
            entry.literals = decoded.literals as L2EntryRecord['literals'];
        }
        if (decoded.loopSites !== undefined) {
            entry.loopSites = decoded.loopSites as L2EntryRecord['loopSites'];
        }
        if (decoded.graphEdges !== undefined) {
            entry.graphEdges = decoded.graphEdges as L2EntryRecord['graphEdges'];
        }
        entry.decoded = true;
        return true;
    } catch {
        return false;
    }
}

/**
 * Build a single framed binary record (24B FRM2 header + envelope + PR50 slice) for an L2 entry.
 * Reuses `entry.rawPr50Slice` via zero-reencode copy when the entry was never mutated.
 *
 * @param entry - L2 cache record to frame.
 * @returns Framed binary buffer ready for `.arc` or `.arwal` persistence.
 */
export function encodeArc2L2Frame(entry: L2EntryRecord): Buffer {
    const pr50Slice =
        entry.rawPr50Slice ??
        encodeSingleFileResult({
            file: entry.p,
            issues: entry.issues,
            metric: entry.metric,
            symbols: entry.symbols,
            literals: entry.literals,
            loopSites: entry.loopSites,
            graphEdges: entry.graphEdges,
        });
    entry.rawPr50Slice = pr50Slice;

    const keyBuf = Buffer.from(entry.k, 'utf8');
    const pathBuf = Buffer.from(entry.p, 'utf8');
    const metaBytes =
        U32_BYTES + keyBuf.length + U32_BYTES + pathBuf.length + FRAME_META_FIXED_BYTES;
    const payloadByteLen = metaBytes + pr50Slice.length;

    const frame = Buffer.allocUnsafe(ARC2_FRAME_HEADER_BYTES + payloadByteLen);
    let pos = ARC2_FRAME_HEADER_BYTES;

    frame.writeUInt32LE(keyBuf.length, pos);
    pos += U32_BYTES;
    keyBuf.copy(frame, pos);
    pos += keyBuf.length;

    frame.writeUInt32LE(pathBuf.length, pos);
    pos += U32_BYTES;
    pathBuf.copy(frame, pos);
    pos += pathBuf.length;

    const hasFm = typeof entry.fm === 'number';
    const hasFs = typeof entry.fs === 'number';
    frame[pos++] = (hasFm ? 1 : 0) | (hasFs ? 2 : 0);
    frame[pos++] = 0;
    frame.writeDoubleLE(hasFm ? (entry.fm as number) : 0, pos);
    pos += F64_BYTES;
    frame.writeDoubleLE(hasFs ? (entry.fs as number) : 0, pos);
    pos += F64_BYTES;

    pr50Slice.copy(frame, pos);

    const crc = computeBufferChecksum(
        frame,
        ARC2_FRAME_HEADER_BYTES,
        ARC2_FRAME_HEADER_BYTES + payloadByteLen,
    );
    frame.writeUInt32LE(ARC2_FRAME_MAGIC, 0);
    frame.writeUInt32LE(payloadByteLen >>> 0, FRAME_OFFSET_PAYLOAD_LEN);
    frame.writeUInt32LE(crc >>> 0, FRAME_OFFSET_CRC);
    frame.writeUInt32LE(computeSectionMask(entry), FRAME_OFFSET_MASK);
    frame.writeDoubleLE(entry.ts || Date.now(), FRAME_OFFSET_TIMESTAMP);

    return frame;
}

/**
 * Serialize a collection of L2 entries into a complete `.arc` or `.arwal` container buffer.
 *
 * @param entries - Iterable collection of L2 cache records.
 * @param kind - Container kind (`ARC2_KIND_STORE` or `ARC2_KIND_WAL`).
 * @param meta - Optional container metadata overrides.
 * @returns Complete binary container buffer with 64-byte ARC2 header and framed records.
 */
export function serializeArc2L2Container(
    entries: Iterable<L2EntryRecord>,
    kind: typeof ARC2_KIND_STORE | typeof ARC2_KIND_WAL,
    meta: Arc2ContainerMeta = {},
): Buffer {
    const frames: Buffer[] = [];
    let count = 0;
    for (const entry of entries) {
        frames.push(encodeArc2L2Frame(entry));
        count++;
    }
    const header = encodeArc2Header({
        kind,
        recordCount: count,
        legacyJsonlBytes: meta.legacyJsonlBytes ?? 0,
        storeGeneration: meta.storeGeneration ?? 0,
        maxEntries: meta.maxEntries,
        maxAgeDays: meta.maxAgeDays,
    });
    return Buffer.concat([header, ...frames]);
}

/**
 * Serialize dirty L2 entries as raw FRM2 frames suitable for appending to `l2-delta.arwal`.
 *
 * @param entries - Dirty L2 records to encode as appendable frames.
 * @returns Concatenated FRM2 frame buffer without container header.
 */
export function serializeArc2L2FramesOnly(entries: Iterable<L2EntryRecord>): Buffer {
    const frames: Buffer[] = [];
    for (const entry of entries) {
        frames.push(encodeArc2L2Frame(entry));
    }
    return Buffer.concat(frames);
}

function validateArc2FrameHeader(
    buf: Buffer,
    offset: number,
): { timestampMs: number; frameEnd: number } | null {
    if (offset + ARC2_FRAME_HEADER_BYTES > buf.length) return null;
    if (buf.readUInt32LE(offset) !== ARC2_FRAME_MAGIC) return null;
    const payloadByteLen = buf.readUInt32LE(offset + FRAME_OFFSET_PAYLOAD_LEN);
    const expectedCrc = buf.readUInt32LE(offset + FRAME_OFFSET_CRC);
    const timestampMs = buf.readDoubleLE(offset + FRAME_OFFSET_TIMESTAMP);
    const frameEnd = offset + ARC2_FRAME_HEADER_BYTES + payloadByteLen;
    if (frameEnd > buf.length) return null;
    const actualCrc = computeBufferChecksum(buf, offset + ARC2_FRAME_HEADER_BYTES, frameEnd);
    return actualCrc === expectedCrc ? { timestampMs, frameEnd } : null;
}

function parseSingleFrame(
    buf: Buffer,
    offset: number,
    lazyDecode: boolean,
): { entry: L2EntryRecord; nextOffset: number } | null {
    const header = validateArc2FrameHeader(buf, offset);
    if (!header) return null;
    const { timestampMs, frameEnd } = header;

    let pos = offset + ARC2_FRAME_HEADER_BYTES;
    if (pos + U32_BYTES > frameEnd) return null;
    const keyLen = buf.readUInt32LE(pos);
    pos += U32_BYTES;
    if (pos + keyLen + U32_BYTES > frameEnd) return null;
    const entryKey = buf.toString('utf8', pos, pos + keyLen);
    pos += keyLen;

    const pathLen = buf.readUInt32LE(pos);
    pos += U32_BYTES;
    if (pos + pathLen + FRAME_META_FIXED_BYTES > frameEnd) return null;
    const entryPath = buf.toString('utf8', pos, pos + pathLen);
    pos += pathLen;

    const metaFlags = buf[pos++];
    pos += 1;
    const fmVal = buf.readDoubleLE(pos);
    pos += F64_BYTES;
    const fsVal = buf.readDoubleLE(pos);
    pos += F64_BYTES;

    const rawPr50Slice = buf.subarray(pos, frameEnd);
    const entry: L2EntryRecord = {
        k: entryKey,
        p: entryPath,
        issues: [],
        metric: null,
        ts: timestampMs,
        ...(metaFlags & 1 ? { fm: fmVal } : {}),
        ...(metaFlags & 2 ? { fs: fsVal } : {}),
        rawPr50Slice,
        decoded: false,
    };

    if (!lazyDecode && !ensureL2EntryDecoded(entry)) {
        return null;
    }

    return { entry, nextOffset: frameEnd };
}

/**
 * Scan an `l2-store.arc` or `l2-delta.arwal` binary container, indexing all valid frames.
 * By default (`lazyDecode = true`), PR50 payloads are kept as zero-copy Buffer slices and
 * decoded only when a cache hit accesses the entry.
 *
 * @param buf - Raw container buffer read from disk.
 * @param onEntry - Callback invoked for each validated L2 entry frame in sequential order.
 * @param lazyDecode - Whether to defer PR50 payload decoding until a cache hit occurs.
 * @returns Validated Arc2L2LoadResult with header and validBytes end offset, or null if invalid.
 */
export function loadArc2L2Container(
    buf: Buffer,
    onEntry: (entry: L2EntryRecord) => void,
    lazyDecode = true,
): Arc2L2LoadResult | null {
    const header = decodeArc2Header(buf);
    if (!header || (header.kind !== ARC2_KIND_STORE && header.kind !== ARC2_KIND_WAL)) {
        return null;
    }
    let offset = ARC2_HEADER_BYTES;
    while (offset < buf.length) {
        const parsed = parseSingleFrame(buf, offset, lazyDecode);
        if (!parsed) break;
        onEntry(parsed.entry);
        offset = parsed.nextOffset;
    }
    return { header, validBytes: offset };
}
