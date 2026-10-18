/**
 * Module: Core Scoring — Finding Arbitration Batch & Clustering Helpers
 * File Path: src/core/scoring/finding-arbitration-batch.ts
 * Architecture Role: Batch accumulation, overlapping finding clustering, and noisy-rule suppression
 *   aggregation for FindingConfidenceArbiter.
 * Dependencies & Triggers: Consumes Issue from ../types and types from ./finding-confidence-arbiter;
 *   invoked by FindingConfidenceArbiter during batch issue evaluations.
 * Responsibilities:
 *   1. Cluster overlapping findings from multiple analyzers on the same file and line span.
 *   2. Identify primary findings within clusters based on tier precedence and confidence score.
 *   3. Track per-rule evaluation and suppression statistics across batches.
 *   4. Demote noisy or auto-quarantined prescriptive rules exceeding developer suppression limits.
 * Exit Semantics & Design Rationale: Deterministic pure evaluation; zero transient allocations in loops.
 */

import type { Issue } from '../types';
import type {
    ArbitratedFinding,
    ExecutablePatch,
    FindingConfidenceTier,
    RuleSuppressionStat,
} from './finding-confidence-arbiter';
import {
    TIER_PRESCRIPTIVE,
    TIER_ACTIONABLE,
    TIER_ADVISORY,
} from './finding-confidence-arbiter';

/**
 * Internal state accumulator tracking metrics across a batch of arbitrated findings.
 */
export interface IssueBatchAccumulator {
    findings: ArbitratedFinding[];
    activeFindings: ArbitratedFinding[];
    executablePatches: ExecutablePatch[];
    prescriptiveCount: number;
    actionableCount: number;
    advisoryCount: number;
    suppressedCount: number;
    expiredSuppressionCount: number;
    prunedBySliceCount: number;
    blockingCount: number;
    quarantinedCount: number;
    ruleMap: Map<string, { total: number; suppressed: number }>;
}

/**
 * Creates a clean initial accumulator instance for batch arbitration.
 *
 * @returns Freshly initialized IssueBatchAccumulator.
 */
export function createInitialBatchAccumulator(): IssueBatchAccumulator {
    return {
        findings: [],
        activeFindings: [],
        executablePatches: [],
        prescriptiveCount: 0,
        actionableCount: 0,
        advisoryCount: 0,
        suppressedCount: 0,
        expiredSuppressionCount: 0,
        prunedBySliceCount: 0,
        blockingCount: 0,
        quarantinedCount: 0,
        ruleMap: new Map(),
    };
}

function recordRuleStats(result: ArbitratedFinding, acc: IssueBatchAccumulator): void {
    const ruleStat = acc.ruleMap.get(result.issue.rule) || { total: 0, suppressed: 0 };
    ruleStat.total++;
    if (result.isSuppressed) {
        ruleStat.suppressed++;
        acc.suppressedCount++;
    }
    acc.ruleMap.set(result.issue.rule, ruleStat);

    if (result.isSuppressionExpired) {
        acc.expiredSuppressionCount++;
    }
    if (result.isQuarantined) {
        acc.quarantinedCount++;
    }
}

function recordTierAndActiveCounts(result: ArbitratedFinding, acc: IssueBatchAccumulator): void {
    if (result.tier === TIER_PRESCRIPTIVE) {
        acc.prescriptiveCount++;
    } else if (result.tier === TIER_ACTIONABLE) {
        acc.actionableCount++;
    } else {
        acc.advisoryCount++;
    }

    if (result.isPrunedBySlice) {
        acc.prunedBySliceCount++;
    }

    const isActive = !result.isSuppressed && !result.isPrunedBySlice;
    if (isActive) {
        acc.activeFindings.push(result);
        if (result.mustBlock) {
            acc.blockingCount++;
        }
        if (result.executablePatch) {
            acc.executablePatches.push(result.executablePatch);
        }
    }
}

/**
 * Records an arbitrated finding's metrics into the batch accumulator.
 *
 * @param result - The arbitrated finding to incorporate.
 * @param acc - The mutable batch accumulator.
 */
export function recordFindingMetrics(
    result: ArbitratedFinding,
    acc: IssueBatchAccumulator,
): void {
    acc.findings.push(result);
    recordRuleStats(result, acc);
    recordTierAndActiveCounts(result, acc);
}

/**
 * Computes rule suppression ratios and flags noisy or quarantined rules.
 *
 * @param ruleMap - Map of rule IDs to total and suppressed occurrence counts.
 * @param autoQuarantineThreshold - Suppression ratio threshold for auto-quarantine.
 * @returns Statistics and rule lists.
 */
export function computeRuleSuppressionStats(
    ruleMap: Map<string, { total: number; suppressed: number }>,
    autoQuarantineThreshold = 0.5,
): { stats: RuleSuppressionStat[]; noisyRules: string[]; autoQuarantinedRules: string[] } {
    const stats: RuleSuppressionStat[] = [];
    const noisyRules: string[] = [];
    const autoQuarantinedRules: string[] = [];

    for (const [rule, stat] of ruleMap.entries()) {
        const ratio = stat.total > 0 ? +(stat.suppressed / stat.total).toFixed(2) : 0;
        const isNoisy = stat.total >= 3 && ratio >= 0.3;
        stats.push({
            rule,
            total: stat.total,
            suppressed: stat.suppressed,
            suppressionRatio: ratio,
            isNoisy,
        });
        if (isNoisy) {
            noisyRules.push(rule);
        }
        if (stat.total >= 5 && ratio >= autoQuarantineThreshold) {
            autoQuarantinedRules.push(rule);
        }
    }

    return { stats, noisyRules, autoQuarantinedRules };
}

/**
 * Demotes prescriptive findings to advisory tier when rules exceed noise thresholds.
 *
 * @param acc - Batch accumulator containing findings and counts.
 * @param noisyRules - List of rule IDs exceeding noise ratio.
 * @param autoQuarantinedRules - List of rule IDs exceeding quarantine ratio.
 * @param advisoryDefault - Default confidence score for advisory findings.
 */
export function applyNoisyRuleDemotions(
    acc: IssueBatchAccumulator,
    noisyRules: string[],
    autoQuarantinedRules: string[],
    advisoryDefault: number,
): void {
    const noisySet = new Set(noisyRules);
    const quarantineSet = new Set(autoQuarantinedRules);

    for (let i = 0; i < acc.findings.length; i++) {
        const f = acc.findings[i];
        if (f.tier === TIER_PRESCRIPTIVE && noisySet.has(f.issue.rule)) {
            const isAutoQuarantine = quarantineSet.has(f.issue.rule);
            f.tier = TIER_ADVISORY;
            f.confidence = advisoryDefault;
            if (isAutoQuarantine) {
                f.isQuarantined = true;
                f.ruleLifecycleState = 'quarantined';
                f.rationale +=
                    ' [TRICORDER DYNAMIC QUARANTINE: Auto-quarantined due to excessive developer suppression ratio >= 50%]';
                acc.quarantinedCount++;
            } else {
                f.rationale +=
                    ' [Tricorder Feedback: Demoted from Prescriptive to Advisory due to elevated developer suppression ratio >= 30%]';
            }
            acc.prescriptiveCount--;
            acc.advisoryCount++;
            if (f.mustBlock) {
                f.mustBlock = false;
                acc.blockingCount = Math.max(0, acc.blockingCount - 1);
            }
        }
    }
}

function resolveClusterPrimary(cluster: ArbitratedFinding[]): {
    primary: ArbitratedFinding;
    secondaryCount: number;
} {
    if (cluster.length === 1) {
        return { primary: cluster[0], secondaryCount: 0 };
    }

    const tierWeight = (t: FindingConfidenceTier) =>
        t === TIER_PRESCRIPTIVE ? 3 : t === TIER_ACTIONABLE ? 2 : 1;

    let bestIdx = 0;
    for (let i = 1; i < cluster.length; i++) {
        const best = cluster[bestIdx];
        const cand = cluster[i];
        const wBest = tierWeight(best.tier);
        const wCand = tierWeight(cand.tier);
        if (wCand > wBest || (wCand === wBest && cand.confidence > best.confidence)) {
            bestIdx = i;
        }
    }

    const primary = cluster[bestIdx];
    const secondaries: Issue[] = [];
    for (let i = 0; i < cluster.length; i++) {
        if (i !== bestIdx) {
            secondaries.push(cluster[i].issue);
        }
    }

    primary.clusteredFindings = (primary.clusteredFindings || []).concat(secondaries);
    return { primary, secondaryCount: secondaries.length };
}

function appendFindingToFileMap(
    fileMap: Map<string, ArbitratedFinding[]>,
    finding: ArbitratedFinding,
): void {
    const key = finding.issue.location.file;
    let list = fileMap.get(key);
    if (!list) {
        list = [];
        fileMap.set(key, list);
    }
    list.push(finding);
}

function groupFindingsByFile(candidates: readonly ArbitratedFinding[]): Map<string, ArbitratedFinding[]> {
    const fileMap = new Map<string, ArbitratedFinding[]>();
    for (let i = 0; i < candidates.length; i++) {
        appendFindingToFileMap(fileMap, candidates[i]);
    }
    return fileMap;
}

/**
 * Clusters overlapping findings from multiple analyzers on the same file and line span.
 *
 * @param candidates - List of active arbitrated findings.
 * @returns Deduplicated primary findings and total clustered secondary count.
 */
export function clusterOverlappingFindings(candidates: ArbitratedFinding[]): {
    primaries: ArbitratedFinding[];
    clusteredCount: number;
} {
    if (candidates.length <= 1) {
        return { primaries: candidates, clusteredCount: 0 };
    }

    const fileMap = groupFindingsByFile(candidates);
    const primaries: ArbitratedFinding[] = [];
    let clusteredCount = 0;

    for (const fileFindings of fileMap.values()) {
        if (fileFindings.length === 1) {
            primaries.push(fileFindings[0]);
            continue;
        }

        fileFindings.sort((a, b) => a.issue.location.start.line - b.issue.location.start.line);

        const currentCluster: ArbitratedFinding[] = [fileFindings[0]];

        for (let i = 1; i < fileFindings.length; i++) {
            const current = fileFindings[i];
            const prev = currentCluster[currentCluster.length - 1];
            if (Math.abs(current.issue.location.start.line - prev.issue.location.start.line) <= 1) {
                currentCluster.push(current);
            } else {
                const outcome = resolveClusterPrimary(currentCluster);
                primaries.push(outcome.primary);
                clusteredCount += outcome.secondaryCount;
                currentCluster.length = 0;
                currentCluster.push(current);
            }
        }

        if (currentCluster.length > 0) {
            const outcome = resolveClusterPrimary(currentCluster);
            primaries.push(outcome.primary);
            clusteredCount += outcome.secondaryCount;
        }
    }

    return { primaries, clusteredCount };
}

/**
 * Resolves final active findings list and clustered count based on configuration.
 *
 * @param enableClustering - Whether clustering is active.
 * @param activeFindings - List of active unsuppressed findings.
 * @returns Primary active findings and clustered secondary count.
 */
export function resolveBatchClustering(
    enableClustering: boolean,
    activeFindings: ArbitratedFinding[],
): { finalActiveFindings: ArbitratedFinding[]; clusteredCount: number } {
    if (!enableClustering || activeFindings.length <= 1) {
        return { finalActiveFindings: activeFindings, clusteredCount: 0 };
    }
    const outcome = clusterOverlappingFindings(activeFindings);
    return {
        finalActiveFindings: outcome.primaries,
        clusteredCount: outcome.clusteredCount,
    };
}
