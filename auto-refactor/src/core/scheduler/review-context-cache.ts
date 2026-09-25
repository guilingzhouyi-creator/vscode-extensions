/**
 * Module: Core Engine - Review Context & State Fingerprint Cache
 * File Path: src/core/scheduler/review-context-cache.ts
 * Architecture Role: In-memory cache store preserving AST facts, density metrics, and findings;
 *   powers secondary cascade re-checks and cross-partition verification without redundant I/O.
 * Dependencies & Triggers: scheduler-types; consumed by sparse-orchestrator.
 * Responsibilities: Cache file review context keyed by file path and content fingerprint;
 *   track hit/miss metrics; provide query access for secondary semantic cascade passes.
 * Exit Semantics & Design Rationale: Bounded LRU-style in-memory map; never throws.
 */

import type { ReviewContextEntry } from './scheduler-types';

/** Maximum retained in-memory cache entries */
const MAX_CACHE_ENTRIES = 2000;

/**
 * Computes a fast deterministic content hash string.
 *
 * @param content - Source file content
 * @returns Formatted hash string
 */
export function computeSimpleContentHash(content: string): string {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
        hash = (hash << 5) - hash + content.charCodeAt(i);
        hash |= 0;
    }
    return `h${hash}_${content.length}`;
}

/**
 * Review context in-memory cache manager.
 */
export class ReviewContextCache {
    private readonly entries = new Map<string, ReviewContextEntry>();
    private hitCount = 0;
    private missCount = 0;

    /**
     * Retrieves a cached context entry if fingerprint matches.
     *
     * @param filePath - Target file path
     * @param contentHash - Expected content fingerprint hash
     * @returns Matching ReviewContextEntry or undefined
     */
    public get(filePath: string, contentHash: string): ReviewContextEntry | undefined {
        const entry = this.entries.get(filePath);
        if (entry && entry.contentHash === contentHash) {
            this.hitCount++;
            return entry;
        }
        this.missCount++;
        return undefined;
    }

    /**
     * Stores or updates a review context entry.
     *
     * @param entry - Context entry payload
     */
    public set(entry: ReviewContextEntry): void {
        if (this.entries.size >= MAX_CACHE_ENTRIES) {
            const firstKey = this.entries.keys().next().value;
            if (firstKey) {
                this.entries.delete(firstKey);
            }
        }
        this.entries.set(entry.filePath, entry);
    }

    /**
     * Returns all currently retained context entries.
     */
    public getAllEntries(): ReviewContextEntry[] {
        return Array.from(this.entries.values());
    }

    /**
     * Retrieves cache telemetry and hit ratio metrics.
     */
    public getMetrics(): { hits: number; misses: number; hitRatio: number; size: number } {
        const total = this.hitCount + this.missCount;
        const hitRatio = total > 0 ? Number((this.hitCount / total).toFixed(3)) : 0;
        return {
            hits: this.hitCount,
            misses: this.missCount,
            hitRatio,
            size: this.entries.size,
        };
    }

    /**
     * Clears all entries and resets telemetry counters.
     */
    public clear(): void {
        this.entries.clear();
        this.hitCount = 0;
        this.missCount = 0;
    }
}

/** Default singleton instance of ReviewContextCache */
export const defaultReviewContextCache = new ReviewContextCache();
