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
    const humanBuffer = options.praxisHooks?.humanStorage
        ? new CircularDiffBuffer({ storageAdapter: options.praxisHooks.humanStorage })
        : undefined;

    let totalIssues = 0;
    let totalFilesScanned = 0;

    const mode = options.streamingMode || 'full';
    const emitHunks = options.emitHunks !== false && mode !== 'summary_only' && mode !== 'disabled';
    const emitFiles = mode !== 'disabled';
    const maxEvents = options.maxStreamEvents ?? Number.POSITIVE_INFINITY;
    let emittedCount = 0;

    for (const diff of diffs) {
        const fileStartTime = Date.now();
        totalFilesScanned++;

        if (emitFiles && emittedCount < maxEvents) {
            emittedCount++;
            yield {
                type: 'file_start',
                filePath: diff.filePath,
                oldHash: diff.oldContentHash,
                newHash: diff.newContentHash,
            };
        }

        let hunks: ReviewDiffHunk[] = [];
        if (diff.kind === 'full') {
            hunks = computeDetailedHunks(diff.oldContent, diff.newContent);
        } else if (diff.oldContent) {
            hunks = computeDetailedHunks(diff.oldContent, diff.newContent);
        }

        let fileIssueCount = 0;

        for (const hunk of hunks) {
            // Attribute hunk with Praxis attribution resolver if present
            if (options.praxisHooks?.attributionResolver) {
                const attr = await options.praxisHooks.attributionResolver.resolveAttribution(
                    diff.filePath,
                    {
                        startLine: hunk.oldSpan.startLine,
                        endLine: hunk.oldSpan.startLine + hunk.oldSpan.lineCount,
                    },
                );
                if (attr) {
                    for (const line of hunk.lines) {
                        line.attribution = attr;
                    }
                }
            }

            // Enrich hunk with AST/LSP context if present
            if (options.praxisHooks?.contextEnricher) {
                const enriched = await options.praxisHooks.contextEnricher.enrichHunk(
                    diff.filePath,
                    hunk,
                );
                if (enriched.enclosingSymbol || enriched.impactFiles) {
                    hunk.astContext = {
                        enclosingSymbol: enriched.enclosingSymbol,
                        symbolKind: enriched.symbolKind,
                        scopeRange: enriched.scopeRange,
                        impactFiles: enriched.impactFiles,
                    };
                }
                if (options.praxisHooks.thresholdPolicy) {
                    hunk.reviewVerdict = await options.praxisHooks.thresholdPolicy.evaluateChange(
                        diff.filePath,
                        hunk,
                        enriched,
                    );
                }
            }

            // Auto-populate impactFiles from dependencyGraph if available and not yet populated
            if (options.dependencyGraph && (!hunk.astContext || !hunk.astContext.impactFiles)) {
                const affected = options.dependencyGraph.getAffectedFiles(diff.filePath);
                if (affected && affected.length > 0) {
                    hunk.astContext = {
                        ...(hunk.astContext || {}),
                        impactFiles: affected,
                    };
                }
            }

            // Count detected change issues
            const isIssue = hunk.reviewVerdict
                ? hunk.reviewVerdict.status !== 'passed'
                : hunk.lines.some(
                      (l: AttributedDiffLine) => l.type === 'delete' || l.type === 'insert',
                  );
            if (isIssue) {
                fileIssueCount++;
                totalIssues++;
            }

            // Push to human-facing ring buffer if active
            if (humanBuffer) {
                humanBuffer.push(hunk);
            }

            const shouldYieldHunk =
                emitHunks && (mode !== 'issues_only' || isIssue) && emittedCount < maxEvents;
            if (shouldYieldHunk) {
                emittedCount++;
                yield {
                    type: 'hunk_ready',
                    filePath: diff.filePath,
                    hunk,
                };
            }
        }

        if (emitFiles && emittedCount < maxEvents) {
            emittedCount++;
            yield {
                type: 'file_done',
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
        type: 'stream_end',
        totalSummary: {
            filesScanned: totalFilesScanned,
            issuesTotal: totalIssues,
            bySeverity: { info: 0, warning: 0, error: 0 },
            byAnalyzer: {},
            durationMs: Date.now() - startTime,
        },
    };
}
