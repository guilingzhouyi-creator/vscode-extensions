/**
 * Module: Core Engine — Scan Report Finalization Pipeline
 * File Path: src/core/reporting/reportFinalizer.ts
 * Architecture Role: Post-scan enrichment and validation pipeline for raw ScanReport outputs;
 *   applies reasoned suppressions, global passes, and ratchet comparison.
 * Dependencies & Triggers: fs, ../types, ../config, ../logger, ../fileDiscovery,
 *   ../dependencyGraph, and ../analyzer; called by api.scan, scanWarm, scanDiff, and scanAndRender.
 * Responsibilities: Run global cross-file passes (import cycles, literal clusters, error flow),
 *   index and match suppressions, recalculate summary counters, and apply baseline ratchets.
 * Exit Semantics & Design Rationale: Finalization is idempotent via a non-enumerable symbol flag;
 *   mutates report in-place for performance and recomputes summary metrics consistently.
 */

import * as fs from 'fs';
import type { ScanConfig, ScanReport, Issue, SuppressionRule } from '../types';
import type { Scanner } from '../analyzer';
import { summarizeUncertainty } from './uncertaintySummary';
import type { Logger } from '../logger';
import { globToRegExp } from '../fileDiscovery';
import { runCyclePass } from '../dependencyGraph';
import {
    BASELINE_GRANULARITY_GROUPED,
    groupCounts,
    handleBaselineUpdate,
    handleBaselineRatchet,
} from './baselineManager';

export { BASELINE_GRANULARITY_GROUPED, groupCounts };

/** Post-scan scope that sees the complete module set, so cross-file passes are allowed. */
export const POST_SCAN_SCOPE_FULL = 'full';

/** Post-scan scope limited to a changed-file subset, so cross-file passes are skipped. */
export const POST_SCAN_SCOPE_INCREMENTAL = 'incremental';

/** Post-scan scope: a full scan may use cross-file facts; an incremental one may not. */
export type PostScanScope = typeof POST_SCAN_SCOPE_FULL | typeof POST_SCAN_SCOPE_INCREMENTAL;

const FINALIZED = Symbol('auto-refactor:finalized');

/**
 * Recompute aggregate severity counts, totals, and uncertainty for a modified report.
 *
 * @param report - Report whose summary aggregates should be refreshed.
 */
export function recomputeSummary(report: ScanReport): void {
    const by = { info: 0, warning: 0, error: 0 };
    for (const i of report.issues) by[i.severity]++;
    report.summary.bySeverity = by;
    report.summary.issuesTotal = report.issues.length;
    report.summary.uncertainty = summarizeUncertainty(report.issues);
}

function checkEmptyIncludeGlobs(report: ScanReport, warnings: string[]): void {
    if (report.summary.filesScanned === 0) {
        warnings.push(
            'include globs matched 0 files — declared analyzers cannot fire; check include/exclude and the scanned root',
        );
    }
}

async function applyDependencyGraphPass(
    report: ScanReport,
    config: ScanConfig,
    logger: Logger,
    reportScanner: Scanner | null,
    scope: PostScanScope,
    warnings: string[],
    postScanPasses: string[],
): Promise<void> {
    const dgDecl =
        scope === POST_SCAN_SCOPE_FULL ? config.analyzers['dependency-graph'] : undefined;
    if (scope !== POST_SCAN_SCOPE_FULL) {
        warnings.push(
            'incremental scope: cross-file passes (import cycles / unused exports) are skipped — run a full scan for those signals',
        );
    }
    if (!dgDecl?.enabled) return;

    postScanPasses.push('dependency-graph');
    const prebuilt = reportScanner ? reportScanner.getDependencyGraph() : null;
    const covered = prebuilt !== null && prebuilt.getModules().length >= report.fileMetrics.length;
    const cycle = await runCyclePass(report, config, logger, covered ? prebuilt : null);

    if (!covered && prebuilt !== null) {
        warnings.push('dependency-graph: 扫描图覆盖不全（缓存命中路径），回退重读建图');
    }
    report.issues.push(...cycle.issues);
    warnings.push(...cycle.warnings);
    recomputeSummary(report);
    if (cycle.issues.length > 0) {
        logger.info(`dependency-graph: ${cycle.issues.length} import-cycle issue(s)`);
    }
}

function applyLiteralClustersPass(
    report: ScanReport,
    config: ScanConfig,
    logger: Logger,
    reportScanner: Scanner | null,
    scope: PostScanScope,
    warnings: string[],
    postScanPasses: string[],
): void {
    const litDecl = scope === POST_SCAN_SCOPE_FULL ? config.analyzers['constants'] : undefined;
    const litOpts = litDecl?.options as Record<string, unknown> | undefined;
    if (!litDecl?.enabled || litOpts?.['crossFileLiteralClusters'] !== true) return;

    postScanPasses.push('literal-clusters');
    if (reportScanner === null) {
        warnings.push('literal-clusters: 缓存命中路径没有共享字面量索引，跳过（请执行完整扫描）');
        return;
    }
    const clusterIssues = reportScanner.getLiteralClusterIssues();
    report.issues.push(...clusterIssues);
    recomputeSummary(report);
    if (clusterIssues.length > 0) {
        logger.info(
            `literal-clusters: ${clusterIssues.length} cross-file literal cluster issue(s)`,
        );
    }
}

function applyErrorFlowPass(
    report: ScanReport,
    config: ScanConfig,
    logger: Logger,
    reportScanner: Scanner | null,
    scope: PostScanScope,
    warnings: string[],
    postScanPasses: string[],
): void {
    const errorDecl = scope === POST_SCAN_SCOPE_FULL ? config.analyzers['hygiene'] : undefined;
    const errorOpts = errorDecl?.options as Record<string, unknown> | undefined;
    if (!errorDecl?.enabled || errorOpts?.['errorPropagation'] !== true) return;

    postScanPasses.push('error-flow');
    if (reportScanner === null) {
        warnings.push('error-flow: 缓存命中路径没有共享调用图索引，跳过（请执行完整扫描）');
        return;
    }
    const errorIssues = reportScanner.getErrorFlowIssues(errorOpts);
    report.issues.push(...errorIssues);
    recomputeSummary(report);
    if (errorIssues.length > 0) {
        logger.info(`error-flow: ${errorIssues.length} error propagation chain issue(s)`);
    }
}

function applySemanticComplexityPass(
    report: ScanReport,
    config: ScanConfig,
    logger: Logger,
    reportScanner: Scanner | null,
    scope: PostScanScope,
    warnings: string[],
    postScanPasses: string[],
): void {
    const cpxDecl = scope === POST_SCAN_SCOPE_FULL ? config.analyzers['complexity'] : undefined;
    const cpxOpts = cpxDecl?.options as Record<string, unknown> | undefined;
    if (!cpxDecl?.enabled || cpxOpts?.['checkCrossFunctionComplexity'] !== true) return;

    postScanPasses.push('semantic-complexity');
    if (reportScanner === null) {
        warnings.push(
            'semantic-complexity: 缓存命中路径没有共享调用图索引，跳过（请执行完整扫描）',
        );
        return;
    }
    const cpxIssues = reportScanner.getSemanticComplexityIssues(cpxOpts);
    report.issues.push(...cpxIssues);
    recomputeSummary(report);
    if (cpxIssues.length > 0) {
        logger.info(`semantic-complexity: ${cpxIssues.length} cross-function complexity issue(s)`);
    }
}

interface SuppressionIndex {
    analyzerCandidates: Map<string, SuppressionRule[]>;
    generalOnly: SuppressionRule[];
    fileMatchers: Map<SuppressionRule, RegExp>;
}

function buildSuppressionIndex(suppressions: SuppressionRule[]): SuppressionIndex {
    const byAnalyzer = new Map<string, SuppressionRule[]>();
    const general: SuppressionRule[] = [];
    const orderIdx = new Map<SuppressionRule, number>();
    const fileMatchers = new Map<SuppressionRule, RegExp>();

    suppressions.forEach((s, i) => {
        orderIdx.set(s, i);
        if (s.matchFile) {
            fileMatchers.set(s, globToRegExp(s.matchFile.replace(/\\/g, '/')));
        }
        if (s.matchAnalyzer) {
            const bucket = byAnalyzer.get(s.matchAnalyzer) ?? [];
            bucket.push(s);
            byAnalyzer.set(s.matchAnalyzer, bucket);
        } else {
            general.push(s);
        }
    });

    const analyzerCandidates = new Map<string, SuppressionRule[]>();
    for (const analyzer of byAnalyzer.keys()) {
        analyzerCandidates.set(
            analyzer,
            [...(byAnalyzer.get(analyzer) ?? []), ...general].sort(
                (a, b) => (orderIdx.get(a) ?? 0) - (orderIdx.get(b) ?? 0),
            ),
        );
    }
    const generalOnly = [...general].sort(
        (a, b) => (orderIdx.get(a) ?? 0) - (orderIdx.get(b) ?? 0),
    );
    return { analyzerCandidates, generalOnly, fileMatchers };
}

function matchSuppression(issue: Issue, index: SuppressionIndex): SuppressionRule | undefined {
    const symbol =
        typeof issue.detail?.function === 'string'
            ? issue.detail.function
            : typeof issue.detail?.name === 'string'
              ? issue.detail.name
              : '';
    const candidates = index.analyzerCandidates.get(issue.analyzer) ?? index.generalOnly;
    return candidates.find(
        (s) =>
            (!s.matchFile ||
                index.fileMatchers.get(s)!.test(issue.location.file.replace(/\\/g, '/'))) &&
            (!s.matchRule || issue.rule === s.matchRule) &&
            (!s.matchSymbol || symbol === s.matchSymbol || symbol.endsWith('.' + s.matchSymbol)),
    );
}

function applySuppressions(report: ScanReport, suppressions: SuppressionRule[]): number {
    if (suppressions.length === 0) return 0;
    const index = buildSuppressionIndex(suppressions);
    let suppressedCount = 0;
    for (const issue of report.issues) {
        const hit = matchSuppression(issue, index);
        if (hit) {
            suppressedCount++;
            issue.suppression = { reason: hit.reason, downgraded: !!hit.downgradeTo };
            if (hit.downgradeTo) issue.severity = hit.downgradeTo;
        }
    }
    recomputeSummary(report);
    return suppressedCount;
}

async function finalizeBaseline(
    report: ScanReport,
    config: ScanConfig,
    options: {
        baseline?: string;
        updateBaseline?: string;
        baselineGranularity?: string;
    },
    logger: Logger,
    postScanPasses: string[],
): Promise<void> {
    const granularity = options.baselineGranularity || config.baselineGranularity || 'id';
    const hasBaselineFile = Boolean(options.baseline && fs.existsSync(options.baseline));
    if (options.updateBaseline || hasBaselineFile) {
        postScanPasses.push('baseline');
    }
    if (options.updateBaseline) {
        await handleBaselineUpdate(report, options.updateBaseline, granularity, logger);
    }
    if (options.baseline) {
        await handleBaselineRatchet(report, options.baseline, logger);
    }
}

/**
 * Post-scan pipeline enriching and finalizing a raw ScanReport.
 *
 * @param report - Raw report to finalize in-place.
 * @param config - Resolved scan configuration.
 * @param options - API options providing baseline knobs.
 * @param options.baseline - Baseline file to ratchet the report against, when supplied.
 * @param options.updateBaseline - Baseline file to rewrite with the current report, when supplied.
 * @param options.baselineGranularity - Grouping granularity used for baseline comparisons.
 * @param logger - Logger instance for operational telemetry.
 * @param reportScanner - Scanner that executed the scan, or null if warm/remote.
 * @param scope - Post-scan scope: full allows cross-file passes; incremental skips them.
 * Concurrency: reentrant, idempotent async execution; safe for single-threaded runtime.
 */
export async function finalizeReport(
    report: ScanReport,
    config: ScanConfig,
    options: {
        baseline?: string;
        updateBaseline?: string;
        baselineGranularity?: string;
    },
    logger: Logger,
    reportScanner: Scanner | null,
    scope: PostScanScope = POST_SCAN_SCOPE_FULL,
): Promise<void> {
    if ((report as unknown as Record<symbol, boolean>)[FINALIZED]) return;
    (report as unknown as Record<symbol, boolean>)[FINALIZED] = true;
    const postScanPasses: string[] = [];

    const warnings: string[] = [...(report.summary.warnings ?? [])];
    checkEmptyIncludeGlobs(report, warnings);

    await applyDependencyGraphPass(
        report,
        config,
        logger,
        reportScanner,
        scope,
        warnings,
        postScanPasses,
    );
    applyLiteralClustersPass(
        report,
        config,
        logger,
        reportScanner,
        scope,
        warnings,
        postScanPasses,
    );
    applyErrorFlowPass(report, config, logger, reportScanner, scope, warnings, postScanPasses);
    applySemanticComplexityPass(
        report,
        config,
        logger,
        reportScanner,
        scope,
        warnings,
        postScanPasses,
    );

    postScanPasses.push('suppressions');
    const suppressedCount = applySuppressions(report, config.suppressions ?? []);
    report.summary.suppressedCount = suppressedCount;
    report.summary.postScanPasses = postScanPasses;
    if (warnings.length > 0) report.summary.warnings = warnings;

    await finalizeBaseline(report, config, options, logger, postScanPasses);
}
