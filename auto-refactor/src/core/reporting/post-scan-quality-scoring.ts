/**
 * Module: Core Engine — Post-Scan Quality Scoring & Tri-Plane Projection
 * File Path: src/core/reporting/post-scan-quality-scoring.ts
 * Architecture Role: Evaluates per-file and project quality breakdowns, tri-plane fusion
 *   vectors, project autonomy, and native governance syntheses after post-scan passes.
 * Dependencies & Triggers: qualityScorer, fusion-scorer, autonomy-scorer, post-scan-enrichment,
 *   post-scan-arbitration; invoked by reportFinalizer.finalizeReport when metrics need refresh.
 * Responsibilities: Detect dirty files invalidated by suppressions/clustering, recompute file and
 *   project scores, record historical snapshots, and synthesize tri-plane and governance signals.
 * Exit Semantics & Design Rationale: Mutates report scoring fields in place; omits historical
 *   persistence and host reads when operating on an isolated snapshot source map.
 */

import type { Issue, ScanConfig, ScanReport } from '../types';
import type { Scanner } from '../analyzer';
import type { Logger } from '../logger';
import type { QualityScoreBreakdown } from '../scoring/scoringTypes';
import { QualityScorer } from '../scoring/qualityScorer';
import { synthesizeStaticQualityVector } from '../scoring/static-quality-model';
import { computeDynamicQualityVector } from '../dynamic/dynamic-quality-scorer';
import { computeUnifiedQualityScore } from '../scoring/fusion-scorer';
import { evaluateProjectAutonomy } from '../scoring/autonomy-scorer';
import {
    recordHistoricalQualitySample,
    resolveHistoricalQualityScore,
} from '../scoring/rolling-sampling-governor';
import { syncAdaptiveSupervisorState, synthesizeNativeGovernance } from './post-scan-enrichment';
import { resolveGovernanceProfile, synthesizeProjectQuant } from './post-scan-arbitration';
import type { PostScanScope } from './report-finalization-context';

const EMPTY_ISSUES: readonly Issue[] = Object.freeze([]);

/** Parameters controlling post-scan quality score recalculation. */
export interface RefreshQualityScoresParams {
    readonly report: ScanReport;
    readonly config: ScanConfig;
    readonly reportScanner: Scanner | null;
    readonly scope: PostScanScope;
    readonly logger: Logger;
    readonly initialIssueCount?: number;
    readonly snapshotSource?: ReadonlyMap<string, string>;
}

function groupIssuesByFile(issues: readonly Issue[]): Map<string, Issue[]> {
    const issuesByFile = new Map<string, Issue[]>();
    for (const targetIssue of issues) {
        const filePath = targetIssue.location?.file;
        if (!filePath) continue;
        const fileGroup = issuesByFile.get(filePath);
        if (fileGroup) {
            fileGroup.push(targetIssue);
        } else {
            issuesByFile.set(filePath, [targetIssue]);
        }
    }
    return issuesByFile;
}

function collectDirtyFiles(report: ScanReport, initialIssueCount: number): Set<string> {
    const dirtyFiles = new Set<string>();
    const issues = report.issues;
    for (let i = 0; i < issues.length; i++) {
        const issue = issues[i];
        const file = issue.location?.file;
        if (!file) continue;
        if (
            i >= initialIssueCount ||
            issue.suppression !== undefined ||
            issue.clusteredInto !== undefined
        ) {
            dirtyFiles.add(file);
        }
    }
    return dirtyFiles;
}

function applyAutonomyScore(
    report: ScanReport,
    config: ScanConfig,
    reportScanner: Scanner | null,
): void {
    if (report.autonomy) return;
    report.autonomy = evaluateProjectAutonomy(
        report.fileMetrics ?? [],
        report.issues,
        config,
        reportScanner?.retainedSourceText() as Map<string, string> | undefined,
        reportScanner && typeof reportScanner.getSymbolIndex === 'function'
            ? reportScanner.getSymbolIndex()
            : undefined,
    );
}

async function refreshQualityProjections(
    params: RefreshQualityScoresParams,
    projectQualityScore: NonNullable<ScanReport['qualityScore']>,
): Promise<void> {
    const { report, config, reportScanner, scope, logger } = params;
    const fileMetrics = report.fileMetrics ?? [];
    const staticVector = synthesizeStaticQualityVector(projectQualityScore.indices);
    const dynamicTelemetry = config.telemetryData;
    const dynamicVector =
        dynamicTelemetry && dynamicTelemetry.isObserved !== false
            ? computeDynamicQualityVector(dynamicTelemetry)
            : undefined;
    const historicalScore = params.snapshotSource
        ? undefined
        : resolveHistoricalQualityScore(config);
    const supervisorWeights = params.snapshotSource
        ? undefined
        : await syncAdaptiveSupervisorState({
              config,
              scope,
              historicalScore,
              currentCompositeScore: projectQualityScore.compositeScore,
          });
    report.triPlaneQuality = computeUnifiedQualityScore(
        staticVector,
        dynamicVector,
        historicalScore,
        { ...resolveGovernanceProfile(config), supervisorWeights },
    );
    const totalEffectiveLines = fileMetrics.reduce(
        (acc, item) => acc + (item.nonBlankLines || 0),
        0,
    );
    if (!params.snapshotSource) {
        recordHistoricalQualitySample(
            config,
            projectQualityScore.compositeScore,
            totalEffectiveLines,
        );
    }
    projectQualityScore.quant = synthesizeProjectQuant(
        config,
        projectQualityScore,
        fileMetrics,
        report.issues,
    );
    if (!params.snapshotSource) applyAutonomyScore(report, config, reportScanner);
    report.governance = await synthesizeNativeGovernance({
        report,
        config,
        scope,
        contentByPath: params.snapshotSource ?? reportScanner?.retainedSourceText(),
        allowHostRead: params.snapshotSource === undefined,
        logger,
    });
}

/**
 * Recomputes quality scores, tri-plane vectors, and project autonomy indices.
 *
 * @param params - Context carrying report, resolved config, scanner, scope, and initial count.
 */
export async function refreshQualityScores(params: RefreshQualityScoresParams): Promise<void> {
    const { report, config, reportScanner, initialIssueCount = 0 } = params;
    const effectiveScorerArchetype = config.reviewProfile ?? config.archetype;
    const scorer =
        reportScanner && typeof reportScanner.getQualityScorer === 'function'
            ? reportScanner.getQualityScorer()
            : new QualityScorer(
                  config.scoringWeights as unknown as Record<string, number>,
                  effectiveScorerArchetype,
              );

    const existingScores = report.fileQualityScores;
    const dirtyFiles = existingScores ? collectDirtyFiles(report, initialIssueCount) : null;
    const issuesByFile = groupIssuesByFile(report.issues);
    const fileQualityScores: Record<string, QualityScoreBreakdown> = {};
    const fileMetrics = report.fileMetrics ?? [];

    const fallbackIssues = EMPTY_ISSUES as unknown as Issue[];
    for (const metric of fileMetrics) {
        const cached = existingScores?.[metric.file];
        if (cached && dirtyFiles && !dirtyFiles.has(metric.file)) {
            fileQualityScores[metric.file] = cached;
            continue;
        }
        const fileIssues = issuesByFile.get(metric.file) || fallbackIssues;
        fileQualityScores[metric.file] = scorer.evaluateFile(
            metric.file,
            fileIssues,
            metric,
            config,
        );
    }
    report.fileQualityScores = fileQualityScores;
    const projectQualityScore = scorer.evaluateProject(
        fileQualityScores,
        fileMetrics,
        config,
        report.issues,
    );
    report.qualityScore = projectQualityScore;
    await refreshQualityProjections(params, projectQualityScore);
}
