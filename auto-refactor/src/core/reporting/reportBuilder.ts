/**
 * Module: Core Engine — Scan Report Builder
 * File Path: src/core/reporting/reportBuilder.ts
 * Architecture Role: Final aggregation stage turning per-file analyzer output into a ScanReport.
 * Dependencies & Triggers: ../types, ../config, ../cacheKey, ../scoring, ../memory,
 *   ../trajectory, ../intelligence, ../scanner/uncertaintyHelper, ../scanner/workerScheduler;
 *   invoked by Scanner.buildReport from every scan path (cold, warm, diff, in-process, worker).
 * Responsibilities: Count issues per severity/analyzer, group them per file, score each file and
 *   the project, upsert review-memory and trajectory records, and assemble the summary block.
 * Exit Semantics & Design Rationale: Pure aggregation apart from the review-memory upsert; the
 *   buffer is flushed exactly once at the end because a scan is the natural durability boundary,
 *   so an interrupted assembly can never persist a half-scored batch.
 */

import * as path from 'path';
import type {
    ActivatedReviewersSummary,
    FileMetric,
    Issue,
    ScanConfig,
    ScanReport,
    Severity,
} from '../types';
import { TOOL_NAME, TOOL_VERSION } from '../config';
import { sha256Hex } from '../cache-key';
import type { QualityScoreBreakdown } from '../scoring/scoringTypes';
import type { QualityScorer } from '../scoring/qualityScorer';
import type { ReviewMemoryManager } from '../memory/reviewMemory';
import type { ReviewMemoryRecord } from '../memory/types';
import { extractCodeDomains, computeAstDigest } from '../memory/domainFingerprint';
import type { ChangeTrajectoryManager } from '../trajectory/changeTrajectory';
import type { SymbolIndex } from '../intelligence/symbolIndex';
import type { LiteralIndex } from '../intelligence/literalIndex';
import { CallGraph } from '../intelligence/callGraph';
import { summarizeUncertainty } from './uncertaintySummary';
import { analyzerCoverage } from '../scanner/worker-scheduler';

/** Number of hex characters kept from a record hash to form the stored short revision id. */
const REVISION_ID_LENGTH = 16;

/** Default agent identity recorded when the config carries no explicit agent uid. */
const DEFAULT_AGENT_UID = 'default-agent';

/**
 * Scanner collaborators the report builder needs: the effective config plus the per-instance
 * scorers and cross-file stores filled during the scan.
 */
export interface ReportHost {
    config: ScanConfig;
    scorer: QualityScorer;
    reviewMemory: ReviewMemoryManager;
    trajectory: ChangeTrajectoryManager;
    symbolIndex: SymbolIndex;
    literalIndex: LiteralIndex;
    activatedReviewers: ActivatedReviewersSummary;
}

/** Severity and analyzer tallies derived from the aggregated issue list. */
interface IssueTallies {
    bySeverity: Record<Severity, number>;
    byAnalyzer: Record<string, number>;
}

/**
 * Tally issues per severity and per analyzer for the report summary.
 *
 * @param issues - Aggregated issues of this scan.
 * @returns Severity and analyzer counters, both zero-initialized.
 */
function tallyIssues(issues: Issue[]): IssueTallies {
    const bySeverity: Record<Severity, number> = { info: 0, warning: 0, error: 0 };
    const byAnalyzer: Record<string, number> = {};
    for (const it of issues) {
        bySeverity[it.severity]++;
        byAnalyzer[it.analyzer] = (byAnalyzer[it.analyzer] || 0) + 1;
    }
    return { bySeverity, byAnalyzer };
}

/**
 * Group issues by the file they were reported against.
 *
 * @param issues - Aggregated issues of this scan.
 * @returns Map keyed by file path; issues without a location are skipped.
 */
function groupIssuesByFile(issues: Issue[]): Map<string, Issue[]> {
    const byFile = new Map<string, Issue[]>();
    for (const it of issues) {
        const f = it.location?.file;
        if (!f) continue;
        const list = byFile.get(f);
        if (list) list.push(it);
        else byFile.set(f, [it]);
    }
    return byFile;
}

/**
 * Build the review-memory record persisted for one scored file.
 *
 * @param host - Report host carrying the config and the cross-file stores.
 * @param metric - Per-file metric of the scored file.
 * @param fileIssues - Issues reported against that file.
 * @param score - Quality breakdown produced by the scorer for that file.
 * @returns A record ready to be upserted into review memory.
 */
function buildMemoryRecord(
    host: ReportHost,
    metric: FileMetric,
    fileIssues: Issue[],
    score: QualityScoreBreakdown,
): ReviewMemoryRecord {
    const cfg = host.config;
    const lastAudited = Date.now();
    return {
        filePath: metric.file,
        fileHash: sha256Hex(metric.file + ':' + metric.lines),
        astDigest: computeAstDigest(undefined, metric.file),
        codeDomains: extractCodeDomains(undefined, '', fileIssues),
        ruleHits: fileIssues.map((it) => ({
            id: it.id,
            analyzer: it.analyzer,
            rule: it.rule,
            severity: it.severity,
            line: it.location?.start?.line ?? 1,
            message: it.message,
        })),
        qualityScores: score,
        lastAudited,
        revisionId: sha256Hex(metric.file + ':' + score.compositeScore + ':' + lastAudited).slice(
            0,
            REVISION_ID_LENGTH,
        ),
        agentUid: cfg.agentUid || DEFAULT_AGENT_UID,
        contextWindows: {
            imports: [],
            exports: [],
            layer: cfg.profile?.directorySemantics?.[path.dirname(metric.file)],
        },
        fixResults: [],
    };
}

/**
 * Upsert the review-memory record for one scored file and mirror it into the trajectory.
 *
 * @param host - Report host carrying the memory and trajectory managers.
 * @param metric - Per-file metric of the scored file.
 * @param fileIssues - Issues reported against that file.
 * @param score - Quality breakdown produced by the scorer for that file.
 */
function recordFileMemory(
    host: ReportHost,
    metric: FileMetric,
    fileIssues: Issue[],
    score: QualityScoreBreakdown,
): void {
    if (host.config.memory === false) return;
    const record = buildMemoryRecord(host, metric, fileIssues, score);
    host.reviewMemory.saveRecord(record);
    host.reviewMemory.evictStable(metric.file);
    host.trajectory.recordRevision(metric.file, {
        revisionId: record.revisionId,
        timestamp: record.lastAudited,
        agentUid: record.agentUid || DEFAULT_AGENT_UID,
        fileHash: record.fileHash,
        astDigest: record.astDigest,
        qualityScore: score,
        ruleHitIds: record.ruleHits.map((h) => h.id),
    });
}

/**
 * Score every scanned file and persist its review-memory/trajectory record.
 *
 * @param host - Report host carrying the scorer and the memory/trajectory managers.
 * @param fileMetrics - Per-file metric records of this scan.
 * @param issuesByFile - Issues grouped by file path.
 * @returns Per-file quality breakdowns keyed by file path.
 */
function collectFileQuality(
    host: ReportHost,
    fileMetrics: FileMetric[],
    issuesByFile: Map<string, Issue[]>,
): Record<string, QualityScoreBreakdown> {
    const fileQualityScores: Record<string, QualityScoreBreakdown> = {};
    for (const m of fileMetrics) {
        const fileIssues = issuesByFile.get(m.file) || [];
        const score = host.scorer.evaluateFile(m.file, fileIssues, m, host.config);
        fileQualityScores[m.file] = score;
        recordFileMemory(host, m, fileIssues, score);
    }
    return fileQualityScores;
}

/**
 * Assemble the summary block of the report, including coverage and index statistics.
 *
 * @param host - Report host carrying the config and the cross-file stores.
 * @param filesScanned - Total count of files scanned.
 * @param issues - Aggregated issues of this scan.
 * @param fileMetrics - Per-file metric records of this scan.
 * @param durationMs - Total scan duration in milliseconds.
 * @param tallies - Precomputed severity/analyzer counters.
 * @returns The summary object embedded in the final report.
 */
function buildSummary(
    host: ReportHost,
    filesScanned: number,
    issues: Issue[],
    fileMetrics: FileMetric[],
    durationMs: number,
    tallies: IssueTallies,
): ScanReport['summary'] {
    return {
        filesScanned,
        issuesTotal: issues.length,
        bySeverity: tallies.bySeverity,
        byAnalyzer: tallies.byAnalyzer,
        durationMs,
        symbolIndex: host.symbolIndex.stats(),
        literalIndex: host.literalIndex.stats(),
        callGraph: new CallGraph(host.symbolIndex).stats(),
        activatedReviewers: host.activatedReviewers,
        uncertainty: summarizeUncertainty(issues),
        ...analyzerCoverage(host.config, fileMetrics),
    };
}

/**
 * Build the unified ScanReport from scanned files, collected issues, and metrics.
 *
 * A scan is the natural durability boundary for review memory: the records are upserted while
 * the report is assembled, so the buffered audits are written (and the log compacted) exactly
 * once here, at the end — flushing at the start would have written the PREVIOUS scan's batch and
 * left this one in memory.
 *
 * @param host - Report host carrying the config, scorer, stores, and memory managers.
 * @param filesScanned - Total count of files scanned.
 * @param issues - Aggregated issues list.
 * @param fileMetrics - Per-file metric records.
 * @param durationMs - Total scan duration in milliseconds.
 * @returns Assembled ScanReport structure.
 */
export function buildScanReport(
    host: ReportHost,
    filesScanned: number,
    issues: Issue[],
    fileMetrics: FileMetric[],
    durationMs: number,
): ScanReport {
    const cfg = host.config;
    const tallies = tallyIssues(issues);
    const issuesByFile = groupIssuesByFile(issues);
    const fileQualityScores = collectFileQuality(host, fileMetrics, issuesByFile);
    const projectQualityScore = host.scorer.evaluateFile('PROJECT_OVERALL', issues, null, cfg);
    host.reviewMemory.flush();
    return {
        tool: TOOL_NAME,
        version: TOOL_VERSION,
        generatedAt: new Date().toISOString(),
        root: path.resolve(cfg.root),
        config: cfg,
        summary: buildSummary(host, filesScanned, issues, fileMetrics, durationMs, tallies),
        issues,
        fileMetrics,
        qualityScore: projectQualityScore,
        fileQualityScores,
    };
}
