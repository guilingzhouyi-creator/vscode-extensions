/**
 * Module: Reporting — Finalization Input Contract
 * File Path: src/core/reporting/report-finalization-context.ts
 * Architecture Role: Normalize legacy and structured finalization calls at one boundary.
 * Dependencies & Triggers: Scanner, logger and report types; invoked by report finalization.
 * Responsibilities: Preserve defaults, fixed-source ownership and public option compatibility.
 * Exit Semantics & Design Rationale: Normalization performs no reads, writes or policy evaluation.
 */
import type { Scanner } from '../analyzer';
import type { Logger } from '../logger';
import type { ScanConfig, ScanReport } from '../types';

/** Post-scan scope that sees the complete module set, so cross-file passes are allowed. */
export const POST_SCAN_SCOPE_FULL = 'full';

/** Post-scan scope limited to a changed-file subset, so cross-file passes are skipped. */
export const POST_SCAN_SCOPE_INCREMENTAL = 'incremental';

/** Post-scan scope: a full scan may use cross-file facts; an incremental one may not. */
export type PostScanScope = typeof POST_SCAN_SCOPE_FULL | typeof POST_SCAN_SCOPE_INCREMENTAL;

/**
 * Options controlling the post-scan finalization passes.
 *
 * The name is historical — baseline ratchet settings were the first entries — but this is the
 * shared option bag `finalizeReport` receives from the API layer, so every post-scan artifact
 * path belongs here rather than in a second parallel struct the caller would have to keep in
 * sync. Field names match `ScanOptions` exactly so a caller's options object is assignable
 * without translation.
 */
export interface FinalizeBaselineOptions {
    baseline?: string;
    updateBaseline?: string;
    baselineGranularity?: string;
    baselineRatchetDown?: boolean;
    forceBaselineExpand?: boolean;
    /** Write the human review queue to this NDJSON path when set. */
    reviewQueue?: string;
    /**
     * Calibration corpus supplying per-rule outcome counts.
     *
     * Omitted by default, and that default is load-bearing: with no corpus every confidence is
     * the analyzer's own score, exactly as it was before calibration existed. A project that has
     * accumulated review outcomes points this at its own file and gets adjudicated posteriors
     * instead.
     */
    confidenceCorpus?: string;
}

/** Unified context structure aggregating parameters across report finalization passes. */
export interface FinalizeReportContext {
    report: ScanReport;
    config: ScanConfig;
    options: FinalizeBaselineOptions;
    logger: Logger;
    reportScanner?: Scanner | null;
    scope?: PostScanScope;
    /** Exact decoded snapshot inputs; presence forbids source fallback and external enrichment. */
    snapshotSource?: ReadonlyMap<string, string>;
}

/** Structured input plus the established positional signature. */
export type FinalizeReportArguments =
    | [context: FinalizeReportContext]
    | [
        report: ScanReport, config: ScanConfig, options: FinalizeBaselineOptions,
        logger: Logger, reportScanner?: Scanner | null, scope?: PostScanScope,
    ];

/**
 * Normalize legacy positional calls without changing their input defaults.
 * @param finalizeArguments - Structured context or established positional tuple.
 * @returns Normalized finalization context without reading external state.
 */
export function resolveFinalizeContext(
    finalizeArguments: FinalizeReportArguments,
): FinalizeReportContext {
    const firstArg = finalizeArguments[0];
    const isContextObject =
        finalizeArguments.length === 1 &&
        firstArg !== null &&
        typeof firstArg === 'object' &&
        'report' in firstArg &&
        'config' in firstArg;
    return isContextObject
        ? (firstArg as FinalizeReportContext)
        : {
            report: finalizeArguments[0] as ScanReport,
            config: finalizeArguments[1] as ScanConfig,
            options: finalizeArguments[2] as FinalizeBaselineOptions,
            logger: finalizeArguments[3] as Logger,
            reportScanner: finalizeArguments[4] ?? null,
            scope: finalizeArguments[5] ?? POST_SCAN_SCOPE_FULL,
        };
}
