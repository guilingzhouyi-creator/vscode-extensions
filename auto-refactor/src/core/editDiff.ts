/**
 * Line-level Myers diff + edit-range computation (ts-free pure functions).
 *
 * Part of the line-level incremental infrastructure (docs/03-incremental-and-diff/01-line-level-incremental.md §3.2).
 * Produces `EditRange[]` — LSP didChange-style old/new byte spans — by diffing the
 * OLD and NEW file contents at LINE granularity, then mapping each changed line run
 * to its byte offsets. This module NEVER imports `typescript` (it sits on the
 * incremental routing path, which must stay loadable without the parser).
 */

import type { ReviewDiffHunk, AttributedDiffLine } from './praxis/contracts';
import { histogramDiff } from './histogramDiff';

export { histogramDiff };

/**
 * One contiguous edit (a run of adjacent line insertions/deletions, i.e. a "replace"
 * block). Line numbers are 1-based; byte offsets are UTF-16 code-unit offsets.
 */
export interface EditRange {
  /** 1-based first affected line (the same index in old and new content). */
  startLine: number;
  /** 1-based last OLD line consumed by this edit (inclusive). */
  oldEndLine: number;
  /** 1-based last NEW line produced by this edit (inclusive). */
  newEndLine: number;
  /** Byte offset where the edit starts (identical in old and new content). */
  startByte: number;
  /** Byte offset immediately AFTER the old (deleted) span. */
  oldEndByte: number;
  /** Byte offset immediately AFTER the new (inserted) span. */
  newEndByte: number;
}

/** A single diff operation. */
export interface DiffOp {
  type: 'equal' | 'delete' | 'insert';
  /** Index into the OLD line array (for 'equal'/'delete'); insertion point for 'insert'. */
  aIdx: number;
  /** Index into the NEW line array (for 'equal'/'insert'). */
  bIdx: number;
}

/** Byte offset of every line start (offset 0 for line 0, then after each `\n`). */
export function computeLineStarts(content: string): number[] {
  const starts: number[] = [0];
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10 /* \n */) starts.push(i + 1);
  }
  return starts;
}

/** Number of lines = 1 + number of `\n` (byte-identical to `content.split(/\r\n|\n/).length`). */
export function countLines(content: string): number {
  let n = 1;
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10 /* \n */) n++;
  }
  return n;
}

/** Split content into lines (trailing `\n` removed; a trailing `\r` is KEPT for CRLF fidelity). */
export function linesOf(content: string, starts: number[]): string[] {
  const out: string[] = new Array(starts.length);
  for (let i = 0; i < starts.length; i++) {
    const s = starts[i];
    const e = i + 1 < starts.length ? starts[i + 1] - 1 : content.length;
    out[i] = content.slice(s, e);
  }
  return out;
}

export interface LineIndex {
  starts: number[];
  hashes: Uint32Array;
}

/**
 * True Single-pass compute of line starts AND 32-bit FNV-1a hashes directly from source string.
 * Completely eliminates redundant traversals and intermediate string allocations.
 */
export function computeLineStartsAndHashes(content: string): LineIndex {
  const len = content.length;
  let capacity = Math.max(16, Math.ceil(len / 32));
  let startsBuf = new Int32Array(capacity);
  let hashesBuf = new Uint32Array(capacity);
  startsBuf[0] = 0;
  let lineCount = 1;

  let hash = 0x811c9dc5;
  for (let i = 0; i < len; i++) {
    const code = content.charCodeAt(i);
    if (code === 10) {
      if (lineCount >= capacity) {
        capacity = capacity << 1;
        const nextStarts = new Int32Array(capacity);
        nextStarts.set(startsBuf);
        startsBuf = nextStarts;
        const nextHashes = new Uint32Array(capacity);
        nextHashes.set(hashesBuf);
        hashesBuf = nextHashes;
      }
      hashesBuf[lineCount - 1] = hash >>> 0;
      startsBuf[lineCount] = i + 1;
      lineCount++;
      hash = 0x811c9dc5;
    } else {
      hash ^= code;
      hash = Math.imul(hash, 0x01000193);
    }
  }
  hashesBuf[lineCount - 1] = hash >>> 0;

  const starts: number[] = new Array(lineCount);
  for (let i = 0; i < lineCount; i++) starts[i] = startsBuf[i];
  const hashes = hashesBuf.slice(0, lineCount);

  return { starts, hashes };
}

/**
 * Compute 32-bit FNV-1a hashes directly from content and line starts without slicing strings!
 * Eliminates thousands of heap string allocations on large files.
 */
export function hashLinesDirect(content: string, starts: number[]): Uint32Array {
  const n = starts.length;
  const hashes = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    const s = starts[i];
    const e = i + 1 < n ? starts[i + 1] - 1 : content.length;
    let hash = 0x811c9dc5;
    for (let j = s; j < e; j++) {
      hash ^= content.charCodeAt(j);
      hash = Math.imul(hash, 0x01000193);
    }
    hashes[i] = hash >>> 0;
  }
  return hashes;
}

/** 32-bit FNV-1a line hash for fast line-level equality testing */
export function fnv1a32(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Compute 32-bit line hashes for an entire line array */
export function hashLines(lines: string[]): Uint32Array {
  const hashes = new Uint32Array(lines.length);
  for (let i = 0; i < lines.length; i++) {
    hashes[i] = fnv1a32(lines[i]);
  }
  return hashes;
}

/**
 * Adaptive fast diff: uses prefix/suffix trimming + adaptive Myers / Histogram switching.
 * Produces sub-millisecond execution times while guaranteeing O(N) linear time on clustered edits
 * and semantic block preservation on large refactorings.
 */
export function fastDiff(
  a: string[],
  b: string[],
  hA?: Uint32Array,
  hB?: Uint32Array
): DiffOp[] {
  const n = a.length;
  const m = b.length;
  if (n === 0 && m === 0) return [];
  if (n === 0) return b.map((_, bIdx) => ({ type: 'insert' as const, aIdx: 0, bIdx }));
  if (m === 0) return a.map((_, aIdx) => ({ type: 'delete' as const, aIdx, bIdx: 0 }));

  const hashA = hA || hashLines(a);
  const hashB = hB || hashLines(b);

  // Fast prefix / suffix check
  let prefix = 0;
  while (prefix < n && prefix < m && hashA[prefix] === hashB[prefix] && a[prefix] === b[prefix]) {
    prefix++;
  }
  let suffix = 0;
  while (
    suffix < n - prefix &&
    suffix < m - prefix &&
    hashA[n - 1 - suffix] === hashB[m - 1 - suffix] &&
    a[n - 1 - suffix] === b[m - 1 - suffix]
  ) {
    suffix++;
  }

  const midN = n - prefix - suffix;
  const midM = m - prefix - suffix;

  if (midN === 0 && midM === 0) {
    const ops: DiffOp[] = [];
    for (let i = 0; i < n; i++) ops.push({ type: 'equal', aIdx: i, bIdx: i });
    return ops;
  }

  // P1-6: Use Myers for mid <= 1500 lines (sub-millisecond in JS); switch to Histogram for large spans
  let midOps: DiffOp[];
  if (midN > 1500 || midM > 1500) {
    const sliceA = a.slice(prefix, n - suffix);
    const sliceB = b.slice(prefix, m - suffix);
    const sliceHA = hashA.subarray(prefix, n - suffix);
    const sliceHB = hashB.subarray(prefix, m - suffix);
    midOps = histogramDiff(sliceA, sliceB, sliceHA, sliceHB);
  } else {
    const sliceA = a.slice(prefix, n - suffix);
    const sliceB = b.slice(prefix, m - suffix);
    const sliceHA = hashA.subarray(prefix, n - suffix);
    const sliceHB = hashB.subarray(prefix, m - suffix);
    midOps = myersDiff(sliceA, sliceB, sliceHA, sliceHB);
  }

  const fullOps: DiffOp[] = [];
  for (let i = 0; i < prefix; i++) fullOps.push({ type: 'equal', aIdx: i, bIdx: i });
  for (const op of midOps) {
    fullOps.push({
      type: op.type,
      aIdx: prefix + op.aIdx,
      bIdx: prefix + op.bIdx,
    });
  }
  for (let i = 0; i < suffix; i++) {
    fullOps.push({ type: 'equal', aIdx: n - suffix + i, bIdx: m - suffix + i });
  }

  return fullOps;
}

/**
 * Hash-accelerated Myers O(ND) shortest-edit-script over two line arrays.
 *
 * Optimizations applied:
 * 1. Common prefix & suffix trimming (reduces matrix size by 90%+ in typical edits)
 * 2. 32-bit FNV-1a integer line comparison (eliminates string equality overhead)
 * 3. Flat Int32Array trace buffer to eliminate all trace.push(v.slice()) heap copies
 * 4. P0-3: Matrix overflow guard fallback to Histogram Diff to prevent OOM
 */
export function myersDiff(
  a: string[],
  b: string[],
  hA?: Uint32Array,
  hB?: Uint32Array
): DiffOp[] {
  const n = a.length;
  const m = b.length;
  if (n === 0 && m === 0) return [];
  if (n === 0) {
    return b.map((_, bIdx) => ({ type: 'insert' as const, aIdx: 0, bIdx }));
  }
  if (m === 0) {
    return a.map((_, aIdx) => ({ type: 'delete' as const, aIdx, bIdx: 0 }));
  }

  const hashA = hA || hashLines(a);
  const hashB = hB || hashLines(b);

  // 1. Fast-path: Common prefix trimming (O(N) single-pass)
  let prefix = 0;
  while (prefix < n && prefix < m && hashA[prefix] === hashB[prefix] && a[prefix] === b[prefix]) {
    prefix++;
  }

  // 2. Fast-path: Common suffix trimming (O(N) single-pass)
  let suffix = 0;
  while (
    suffix < n - prefix &&
    suffix < m - prefix &&
    hashA[n - 1 - suffix] === hashB[m - 1 - suffix] &&
    a[n - 1 - suffix] === b[m - 1 - suffix]
  ) {
    suffix++;
  }

  if (prefix + suffix === n && prefix + suffix === m) {
    const ops: DiffOp[] = [];
    for (let i = 0; i < n; i++) {
      ops.push({ type: 'equal', aIdx: i, bIdx: i });
    }
    return ops;
  }

  const midA = a.slice(prefix, n - suffix);
  const midB = b.slice(prefix, m - suffix);
  const midHA = hashA.subarray(prefix, n - suffix);
  const midHB = hashB.subarray(prefix, m - suffix);
  const midN = midA.length;
  const midM = midB.length;
  const max = midN + midM;

  // P0-3: Guard against OOM on large unpruned/disjoint matrices (>1500 lines or >2M cells)
  if (max > 1500 || (max + 1) * (2 * max + 1) > 2_000_000) {
    return histogramDiff(a, b, hashA, hashB);
  }

  const offset = max;
  const rowSize = 2 * max + 1;

  // P0-1: Flat Int32Array trace buffer to eliminate all trace.push(v.slice()) heap copies
  const v = new Int32Array(rowSize);
  const trace = new Int32Array((max + 1) * rowSize);
  let d = 0;
  let found = false;

  for (d = 0; d <= max; d++) {
    trace.set(v, d * rowSize);
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[k - 1 + offset] < v[k + 1 + offset])) {
        x = v[k + 1 + offset];
      } else {
        x = v[k - 1 + offset] + 1;
      }
      let y = x - k;
      while (x < midN && y < midM && (midHA[x] === midHB[y] && midA[x] === midB[y])) {
        x++;
        y++;
      }
      v[k + offset] = x;
      if (x >= midN && y >= midM) {
        found = true;
        break;
      }
    }
    if (found) break;
  }

  // Backtrack middle portion using flat trace
  const midOps: DiffOp[] = [];
  let x = midN;
  let y = midM;
  for (let di = d; di >= 0; di--) {
    const rowOffset = di * rowSize;
    const k = x - y;
    const insertMove = k === -di || (k !== di && trace[rowOffset + k - 1 + offset] < trace[rowOffset + k + 1 + offset]);
    const prevK = insertMove ? k + 1 : k - 1;
    const prevX = trace[rowOffset + prevK + offset];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      midOps.push({ type: 'equal', aIdx: prefix + x - 1, bIdx: prefix + y - 1 });
      x--;
      y--;
    }
    if (di > 0) {
      if (insertMove) {
        midOps.push({ type: 'insert', aIdx: prefix + x, bIdx: prefix + y - 1 });
        y--;
      } else {
        midOps.push({ type: 'delete', aIdx: prefix + x - 1, bIdx: prefix + y });
        x--;
      }
    }
  }
  midOps.reverse();

  // Combine: prefix equals + middle edit ops + suffix equals
  const fullOps: DiffOp[] = [];
  for (let i = 0; i < prefix; i++) {
    fullOps.push({ type: 'equal', aIdx: i, bIdx: i });
  }
  for (const op of midOps) {
    fullOps.push(op);
  }
  for (let i = 0; i < suffix; i++) {
    const aIdx = n - suffix + i;
    const bIdx = m - suffix + i;
    fullOps.push({ type: 'equal', aIdx, bIdx });
  }

  return fullOps;
}

/**
 * Validate a set of edit ranges. Throws on the first invalid range:
 *   - non-numeric / non-finite fields
 *   - startLine < 1
 *   - end line/byte before start line/byte
 *   - negative byte offset
 *   - byte offset beyond `maxByte` (when provided — callers pass the content length)
 * This is the single validation entry used by the UTF-8 normalization path; `editRanges`
 * are advisory so the caller converts a throw into a full-rescan fallback.
 */
export function validateEditRanges(edits: EditRange[], maxByte?: number): void {
  for (const e of edits) {
    if (
      !e ||
      typeof e.startLine !== 'number' || !Number.isFinite(e.startLine) ||
      typeof e.oldEndLine !== 'number' || !Number.isFinite(e.oldEndLine) ||
      typeof e.newEndLine !== 'number' || !Number.isFinite(e.newEndLine) ||
      typeof e.startByte !== 'number' || !Number.isFinite(e.startByte) ||
      typeof e.oldEndByte !== 'number' || !Number.isFinite(e.oldEndByte) ||
      typeof e.newEndByte !== 'number' || !Number.isFinite(e.newEndByte)
    ) {
      throw new Error('invalid edit range: non-numeric field');
    }
    if (e.startLine < 1) throw new Error('invalid edit range: startLine < 1');
    if (e.oldEndLine < e.startLine || e.newEndLine < e.startLine) {
      throw new Error('invalid edit range: end line before start line');
    }
    if (e.startByte < 0) throw new Error('invalid edit range: negative byte offset');
    if (e.oldEndByte < e.startByte || e.newEndByte < e.startByte) {
      throw new Error('invalid edit range: end byte before start byte');
    }
    if (maxByte !== undefined) {
      if (e.startByte > maxByte || e.oldEndByte > maxByte || e.newEndByte > maxByte) {
        throw new Error('invalid edit range: byte offset out of bounds');
      }
    }
  }
}

/** Total number of lines touched by a set of edits (deleted + inserted), for gating. */
export function changedLineCount(edits: EditRange[]): number {
  let n = 0;
  for (const e of edits) {
    n += (e.oldEndLine - e.startLine + 1) + (e.newEndLine - e.startLine + 1);
  }
  return n;
}

/** Helper to lazily slice a single line without full-array allocation */
export function getLine(content: string, starts: number[], idx: number): string {
  if (idx < 0 || idx >= starts.length) return '';
  const s = starts[idx];
  const e = idx + 1 < starts.length ? starts[idx + 1] - 1 : content.length;
  return content.slice(s, e);
}

export interface DetailedDiffResult {
  edits: EditRange[];
  ops: DiffOp[];
  oldIndex: LineIndex;
  newIndex: LineIndex;
}

/**
 * Compute byte-level edit ranges AND diff operations in a single coordinated pass.
 */
export function computeEditRangesWithOps(oldContent: string, newContent: string): DetailedDiffResult {
  // P1-9: Immediate 0.001ms return when contents are identical without computing hashes
  if (oldContent === newContent) {
    const emptyIndex: LineIndex = { starts: [0], hashes: new Uint32Array(0) };
    return { edits: [], ops: [], oldIndex: emptyIndex, newIndex: emptyIndex };
  }

  const oldIndex = computeLineStartsAndHashes(oldContent);
  const newIndex = computeLineStartsAndHashes(newContent);
  const oldStarts = oldIndex.starts;
  const newStarts = newIndex.starts;
  const a = linesOf(oldContent, oldStarts);
  const b = linesOf(newContent, newStarts);
  const ops = fastDiff(a, b, oldIndex.hashes, newIndex.hashes);

  const edits: EditRange[] = [];
  let i = 0;
  while (i < ops.length) {
    if (ops[i].type === 'equal') {
      i++;
      continue;
    }
    const startIdx = ops[i].aIdx;
    let delCount = 0;
    let insCount = 0;
    while (i < ops.length && ops[i].type !== 'equal') {
      if (ops[i].type === 'delete') delCount++;
      else insCount++;
      i++;
    }
    const startByte = startIdx < oldStarts.length ? oldStarts[startIdx] : oldContent.length;
    const oldEndIdx = startIdx + delCount;
    const newEndIdx = startIdx + insCount;
    const oldEndByte = oldEndIdx < oldStarts.length ? oldStarts[oldEndIdx] : oldContent.length;
    const newEndByte = newEndIdx < newStarts.length ? newStarts[newEndIdx] : newContent.length;
    edits.push({
      startLine: startIdx + 1,
      oldEndLine: startIdx + delCount,
      newEndLine: startIdx + insCount,
      startByte,
      oldEndByte,
      newEndByte,
    });
  }
  return { edits, ops, oldIndex, newIndex };
}

/**
 * Compute byte-level edit ranges between two contents by line-diffing them.
 * Returns an empty array when the contents are identical.
 */
export function computeEditRanges(oldContent: string, newContent: string): EditRange[] {
  return computeEditRangesWithOps(oldContent, newContent).edits;
}

/**
 * Incremental-worthiness gate: only a LARGE file with a SMALL change pays for the diff.
 */
export function shouldUseIncremental(
  oldContent: string,
  newContent: string,
  minLines: number,
  maxChangedLines: number,
): boolean {
  const { edits, newIndex } = computeEditRangesWithOps(oldContent, newContent);
  if (newIndex.starts.length < minLines) return false;
  return changedLineCount(edits) <= maxChangedLines;
}

/**
 * Compute rich review-level hunks with line numbers, context lines, and diff operations.
 * Produces structured hunks compatible with Git diff and Review Cell inspection.
 * Uses lazy line slicing to eliminate intermediate string allocations.
 */
export function computeDetailedHunks(
  oldContent: string,
  newContent: string,
  contextLines: number = 3,
  precomputedOps?: DiffOp[],
  precomputedStartsOld?: number[],
  precomputedStartsNew?: number[]
): ReviewDiffHunk[] {
  if (oldContent === newContent) return [];
  const oldStarts = precomputedStartsOld || computeLineStarts(oldContent);
  const newStarts = precomputedStartsNew || computeLineStarts(newContent);
  let ops = precomputedOps;
  if (!ops) {
    const oldIndex = computeLineStartsAndHashes(oldContent);
    const newIndex = computeLineStartsAndHashes(newContent);
    const a = linesOf(oldContent, oldIndex.starts);
    const b = linesOf(newContent, newIndex.starts);
    ops = fastDiff(a, b, oldIndex.hashes, newIndex.hashes);
  }

  const hunks: ReviewDiffHunk[] = [];
  let i = 0;

  while (i < ops.length) {
    if (ops[i].type === 'equal') {
      i++;
      continue;
    }

    const changeStart = i;
    const ctxStart = Math.max(0, changeStart - contextLines);

    let changeEnd = changeStart;
    while (changeEnd < ops.length) {
      if (ops[changeEnd].type !== 'equal') {
        changeEnd++;
      } else {
        let lookahead = changeEnd;
        while (lookahead < ops.length && ops[lookahead].type === 'equal') {
          lookahead++;
        }
        if (lookahead < ops.length && lookahead - changeEnd <= contextLines * 2) {
          changeEnd = lookahead;
        } else {
          break;
        }
      }
    }

    const ctxEnd = Math.min(ops.length, changeEnd + contextLines);
    const hunkOps = ops.slice(ctxStart, ctxEnd);
    const hunkLines: AttributedDiffLine[] = [];

    let oldLine = 1;
    let newLine = 1;
    if (hunkOps.length > 0) {
      oldLine = hunkOps[0].aIdx + 1;
      newLine = hunkOps[0].bIdx + 1;
    }
    const startOld = oldLine;
    const startNew = newLine;
    let oldCount = 0;
    let newCount = 0;

    for (const op of hunkOps) {
      if (op.type === 'equal') {
        hunkLines.push({
          type: 'context',
          lineNoOld: op.aIdx + 1,
          lineNoNew: op.bIdx + 1,
          content: getLine(oldContent, oldStarts, op.aIdx),
        });
        oldCount++;
        newCount++;
      } else if (op.type === 'delete') {
        hunkLines.push({
          type: 'delete',
          lineNoOld: op.aIdx + 1,
          content: getLine(oldContent, oldStarts, op.aIdx),
        });
        oldCount++;
      } else if (op.type === 'insert') {
        hunkLines.push({
          type: 'insert',
          lineNoNew: op.bIdx + 1,
          content: getLine(newContent, newStarts, op.bIdx),
        });
        newCount++;
      }
    }

    hunks.push({
      hunkId: `hunk-${hunks.length + 1}-${startOld}-${startNew}`,
      header: `@@ -${startOld},${oldCount} +${startNew},${newCount} @@`,
      oldSpan: { startLine: startOld, lineCount: oldCount },
      newSpan: { startLine: startNew, lineCount: newCount },
      lines: hunkLines,
    });

    i = ctxEnd;
  }

  return hunks;
}

/**
 * Format a ReviewDiffHunk into standard human-readable Unified Diff format
 * with AST function anchor headers and optional AI provenance badges.
 */
export function formatUnifiedDiff(hunk: ReviewDiffHunk, options?: { showAttribution?: boolean }): string {
  const lines: string[] = [];
  const symbol = hunk.astContext?.enclosingSymbol ? ` ${hunk.astContext.enclosingSymbol}` : '';
  lines.push(`${hunk.header}${symbol}`);

  for (const line of hunk.lines) {
    const attr = options?.showAttribution && line.attribution
      ? `  # [${line.attribution.agentUid || 'Agent'}]`
      : '';
    if (line.type === 'delete') {
      lines.push(`-${line.content}${attr}`);
    } else if (line.type === 'insert') {
      lines.push(`+${line.content}${attr}`);
    } else {
      lines.push(` ${line.content}`);
    }
  }
  return lines.join('\n');
}


