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

import {
  EditRange,
  computeEditRangesWithOps,
  computeDetailedHunks,
  changedLineCount,
  countLines,
  DiffOp,
} from './editDiff';
import { normalizeEditRanges, decodeContent } from './utf8';
import type { IncrementalFileState } from './incrementalState';
import { DiffInput } from './types';
import type { ReviewDiffHunk, PraxisVerdict, PraxisPluginHooks } from './praxis/contracts';

export type DiffMode = 'byteEqual' | 'incremental' | 'full';

/** Options accepted by `resolveDiff`. */
export interface ResolveDiffOpts {
  state?: IncrementalFileState;
  /** Legacy alias for incremental gating */
  enabled?: boolean;
  /** When true, `incremental` mode is gated off entirely (returns `full` or `byteEqual`). */
  incrementalDisabled?: boolean;
  minLines: number;
  maxChangedLines: number;
  /** Optional pre-read newContent */
  newContent?: string;
  /** Raw file bytes, when available (used by the UTF-8 normalization path). */
  buf?: Uint8Array;
  /** Optional file path for Praxis review context */
  filePath?: string;
  /** Optional Praxis integration SPI hooks */
  praxisHooks?: PraxisPluginHooks;
}

/** Output of `resolveDiff`. */
export interface ResolvedDiff {
  mode: DiffMode;
  edits: EditRange[];
  hunks?: ReviewDiffHunk[];
  oldContent?: string;
  newContent: string;
  /** True when the caller provided ranges upfront (`DiffInput.kind === 'ranges'`). */
  rangesProvided: boolean;
  /** True when caller provided ranges, but validation rejected them and fell back to `full`. */
  rangesFallback: boolean;
  /** True when `oldContent` was taken from `opts.state.content` rather than `input.oldContent`. */
  oldContentFromState: boolean;
  /** Praxis review verdict if evaluated */
  praxisVerdict?: PraxisVerdict;
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
 * Resolve a diff input into an action:
 *   - 'byteEqual'   → contents identical, return empty edits (0 files to scan).
 *   - 'full'        → file must be rescanned in full (gate rejected, ranges invalid, or disabled).
 *   - 'incremental' → file meets every gate; `edits` contains the normalized byte ranges.
 */
export function resolveDiff(input: DiffInput, opts: ResolveDiffOpts): ResolvedDiff {
  const newContent = decodeContent(input.newContent);
  let oldContent: string | undefined;
  let rangesProvided = input.kind === 'ranges';
  let rangesFallback = false;
  let oldContentFromState = false;

  let edits: EditRange[] = [];
  let diffOps: DiffOp[] | undefined;
  let startsOld: number[] | undefined;
  let startsNew: number[] | undefined;
  let newLinesCount: number | undefined;

  // Invariant 0: Exact byte equality ALWAYS short-circuits to byteEqual (0 files to scan)
  if (input.kind === 'full') {
    oldContent = decodeContent(input.oldContent);
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
  } else {
    rangesProvided = true;
    try {
      edits = normalizeEditRanges(input.editRanges, opts.buf || Buffer.from(newContent, 'utf8'));
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
    if (typeof input.oldContent === 'string') {
      oldContent = input.oldContent;
    } else if (opts.state) {
      oldContent = opts.state.content;
      oldContentFromState = true;
    }
  }

  // Gate 1: incremental feature disabled entirely.
  if (opts.incrementalDisabled || opts.enabled === false) {
    return fullResult(newContent, rangesProvided, rangesFallback, oldContentFromState);
  }

  if (input.kind === 'full') {
    const diffRes = computeEditRangesWithOps(oldContent!, newContent);
    edits = diffRes.edits;
    diffOps = diffRes.ops;
    startsOld = diffRes.oldIndex.starts;
    startsNew = diffRes.newIndex.starts;
    newLinesCount = diffRes.newIndex.starts.length;
  }

  // Gate 3/4: big-file small-change thresholds.
  const lineCount = newLinesCount ?? countLines(newContent);
  if (lineCount < opts.minLines) {
    return fullResult(newContent, rangesProvided, rangesFallback, oldContentFromState);
  }
  if (changedLineCount(edits) > opts.maxChangedLines) {
    return fullResult(newContent, rangesProvided, rangesFallback, oldContentFromState);
  }

  // Gate 5/6: resident state baseline check (P2-2: length pre-check before string equality).
  const state = opts.state;
  if (!state) {
    return fullResult(newContent, rangesProvided, rangesFallback, oldContentFromState);
  }
  if (
    input.kind === 'full' &&
    oldContent !== undefined &&
    (oldContent.length !== state.content.length || oldContent !== state.content)
  ) {
    return fullResult(newContent, rangesProvided, rangesFallback, oldContentFromState);
  }

  let hunks: ReviewDiffHunk[] | undefined;
  let praxisVerdict: PraxisVerdict | undefined;

  // P1-2: Reuse precomputed diffOps and line starts to eliminate duplicate diff!
  if (oldContent && opts.praxisHooks) {
    hunks = computeDetailedHunks(oldContent, newContent, 3, diffOps, startsOld, startsNew);
    if (opts.praxisHooks.thresholdPolicy && hunks.length > 0) {
      const enriched = opts.praxisHooks.contextEnricher
        ? opts.praxisHooks.contextEnricher.enrichHunk(opts.filePath || '', hunks[0])
        : { suggestedAction: 'auto_fix' as const };

      const verdict = opts.praxisHooks.thresholdPolicy.evaluateChange(
        opts.filePath || '',
        hunks[0],
        enriched as any
      );
      if (!(verdict instanceof Promise)) {
        praxisVerdict = verdict;
      } else if (process.env.NODE_ENV === 'development' || process.env.DEBUG_PRAXIS) {
        console.warn('[Praxis] Async threshold policy evaluated during sync resolveDiff; consider scanDiffStream for full async streaming.');
      }
    }
  }

  return {
    mode: 'incremental',
    edits,
    hunks,
    oldContent,
    newContent,
    rangesProvided,
    rangesFallback,
    oldContentFromState,
    praxisVerdict,
  };
}
