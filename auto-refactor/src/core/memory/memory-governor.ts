/**
 * Module: Core Engine — Unified Memory Governor & Multi-Tier Cache Eviction
 * File Path: src/core/memory/memory-governor.ts
 * Architecture Role: Centralized process memory telemetry, RSS/heap pressure monitor,
 *   and coordinated multi-tier cache evictor across scanner, parser, and report pipelines.
 * Dependencies & Triggers: Consumes native process.memoryUsage; zero external runtime dependencies;
 *   triggered by daemon memory guards, batch scan stages, or on-demand pressure sweeps.
 * Responsibilities:
 *   1. Track process RSS and heap memory consumption against soft and hard thresholds;
 *   2. Register in-memory caches categorized into Ephemeral, Intermediate, and Durable tiers;
 *   3. Coordinate prioritized, staged eviction to shed memory without thrashing hot indices;
 *   4. Export observable telemetry on memory pressure, cache registrations, and eviction sweeps.
 * Exit Semantics & Design Rationale: CC <= 8, Depth <= 3; strictly non-throwing; safe against
 *   throwing cache clear functions; returns structured sweep statistics.
 */

/**
 * Cache eviction hierarchy tier indicating recreation cost and retention priority.
 */
export enum CacheEvictionTier {
    /** Ephemeral caches: trivial to reconstruct, high churn (e.g. anchor slices, regex leases). */
    Ephemeral = 1,
    /** Intermediate caches: moderate rebuild cost (e.g. Radix prefix trees, review context). */
    Intermediate = 2,
    /** Durable caches: high reconstruction cost, only cleared under severe memory pressure. */
    Durable = 3,
}

/**
 * Registration contract for caches participating in memory governance.
 */
export interface CacheRegistration {
    /** Unique human-readable name of the cache instance. */
    readonly name: string;
    /** Eviction tier controlling when this cache is cleared. */
    readonly tier: CacheEvictionTier;
    /** Callback invoked to clear or trim the cache. */
    readonly clear: () => void;
    /** Optional callback returning current size or entry count of the cache. */
    readonly getSize?: () => number;
}

/**
 * Memory pressure level determined by process heap and RSS telemetry.
 */
export type MemoryPressureLevel = 'nominal' | 'elevated' | 'critical';

/**
 * Snapshot of current process memory telemetry.
 */
export interface ProcessMemoryStats {
    readonly rssMb: number;
    readonly heapUsedMb: number;
    readonly heapTotalMb: number;
    readonly externalMb: number;
    readonly pressure: MemoryPressureLevel;
}

/**
 * Summary result of an eviction sweep.
 */
export interface SweepResult {
    readonly sweptTiers: CacheEvictionTier[];
    readonly cachesCleared: number;
    readonly memoryBefore: ProcessMemoryStats;
    readonly memoryAfter: ProcessMemoryStats;
    readonly reclaimedHeapMb: number;
}

/**
 * Configuration options for MemoryGovernor thresholds.
 */
export interface MemoryGovernorOptions {
    /** Soft heap limit in MB triggering Ephemeral eviction (default: 512). */
    readonly softHeapLimitMb?: number;
    /** Hard heap limit in MB triggering Intermediate & Durable eviction (default: 768). */
    readonly hardHeapLimitMb?: number;
    /** Soft RSS limit in MB (default: 768). */
    readonly softRssLimitMb?: number;
    /** Hard RSS limit in MB (default: 1024). */
    readonly hardRssLimitMb?: number;
}

const BYTES_PER_MB = 1024 * 1024;
const DEFAULT_SOFT_HEAP_MB = 512;
const DEFAULT_HARD_HEAP_MB = 768;
const DEFAULT_SOFT_RSS_MB = 768;
const DEFAULT_HARD_RSS_MB = 1024;

/**
 * Centralized memory monitor and cache eviction governor.
 */
export class MemoryGovernor {
    private readonly registrations = new Map<string, CacheRegistration>();
    private readonly softHeapLimitMb: number;
    private readonly hardHeapLimitMb: number;
    private readonly softRssLimitMb: number;
    private readonly hardRssLimitMb: number;

    public constructor(options?: MemoryGovernorOptions) {
        this.softHeapLimitMb = options?.softHeapLimitMb ?? DEFAULT_SOFT_HEAP_MB;
        this.hardHeapLimitMb = options?.hardHeapLimitMb ?? DEFAULT_HARD_HEAP_MB;
        this.softRssLimitMb = options?.softRssLimitMb ?? DEFAULT_SOFT_Rss_MB();
        this.hardRssLimitMb = options?.hardRssLimitMb ?? DEFAULT_HARD_RSS_MB;
    }

    /**
     * Registers a cache for coordinated memory eviction sweeps.
     *
     * @param registration - Cache descriptor, tier, and clear hook.
     * @returns Unsubscribe function to unregister the cache.
     */
    public register(registration: CacheRegistration): () => void {
        this.registrations.set(registration.name, registration);
        return () => {
            this.registrations.delete(registration.name);
        };
    }

    /**
     * Number of registered caches currently tracked.
     */
    public get registeredCount(): number {
        return this.registrations.size;
    }

    /**
     * Inspects current process memory usage and determines pressure level.
     *
     * @returns ProcessMemoryStats with MB values and pressure tier.
     */
    public getMemoryStats(): ProcessMemoryStats {
        const mem = process.memoryUsage();
        const rssMb = Math.round((mem.rss / BYTES_PER_MB) * 100) / 100;
        const heapUsedMb = Math.round((mem.heapUsed / BYTES_PER_MB) * 100) / 100;
        const heapTotalMb = Math.round((mem.heapTotal / BYTES_PER_MB) * 100) / 100;
        const externalMb = Math.round((mem.external / BYTES_PER_MB) * 100) / 100;

        let pressure: MemoryPressureLevel = 'nominal';
        if (heapUsedMb >= this.hardHeapLimitMb || rssMb >= this.hardRssLimitMb) {
            pressure = 'critical';
        } else if (heapUsedMb >= this.softHeapLimitMb || rssMb >= this.softRssLimitMb) {
            pressure = 'elevated';
        }

        return { rssMb, heapUsedMb, heapTotalMb, externalMb, pressure };
    }

    /**
     * Executes a memory-based sweep, automatically selecting tiers based on pressure level.
     *
     * @returns SweepResult detailing tiers swept and memory changes.
     */
    public autoSweep(): SweepResult {
        const stats = this.getMemoryStats();
        if (stats.pressure === 'critical') {
            return this.sweep([
                CacheEvictionTier.Ephemeral,
                CacheEvictionTier.Intermediate,
                CacheEvictionTier.Durable,
            ]);
        }
        if (stats.pressure === 'elevated') {
            return this.sweep([CacheEvictionTier.Ephemeral, CacheEvictionTier.Intermediate]);
        }
        return {
            sweptTiers: [],
            cachesCleared: 0,
            memoryBefore: stats,
            memoryAfter: stats,
            reclaimedHeapMb: 0,
        };
    }

    /**
     * Manually triggers an eviction sweep across specified cache tiers.
     *
     * @param tiers - Array or single tier to evict. Defaults to Ephemeral.
     * @returns SweepResult detailing outcome.
     */
    public sweep(tiers?: CacheEvictionTier | CacheEvictionTier[]): SweepResult {
        const targetTiers = new Set<CacheEvictionTier>(
            tiers !== undefined
                ? Array.isArray(tiers)
                    ? tiers
                    : [tiers]
                : [CacheEvictionTier.Ephemeral],
        );

        const before = this.getMemoryStats();
        let clearedCount = 0;

        for (const registration of this.registrations.values()) {
            if (!targetTiers.has(registration.tier)) {
                continue;
            }
            clearedCount += this.tryClearRegistration(registration);
        }

        const after = this.getMemoryStats();
        const reclaimed = Math.max(
            0,
            Math.round((before.heapUsedMb - after.heapUsedMb) * 100) / 100,
        );

        return {
            sweptTiers: Array.from(targetTiers),
            cachesCleared: clearedCount,
            memoryBefore: before,
            memoryAfter: after,
            reclaimedHeapMb: reclaimed,
        };
    }

    private tryClearRegistration(registration: CacheRegistration): number {
        try {
            registration.clear();
            return 1;
        } catch (err) {
            void err;
            return 0;
        }
    }
}

function DEFAULT_SOFT_Rss_MB(): number {
    return DEFAULT_SOFT_RSS_MB;
}

/** Global shared singleton MemoryGovernor instance for auto-refactor runtime. */
export const sharedMemoryGovernor = new MemoryGovernor();
