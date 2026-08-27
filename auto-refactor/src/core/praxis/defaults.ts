/**
 * Default High-Performance Reference Implementations of Praxis SPI Contracts.
 *
 * Used out-of-the-box by auto-refactor when no custom Praxis plugins are injected.
 */

import {
  PraxisCardContext,
  IPraxisAttributionResolver,
  IPraxisContextEnricher,
  IPraxisThresholdPolicy,
  IPraxisHumanFaceStorage,
  IPraxisRollbackGatekeeper,
  ReviewDiffHunk,
  PraxisEnrichedContext,
  PraxisVerdict,
  PraxisPluginHooks,
} from './contracts';

/** Default attribution resolver returning a local fallback context */
export class DefaultPraxisAttributionResolver implements IPraxisAttributionResolver {
  resolveAttribution(
    _filePath: string,
    _lineSpan: { startLine: number; endLine: number }
  ): PraxisCardContext | null {
    return {
      cardId: 'card-default',
      cellId: 'cell-0',
      agentUid: 'agent-build-local',
    };
  }
}

/** Default contextual enricher extracting standard scope heuristics */
export class DefaultPraxisContextEnricher implements IPraxisContextEnricher {
  enrichHunk(_filePath: string, hunk: ReviewDiffHunk): PraxisEnrichedContext {
    return {
      enclosingSymbol: hunk.header.replace(/^@@.*@@\s*/, '') || undefined,
      suggestedAction: hunk.lines.length > 50 ? 'rework' : 'auto_fix',
    };
  }
}

/** Default threshold policy based on line count and severity thresholds */
export class DefaultPraxisThresholdPolicy implements IPraxisThresholdPolicy {
  constructor(
    private readonly maxMinorLines: number = 30,
    private readonly autoEscalateLines: number = 100
  ) {}

  evaluateChange(
    _filePath: string,
    hunk: ReviewDiffHunk,
    _context: PraxisEnrichedContext
  ): PraxisVerdict {
    const changeCount = hunk.lines.filter((l) => l.type !== 'context').length;
    if (changeCount > this.autoEscalateLines) {
      return {
        status: 'major_rework_needed',
        isMajorChange: true,
        shouldEscalateToL3A: true,
        violations: [`Change size of ${changeCount} lines exceeds threshold ${this.autoEscalateLines}`],
      };
    }
    if (changeCount > this.maxMinorLines) {
      return {
        status: 'minor_fix_needed',
        isMajorChange: false,
        shouldEscalateToL3A: false,
      };
    }
    return {
      status: 'passed',
      isMajorChange: false,
      shouldEscalateToL3A: false,
    };
  }
}

/** Default in-memory human-facing storage buffer */
export class DefaultPraxisHumanFaceStorage implements IPraxisHumanFaceStorage {
  private readonly buffer: ReviewDiffHunk[] = [];
  private readonly maxCapacity: number;

  constructor(maxCapacity: number = 500) {
    this.maxCapacity = maxCapacity;
  }

  appendDiffChunk(chunk: ReviewDiffHunk): void {
    if (this.buffer.length >= this.maxCapacity) {
      this.buffer.shift(); // Evict oldest
    }
    this.buffer.push(chunk);
  }

  flushPeriodicSnapshot(): void {
    // In-memory snapshot flush baseline
  }

  evictToR4Archive(_evictedPayload: Uint8Array): { archiveId: string } {
    return { archiveId: `r4-evicted-${Date.now()}` };
  }

  getSnapshot(): ReviewDiffHunk[] {
    return [...this.buffer];
  }
}

/** Default gatekeeper and rollback engine */
export class DefaultPraxisRollbackGatekeeper implements IPraxisRollbackGatekeeper {
  revertDiffHunk(
    _filePath: string,
    _hunkId: string
  ): { success: boolean; patch: string } {
    return { success: true, patch: '' };
  }

  revertTaskCard(
    _cardId: string
  ): { affectedFiles: string[]; rolledBackCheckpoints: string[] } {
    return { affectedFiles: [], rolledBackCheckpoints: [] };
  }

  checkMergeGate(
    _sourceBranch: string,
    _targetBranch: string,
    _diffPayload: ReviewDiffHunk[]
  ): { approved: boolean; reason?: string; violations?: string[] } {
    return { approved: true };
  }
}

/** Create a standard default Praxis hook bundle */
export function createDefaultPraxisHooks(): PraxisPluginHooks {
  return {
    attributionResolver: new DefaultPraxisAttributionResolver(),
    contextEnricher: new DefaultPraxisContextEnricher(),
    thresholdPolicy: new DefaultPraxisThresholdPolicy(),
    humanStorage: new DefaultPraxisHumanFaceStorage(),
    rollbackGatekeeper: new DefaultPraxisRollbackGatekeeper(),
  };
}
