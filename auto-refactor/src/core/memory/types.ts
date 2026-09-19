/**
 * Module: Core Engine — Review Memory Type Contracts
 * File Path: src/core/memory/types.ts
 * Architecture Role: Compile-time single source of truth for the review-memory subsystem:
 *   fingerprint, match-result and eviction-policy shapes shared across the codebase
 * Dependencies & Triggers: Imports Severity from ../types and QualityScoreBreakdown from
 *   ../scoring/scoringTypes; consumed by reviewMemory, domainFingerprint, semanticMatcher,
 *   trainingExporter, core/analyzer, core/pipeline/dualTrackPipeline, guidance generators and the
 *   public api re-export; type-only, so no runtime path is triggered
 * Responsibilities: Declare CodeDomainKind and CodeDomainSpan; CodeDomainFingerprint with
 *   domainId, semanticHash, cyclomaticComplexity, in-span ruleViolations and optional metric
 *   summary; ContextWindowAnchor and HistoricalFixResult; the canonical ReviewMemoryRecord with
 *   filePath, fileHash, astDigest, codeDomains, ruleHits, qualityScores, revisionId,
 *   contextWindows and fixResults plus optional agentUid, status, activeAnalyzers and
 *   overallScore; DomainMatchResult reuse flags; the MemoryEvictionPolicy limits contract
 * Exit Semantics & Design Rationale: Emits no JavaScript and cannot fail at runtime; optional
 *   fields (metricSummary, agentUid, status, overallScore) keep legacy serialized records
 *   admissible, while AST-free fingerprints make line-shift reuse cheap and deterministic.
 */
import type { Severity } from '../types';
import type { QualityScoreBreakdown } from '../scoring/scoringTypes';

/** Code domain classification within a source file */
export type CodeDomainKind = 'function' | 'method' | 'class' | 'struct' | 'module' | 'block';

/** 1-based line/column span for a code domain */
export interface CodeDomainSpan {
    startLine: number;
    endLine: number;
    startCol: number;
    endCol: number;
}

/**
 * Lightweight, indexable fingerprint of a single code domain (function, class, method).
 * Invariant to outer line-shifting when content inside domain is unchanged.
 */
export interface CodeDomainFingerprint {
    /** Unique domain identifier e.g. "function:calculateRate" or "class:Engine" */
    domainId: string;
    kind: CodeDomainKind;
    name: string;
    span: CodeDomainSpan;
    /** Semantic hash of the normalized AST structure (ignores whitespace & outer line shifts) */
    semanticHash: string;
    /** Local cyclomatic complexity of this domain */
    cyclomaticComplexity: number;
    /** Issues that occurred strictly within this domain */
    ruleViolations: Array<{
        rule: string;
        analyzer: string;
        severity: Severity;
        line: number;
        message: string;
    }>;
    /** Optional domain metric summary (lines, nesting) */
    metricSummary?: {
        lines: number;
        maxNesting: number;
    };
}

/** Contextual boundary anchors for a file or domain */
export interface ContextWindowAnchor {
    imports: string[];
    exports: string[];
    layer?: string;
    enclosingSymbol?: string;
}

/** Record of a historical fix attempt */
export interface HistoricalFixResult {
    patchId: string;
    description: string;
    timestamp: number;
    agentUid?: string;
    success: boolean;
    fixedRules: string[];
}

/**
 * The canonical ultra-compact Review Memory Record.
 * Stored in memory / disk cache post-scan; heavy ASTs are recycled.
 */
export interface ReviewMemoryRecord {
    /** Relative POSIX file path */
    filePath: string;
    /** SHA-256 of raw file bytes */
    fileHash: string;
    /** Semantic structural digest of normalized AST */
    astDigest: string;
    /** Domain-level fingerprints for fine-grained reuse */
    codeDomains: CodeDomainFingerprint[];
    /** Compact summary of all issues hit in this file */
    ruleHits: Array<{
        id: string;
        analyzer: string;
        rule: string;
        severity: Severity;
        domainId?: string;
        line: number;
        message: string;
    }>;
    /** 10-dimensional transparent quality scores */
    qualityScores: QualityScoreBreakdown;
    /** Last audit timestamp in ms */
    lastAudited: number;
    /** Stable revision ID */
    revisionId: string;
    /** Agent UID that performed or triggered the audit */
    agentUid?: string;
    /** Contextual boundary anchors */
    contextWindows: ContextWindowAnchor;
    /** Historical fix results */
    fixResults: HistoricalFixResult[];
    /** Speculative / confirmed / contaminated status */
    status?: 'APPROVED' | 'REJECTED' | 'CONTAMINATED';
    /**
     * Optional reason why this record was flagged as contaminated (e.g. from DeepTrack escalation).
     */
    contaminationReason?: string;
    /** Active analyzer IDs for this audit */
    activeAnalyzers?: string[];
    /** Cached overall score (0-100) */
    overallScore?: number;
}

/** Specific impact reason on an affected code domain */
export type DomainImpactReason = 'modified' | 'added' | 'deleted';

/** Result of semantic matching when a file has changes */
export interface DomainMatchResult {
    /** Domains that are byte/AST-identical and can be 100% reused */
    unaffectedDomains: CodeDomainFingerprint[];
    /** Domains that intersect with diff hunks and require selective re-audit */
    impactedDomains: Array<{
        domainId: string;
        name: string;
        span: CodeDomainSpan;
        reason: DomainImpactReason;
    }>;
    /** Whether the entire file content is byte-equal */
    isByteEqual: boolean;
    /** Whether all code domains are structurally identical despite whitespace/line shifts */
    isSemanticEqual: boolean;
    /** If the file only experienced line additions/deletions outside domains */
    isLineShiftOnly: boolean;
    /** Overall line delta if uniform line shift occurred */
    lineShiftDelta: number;
}

/** Memory eviction policy configuration */
export interface MemoryEvictionPolicy {
    /** Maximum number of file memory records in memory (default 5,000) */
    maxFilesInMemory: number;
    /** Maximum historical revisions to retain per file (scale-tuned) */
    maxRevisionsPerFile: number;
    /** Max retention time in days (default 14) */
    retentionDays: number;
    /** Persist memory to disk cache (.auto-refactor-cache/memory.jsonl) */
    enableDiskPersistence: boolean;
}
