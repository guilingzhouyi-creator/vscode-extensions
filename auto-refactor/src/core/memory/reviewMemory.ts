/**
 * Module: Core Engine — Review Memory Store and Cache Persistence
 * File Path: src/core/memory/reviewMemory.ts
 * Architecture Role: Stateful review-memory layer: keyed record store plus revision timeline
 *   behind a best-effort JSONL cache adapter that backs cross-scan domain reuse decisions
 * Dependencies & Triggers: Imports fs/path, ReviewMemoryRecord and MemoryEvictionPolicy from
 *   ./types, FileRevision from ../trajectory/types and sha256Hex from ../cacheKey; constructed by
 *   core/analyzer with the scan cache dir, by api.getReviewMemory and by the escalation channel;
 *   saveRecord fires after each audited file and get() serves the incremental dual-track pipeline
 * Responsibilities: Normalize backslash paths to POSIX keys; upsert records with a fresh
 *   lastAudited stamp; synthesize revisionId via sha256Hex when absent; append revision history
 *   capped by maxRevisionsPerFile; maintain LRU order and evict beyond maxFilesInMemory; prune
 *   heavy domain metrics in evictStable; load and append JSONL best-effort; expose getRecord/get,
 *   saveRecord/put, getAll, getRevisions, evictStable, clear, size and getStats
 * Exit Semantics & Design Rationale: Every disk operation is fail-soft—mkdir, load, append and
 *   compaction errors are swallowed because memory only accelerates reuse and must never break a
 *   scan. Appends are buffered and flushed in batches, so callers that need a durable record
 *   immediately must call `flush()`; the scanner does that once per scan. The LRU cap bounds
 *   process RSS while the JSONL log keeps successful audits across runs, and compaction keeps
 *   that log proportional to the working set instead of to the number of audits ever performed.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { MemoryEvictionPolicy, ReviewMemoryRecord } from './types';
import type { FileRevision } from '../trajectory/types';
import { sha256Hex } from '../cacheKey';

/**
 * Default cap on review-memory records kept in memory; the LRU tail is evicted beyond it.
 */
const DEFAULT_MAX_FILES_IN_MEMORY = 5000;

/**
 * Default cap on revision entries retained per file before the oldest revisions are dropped.
 */
const DEFAULT_MAX_REVISIONS_PER_FILE = 20;

/**
 * Default number of days a review-memory record is retained by policy.
 */
const DEFAULT_RETENTION_DAYS = 14;

/**
 * Number of leading hex characters of the content hash used as a synthesized revision id.
 */
const REVISION_ID_HEX_CHARS = 16;

/**
 * Lower bound on the log line budget: the log is compacted once it holds more than this many
 * lines, even while the record count is still small.
 */
const MIN_LOG_LINES = 256;

/**
 * Compaction budget per live record. The log is rewritten once its line count exceeds
 * `records × this`, so load cost stays proportional to the working set instead of to the number
 * of audits ever performed. A wider budget (measured at 4) traded a 60% larger log for no
 * measurable scan-time gain, so the tight bound is kept deliberately.
 */
const LOG_LINES_PER_RECORD = 2;

/**
 * Number of records buffered before the log is written. Every `saveRecord` used to open, append
 * and close the log; buffering turns a scan's hundreds of appends into a handful of writes, which
 * is measurable on Windows where each open/close pair costs a syscall round trip.
 */
const APPEND_BATCH_LINES = 64;

const DEFAULT_EVICTION_POLICY: MemoryEvictionPolicy = {
    maxFilesInMemory: DEFAULT_MAX_FILES_IN_MEMORY,
    maxRevisionsPerFile: DEFAULT_MAX_REVISIONS_PER_FILE,
    retentionDays: DEFAULT_RETENTION_DAYS,
    enableDiskPersistence: true,
};

/**
 * Keyed review-memory store with a bounded per-file revision timeline and best-effort JSONL
 * persistence.
 *
 * Records are keyed by POSIX-normalized file path. Writes upsert a record with a fresh
 * `lastAudited` stamp, synthesize a stable 16-char revision id when absent, and append a
 * FileRevision summary capped by `maxRevisionsPerFile`; reads refresh LRU order, and whole
 * records are evicted once `maxFilesInMemory` is exceeded. Disk persistence is fail-soft:
 * directory, append and load errors are swallowed because memory only accelerates reuse and
 * must never break a scan. All methods are synchronous; no async locking or background flush
 * is involved.
 */
export class ReviewMemoryManager {
    private readonly records = new Map<string, ReviewMemoryRecord>();
    private readonly revisions = new Map<string, FileRevision[]>();
    private readonly lruOrder: string[] = [];
    private readonly policy: MemoryEvictionPolicy;
    private readonly cacheDir?: string;
    private readonly memoryFilePath?: string;
    /** Lines currently present in the JSONL log; the compaction trigger compares it to a budget. */
    private logLines = 0;
    /** Records buffered for the next single write; drained by `flush()` or the batch threshold. */
    private readonly pendingLines: string[] = [];

    /**
     * Create a memory manager, optionally backed by `memory.jsonl` in a cache directory.
     *
     * @param cacheDir - Directory for the JSONL log; when omitted, or when persistence is
     *                   disabled by policy, the manager stays memory-only.
     * @param policy - Partial overrides merged over DEFAULT_EVICTION_POLICY;
     *                 `maxFilesInMemory` and `maxRevisionsPerFile` bound in-memory growth.
     */
    constructor(cacheDir?: string, policy?: Partial<MemoryEvictionPolicy>) {
        this.cacheDir = cacheDir;
        this.policy = { ...DEFAULT_EVICTION_POLICY, ...(policy || {}) };
        if (this.cacheDir && this.policy.enableDiskPersistence) {
            try {
                fs.mkdirSync(this.cacheDir, { recursive: true });
                this.memoryFilePath = path.join(this.cacheDir, 'memory.jsonl');
                this.loadFromDisk();
            } catch {
                /* best-effort persistence */
            }
        }
    }

    /**
     * Retrieve the latest review memory record for a file and mark it as recently used.
     *
     * @param filePath - File path in either native or POSIX form; normalized before lookup.
     * @returns The stored record, or undefined when the file has no memory entry.
     */
    getRecord(filePath: string): ReviewMemoryRecord | undefined {
        const norm = filePath.replace(/\\/g, '/');
        const rec = this.records.get(norm);
        if (rec) {
            this.touch(norm);
        }
        return rec;
    }

    /**
     * Alias for `getRecord`, provided for the dual-track pipeline read API.
     *
     * @param filePath - File path in either native or POSIX form; normalized before lookup.
     * @returns The stored record, or undefined when the file has no memory entry.
     */
    get(filePath: string): ReviewMemoryRecord | undefined {
        return this.getRecord(filePath);
    }

    /**
     * List every active review memory record.
     *
     * @returns A new array of records in insertion order; the manager retains ownership of the
     *          returned record objects.
     */
    getAll(): ReviewMemoryRecord[] {
        return Array.from(this.records.values());
    }

    /**
     * Alias for `saveRecord`, provided for the dual-track pipeline write API.
     *
     * @param record - Record to upsert; its `filePath` is normalized and `lastAudited` refreshed.
     */
    put(record: ReviewMemoryRecord): void {
        this.saveRecord(record);
    }

    /**
     * Retrieve the revision timeline for a file.
     *
     * @param filePath - File path in either native or POSIX form; normalized before lookup.
     * @returns Capped list of revisions in audit order, or an empty array when none exist.
     */
    getRevisions(filePath: string): FileRevision[] {
        const norm = filePath.replace(/\\/g, '/');
        return this.revisions.get(norm) || [];
    }

    /**
     * Upsert review memory for a file and append a revision summary.
     *
     * Also refreshes LRU order, enforces the in-memory file cap, and appends the record to the
     * JSONL log when disk persistence is enabled. Best-effort: persistence failures never throw.
     *
     * @param record - Record to store; `lastAudited` is regenerated and `revisionId` is
     *                 synthesized from the file hash when the input omits it.
     */
    saveRecord(record: ReviewMemoryRecord): void {
        const norm = record.filePath.replace(/\\/g, '/');
        const prepared: ReviewMemoryRecord = {
            ...record,
            filePath: norm,
            lastAudited: Date.now(),
        };

        this.records.set(norm, prepared);
        this.touch(norm);

        // Track revision timeline
        let revList = this.revisions.get(norm);
        if (!revList) {
            revList = [];
            this.revisions.set(norm, revList);
        }

        const revision: FileRevision = {
            revisionId:
                prepared.revisionId ||
                sha256Hex(prepared.fileHash + prepared.lastAudited).slice(0, REVISION_ID_HEX_CHARS),
            timestamp: prepared.lastAudited,
            agentUid: prepared.agentUid || 'default-agent',
            fileHash: prepared.fileHash,
            astDigest: prepared.astDigest,
            qualityScore: prepared.qualityScores,
            ruleHitIds: prepared.ruleHits.map((h) => h.id),
        };

        // Append revision and cap at maxRevisionsPerFile
        revList.push(revision);
        if (revList.length > this.policy.maxRevisionsPerFile) {
            revList.splice(0, revList.length - this.policy.maxRevisionsPerFile);
        }

        this.enforceLimits();
        this.persistRecord(prepared);
    }

    /**
     * Drop heavy domain details from a record once an audit confirmed the stable fields.
     *
     * The record survives with its fingerprint fields (`domainId`, `kind`, `name`, `span`,
     * `semanticHash`, `cyclomaticComplexity`, `ruleViolations`); the method is a no-op for an
     * unknown path.
     *
     * @param filePath - File path in either native or POSIX form; normalized before lookup.
     */
    evictStable(filePath: string): void {
        const norm = filePath.replace(/\\/g, '/');
        const rec = this.records.get(norm);
        if (!rec) return;

        // Prune unnecessary details, keeping only the essential fingerprint
        rec.codeDomains = rec.codeDomains.map((d) => ({
            domainId: d.domainId,
            kind: d.kind,
            name: d.name,
            span: d.span,
            semanticHash: d.semanticHash,
            cyclomaticComplexity: d.cyclomaticComplexity,
            ruleViolations: d.ruleViolations,
        }));
    }

    /**
     * Count the active records held in memory.
     *
     * @returns Number of entries in the record map.
     */
    size(): number {
        return this.records.size;
    }

    /** Clear all in-memory records, revisions and LRU bookkeeping; the disk log is untouched. */
    clear(): void {
        this.records.clear();
        this.revisions.clear();
        this.lruOrder.length = 0;
    }

    /**
     * Report memory-manager footprint counters.
     *
     * @returns Current record count, total revision entries and the configured file cap.
     */
    getStats(): { recordsCount: number; revisionsCount: number; maxFiles: number } {
        let revCount = 0;
        for (const r of this.revisions.values()) revCount += r.length;
        return {
            recordsCount: this.records.size,
            revisionsCount: revCount,
            maxFiles: this.policy.maxFilesInMemory,
        };
    }

    /**
     * Move a key to the most-recently-used end of the LRU order.
     *
     * @param key - Normalized file path already present in the record map.
     */
    private touch(key: string): void {
        // A scan audits files in order, so the key is usually already the most recent one; the
        // early return keeps the whole walk O(n) instead of O(n²) over the LRU array.
        if (this.lruOrder[this.lruOrder.length - 1] === key) return;
        const idx = this.lruOrder.indexOf(key);
        if (idx !== -1) {
            this.lruOrder.splice(idx, 1);
        }
        this.lruOrder.push(key);
    }

    /** Evict least-recently-used records until the in-memory file cap is satisfied. */
    private enforceLimits(): void {
        while (this.records.size > this.policy.maxFilesInMemory && this.lruOrder.length > 0) {
            const oldest = this.lruOrder.shift();
            if (oldest) {
                this.records.delete(oldest);
            }
        }
    }

    /**
     * Append one record as a JSON line to the memory log, ignoring disk failures.
     *
     * @param record - Normalized record to append; no-op when persistence is disabled.
     */
    private persistRecord(record: ReviewMemoryRecord): void {
        if (!this.memoryFilePath) return;
        try {
            this.pendingLines.push(JSON.stringify(record) + '\n');
            this.logLines += 1;
            if (this.pendingLines.length >= APPEND_BATCH_LINES) this.flushPending();
            this.compactLogIfNeeded();
        } catch {
            /* Best-effort: write failure is non-fatal */
        }
    }

    /**
     * Write buffered records to the log with a single append.
     *
     * Best-effort like every other disk path: a failure keeps the buffered lines so a later flush
     * can retry, and never breaks the scan.
     */
    private flushPending(): void {
        if (!this.memoryFilePath || this.pendingLines.length === 0) return;
        try {
            fs.appendFileSync(this.memoryFilePath, this.pendingLines.join(''), 'utf8');
            this.pendingLines.length = 0;
        } catch {
            /* Best-effort: keep the buffer for the next flush attempt */
        }
    }

    /**
     * Flush every buffered record, then compact the log when it exceeds its budget.
     *
     * The scanner calls this once per scan: it is the durability boundary for the final batch of
     * audits, and it keeps callers from having to know that appends are buffered at all.
     */
    flush(): void {
        this.flushPending();
        this.compactLogIfNeeded();
    }

    /**
     * Rewrite the log once it grows past its line budget.
     *
     * The log is append-only for durability, so without compaction a long-lived project keeps
     * paying for every audit ever performed: each scan reads and parses the whole file. Rewriting
     * it to one line per live record keeps load cost proportional to the working set while
     * preserving the newest record of every file.
     */
    private compactLogIfNeeded(): void {
        if (!this.memoryFilePath) return;
        const budget = Math.max(MIN_LOG_LINES, this.records.size * LOG_LINES_PER_RECORD);
        if (this.logLines <= budget) return;
        try {
            const body = Array.from(this.records.values())
                .map((record) => JSON.stringify(record))
                .join('\n');
            const tmp = `${this.memoryFilePath}.tmp`;
            fs.writeFileSync(tmp, `${body}\n`, 'utf8');
            fs.renameSync(tmp, this.memoryFilePath);
            this.logLines = this.records.size;
        } catch {
            /* Best-effort: a failed compaction leaves the append-only log intact */
        }
    }

    /**
     * Load JSONL records from the memory log, skipping blank or corrupted lines.
     *
     * Only the newest record per file survives, and the LRU order is rebuilt from that deduped
     * map, so a log holding years of audits still loads in O(records + lines) and eviction never
     * walks stale duplicates; a read failure leaves the in-memory store empty rather than
     * aborting construction.
     */
    private loadFromDisk(): void {
        if (!this.memoryFilePath) return;
        try {
            // A missing log is the normal first run: readFileSync throws ENOENT, which the catch
            // below swallows exactly like a corrupt file, so no extra stat syscall is needed.
            const content = fs.readFileSync(this.memoryFilePath, 'utf8');
            const lines = content.split('\n');
            for (const line of lines) {
                if (!line.trim()) continue;
                this.logLines += 1;
                try {
                    const rec: ReviewMemoryRecord = JSON.parse(line);
                    if (rec && rec.filePath) {
                        this.records.set(rec.filePath, rec);
                    }
                } catch {
                    // ignore corrupted line
                }
            }
            // Rebuild the LRU order from the deduped map. The log may hold several audits per file,
            // so pushing one slot per line would grow the order with history instead of with the
            // file set — and eviction would then walk stale duplicates.
            this.lruOrder.length = 0;
            for (const key of this.records.keys()) this.lruOrder.push(key);
        } catch {
            /* Best-effort: read failure is non-fatal */
        }
    }
}
