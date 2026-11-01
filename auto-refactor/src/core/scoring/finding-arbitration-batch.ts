/**
 * Module: Core Scoring — Finding Arbitration Batch & Clustering Helpers
 * File Path: src/core/scoring/finding-arbitration-batch.ts
 * Architecture Role: Batch accumulation, overlapping finding clustering, and noisy-rule suppression
 *   aggregation for FindingConfidenceArbiter.
 * Dependencies & Triggers: Consumes Issue from ../types and types from
 *   ./finding-confidence-arbiter; invoked by FindingConfidenceArbiter during batch issue
 *   evaluations.
 * Responsibilities:
 *   1. Cluster overlapping findings from multiple analyzers on the same file and line span.
 *   2. Identify primary findings within clusters based on tier precedence and confidence score.
 *   3. Track per-rule evaluation and suppression statistics across batches.
 *   4. Demote noisy or auto-quarantined prescriptive rules exceeding developer suppression limits.
 * Exit Semantics & Design Rationale: Deterministic pure evaluation;
 *   zero transient allocations in loops.
 */

import type { Issue } from '../types';
import { rulesShareCluster } from '../rules/overlap-clusters';
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
    LIFECYCLE_QUARANTINED,
} from './finding-confidence-arbiter';

const MIN_NOISY_SAMPLE_COUNT = 3;
const NOISY_SUPPRESSION_RATIO_THRESHOLD = 0.3;
const MIN_QUARANTINE_SAMPLE_COUNT = 5;
const TIER_WEIGHT_PRESCRIPTIVE = 3;
const TIER_WEIGHT_ACTIONABLE = 2;
const TIER_WEIGHT_ADVISORY = 1;

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
export function recordFindingMetrics(result: ArbitratedFinding, acc: IssueBatchAccumulator): void {
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
        const isNoisy =
            stat.total >= MIN_NOISY_SAMPLE_COUNT && ratio >= NOISY_SUPPRESSION_RATIO_THRESHOLD;
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
        if (stat.total >= MIN_QUARANTINE_SAMPLE_COUNT && ratio >= autoQuarantineThreshold) {
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
        const finding = acc.findings[i];
        if (finding.tier === TIER_PRESCRIPTIVE && noisySet.has(finding.issue.rule)) {
            const isAutoQuarantine = quarantineSet.has(finding.issue.rule);
            finding.tier = TIER_ADVISORY;
            finding.confidence = advisoryDefault;
            if (isAutoQuarantine) {
                finding.isQuarantined = true;
                finding.ruleLifecycleState = LIFECYCLE_QUARANTINED;
                finding.rationale +=
                    ' [TRICORDER DYNAMIC QUARANTINE: Auto-quarantined due to excessive developer suppression ratio >= 50%]';
                acc.quarantinedCount++;
            } else {
                finding.rationale +=
                    ' [Tricorder Feedback: Demoted from Prescriptive to Advisory due to elevated developer suppression ratio >= 30%]';
            }
            acc.prescriptiveCount--;
            acc.advisoryCount++;
            if (finding.mustBlock) {
                finding.mustBlock = false;
                acc.blockingCount = Math.max(0, acc.blockingCount - 1);
            }
        }
    }
}

function resolveTierWeight(tier: FindingConfidenceTier): number {
    if (tier === TIER_PRESCRIPTIVE) return TIER_WEIGHT_PRESCRIPTIVE;
    if (tier === TIER_ACTIONABLE) return TIER_WEIGHT_ACTIONABLE;
    return TIER_WEIGHT_ADVISORY;
}

function stampClusterCorrelation(primary: ArbitratedFinding, secondaries: Issue[]): void {
    const secondaryRules = new Set<string>(primary.issue.correlatedRules ?? []);
    for (let i = 0; i < secondaries.length; i++) {
        const secondaryIssue = secondaries[i];
        if (secondaryIssue.rule !== primary.issue.rule) {
            secondaryRules.add(secondaryIssue.rule);
        }
        secondaryIssue.clusteredInto = primary.issue.rule;
    }
    if (secondaryRules.size > 0) {
        primary.issue.correlatedRules = Array.from(secondaryRules).sort();
    }
}

function resolveClusterPrimary(cluster: ArbitratedFinding[]): {
    primary: ArbitratedFinding;
    secondaryCount: number;
} {
    if (cluster.length === 1) {
        return { primary: cluster[0], secondaryCount: 0 };
    }

    let bestIdx = 0;
    for (let i = 1; i < cluster.length; i++) {
        const best = cluster[bestIdx];
        const cand = cluster[i];
        const wBest = resolveTierWeight(best.tier);
        const wCand = resolveTierWeight(cand.tier);
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
    stampClusterCorrelation(primary, secondaries);
    return { primary, secondaryCount: secondaries.length };
}

function clusterSemanticFileFindings(fileFindings: ArbitratedFinding[]): {
    primaries: ArbitratedFinding[];
    clusteredCount: number;
} {
    if (fileFindings.length <= 1) {
        return { primaries: fileFindings, clusteredCount: 0 };
    }
    fileFindings.sort(
        (itemA, itemB) => itemA.issue.location.start.line - itemB.issue.location.start.line,
    );
    const consumed = new Uint8Array(fileFindings.length);
    const primaries: ArbitratedFinding[] = [];
    const reusableCluster: ArbitratedFinding[] = [];
    let clusteredCount = 0;

    for (let i = 0; i < fileFindings.length; i++) {
        if (consumed[i] === 1) continue;
        const anchor = fileFindings[i];
        reusableCluster.length = 0;
        reusableCluster.push(anchor);
        consumed[i] = 1;

        for (let j = i + 1; j < fileFindings.length; j++) {
            if (consumed[j] === 1) continue;
            const candidate = fileFindings[j];
            if (candidate.issue.location.start.line - anchor.issue.location.start.line > 2) {
                break;
            }
            if (rulesShareCluster(anchor.issue.rule, candidate.issue.rule)) {
                reusableCluster.push(candidate);
                consumed[j] = 1;
            }
        }

        const outcome = resolveClusterPrimary(reusableCluster);
        primaries.push(outcome.primary);
        clusteredCount += outcome.secondaryCount;
    }

    return { primaries, clusteredCount };
}

/**
 * Clusters semantically overlapping findings sharing an OVERLAP_CLUSTERS definition.
 *
 * @param candidates - List of active arbitrated findings.
 * @returns Deduplicated primary findings and total clustered secondary count.
 */
export function clusterSemanticOverlapFindings(candidates: ArbitratedFinding[]): {
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
        const outcome = clusterSemanticFileFindings(fileFindings);
        for (let i = 0; i < outcome.primaries.length; i++) {
            primaries.push(outcome.primaries[i]);
        }
        clusteredCount += outcome.clusteredCount;
    }

    return { primaries, clusteredCount };
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

function groupFindingsByFile(
    candidates: readonly ArbitratedFinding[],
): Map<string, ArbitratedFinding[]> {
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

        fileFindings.sort(
            (itemA, itemB) => itemA.issue.location.start.line - itemB.issue.location.start.line,
        );

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

/**
 * Stamps per-finding adjudicated tier, calibrated confidence, and semantic overlap correlations
 * directly onto each raw Issue in-place after arbitration completes.
 *
 * @param findings - Full list of arbitrated findings from FindingConfidenceArbiter.
 */
export function stampAdjudicatedIssues(findings: readonly ArbitratedFinding[]): void {
    const activeCandidates: ArbitratedFinding[] = [];
    for (let i = 0; i < findings.length; i++) {
        const finding = findings[i];
        if (finding.isSuppressed) continue;
        finding.issue.adjudicatedTier =
            finding.tier === TIER_PRESCRIPTIVE
                ? 'T1'
                : finding.tier === TIER_ACTIONABLE
                  ? 'T2'
                  : 'T3';
        finding.issue.adjudicatedConfidence = finding.confidence;
        if (!finding.isPrunedBySlice) {
            activeCandidates.push(finding);
        }
    }
    if (activeCandidates.length > 1) {
        clusterSemanticOverlapFindings(activeCandidates);
    }
}

/**
 * Maps each rule to the strongest tier the arbiter assigned it in this report.
 *
 * @param findings - Every arbitrated finding, including suppressed and clustered ones.
 * @returns Rule id to tier map, using the AAS tier vocabulary.
 */
export function resolveRuleTiers(
    findings: readonly { issue: { rule: string }; tier: string; isSuppressed: boolean }[],
): Record<string, 'T1' | 'T2' | 'T3'> {
    const rank: Record<string, number> = { prescriptive: 3, actionable: 2, advisory: 1 };
    const best = new Map<string, { tier: 'T1' | 'T2' | 'T3'; rank: number }>();
    for (const finding of findings) {
        if (finding.isSuppressed) continue;
        const currentRank = rank[finding.tier] ?? 0;
        const existing = best.get(finding.issue.rule);
        if (existing && existing.rank >= currentRank) continue;
        best.set(finding.issue.rule, {
            tier:
                finding.tier === 'prescriptive'
                    ? 'T1'
                    : finding.tier === 'actionable'
                      ? 'T2'
                      : 'T3',
            rank: currentRank,
        });
    }
    const tiers: Record<string, 'T1' | 'T2' | 'T3'> = {};
    for (const [rule, entry] of best) tiers[rule] = entry.tier;
    return tiers;
}

/**
 * Groups arbitrated findings by rule and reports which rules never reached a blocking tier.
 *
 * @param findings - Every arbitrated finding, including suppressed and clustered ones.
 * @returns Rule ids whose every active finding was classified non-blocking.
 */
export function resolveAdvisoryOnlyRules(
    findings: readonly { issue: { rule: string }; mustBlock: boolean; isSuppressed: boolean }[],
): string[] {
    const blockingRules = new Set<string>();
    const activeRules = new Set<string>();
    for (const finding of findings) {
        if (finding.isSuppressed) continue;
        activeRules.add(finding.issue.rule);
        if (finding.mustBlock) blockingRules.add(finding.issue.rule);
    }
    const advisoryOnly: string[] = [];
    for (const rule of activeRules) {
        if (!blockingRules.has(rule)) advisoryOnly.push(rule);
    }
    return advisoryOnly;
}

/**
 * Counts active findings whose rule carries no outcome history.
 *
 * @param findings - Every arbitrated finding, including suppressed and clustered ones.
 * @returns Number of non-suppressed findings scored from the analyzer's self-report alone.
 */
export function countUncalibrated(findings: readonly ArbitratedFinding[]): number {
    let count = 0;
    for (const finding of findings) {
        if (!finding.isSuppressed && finding.confidenceSource === 'uncalibrated') count += 1;
    }
    return count;
}
