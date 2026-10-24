/**
 * Module: Core Data Structures — O(1) Least Recently Used (LRU) Cache
 * File Path: src/core/data-structures/lru-cache.ts
 * Architecture Role: Foundation generic O(1) bounded memory cache utilizing ECMAScript Map
 *   insertion-order iteration guarantees to eliminate double-linked list pointer overhead.
 * Dependencies & Triggers: Zero external runtime dependencies; consumes native Map.
 * Responsibilities:
 *   1. Provide strict O(1) get, set, delete, and peek operations;
 *   2. Refresh element access position on get() to protect hot entries from eviction;
 *   3. Evict oldest entry in O(1) when capacity is exceeded, dispatching optional onEvict callback;
 *   4. Eliminate memory fragmentation and O(N log N) bulk sorting eviction hazards.
 * Exit Semantics & Design Rationale: CC <= 6; zero transient allocations on reads/writes; non-throwing.
 */

/**
 * Configuration options for LruCache initialization.
 */
export interface LruCacheOptions<K, V> {
    /** Maximum entries retained in memory before eviction */
    readonly capacity: number;
    /** Optional callback invoked when an entry is evicted due to capacity overflow */
    readonly onEvict?: (key: K, value: V) => void;
}

/**
 * Generic high-throughput O(1) LRU Cache container.
 */
export class LruCache<K, V> {
    private readonly map = new Map<K, V>();
    private readonly _capacity: number;
    private readonly onEvict?: (key: K, value: V) => void;

    public constructor(options: number | LruCacheOptions<K, V>) {
        if (typeof options === 'number') {
            this._capacity = Math.max(1, Math.floor(options));
        } else {
            this._capacity = Math.max(1, Math.floor(options.capacity));
            this.onEvict = options.onEvict;
        }
    }

    /**
     * Maximum capacity of the cache.
     */
    public get capacity(): number {
        return this._capacity;
    }

    /**
     * Current number of stored entries.
     */
    public get size(): number {
        return this.map.size;
    }

    /**
     * Retrieves a value by key and refreshes its position to the most recently used end.
     *
     * @param key - Lookup key.
     * @returns Cached value if found, or undefined.
     */
    public get(key: K): V | undefined {
        const value = this.map.get(key);
        if (value === undefined && !this.map.has(key)) {
            return undefined;
        }
        // Refresh position in Map insertion order
        this.map.delete(key);
        this.map.set(key, value as V);
        return value;
    }

    /**
     * Peeks at a value without updating its LRU access recency.
     *
     * @param key - Lookup key.
     * @returns Cached value if found, or undefined.
     */
    public peek(key: K): V | undefined {
        return this.map.get(key);
    }

    /**
     * Inserts or updates a key-value entry, evicting the least recently used item if capacity is exceeded.
     *
     * @param key - Key to insert.
     * @param value - Value to associate.
     */
    public set(key: K, value: V): void {
        if (this.map.has(key)) {
            this.map.delete(key);
            this.map.set(key, value);
            return;
        }

        if (this.map.size >= this._capacity) {
            const oldestKey = this.map.keys().next().value;
            if (oldestKey !== undefined) {
                const oldestValue = this.map.get(oldestKey)!;
                this.map.delete(oldestKey);
                if (this.onEvict) {
                    this.onEvict(oldestKey, oldestValue);
                }
            }
        }

        this.map.set(key, value);
    }

    /**
     * Checks if a key exists without updating access recency.
     *
     * @param key - Key to inspect.
     * @returns True if key is cached.
     */
    public has(key: K): boolean {
        return this.map.has(key);
    }

    /**
     * Removes an entry by key.
     *
     * @param key - Key to remove.
     * @returns True if entry was removed.
     */
    public delete(key: K): boolean {
        return this.map.delete(key);
    }

    /**
     * Clears all cached entries.
     */
    public clear(): void {
        this.map.clear();
    }

    /**
     * Returns an iterator of cached keys from least recently used to most recently used.
     */
    public keys(): IterableIterator<K> {
        return this.map.keys();
    }

    /**
     * Returns an iterator of cached values from least recently used to most recently used.
     */
    public values(): IterableIterator<V> {
        return this.map.values();
    }

    /**
     * Returns an iterator of cached [key, value] pairs from least recently used to most recently used.
     */
    public entries(): IterableIterator<[K, V]> {
        return this.map.entries();
    }
}
