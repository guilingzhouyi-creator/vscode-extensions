/**
 * Module: Core Engine — Praxis FastCDC Dynamic Content Chunking
 * File Path: src/core/praxis/vfs/fast-cdc.ts
 * Architecture Role: High-performance content-defined chunking (FastCDC) engine used by
 *   the LayerVFS storage kernel to split arbitrary source files into boundary-stable chunks,
 *   enabling sub-25KB storage expansion on localized code edits.
 * Dependencies & Triggers: node:crypto for SHA-256 chunk digesting; consumed by CasStore,
 *   SqliteBackend, and exported through LayerVFS facade.
 * Responsibilities: Implement asymmetric-mask Gear rolling hash algorithm, partition byte streams
 *   into normalized chunks (4KB min, 8KB avg, 32KB max), compute cryptographic chunk manifests,
 *   and assemble CASObject structures.
 * Exit Semantics & Design Rationale: Pure deterministic computation; never performs external I/O
 *   or throws during chunking; maintains O(N) single-pass streaming with CC <= 6 and Depth <= 3.
 */

import { createHash } from 'node:crypto';
import type { CASObject, ChunkDescriptor } from './vfs-contracts';

/**
 * Configuration options for FastCDC chunking parameters.
 */
export interface FastCDCOptions {
    /** Minimum chunk size in bytes (default: 4096) */
    minSize?: number;
    /** Normalized average chunk size in bytes (default: 8192) */
    avgSize?: number;
    /** Maximum chunk size in bytes (default: 32768) */
    maxSize?: number;
}

/** Default minimum chunk size (4 KB) */
export const DEFAULT_MIN_CHUNK_SIZE = 4096;

/** Default average chunk size (8 KB) */
export const DEFAULT_AVG_CHUNK_SIZE = 8192;

/** Default maximum chunk size (32 KB) */
export const DEFAULT_MAX_CHUNK_SIZE = 32768;

/**
 * Initializes a deterministic 256-element 32-bit Gear lookup table using Knuth LCG.
 */
function initGearTable(): Uint32Array {
    const table = new Uint32Array(256);
    let state = 0x8a5cb391;
    for (let i = 0; i < 256; i++) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        table[i] = state;
    }
    return table;
}

/** Precomputed global Gear lookup table */
const GEAR_TABLE = initGearTable();

/**
 * Compute SHA-256 cryptographic digest of a byte slice.
 *
 * @param buffer - Input byte array.
 * @returns Lowercase hex-encoded SHA-256 hash string.
 */
export function hashBuffer(buffer: Uint8Array): string {
    return createHash('sha256').update(buffer).digest('hex');
}

/**
 * Fast Content-Defined Chunking (FastCDC) engine.
 * Employs asymmetric rolling mask to tighten chunk size distribution around target average.
 */
export class FastCDC {
    public readonly minSize: number;
    public readonly avgSize: number;
    public readonly maxSize: number;

    private readonly maskS: number;
    private readonly maskL: number;

    constructor(options: FastCDCOptions = {}) {
        this.minSize = Math.max(1024, options.minSize ?? DEFAULT_MIN_CHUNK_SIZE);
        this.avgSize = Math.max(this.minSize * 2, options.avgSize ?? DEFAULT_AVG_CHUNK_SIZE);
        this.maxSize = Math.max(this.avgSize * 2, options.maxSize ?? DEFAULT_MAX_CHUNK_SIZE);

        // Derive asymmetric masks: maskS is stricter (more bits), maskL is looser (fewer bits)
        const avgBits = Math.round(Math.log2(this.avgSize));
        const bitsS = Math.min(30, avgBits + 1);
        const bitsL = Math.max(8, avgBits - 1);
        this.maskS = (1 << bitsS) - 1;
        this.maskL = (1 << bitsL) - 1;
    }

    /**
     * Finds the next chunk boundary using Gear rolling hash and dual masks.
     *
     * @param buffer - Target byte array.
     * @param offset - Starting offset within buffer.
     * @returns Length of the chunk and boundary rolling hash value.
     */
    public computeBoundary(
        buffer: Uint8Array,
        offset: number,
    ): { length: number; boundaryHash: number } {
        const remaining = buffer.length - offset;
        if (remaining <= this.minSize) {
            return { length: remaining, boundaryHash: 0 };
        }

        const maxBoundary = Math.min(offset + this.maxSize, buffer.length);
        let fingerprint = 0;

        for (let i = offset + this.minSize; i < maxBoundary; i++) {
            const byte = buffer[i];
            fingerprint = ((fingerprint << 1) + GEAR_TABLE[byte]) >>> 0;

            const isSmallWindow = i - offset < this.avgSize;
            const mask = isSmallWindow ? this.maskS : this.maskL;

            if ((fingerprint & mask) === 0) {
                return {
                    length: i - offset + 1,
                    boundaryHash: fingerprint,
                };
            }
        }

        return {
            length: maxBoundary - offset,
            boundaryHash: fingerprint,
        };
    }

    /**
     * Splits an entire byte buffer into content-defined chunk descriptors.
     *
     * @param buffer - Input byte array to chunk.
     * @returns Ordered list of chunk descriptors.
     */
    public chunk(buffer: Uint8Array): ChunkDescriptor[] {
        if (buffer.length === 0) {
            return [];
        }

        const chunks: ChunkDescriptor[] = [];
        let cursor = 0;

        while (cursor < buffer.length) {
            const { length, boundaryHash } = this.computeBoundary(buffer, cursor);
            const chunkSlice = buffer.subarray(cursor, cursor + length);
            const chunkHash = hashBuffer(chunkSlice);

            chunks.push({
                chunkHash,
                offset: cursor,
                length,
                boundaryHash,
            });

            cursor += length;
        }

        return chunks;
    }

    /**
     * Chunks a buffer and constructs a complete CASObject manifest with raw chunk payload map.
     *
     * @param buffer - Input byte array.
     * @returns CASObject manifest and map of chunk hash to raw chunk bytes.
     */
    public buildCASObject(buffer: Uint8Array): {
        casObject: CASObject;
        chunkData: Map<string, Uint8Array>;
    } {
        const chunks = this.chunk(buffer);
        const chunkData = new Map<string, Uint8Array>();

        for (const desc of chunks) {
            if (!chunkData.has(desc.chunkHash)) {
                const slice = buffer.subarray(desc.offset, desc.offset + desc.length);
                chunkData.set(desc.chunkHash, slice);
            }
        }

        const contentHash = hashBuffer(buffer);
        const casObject: CASObject = {
            contentHash,
            byteLength: buffer.length,
            chunks,
            createdAtMs: Date.now(),
        };

        return { casObject, chunkData };
    }
}
