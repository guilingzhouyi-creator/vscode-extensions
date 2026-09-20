/**
 * Module: Core Engine — Per-File Incremental State (ts-free)
 * File Path: src/core/incremental-state.ts
 * Architecture Role: Daemon-memory-only state holder for one file; single source of the reuse
 *                    contract behind the line-level incremental path.
 * Dependencies & Triggers: Imports NormalizedNode/ReusedSpan/NodeKind from ./multilang; driven by
 *                    analyzer.ts prepare() -> reuse/cache -> finalize() cycles, by LRU pruning when
 *                    a fingerprint bucket grows, and by an RSS guard polled from
 *                    process.memoryUsage(); env override AR_INCREMENTAL_MAX_FILES.
 * Responsibilities: Provide makeFnKey and the CachedSubtree/LiteralRecord shapes; hold the
 *                    previous scan's content plus reusable subtrees (INC-Mode-1 reuse unit),
 *                    complexityMemo (per-function cyclomatic complexity keyed by line:column)
 *                    and literalRecords (the constants-analyzer seed); swap caches in
 *                    prepare()/finalize() so deleted or renamed functions are evicted;
 *                    reuseSubtree() requires identical start line+column and byte-identical
 *                    source text; cacheSubtree(), markReused(), isReusedFunction() and
 *                    isReusedLiteral() feed analyzer memos; get/setComplexity and
 *                    get/setLiteralRecords carry values across scans; evict(),
 *                    touchIncremental(), pruneIncrementalBucket() and incrementalRssGuard()
 *                    bound memory.
 * Exit Semantics & Design Rationale: State is never persisted and eviction is loss-free for
 *                    output: an evicted file simply loses its caches and falls back to a full
 *                    rescan (slower but byte-identical). The default 32-file LRU and 512 MiB
 *                    RSS soft cap keep daemon memory bounded. This module NEVER imports
 *                    `typescript`.
 */

import type { NormalizedNode, ReusedSpan } from './multilang';
import { NodeKind } from './multilang';

/**
 * Pack a 1-based (line, column) position into one numeric memo key, avoiding the 16-bit
 * truncation of a `line << 16 | column` bit pack. The packing is collision-free while
 * `col < 1000000`; callers needing wider virtual columns use the string `"line:column"` key.
 *
 * @param line - 1-based start line of the function subtree.
 * @param col - 1-based start column of the function subtree.
 * @returns Deterministic integer key for Map lookups; allocates nothing on the hot path.
 */
export function makeFnKey(line: number, col: number): number {
    return line * FN_KEY_COLUMN_STRIDE + col;
}

/** A cached function subtree (Mode B's materialized normalized children). */
export interface CachedSubtree {
    /** Stable identity within a scan — a `"line:column"` string such as `"12:5"`, or numeric. */
    fnKey: number | string;
    startLine: number;
    startColumn: number;
    startByte: number;
    endByte: number;
    /** 1-based end line of the function (informational; derived from line starts). */
    endLine: number;
    sourceText: string;
    /** The fully-materialized normalized children of the function subtree. */
    children: NormalizedNode[];
    valid: boolean;
}

/** A literal observation collected by the constants analyzer (reused for recomposition). */
export interface LiteralRecord {
    value: string;
    numeric: boolean;
    node: NormalizedNode;
    parent?: NormalizedNode;
    isConstBound: boolean;
    tolerated: boolean;
    line: number;
}

function computeLineStarts(content: string): number[] {
    const starts: number[] = [0];
    for (let i = 0; i < content.length; i++) {
        if (content.charCodeAt(i) === CHAR_CODE_LF) starts.push(i + 1);
    }
    return starts;
}

/** 1-based line containing `byte` (binary search over line starts). */
function lineOfByte(lineStarts: number[], byte: number): number {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (lineStarts[mid] <= byte) lo = mid;
        else hi = mid - 1;
    }
    return lo + 1;
}

/**
 * Column stride for the packed (line, column) function key; collision-free while
 * `col < 1,000,000`.
 */
const FN_KEY_COLUMN_STRIDE = 1000000;
/** Character code of '\n' (line feed) recognized by the line-start scanner. */
const CHAR_CODE_LF = 10;
/** Decimal radix for parsing the AR_INCREMENTAL_MAX_FILES override. */
const DECIMAL_RADIX = 10;
/** Number of bytes in one kibibyte (2^10); unit base for the RSS soft cap. */
const BYTES_PER_KIB = 1024;
/** Number of kibibytes in one mebibyte (2^10); unit step for the RSS soft cap. */
const KIB_PER_MIB = 1024;
/** RSS soft cap expressed in mebibytes (512 MiB) before incremental buckets are cleared. */
const INCREMENTAL_RSS_CLEAR_MIB = 512;

/** Default max per-fingerprint incremental-state files before LRU eviction (T02b). */
const INCREMENTAL_MAX_FILES_DEFAULT = 32;

/** RSS soft threshold (bytes) above which all incremental buckets are cleared. */
const INCREMENTAL_RSS_CLEAR_BYTES = INCREMENTAL_RSS_CLEAR_MIB * BYTES_PER_KIB * KIB_PER_MIB;

/**
 * Resolve the per-fingerprint LRU bound from `AR_INCREMENTAL_MAX_FILES`.
 *
 * @returns Parsed positive integer override, or the 32-file default when the variable is
 *   unset, non-numeric, zero, or negative.
 */
export function incrementalMaxFiles(): number {
    const v = parseInt(process.env.AR_INCREMENTAL_MAX_FILES || '', DECIMAL_RADIX);
    return Number.isInteger(v) && v > 0 ? v : INCREMENTAL_MAX_FILES_DEFAULT;
}

/**
 * Per-file incremental state held in daemon memory for one project file: the last-scanned
 * content plus reusable subtrees, the per-function complexity memo, and literal records.
 *
 * Lifecycle contract: prepare() swaps in the new content while retaining the previous maps for
 * reuse lookups; reuseSubtree() and cacheSubtree() refill the new generation, while markReused()
 * flags reused identities for analyzer memos; finalize() drops the previous generation so
 * deleted or renamed functions are evicted. The state is never persisted, so losing it costs
 * only a full rescan, never a different analysis result.
 */
export class IncrementalFileState {
    content: string;
    contentHash: string;
    lineStarts: number[];
    subtrees: Map<number | string, CachedSubtree>;
    /** Current scan's per-function cyclomatic-complexity memo (for the NEXT scan's reuse). */
    complexityMemo: Map<number | string, number>;
    /** Current scan's full literal record list (for the NEXT scan's reuse). */
    literalRecords: LiteralRecord[];
    /** Number of function subtrees reused during the most recent incremental pass. */
    reuseHits = 0;
    private prevSubtrees: Map<number | string, CachedSubtree> | null = null;
    private prevComplexityMemo: Map<number | string, number> | null = null;
    private prevLiteralRecords: LiteralRecord[] = [];
    /** Function nodes whose subtree was reused THIS pass (memo signal for analyzers). */
    private reusedFnNodes = new Set<NormalizedNode>();
    /** Literal nodes inside reused subtrees THIS pass (constants skip signal). */
    private reusedLiteralNodes = new Set<NormalizedNode>();

    /**
     * Create empty state bound to one file revision. Caches start empty and are filled by a
     * prepare()/reuse cycle; the constructor itself performs no I/O.
     *
     * @param content - File text this state initially represents.
     * @param contentHash - Caller-computed hash used for cheap equality checks and L2 cache keys.
     */
    constructor(content: string, contentHash: string) {
        this.content = content;
        this.contentHash = contentHash;
        this.lineStarts = computeLineStarts(content);
        this.subtrees = new Map();
        this.complexityMemo = new Map();
        this.literalRecords = [];
    }

    /**
     * Begin an incremental pass over `newContent`: keep the old subtree/memo maps for reuse
     * lookups and start fresh ones that will hold this scan's (reused + rebuilt) results.
     */
    prepare(newContent: string, newHash: string): void {
        this.content = newContent;
        this.contentHash = newHash;
        this.lineStarts = computeLineStarts(newContent);
        this.prevSubtrees = this.subtrees;
        this.subtrees = new Map();
        this.prevComplexityMemo = this.complexityMemo;
        this.complexityMemo = new Map();
        this.prevLiteralRecords = this.literalRecords;
        this.literalRecords = [];
        this.reusedFnNodes = new Set();
        this.reusedLiteralNodes = new Set();
        this.reuseHits = 0;
    }

    /**
     * INC-Mode-1 lookup: a subtree is reusable iff its START LINE and START COLUMN are
     * unchanged (its own line interval is untouched) AND its source text is byte-identical.
     * Line+column stability keeps every embedded line/column position stable even when a
     * SAME-LINE edit elsewhere shifted the function's absolute byte offset. Returns the
     * cached normalized children (or null to rebuild).
     */
    reuseSubtree(span: ReusedSpan): NormalizedNode[] | null {
        const prev = this.prevSubtrees;
        if (!prev) return null;
        const key = makeFnKey(span.startLine, span.startColumn);
        const cached = prev.get(key) || prev.get(`${span.startLine}:${span.startColumn}`);
        if (
            cached &&
            cached.endByte - cached.startByte === span.endByte - span.startByte &&
            cached.sourceText === span.sourceText
        ) {
            this.reuseHits++;
            return cached.children;
        }
        return null;
    }

    /** Record a (reused or freshly-built) function subtree into the next scan's map. */
    cacheSubtree(span: ReusedSpan, children: NormalizedNode[]): void {
        const key = makeFnKey(span.startLine, span.startColumn);
        const existing = this.subtrees.get(key);
        if (
            existing &&
            existing.endByte - existing.startByte === span.endByte - span.startByte &&
            existing.sourceText === span.sourceText
        ) {
            existing.children = children;
            existing.valid = true;
            return;
        }
        this.subtrees.set(key, {
            fnKey: key,
            startLine: span.startLine,
            startColumn: span.startColumn,
            startByte: span.startByte,
            endByte: span.endByte,
            endLine: lineOfByte(this.lineStarts, Math.max(span.startByte, span.endByte - 1)),
            sourceText: span.sourceText,
            children,
            valid: true,
        });
    }

    /**
     * Analyzer-memo seed (called by the adapters right after `reuseSubtree` hits): record
     * that `node` is a function whose subtree was reused this pass, and collect the literal
     * nodes inside that reused subtree so the constants analyzer can skip re-collecting them
     * (they are byte-identical — same object identity as the previous scan).
     */
    markReused(node: NormalizedNode, _span: ReusedSpan): void {
        this.reusedFnNodes.add(node);
        const stack: NormalizedNode[] = [...(node.children || [])];
        while (stack.length > 0) {
            const cur = stack.pop();
            if (!cur) continue;
            if (cur.kind === NodeKind.NumericLiteral || cur.kind === NodeKind.StringLiteral) {
                this.reusedLiteralNodes.add(cur);
            }
            const kids = cur.children;
            if (kids) for (const c of kids) stack.push(c);
        }
    }

    /** True when `node` is a function whose subtree was reused THIS pass. */
    isReusedFunction(node: NormalizedNode): boolean {
        return this.reusedFnNodes.has(node);
    }

    /** True when `node` is a literal inside a reused subtree THIS pass. */
    isReusedLiteral(node: NormalizedNode): boolean {
        return this.reusedLiteralNodes.has(node);
    }

    /** Read a cc memo value written by the PREVIOUS scan (reused subtrees only). */
    getComplexity(fnKey: string | number): number | undefined {
        return this.prevComplexityMemo ? this.prevComplexityMemo.get(fnKey) : undefined;
    }

    /** Record this scan's cc value (fresh or reused) for the next scan's reuse. */
    setComplexity(fnKey: string | number, cc: number): void {
        this.complexityMemo.set(fnKey, cc);
    }

    /** Previous scan's full literal records (seeds recomposition of reused subtrees). */
    getPrevLiteralRecords(): LiteralRecord[] {
        return this.prevLiteralRecords;
    }

    /** Store this scan's full literal list for the next scan's reuse. */
    setLiteralRecords(records: LiteralRecord[]): void {
        this.literalRecords = records;
    }

    /** End the incremental pass: free the old subtree/memo maps (deleted functions evicted). */
    finalize(): void {
        this.prevSubtrees = null;
        this.prevComplexityMemo = null;
        this.prevLiteralRecords = [];
        // Reused-identity sets are only meaningful between prepare() and finalize().
        this.reusedFnNodes = new Set();
        this.reusedLiteralNodes = new Set();
    }

    /** Drop all cached state (LRU eviction / RSS guard). Content is kept for next diff. */
    evict(): void {
        this.prevSubtrees = null;
        this.subtrees.clear();
        this.prevComplexityMemo = null;
        this.complexityMemo.clear();
        this.prevLiteralRecords = [];
        this.literalRecords = [];
        this.reusedFnNodes = new Set();
        this.reusedLiteralNodes = new Set();
    }

    /**
     * Current cache size, expressed as the number of function subtrees retained for the next
     * scan; useful for tests and memory diagnostics.
     *
     * @returns Number of entries in the subtree map after the latest cache/reuse cycle.
     */
    subtreeCount(): number {
        return this.subtrees.size;
    }
}

// ---------------------------------------------------------------------------
// Boundedness helpers (T02b): LRU eviction + RSS guard for daemon memory control.
// These NEVER change analysis output — an evicted file simply loses its subtree/memo caches
// and falls back to a full rescan next time it changes (byte-identical, just slower).
// ---------------------------------------------------------------------------

/**
 * Move `rel` to the most-recently-used end of `bucket`, making it the last candidate for LRU
 * eviction. Entries absent from the bucket are ignored, so touching a stale key is safe.
 *
 * @param bucket - Per-fingerprint map from relative file path to its incremental state.
 * @param rel - Repo-relative file path to mark as most recently used.
 */
export function touchIncremental(bucket: Map<string, IncrementalFileState>, rel: string): void {
    const st = bucket.get(rel);
    if (!st) return;
    bucket.delete(rel);
    bucket.set(rel, st);
}

/**
 * Evict least-recently-used entries from `bucket` until at most `maxFiles` remain. Each removed
 * state has its caches cleared via {@link IncrementalFileState.evict}; eviction is loss-free for
 * output and only increases the work of the next change to those files.
 *
 * @param bucket - Per-fingerprint LRU-ordered map of incremental states.
 * @param maxFiles - Retention bound; defaults to the env-aware incrementalMaxFiles() value.
 * @returns Number of entries evicted (0 when the bucket is already within the bound).
 */
export function pruneIncrementalBucket(
    bucket: Map<string, IncrementalFileState>,
    maxFiles: number = incrementalMaxFiles(),
): number {
    let evicted = 0;
    while (bucket.size > maxFiles) {
        const oldest = bucket.keys().next().value as string | undefined;
        if (oldest === undefined) break;
        const st = bucket.get(oldest);
        if (st) st.evict();
        bucket.delete(oldest);
        evicted++;
    }
    return evicted;
}

/**
 * Drop every incremental bucket once process RSS exceeds the 512 MiB soft cap, bounding daemon
 * memory on long-lived warm sessions. Below the cap nothing is touched, so steady-state scans
 * keep their reuse caches; this is a loss-free cache reset, not a hard memory limit.
 *
 * @param session - Scan-session object whose `incremental` map is drained under memory pressure.
 * @param session.incremental - Fingerprint-keyed buckets holding per-file incremental states.
 * @returns Total number of per-file states evicted; 0 when RSS is within the soft cap.
 */
export function incrementalRssGuard(session: {
    incremental: Map<string, Map<string, IncrementalFileState>>;
}): number {
    if (process.memoryUsage().rss <= INCREMENTAL_RSS_CLEAR_BYTES) return 0;
    let evicted = 0;
    for (const bucket of session.incremental.values()) {
        for (const st of bucket.values()) st.evict();
        evicted += bucket.size;
        bucket.clear();
    }
    return evicted;
}
