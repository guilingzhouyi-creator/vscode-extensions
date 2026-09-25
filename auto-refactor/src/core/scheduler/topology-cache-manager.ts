/**
 * Module: Core Engine - Multi-Tier Topology Cache Manager
 * File Path: src/core/scheduler/topology-cache-manager.ts
 * Architecture Role: Multi-tier hierarchical dependency cache providing L1 in-memory LRU,
 *   L2 structured serialization, and L3 directed dependency DAG with cascade invalidation.
 * Dependencies & Triggers: Consumes crypto for hashing; triggered during dynamic partitioning.
 * Responsibilities: Track inter-module import/export dependency edges; maintain L1 and L2 stores;
 *   compute transitive reverse closures upon signature changes; invalidate subgraphs.
 * Exit Semantics & Design Rationale: Never throws; deterministic cache lookups;
 *   guarantees that modifying module A invalidates only its dependent subgraph.
 */

import * as crypto from 'crypto';

/**
 * Cache entry stored in L1 and L2 topology cache layers.
 */
export interface TopologyCacheEntry<T = unknown> {
    readonly key: string;
    readonly contentHash: string;
    readonly signatureHash: string;
    readonly data: T;
    readonly cachedAt: number;
    hits: number;
}

/**
 * Telemetry metrics for topology cache hit rates and invalidation efficiency.
 */
export interface TopologyCacheMetrics {
    readonly l1Size: number;
    readonly l1Capacity: number;
    readonly dependencyEdgesCount: number;
    readonly totalHits: number;
    readonly totalMisses: number;
    readonly totalInvalidations: number;
    readonly hitRatio: number;
}

/**
 * Multi-tier topology cache manager with directed cascade invalidation.
 */
export class TopologyCacheManager<T = unknown> {
    private readonly l1Capacity: number;
    private readonly l1Store = new Map<string, TopologyCacheEntry<T>>();
    private readonly l2Store = new Map<string, TopologyCacheEntry<T>>();

    // Directed dependency graph:
    // dependsOn: file -> Set of files it depends on (outgoing edges)
    // dependedBy: file -> Set of files that depend on it (incoming edges, for reverse cascade)
    private readonly dependsOn = new Map<string, Set<string>>();
    private readonly dependedBy = new Map<string, Set<string>>();

    // Telemetry counters
    private hits = 0;
    private misses = 0;
    private invalidations = 0;

    public constructor(l1Capacity = 1000) {
        this.l1Capacity = Math.max(50, l1Capacity);
    }

    /**
     * Records or updates a directed dependency edge: `sourceFile` depends on `importedTarget`.
     */
    public recordDependency(sourceFile: string, importedTarget: string): void {
        const src = this.normalizePath(sourceFile);
        const tgt = this.normalizePath(importedTarget);

        if (src === tgt) {
            return;
        }

        let outEdges = this.dependsOn.get(src);
        if (!outEdges) {
            outEdges = new Set();
            this.dependsOn.set(src, outEdges);
        }
        outEdges.add(tgt);

        let inEdges = this.dependedBy.get(tgt);
        if (!inEdges) {
            inEdges = new Set();
            this.dependedBy.set(tgt, inEdges);
        }
        inEdges.add(src);
    }

    /**
     * Looks up an entry from L1 memory (or promotes from L2) if content hash matches.
     *
     * @param key - Cache key (usually normalized file path)
     * @param contentHash - Current content hash to verify freshness
     * @returns Cached entry data, or undefined on miss/stale
     */
    public get(key: string, contentHash: string): T | undefined {
        const normKey = this.normalizePath(key);

        // 1. Check L1 Memory Store
        const l1Entry = this.l1Store.get(normKey);
        if (l1Entry && l1Entry.contentHash === contentHash) {
            l1Entry.hits++;
            this.hits++;
            return l1Entry.data;
        }

        // 2. Check L2 Store
        const l2Entry = this.l2Store.get(normKey);
        if (l2Entry && l2Entry.contentHash === contentHash) {
            l2Entry.hits++;
            this.hits++;
            // Promote to L1
            this.putL1(normKey, l2Entry);
            return l2Entry.data;
        }

        this.misses++;
        return undefined;
    }

    /**
     * Stores an analyzed entry in both L1 and L2 cache tiers.
     *
     * @param key - Cache key
     * @param contentHash - Current content hash
     * @param signatureHash - Public API / exported contract signature hash
     * @param data - Arbitrary cached payload
     */
    public put(key: string, contentHash: string, signatureHash: string, data: T): void {
        const normKey = this.normalizePath(key);
        const entry: TopologyCacheEntry<T> = {
            key: normKey,
            contentHash,
            signatureHash,
            data,
            cachedAt: Date.now(),
            hits: 0,
        };

        this.putL1(normKey, entry);
        this.l2Store.set(normKey, entry);
    }

    /**
     * Unidirectionally invalidates a changed file and its transitive dependent closure.
     * If `signatureChanged` is false, only the changed file itself is invalidated.
     * If `signatureChanged` is true, all transitive downstream dependents are invalidated.
     *
     * @param changedFile - Path of the modified file
     * @param signatureChanged - Whether exported interface / public contract changed
     * @returns List of all invalidated file paths
     */
    public invalidateSubtree(changedFile: string, signatureChanged = false): string[] {
        const root = this.normalizePath(changedFile);
        const affected = new Set<string>();
        affected.add(root);

        if (signatureChanged) {
            // Compute transitive reverse-dependency closure via BFS
            const queue = [root];
            while (queue.length > 0) {
                const current = queue.shift()!;
                const dependents = this.dependedBy.get(current);
                if (dependents) {
                    for (const dep of dependents) {
                        if (!affected.has(dep)) {
                            affected.add(dep);
                            queue.push(dep);
                        }
                    }
                }
            }
        }

        for (const file of affected) {
            this.l1Store.delete(file);
            this.l2Store.delete(file);
            this.invalidations++;
        }

        return Array.from(affected);
    }

    /**
     * Retrieves current cache telemetry and hit ratio metrics.
     */
    public getMetrics(): TopologyCacheMetrics {
        const total = this.hits + this.misses;
        const hitRatio = total > 0 ? Number((this.hits / total).toFixed(3)) : 1.0;

        let edgeCount = 0;
        for (const edges of this.dependsOn.values()) {
            edgeCount += edges.size;
        }

        return {
            l1Size: this.l1Store.size,
            l1Capacity: this.l1Capacity,
            dependencyEdgesCount: edgeCount,
            totalHits: this.hits,
            totalMisses: this.misses,
            totalInvalidations: this.invalidations,
            hitRatio,
        };
    }

    /**
     * Clears all stores and dependency graph structures.
     */
    public clear(): void {
        this.l1Store.clear();
        this.l2Store.clear();
        this.dependsOn.clear();
        this.dependedBy.clear();
        this.hits = 0;
        this.misses = 0;
        this.invalidations = 0;
    }

    /**
     * Inserts an entry into L1 with LRU eviction when capacity is reached.
     */
    private putL1(key: string, entry: TopologyCacheEntry<T>): void {
        if (this.l1Store.size >= this.l1Capacity) {
            // Evict least frequently used entry
            let minHits = Number.MAX_SAFE_INTEGER;
            let evictionKey: string | undefined;

            for (const [k, v] of this.l1Store.entries()) {
                if (v.hits < minHits) {
                    minHits = v.hits;
                    evictionKey = k;
                }
            }

            if (evictionKey) {
                this.l1Store.delete(evictionKey);
            }
        }

        this.l1Store.set(key, entry);
    }

    /**
     * Normalizes file paths across operating systems.
     */
    private normalizePath(filePath: string): string {
        return filePath.replace(/\\/g, '/').toLowerCase();
    }
}

/**
 * Computes a quick sha256 or MD5 hash for content string.
 */
export function computeContentHash(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}

/**
 * Default global singleton instance of TopologyCacheManager.
 */
export const defaultTopologyCacheManager = new TopologyCacheManager();
