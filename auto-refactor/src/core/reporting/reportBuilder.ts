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
import { TOOL_NAME, TOOL_VERSION } from '../config/config';
import { sha256Hex } from '../cache-key';
import type { QualityScoreBreakdown } from '../scoring/scoringTypes';
import type { QualityScorer } from '../scoring/qualityScorer';
import { synthesizeStaticQualityVector } from '../scoring/static-quality-model';
import { computeDynamicQualityVector } from '../dynamic/dynamic-quality-scorer';
import {
    computeUnifiedQualityScore,
    type GovernanceProjectProfile,
} from '../scoring/fusion-scorer';
import type { ReviewMemoryManager } from '../memory/reviewMemory';
import type { ReviewMemoryRecord } from '../memory/types';
import { extractCodeDomains, computeAstDigest } from '../memory/domainFingerprint';
import type { ChangeTrajectoryManager } from '../trajectory/changeTrajectory';
import type { SymbolIndex } from '../intelligence/symbolIndex';
import type { LiteralIndex } from '../intelligence/literalIndex';
import { CallGraph } from '../intelligence/callGraph';
import { summarizeUncertainty } from './uncertaintySummary';
import { analyzerCoverage } from '../scanner/worker-scheduler';
import { evaluateProjectAutonomy } from '../scoring/autonomy-scorer';

/** Number of hex characters kept from a record hash to form the stored short revision id. */
const REVISION_ID_LENGTH = 16;

/** Stable stand-in for a composite that was not measured, used inside revision identity. */
const UNMEASURED_TOKEN = 'unmeasured';

/** Default agent identity recorded when the config carries no explicit agent uid. */
const DEFAULT_AGENT_UID = 'default-agent';

const MATURITY_INDUSTRIAL = 'industrial';
const MATURITY_DEMO = 'demo';
const MATURITY_PROTOTYPE = 'prototype';
const STAGE_INDUSTRIAL_INFRA = 'industrial_infrastructure';
const STAGE_PROTOTYPE = 'prototype';
const STAGE_PRODUCTION = 'production';

const SCALE_ENTERPRISE = 'enterprise';
const SCALE_GRADE_LARGE = 'large';
const SCALE_GRADE_MEDIUM = 'medium';
const SCALE_MASSIVE = 'massive';
const SCALE_LARGE = 'large';
const SCALE_MEDIUM = 'medium';
const SCALE_SMALL = 'small';

const ARCHETYPE_LIBRARY = 'library';
const ARCHETYPE_GAME = 'game';
const ARCHETYPE_WEB = 'web';
const DOMAIN_CORE_FRAMEWORK = 'core_framework';
const DOMAIN_ALGORITHM_LIB = 'algorithm_lib';
const DOMAIN_BUSINESS_APP = 'business_app';

const DEFAULT_PERFECT_SCORE = 100.0;

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
 * Context parameters required to build the scan summary section.
 */
export interface BuildSummaryContext {
    readonly host: ReportHost;
    readonly filesScanned: number;
    readonly issues: Issue[];
    readonly fileMetrics: FileMetric[];
    readonly durationMs: number;
    readonly tallies: IssueTallies;
}

/**
 * Context parameters required to build the unified ScanReport.
 */
export interface BuildScanReportContext {
    readonly host: ReportHost;
    readonly filesScanned: number;
    readonly issues: Issue[];
    readonly fileMetrics: FileMetric[];
    readonly durationMs: number;
}

/**
 * Tally issues per severity and per analyzer for the report summary.
 *
 * @param issues - Aggregated issues of this scan.
 * @returns Severity and analyzer counters, both zero-initialized.
 */
function computeTallyIssues(issues: Issue[]): IssueTallies {
    const bySeverity: Record<Severity, number> = { info: 0, warning: 0, error: 0 };
    const byAnalyzer: Record<string, number> = {};
    for (const issueItem of issues) {
        bySeverity[issueItem.severity]++;
        byAnalyzer[issueItem.analyzer] = (byAnalyzer[issueItem.analyzer] || 0) + 1;
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
    const issuesByFileMap = new Map<string, Issue[]>();
    for (const issueItem of issues) {
        const filePath = issueItem.location?.file;
        if (!filePath) continue;
        const list = issuesByFileMap.get(filePath);
        if (list) list.push(issueItem);
        else issuesByFileMap.set(filePath, [issueItem]);
    }
    return issuesByFileMap;
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
    const calculatedFileHash = sha256Hex(metric.file + ':' + metric.lines);
    const astDigest = computeAstDigest(undefined, metric.file);
    const codeDomains = extractCodeDomains(undefined, '', fileIssues);
    const revisionHash = sha256Hex(
        metric.file +
            ':' +
            (Number.isFinite(score.compositeScore) ? score.compositeScore : UNMEASURED_TOKEN) +
            ':' +
            lastAudited,
    );

    return {
        filePath: metric.file,
        fileHash: calculatedFileHash,
        astDigest,
        codeDomains,
        ruleHits: fileIssues.map((issueItem) => ({
            id: issueItem.id,
            analyzer: issueItem.analyzer,
            rule: issueItem.rule,
            severity: issueItem.severity,
            line: issueItem.location?.start?.line ?? 1,
            message: issueItem.message,
        })),
        qualityScores: score,
        lastAudited,
        // An unmeasured composite is NaN. String-interpolating it produced a revision id
        // containing "NaN", which is not a stable identity: two identical unmeasured states
        // are indistinguishable from two different ones. A fixed token keeps the id
        // deterministic while still distinguishing measured from unmeasured revisions.
        revisionId: revisionHash.slice(0, REVISION_ID_LENGTH),
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

const EMPTY_FILE_ISSUES: readonly Issue[] = Object.freeze([]);

/**
 * Resolves the issue array for a given file from the grouped issues map.
 *
 * @param issuesByFile - Issues grouped by file path.
 * @param file - File path to look up.
 * @returns Array of issues found for the file.
 */
function resolveFileIssues(issuesByFile: Map<string, Issue[]>, file: string): Issue[] {
    const list = issuesByFile.get(file);
    return list !== undefined ? list : (EMPTY_FILE_ISSUES as unknown as Issue[]);
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
        const fileIssues = resolveFileIssues(issuesByFile, m.file);
        const score = host.scorer.evaluateFile(m.file, fileIssues, m, host.config);
        fileQualityScores[m.file] = score;
        recordFileMemory(host, m, fileIssues, score);
    }
    return fileQualityScores;
}

/**
 * Assemble the summary block of the report, including coverage and index statistics.
 *
 * @param params - Summary execution context.
 * @returns The summary object embedded in the final report.
 */
function buildSummary(params: BuildSummaryContext): ScanReport['summary'] {
    const uncertaintySummary = summarizeUncertainty(params.issues);
    return {
        filesScanned: params.filesScanned,
        issuesTotal: params.issues.length,
        bySeverity: params.tallies.bySeverity,
        byAnalyzer: params.tallies.byAnalyzer,
        durationMs: params.durationMs,
        symbolIndex: params.host.symbolIndex.stats(),
        literalIndex: params.host.literalIndex.stats(),
        callGraph: new CallGraph(params.host.symbolIndex).stats(),
        activatedReviewers: params.host.activatedReviewers,
        uncertainty: uncertaintySummary,
        ...analyzerCoverage(params.host.config, params.fileMetrics),
    };
}

/**
 * Map ScanConfig profile, scale, maturity, and archetype to GovernanceProjectProfile.
 */
function resolveGovernanceProfile(cfg: ScanConfig): GovernanceProjectProfile {
    const stage: GovernanceProjectProfile['stage'] =
        cfg.maturityTier === MATURITY_INDUSTRIAL
            ? STAGE_INDUSTRIAL_INFRA
            : cfg.maturityTier === MATURITY_DEMO || cfg.maturityTier === MATURITY_PROTOTYPE
              ? STAGE_PROTOTYPE
              : STAGE_PRODUCTION;

    const scale: GovernanceProjectProfile['scale'] =
        cfg.scaleGrade === SCALE_ENTERPRISE
            ? SCALE_MASSIVE
            : cfg.scaleGrade === SCALE_GRADE_LARGE
              ? SCALE_LARGE
              : cfg.scaleGrade === SCALE_GRADE_MEDIUM
                ? SCALE_MEDIUM
                : SCALE_SMALL;

    let domain: GovernanceProjectProfile['domain'] = DOMAIN_CORE_FRAMEWORK;
    if (cfg.archetype === ARCHETYPE_LIBRARY) domain = DOMAIN_ALGORITHM_LIB;
    else if (cfg.archetype === ARCHETYPE_GAME || cfg.archetype === ARCHETYPE_WEB)
        domain = DOMAIN_BUSINESS_APP;

    return { stage, scale, domain };
}

/**
 * Assembles the final unified ScanReport including summaries, quality scores, and issues.
 *
 * @param params - Scan report construction context.
 * @returns Fully constructed ScanReport object.
 */
export function buildScanReport(params: BuildScanReportContext): ScanReport {
    const host = params.host;
    const cfg = host.config;
    const tallies = computeTallyIssues(params.issues);
    const issuesByFile = groupIssuesByFile(params.issues);
    const fileQualityScores = collectFileQuality(host, params.fileMetrics, issuesByFile);
    const projectQualityScore = host.scorer.evaluateProject(
        fileQualityScores,
        params.fileMetrics,
        cfg,
        params.issues,
    );
    const staticVector = synthesizeStaticQualityVector(projectQualityScore.indices);
    const dynamicTelemetry = cfg.telemetryData;
    const dynamicVector = dynamicTelemetry
        ? computeDynamicQualityVector(dynamicTelemetry)
        : undefined;
    const triPlaneQuality = computeUnifiedQualityScore(
        staticVector,
        dynamicVector,
        DEFAULT_PERFECT_SCORE,
        resolveGovernanceProfile(cfg),
    );
    const autonomy = evaluateProjectAutonomy(
        params.fileMetrics,
        params.issues,
        cfg,
        undefined,
        host.symbolIndex,
    );

    host.reviewMemory.flush();
    const runnerToolName = TOOL_NAME;
    const runnerToolVersion = TOOL_VERSION;
    return {
        tool: runnerToolName,
        version: runnerToolVersion,
        generatedAt: new Date().toISOString(),
        root: path.resolve(cfg.root),
        config: cfg,
        summary: buildSummary({
            host,
            filesScanned: params.filesScanned,
            issues: params.issues,
            fileMetrics: params.fileMetrics,
            durationMs: params.durationMs,
            tallies,
        }),
        issues: params.issues,
        fileMetrics: params.fileMetrics,
        qualityScore: projectQualityScore,
        fileQualityScores,
        triPlaneQuality,
        autonomy,
    };
}
