/**
 * Module: Core Engine — Diff-Input Normalization & Routing
 * File Path: src/core/diff.ts
 * Architecture Role: Pure, ts-free routing layer between resident incremental state and
 *                    the scanner; selects byteEqual/full/incremental and builds review hunks.
 * Dependencies & Triggers: Called by scanner/API scan paths with a DiffInput; imports
 *                    editDiff, utf8, incrementalState types, core types, and Praxis contracts;
 *                    never imports `typescript`.
 * Responsibilities: Decode and normalize inputs, short-circuit byte-equal content, validate
 *                    and normalize edit ranges, enforce incremental gates (disabled, minLines,
 *                    maxChangedLines, resident-state baseline), compute detailed hunks, and
 *                    evaluate synchronous Praxis threshold policies.
 * Exit Semantics & Design Rationale: Always returns a ResolvedDiff; invalid advisory ranges
 *                    degrade to a full rescan instead of throwing, and async Praxis policies
 *                    are skipped with a warning in development. Subtree reuse requires
 *                    byte-identical source text, so imprecise ranges never change output bytes.
 *
 * CRITICAL INVARIANT: `editRanges` are ADVISORY — they only feed the `changedLineCount` gate.
 * Subtree reuse is decided independently by `reuseSubtree` (start line/column unchanged AND
 * source text byte-identical), so an imprecise edit range can never change the output bytes.
 *
 * Diff-input normalization + routing (ts-free pure functions).
 *
 * Turns a `DiffInput` (either `kind:'full'` old+new, or `kind:'ranges'` new+editRanges) into
 * a `ResolvedDiff` that the scanner can act on: `byteEqual` (short-circuit), `incremental`
 * (subtree reuse via a resident `IncrementalFileState`), or `full` (plain rescan).
 *
 * This module NEVER imports `typescript`.
 */

import type { EditRange, DiffOp } from './editDiff';
import {
    computeEditRangesWithOps,
    computeDetailedHunks,
    changedLineCount,
    countLines,
} from './editDiff';
import { normalizeEditRanges, decodeContent } from './utf8';
import type { IncrementalFileState } from './incrementalState';
import type { DiffInput } from './types';
import type { ReviewDiffHunk, PraxisVerdict, PraxisPluginHooks } from './praxis/contracts';

/** Equal lines of context kept on each side of a change when building review hunks. */
const DIFF_CONTEXT_LINES = 3;

/** DiffMode discriminant that forces a complete rescan (the fallback routing mode). */
const DIFF_MODE_FULL = 'full';

/** DiffInput.kind marking caller-supplied full old+new content (not edit ranges). */
const DIFF_INPUT_KIND_FULL = 'full';

/**
 * Routing decision for one diff input: `byteEqual` skips the file because the decoded contents
 * are identical, `incremental` reuses resident subtree state for the changed ranges, and
 * `full` forces a complete rescan. Exposed as the discriminant of `ResolvedDiff.mode`.
 */
export type DiffMode = 'byteEqual' | 'incremental' | typeof DIFF_MODE_FULL;

/**
 * Caller-supplied gates and context for `resolveDiff`.
 *
 * `minLines` and `maxChangedLines` are the required size/change thresholds that decide whether
 * incremental reuse is even considered. A resident `state` supplies the previous content
 * baseline; when it is absent the resolver cannot reuse subtrees and returns a full result.
 */
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

/**
 * Normalized outcome of `resolveDiff`, including the chosen mode and the data the scanner
 * needs next.
 *
 * `newContent` is always populated; `oldContent` appears only when the caller or resident
 * state supplied it, and `hunks` only when incremental mode computed them. The boolean flags
 * record how the decision was reached so callers can report a fallback without re-deriving it.
 */
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
    /**
     * True when `oldContent` was taken from `opts.state.content` rather than `input.oldContent`.
     */
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
        mode: DIFF_MODE_FULL,
        edits: [],
        newContent,
        rangesProvided,
        rangesFallback,
        oldContentFromState,
    };
}

/**
 * Resolve one diff input into an action:
 *   - 'byteEqual'   → contents identical, return empty edits (0 files to scan).
 *   - 'full'        → file must be rescanned in full (gate rejected, ranges invalid, or disabled).
 *   - 'incremental' → file meets every gate; `edits` contains the normalized byte ranges.
 *
 * The function is synchronous and side-effect free apart from invoking a synchronous Praxis
 * threshold policy: it never touches the filesystem, and invalid advisory ranges degrade to a
 * full rescan instead of throwing, so a scan never dies on imprecise caller metadata.
 *
 * @param input - Diff payload: either `kind:'full'` with old and new content, or
 *   `kind:'ranges'` with new content plus advisory edit ranges to validate and normalize.
 * @param opts - Incremental gates and context: the required minLines/maxChangedLines
 *   thresholds plus optional resident state, buf, filePath and Praxis hooks. Omitted state or
 *   a disabled/enabled-false flag forces a full result.
 * @returns A ResolvedDiff whose `mode` names the action, whose `edits` hold the normalized
 *   ranges for incremental mode, and whose flags record whether ranges were provided or
 *   rejected; never returns undefined and never throws for malformed ranges.
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
    if (input.kind === DIFF_INPUT_KIND_FULL) {
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
            edits = normalizeEditRanges(
                input.editRanges,
                opts.buf || Buffer.from(newContent, 'utf8'),
            );
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

    if (input.kind === DIFF_INPUT_KIND_FULL) {
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

    // Gate 5/6: resident state baseline check — compare lengths before contents so a size
    // mismatch short-circuits the full string equality test.
    const state = opts.state;
    if (!state) {
        return fullResult(newContent, rangesProvided, rangesFallback, oldContentFromState);
    }
    if (
        input.kind === DIFF_INPUT_KIND_FULL &&
        oldContent !== undefined &&
        (oldContent.length !== state.content.length || oldContent !== state.content)
    ) {
        return fullResult(newContent, rangesProvided, rangesFallback, oldContentFromState);
    }

    let hunks: ReviewDiffHunk[] | undefined;
    let praxisVerdict: PraxisVerdict | undefined;

    // Reuse the precomputed diffOps and line starts so hunks never trigger a duplicate diff.
    if (oldContent && opts.praxisHooks) {
        hunks = computeDetailedHunks(
            oldContent,
            newContent,
            DIFF_CONTEXT_LINES,
            diffOps,
            startsOld,
            startsNew,
        );
        if (opts.praxisHooks.thresholdPolicy && hunks.length > 0) {
            const enriched = opts.praxisHooks.contextEnricher
                ? opts.praxisHooks.contextEnricher.enrichHunk(opts.filePath || '', hunks[0])
                : { suggestedAction: 'auto_fix' as const };

            const verdict = opts.praxisHooks.thresholdPolicy.evaluateChange(
                opts.filePath || '',
                hunks[0],
                enriched as any,
            );
            if (!(verdict instanceof Promise)) {
                praxisVerdict = verdict;
            } else if (process.env.NODE_ENV === 'development' || process.env.DEBUG_PRAXIS) {
                console.warn(
                    '[Praxis] Async threshold policy evaluated during sync resolveDiff; consider scanDiffStream for full async streaming.',
                );
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
