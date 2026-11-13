/**
 * Module: Core Engine — Post-Scan Quantitative Synthesis & Arbitration Pass
 * File Path: src/core/reporting/post-scan-arbitration.ts
 * Architecture Role: Synthesizes quantitative architectural risk metrics (ADR-Q) and adjudicates
 *   findings into confidence tiers with human review queue projection.
 * Dependencies & Triggers: path, fs, finding-confidence-arbiter, finding-arbitration-batch,
 *   quantitative-risk-model, rolling-sampling-governor; called by reportFinalizer.
 * Responsibilities: Load rolling quality history, aggregate issue debts for quantitative risk
 *   evaluation, project calibrated model provenance, and write `report.summary.arbitration`.
 * Exit Semantics & Design Rationale: Fail-soft on arbitration errors (logs degraded notice);
 *   omits `model` provenance when no calibration observations exist.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { FileMetric, Issue, ScanConfig, ScanReport, ScanSummary } from '../types';
import type { Logger } from '../logger';
import type { QualityScoreBreakdown } from '../scoring/scoringTypes';
import { FindingConfidenceArbiter } from '../scoring/finding-confidence-arbiter';
import {
    countUncalibrated,
    resolveAdvisoryOnlyRules,
    resolveRuleTiers,
    stampAdjudicatedIssues,
} from '../scoring/finding-arbitration-batch';
import type { RuleCalibrationStats } from '../scoring/confidence-calibration';
import { buildConfidenceModelAsset } from '../scoring/confidence-model-asset';
import { buildReviewQueue, countNeedsHuman, writeReviewQueue } from './review-queue';
import {
    DEFAULT_CACHE_DIR,
    DEFAULT_STATE_FILENAME,
    RollingSamplingGovernor,
} from '../scoring/rolling-sampling-governor';
import type { FileDebtItem, QuantitativeRiskAssessment } from '../scoring/quantitative-risk-model';
import {
    DEFAULT_RISK_WINDOW_SIZE,
    evaluateQuantitativeRiskModel,
} from '../scoring/quantitative-risk-model';

const PASS_ARBITRATION = 'arbitration';

/** Minimal pass context required by finding arbitration. */
export interface ArbitrationPassContext {
    readonly report: ScanReport;
    readonly logger: Logger;
}

interface IssueDebtAggregates {
    readonly fileDebtsMap: Map<string, number>;
    readonly ruleCategoryCounts: Record<string, number>;
}

/** Loads empirical rolling quality scores from persistent cache. */
function loadRollingHistoryScores(config: ScanConfig, fallbackScore: number): number[] {
    try {
        const cacheDir = path.join(config.root || '.', DEFAULT_CACHE_DIR);
        const stateFile = path.join(cacheDir, DEFAULT_STATE_FILENAME);
        if (!fs.existsSync(stateFile)) {
            return [fallbackScore];
        }
        const governor = new RollingSamplingGovernor({ stateFilePath: stateFile });
        const samples = governor.getSamples();
        return samples.length > 0
            ? samples.map((sample) => sample.compositeScore)
            : [fallbackScore];
    } catch (error) {
        void error;
        return [fallbackScore];
    }
}

/** Aggregates issue counts and rule categories for spatial dispersion analysis. */
function aggregateIssueDebts(issues: Issue[]): IssueDebtAggregates {
    const fileDebtsMap = new Map<string, number>();
    const ruleCategoryCounts: Record<string, number> = {};

    for (const issue of issues) {
        const filePath = issue.location?.file || 'unknown';
        fileDebtsMap.set(filePath, (fileDebtsMap.get(filePath) || 0) + 1);

        const rulePrefix = (issue.rule || '').match(/^([A-Z]{2,4})-/)?.[1] || 'OTHER';
        ruleCategoryCounts[rulePrefix] = (ruleCategoryCounts[rulePrefix] || 0) + 1;
    }

    return { fileDebtsMap, ruleCategoryCounts };
}

/**
 * Synthesizes architecture dynamics and resilience quantitative indicators (ADR-Q)
 * from empirical continuous rolling sampling and file-level defect distribution.
 *
 * @param config - Resolved scan configuration.
 * @param projectQualityScore - Computed project quality score breakdown.
 * @param fileMetrics - Measured per-file metrics across the workspace.
 * @param issues - Final post-suppression report findings.
 * @returns Evaluated quantitative risk assessment.
 */
export function synthesizeProjectQuant(
    config: ScanConfig,
    projectQualityScore: QualityScoreBreakdown,
    fileMetrics: FileMetric[],
    issues: Issue[],
): QuantitativeRiskAssessment {
    const historyScores = loadRollingHistoryScores(config, projectQualityScore.compositeScore);
    const { fileDebtsMap, ruleCategoryCounts } = aggregateIssueDebts(issues);

    const fileDebtItems: FileDebtItem[] = fileMetrics.map((fm) => ({
        filePath: fm.file,
        remediationMinutes: (fileDebtsMap.get(fm.file) || 0) * 15,
        churn30d: 1.0,
        fanIn: fm.functions || 1.0,
    }));
    const fileDebtValues = fileMetrics.map((fm) => (fileDebtsMap.get(fm.file) || 0) * 15);
    const complexityValues = fileMetrics
        .map((fm) => fm.maxNestingDepth)
        .filter(
            (compVal): compVal is number => typeof compVal === 'number' && Number.isFinite(compVal),
        );
    const totalMinutes =
        projectQualityScore.technicalDebt?.totalRemediationMinutes ?? issues.length * 15;

    return evaluateQuantitativeRiskModel({
        financial: { totalRemediationMinutes: totalMinutes, fileDebts: fileDebtItems },
        risk: { historyScores, windowSize: DEFAULT_RISK_WINDOW_SIZE },
        inequality: { fileDebts: fileDebtValues, ruleCategoryCounts },
        stochastic: { historyScores, complexityValues },
    });
}

/** Projects the calibrated model asset onto summary provenance; omitted when stats are empty. */
function projectModelProvenance(stats: readonly RuleCalibrationStats[]): {
    model?: NonNullable<ScanSummary['arbitration']>['model'];
} {
    if (stats.length === 0) return {};
    const asset = buildConfidenceModelAsset(stats);
    return {
        model: {
            schema: asset.schema,
            digest: asset.digest,
            calibratedRuleCount: asset.calibratedRuleCount,
            observationCount: asset.observationCount,
        },
    };
}

/**
 * Runs finding arbitration, writes `report.summary.arbitration`, and emits human review queue.
 * Fail-soft on error so reporting failures never abort a completed scan.
 *
 * @param passContext - Minimal pass context carrying report and logger.
 * @param reviewQueuePath - Optional NDJSON path for the human review queue.
 * @param ruleCalibrationStats - Per-rule outcome counts for posterior calibration.
 */
export async function applyArbitrationPass(
    passContext: ArbitrationPassContext,
    reviewQueuePath: string | undefined,
    ruleCalibrationStats: readonly RuleCalibrationStats[],
): Promise<void> {
    const { report, logger } = passContext;
    try {
        const arbiter = new FindingConfidenceArbiter(
            ruleCalibrationStats.length > 0 ? { ruleCalibrationStats } : undefined,
        );
        const arbitration = arbiter.arbitrate(report.issues);
        stampAdjudicatedIssues(arbitration.findings);
        const advisoryOnlyRules = resolveAdvisoryOnlyRules(arbitration.findings);
        const ruleTiers = resolveRuleTiers(arbitration.findings);
        const queueRecords = buildReviewQueue(arbitration.findings);
        const reviewQueueCount = countNeedsHuman(queueRecords);

        report.summary.arbitration = {
            totalEvaluated: arbitration.totalEvaluated,
            prescriptiveCount: arbitration.prescriptiveCount,
            actionableCount: arbitration.actionableCount,
            advisoryCount: arbitration.advisoryCount,
            suppressedCount: arbitration.suppressedCount,
            prunedBySliceCount: arbitration.prunedBySliceCount,
            blockingCount: arbitration.blockingCount,
            gateVerdict: arbitration.gateVerdict,
            uncalibratedCount: countUncalibrated(arbitration.findings),
            reviewQueueCount,
            advisoryOnlyRules,
            ruleTiers,
            ...projectModelProvenance(ruleCalibrationStats),
            ...(arbitration.noisyRules && arbitration.noisyRules.length > 0
                ? { noisyRules: arbitration.noisyRules }
                : {}),
            ...(arbitration.quarantinedRules && arbitration.quarantinedRules.length > 0
                ? { quarantinedRules: arbitration.quarantinedRules }
                : {}),
        };

        let writtenCount = 0;
        if (reviewQueuePath) {
            writtenCount = await writeReviewQueue(reviewQueuePath, queueRecords);
        }
        logger.info(
            `${PASS_ARBITRATION}: ${arbitration.prescriptiveCount} prescriptive / ` +
                `${arbitration.actionableCount} actionable / ${arbitration.advisoryCount} advisory, ` +
                `${arbitration.blockingCount} blocking, ${writtenCount} queued for review`,
        );
    } catch (arbitrationError) {
        logger.info(`${PASS_ARBITRATION}: degraded (${String(arbitrationError)})`);
    }
}
