/**
 * Line-level incremental routing gate + orchestration (ts-free).
 *
 * The gate is OFF by default (`AR_INCREMENTAL` unset/≠"1" → the current file-level L2 path
 * is unchanged). When enabled, `route()` decides per changed file whether the line-level
 * path is worth it: big file (≥ `AR_INCREMENTAL_MIN_LINES`, default 1000 lines) AND small
 * change (≤ `AR_INCREMENTAL_MAX_CHANGED_LINES`, default 200 changed lines). Any incremental
 * anomaly is handled by the CALLER (analyzer.ts) by falling back to a full rescan — this
 * module only ever computes; it never throws upward for a diff.
 *
 * This module NEVER imports `typescript`.
 */

import {
  EditRange,
  computeEditRanges,
  changedLineCount,
  countLines,
  shouldUseIncremental,
} from './editDiff';
import { IncrementalFileState } from './incrementalState';

/** Runtime switch: `AR_INCREMENTAL=1` enables the line-level incremental path. */
export function incrementalEnabled(): boolean {
  return process.env.AR_INCREMENTAL === '1';
}

/** Minimum file line count to attempt line-level incremental (default 1000). */
export function incrementalMinLines(): number {
  const v = parseInt(process.env.AR_INCREMENTAL_MIN_LINES || '', 10);
  return Number.isInteger(v) && v > 0 ? v : 1000;
}

/** Maximum changed (deleted+inserted) lines before falling back to a full rescan. */
export function incrementalMaxChangedLines(): number {
  const v = parseInt(process.env.AR_INCREMENTAL_MAX_CHANGED_LINES || '', 10);
  return Number.isInteger(v) && v > 0 ? v : 200;
}

export type IncrementalRoute = 'reuse' | 'incremental' | 'full';

export interface RouteResult {
  mode: IncrementalRoute;
  edits: EditRange[];
}

export interface RouteOptions {
  /** Override the env gate (e.g. a ScanConfig.incremental declarative switch). */
  enabled?: boolean;
  /** Override the min-lines threshold. */
  minLines?: number;
  /** Override the max-changed-lines threshold. */
  maxChangedLines?: number;
}

/**
 * Decide how to analyze a changed file.
 *
 *   'reuse'        — old and new content are byte-identical (caller may short-circuit)
 *   'incremental'  — big file + small change + previous state present → line-level path
 *   'full'         — everything else → current full-rescan path (the safe default)
 */
export function route(
  _rel: string,
  oldContent: string,
  newContent: string,
  state: IncrementalFileState | null | undefined,
  opts: RouteOptions = {},
): RouteResult {
  const enabled = opts.enabled !== undefined ? opts.enabled : incrementalEnabled();
  if (!enabled) return { mode: 'full', edits: [] };
  if (!state) return { mode: 'full', edits: [] };
  if (oldContent === newContent) return { mode: 'reuse', edits: [] };

  const minLines = opts.minLines !== undefined ? opts.minLines : incrementalMinLines();
  if (countLines(newContent) < minLines) return { mode: 'full', edits: [] };

  let edits: EditRange[];
  try {
    edits = computeEditRanges(oldContent, newContent);
  } catch {
    // A diff failure is never fatal — the caller falls back to a full rescan.
    return { mode: 'full', edits: [] };
  }

  const maxChanged = opts.maxChangedLines !== undefined ? opts.maxChangedLines : incrementalMaxChangedLines();
  if (changedLineCount(edits) > maxChanged) return { mode: 'full', edits: [] };

  return { mode: 'incremental', edits };
}

// Re-exported for the scan pipeline / scripts that prefer a single entry point.
export { shouldUseIncremental, changedLineCount, computeEditRanges, countLines };
export type { EditRange };

// Diff-input routing surface (docs/03-incremental-and-diff/02-diff-interface-spec.md §2.1): single entry point for the
// scanner to resolve a DiffInput into byteEqual/incremental/full. Pure ts-free logic lives in
// diff.ts; this module only re-exports so consumers import from `./incremental`.
export { resolveDiff as routeDiff, resolveDiff } from './diff';
export type { ResolvedDiff, ResolveDiffOpts, DiffMode } from './diff';
export { normalizeEditRanges } from './utf8';
export { validateEditRanges } from './editDiff';
