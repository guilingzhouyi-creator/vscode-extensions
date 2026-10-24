/**
 * Module: Core Reporting — Compact Agent Schema (CAS v3.0) Contracts
 * File Path: src/core/reporting/compact-report-types.ts
 * Architecture Role: Wire-format contract for the token-frugal projection of a ScanReport;
 *   the single definition every producer (reporter, migrator, CLI) and consumer references.
 * Dependencies & Triggers: Type-only imports from ../types and ../scoring/scoringTypes; consumed
 *   by compact-report-migrator.ts, the reporter registry and the compact-schema suite.
 * Responsibilities:
 *   1. Declare the compact envelope: fingerprint, health summary, dimension vector, bottlenecks.
 *   2. Declare the positional issue vector that replaces one object per finding with one tuple.
 *   3. Declare the analyzer palette that keeps repeated analyzer names out of every vector.
 * Exit Semantics & Design Rationale: Types only; no runtime code and no I/O. Field names are
 *   deliberately short because every saved byte multiplies across hundreds of findings, while
 *   the tuple layout is positional so a single key list — not one per record — pays the
 *   structural cost. Semantic field names survive where a reader must interpret them unaided.
 */

import type { Issue, ScanReport } from '../types';
import type { QualityDimension } from '../scoring/scoringTypes';

/** Protocol discriminator written into every compact document; bump only on a breaking change. */
export const COMPACT_SCHEMA_ID = 'cas-v3';

/** Position of a dimension inside `CompactScanReport.dimensions` key set. */
export const COMPACT_DIMENSION_KEYS: Readonly<Record<QualityDimension, string>> = {
    architectureConsistency: 'arch',
    semanticPurity: 'sem',
    codeSecurity: 'sec',
    performanceEfficiency: 'perf',
    standardization: 'std',
    modernity: 'mod',
    maintainability: 'maint',
    commentQuality: 'doc',
    duplication: 'dup',
    techDebtRisk: 'debt',
};

/**
 * Numeric severity rank used in the positional vector.
 *
 * Rank order matches escalation order, so a consumer can filter with `sev >= 1` instead of
 * comparing three string values per finding.
 */
export const COMPACT_SEVERITY_CODE: Readonly<Record<string, number>> = {
    info: 0,
    warning: 1,
    error: 2,
};

/** Reverse mapping from the numeric rank back to the canonical severity label. */
export const COMPACT_SEVERITY_LABEL: Readonly<Record<number, string>> = {
    0: 'info',
    1: 'warning',
    2: 'error',
};

/** One aggregated deduction source, ordered by descending point loss. */
export interface CompactBottleneck {
    /** Rule that produced the deduction. */
    rule: string;
    /** Short dimension key the rule is charged against (see `COMPACT_DIMENSION_KEYS`). */
    dim: string;
    /** Points this rule consumed in its dimension, summed from the audit trail. */
    loss: number;
    /** Number of findings that contributed. */
    count: number;
}

/**
 * One finding as a positional tuple.
 *
 * Layout: `[rule, severityCode, "file:line", message, action|null, analyzerIndex|null]`.
 * `analyzerIndex` points into `CompactScanReport.pal`; hydration therefore rebuilds the
 * canonical issue id `${analyzer}:${rule}:${file}:${line}` without storing it per finding.
 */
export type CompactIssueVector = [
    rule: string,
    severityCode: number,
    location: string,
    message: string,
    action: string | null,
    analyzerIndex: number | null,
];

/** Aggregate counters mirroring `ScanSummary` without the instrumentation-only fields. */
export interface CompactCounts {
    /** Files scanned in the reporting run. */
    files: number;
    /** Findings carried in `vectors` plus any truncated remainder. */
    issues: number;
    /** Error-tier finding count over the whole report, not just the emitted vectors. */
    errors: number;
    /** Warning-tier finding count. */
    warns: number;
    /** Info-tier finding count. */
    info: number;
    /** Findings matched by a declarative suppression. */
    suppressed?: number;
}

/** Headline verdict block: score, grade and the counts a caller triages on. */
export interface CompactHealth {
    /** Composite score, or null when no dimension carried weight. */
    score: number | null;
    /** Letter grade as published by the scorer, including `N/A`. */
    grade: string;
    /** Share of total weight actually measured. */
    coverage?: number;
    /** Statistical confidence of the composite. */
    confidence?: number;
    /** Share of code written in-house (code autonomy index), when evaluated. */
    cai?: number;
}

/** Complete token-frugal projection of one scan. */
export interface CompactScanReport {
    /** Protocol discriminator: always `cas-v3`. */
    schema: typeof COMPACT_SCHEMA_ID;
    /** Tool name that produced the underlying report. */
    tool: string;
    /** Tool version that produced the underlying report. */
    version: string;
    /** ISO timestamp of the underlying report. */
    ts: string;
    /** Repository-relative scan root. */
    root: string;
    /** Overall verdict derived from unsuppressed severity counts. */
    verdict: 'PASS' | 'WARN' | 'BLOCK';
    /** Aggregate counters. */
    counts: CompactCounts;
    /** Headline quality block. */
    health: CompactHealth;
    /** Short dimension key to score; omitted keys were not evaluated. */
    dimensions: Record<string, number>;
    /** Highest-loss deduction sources, descending. */
    bottlenecks: CompactBottleneck[];
    /** Analyzer names referenced by `vectors` positionally. */
    pal: string[];
    /** Positional findings, highest severity first. */
    vectors: CompactIssueVector[];
    /** Anchor code slice per `"file:line"` location, only for blocking findings. */
    anchors?: Record<string, string>;
    /** Count of findings omitted by the emission cap. */
    truncated?: number;
    /** Config self-check notes carried over from the summary warnings. */
    notes?: string[];
}

/** Caller-tunable emission policy for the compact projection. */
export interface CompactReportOptions {
    /** Maximum vectors to emit; remainder is reported through `truncated`. */
    readonly maxVectors?: number;
    /** Maximum characters kept from each message before an ellipsis. */
    readonly maxMessageChars?: number;
    /** Maximum bottleneck rows to emit. */
    readonly maxBottlenecks?: number;
    /** Emit info-tier findings as well as warnings and errors. */
    readonly includeInfo?: boolean;
    /**
     * Optional anchor supplier for blocking findings.
     *
     * Called once per blocking vector; returning undefined leaves the location without an
     * anchor. Kept as a callback so this module stays free of filesystem access.
     */
    readonly anchorProvider?: (issue: Issue) => string | undefined;
}

/** Result of hydrating a compact document back into legacy report shape. */
export interface HydratedCompactReport {
    /** Fields that map one-to-one onto `ScanReport`; `issues` is fully reconstructed. */
    readonly report: Pick<ScanReport, 'tool' | 'version' | 'generatedAt' | 'root'> & {
        issues: Issue[];
        summary: {
            filesScanned: number;
            issuesTotal: number;
            bySeverity: Record<string, number>;
            durationMs: number;
        };
    };
    /** True when the document admitted dropping findings through `truncated`. */
    readonly partial: boolean;
}
