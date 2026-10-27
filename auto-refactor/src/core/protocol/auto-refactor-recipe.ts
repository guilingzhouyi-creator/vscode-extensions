/**
 * Module: Core Engine — deepseek-recipe Rust High-Throughput Binary Protocol
 * File Path: src/core/protocol/auto-refactor-recipe.ts
 * Architecture Role: High-throughput binary packet serialization and streaming protocol inspired
 *   by DeepSeek's deepseek-recipe. Packs AAS v1.0 reports, agent reasoning traces (Thinking blocks),
 *   AST slices, and diff hunks into compact binary TLV streams with zero-copy parsing and byte
 *   parity with Rust native engine counterparts.
 * Dependencies & Triggers: Consumes fastDigest from domainFingerprint and Uint8Array/TextEncoder.
 *   Triggered during daemon IPC, AAS packaging, and recipe archive persistence.
 * Responsibilities:
 *   1. Encode and decode binary TLV (Type-Length-Value) frames with magic header "RECP" and Adler-32 checksums.
 *   2. Support 5 structured recipe tags: AstSlice (0x01), ThinkingBlock (0x02), AasReport (0x03),
 *      DiffHunk (0x04), and GuidancePrompt (0x05).
 *   3. Provide multi-packet stream encoding and zero-copy streaming decoding.
 *   4. Maintain strict byte-for-byte equivalence with Rust native protocol implementations.
 * Exit Semantics & Design Rationale: Deterministic binary serialization. Replaces megabyte-scale
 *   verbose JSON payloads with compact, high-throughput binary frames, cutting transport overhead.
 */

/** Protocol 4-byte magic signature: 0x52, 0x45, 0x43, 0x50 ('RECP'). */
export const RECIPE_MAGIC = 0x52454350;

/** Current binary protocol specification version. */
export const RECIPE_VERSION = 1;

/** Size of packet fixed header in bytes: Magic (4) + Version (1) + Tag (1) + Length (4). */
export const PACKET_HEADER_SIZE = 10;

/** Size of trailing checksum in bytes (Adler-32 uint32). */
export const CHECKSUM_SIZE = 4;

/** Adler-32 modulo prime. */
const ADLER_MOD = 65521;

/**
 * Standard packet type tags defining structural recipe sections.
 */
export enum RecipeTag {
    /** Pre-parsed or serialized AST slice chunk. */
    AstSlice = 0x01,
    /** Agent reasoning trace / Chain-of-Thought thinking block. */
    ThinkingBlock = 0x02,
    /** Agent Audit Schema (AAS v1.0) report payload. */
    AasReport = 0x03,
    /** Unified diff hunk modification payload. */
    DiffHunk = 0x04,
    /** Compact agent prompt or constraint guidance payload. */
    GuidancePrompt = 0x05,
}

/**
 * Single structural recipe packet.
 */
export interface RecipePacket {
    /** Recipe semantic tag. */
    readonly tag: RecipeTag;
    /** UTF-8 string or binary payload. */
    readonly payload: string;
    /** Raw payload bytes if available. */
    readonly rawBytes?: Uint8Array;
}

/**
 * Compute Adler-32 checksum across a byte buffer without heap allocations.
 *
 * @param buffer - Byte buffer to hash.
 * @returns 32-bit unsigned Adler-32 checksum.
 */
export function computeAdler32(buffer: Uint8Array): number {
    let sumLow = 1;
    let sumHigh = 0;
    for (let i = 0; i < buffer.length; i++) {
        sumLow = (sumLow + buffer[i]) % ADLER_MOD;
        sumHigh = (sumHigh + sumLow) % ADLER_MOD;
    }
    return ((sumHigh << 16) | sumLow) >>> 0;
}

/**
 * Encode a single RecipePacket into a binary TLV frame.
 *
 * Format:
 * [0..3]: Magic (0x52454350)
 * [4]: Version (0x01)
 * [5]: Tag (uint8)
 * [6..9]: Payload Length (uint32 BE)
 * [10..10+L-1]: Payload bytes (UTF-8)
 * [10+L..10+L+3]: Adler-32 Checksum (uint32 BE)
 *
 * @param packet - Recipe packet to encode.
 * @returns Binary Uint8Array buffer.
 */
export function encodeRecipePacket(packet: RecipePacket): Uint8Array {
    const encoder = new TextEncoder();
    const payloadBytes = packet.rawBytes ?? encoder.encode(packet.payload);
    const payloadLen = payloadBytes.length;
    const totalSize = PACKET_HEADER_SIZE + payloadLen + CHECKSUM_SIZE;

    const buffer = new Uint8Array(totalSize);
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

    // Header
    view.setUint32(0, RECIPE_MAGIC, false);
    view.setUint8(4, RECIPE_VERSION);
    view.setUint8(5, packet.tag);
    view.setUint32(6, payloadLen, false);

    // Payload
    buffer.set(payloadBytes, PACKET_HEADER_SIZE);

    // Checksum
    const checksum = computeAdler32(payloadBytes);
    view.setUint32(PACKET_HEADER_SIZE + payloadLen, checksum, false);

    return buffer;
}

/**
 * Decode a single binary TLV frame into a RecipePacket.
 *
 * @param buffer - Binary buffer containing frame.
 * @param offset - Byte offset where frame begins (defaults to 0).
 * @returns Decoded RecipePacket and next frame offset.
 */
export function decodeRecipePacket(
    buffer: Uint8Array,
    offset = 0,
): { packet: RecipePacket; nextOffset: number } {
    if (buffer.length - offset < PACKET_HEADER_SIZE + CHECKSUM_SIZE) {
        throw new Error('Buffer too small for recipe packet header');
    }

    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

    const magic = view.getUint32(offset, false);
    if (magic !== RECIPE_MAGIC) {
        throw new Error(`Invalid recipe magic signature: 0x${magic.toString(16)}`);
    }

    const version = view.getUint8(offset + 4);
    if (version !== RECIPE_VERSION) {
        throw new Error(`Unsupported recipe version: ${version}`);
    }

    const tag = view.getUint8(offset + 5) as RecipeTag;
    const payloadLen = view.getUint32(offset + 6, false);

    const payloadStart = offset + PACKET_HEADER_SIZE;
    const payloadEnd = payloadStart + payloadLen;
    const checksumOffset = payloadEnd;

    if (buffer.length < checksumOffset + CHECKSUM_SIZE) {
        throw new Error('Truncated recipe payload');
    }

    const payloadBytes = buffer.subarray(payloadStart, payloadEnd);
    const expectedChecksum = view.getUint32(checksumOffset, false);
    const actualChecksum = computeAdler32(payloadBytes);

    if (actualChecksum !== expectedChecksum) {
        throw new Error(
            `Recipe checksum mismatch: expected ${expectedChecksum}, got ${actualChecksum}`,
        );
    }

    const decoder = new TextDecoder('utf-8');
    const payloadText = decoder.decode(payloadBytes);

    return {
        packet: {
            tag,
            payload: payloadText,
            rawBytes: payloadBytes,
        },
        nextOffset: checksumOffset + CHECKSUM_SIZE,
    };
}

/**
 * Stream-encode multiple RecipePackets into a single contiguous binary buffer.
 *
 * @param packets - Array of packets to encode.
 * @returns Contiguous binary stream buffer.
 */
export function encodeRecipeStream(packets: readonly RecipePacket[]): Uint8Array {
    const encodedList: Uint8Array[] = [];
    let totalLength = 0;

    for (let i = 0; i < packets.length; i++) {
        const encoded = encodeRecipePacket(packets[i]);
        encodedList.push(encoded);
        totalLength += encoded.length;
    }

    const stream = new Uint8Array(totalLength);
    let currentOffset = 0;

    for (let i = 0; i < encodedList.length; i++) {
        stream.set(encodedList[i], currentOffset);
        currentOffset += encodedList[i].length;
    }

    return stream;
}

/**
 * Stream-decode a contiguous binary buffer into an array of RecipePackets.
 *
 * @param stream - Binary stream buffer.
 * @returns Array of decoded RecipePackets.
 */
export function decodeRecipeStream(stream: Uint8Array): RecipePacket[] {
    const packets: RecipePacket[] = [];
    let offset = 0;

    while (offset < stream.length) {
        const { packet, nextOffset } = decodeRecipePacket(stream, offset);
        packets.push(packet);
        offset = nextOffset;
    }

    return packets;
}
