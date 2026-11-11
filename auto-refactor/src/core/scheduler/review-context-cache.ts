/**
 * Module: Core Engine - Review Context & State Fingerprint Cache
 * File Path: src/core/scheduler/review-context-cache.ts
 * Architecture Role: In-memory cache store preserving AST facts, density metrics, and findings;
 *   powers secondary cascade re-checks and cross-partition verification without redundant I/O.
 * Dependencies & Triggers: scheduler-types; consumed by sparse-orchestrator.
 * Responsibilities: Cache detached facts by source, workspace, execution and partition identity;
 *   track hit/miss metrics; provide query access for secondary semantic cascade passes.
 * Exit Semantics & Design Rationale: Bounded LRU map; non-cloneable entry payloads fail explicitly.
 */

import type { ReviewContextEntry } from './scheduler-types';
import { LruCache } from '../data-structures/lru-cache';
import { createHash } from 'node:crypto';

/** Maximum retained in-memory cache entries */
const MAX_CACHE_ENTRIES = 2000;

/**
 * Computes an opaque SHA-256 fingerprint of the exact UTF-16 code units.
 * UTF-16 preserves distinct unpaired surrogates that UTF-8 replaces with the same bytes.
 *
 * @param content - Source file content
 * @returns Versioned cryptographic fingerprint; the historical export name remains compatible.
 */
export function computeSimpleContentHash(content: string): string {
    return `sha256-utf16:${createHash('sha256').update(content, 'utf16le').digest('hex')}`;
}

/**
 * Review context in-memory cache manager backed by true O(1) LruCache container.
 */
export class ReviewContextCache {
    private readonly entries = new LruCache<string, ReviewContextEntry>(MAX_CACHE_ENTRIES);
    private hitCount = 0;
    private missCount = 0;

    /**
     * Retrieves a cached context entry if fingerprint matches.
     * Refreshes entry recency in the LRU eviction order upon hit.
     *
     * @param filePath - Target file path
     * @param contentHash - Expected exact content fingerprint.
     * @param contextHash - Workspace, configuration, executor and partition identity.
     * @returns Detached matching entry or undefined.
     */
    public get(
        filePath: string,
        contentHash: string,
        contextHash?: string,
    ): ReviewContextEntry | undefined {
        const entry = this.entries.get(JSON.stringify([filePath, contextHash ?? null]));
        if (entry && entry.contentHash === contentHash && entry.contextHash === contextHash) {
            this.hitCount++;
            return structuredClone(entry);
        }
        this.missCount++;
        return undefined;
    }

    /**
     * Stores or updates a review context entry.
     * Automatically evicts the least recently used item on capacity overflow.
     *
     * @param entry - Context entry payload
     */
    public set(entry: ReviewContextEntry): void {
        this.entries.set(
            JSON.stringify([entry.filePath, entry.contextHash ?? null]),
            structuredClone(entry),
        );
    }

    /**
     * Returns all currently retained context entries.
     */
    public getAllEntries(): ReviewContextEntry[] {
        return structuredClone(Array.from(this.entries.values()));
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
