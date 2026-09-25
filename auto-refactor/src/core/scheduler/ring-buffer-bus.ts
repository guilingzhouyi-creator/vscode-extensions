/**
 * Module: Core Engine - High-Throughput Ring Buffer Bus
 * File Path: src/core/scheduler/ring-buffer-bus.ts
 * Architecture Role: Zero-transient-allocation bounded circular buffer transport bus;
 *   replaces dynamic heap allocations with pre-allocated slots for pipeline events.
 * Dependencies & Triggers: Consumes worker-pool-manager, review-event-bus, and scheduler streams.
 * Responsibilities: Maintain fixed-capacity circular memory slots; support atomic push, pop,
 *   bulk drain, backpressure overflow policies (reject, drop_oldest); track buffer metrics.
 * Exit Semantics & Design Rationale: Never throws under memory pressure; deterministic slot
 *   indexing via power-of-two bitwise masking ensures high performance with zero GC thrashing.
 */

/**
 * Overflow handling policy when buffer capacity is reached.
 */
export type RingBufferPolicy = 'reject' | 'drop_oldest';

/**
 * Telemetry metrics for RingBufferBus utilization.
 */
export interface RingBufferMetrics {
    readonly capacity: number;
    readonly currentSize: number;
    readonly highWaterMark: number;
    readonly totalPushed: number;
    readonly totalPopped: number;
    readonly totalDropped: number;
    readonly totalRejected: number;
}

/**
 * High-throughput bounded ring buffer queue.
 */
export class RingBufferBus<T> {
    private readonly buffer: (T | undefined)[];
    private readonly capacityMask: number;
    private readonly _capacity: number;
    private readonly policy: RingBufferPolicy;

    private head = 0; // Read cursor
    private tail = 0; // Write cursor
    private count = 0;

    // Metrics counters
    private highWaterMark = 0;
    private totalPushed = 0;
    private totalPopped = 0;
    private totalDropped = 0;
    private totalRejected = 0;

    public constructor(requestedCapacity = 4096, policy: RingBufferPolicy = 'drop_oldest') {
        // Normalize capacity to power of 2 for fast bitwise masking
        this._capacity = this.nextPowerOfTwo(Math.max(16, requestedCapacity));
        this.capacityMask = this._capacity - 1;
        this.buffer = new Array<T | undefined>(this._capacity);
        this.policy = policy;
    }

    /**
     * Enqueues an item into the ring buffer according to the configured overflow policy.
     *
     * @param item - Value to enqueue
     * @returns True if item was accepted; false if rejected due to full buffer
     */
    public push(item: T): boolean {
        if (this.count === this._capacity) {
            if (this.policy === 'reject') {
                this.totalRejected++;
                return false;
            }
            // 'drop_oldest': advance read cursor to overwrite oldest element
            this.head = (this.head + 1) & this.capacityMask;
            this.count--;
            this.totalDropped++;
        }

        this.buffer[this.tail] = item;
        this.tail = (this.tail + 1) & this.capacityMask;
        this.count++;
        this.totalPushed++;

        if (this.count > this.highWaterMark) {
            this.highWaterMark = this.count;
        }

        return true;
    }

    /**
     * Dequeues the oldest item from the ring buffer.
     *
     * @returns Oldest item, or undefined if empty
     */
    public pop(): T | undefined {
        if (this.count === 0) {
            return undefined;
        }

        const item = this.buffer[this.head];
        this.buffer[this.head] = undefined; // Clear reference for GC
        this.head = (this.head + 1) & this.capacityMask;
        this.count--;
        this.totalPopped++;

        return item;
    }

    /**
     * Inspects the oldest item without advancing read cursor.
     */
    public peek(): T | undefined {
        if (this.count === 0) {
            return undefined;
        }
        return this.buffer[this.head];
    }

    /**
     * Drains available items into a pre-existing destination array to avoid heap allocations.
     *
     * @param target - Destination array to receive elements
     * @param maxItems - Maximum number of items to drain (defaults to all available)
     * @returns Number of items drained into target
     */
    public drainInto(target: T[], maxItems = this.count): number {
        const toDrain = Math.min(maxItems, this.count);
        for (let i = 0; i < toDrain; i++) {
            const item = this.buffer[this.head];
            this.buffer[this.head] = undefined;
            this.head = (this.head + 1) & this.capacityMask;
            target.push(item as T);
        }
        this.count -= toDrain;
        this.totalPopped += toDrain;
        return toDrain;
    }

    /**
     * Drains all elements into a new array.
     */
    public drainAll(): T[] {
        const result: T[] = new Array(this.count);
        for (let i = 0; i < result.length; i++) {
            result[i] = this.buffer[this.head] as T;
            this.buffer[this.head] = undefined;
            this.head = (this.head + 1) & this.capacityMask;
        }
        this.totalPopped += result.length;
        this.count = 0;
        return result;
    }

    /**
     * Current number of elements stored in buffer.
     */
    public size(): number {
        return this.count;
    }

    /**
     * Total slot capacity of buffer.
     */
    public capacity(): number {
        return this._capacity;
    }

    /**
     * Whether buffer contains zero items.
     */
    public isEmpty(): boolean {
        return this.count === 0;
    }

    /**
     * Whether buffer is filled to capacity.
     */
    public isFull(): boolean {
        return this.count === this._capacity;
    }

    /**
     * Resets buffer state and clears all references.
     */
    public clear(): void {
        while (this.count > 0) {
            this.buffer[this.head] = undefined;
            this.head = (this.head + 1) & this.capacityMask;
            this.count--;
        }
        this.head = 0;
        this.tail = 0;
        this.count = 0;
    }

    /**
     * Returns runtime utilization telemetry metrics.
     */
    public getMetrics(): RingBufferMetrics {
        return {
            capacity: this._capacity,
            currentSize: this.count,
            highWaterMark: this.highWaterMark,
            totalPushed: this.totalPushed,
            totalPopped: this.totalPopped,
            totalDropped: this.totalDropped,
            totalRejected: this.totalRejected,
        };
    }

    /**
     * Rounds up integer to nearest power of two for fast bitwise masking.
     */
    private nextPowerOfTwo(n: number): number {
        let p = 1;
        while (p < n) {
            p <<= 1;
        }
        return p;
    }
}
