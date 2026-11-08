/**
 * Module: Core Cache — L1 Checkpoint Worker
 * File Path: src/core/cache-l1-checkpoint-worker.ts
 * Architecture Role: Reconstruct and encode checkpoint state outside the main event loop.
 * Dependencies & Triggers: Owned worker data, filesystem, and L1 frame codec.
 * Responsibilities: Replay only the requested durable horizon and transfer its encoded snapshot.
 * Exit Semantics & Design Rationale: Worker failures preserve the original checkpoint and WAL.
 */
import * as fs from 'fs';
import { parentPort, workerData } from 'worker_threads';
import type { Fingerprint } from './cache';
import { serializeL1 } from './cache-persistence';
import { encodeL1Frame, replayL1Frames } from './cache-l1-wal';

interface CheckpointRequest {
    checkpointPath: string;
    walPath: string;
    sequence: number;
    legacyOffset?: number;
}

const CheckpointIoBarrier = {
    readBytes(filePath: string): Buffer {
        return fs['readFileSync'](filePath);
    },
};

const request = workerData as CheckpointRequest;
if (!parentPort) throw new Error('L1 checkpoint requires an owned worker port');
const state = new Map<string, Fingerprint>();
const base = replayL1Frames(CheckpointIoBarrier.readBytes(request.checkpointPath), state);
if (base.truncatedTail) throw new Error('Cannot compact a truncated L1 checkpoint');
const result = replayL1Frames(
    CheckpointIoBarrier.readBytes(request.walPath),
    state,
    base.sequence,
    request.sequence,
);
if (result.sequence !== request.sequence) throw new Error('L1 checkpoint horizon unavailable');
const bytes = Uint8Array.from(encodeL1Frame(request.sequence, state));
const legacyBytes = Uint8Array.from(Buffer.from(serializeL1(state), 'utf8'));
parentPort.postMessage(
    {
        sequence: request.sequence,
        walOffset: result.throughBytes,
        bytes,
        legacyOffset: request.legacyOffset,
        legacyBytes,
    },
    [bytes.buffer as ArrayBuffer, legacyBytes.buffer as ArrayBuffer],
);
parentPort.close();
