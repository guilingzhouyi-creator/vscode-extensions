/**
 * Module: Core Engine — Human-Facing Diff Buffer & Persistence
 * File Path: src/core/ring-buffer.ts
 * Architecture Role: In-memory circular diff store with periodic snapshot persistence and
 *     cold-hunk eviction into R4 archival storage through the Praxis human-storage SPI.
 * Dependencies & Triggers: ./praxis/contracts (ReviewDiffHunk, IPraxisHumanFaceStorage);
 *     built by core/stream.ts when a humanStorage hook is supplied and re-exported by api.ts;
 *     an unref'd setInterval (default 3000 ms) triggers flushSnapshot while the buffer is dirty.
 * Responsibilities: Keep a fixed-capacity FIFO ring (head/count, oldest overwritten on
 *     overflow) with push/pushMany, chronological toArray and size; delegate dirty-flag
 *     snapshots to flushPeriodicSnapshot; dispose timers; encode evicted hunks as UTF-8
 *     JSON and hand them to evictToR4Archive, handling sync and Promise results.
 * Exit Semantics & Design Rationale: The constructor clamps capacity to >= 1 and omits the
 *     timer for non-positive intervals; eviction is fail-safe (exceptions swallowed, rejected
 *     promises ignored) so archival trouble can never break the scan, and the unref'd timer
 *     never keeps the Node process alive.
 *
 * Human-Facing Circular Diff Buffer & Periodic Persistence Subsystem.
 *
 * Implements the "Human-Facing Face" of the One-Body Two-Faces Three-Tier architecture
 * (docs / 1.md §2.1):
 * - Fixed/dynamically scalable in-memory ring buffer holding recent diff chunks for UI display
 * - Periodic asynchronous snapshot persistence to prevent data loss on unexpected crash
 * - Automatic eviction of cold/stale diff chunks converted into compressed binary payloads
 *   dispatched to R4 archival storage via the Praxis SPI hook.
 */

import type { ReviewDiffHunk, IPraxisHumanFaceStorage } from './praxis/contracts';

/** Default ring capacity (maximum retained hunks) when `RingBufferOptions.capacity` is omitted. */
const DEFAULT_RING_CAPACITY = 1000;

/** Default periodic flush interval in milliseconds for the ring's snapshot persistence timer. */
const DEFAULT_FLUSH_INTERVAL_MS = 3000;

/**
 * Construction options for `CircularDiffBuffer`.
 *
 * Every field is optional. `capacity` defaults to 1000 and is clamped to at least 1. A negative
 * `flushIntervalMs` disables the periodic timer, while `0` falls back to the 3000 ms default. A
 * `storageAdapter` receives append, flush, and eviction calls; `onEvictToR4` runs only after the
 * adapter returns an archive id, either synchronously or from a resolved promise.
 */
export interface RingBufferOptions {
    /** Maximum number of hunks stored in active display memory (default: 1000) */
    capacity?: number;
    /** Periodic flush interval in milliseconds (default: 3000ms = 3s) */
    flushIntervalMs?: number;
    /** Custom storage adapter (implements IPraxisHumanFaceStorage) */
    storageAdapter?: IPraxisHumanFaceStorage;
    /** Callback fired when cold data is evicted and compressed for R4 */
    onEvictToR4?: (payload: Uint8Array, archiveId: string) => void;
}

/**
 * Fixed-capacity circular buffer that retains the most recent review diff hunks.
 *
 * The ring stores references instead of copies, preserves insertion order from oldest to newest,
 * and overwrites the oldest entry once `capacity` is reached. All methods are synchronous and
 * rely on JavaScript's single-threaded run-to-completion model: there is no lock or mutex, and
 * sharing one instance across worker threads is unsupported. Eviction is best-effort because
 * archival failures are deliberately ignored.
 */
export class CircularDiffBuffer {
    private buffer: ReviewDiffHunk[];
    private capacity: number;
    private head: number = 0;
    private count: number = 0;
    private dirty: boolean = false;
    private flushTimer: NodeJS.Timeout | null = null;
    private storageAdapter?: IPraxisHumanFaceStorage;
    private onEvictToR4?: (payload: Uint8Array, archiveId: string) => void;

    /**
     * Allocate the ring storage and start the periodic flush timer when configured.
     *
     * @param options - Ring options; omitted fields use the defaults documented on
     *   `RingBufferOptions`, and the instance keeps references to the supplied adapter and hook.
     * @throws RangeError - When `capacity` is non-finite and cannot size an array.
     */
    constructor(options: RingBufferOptions = {}) {
        this.capacity = Math.max(1, options.capacity || DEFAULT_RING_CAPACITY);
        this.buffer = new Array(this.capacity);
        this.storageAdapter = options.storageAdapter;
        this.onEvictToR4 = options.onEvictToR4;

        const interval = options.flushIntervalMs || DEFAULT_FLUSH_INTERVAL_MS;
        if (interval > 0 && typeof setInterval !== 'undefined') {
            this.flushTimer = setInterval(() => {
                if (this.dirty) {
                    this.flushSnapshot();
                }
            }, interval);
            // Ensure timer doesn't keep Node process alive
            if (this.flushTimer.unref) {
                this.flushTimer.unref();
            }
        }
    }

    /**
     * Append one diff hunk into the ring buffer.
     *
     * The hunk is written at the next free slot until the ring is full, after which the oldest
     * hunk is evicted and its slot is reused while `head` advances. The buffer is marked dirty,
     * and `storageAdapter.appendDiffChunk` is invoked when present; a synchronous storage-side
     * failure propagates after the in-memory mutation has already happened.
     *
     * @param hunk - Hunk to retain; the buffer stores the reference rather than a deep copy.
     * @throws Error - Propagates a synchronous error from `storageAdapter.appendDiffChunk`; the
     *   hunk has already been accepted into the ring when that error escapes.
     */
    push(hunk: ReviewDiffHunk): void {
        if (this.count === this.capacity) {
            // Buffer full: evict the oldest hunk at current head
            const oldest = this.buffer[this.head];
            if (oldest) {
                this.evictHunk(oldest);
            }
            this.buffer[this.head] = hunk;
            this.head = (this.head + 1) % this.capacity;
        } else {
            const insertIdx = (this.head + this.count) % this.capacity;
            this.buffer[insertIdx] = hunk;
            this.count++;
        }

        this.dirty = true;
        if (this.storageAdapter?.appendDiffChunk) {
            this.storageAdapter.appendDiffChunk(hunk);
        }
    }

    /**
     * Append multiple hunks in oldest-first order.
     *
     * Equivalent to calling `push` once per element, so overflow eviction, dirty marking, and
     * storage side effects occur for each hunk independently.
     *
     * @param hunks - Hunks appended in iteration order; an empty array leaves the ring untouched.
     * @throws Error - Propagates the first synchronous error from `push`; hunks appended before
     *   the failure remain in the ring.
     */
    pushMany(hunks: ReviewDiffHunk[]): void {
        for (const hunk of hunks) {
            this.push(hunk);
        }
    }

    /**
     * Retrieve all active hunks in chronological order.
     *
     * @returns A new array ordered oldest to newest; entries are the same references retained by
     *   the ring, and mutating the returned array does not affect the buffer itself.
     */
    toArray(): ReviewDiffHunk[] {
        const result: ReviewDiffHunk[] = [];
        for (let i = 0; i < this.count; i++) {
            const idx = (this.head + i) % this.capacity;
            result.push(this.buffer[idx]);
        }
        return result;
    }

    /**
     * Get the number of hunks currently retained.
     *
     * @returns Count in the inclusive range 0 through `capacity`; never negative.
     */
    size(): number {
        return this.count;
    }

    /**
     * Manually trigger the periodic snapshot flush.
     *
     * The dirty flag is cleared before delegation, so a subsequent push marks the buffer dirty
     * again. A Promise returned by the adapter is not awaited, matching the fire-and-forget timer
     * path used by `setInterval`.
     *
     * @throws Error - Propagates a synchronous error from `flushPeriodicSnapshot`; the dirty flag
     *   has already been cleared when the error escapes.
     */
    flushSnapshot(): void {
        this.dirty = false;
        if (this.storageAdapter?.flushPeriodicSnapshot) {
            this.storageAdapter.flushPeriodicSnapshot();
        }
    }

    /**
     * Stop the periodic timer, flush pending state, and clear the ring and counters.
     *
     * Safe to call more than once. Because `clearInterval` is synchronous, no Promise is returned;
     * callers cannot await timer teardown, but no callback can fire after this method returns.
     *
     * @throws Error - Propagates a synchronous flush error before the ring and counters are
     *   cleared, leaving the buffered hunks intact but the timer already stopped.
     */
    dispose(): void {
        if (this.flushTimer) {
            clearInterval(this.flushTimer);
            this.flushTimer = null;
        }
        if (this.dirty) {
            this.flushSnapshot();
        }
        this.buffer = [];
        this.count = 0;
        this.head = 0;
    }

    /**
     * Evict a stale hunk, encode it as UTF-8 JSON, and dispatch it through the R4 SPI.
     *
     * Fail-safe by design: serialization, encoding, adapter, and callback exceptions are swallowed
     * so archival trouble can never break a scan. A Promise-returning adapter is handled
     * asynchronously through attached handlers without blocking the caller, and rejection is
     * ignored. A synchronous adapter result invokes the callback only when it carries an archive
     * id.
     *
     * @param hunk - Oldest hunk being overwritten; it is serialized without mutation.
     */
    private evictHunk(hunk: ReviewDiffHunk): void {
        try {
            const jsonStr = JSON.stringify(hunk);
            const encoder = new TextEncoder();
            const binaryPayload = encoder.encode(jsonStr);

            if (this.storageAdapter?.evictToR4Archive) {
                const res = this.storageAdapter.evictToR4Archive(binaryPayload);
                if (res instanceof Promise) {
                    res.then((r) => {
                        if (this.onEvictToR4) this.onEvictToR4(binaryPayload, r.archiveId);
                    }).catch(() => {});
                } else if (res && this.onEvictToR4) {
                    this.onEvictToR4(binaryPayload, res.archiveId);
                }
            }
        } catch {
            // Best-effort: non-blocking eviction fail-safe
        }
    }
}
