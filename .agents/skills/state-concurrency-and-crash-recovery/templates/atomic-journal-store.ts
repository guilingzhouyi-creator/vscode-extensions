/**
 * Module: State Concurrency & Crash Recovery — Bounded RingBuffer & Atomic Journal Store Template
 * File Path: .agents/skills/state-concurrency-and-crash-recovery/templates/atomic-journal-store.ts
 * Architecture Role: Crash-safe state coordinator combining a fixed-capacity RingBuffer,
 *   idempotent journal replay (UUID-REENTRANT-001), and symmetric flush/teardown lifecycle.
 * Dependencies & Triggers: Node.js fs/promises and path; used as reference template for persistence layers.
 * Responsibilities:
 *   1. Record state deltas into a zero-reallocation fixed-slot RingBuffer.
 *   2. Persist snapshots via stagingPath verification + atomic rename (no torn writes).
 *   3. Enforce idempotent replay deduplication by sequence number and clean teardown (PRF-LEAK-001).
 * Exit Semantics & Design Rationale: Explicit LifecycleState machine preventing post-teardown writes.
 */
import * as fs from 'fs/promises';
import * as path from 'path';

export type StoreLifecycleState = 'active' | 'draining' | 'terminated';

export interface JournalRecord {
    readonly seqId: number;
    readonly timestampMs: number;
    readonly deltaValue: number;
}

export interface AtomicStoreConfig {
    readonly targetPath: string;
    readonly stagingPath: string;
    readonly ringCapacity?: number;
}

export interface SnapshotPayload {
    readonly lastCommittedSeqId: number;
    readonly totalAccumulated: number;
    readonly recentRecords: readonly JournalRecord[];
}

export class AtomicJournalStore {
    private readonly targetPath: string;
    private readonly stagingPath: string;
    private readonly ringBuffer: (JournalRecord | null)[];
    private readonly capacity: number;
    private writeCursor = 0;
    private lastCommittedSeqId = 0;
    private totalAccumulated = 0;
    private lifecycle: StoreLifecycleState = 'active';

    public constructor(config: AtomicStoreConfig) {
        const cap = config.ringCapacity ?? 32;
        if (!config.targetPath || !config.stagingPath || cap < 1) {
            throw new RangeError('AtomicJournalStore requires valid paths and ringCapacity >= 1.');
        }
        this.targetPath = path.resolve(config.targetPath);
        this.stagingPath = path.resolve(config.stagingPath);
        this.capacity = cap;
        this.ringBuffer = new Array<JournalRecord | null>(cap).fill(null);
    }

    /**
     * Appends or replays a record idempotently (`UUID-REENTRANT-001`).
     */
    public applyRecord(record: JournalRecord): boolean {
        if (this.lifecycle !== 'active') {
            return false;
        }
        if (record.seqId <= this.lastCommittedSeqId) {
            return false;
        }
        this.lastCommittedSeqId = record.seqId;
        this.totalAccumulated += record.deltaValue;
        this.ringBuffer[this.writeCursor] = record;
        this.writeCursor = (this.writeCursor + 1) % this.capacity;
        return true;
    }

    /**
     * Atomically writes the current snapshot via `stagingPath` and `fs.rename` (`PRF-IO-001`).
     */
    public async flushSnapshot(): Promise<SnapshotPayload> {
        if (this.lifecycle === 'terminated') {
            throw new Error('Cannot flush a terminated AtomicJournalStore.');
        }
        const recent: JournalRecord[] = [];
        for (let i = 0; i < this.capacity; i++) {
            const slot = this.ringBuffer[(this.writeCursor + i) % this.capacity];
            if (slot !== null) {
                recent.push(slot);
            }
        }
        const snapshot: SnapshotPayload = Object.freeze({
            lastCommittedSeqId: this.lastCommittedSeqId,
            totalAccumulated: this.totalAccumulated,
            recentRecords: Object.freeze(recent),
        });

        const serialized = `${JSON.stringify(snapshot, null, 2)}\n`;
        await fs.writeFile(this.stagingPath, serialized, 'utf8');
        const stat = await fs.stat(this.stagingPath);
        if (stat.size === 0) {
            throw new Error('Staging file verification failed: 0 bytes written.');
        }
        await fs.rename(this.stagingPath, this.targetPath);
        return snapshot;
    }

    /**
     * Symmetrically drains pending state and transitions to `terminated` (`PRF-LEAK-001`).
     */
    public async teardown(): Promise<void> {
        if (this.lifecycle === 'terminated') {
            return;
        }
        this.lifecycle = 'draining';
        try {
            await this.flushSnapshot();
        } finally {
            this.ringBuffer.fill(null);
            this.lifecycle = 'terminated';
        }
    }
}
