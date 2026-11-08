/**
 * Module: Core Cache — L1 Journal Persistence
 * File Path: src/core/cache-l1-journal.ts
 * Architecture Role: Durable delta/checkpoint adapter owned by CacheStore's serialized writer.
 * Dependencies & Triggers: Filesystem, atomic cache writes, and versioned L1 frames.
 * Responsibilities: Load verified state, repair torn tails, and append only changed fingerprints.
 * Exit Semantics & Design Rationale: Preserve legacy fallback and retry failed batches.
 */
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { pipeline } from 'stream/promises';
import { Worker } from 'worker_threads';
import type { Fingerprint } from './cache';
import { encodeL1Frame, replayL1Frames, type L1Delta } from './cache-l1-wal';
import { writeBytesAtomic, writeBytesAtomicAsync } from './cache-persistence';

function readOptional(file: string): Buffer {
    try {
        return fs.readFileSync(file);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return Buffer.alloc(0);
        throw error;
    }
}

const CHECKPOINT_BYTES = 1024 * 1024;
const WAL_BACKPRESSURE_BYTES = 8 * CHECKPOINT_BYTES;

interface JournalOptions {
    checkpointBytes?: number;
    workerFile?: string;
}

interface PreparedCheckpoint {
    sequence: number;
    walOffset: number;
    bytes: Uint8Array;
    legacyBytes: Uint8Array;
    legacyOffset?: number;
}

/** Single-writer L1 persistence; CacheStore owns synchronization with mutations and compaction. */
export class L1Journal {
    readonly checkpointPath: string;
    readonly walPath: string;
    private readonly legacyPath: string;
    ready = false;
    lastError?: unknown;
    private sequence = 0;
    private repairBytes?: number;
    private walBytes = 0;
    private checkpointInFlight?: Promise<void>;
    private worker?: Worker;
    private prepared?: PreparedCheckpoint;
    private workerUnavailable = false;
    private readonly checkpointBytes: number;
    private readonly workerFile: string;

    constructor(directory: string, options: JournalOptions = {}) {
        this.checkpointPath = path.join(directory, 'l1-checkpoint.arcp');
        this.walPath = path.join(directory, 'l1-delta.arwal');
        this.legacyPath = path.join(directory, 'fingerprints.jsonl');
        this.checkpointBytes = options.checkpointBytes ?? CHECKPOINT_BYTES;
        this.workerFile =
            options.workerFile ?? path.join(__dirname, 'cache-l1-checkpoint-worker.js');
    }

    get busy(): boolean {
        return this.checkpointInFlight !== undefined;
    }

    /** Validate checkpoint and WAL together before replacing the caller's state. */
    load(state: Map<string, Fingerprint>): boolean {
        try {
            const checkpoint = readOptional(this.checkpointPath);
            if (checkpoint.length === 0) return false;
            const loaded = new Map<string, Fingerprint>();
            const base = replayL1Frames(checkpoint, loaded);
            if (base.truncatedTail || base.sequence === 0)
                throw new Error('Incomplete L1 checkpoint');
            // Preserve the durable base generation even when WAL validation requires fallback.
            this.sequence = base.sequence;
            const wal = readOptional(this.walPath);
            const replay = replayL1Frames(wal, loaded, base.sequence);
            state.clear();
            for (const [key, value] of loaded) state.set(key, value);
            this.sequence = replay.sequence;
            this.walBytes = replay.validBytes;
            this.repairBytes =
                replay.truncatedTail || replay.validBytes === 0 ? replay.validBytes : undefined;
            this.ready = true;
            this.lastError = undefined;
            return true;
        } catch (error) {
            this.lastError = error;
            this.ready = false;
            return false;
        }
    }

    private recoverAfterWriteFailure(): void {
        const bytes = readOptional(this.walPath);
        const result = replayL1Frames(bytes, new Map(), this.sequence);
        this.sequence = result.sequence;
        this.repairBytes = result.validBytes;
        this.walBytes = result.validBytes;
    }

    private repairWalSync(): void {
        if (this.repairBytes === undefined) return;
        if (this.repairBytes === 0) {
            const horizon = encodeL1Frame(this.sequence, [], 'horizon');
            writeBytesAtomic(this.walPath, horizon);
            this.walBytes = horizon.length;
        } else {
            fs.truncateSync(this.walPath, this.repairBytes);
        }
        this.repairBytes = undefined;
    }

    private async repairWalAsync(): Promise<void> {
        if (this.repairBytes === undefined) return;
        if (this.repairBytes === 0) {
            const horizon = encodeL1Frame(this.sequence, [], 'horizon');
            await writeBytesAtomicAsync(this.walPath, horizon);
            this.walBytes = horizon.length;
        } else {
            await fs.promises.truncate(this.walPath, this.repairBytes);
        }
        this.repairBytes = undefined;
    }

    /** Publish a compact checkpoint; older WAL generations remain safe to replay after a crash. */
    checkpointSync(state: Map<string, Fingerprint>): void {
        if (this.busy) throw new Error('L1 checkpoint worker busy');
        const sequence = this.sequence + 1;
        const horizon = encodeL1Frame(sequence, [], 'horizon');
        if (!this.ready) writeBytesAtomic(this.walPath, horizon);
        writeBytesAtomic(this.checkpointPath, encodeL1Frame(sequence, state));
        this.sequence = sequence;
        this.ready = true;
        this.lastError = undefined;
        writeBytesAtomic(this.walPath, horizon);
        this.repairBytes = undefined;
        this.walBytes = horizon.length;
        this.prepared = undefined;
    }

    /** Append one synchronous batch, preserving a verified prefix if an earlier append tore. */
    appendSync(deltas: Iterable<L1Delta>, state: Map<string, Fingerprint>): void {
        if (!this.ready || (this.walBytes >= WAL_BACKPRESSURE_BYTES && !this.busy)) {
            this.checkpointSync(state);
            return;
        }
        this.repairWalSync();
        const sequence = this.sequence + 1;
        const frame = encodeL1Frame(sequence, deltas);
        try {
            fs.appendFileSync(this.walPath, frame);
            this.sequence = sequence;
            this.walBytes += frame.length;
            this.repairBytes = undefined;
        } catch (error) {
            this.recoverAfterWriteFailure();
            throw error;
        }
    }

    /** Append a generation without serializing unchanged fingerprints after initial migration. */
    async appendAsync(deltas: Iterable<L1Delta>, state: Map<string, Fingerprint>): Promise<void> {
        if (!this.ready) {
            const sequence = this.sequence + 1;
            const horizon = encodeL1Frame(sequence, [], 'horizon');
            await writeBytesAtomicAsync(this.walPath, horizon);
            await writeBytesAtomicAsync(this.checkpointPath, encodeL1Frame(sequence, state));
            this.sequence = sequence;
            this.ready = true;
            this.lastError = undefined;
            this.repairBytes = undefined;
            this.walBytes = horizon.length;
            return;
        }
        if (this.walBytes >= WAL_BACKPRESSURE_BYTES) {
            await this.waitForCheckpoint();
            if (this.workerUnavailable) throw this.lastError;
        }
        await this.publishCheckpointAsync();
        const sequence = this.sequence + 1;
        const frame = encodeL1Frame(sequence, deltas);
        try {
            await fs.promises.appendFile(this.walPath, frame);
            this.sequence = sequence;
            this.walBytes += frame.length;
            this.repairBytes = undefined;
            await this.requestCheckpoint();
        } catch (error) {
            this.recoverAfterWriteFailure();
            throw error;
        }
    }

    private async requestCheckpoint(): Promise<void> {
        if (
            this.walBytes < this.checkpointBytes ||
            this.busy ||
            this.prepared ||
            this.workerUnavailable
        )
            return;
        let legacyOffset: number | undefined;
        try {
            legacyOffset = (await fs.promises.stat(this.legacyPath)).size;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        const sequence = this.sequence;
        let worker: Worker;
        try {
            worker = new Worker(this.workerFile, {
                workerData: {
                    checkpointPath: this.checkpointPath,
                    walPath: this.walPath,
                    sequence,
                    legacyOffset,
                },
            });
        } catch (error) {
            this.lastError = error;
            this.workerUnavailable = true;
            return;
        }
        this.worker = worker;
        this.checkpointInFlight = new Promise<void>((resolve) => {
            worker.once('message', (message: PreparedCheckpoint) => {
                if (
                    message.sequence !== sequence ||
                    !Number.isSafeInteger(message.walOffset) ||
                    message.walOffset < 0 ||
                    !(message.bytes instanceof Uint8Array)
                ) {
                    this.lastError = new Error('Invalid L1 checkpoint worker response');
                    return;
                }
                this.prepared = message;
            });
            worker.once('error', (error) => {
                this.lastError = error;
                this.workerUnavailable = true;
                resolve();
            });
            worker.once('exit', (code) => {
                if (code !== 0 || !this.prepared) {
                    this.lastError ??= new Error(
                        `L1 checkpoint worker exited without a snapshot (${code})`,
                    );
                }
                resolve();
            });
            worker.unref();
        }).finally(() => {
            this.checkpointInFlight = undefined;
            this.worker = undefined;
        });
    }

    /** Wait for worker ownership to end; publication remains inside the owner's writer queue. */
    async waitForCheckpoint(): Promise<void> {
        this.worker?.ref();
        await this.checkpointInFlight;
    }

    private async compactLegacy(prepared: PreparedCheckpoint): Promise<void> {
        if (prepared.legacyOffset === undefined) return;
        const temporary = `${this.legacyPath}.tmp-${randomUUID()}`;
        try {
            const size = (await fs.promises.stat(this.legacyPath)).size;
            if (prepared.legacyOffset > size)
                throw new Error('Legacy L1 checkpoint horizon exceeds file size');
            await fs.promises.writeFile(
                temporary,
                Buffer.from(
                    prepared.legacyBytes.buffer,
                    prepared.legacyBytes.byteOffset,
                    prepared.legacyBytes.byteLength,
                ),
                { flag: 'wx' },
            );
            await pipeline(
                fs.createReadStream(this.legacyPath, { start: prepared.legacyOffset }),
                fs.createWriteStream(temporary, { flags: 'a' }),
            );
            await fs.promises.rm(path.join(path.dirname(this.legacyPath), 'l1-index.aridx'), {
                force: true,
            });
            await fs.promises.rename(temporary, this.legacyPath);
            prepared.legacyOffset = undefined;
        } finally {
            await fs.promises.rm(temporary, { force: true });
        }
    }

    /** Publish a prepared horizon and stream-copy its remaining WAL without decoding full state. */
    async publishCheckpointAsync(): Promise<void> {
        await this.repairWalAsync();
        const prepared = this.prepared;
        if (!prepared || this.busy) return;
        const temporary = `${this.walPath}.tmp-${randomUUID()}`;
        try {
            const size = (await fs.promises.stat(this.walPath)).size;
            if (prepared.walOffset > size)
                throw new Error('L1 checkpoint WAL horizon exceeds file size');
            await writeBytesAtomicAsync(
                this.checkpointPath,
                Buffer.from(
                    prepared.bytes.buffer,
                    prepared.bytes.byteOffset,
                    prepared.bytes.byteLength,
                ),
            );
            await this.compactLegacy(prepared);
            const horizon = encodeL1Frame(prepared.sequence, [], 'horizon');
            await fs.promises.writeFile(temporary, horizon, { flag: 'wx' });
            await pipeline(
                fs.createReadStream(this.walPath, { start: prepared.walOffset }),
                fs.createWriteStream(temporary, { flags: 'a' }),
            );
            await fs.promises.rename(temporary, this.walPath);
            this.walBytes = horizon.length + size - prepared.walOffset;
            this.prepared = undefined;
            this.lastError = undefined;
        } finally {
            await fs.promises.rm(temporary, { force: true });
        }
    }

    /** Reset in-memory journal identity after the owning cache directory has been cleared. */
    reset(): void {
        if (this.busy) throw new Error('L1 checkpoint worker busy');
        this.ready = false;
        this.sequence = 0;
        this.walBytes = 0;
        this.prepared = undefined;
        this.workerUnavailable = false;
        this.repairBytes = undefined;
        this.lastError = undefined;
    }
}
