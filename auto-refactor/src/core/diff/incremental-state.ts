/**
 * Module: Core Engine — Per-File Incremental State (ts-free)
 * File Path: src/core/diff/incremental-state.ts
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

import type { NormalizedNode, ReusedSpan } from '../ast/multilang';
import { NodeKind } from '../ast/multilang';

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
function getLineOfByte(lineStarts: number[], byteOffset: number): number {
    let lowerIndex = 0;
    let upperIndex = lineStarts.length - 1;
    while (lowerIndex < upperIndex) {
        const middleIndex = (lowerIndex + upperIndex + 1) >> 1;
        if (lineStarts[middleIndex] <= byteOffset) lowerIndex = middleIndex;
        else upperIndex = middleIndex - 1;
    }
    return lowerIndex + 1;
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
const RSS_LIMIT_CLEAR_MIB = 512;
const RSS_TIER1_MIB = 350;
const RSS_TIER2_MIB = 450;
const COLD_DAYS = 7;
const HOURS_PER_DAY = 24;
const MINUTES_PER_HOUR = 60;
const SECONDS_PER_MINUTE = 60;
const MS_PER_SECOND = 1000;

/** Default max per-fingerprint incremental-state files before LRU eviction (T02b). */
const INCREMENTAL_MAX_FILES_DEFAULT = 32;

/**
 * Tiered RSS thresholds and soft limits grouped to prevent flat prefix clusters.
 */
const RSS_BOUNDS = Object.freeze({
    clearBytes: RSS_LIMIT_CLEAR_MIB * BYTES_PER_KIB * KIB_PER_MIB,
    tier1Bytes: RSS_TIER1_MIB * BYTES_PER_KIB * KIB_PER_MIB,
    tier2Bytes: RSS_TIER2_MIB * BYTES_PER_KIB * KIB_PER_MIB,
});

/** File size threshold (in lines) for "large file" eviction in tier 1. */
const LARGE_FILE_LINE_THRESHOLD = 1000;

/** Age threshold (ms) for "cold file" eviction in tier 2 (7 days). */
const COLD_FILE_AGE_MS =
    COLD_DAYS * HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND;

/**
 * Resolve the per-fingerprint LRU bound from `AR_INCREMENTAL_MAX_FILES`.
 *
 * @returns Parsed positive integer override, or the 32-file default when the variable is
 *   unset, non-numeric, zero, or negative.
 */
export function getIncrementalMaxFiles(): number {
    const rawLimit = parseInt(process.env.AR_INCREMENTAL_MAX_FILES || '', DECIMAL_RADIX);
    return Number.isInteger(rawLimit) && rawLimit > 0 ? rawLimit : INCREMENTAL_MAX_FILES_DEFAULT;
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
    /** Number of lines in the current content (== lineStarts.length). */
    lineCount: number;
    /** Timestamp (ms) of the last time this file's incremental state was accessed. */
    lastAccessed: number;
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
        this.lineCount = this.lineStarts.length;
        this.lastAccessed = Date.now();
        this.subtrees = new Map();
        this.complexityMemo = new Map();
        this.literalRecords = [];
    }

    /**
     * Begin an incremental pass over `newContent`: keep the old subtree/memo maps for reuse
     * lookups and start fresh ones that will hold this scan's (reused + rebuilt) results.
     */
    /**
     * Begin an incremental pass over `newContent`: keep the old subtree/memo maps for reuse
     * lookups and start fresh ones that will hold this scan's (reused + rebuilt) results.
     */
    initIncrementalPass(newContent: string, newHash: string): void {
        this.content = newContent;
        this.contentHash = newHash;
        this.lineStarts = computeLineStarts(newContent);
        this.lineCount = this.lineStarts.length;
        this.lastAccessed = Date.now();
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

    readonly prepare = (newContent: string, newHash: string): void => {
        this.initIncrementalPass(newContent, newHash);
    };

    /**
     * INC-Mode-1 lookup: a subtree is reusable iff its START LINE and START COLUMN are
     * unchanged (its own line interval is untouched) AND its source text is byte-identical.
     * Line+column stability keeps every embedded line/column position stable even when a
     * SAME-LINE edit elsewhere shifted the function's absolute byte offset. Returns the
     * cached normalized children (or null to rebuild).
     */
    findReusedSubtree(span: ReusedSpan): NormalizedNode[] | null {
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

    readonly reuseSubtree = (span: ReusedSpan): NormalizedNode[] | null => {
        return this.findReusedSubtree(span);
    };

    /** Record a (reused or freshly-built) function subtree into the next scan's map. */
    storeCachedSubtree(span: ReusedSpan, children: NormalizedNode[]): void {
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
            endLine: getLineOfByte(this.lineStarts, Math.max(span.startByte, span.endByte - 1)),
            sourceText: span.sourceText,
            children,
            valid: true,
        });
    }

    readonly cacheSubtree = (span: ReusedSpan, children: NormalizedNode[]): void => {
        this.storeCachedSubtree(span, children);
    };

    /**
     * Analyzer-memo seed: record that `node` is a function whose subtree was reused this pass.
     */
    recordReusedNode(node: NormalizedNode, _span: ReusedSpan): void {
        this.reusedFnNodes.add(node);
        const traversalStack: NormalizedNode[] = [...(node.children || [])];
        while (traversalStack.length > 0) {
            const currentNode = traversalStack.pop();
            if (!currentNode) continue;
            if (
                currentNode.kind === NodeKind.NumericLiteral ||
                currentNode.kind === NodeKind.StringLiteral
            ) {
                this.reusedLiteralNodes.add(currentNode);
            }
            const childNodes = currentNode.children;
            if (childNodes && childNodes.length > 0) {
                traversalStack.push(...childNodes);
            }
        }
    }

    readonly markReused = (node: NormalizedNode, span: ReusedSpan): void => {
        this.recordReusedNode(node, span);
    };

    /** True when `node` is a function whose subtree was reused THIS pass. */
    isReusedFunction(node: NormalizedNode): boolean {
        return node ? this.reusedFnNodes.has(node) : false;
    }

    /** True when `node` is a literal inside a reused subtree THIS pass. */
    isReusedLiteral(node: NormalizedNode): boolean {
        return node ? this.reusedLiteralNodes.has(node) : false;
    }

    /** Read a cc memo value written by the PREVIOUS scan (reused subtrees only). */
    getComplexity(fnKey: string | number): number | undefined {
        return this.prevComplexityMemo ? this.prevComplexityMemo.get(fnKey) : undefined;
    }

    /** Record this scan's cc value (fresh or reused) for the next scan's reuse. */
    setComplexity(fnKey: string | number, cyclomaticComplexity: number): void {
        if (fnKey === undefined || fnKey === null) return;
        this.complexityMemo.set(fnKey, cyclomaticComplexity);
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
        this.reusedFnNodes = new Set();
        this.reusedLiteralNodes = new Set();
    }

    /** Drop all cached state (LRU eviction / RSS guard). Content is kept for next diff. */
    evictCaches(): void {
        this.prevSubtrees = null;
        this.subtrees.clear();
        this.prevComplexityMemo = null;
        this.complexityMemo.clear();
        this.prevLiteralRecords = [];
        this.literalRecords = [];
        this.reusedFnNodes = new Set();
        this.reusedLiteralNodes = new Set();
    }

    readonly evict = (): void => {
        this.evictCaches();
    };

    /**
     * Current cache size, expressed as the number of function subtrees retained for the next scan.
     */
    getSubtreeCount(): number {
        return this.subtrees.size;
    }

    readonly subtreeCount = (): number => {
        return this.getSubtreeCount();
    };
}

// ---------------------------------------------------------------------------
// Boundedness helpers (T02b): LRU eviction + RSS guard for daemon memory control.
// These NEVER change analysis output — an evicted file simply loses its subtree/memo caches
// and falls back to a full rescan next time it changes (byte-identical, just slower).
// ---------------------------------------------------------------------------

/**
 * Move `rel` to the most-recently-used end of `bucket`, making it the last candidate for LRU
 * eviction.  Also refreshes the `lastAccessed` timestamp used by tiered RSS eviction.
 * Entries absent from the bucket are ignored, so touching a stale key is safe.
 *
 * @param bucket - Per-fingerprint map from relative file path to its incremental state.
 * @param rel - Repo-relative file path to mark as most recently used.
 */
export function updateIncrementalTouch(
    bucket: Map<string, IncrementalFileState>,
    rel: string,
): void {
    const targetState = bucket.get(rel);
    if (!targetState) return;
    targetState.lastAccessed = Date.now();
    bucket.delete(rel);
    bucket.set(rel, targetState);
}

/**
 * Evict least-recently-used entries from `bucket` until at most `maxFiles` remain. Each removed
 * state has its caches cleared via {@link IncrementalFileState.evictCaches}; eviction is
 * loss-free for output and only increases the work of the next change to those files.
 *
 * @param bucket - Per-fingerprint LRU-ordered map of incremental states.
 * @param maxFiles - Retention bound; defaults to the env-aware getIncrementalMaxFiles() value.
 * @returns Number of entries evicted (0 when the bucket is already within the bound).
 */
export function pruneIncrementalBucket(
    bucket: Map<string, IncrementalFileState>,
    maxFiles: number = getIncrementalMaxFiles(),
): number {
    let evicted = 0;
    while (bucket.size > maxFiles) {
        const oldest = bucket.keys().next().value as string | undefined;
        if (oldest === undefined) break;
        const fileState = bucket.get(oldest);
        if (fileState) fileState.evictCaches();
        bucket.delete(oldest);
        evicted++;
    }
    return evicted;
}

/**
 * Selectively evicts states matching the provided filter predicate across all buckets.
 */
function evictMatchingStates(
    incremental: Map<string, Map<string, IncrementalFileState>>,
    predicate: (fileState: IncrementalFileState) => boolean,
): number {
    let evicted = 0;
    const toRemove: string[] = [];
    for (const bucket of incremental.values()) {
        toRemove.length = 0;
        for (const [path, fileState] of bucket) {
            if (predicate(fileState)) {
                toRemove.push(path);
            }
        }
        for (const path of toRemove) {
            const fileState = bucket.get(path);
            if (fileState) fileState.evictCaches();
            bucket.delete(path);
            evicted++;
        }
    }
    return evicted;
}

/**
 * Clears all cached states across all buckets under emergency memory pressure.
 */
function clearAllStates(incremental: Map<string, Map<string, IncrementalFileState>>): number {
    let evicted = 0;
    for (const bucket of incremental.values()) {
        for (const fileState of bucket.values()) {
            fileState.evictCaches();
        }
        evicted += bucket.size;
        bucket.clear();
    }
    return evicted;
}

/**
 * Proactively evicts cached `IncrementalFileState` objects when RSS memory crosses
 * configured thresholds.
 *
 * This is a loss-free cache reset: an evicted file simply falls back to a full
 * rescan next time it changes (byte-identical output, just slower).
 *
 * @param session - Scan-session object whose `incremental` map is pruned under memory pressure.
 * @param session.incremental - Fingerprint-keyed buckets holding per-file incremental states.
 * @returns Total number of per-file states evicted; 0 when RSS is within the soft cap.
 */
export function auditMemoryPressureGuard(session: {
    incremental: Map<string, Map<string, IncrementalFileState>>;
}): number {
    const rss0 = process.memoryUsage().rss;
    if (rss0 < RSS_BOUNDS.tier1Bytes) {
        return 0;
    }

    // Tier 1: evict large files
    let evicted = evictMatchingStates(
        session.incremental,
        (fileState) => fileState.lineCount > LARGE_FILE_LINE_THRESHOLD,
    );

    if (process.memoryUsage().rss < RSS_BOUNDS.tier2Bytes) {
        return evicted;
    }

    // Tier 2: evict cold files
    const cutoff = Date.now() - COLD_FILE_AGE_MS;
    evicted += evictMatchingStates(
        session.incremental,
        (fileState) => fileState.lastAccessed < cutoff,
    );

    if (process.memoryUsage().rss < RSS_BOUNDS.clearBytes) {
        return evicted;
    }

    // Tier 3: clear everything as last resort
    evicted += clearAllStates(session.incremental);
    return evicted;
}

export {
    getLineOfByte as lineOfByte,
    getIncrementalMaxFiles as incrementalMaxFiles,
    updateIncrementalTouch as touchIncremental,
    auditMemoryPressureGuard as incrementalRssGuard,
    auditMemoryPressureGuard as checkIncrementalRssGuard,
};
