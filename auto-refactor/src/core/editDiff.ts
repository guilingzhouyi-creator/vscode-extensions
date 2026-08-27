/**
 * Line-level Myers diff + edit-range computation (ts-free pure functions).
 *
 * Part of the line-level incremental infrastructure (docs/03-incremental-and-diff/01-line-level-incremental.md §3.2).
 * Produces `EditRange[]` — LSP didChange-style old/new byte spans — by diffing the
 * OLD and NEW file contents at LINE granularity, then mapping each changed line run
 * to its byte offsets. This module NEVER imports `typescript` (it sits on the
 * incremental routing path, which must stay loadable without the parser).
 */

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

/** A single Myers diff operation (the raw primitive `myersDiff` returns). */
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

/**
 * Myers O(ND) shortest-edit-script over two line arrays.
 *
 * Returns the edit script as a flat list of `equal`/`delete`/`insert` operations in
 * source order. `delete` consumes an old line; `insert` emits a new line. The total
 * number of delete+insert ops is the minimal edit distance.
 */
export function myersDiff(a: string[], b: string[]): DiffOp[] {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  if (max === 0) return [];
  const offset = max;
  // v[k] = furthest x reached on diagonal k (= x - y). Traced per-d for backtracking.
  const v: number[] = new Array(2 * max + 1).fill(0);
  const trace: number[][] = [];
  let d = 0;
  let found = false;
  for (d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[k - 1 + offset] < v[k + 1 + offset])) {
        // Came from diagonal k+1 via an INSERT (consume a new line).
        x = v[k + 1 + offset];
      } else {
        // Came from diagonal k-1 via a DELETE (consume an old line).
        x = v[k - 1 + offset] + 1;
      }
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[k + offset] = x;
      if (x >= n && y >= m) {
        found = true;
        break;
      }
    }
    if (found) break;
  }

  // Backtrack.
  const ops: DiffOp[] = [];
  let x = n;
  let y = m;
  for (let di = d; di >= 0; di--) {
    const vv = trace[di];
    const k = x - y;
    const insertMove = k === -di || (k !== di && vv[k - 1 + offset] < vv[k + 1 + offset]);
    const prevK = insertMove ? k + 1 : k - 1;
    const prevX = vv[prevK + offset];
    const prevY = prevX - prevK;
    // Undo the snake (equal runs).
    while (x > prevX && y > prevY) {
      ops.push({ type: 'equal', aIdx: x - 1, bIdx: y - 1 });
      x--;
      y--;
    }
    if (di > 0) {
      if (insertMove) {
        ops.push({ type: 'insert', aIdx: x, bIdx: y - 1 });
        y--;
      } else {
        ops.push({ type: 'delete', aIdx: x - 1, bIdx: y });
        x--;
      }
    }
  }
  ops.reverse();
  return ops;
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

/**
 * Compute byte-level edit ranges between two contents by line-diffing them.
 * Returns an empty array when the contents are identical.
 */
export function computeEditRanges(oldContent: string, newContent: string): EditRange[] {
  if (oldContent === newContent) return [];
  const oldStarts = computeLineStarts(oldContent);
  const newStarts = computeLineStarts(newContent);
  const a = linesOf(oldContent, oldStarts);
  const b = linesOf(newContent, newStarts);
  const ops = myersDiff(a, b);

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
  return edits;
}

/**
 * Incremental-worthiness gate (docs/03-incremental-and-diff/01-line-level-incremental.md §1/§8): only a LARGE file with a
 * SMALL change pays for the diff + cache-management overhead. `minLines` gates on the new
 * file's line count; `maxChangedLines` gates on the sum of deleted+inserted lines.
 */
export function shouldUseIncremental(
  oldContent: string,
  newContent: string,
  minLines: number,
  maxChangedLines: number,
): boolean {
  if (countLines(newContent) < minLines) return false;
  const edits = computeEditRanges(oldContent, newContent);
  return changedLineCount(edits) <= maxChangedLines;
}
