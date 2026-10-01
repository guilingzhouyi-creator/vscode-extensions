/**
 * Module: Core Trajectory — ELOC Accounting & Quality Trajectory Type Contracts
 * File Path: src/core/trajectory/eloc-types.ts
 * Architecture Role: Single source of truth for ELOC multi-tier accounting, AST block fingerprinting,
 *   semantic change classification, and compact quality trajectory ledger data structures.
 * Dependencies & Triggers: Pure type contract declarations; imported by semantic-delta-classifier,
 *   block-fingerprint-cache, quality-efficiency-engine, compact-ledger-store, and composite-quality-gate.
 * Exit Semantics: Compile-time types; pure zero-dependency definitions to prevent
 *   circular imports and maintain project neutrality.
 */

import type { QualityDimension } from '../scoring/scoringTypes';

/**
 * Four-tier orthogonal ELOC accounting counters.
 */
export interface ElocCounters {
    /** Cumulative computational throughput (sum of ELOC across all files scanned in all runs). */
    processed: number;
    /** Total unique effective logic lines covered in the codebase history (de-duplicated by AST block fingerprints). */
    unique: number;
    /** Physical changed effective logic lines (added + deleted + modified). */
    changed: number;
    /** Pure semantic effective logic lines (changed - relocated - cosmetic - boilerplate). */
    semantic: number;
    /** Lines of pure relocated entities (constants, functions, methods moved without semantic logic changes). */
    relocated: number;
    /** Lines of cosmetic non-semantic changes (formatting, comments, whitespace, styling). */
    cosmetic: number;
    /** Lines of trivial boilerplate or empty wrapper forwarders. */
    boilerplate: number;
    /** Added effective logic lines. */
    added: number;
    /** Deleted effective logic lines. */
    deleted: number;
    /** Modified effective logic lines. */
    modified: number;
}

/**
 * Structural category of an AST code block.
 */
export type AstBlockKind =
    | 'function'
    | 'method'
    | 'class'
    | 'interface'
    | 'type'
    | 'enum'
    | 'constant'
    | 'top-level-decl';

/**
 * Content-invariant structural fingerprint of an AST code block for de-duplication.
 */
export interface BlockFingerprint {
    /** Unique block identifier (filePath:startLine:name). */
    blockId: string;
    /** AST construct kind. */
    kind: AstBlockKind;
    /** Block or entity symbol name. */
    name: string;
    /** Normalized structural hash of AST sub-tree (invariant to pure whitespace/comments). */
    fingerprint: string;
    /** Effective logic lines contained in this block. */
    eloc: number;
    /** Relative file path. */
    filePath: string;
    /** Starting line number in source. */
    startLine: number;
    /** Ending line number in source. */
    endLine: number;
}

/**
 * Classification category for a code change slice.
 */
export type SemanticChangeCategory =
    | 'pure-semantic'
    | 'pure-relocation'
    | 'pure-cosmetic'
    | 'mixed'
    | 'unchanged';

/**
 * Granular analysis result of semantic delta classification for a single file or diff slice.
 */
export interface SemanticDeltaResult {
    /** Relative file path. */
    filePath: string;
    /** Overall classification category. */
    category: SemanticChangeCategory;
    /** Detailed ELOC accounting counters for this delta. */
    counters: ElocCounters;
    /** List of relocated entities detected in this change. */
    relocatedBlocks: {
        name: string;
        kind: AstBlockKind;
        oldLocation?: { file: string; line: number };
        newLocation: { file: string; line: number };
        eloc: number;
    }[];
    /** Explanatory rationales for the classification. */
    rationales: string[];
}

/**
 * Technical debt settlement and regression metrics for a revision change.
 */
export interface TechnicalDebtDelta {
    /** Points of new technical debt added. */
    addedDebtPoints: number;
    /** Points of existing technical debt resolved/cleared. */
    resolvedDebtPoints: number;
    /** Net technical debt cleared (resolved - added). Positive is good. */
    netDebtCleared: number;
    /** Number of new regression findings introduced. */
    regressionFindingsCount: number;
    /** Regression findings identifiers. */
    regressionFindingIds: string[];
}

/**
 * Comprehensive quality efficiency and yield metrics for a review or refactoring action.
 */
export interface TrajectoryQualityMetrics {
    /** Quality Efficiency of Delta: ΔQ_semantic / max(1, ELOC_semantic). */
    qed: number;
    /** Review Yield: (Debt_resolved + max(0, ΔQ)) / (ELOC_processed / 1000). */
    reviewYield: number;
    /** Regression Density: RegressionFindings / (ELOC_semantic / 1000). */
    regressionDensity: number;
    /** Net pure semantic composite quality score change (Before vs After). */
    deltaQSemantic: number;
    /** Baseline composite score before change. */
    beforeScore: number;
    /** Target composite score after change. */
    afterScore: number;
    /** 10-dimensional quality index vector after change. */
    scoreVector: number[];
    /** 10-dimensional quality index delta vector (After - Before). */
    dimensionDeltas: Partial<Record<QualityDimension, number>>;
    /** Associated technical debt delta. */
    debtDelta: TechnicalDebtDelta;
    /** Anti-gaming penalty points applied (0.0 means normal/no penalty). */
    gamingPenalty: number;
}

/**
 * Compact trajectory ledger record stored in NDJSON (< 350 bytes per entry).
 */
export interface CompactTrajectoryRecord {
    /** Epoch timestamp in milliseconds. */
    t: number;
    /** Git revision / commit hash or short SHA. */
    rev: string;
    /** Unique run identifier. */
    id: string;
    /** Target module or project domain. */
    mod: string;
    /** Agent or actor identifier (e.g. 'gemini-antigravity', 'human-dev'). */
    agent: string;
    /** Compact ELOC counters. */
    eloc: {
        proc: number;
        uniq: number;
        chg: number;
        sem: number;
        reloc: number;
        cosm: number;
    };
    /** Compact score summary. */
    score: {
        bef: number;
        aft: number;
        vec: number[];
        qed: number;
    };
    /** Compact debt summary. */
    debt: {
        add: number;
        res: number;
        reg: number;
    };
    /** Composite gate verdict. */
    gate: {
        pass: boolean;
        code: string;
    };
}

/**
 * Aggregated weekly or milestone summary record for tiered storage compression.
 */
export interface WeeklyTrajectorySummary {
    /** ISO week identifier (e.g. '2026-W40'). */
    weekId: string;
    /** Start epoch timestamp. */
    startMs: number;
    /** End epoch timestamp. */
    endMs: number;
    /** Total number of review runs aggregated. */
    totalRuns: number;
    /** Aggregate ELOC counters for the week. */
    eloc: {
        processedTotal: number;
        uniqueTotal: number;
        changedTotal: number;
        semanticTotal: number;
    };
    /** Average and min/max QED across runs. */
    qed: {
        mean: number;
        min: number;
        max: number;
    };
    /** Aggregate technical debt change. */
    debt: {
        totalAdded: number;
        totalResolved: number;
        totalRegressions: number;
        netYield: number;
    };
    /** Mean composite quality score at week end. */
    meanCompositeScore: number;
    /** Pass rate percentage of composite quality gate. */
    gatePassRate: number;
}
