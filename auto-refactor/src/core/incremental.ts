/**
 * Module: Core Engine — Line-Level Incremental Routing Gate
 * File Path: src/core/incremental.ts
 * Architecture Role: ts-free routing gate and orchestration surface between the scan pipeline and
 *                    the diff/state primitives; decides per changed file whether line-level reuse
 *                    is worth it before any expensive analysis runs.
 * Dependencies & Triggers: Imports EditRange/computeEditRanges/changedLineCount/countLines/
 *                    shouldUseIncremental from ./editDiff and IncrementalFileState from
 *                    ./incrementalState; re-exports ./diff, ./utf8 and ./editDiff surfaces so the
 *                    scanner imports a single entry point. Triggered per changed file by the scan
 *                    engine (analyzer.ts); env switches are AR_INCREMENTAL,
 *                    AR_INCREMENTAL_MIN_LINES and AR_INCREMENTAL_MAX_CHANGED_LINES.
 * Responsibilities: Resolve the enabled/min-lines/max-changed thresholds from RouteOptions first,
 *                    then env, defaulting to 1000 lines and 200 changed lines; route() returns
 *                    'reuse' for byte-identical content, 'incremental' for a big file with a small
 *                    change and a previous IncrementalFileState, otherwise 'full'; keep the
 *                    re-exported diff-input routing (routeDiff/resolveDiff, normalizeEditRanges)
 *                    available through this module.
 * Exit Semantics & Design Rationale: The gate is OFF by default so the existing file-level L2 path
 *                    is unchanged; a diff failure degrades to 'full' instead of throwing, and the
 *                    CALLER (analyzer.ts) owns full-rescan fallback for any incremental anomaly.
 *                    This module NEVER imports `typescript`.
 */

import type { EditRange } from './editDiff';
import { computeEditRanges, changedLineCount, countLines, shouldUseIncremental } from './editDiff';
import type { IncrementalFileState } from './incrementalState';

/**
 * Radix passed to `parseInt` so env overrides are always read as base-10 integers (never
 * octal/hex auto-detection).
 */
const DECIMAL_RADIX = 10;

/**
 * Default minimum file length (lines) before line-level incremental reuse is considered when
 * `AR_INCREMENTAL_MIN_LINES` provides no positive override.
 */
const DEFAULT_INCREMENTAL_MIN_LINES = 1000;

/**
 * Default cap on changed (deleted + inserted) lines that still qualifies for line-level reuse
 * when `AR_INCREMENTAL_MAX_CHANGED_LINES` provides no positive override; larger edits are
 * rescanned in full.
 */
const DEFAULT_INCREMENTAL_MAX_CHANGED_LINES = 200;

/** IncrementalRoute value selecting a full rescan; every non-reusable path uses it. */
const INCREMENTAL_ROUTE_FULL = 'full';

/**
 * Report whether the line-level incremental path is enabled by `AR_INCREMENTAL=1`.
 * The gate is off by default so the historical file-level path remains the safe baseline.
 *
 * @returns True only for the exact env value '1'; unset or any other value yields false.
 */
export function incrementalEnabled(): boolean {
    return process.env.AR_INCREMENTAL === '1';
}

/**
 * Resolve the minimum file length that justifies line-level incremental reuse.
 *
 * @returns Positive integer override from `AR_INCREMENTAL_MIN_LINES`, or 1000 when the variable
 *   is unset, non-numeric, zero, or negative.
 */
export function incrementalMinLines(): number {
    const v = parseInt(process.env.AR_INCREMENTAL_MIN_LINES || '', DECIMAL_RADIX);
    return Number.isInteger(v) && v > 0 ? v : DEFAULT_INCREMENTAL_MIN_LINES;
}

/**
 * Resolve the maximum number of changed (deleted + inserted) lines that still qualifies for
 * line-level reuse; larger edits fall back to a full rescan.
 *
 * @returns Positive integer override from `AR_INCREMENTAL_MAX_CHANGED_LINES`, or 200 when the
 *   variable is unset, non-numeric, zero, or negative.
 */
export function incrementalMaxChangedLines(): number {
    const v = parseInt(process.env.AR_INCREMENTAL_MAX_CHANGED_LINES || '', DECIMAL_RADIX);
    return Number.isInteger(v) && v > 0 ? v : DEFAULT_INCREMENTAL_MAX_CHANGED_LINES;
}

/**
 * Routing decision for one changed file: 'reuse' for byte-identical content, 'incremental' for
 * a large file with a small edit and prior state available, 'full' for everything else.
 */
export type IncrementalRoute = 'reuse' | 'incremental' | typeof INCREMENTAL_ROUTE_FULL;

/**
 * Outcome of {@link route}: the selected mode plus the diff edit ranges that justify it.
 * Ranges are empty for 'reuse' and 'full' and non-empty for 'incremental'.
 */
export interface RouteResult {
    /** Selected incremental strategy for this file. */
    mode: IncrementalRoute;
    /** Non-overlapping edit ranges; populated only when mode is 'incremental'. */
    edits: EditRange[];
}

/**
 * Per-call overrides for {@link route}; each field falls back to the matching env-derived
 * default when left undefined, so callers can override one knob at a time.
 */
export interface RouteOptions {
    /** Override the env gate (e.g. a ScanConfig.incremental declarative switch). */
    enabled?: boolean;
    /** Override the min-lines threshold. */
    minLines?: number;
    /** Override the max-changed-lines threshold. */
    maxChangedLines?: number;
}

/**
 * Decide how a changed file should be analyzed: reuse byte-identical content, run the
 * line-level incremental path, or fall back to a full rescan.
 *
 * Rules are evaluated in order: disabled or missing previous state -> 'full'; identical old and
 * new content -> 'reuse'; new content below the min-lines threshold -> 'full'; a diff error or a
 * change above the max-changed-lines threshold -> 'full'; otherwise 'incremental'.
 *
 * @param _rel - Repo-relative path kept for call-site symmetry; currently not consulted.
 * @param oldContent - Previously scanned file text; may be empty for a new file.
 * @param newContent - Current file text.
 * @param state - Previous incremental state, or null/undefined when none is retained.
 * @param opts - Per-call gate and threshold overrides; defaults come from the environment.
 * @returns Chosen route plus its edit ranges; never throws and does not mutate its inputs.
 */
export function route(
    _rel: string,
    oldContent: string,
    newContent: string,
    state: IncrementalFileState | null | undefined,
    opts: RouteOptions = {},
): RouteResult {
    const enabled = opts.enabled !== undefined ? opts.enabled : incrementalEnabled();
    if (!enabled) return { mode: INCREMENTAL_ROUTE_FULL, edits: [] };
    if (!state) return { mode: INCREMENTAL_ROUTE_FULL, edits: [] };
    if (oldContent === newContent) return { mode: 'reuse', edits: [] };

    const minLines = opts.minLines !== undefined ? opts.minLines : incrementalMinLines();
    if (countLines(newContent) < minLines) return { mode: INCREMENTAL_ROUTE_FULL, edits: [] };

    let edits: EditRange[];
    try {
        edits = computeEditRanges(oldContent, newContent);
    } catch {
        // A diff failure is never fatal — the caller falls back to a full rescan.
        return { mode: INCREMENTAL_ROUTE_FULL, edits: [] };
    }

    const maxChanged =
        opts.maxChangedLines !== undefined ? opts.maxChangedLines : incrementalMaxChangedLines();
    if (changedLineCount(edits) > maxChanged) return { mode: INCREMENTAL_ROUTE_FULL, edits: [] };

    return { mode: 'incremental', edits };
}

// Re-exported for the scan pipeline / scripts that prefer a single entry point.
export { shouldUseIncremental, changedLineCount, computeEditRanges, countLines };
export type { EditRange };

// Diff-input routing surface (docs/03-incremental-and-diff/02-diff-interface-spec.md §2.1):
// single entry point for the scanner to resolve a DiffInput into byteEqual/incremental/full.
// Pure ts-free logic lives in diff.ts; this module only re-exports so consumers import from
// `./incremental`.
export { resolveDiff as routeDiff, resolveDiff } from './diff';
export type { ResolvedDiff, ResolveDiffOpts, DiffMode } from './diff';
export { normalizeEditRanges } from './utf8';
export { validateEditRanges } from './editDiff';
