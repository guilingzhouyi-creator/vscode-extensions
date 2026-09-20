/**
 * Module: Core Engine — Worker Pool Lifecycle & Memory Governance
 * File Path: src/core/worker-pool.ts
 * Architecture Role: Owns the daemon's per-configuration-fingerprint pools of
 *   worker_threads isolates; the bridge between Scanner dispatch and worker.js.
 * Dependencies & Triggers: Imports path, Worker (worker_threads), ScanConfig, and
 *   WorkerAnalyzerDesc; instantiated by the daemon scan handler and consumed through
 *   Scanner opts.pool — getOrCreate per scan, touch per dispatch, rssGuard per run.
 * Responsibilities: Spawn n workers with { config, analyzerDescs }; maintain LRU order
 *   and lastUsed timestamps; prune pools beyond maxPools=4; terminate workers in destroy;
 *   self-heal RSS at the 512MB/768MB thresholds; expose shutdown() and size().
 * Exit Semantics & Design Rationale: destroy() returns early on unknown fingerprints and
 *   prune() tolerates stale LRU entries, so pool lookups never throw; crossing 768MB logs
 *   to stderr, tears every pool down, then process.exit(0) so the --daemon client restarts
 *   the server. The 512MB sweep evicts non-warm pools and keeps at most the most-recent
 *   one, bounding daemon memory while preserving JIT-warm workers when possible.
 */

import * as path from 'path';
import { Worker } from 'worker_threads';
import type { ScanConfig } from './types';
import type { WorkerAnalyzerDesc } from './analyzer-registry';

/**
 * Maximum number of worker pools retained per manager; the least-recently-used pool is pruned
 * beyond this cap.
 */
const MAX_WORKER_POOLS = 4;

/**
 * RSS threshold in MiB above which the daemon exits gracefully so the client can restart it.
 */
const RSS_HARD_LIMIT_MB = 768;

/**
 * RSS threshold in MiB above which idle worker pools are swept to bound daemon memory.
 */
const RSS_SOFT_LIMIT_MB = 512;

/**
 * Bytes in one mebibyte (1024 × 1024), used to convert the MiB thresholds above and to format
 * the current RSS in MB for the exit log line.
 */
const BYTES_PER_MIB = 1048576;

/**
 * Worker pool entry representing a pool of dedicated worker threads for one
 * configuration fingerprint.
 */
export interface WorkerPoolEntry {
    fp: string;
    workers: any[];
    workerIdx: Map<any, number>;
    n: number;
    lastUsed: number;
    warm: boolean;
}

/**
 * Worker pool manager responsible for lifecycle, LRU eviction, and RSS memory self-healing.
 */
export class WorkerPoolManager {
    private pools = new Map<string, WorkerPoolEntry>();
    private order: string[] = [];
    readonly maxPools = MAX_WORKER_POOLS;
    private readonly workerPath = path.join(__dirname, 'worker.js');

    /** Get (or lazily spawn) the pool for a configuration fingerprint. */
    getOrCreate(
        fp: string,
        config: ScanConfig,
        descs: WorkerAnalyzerDesc[],
        n: number,
    ): WorkerPoolEntry {
        let e = this.pools.get(fp);
        if (!e) {
            const workers: any[] = [];
            const workerIdx = new Map<any, number>();
            for (let k = 0; k < n; k++) {
                const w = new Worker(this.workerPath, {
                    workerData: { config, analyzerDescs: descs },
                });
                workers.push(w);
                workerIdx.set(w, k);
            }
            e = { fp, workers, workerIdx, n, lastUsed: Date.now(), warm: false };
            this.pools.set(fp, e);
            this.order.push(fp);
            this.prune();
        }
        return e;
    }

    /** Mark a pool as most-recently-used (LRU order). */
    touch(fp: string): void {
        const i = this.order.indexOf(fp);
        if (i >= 0) this.order.splice(i, 1);
        this.order.push(fp);
        const e = this.pools.get(fp);
        if (e) e.lastUsed = Date.now();
    }

    /** LRU prune: terminate least-recently-used pools beyond maxPools. */
    prune(): void {
        while (this.order.length > this.maxPools) {
            const victim = this.order.shift();
            if (!victim) break;
            this.destroy(victim);
        }
    }

    /** Terminate + drop a pool (broken workers, LRU eviction, RSS guard). */
    destroy(fp: string): void {
        const e = this.pools.get(fp);
        if (!e) return;
        for (const w of e.workers) {
            try {
                w.terminate();
            } catch (_termErr) {
                /* ignore */
            }
        }
        this.pools.delete(fp);
        const i = this.order.indexOf(fp);
        if (i >= 0) this.order.splice(i, 1);
    }

    /**
     * RSS self-heal (docs/01-architecture/02-pipeline-and-caching.md §A3.4): >512MB
     * → drop idle (non-warm) pools and keep at most the most-recent pool; >768MB →
     * log + graceful exit (the client's next connect auto-restarts it under --daemon).
     */
    rssGuard(): void {
        const rss = process.memoryUsage().rss;
        if (rss > RSS_HARD_LIMIT_MB * BYTES_PER_MIB) {
            try {
                process.stderr.write(
                    `[auto-refactor daemon] RSS ${(rss / BYTES_PER_MIB).toFixed(0)}MB > 768MB — graceful exit (client will restart)\n`,
                );
            } catch (_ioErr) {
                /* ignore */
            }
            this.shutdown();
            setImmediate(() => process.exit(0));
            return;
        }
        if (rss > RSS_SOFT_LIMIT_MB * BYTES_PER_MIB) {
            for (const fp of [...this.order]) {
                const e = this.pools.get(fp);
                if (e && !e.warm) this.destroy(fp);
            }
            while (this.pools.size > 1) {
                const victim = this.order[0];
                if (!victim) break;
                this.destroy(victim);
            }
        }
    }

    shutdown(): void {
        for (const fp of [...this.pools.keys()]) this.destroy(fp);
    }

    size(): number {
        return this.pools.size;
    }
}
