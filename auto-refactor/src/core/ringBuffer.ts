/**
 * Human-Facing Circular Diff Buffer & Periodic Persistence Subsystem.
 *
 * Implements the "Human-Facing Face" of the One-Body Two-Faces Three-Tier architecture
 * (docs / 1.md §2.1):
 * - Fixed/dynamically scalable in-memory ring buffer holding recent diff chunks for UI display
 * - Periodic asynchronous snapshot persistence to prevent data loss on unexpected crash
 * - Automatic eviction of cold/stale diff chunks converted into compressed binary payloads
 *   dispatched to R4 archival storage via the Praxis SPI hook.
 */

import { ReviewDiffHunk, IPraxisHumanFaceStorage } from './praxis/contracts';

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

export class CircularDiffBuffer {
  private buffer: ReviewDiffHunk[];
  private capacity: number;
  private head: number = 0;
  private count: number = 0;
  private dirty: boolean = false;
  private flushTimer: NodeJS.Timeout | null = null;
  private storageAdapter?: IPraxisHumanFaceStorage;
  private onEvictToR4?: (payload: Uint8Array, archiveId: string) => void;

  constructor(options: RingBufferOptions = {}) {
    this.capacity = Math.max(1, options.capacity || 1000);
    this.buffer = new Array(this.capacity);
    this.storageAdapter = options.storageAdapter;
    this.onEvictToR4 = options.onEvictToR4;

    const interval = options.flushIntervalMs || 3000;
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

  /** Append one or more diff hunks into the ring buffer */
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

  /** Push multiple hunks in sequence */
  pushMany(hunks: ReviewDiffHunk[]): void {
    for (const hunk of hunks) {
      this.push(hunk);
    }
  }

  /** Retrieve all active hunks in chronological order */
  toArray(): ReviewDiffHunk[] {
    const result: ReviewDiffHunk[] = [];
    for (let i = 0; i < this.count; i++) {
      const idx = (this.head + i) % this.capacity;
      result.push(this.buffer[idx]);
    }
    return result;
  }

  /** Get current active hunk count */
  size(): number {
    return this.count;
  }

  /** Manually trigger periodic snapshot flush */
  flushSnapshot(): void {
    this.dirty = false;
    if (this.storageAdapter?.flushPeriodicSnapshot) {
      this.storageAdapter.flushPeriodicSnapshot();
    }
  }

  /** Dispose buffer and clear timers */
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

  /** Evict a stale hunk, compress to JSON binary buffer and dispatch to R4 SPI */
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
      // Non-blocking eviction fail-safe
    }
  }
}
