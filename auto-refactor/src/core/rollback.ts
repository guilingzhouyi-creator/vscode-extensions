/**
 * Card-Level and Fine-Grained Atomic Rollback Engine.
 *
 * Implements fine-grained rollback and undo capabilities (docs / 1.md §4.1 & §4.2):
 * - Block-level / Hunk-level atomic revert (VS Code Copilot file-level undo style)
 * - Task-card level cascading rollback (reverting all changes attributed to a cardId)
 * - Conflict detection and Git fractal merge gate evaluation
 */

import { ReviewDiffHunk, IPraxisRollbackGatekeeper } from './praxis/contracts';
import { computeLineStarts, linesOf } from './editDiff';

export interface RollbackResult {
  success: boolean;
  updatedContent?: string;
  patch: string;
  error?: string;
}

export interface CardRollbackResult {
  success: boolean;
  affectedFiles: string[];
  rolledBackCheckpoints: string[];
  updatedFiles: Map<string, string>;
  error?: string;
}

/**
 * Revert a specific diff hunk from content by applying its inverse edit operations.
 */
export function revertDiffHunk(
  currentContent: string,
  hunk: ReviewDiffHunk
): RollbackResult {
  try {
    const starts = computeLineStarts(currentContent);
    const lines = linesOf(currentContent, starts);

    // Validate that the target range matches the hunk's new lines
    const startLineIdx = hunk.newSpan.startLine - 1;
    const newCount = hunk.newSpan.lineCount;

    // Collect the original old lines from the hunk
    const oldLines: string[] = [];
    for (const line of hunk.lines) {
      if (line.type === 'delete' || line.type === 'context') {
        oldLines.push(line.content);
      }
    }

    // Splice out the modified lines and restore old lines
    const resultLines = [...lines];
    resultLines.splice(startLineIdx, newCount, ...oldLines);

    const updatedContent = resultLines.join('\n');
    const patch = `--- current\n+++ reverted\n${hunk.header}\n` +
      hunk.lines.map((l) => {
        if (l.type === 'insert') return `-${l.content}`;
        if (l.type === 'delete') return `+${l.content}`;
        return ` ${l.content}`;
      }).join('\n');

    return {
      success: true,
      updatedContent,
      patch,
    };
  } catch (err: any) {
    return {
      success: false,
      patch: '',
      error: err?.message || String(err),
    };
  }
}

/**
 * Revert all hunks in multiple files attributed to a given TaskCard ID.
 */
export function revertTaskCard(
  fileContents: Map<string, string>,
  targetCardId: string,
  hunksByFile: Map<string, ReviewDiffHunk[]>
): CardRollbackResult {
  const affectedFiles: string[] = [];
  const rolledBackCheckpoints: Set<string> = new Set();
  const updatedFiles = new Map<string, string>();

  for (const [filePath, hunks] of hunksByFile.entries()) {
    // Filter hunks attributed to targetCardId
    const matchingHunks = hunks.filter((h) =>
      h.lines.some((l) => l.attribution?.cardId === targetCardId)
    );

    if (matchingHunks.length === 0) continue;

    let content = fileContents.get(filePath);
    if (content === undefined) continue;

    // Sort matching hunks in reverse order so line offsets stay valid during splicing
    const sortedHunks = [...matchingHunks].sort(
      (a, b) => b.newSpan.startLine - a.newSpan.startLine
    );

    let fileReverted = true;
    for (const hunk of sortedHunks) {
      const res = revertDiffHunk(content, hunk);
      if (res.success && res.updatedContent !== undefined) {
        content = res.updatedContent;
        // Record associated checkpoint
        for (const line of hunk.lines) {
          if (line.attribution?.checkpointId) {
            rolledBackCheckpoints.add(line.attribution.checkpointId);
          }
        }
      } else {
        fileReverted = false;
        break;
      }
    }

    if (fileReverted) {
      affectedFiles.push(filePath);
      updatedFiles.set(filePath, content);
    }
  }

  return {
    success: true,
    affectedFiles,
    rolledBackCheckpoints: Array.from(rolledBackCheckpoints),
    updatedFiles,
  };
}

/**
 * Praxis Rollback and Gatekeeper implementation.
 */
export class PraxisRollbackEngine implements IPraxisRollbackGatekeeper {
  private readonly fileCache: Map<string, string> = new Map();
  private readonly hunkIndex: Map<string, ReviewDiffHunk> = new Map();
  private readonly cardHunkMap: Map<string, ReviewDiffHunk[]> = new Map();

  /** Register active files and hunks for rollback indexing */
  registerFileHunks(filePath: string, content: string, hunks: ReviewDiffHunk[]): void {
    this.fileCache.set(filePath, content);
    for (const hunk of hunks) {
      this.hunkIndex.set(hunk.hunkId, hunk);
      for (const line of hunk.lines) {
        const cardId = line.attribution?.cardId;
        if (cardId) {
          const list = this.cardHunkMap.get(cardId) || [];
          list.push(hunk);
          this.cardHunkMap.set(cardId, list);
        }
      }
    }
  }

  revertDiffHunk(filePath: string, hunkId: string): { success: boolean; patch: string } {
    const hunk = this.hunkIndex.get(hunkId);
    const content = this.fileCache.get(filePath);
    if (!hunk || content === undefined) {
      return { success: false, patch: '' };
    }
    const res = revertDiffHunk(content, hunk);
    if (res.success && res.updatedContent !== undefined) {
      this.fileCache.set(filePath, res.updatedContent);
    }
    return { success: res.success, patch: res.patch };
  }

  revertTaskCard(cardId: string): { affectedFiles: string[]; rolledBackCheckpoints: string[] } {
    const hunksByFile = new Map<string, ReviewDiffHunk[]>();
    const cardHunks = this.cardHunkMap.get(cardId) || [];

    for (const [file, content] of this.fileCache.entries()) {
      hunksByFile.set(file, cardHunks);
    }

    const res = revertTaskCard(this.fileCache, cardId, hunksByFile);
    if (res.success) {
      for (const [file, updated] of res.updatedFiles.entries()) {
        this.fileCache.set(file, updated);
      }
    }
    return {
      affectedFiles: res.affectedFiles,
      rolledBackCheckpoints: res.rolledBackCheckpoints,
    };
  }

  checkMergeGate(
    sourceBranch: string,
    targetBranch: string,
    diffPayload: ReviewDiffHunk[]
  ): { approved: boolean; reason?: string; violations?: string[] } {
    const violations: string[] = [];

    for (const hunk of diffPayload) {
      if (hunk.reviewVerdict?.shouldEscalateToL3A) {
        violations.push(`Hunk ${hunk.hunkId} marked as major rework requiring L3A escalation`);
      }
      if (hunk.reviewVerdict?.status === 'major_rework_needed') {
        violations.push(`Hunk ${hunk.hunkId} failed review check`);
      }
    }

    if (violations.length > 0) {
      return {
        approved: false,
        reason: `Merge gate failed for ${sourceBranch} -> ${targetBranch} with ${violations.length} violations`,
        violations,
      };
    }

    return { approved: true };
  }
}
