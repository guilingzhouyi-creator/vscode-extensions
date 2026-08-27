/**
 * Praxis Ecosystem Extension Contracts & SPI (Service Provider Interface).
 *
 * Designed specifically for the Praxis multi-agent/multi-cell architecture:
 * - Dynamic, generic card & cell contexts (non-fixed data payloads)
 * - AST & LSP contextual review enrichment
 * - Bypass threshold monitoring (minor auto-fix vs major L3A escalation)
 * - Human-facing circular buffer & R4 binary eviction storage SPI
 * - Card-linked fine-grained atomic rollback & fractal Git gatekeeping
 *
 * This module stays strictly TS-compiler-free for zero-overhead streaming.
 */

/** Generic dynamic payload for task cards in Praxis */
export interface PraxisCardContext<TMeta = Record<string, unknown>> {
  /** Unique task card identifier */
  cardId: string;
  /** Dynamic card type e.g. 'build' | 'review' | 'test' | 'refactor' */
  cardType?: string;
  /** Dynamic Cell identifier */
  cellId: string;
  /** Executing Agent UID */
  agentUid: string;
  /** Associated session checkpoint identifier */
  checkpointId?: string;
  /** Parent / dependency card identifiers for cascading rollback */
  parentCardIds?: string[];
  /** Dynamic Praxis custom metadata payload */
  customData?: TMeta;
}

/** Attributed diff line with provenance & reliability metrics */
export interface AttributedDiffLine<TMeta = Record<string, unknown>> {
  type: 'context' | 'insert' | 'delete';
  lineNoOld?: number;
  lineNoNew?: number;
  content: string;
  /** Provenance attribution metadata */
  attribution?: PraxisCardContext<TMeta>;
  /** Reliability & Quality Collection (RC) metrics */
  metrics?: {
    riskScore?: number;
    confidence?: number;
    associatedRules?: string[];
  };
}

/** Rich review-level diff hunk with AST & LSP semantic linkage */
export interface ReviewDiffHunk<TMeta = Record<string, unknown>> {
  hunkId: string;
  header: string;
  oldSpan: { startLine: number; lineCount: number };
  newSpan: { startLine: number; lineCount: number };
  /** Semantic AST / symbol scope context */
  astContext?: {
    enclosingSymbol?: string;
    symbolKind?: string;
    scopeRange?: { startLine: number; endLine: number };
    /** Downstream files affected by this change (reverse dependency closure) */
    impactFiles?: string[];
  };
  lines: AttributedDiffLine<TMeta>[];
  /** Review department verdict */
  reviewVerdict?: PraxisVerdict;
}

/** Change volume & review verdict */
export interface PraxisVerdict {
  status: 'passed' | 'minor_fix_needed' | 'major_rework_needed';
  isMajorChange: boolean;
  shouldEscalateToL3A: boolean;
  targetCallbackChannel?: string;
  suggestedPatch?: string;
  violations?: string[];
}

/** Enriched contextual data for Review Cell */
export interface PraxisEnrichedContext {
  enclosingSymbol?: string;
  symbolKind?: string;
  scopeRange?: { startLine: number; endLine: number };
  sharedCacheReferences?: Array<{ source: string; snippet: string }>;
  impactFiles?: string[];
  suggestedAction?: 'auto_fix' | 'rework' | 'escalate_l3a';
  extraContext?: Record<string, unknown>;
}

/** 1. Dynamic Identity & Card Attribution Provider SPI */
export interface IPraxisAttributionResolver<TMeta = Record<string, unknown>> {
  resolveAttribution(
    filePath: string,
    lineSpan: { startLine: number; endLine: number }
  ): Promise<PraxisCardContext<TMeta> | null> | PraxisCardContext<TMeta> | null;
}

/** 2. Contextual Review Enricher SPI */
export interface IPraxisContextEnricher {
  enrichHunk(
    filePath: string,
    hunk: ReviewDiffHunk
  ): Promise<PraxisEnrichedContext> | PraxisEnrichedContext;
}

/** 3. Bypass Threshold & Escalation Policy SPI */
export interface IPraxisThresholdPolicy {
  evaluateChange(
    filePath: string,
    hunk: ReviewDiffHunk,
    context: PraxisEnrichedContext
  ): Promise<PraxisVerdict> | PraxisVerdict;
}

/** 4. Human-Facing Ring Buffer & Eviction Storage SPI */
export interface IPraxisHumanFaceStorage {
  appendDiffChunk(chunk: ReviewDiffHunk): Promise<void> | void;
  flushPeriodicSnapshot(): Promise<void> | void;
  evictToR4Archive(evictedPayload: Uint8Array): Promise<{ archiveId: string }> | { archiveId: string };
}

/** 5. Card-Linked Rollback & Fractal Branch Gatekeeper SPI */
export interface IPraxisRollbackGatekeeper {
  revertDiffHunk(
    filePath: string,
    hunkId: string
  ): Promise<{ success: boolean; patch: string }> | { success: boolean; patch: string };

  revertTaskCard(
    cardId: string
  ): Promise<{ affectedFiles: string[]; rolledBackCheckpoints: string[] }> | { affectedFiles: string[]; rolledBackCheckpoints: string[] };

  checkMergeGate(
    sourceBranch: string,
    targetBranch: string,
    diffPayload: ReviewDiffHunk[]
  ): Promise<{ approved: boolean; reason?: string; violations?: string[] }> | { approved: boolean; reason?: string; violations?: string[] };
}

/** Composite bundle of all Praxis SPI hooks */
export interface PraxisPluginHooks<TMeta = Record<string, unknown>> {
  attributionResolver?: IPraxisAttributionResolver<TMeta>;
  contextEnricher?: IPraxisContextEnricher;
  thresholdPolicy?: IPraxisThresholdPolicy;
  humanStorage?: IPraxisHumanFaceStorage;
  rollbackGatekeeper?: IPraxisRollbackGatekeeper;
}
