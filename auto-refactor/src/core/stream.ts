/**
 * Module: Core Engine — Reactive Diff Streaming Pipeline
 * File Path: src/core/stream.ts
 * Architecture Role: asynchronous event-source layer that turns diff inputs into ordered
 *   DiffStreamEvent values for API consumers; sits between hunk computation and the optional
 *   Praxis hooks / human ring buffer.
 * Dependencies & Triggers: imports core types from ./types, Praxis contracts from
 *   ./praxis/contracts, computeDetailedHunks from ./editDiff, and CircularDiffBuffer from
 *   ./ringBuffer; scanDiffStream is re-exported through api.ts and runs when a caller invokes
 *   it over DiffInput[].
 * Responsibilities: create LSP-compatible RefactoringPatch values for fixable issues; yield
 *   file_start, hunk_ready, file_done, and stream_end events; apply streamingMode,
 *   emitHunks, and maxStreamEvents controls; enrich hunks via attributionResolver,
 *   contextEnricher, and thresholdPolicy; derive impactFiles from dependencyGraph; count
 *   issues; feed and flush the human ring buffer; build the final ScanSummary.
 * Exit Semantics & Design Rationale: the exported scanDiffStream is an async generator; it
 *   yields stream_end after all inputs and flushes the ring buffer first. Errors raised by
 *   awaited Praxis hooks reject the consumer rather than being swallowed. Streaming preserves
 *   per-file progress, and maxStreamEvents caps event volume while counts still come from
 *   the single completed pass.
 */

import type { DiffInput, ScanDiffOptions, DiffStreamEvent, RefactoringPatch, Issue } from './types';
import type { ReviewDiffHunk, AttributedDiffLine } from './praxis/contracts';
import { computeDetailedHunks } from './editDiff';
import { CircularDiffBuffer } from './ringBuffer';

/**
 * Build a single-edit refactoring patch from an issue that carries an applicable suggestion.
 *
 * The edit replaces the text recorded in `issue.detail.value` on the issue's start line with
 * `issue.suggestion`, and the returned `unifiedPatch` mirrors that replacement. The helper is
 * pure with respect to its inputs: it performs no I/O, never mutates the issue, and returns no
 * partial patch when the required fields are missing.
 *
 * @param filePath - Repository-relative path embedded in the patch and unified diff headers.
 * @param issue - Issue to convert; only `suggestion`, `location` and `detail.value` take part
 *   in the produced patch.
 * @returns The constructed RefactoringPatch, or `undefined` when `issue.suggestion` is falsy
 *   or `issue.location.start` is absent, because then no safe edit can be applied.
 */
export function createPatchForIssue(filePath: string, issue: Issue): RefactoringPatch | undefined {
    if (!issue.suggestion || !issue.location?.start) return undefined;
    const start = issue.location.start;
    const end = issue.location.end || start;
    const val = String(issue.detail?.value || '');
    return {
        ruleId: `${issue.analyzer}:${issue.rule}`,
        title: `Apply fix for ${issue.rule}: ${issue.message}`,
        edits: [
            {
                range: {
                    startLine: start.line,
                    startCol: start.column,
                    endLine: end.line,
                    endCol: end.column,
                },
                newText: issue.suggestion,
            },
        ],
        unifiedPatch: `--- a/${filePath}\n+++ b/${filePath}\n@@ -${start.line},1 +${start.line},1 @@\n-${val}\n+${issue.suggestion}\n`,
    };
}
const STREAM_MODE_FULL = 'full';
const STREAM_MODE_SUMMARY_ONLY = 'summary_only';
const STREAM_MODE_DISABLED = 'disabled';
const STREAM_MODE_ISSUES_ONLY = 'issues_only';

const EVENT_FILE_START = 'file_start';
const EVENT_HUNK_READY = 'hunk_ready';
const EVENT_FILE_DONE = 'file_done';
const EVENT_STREAM_END = 'stream_end';

const VERDICT_PASSED = 'passed';
const DIFF_LINE_DELETE = 'delete';
const DIFF_LINE_INSERT = 'insert';

interface StreamControlPolicy {
    emitHunks: boolean;
    emitFiles: boolean;
    maxEvents: number;
    mode: 'full' | 'issues_only' | 'summary_only' | 'disabled';
}

interface StreamEventTracker {
    emittedCount: number;
}

interface DependencyGraphLike {
    getAffectedFiles(filePath: string): string[] | undefined;
}

/**
 * Resolve streaming emission and filtering options into a unified policy struct.
 */
function resolveStreamControlPolicy(options: ScanDiffOptions): StreamControlPolicy {
    const mode = options.streamingMode || STREAM_MODE_FULL;
    const emitHunks =
        options.emitHunks !== false &&
        mode !== STREAM_MODE_SUMMARY_ONLY &&
        mode !== STREAM_MODE_DISABLED;
    const emitFiles = mode !== STREAM_MODE_DISABLED;
    const maxEvents = options.maxStreamEvents ?? Number.POSITIVE_INFINITY;
    return { emitHunks, emitFiles, maxEvents, mode };
}

/**
 * Determine if a file lifecycle event should be yielded under the active policy and event budget.
 */
function shouldEmitFileEvent(policy: StreamControlPolicy, emittedCount: number): boolean {
    return policy.emitFiles && emittedCount < policy.maxEvents;
}

/**
 * Determine if an individual hunk event should be yielded under the active policy and event
 * budget.
 */
function shouldEmitHunkEvent(
    policy: StreamControlPolicy,
    isIssue: boolean,
    emittedCount: number,
): boolean {
    return (
        policy.emitHunks &&
        (policy.mode !== STREAM_MODE_ISSUES_ONLY || isIssue) &&
        emittedCount < policy.maxEvents
    );
}

/**
 * Instantiate the human-facing circular diff buffer if storage hooks are configured.
 */
function createHumanBuffer(hooks?: ScanDiffOptions['praxisHooks']): CircularDiffBuffer | undefined {
    if (hooks?.humanStorage) {
        return new CircularDiffBuffer({ storageAdapter: hooks.humanStorage });
    }
    return undefined;
}

/**
 * Compute detailed review hunks from diff input contents.
 */
function computeInputHunks(diff: DiffInput): ReviewDiffHunk[] {
    if (diff.kind === 'full') {
        return computeDetailedHunks(diff.oldContent, diff.newContent);
    }
    if (diff.oldContent) {
        return computeDetailedHunks(diff.oldContent, diff.newContent);
    }
    return [];
}

/**
 * Apply Praxis attribution resolver to diff hunk lines.
 */
async function applyPraxisAttribution(
    hunk: ReviewDiffHunk,
    filePath: string,
    hooks?: ScanDiffOptions['praxisHooks'],
): Promise<void> {
    if (!hooks?.attributionResolver) return;
    const attr = await hooks.attributionResolver.resolveAttribution(filePath, {
        startLine: hunk.oldSpan.startLine,
        endLine: hunk.oldSpan.startLine + hunk.oldSpan.lineCount,
    });
    if (!attr) return;
    for (const line of hunk.lines) {
        line.attribution = attr;
    }
}

/**
 * Apply Praxis context enricher and threshold policy to a review hunk.
 */
async function applyPraxisContextAndPolicy(
    hunk: ReviewDiffHunk,
    filePath: string,
    hooks?: ScanDiffOptions['praxisHooks'],
): Promise<void> {
    if (!hooks?.contextEnricher) return;
    const enriched = await hooks.contextEnricher.enrichHunk(filePath, hunk);
    if (enriched.enclosingSymbol || enriched.impactFiles) {
        hunk.astContext = {
            enclosingSymbol: enriched.enclosingSymbol,
            symbolKind: enriched.symbolKind,
            scopeRange: enriched.scopeRange,
            impactFiles: enriched.impactFiles,
        };
    }
    if (hooks.thresholdPolicy) {
        hunk.reviewVerdict = await hooks.thresholdPolicy.evaluateChange(filePath, hunk, enriched);
    }
}

/**
 * Auto-populate impact files from the dependency graph if available and missing on the hunk
 * context.
 */
function populateDependencyImpact(
    hunk: ReviewDiffHunk,
    filePath: string,
    dependencyGraph?: unknown,
): void {
    if (!dependencyGraph) return;
    if (hunk.astContext?.impactFiles) return;
    const dg = dependencyGraph as DependencyGraphLike;
    if (typeof dg.getAffectedFiles === 'function') {
        const affected = dg.getAffectedFiles(filePath);
        if (affected && affected.length > 0) {
            hunk.astContext = {
                ...(hunk.astContext || {}),
                impactFiles: affected,
            };
        }
    }
}

/**
 * Evaluate whether a review hunk qualifies as a detected issue based on verdict or line changes.
 */
function isHunkAnIssue(hunk: ReviewDiffHunk): boolean {
    if (hunk.reviewVerdict) {
        return hunk.reviewVerdict.status !== VERDICT_PASSED;
    }
    return hunk.lines.some(
        (l: AttributedDiffLine) => l.type === DIFF_LINE_DELETE || l.type === DIFF_LINE_INSERT,
    );
}

/**
 * Perform attribution, AST enrichment, dependency graph propagation, and buffer update for a
 * hunk.
 */
async function processStreamHunk(
    hunk: ReviewDiffHunk,
    filePath: string,
    options: ScanDiffOptions,
    humanBuffer?: CircularDiffBuffer,
): Promise<boolean> {
    await applyPraxisAttribution(hunk, filePath, options.praxisHooks);
    await applyPraxisContextAndPolicy(hunk, filePath, options.praxisHooks);
    populateDependencyImpact(hunk, filePath, options.dependencyGraph);
    const isIssue = isHunkAnIssue(hunk);
    if (humanBuffer) {
        humanBuffer.push(hunk);
    }
    return isIssue;
}

/**
 * Asynchronously stream hunk-level events for a single diff file while counting issues.
 */
async function* streamHunksForFile(
    diff: DiffInput,
    options: ScanDiffOptions,
    policy: StreamControlPolicy,
    tracker: StreamEventTracker,
    humanBuffer?: CircularDiffBuffer,
): AsyncGenerator<DiffStreamEvent, number> {
    const hunks = computeInputHunks(diff);
    let fileIssueCount = 0;

    for (const hunk of hunks) {
        const isIssue = await processStreamHunk(hunk, diff.filePath, options, humanBuffer);
        if (isIssue) {
            fileIssueCount++;
        }

        if (shouldEmitHunkEvent(policy, isIssue, tracker.emittedCount)) {
            tracker.emittedCount++;
            yield {
                type: EVENT_HUNK_READY,
                filePath: diff.filePath,
                hunk,
            };
        }
    }

    return fileIssueCount;
}

/**
 * Stream fine-grained, per-file diff events as an async generator.
 *
 * Events are produced lazily in input order: `file_start`, then the selected `hunk_ready`
 * events, then `file_done`, with one terminal `stream_end` after all inputs have been
 * processed and the human ring buffer (when configured) has been flushed. Async Praxis hooks
 * (attributionResolver, contextEnricher, thresholdPolicy) are awaited one at a time, so a
 * consumer that iterates sequentially observes deterministic enrichment; each call owns its
 * own iterator and counters, so independent consumers do not share state.
 *
 * Can be consumed with `for await (const event of scanDiffStream(diffs, options))`.
 *
 * @param diffs - Files to process sequentially; each entry supplies the old/new content used
 *   to compute hunks plus the hashes echoed on `file_start`.
 * @param options - Optional streaming controls: `streamingMode`, `emitHunks`,
 *   `maxStreamEvents`, `praxisHooks` (attribution, context, threshold policy, human storage)
 *   and `dependencyGraph`. Defaults to `{}`, meaning full mode, hunk emission enabled, no
 *   event cap and no Praxis enrichment.
 * @returns An async iterable of DiffStreamEvent values ending with `stream_end`; iterating it
 *   performs the scan, and the per-file progress is only delivered as events are consumed.
 */
export async function* scanDiffStream(
    diffs: DiffInput[],
    options: ScanDiffOptions = {},
): AsyncIterable<DiffStreamEvent> {
    const startTime = Date.now();
    const humanBuffer = createHumanBuffer(options.praxisHooks);

    let totalIssues = 0;
    let totalFilesScanned = 0;
    const policy = resolveStreamControlPolicy(options);
    const tracker: StreamEventTracker = { emittedCount: 0 };

    for (const diff of diffs) {
        const fileStartTime = Date.now();
        totalFilesScanned++;

        if (shouldEmitFileEvent(policy, tracker.emittedCount)) {
            tracker.emittedCount++;
            yield {
                type: EVENT_FILE_START,
                filePath: diff.filePath,
                oldHash: diff.oldContentHash,
                newHash: diff.newContentHash,
            };
        }

        const fileIssueCount = yield* streamHunksForFile(
            diff,
            options,
            policy,
            tracker,
            humanBuffer,
        );
        totalIssues += fileIssueCount;

        if (shouldEmitFileEvent(policy, tracker.emittedCount)) {
            tracker.emittedCount++;
            yield {
                type: EVENT_FILE_DONE,
                filePath: diff.filePath,
                stats: {
                    durationMs: Date.now() - fileStartTime,
                    issuesCount: fileIssueCount,
                },
            };
        }
    }

    if (humanBuffer) {
        humanBuffer.flushSnapshot();
    }

    yield {
        type: EVENT_STREAM_END,
        totalSummary: {
            filesScanned: totalFilesScanned,
            issuesTotal: totalIssues,
            bySeverity: { info: 0, warning: 0, error: 0 },
            byAnalyzer: {},
            durationMs: Date.now() - startTime,
        },
    };
}
