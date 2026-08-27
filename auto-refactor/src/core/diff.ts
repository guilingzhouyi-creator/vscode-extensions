/**
 * Diff-input normalization + routing (ts-free pure functions).
 *
 * Turns a `DiffInput` (either `kind:'full'` old+new, or `kind:'ranges'` new+editRanges) into
 * a `ResolvedDiff` that the scanner can act on: `byteEqual` (short-circuit), `incremental`
 * (subtree reuse via a resident `IncrementalFileState`), or `full` (plain rescan).
 *
 * CRITICAL INVARIANT: `editRanges` are ADVISORY — they only feed the `changedLineCount` gate.
 * Subtree reuse is decided independently by `reuseSubtree` (start line/column unchanged AND
 * source text byte-identical), so an imprecise edit range can never change the output bytes.
 *
 * This module NEVER imports `typescript`.
 */

import { DiffInput, EditRange } from './types';
import { computeEditRanges, countLines, changedLineCount } from './editDiff';
import { normalizeEditRanges } from './utf8';
import type { IncrementalFileState } from './incrementalState';

export type DiffMode = 'byteEqual' | 'incremental' | 'full';

export interface ResolvedDiff {
  mode: DiffMode;
  /** Normalized edit ranges (UTF-16 code-unit byte offsets; empty for byteEqual/full). */
  edits: EditRange[];
  /** The OLD content when known (kind:'full' or ranges+input/state). */
  oldContent?: string;
  /** The canonical NEW content (disk-verified UTF-16 string). */
  newContent: string;
  /** kind:'ranges' input. */
  rangesProvided: boolean;
  /** ranges input that could not be normalized (→ full fallback). */
  rangesFallback: boolean;
  /** ranges input whose oldContent came from the resident state (not the input). */
  oldContentFromState: boolean;
}

export interface ResolveDiffOpts {
  /** `incrementalEnabled() || cfg.incremental === true`. */
  enabled: boolean;
  minLines: number;
  maxChangedLines: number;
  /** Resident per-file incremental state (may be null on a first scan). */
  state: IncrementalFileState | null | undefined;
  /** Canonical disk content (UTF-16 string). */
  newContent: string;
  /** Canonical disk buffer (used only for ranges UTF-8→UTF-16 conversion). */
  buf: Uint8Array;
}

function fullResult(
  newContent: string,
  rangesProvided: boolean,
  rangesFallback: boolean,
  oldContentFromState: boolean,
): ResolvedDiff {
  return {
    mode: 'full',
    edits: [],
    newContent,
    rangesProvided,
    rangesFallback,
    oldContentFromState,
  };
}

/**
 * Resolve one diff input into a routing decision.
 *
 * Routing (short-circuit order):
 *   1. gate disabled → full
 *   2. no edits (full: old===new; ranges: empty edit set) → byteEqual
 *   3. newContent line count < minLines → full
 *   4. changed line count > maxChangedLines → full
 *   5. no resident state → full
 *   6. (kind:'full') baseline drift: input.oldContent !== state.content → full (drop state)
 *   7. otherwise → incremental
 *
 * For `kind:'ranges'`, the three byte fields are converted UTF-8 → UTF-16 against the disk
 * buffer. `oldContent` is resolved from the input, else the resident state's previous content
 * (read BEFORE `prepare()` overwrites it). Without either, `oldContent` is unknown — but that
 * only matters for the (non-existent) Mode-2 line translation, so it stays full-free here.
 */
export function resolveDiff(input: DiffInput, opts: ResolveDiffOpts): ResolvedDiff {
  const newContent = opts.newContent;
  const rangesProvided = input.kind === 'ranges';
  let rangesFallback = false;
  let oldContentFromState = false;

  if (!opts.enabled) {
    return fullResult(newContent, rangesProvided, rangesFallback, oldContentFromState);
  }

  let edits: EditRange[];
  let oldContent: string | undefined;

  if (input.kind === 'full') {
    oldContent = input.oldContent;
    if (oldContent === newContent) {
      return {
        mode: 'byteEqual',
        edits: [],
        oldContent,
        newContent,
        rangesProvided,
        rangesFallback,
        oldContentFromState,
      };
    }
    edits = computeEditRanges(oldContent, newContent);
  } else {
    try {
      edits = normalizeEditRanges(input.editRanges, opts.buf);
    } catch {
      rangesFallback = true;
      return fullResult(newContent, rangesProvided, rangesFallback, oldContentFromState);
    }
    if (edits.length === 0) {
      return {
        mode: 'byteEqual',
        edits: [],
        oldContent,
        newContent,
        rangesProvided,
        rangesFallback,
        oldContentFromState,
      };
    }
    // oldContent source (kind:'ranges'): input first, else resident state (pre-prepare).
    if (typeof input.oldContent === 'string') {
      oldContent = input.oldContent;
    } else if (opts.state) {
      oldContent = opts.state.content;
      oldContentFromState = true;
    }
  }

  // Gate 3/4: big-file small-change thresholds.
  if (countLines(newContent) < opts.minLines) {
    return fullResult(newContent, rangesProvided, rangesFallback, oldContentFromState);
  }
  if (changedLineCount(edits) > opts.maxChangedLines) {
    return fullResult(newContent, rangesProvided, rangesFallback, oldContentFromState);
  }

  // Gate 5/6: need a resident state, and (for 'full') it must track the SAME baseline.
  const state = opts.state;
  if (!state) {
    return fullResult(newContent, rangesProvided, rangesFallback, oldContentFromState);
  }
  if (input.kind === 'full' && oldContent !== state.content) {
    return fullResult(newContent, rangesProvided, rangesFallback, oldContentFromState);
  }

  return {
    mode: 'incremental',
    edits,
    oldContent,
    newContent,
    rangesProvided,
    rangesFallback,
    oldContentFromState,
  };
}
