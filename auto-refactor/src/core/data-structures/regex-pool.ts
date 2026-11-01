/**
 * Module: Core Data Structures — Leased Regular Expression & Scanner Pool
 * File Path: src/core/data-structures/regex-pool.ts
 * Architecture Role: High-performance reusable regex and scanner pool eliminating transient
 *   RegExp allocations on hot paths while guaranteeing lastIndex concurrency safety.
 * Dependencies & Triggers: Zero external dependencies; consumes native RegExp and Map.
 *   Triggered by regex-patterns factories, secrets analyzer, and line-level token scanners.
 * Responsibilities:
 *   1. Cache immutable compiled RegExp instances for pattern reuse across files;
 *   2. Maintain leased pool buckets for stateful global (/g) regular expressions;
 *   3. Enforce automatic lastIndex = 0 reset upon lease and return to prevent race conditions;
 *   4. Provide bounded capacity per pattern bucket to prevent memory leaks in daemon mode.
 * Exit Semantics & Design Rationale: CC <= 6, Depth <= 3; pure data structure; non-throwing
 *   fail-safe semantics.
 */

import { sharedMemoryGovernor, CacheEvictionTier } from '../memory/memory-governor';

const DEFAULT_BUCKET_CAPACITY = 16;
const DEFAULT_MAX_DISTINCT_PATTERNS = 256;

/**
 * Options for configuring regex pool behavior.
 */
export interface RegexPoolOptions {
    /** Maximum reusable instances retained per distinct pattern/flag combination (default 16). */
    readonly bucketCapacity?: number;
    /** Maximum distinct patterns tracked before evicting least-used buckets (default 256). */
    readonly maxDistinctPatterns?: number;
}

/**
 * High-throughput leased RegExp pool providing zero-allocation reuse for stateful scanners.
 */
export class LeasedRegexPool {
    private readonly buckets = new Map<string, RegExp[]>();
    private readonly compiledCache = new Map<string, RegExp>();
    private readonly bucketCapacity: number;
    private readonly maxDistinctPatterns: number;

    public constructor(options?: RegexPoolOptions) {
        this.bucketCapacity = Math.max(1, options?.bucketCapacity ?? DEFAULT_BUCKET_CAPACITY);
        this.maxDistinctPatterns = Math.max(
            8,
            options?.maxDistinctPatterns ?? DEFAULT_MAX_DISTINCT_PATTERNS,
        );
    }

    /**
     * Escapes regex control characters in a string literal.
     * Guaranteed single source of truth for safe regex string escaping.
     */
    public static escape(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    /**
     * Retrieves or compiles a bounded cached RegExp instance.
     * Guaranteed immutable reuse for stateless regex tests and matches.
     *
     * @param pattern - Regular expression pattern source string.
     * @param flags - Optional regular expression flags (e.g. 'i'). Avoid 'g'/'y'.
     * @returns A cached RegExp instance with bounded memory eviction.
     */
    public getCompiled(pattern: string, flags = ''): RegExp {
        const key = this.buildKey(pattern, flags);
        const cached = this.compiledCache.get(key);
        if (cached !== undefined) {
            return cached;
        }
        if (this.compiledCache.size >= this.maxDistinctPatterns) {
            const firstKey = this.compiledCache.keys().next().value;
            if (firstKey !== undefined) {
                this.compiledCache.delete(firstKey);
            }
        }
        const compiled = new RegExp(pattern, flags);
        this.compiledCache.set(key, compiled);
        return compiled;
    }

    /**
     * Borrows a stateful RegExp instance for the given source and flags.
     * Guarantees `lastIndex = 0`.
     *
     * @param pattern - Regular expression pattern source string.
     * @param flags - Optional regular expression flags (e.g. 'g', 'i').
     * @returns A ready-to-use RegExp instance with lastIndex set to 0.
     */
    public borrow(pattern: string, flags = ''): RegExp {
        const key = this.buildKey(pattern, flags);
        const bucket = this.buckets.get(key);
        if (bucket !== undefined && bucket.length > 0) {
            const re = bucket.pop()!;
            re.lastIndex = 0;
            return re;
        }
        return new RegExp(pattern, flags);
    }

    /**
     * Returns a stateful RegExp instance to the pool, resetting `lastIndex = 0`.
     *
     * @param re - The RegExp instance to recycle.
     * @param pattern - Original pattern source string.
     * @param flags - Original regular expression flags.
     */
    public return(re: RegExp, pattern: string, flags = ''): void {
        re.lastIndex = 0;
        const key = this.buildKey(pattern, flags);
        let bucket = this.buckets.get(key);
        if (bucket === undefined) {
            if (this.buckets.size >= this.maxDistinctPatterns) {
                // Evict the first registered bucket to bound distinct pattern memory
                const firstKey = this.buckets.keys().next().value;
                if (firstKey !== undefined) {
                    this.buckets.delete(firstKey);
                }
            }
            bucket = [];
            this.buckets.set(key, bucket);
        }
        if (bucket.length < this.bucketCapacity) {
            bucket.push(re);
        }
    }

    /**
     * Executes a callback with a safely leased and automatically returned RegExp instance.
     * Eliminates leak risks if the callback throws.
     *
     * @param pattern - Regular expression pattern source string.
     * @param flags - Optional flags string.
     * @param fn - Callback receiving the prepared scanner.
     * @returns The callback return value.
     */
    public withScanner<T>(pattern: string, flags: string, fn: (scanner: RegExp) => T): T {
        const scanner = this.borrow(pattern, flags);
        try {
            return fn(scanner);
        } finally {
            this.return(scanner, pattern, flags);
        }
    }

    /**
     * Clears all pooled instances and resets capacity buckets.
     */
    public clear(): void {
        this.buckets.clear();
        this.compiledCache.clear();
    }

    /**
     * Current number of distinct pattern buckets retained in the pool.
     */
    public get distinctPatternsCount(): number {
        return this.buckets.size + this.compiledCache.size;
    }

    private buildKey(pattern: string, flags: string): string {
        return `${flags}:${pattern}`;
    }
}

/** Global singleton instance for shared scanner leasing across workers. */
export const sharedRegexPool = new LeasedRegexPool();

sharedMemoryGovernor.register({
    name: 'sharedRegexPool',
    tier: CacheEvictionTier.Ephemeral,
    clear: () => sharedRegexPool.clear(),
    getSize: () => sharedRegexPool.distinctPatternsCount,
});
