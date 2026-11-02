/**
 * Module: Core Engine — Line Buffer Allocation and Scratch Pool
 * File Path: src/core/diff/line-buffer-pool.ts
 * Architecture Role: High-performance typed-array buffer allocator and scratch pool
 *   for single-pass line hashing and index generation, mitigating memory allocations.
 * Dependencies & Triggers: Consumed exclusively by edit-diff during diff index computations.
 * Responsibilities:
 *   1. Manage reusable scratch Int32Array and Uint32Array allocations;
 *   2. Rebuild and expand buffer capacity geometrically upon line-count overflow;
 *   3. Enforce deterministic state isolation across concurrent or nested diff computations.
 * Exit Semantics & Design Rationale: CC <= 15; pure typed-array operations; zero unhandled errors.
 */

/** Initial scratch line-table capacity in lines to avoid early reallocation. */
const INITIAL_SCRATCH_CAPACITY = 16384;

/**
 * Working buffers passed to single-pass line hashing routines.
 */
export interface WorkingBuffers {
    starts: Int32Array;
    hashes: Uint32Array;
    capacity: number;
    isScratch: boolean;
}

/**
 * Encapsulated internal scratch state container avoiding module-level mutable variables.
 */
interface ScratchStateHolder {
    starts: Int32Array;
    hashes: Uint32Array;
    inUse: boolean;
}

const scratchState: ScratchStateHolder = {
    starts: new Int32Array(INITIAL_SCRATCH_CAPACITY),
    hashes: new Uint32Array(INITIAL_SCRATCH_CAPACITY),
    inUse: false,
};

/**
 * Builds typed arrays with doubled capacity, preserving existing data contents.
 *
 * @param startsBuf - Existing line start indices buffer.
 * @param hashesBuf - Existing line hash values buffer.
 * @param capacity - Current buffer capacity.
 * @returns Object with expanded buffers and updated capacity.
 */
export function buildLineBuffers(
    startsBuf: Int32Array,
    hashesBuf: Uint32Array,
    capacity: number,
): { starts: Int32Array; hashes: Uint32Array; capacity: number } {
    const nextCapacity = capacity << 1;
    const nextStarts = new Int32Array(nextCapacity);
    nextStarts.set(startsBuf);
    const nextHashes = new Uint32Array(nextCapacity);
    nextHashes.set(hashesBuf);
    return { starts: nextStarts, hashes: nextHashes, capacity: nextCapacity };
}

/**
 * Acquires working buffers for line hashing, prioritizing the reusable scratch pool.
 *
 * @param capacity - Minimum required initial capacity.
 * @returns Allocated or checked-out working buffers.
 */
export function acquireLineBuffers(capacity: number): WorkingBuffers {
    if (!scratchState.inUse) {
        scratchState.inUse = true;
        if (scratchState.starts.length < capacity) {
            const nextCap = Math.max(capacity, scratchState.starts.length << 1);
            scratchState.starts = new Int32Array(nextCap);
            scratchState.hashes = new Uint32Array(nextCap);
        }
        return {
            starts: scratchState.starts,
            hashes: scratchState.hashes,
            capacity: scratchState.starts.length,
            isScratch: true,
        };
    }
    return {
        starts: new Int32Array(capacity),
        hashes: new Uint32Array(capacity),
        capacity,
        isScratch: false,
    };
}

/**
 * Expands working buffers when line capacity is exceeded.
 *
 * @param buffers - Working buffer context to expand in-place.
 */
export function expandWorkingBuffers(buffers: WorkingBuffers): void {
    const resized = buildLineBuffers(buffers.starts, buffers.hashes, buffers.capacity);
    buffers.starts = resized.starts;
    buffers.hashes = resized.hashes;
    buffers.capacity = resized.capacity;
    if (buffers.isScratch) {
        scratchState.starts = resized.starts;
        scratchState.hashes = resized.hashes;
    }
}

/**
 * Releases scratch working buffers back to the pool upon diff completion.
 *
 * @param buffers - Working buffer context being retired.
 */
export function releaseLineBuffers(buffers: WorkingBuffers): void {
    if (buffers.isScratch) {
        scratchState.inUse = false;
    }
}
