/**
 * Per-file line-level incremental state (ts-free).
 *
 * Carries, for one file, the previous scan's content + the reusable caches that make a
 * second scan of a big-file-small-change cheaper:
 *   - `subtrees`     — function-subtree cache (INC-Mode-1 reuse unit; see §3.3)
 *   - `complexityMemo` — per-function cyclomatic-complexity memo (keyed by line:column)
 *   - `literalRecords` — constants-analyzer literal seed (T03)
 *
 * The state is daemon-memory-only (never persisted); eviction is bounded by the two-map
 * swap in `prepare()`/`finalize()` (subtrees for deleted/renamed functions are dropped),
 * plus the LRU + RSS-guard helpers at the bottom of this module (T02b).
 * This module NEVER imports `typescript`.
 */

import type { NormalizedNode, ReusedSpan } from './multilang';
import { NodeKind } from './multilang';

/** A cached function subtree (Mode B's materialized normalized children). */
export interface CachedSubtree {
  /** Stable identity within a scan — `"<startLine>:<startColumn>"`. */
  fnKey: string;
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
    if (content.charCodeAt(i) === 10 /* \n */) starts.push(i + 1);
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

/** Default max per-fingerprint incremental-state files before LRU eviction (T02b). */
const INCREMENTAL_MAX_FILES_DEFAULT = 32;

/** RSS soft threshold (bytes) above which all incremental buckets are cleared. */
const INCREMENTAL_RSS_CLEAR_BYTES = 512 * 1024 * 1024;

/** Runtime override for the LRU bound: `AR_INCREMENTAL_MAX_FILES` (positive integer). */
export function incrementalMaxFiles(): number {
  const v = parseInt(process.env.AR_INCREMENTAL_MAX_FILES || '', 10);
  return Number.isInteger(v) && v > 0 ? v : INCREMENTAL_MAX_FILES_DEFAULT;
}

export class IncrementalFileState {
  content: string;
  contentHash: string;
  lineStarts: number[];
  subtrees: Map<string, CachedSubtree>;
  /** Current scan's per-function cyclomatic-complexity memo (for the NEXT scan's reuse). */
  complexityMemo: Map<string, number>;
  /** Current scan's full literal record list (for the NEXT scan's reuse). */
  literalRecords: LiteralRecord[];
  /** Number of function subtrees reused during the most recent incremental pass. */
  reuseHits = 0;
  private prevSubtrees: Map<string, CachedSubtree> | null = null;
  private prevComplexityMemo: Map<string, number> | null = null;
  private prevLiteralRecords: LiteralRecord[] = [];
  /** Function nodes whose subtree was reused THIS pass (memo signal for analyzers). */
  private reusedFnNodes = new Set<NormalizedNode>();
  /** Literal nodes inside reused subtrees THIS pass (constants skip signal). */
  private reusedLiteralNodes = new Set<NormalizedNode>();

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
    const key = `${span.startLine}:${span.startColumn}`;
    const cached = prev.get(key);
    if (cached && cached.sourceText === span.sourceText) {
      this.reuseHits++;
      return cached.children;
    }
    return null;
  }

  /** Record a (reused or freshly-built) function subtree into the next scan's map. */
  cacheSubtree(span: ReusedSpan, children: NormalizedNode[]): void {
    const key = `${span.startLine}:${span.startColumn}`;
    const existing = this.subtrees.get(key);
    if (existing && existing.sourceText === span.sourceText) {
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
  getComplexity(fnKey: string): number | undefined {
    return this.prevComplexityMemo ? this.prevComplexityMemo.get(fnKey) : undefined;
  }

  /** Record this scan's cc value (fresh or reused) for the next scan's reuse. */
  setComplexity(fnKey: string, cc: number): void {
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

  subtreeCount(): number {
    return this.subtrees.size;
  }
}

// ---------------------------------------------------------------------------
// Boundedness helpers (T02b): LRU eviction + RSS guard for daemon memory control.
// These NEVER change analysis output — an evicted file simply loses its subtree/memo caches
// and falls back to a full rescan next time it changes (byte-identical, just slower).
// ---------------------------------------------------------------------------

/** Move `rel` to the most-recently-used end of the bucket (no-op when absent). */
export function touchIncremental(
  bucket: Map<string, IncrementalFileState>,
  rel: string,
): void {
  const st = bucket.get(rel);
  if (!st) return;
  bucket.delete(rel);
  bucket.set(rel, st);
}

/** LRU prune a per-fingerprint bucket to at most `maxFiles` files, evicting state first. */
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

/** Clear every incremental bucket when RSS crosses the soft threshold (pool-guard pattern). */
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
