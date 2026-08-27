/**
 * Reactive Diff Streaming Pipeline.
 *
 * Implements fine-grained, asynchronous event streaming over code differences:
 * - Emits `file_start`, `hunk_ready`, `issue_found`, `file_done`, and `stream_end` events
 * - Integrates with `IPraxisDualFaceChannel` to feed Review Cell streaming and human ring buffers
 * - Generates LSP-compatible `RefactoringPatch` for automatic quick fixes
 */

import {
  DiffInput,
  ScanDiffOptions,
  DiffStreamEvent,
  RefactoringPatch,
  Issue,
} from './types';
import type { ReviewDiffHunk, AttributedDiffLine } from './praxis/contracts';
import { computeDetailedHunks } from './editDiff';
import { CircularDiffBuffer } from './ringBuffer';

/** Helper to generate a RefactoringPatch from an issue with a suggestion */
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
 * Scan differences and yield fine-grained events asynchronously.
 *
 * Can be consumed with `for await (const event of scanDiffStream(diffs, options))`
 */
export async function* scanDiffStream(
  diffs: DiffInput[],
  options: ScanDiffOptions = {}
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
          { startLine: hunk.oldSpan.startLine, endLine: hunk.oldSpan.startLine + hunk.oldSpan.lineCount }
        );
        if (attr) {
          for (const line of hunk.lines) {
            line.attribution = attr;
          }
        }
      }

      // Enrich hunk with AST/LSP context if present
      if (options.praxisHooks?.contextEnricher) {
        const enriched = await options.praxisHooks.contextEnricher.enrichHunk(diff.filePath, hunk);
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
            enriched
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
        : hunk.lines.some((l: AttributedDiffLine) => l.type === 'delete' || l.type === 'insert');
      if (isIssue) {
        fileIssueCount++;
        totalIssues++;
      }

      // Push to human-facing ring buffer if active
      if (humanBuffer) {
        humanBuffer.push(hunk);
      }

      const shouldYieldHunk = emitHunks && (mode !== 'issues_only' || isIssue) && emittedCount < maxEvents;
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
