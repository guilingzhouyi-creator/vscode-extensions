/**
 * Module: Core Data Structures — Power-of-Two Bitwise Ring Buffer
 * File Path: src/core/data-structures/ring-buffer.ts
 * Architecture Role: Foundation generic bounded circular FIFO queue utilizing power-of-two
 *   bitwise masking for zero-division index wrap-around and zero transient allocations.
 * Dependencies & Triggers: Zero external runtime dependencies.
 * Responsibilities:
 *   1. Normalise requested capacity to the next power of two for fast bitwise masking (mask = cap -
 *   1); 2. Provide O(1) push, pop, peek, and bulk drain operations with zero loop heap allocations;
 *   3. Support customizable overflow policies ('reject' or 'drop_oldest');
 *   4. Export snapshot toArray() in strictly chronological FIFO order.
 * Exit Semantics & Design Rationale: CC <= 7; deterministic memory bounds; non-throwing fail-safe semantics.
 */

/**
 * Overflow handling policy when circular buffer capacity is reached.
 */
export type RingBufferOverflowPolicy = 'reject' | 'drop_oldest';

/**
 * Configuration options for RingBuffer initialization.
 */
export interface RingBufferConfig {
    /** Requested slot capacity (normalized to next power of two, minimum 4) */
    readonly capacity?: number;
    /** Overflow handling behavior (default 'drop_oldest') */
    readonly policy?: RingBufferOverflowPolicy;
}

const DEFAULT_RING_CAPACITY = 1024;
const MIN_RING_CAPACITY = 4;

function calculateNextPowerOfTwo(val: number): number {
    let power = 1;
    while (power < val) {
        power <<= 1;
    }
    return power;
}

/**
 * High-performance bounded circular buffer.
 */
export class RingBuffer<T> {
    private readonly buffer: (T | undefined)[];
    private readonly capacityMask: number;
    private readonly _capacity: number;
    private readonly policy: RingBufferOverflowPolicy;

    private head = 0; // Read cursor
    private tail = 0; // Write cursor
    private _size = 0;

    public constructor(options?: number | RingBufferConfig) {
        const rawCap =
            typeof options === 'number' ? options : (options?.capacity ?? DEFAULT_RING_CAPACITY);
        const rawPolicy =
            typeof options === 'object' && options?.policy ? options.policy : 'drop_oldest';

        this._capacity = calculateNextPowerOfTwo(Math.max(MIN_RING_CAPACITY, rawCap));
        this.capacityMask = this._capacity - 1;
        this.buffer = new Array<T | undefined>(this._capacity);
        this.policy = rawPolicy;
    }

    /**
     * Normalized power-of-two capacity of the circular buffer.
     */
    public get capacity(): number {
        return this._capacity;
    }

    /**
     * Current number of stored elements.
     */
    public get size(): number {
        return this._size;
    }

    /**
     * Whether the buffer is completely empty.
     */
    public get isEmpty(): boolean {
        return this._size === 0;
    }

    /**
     * Whether the buffer is full to its capacity limit.
     */
    public get isFull(): boolean {
        return this._size === this._capacity;
    }

    /**
     * Enqueues an item into the circular buffer.
     *
     * @param item - Value to enqueue.
     * @returns True if inserted; false if rejected under 'reject' policy.
     */
    public push(item: T): boolean {
        if (this._size === this._capacity) {
            if (this.policy === 'reject') {
                return false;
            }
            // Under 'drop_oldest', advance head cursor to discard oldest entry
            this.buffer[this.head] = undefined;
            this.head = (this.head + 1) & this.capacityMask;
            this._size--;
        }

        this.buffer[this.tail] = item;
        this.tail = (this.tail + 1) & this.capacityMask;
        this._size++;
        return true;
    }

    /**
     * Dequeues the oldest item in FIFO order.
     *
     * @returns Oldest item, or undefined if buffer is empty.
     */
    public pop(): T | undefined {
        if (this._size === 0) {
            return undefined;
        }

        const item = this.buffer[this.head];
        this.buffer[this.head] = undefined;
        this.head = (this.head + 1) & this.capacityMask;
        this._size--;
        return item;
    }

    /**
     * Inspects the oldest item without dequeuing it.
     *
     * @returns Oldest item, or undefined if empty.
     */
    public peek(): T | undefined {
        if (this._size === 0) {
            return undefined;
        }
        return this.buffer[this.head];
    }

    /**
     * Drains all queued elements into a target array in FIFO order without intermediate allocations.
     *
     * @param target - Destination array to push drained items into.
     * @returns Number of drained items.
     */
    public drainInto(target: T[]): number {
        const drainedCount = this._size;
        while (this._size > 0) {
            const item = this.pop();
            if (item !== undefined) {
                target.push(item);
            }
        }
        return drainedCount;
    }

    /**
     * Materializes all queued elements as an array in FIFO chronological order.
     *
     * @returns Fresh array containing all queued items from oldest to newest.
     */
    public toArray(): T[] {
        const result: T[] = new Array(this._size);
        for (let i = 0; i < this._size; i++) {
            const slot = (this.head + i) & this.capacityMask;
            result[i] = this.buffer[slot] as T;
        }
        return result;
    }

    /**
     * Clears all stored elements and resets cursors.
     */
    public clear(): void {
        this.buffer.fill(undefined);
        this.head = 0;
        this.tail = 0;
        this._size = 0;
    }
}
