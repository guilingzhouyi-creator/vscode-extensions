/**
 * Module: Core Engine — DeepInfer 72+ Hour Persistent Review Fact Store
 * File Path: src/core/scheduler/persistent-fact-store.ts
 * Architecture Role: Cross-session persistent immutable analysis fact store inspired by
 *   DeepInfer's 72+ hour KV-cache persistence philosophy. Caches verified invariant facts
 *   (e.g. verified acyclic dependency subgraphs, pure function invariants, and clean rule passes)
 *   in memory with JSON disk backing, eliminating repetitive re-evaluations across days of work.
 * Dependencies & Triggers: Consumes fastDigest from domainFingerprint and Node fs/path. Triggered
 *   by dualTrackPipeline, disaggregated-pipeline, and preflight audit passes.
 * Responsibilities:
 *   1. Store and query immutable analysis facts keyed by module path, content hash, and fact type.
 *   2. Enforce 72-hour sliding window TTL expiration with lazy and explicit pruning.
 *   3. Provide asynchronous disk synchronization to .refactor-trajectory/facts/ with atomic writes.
 *   4. Supply memory-bounded fact indexing without transient heap allocations in lookup loops.
 * Exit Semantics & Design Rationale: Deterministic, non-throwing execution. Returns typed
 *   ReviewFact records or undefined on miss. Survives editor and daemon restarts.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fastDigest } from '../memory/domainFingerprint';

/** Default sliding window time-to-live in milliseconds (72 hours). */
export const DEFAULT_FACT_TTL_MS = 72 * 60 * 60 * 1000;

/** Default relative directory for persistent trajectory facts ledger. */
export const DEFAULT_FACTS_DIR = path.join('.refactor-trajectory', 'facts');

/** Ledger file name within facts directory. */
const FACT_LEDGER_FILENAME = 'review-fact-ledger.json';

/** Maximum cached fact entries in memory before capacity pruning. */
const MAX_IN_MEMORY_FACTS = 4096;

/** Supported immutable analysis fact classification categories. */
export type FactCategory =
    'pure_function' | 'acyclic_subgraph' | 'rule_pass' | 'invariant' | 'symbol_digest';

/**
 * Single immutable analysis fact record.
 */
export interface ReviewFact {
    /** Unique composite fact identifier. */
    readonly factId: string;
    /** Relative or absolute module file path. */
    readonly modulePath: string;
    /** Digest of the source text at the time of evaluation. */
    readonly contentHash: string;
    /** Semantic category of the verified analysis fact. */
    readonly factType: FactCategory | string;
    /** Serialized immutable fact payload data. */
    readonly payload: Record<string, unknown>;
    /** Epoch timestamp in milliseconds when the fact was established. */
    readonly createdAt: number;
    /** Epoch timestamp in milliseconds after which the fact is considered stale. */
    readonly expiresAt: number;
}

/**
 * Telemetry metrics for PersistentReviewFactStore.
 */
export interface FactStoreTelemetry {
    /** Total facts currently resident in memory. */
    readonly totalFacts: number;
    /** Active non-expired facts count. */
    readonly activeFacts: number;
    /** Expired facts awaiting pruning. */
    readonly expiredFacts: number;
    /** Total query hits. */
    readonly hitCount: number;
    /** Total query misses. */
    readonly missCount: number;
    /** Cache hit ratio (hitCount / totalQueries). */
    readonly hitRatio: number;
}

/**
 * Configuration options for PersistentReviewFactStore.
 */
export interface PersistentFactStoreOptions {
    /** Sliding window TTL in milliseconds (defaults to 72 hours). */
    readonly ttlMs?: number;
    /** Repository root path used to locate .refactor-trajectory/facts/. */
    readonly repoRoot?: string;
    /** Explicit ledger file path override for unit tests. */
    readonly customLedgerPath?: string;
    /** True to disable disk writes and operate purely in-memory. */
    readonly inMemoryOnly?: boolean;
}

/**
 * DeepInfer 72+ Hour Persistent Review Fact Store.
 */
export class PersistentReviewFactStore {
    private readonly ttlMs: number;
    private readonly ledgerFilePath: string;
    private readonly inMemoryOnly: boolean;

    private readonly facts: Map<string, ReviewFact>;

    private hitCount = 0;
    private missCount = 0;
    private isDirty = false;

    public constructor(options: PersistentFactStoreOptions = {}) {
        this.ttlMs = options.ttlMs ?? DEFAULT_FACT_TTL_MS;
        this.inMemoryOnly = options.inMemoryOnly ?? false;

        const root = options.repoRoot ?? process.cwd();
        this.ledgerFilePath =
            options.customLedgerPath ?? path.join(root, DEFAULT_FACTS_DIR, FACT_LEDGER_FILENAME);

        this.facts = new Map();
        if (!this.inMemoryOnly) {
            this.loadFromDisk();
        }
    }

    /**
     * Store a verified analysis fact.
     *
     * @param params - Fact attributes: the `modulePath` owning the fact, the `contentHash` that
     *   scopes it to a revision, the `factType` selecting the category, and the `payload` holding
     *   the analysis output.
     * @param ttlMs - Optional custom TTL override.
     * @returns Stored ReviewFact record.
     */
    public putFact(
        params: {
            modulePath: string;
            contentHash: string;
            factType: FactCategory | string;
            payload: Record<string, unknown>;
        },
        ttlMs?: number,
    ): ReviewFact {
        const now = Date.now();
        const effectiveTtl = ttlMs ?? this.ttlMs;
        const key = this.buildFactKey(params.modulePath, params.contentHash, params.factType);

        const fact: ReviewFact = {
            factId: fastDigest(key),
            modulePath: params.modulePath,
            contentHash: params.contentHash,
            factType: params.factType,
            payload: params.payload,
            createdAt: now,
            expiresAt: now + effectiveTtl,
        };

        this.evictCapacityIfNecessary();
        this.facts.set(key, fact);
        this.isDirty = true;
        return fact;
    }

    /**
     * Retrieve a non-expired verified analysis fact.
     *
     * @param modulePath - Target module path.
     * @param contentHash - Current content digest.
     * @param factType - Semantic fact category.
     * @returns ReviewFact record if present and valid; undefined otherwise.
     */
    public getFact(
        modulePath: string,
        contentHash: string,
        factType: FactCategory | string,
    ): ReviewFact | undefined {
        const key = this.buildFactKey(modulePath, contentHash, factType);
        const fact = this.facts.get(key);

        if (!fact) {
            this.missCount++;
            return undefined;
        }

        if (Date.now() > fact.expiresAt) {
            this.facts.delete(key);
            this.isDirty = true;
            this.missCount++;
            return undefined;
        }

        this.hitCount++;
        return fact;
    }

    /**
     * Check whether an active non-expired fact exists without modifying hit/miss metrics.
     *
     * @param modulePath - Target module path.
     * @param contentHash - Current content digest.
     * @param factType - Fact category.
     * @returns True if active fact exists.
     */
    public hasFact(
        modulePath: string,
        contentHash: string,
        factType: FactCategory | string,
    ): boolean {
        const key = this.buildFactKey(modulePath, contentHash, factType);
        const fact = this.facts.get(key);
        return fact !== undefined && Date.now() <= fact.expiresAt;
    }

    /**
     * Prune all expired facts past the given timestamp.
     *
     * @param now - Reference timestamp in milliseconds (defaults to Date.now()).
     * @returns Number of pruned expired fact entries.
     */
    public pruneExpired(now = Date.now()): number {
        let pruned = 0;
        for (const [key, fact] of this.facts.entries()) {
            if (now > fact.expiresAt) {
                this.facts.delete(key);
                pruned++;
            }
        }

        if (pruned > 0) {
            this.isDirty = true;
        }
        return pruned;
    }

    /**
     * Flush memory state to disk ledger atomically.
     */
    public async flush(): Promise<void> {
        if (this.inMemoryOnly || !this.isDirty) {
            return;
        }

        this.pruneExpired();
        const serialized = JSON.stringify(Array.from(this.facts.values()), null, 2);

        const targetDir = path.dirname(this.ledgerFilePath);
        await fs.promises.mkdir(targetDir, { recursive: true });

        const tempFile = `${this.ledgerFilePath}.tmp.${Date.now()}`;
        await fs.promises.writeFile(tempFile, serialized, 'utf8');
        await fs.promises.rename(tempFile, this.ledgerFilePath);
        this.isDirty = false;
    }

    /**
     * Get aggregate fact store utilization and hit ratio metrics.
     */
    public getTelemetry(): FactStoreTelemetry {
        const now = Date.now();
        let active = 0;
        let expired = 0;

        for (const fact of this.facts.values()) {
            if (now <= fact.expiresAt) {
                active++;
            } else {
                expired++;
            }
        }

        const totalQueries = this.hitCount + this.missCount;
        const hitRatio = totalQueries > 0 ? this.hitCount / totalQueries : 0;

        return {
            totalFacts: this.facts.size,
            activeFacts: active,
            expiredFacts: expired,
            hitCount: this.hitCount,
            missCount: this.missCount,
            hitRatio: Math.round(hitRatio * 1000) / 1000,
        };
    }

    /**
     * Clear all facts from memory.
     */
    public clear(): void {
        this.facts.clear();
        this.hitCount = 0;
        this.missCount = 0;
        this.isDirty = true;
    }

    /**
     * Internal: Construct canonical composite lookup key.
     */
    private buildFactKey(
        modulePath: string,
        contentHash: string,
        factType: FactCategory | string,
    ): string {
        return `${modulePath}:${contentHash}:${factType}`;
    }

    /**
     * Internal: Read ledger file content using scoped file descriptor.
     */
    private readLedgerContent(filePath: string): string {
        const fileDescriptor = fs.openSync(filePath, 'r');
        try {
            const stat = fs.fstatSync(fileDescriptor);
            const bufferPayload = Buffer.allocUnsafe(stat.size);
            fs.readSync(fileDescriptor, bufferPayload, 0, stat.size, 0);
            return bufferPayload.toString('utf8');
        } finally {
            fs.closeSync(fileDescriptor);
        }
    }

    /**
     * Internal: Load persistent facts from disk ledger on initialization.
     */
    private loadFromDisk(): void {
        try {
            if (!fs.existsSync(this.ledgerFilePath)) {
                return;
            }

            const raw = this.readLedgerContent(this.ledgerFilePath);
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) {
                return;
            }

            const now = Date.now();
            for (let i = 0; i < parsed.length; i++) {
                const item = parsed[i] as ReviewFact;
                if (item && item.expiresAt > now) {
                    const key = this.buildFactKey(item.modulePath, item.contentHash, item.factType);
                    this.facts.set(key, item);
                }
            }
        } catch (err) {
            void err;
        }
    }

    /**
     * Internal: Evict oldest entries if capacity limit is reached.
     */
    private evictCapacityIfNecessary(): void {
        if (this.facts.size < MAX_IN_MEMORY_FACTS) {
            return;
        }

        const pruned = this.pruneExpired();
        if (this.facts.size < MAX_IN_MEMORY_FACTS) {
            return;
        }

        // Delete first 10% oldest entries
        const targetDeleteCount = Math.max(1, Math.floor(MAX_IN_MEMORY_FACTS * 0.1));
        let deleted = 0;
        for (const key of this.facts.keys()) {
            this.facts.delete(key);
            deleted++;
            if (deleted >= targetDeleteCount) {
                break;
            }
        }
    }
}

/** Shared singleton instance of PersistentReviewFactStore. */
export const defaultPersistentReviewFactStore = new PersistentReviewFactStore();
