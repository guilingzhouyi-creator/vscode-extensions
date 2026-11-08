/**
 * Module: Core Cache — Versioned L1 Journal Frames
 * File Path: src/core/cache-l1-wal.ts
 * Architecture Role: Binary framing boundary for fingerprint deltas and checkpoints.
 * Dependencies & Triggers: ARC2 checksum and CacheStore fingerprint contract.
 * Responsibilities: Bound records, validate generations, and replay complete verified batches.
 * Exit Semantics & Design Rationale: Torn tails retain a valid prefix; corruption rejects replay.
 */
import type { Fingerprint } from './cache';
import { computeBufferChecksum } from './cache-arc2';

const MAGIC = 0x5744314c;
const VERSION = 1;
const HORIZON_VERSION = 2;
const HEADER_BYTES = 28;
const VERSION_OFFSET = 4;
const SEQUENCE_OFFSET = 8;
const PAYLOAD_LEN_OFFSET = 16;
const CHECKSUM_OFFSET = 20;
const HEADER_CHECKSUM_OFFSET = 24;
const MAX_PAYLOAD_BYTES = 134_217_728;
const KIND_BATCH = 'batch';
const KIND_HORIZON = 'horizon';
const ENCODING_UTF8 = 'utf8';

/** L1 journal delta entry pairing a relative path with an updated or cleared fingerprint. */
export type L1Delta = readonly [string, Fingerprint | null];

/** Complete prefix metadata used to repair a torn append before the next write. */
export interface L1ReplayResult {
    readonly sequence: number;
    readonly validBytes: number;
    readonly throughBytes: number;
    readonly truncatedTail: boolean;
}

function assertSequence(sequence: number): void {
    if (!Number.isSafeInteger(sequence) || sequence < 1) {
        throw new Error('Invalid L1 journal sequence');
    }
}

function isFiniteNumber(candidate: unknown): candidate is number {
    return typeof candidate === 'number' && Number.isFinite(candidate);
}

function isNonNegativeFinite(candidate: unknown): candidate is number {
    return isFiniteNumber(candidate) && candidate >= 0;
}

function isFingerprint(candidate: unknown): candidate is Fingerprint {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
    const record = candidate as Record<string, unknown>;
    if (!isFiniteNumber(record.mtimeMs) || !isNonNegativeFinite(record.size)) {
        return false;
    }
    return record.ino === undefined || isNonNegativeFinite(record.ino);
}

function assertDelta(deltaCandidate: unknown): asserts deltaCandidate is L1Delta {
    if (
        !Array.isArray(deltaCandidate) ||
        deltaCandidate.length !== 2 ||
        typeof deltaCandidate[0] !== 'string' ||
        !deltaCandidate[0] ||
        (deltaCandidate[1] !== null && !isFingerprint(deltaCandidate[1]))
    ) {
        throw new Error('Invalid L1 journal fingerprint');
    }
}

/**
 * Encode one immutable batch; work is proportional to supplied deltas, without reading full state.
 *
 * @param sequence - Strictly increasing safe integer for this batch.
 * @param deltas - Upserts or tombstones belonging to this generation.
 * @param kind - Ordinary v1 batch or an empty v2 checkpoint horizon for WAL publication.
 * @returns A length-delimited, checksummed frame suitable for append or atomic checkpoint.
 */
export function encodeL1Frame(
    sequence: number,
    deltas: Iterable<L1Delta>,
    kind: 'batch' | 'horizon' = KIND_BATCH,
): Buffer {
    assertSequence(sequence);
    const records = Array.from(deltas);
    if (kind === KIND_HORIZON && records.length !== 0) throw new Error('L1 horizon must be empty');
    for (const record of records) assertDelta(record);
    const payload = Buffer.from(JSON.stringify(records), ENCODING_UTF8);
    if (payload.length > MAX_PAYLOAD_BYTES) throw new Error('L1 frame size exceeds limit');
    const frame = Buffer.allocUnsafe(HEADER_BYTES + payload.length);
    frame.writeUInt32LE(MAGIC, 0);
    frame.writeUInt32LE(kind === KIND_HORIZON ? HORIZON_VERSION : VERSION, VERSION_OFFSET);
    frame.writeDoubleLE(sequence, SEQUENCE_OFFSET);
    frame.writeUInt32LE(payload.length, PAYLOAD_LEN_OFFSET);
    frame.writeUInt32LE(0, CHECKSUM_OFFSET);
    frame.writeUInt32LE(0, HEADER_CHECKSUM_OFFSET);
    payload.copy(frame, HEADER_BYTES);
    frame.writeUInt32LE(computeBufferChecksum(frame), CHECKSUM_OFFSET);
    frame.writeUInt32LE(
        computeBufferChecksum(frame, 0, HEADER_CHECKSUM_OFFSET),
        HEADER_CHECKSUM_OFFSET,
    );
    return frame;
}

interface DecodedL1Frame {
    sequence: number;
    length: number;
    deltas: L1Delta[];
    horizon: boolean;
}

function readFrame(bytes: Buffer, offset: number): DecodedL1Frame | null {
    if (bytes.length - offset < HEADER_BYTES) return null;
    const version = bytes.readUInt32LE(offset + VERSION_OFFSET);
    if (
        bytes.readUInt32LE(offset) !== MAGIC ||
        (version !== VERSION && version !== HORIZON_VERSION)
    ) {
        throw new Error('Unsupported L1 journal frame');
    }
    if (
        computeBufferChecksum(bytes, offset, offset + HEADER_CHECKSUM_OFFSET) !==
        bytes.readUInt32LE(offset + HEADER_CHECKSUM_OFFSET)
    ) {
        throw new Error('L1 frame header checksum mismatch');
    }
    const sequence = bytes.readDoubleLE(offset + SEQUENCE_OFFSET);
    assertSequence(sequence);
    const payloadBytes = bytes.readUInt32LE(offset + PAYLOAD_LEN_OFFSET);
    if (payloadBytes > MAX_PAYLOAD_BYTES) throw new Error('Invalid L1 frame length');
    const length = HEADER_BYTES + payloadBytes;
    if (bytes.length - offset < length) return null;
    const frame = Buffer.from(bytes.subarray(offset, offset + length));
    const expectedChecksum = frame.readUInt32LE(CHECKSUM_OFFSET);
    frame.writeUInt32LE(0, CHECKSUM_OFFSET);
    frame.writeUInt32LE(0, HEADER_CHECKSUM_OFFSET);
    if (computeBufferChecksum(frame) !== expectedChecksum)
        throw new Error('L1 frame checksum mismatch');
    const deltas: unknown = JSON.parse(frame.subarray(HEADER_BYTES).toString(ENCODING_UTF8));
    if (!Array.isArray(deltas)) throw new Error('Invalid L1 journal payload');
    for (const delta of deltas) assertDelta(delta);
    return { sequence, length, deltas, horizon: version === HORIZON_VERSION };
}

function validateHorizon(frame: DecodedL1Frame, offset: number, checkpointSequence: number): void {
    if (!frame.horizon) return;
    const invalidHorizonLayout = offset !== 0 || frame.deltas.length !== 0;
    const exceedsCheckpoint = checkpointSequence > 0 && frame.sequence > checkpointSequence;
    if (invalidHorizonLayout || exceedsCheckpoint) {
        throw new Error('Invalid L1 WAL horizon');
    }
}

/**
 * Validate an entire journal prefix before mutating state. Checkpointed batches are skipped;
 * a short final frame is recoverable, while complete corrupt frames reject the whole replay.
 *
 * @param bytes - Journal or checkpoint bytes.
 * @param state - Destination fingerprint state; unchanged if validation fails.
 * @param checkpointSequence - Highest generation already represented by state.
 * @param throughSequence - Highest durable generation included in a worker checkpoint.
 * @returns Last generation and complete byte boundary for safe tail truncation.
 */
export function replayL1Frames(
    bytes: Buffer,
    state: Map<string, Fingerprint>,
    checkpointSequence = 0,
    throughSequence = Number.MAX_SAFE_INTEGER,
): L1ReplayResult {
    let offset = 0;
    let previousSequence = 0;
    let appliedSequence = checkpointSequence;
    let throughBytes = 0;
    const batches: L1Delta[][] = [];
    while (offset < bytes.length) {
        const frame = readFrame(bytes, offset);
        if (!frame) break;
        validateHorizon(frame, offset, checkpointSequence);
        if (frame.sequence <= previousSequence)
            throw new Error('L1 journal sequence is not increasing');
        previousSequence = frame.sequence;
        if (frame.sequence <= throughSequence)
            appliedSequence = Math.max(appliedSequence, frame.sequence);
        if (frame.sequence > checkpointSequence && frame.sequence <= throughSequence)
            batches.push(frame.deltas);
        offset += frame.length;
        if (frame.sequence <= throughSequence) throughBytes = offset;
    }
    for (const deltas of batches) {
        for (const [key, value] of deltas) {
            if (value === null) state.delete(key);
            else state.set(key, value);
        }
    }
    return {
        sequence: appliedSequence,
        validBytes: offset,
        throughBytes,
        truncatedTail: offset !== bytes.length,
    };
}
