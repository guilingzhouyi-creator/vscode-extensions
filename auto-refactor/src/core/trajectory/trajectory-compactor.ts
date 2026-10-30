/**
 * Module: Core Trajectory — Trajectory Compactor & Lifetime Aggregator
 * File Path: src/core/trajectory/trajectory-compactor.ts
 * Architecture Role: Aggregates rolling review runs into weekly summaries and global ledgers,
 *   enforcing bounded O(Runs + Milestones) storage constraints and calculating macro trends.
 * Dependencies & Triggers: Consumes eloc-types and compact-ledger-store.
 * Responsibilities: Aggregate rolling records into weekly statistical snapshots, prune
 *   old runs, and update lifetime summary statistics.
 * Exit Semantics & Design Rationale: Deterministic reduction of discrete runs into statistical
 *   summaries; safe file atomic writes prevent partial state corruption.
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
    CompactTrajectoryRecord,
    CompactVerificationTelemetry,
    WeeklyManifoldSummary,
    WeeklyStabilityMetrics,
    WeeklyTrajectorySummary,
    WeeklyVerificationSummary,
} from './eloc-types';
import {
    ensureLedgerDirectory,
    readRecentRecords,
    writeLifetimeSummary,
    DEFAULT_MAX_ROLLING_RUNS,
    pruneActiveRuns,
} from './compact-ledger-store';

/**
 * Computes ISO 8601 week string (e.g. '2026-W40') from a timestamp.
 *
 * @param timestamp - Epoch milliseconds.
 * @returns ISO week identifier.
 */
export function getIsoWeekId(timestamp: number): string {
    const dateObj = new Date(timestamp);
    const dayNum = dateObj.getUTCDay() || 7;
    dateObj.setUTCDate(dateObj.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(dateObj.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil(((dateObj.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
    const paddedWeek = weekNo < 10 ? `0${weekNo}` : `${weekNo}`;
    return `${dateObj.getUTCFullYear()}-W${paddedWeek}`;
}

/**
 * Derives steady-state defensive stability metrics from a batch of compact records.
 */
function deriveRecordsStability(
    records: CompactTrajectoryRecord[],
    processedTotal: number,
    maxUnique: number,
    changedTotal: number,
    semanticTotal: number,
): WeeklyStabilityMetrics {
    let zeroRegressionRuns = 0;
    let zeroRegressionStreak = 0;
    let scoreFloor = Infinity;
    let scoreCeiling = -Infinity;

    for (const record of records) {
        if (record.debt.reg === 0) {
            zeroRegressionRuns += 1;
        }
        if (record.debt.reg === 0 && record.gate.pass) {
            zeroRegressionStreak += 1;
        } else {
            zeroRegressionStreak = 0;
        }
        if (record.score.aft < scoreFloor) scoreFloor = record.score.aft;
        if (record.score.aft > scoreCeiling) scoreCeiling = record.score.aft;
    }

    const semanticPurityRatio =
        changedTotal > 0 ? Math.round((semanticTotal / changedTotal) * 10000) / 10000 : 1;
    const uniqueCoverageRatio =
        processedTotal > 0
            ? Math.min(1, Math.round((maxUnique / processedTotal) * 10000) / 10000)
            : 1;

    return {
        zeroRegressionRuns,
        zeroRegressionStreak,
        semanticPurityRatio,
        uniqueCoverageRatio,
        scoreFloor: scoreFloor === Infinity ? 100 : scoreFloor,
        scoreCeiling: scoreCeiling === -Infinity ? 100 : scoreCeiling,
    };
}

interface VerificationBatchState {
    verifiedRuns: number;
    killSum: number;
    minKill: number;
    creditSum: number;
    creditCount: number;
    minCi: number;
    quarantineCount: number;
}

function foldVerificationRecord(
    state: VerificationBatchState,
    vrf: CompactVerificationTelemetry,
): void {
    state.verifiedRuns += 1;
    if (typeof vrf.k === 'number') {
        state.killSum += vrf.k;
        state.minKill = Math.min(state.minKill, vrf.k);
    }
    if (typeof vrf.cr === 'number') {
        state.creditSum += vrf.cr;
        state.creditCount += 1;
    }
    if (typeof vrf.ci === 'number') {
        state.minCi = Math.min(state.minCi, vrf.ci);
    }
    if (vrf.q === 1) {
        state.quarantineCount += 1;
    }
}

/**
 * Accumulates in-kernel verification telemetry across a batch of compact records.
 */
function deriveRecordsVerification(
    records: CompactTrajectoryRecord[],
): WeeklyVerificationSummary | undefined {
    const state: VerificationBatchState = {
        verifiedRuns: 0,
        killSum: 0,
        minKill: Infinity,
        creditSum: 0,
        creditCount: 0,
        minCi: Infinity,
        quarantineCount: 0,
    };

    for (const record of records) {
        if (record.vrf) {
            foldVerificationRecord(state, record.vrf);
        }
    }

    if (state.verifiedRuns === 0) {
        return undefined;
    }

    const meanCredit =
        state.creditCount > 0
            ? Math.round((state.creditSum / state.creditCount) * 100) / 100
            : 100;

    return {
        verifiedRuns: state.verifiedRuns,
        meanMutationKillRate: Math.round((state.killSum / state.verifiedRuns) * 10000) / 10000,
        minMutationKillRate: state.minKill === Infinity ? 1 : state.minKill,
        meanBayesianCredit: meanCredit,
        minBayesianCiLower: state.minCi === Infinity ? 1 : state.minCi,
        quarantineCount: state.quarantineCount,
    };
}

/**
 * Accumulates 5D Riemannian manifold and density telemetry across a batch of compact records.
 */
function deriveRecordsManifold(
    records: CompactTrajectoryRecord[],
): WeeklyManifoldSummary | undefined {
    let dmCount = 0;
    let dmSum = 0;
    let maxDm = 0;
    let tauCount = 0;
    let tauSum = 0;

    for (const record of records) {
        const vrf = record.vrf;
        if (!vrf) continue;
        if (typeof vrf.dm === 'number') {
            dmCount += 1;
            dmSum += vrf.dm;
            if (vrf.dm > maxDm) maxDm = vrf.dm;
        }
        if (typeof vrf.tau === 'number') {
            tauCount += 1;
            tauSum += vrf.tau;
        }
    }

    if (dmCount === 0 && tauCount === 0) {
        return undefined;
    }

    return {
        meanMahalanobisDistance: dmCount > 0 ? Math.round((dmSum / dmCount) * 10000) / 10000 : 0,
        maxMahalanobisDistance: Math.round(maxDm * 10000) / 10000,
        ...(tauCount > 0 ? { meanTau: Math.round((tauSum / tauCount) * 100) / 100 } : {}),
    };
}

/**
 * Aggregates a batch of compact trajectory records into a single statistical summary.
 *
 * @param records - Array of CompactTrajectoryRecord.
 * @param summaryId - Custom summary/week identifier.
 * @returns Statistical WeeklyTrajectorySummary.
 */
export function aggregateRecords(
    records: CompactTrajectoryRecord[],
    summaryId: string,
): WeeklyTrajectorySummary {
    if (records.length === 0) {
        const now = Date.now();
        return {
            weekId: summaryId,
            startMs: now,
            endMs: now,
            totalRuns: 0,
            eloc: {
                processedTotal: 0,
                uniqueTotal: 0,
                changedTotal: 0,
                semanticTotal: 0,
            },
            qed: {
                mean: 0,
                min: 0,
                max: 0,
                kMean: 0,
            },
            debt: {
                totalAdded: 0,
                totalResolved: 0,
                totalRegressions: 0,
                netYield: 0,
                densityYield: 0,
            },
            meanCompositeScore: 100,
            gatePassRate: 100,
            stability: {
                zeroRegressionRuns: 0,
                zeroRegressionStreak: 0,
                semanticPurityRatio: 1,
                uniqueCoverageRatio: 1,
                scoreFloor: 100,
                scoreCeiling: 100,
            },
        };
    }

    let startMs = Infinity;
    let endMs = -Infinity;
    let processedTotal = 0;
    let maxUnique = 0;
    let changedTotal = 0;
    let semanticTotal = 0;
    let qedSum = 0;
    let qedMin = Infinity;
    let qedMax = -Infinity;
    let totalAddedDebt = 0;
    let totalResolvedDebt = 0;
    let totalRegressions = 0;
    let scoreSum = 0;
    let passedGateCount = 0;

    for (const record of records) {
        if (record.t < startMs) startMs = record.t;
        if (record.t > endMs) endMs = record.t;

        processedTotal += record.eloc.proc;
        if (record.eloc.uniq > maxUnique) maxUnique = record.eloc.uniq;
        changedTotal += record.eloc.chg;
        semanticTotal += record.eloc.sem;

        const qed = record.score.qed;
        qedSum += qed;
        if (qed < qedMin) qedMin = qed;
        if (qed > qedMax) qedMax = qed;

        totalAddedDebt += record.debt.add;
        totalResolvedDebt += record.debt.res;
        totalRegressions += record.debt.reg;

        scoreSum += record.score.aft;
        if (record.gate.pass) passedGateCount++;
    }

    const totalRuns = records.length;
    const meanQed = Math.round((qedSum / totalRuns) * 1000000) / 1000000;
    const kMean = Math.round(meanQed * 1000 * 100) / 100;
    const meanScore = Math.round((scoreSum / totalRuns) * 100) / 100;
    const gatePassRate = Math.round((passedGateCount / totalRuns) * 10000) / 100;

    const netDebt = totalResolvedDebt - totalAddedDebt;
    const semanticKilo =
        semanticTotal > 0 ? Math.max(0.1, semanticTotal / 1000) : Math.max(1, maxUnique / 1000);
    const netYield = Math.round((netDebt / semanticKilo) * 100) / 100;

    const baseKilo = Math.max(1, maxUnique / 1000);
    const densityYield = Math.round((netDebt / baseKilo) * 100) / 100;

    const stability = deriveRecordsStability(
        records,
        processedTotal,
        maxUnique,
        changedTotal,
        semanticTotal,
    );
    const verification = deriveRecordsVerification(records);
    const manifold = deriveRecordsManifold(records);

    return {
        weekId: summaryId,
        startMs,
        endMs,
        totalRuns,
        eloc: {
            processedTotal,
            uniqueTotal: maxUnique,
            changedTotal,
            semanticTotal,
        },
        qed: {
            mean: meanQed,
            min: qedMin === Infinity ? 0 : qedMin,
            max: qedMax === -Infinity ? 0 : qedMax,
            kMean,
        },
        debt: {
            totalAdded: totalAddedDebt,
            totalResolved: totalResolvedDebt,
            totalRegressions,
            netYield,
            densityYield,
        },
        meanCompositeScore: meanScore,
        gatePassRate,
        stability,
        ...(verification ? { verification } : {}),
        ...(manifold ? { manifold } : {}),
    };
}

/**
 * Running totals accumulated across weekly summaries before the final projection.
 *
 * Extracted so `aggregateWeeklySummaries` stays within the cyclomatic budget: the fold body
 * carries no branching beyond the accumulator updates themselves.
 */
interface WeeklySummaryAccumulator {
    startMs: number;
    endMs: number;
    totalRuns: number;
    processedTotal: number;
    maxUnique: number;
    changedTotal: number;
    semanticTotal: number;
    qedWeightedSum: number;
    qedMin: number;
    qedMax: number;
    totalAddedDebt: number;
    totalResolvedDebt: number;
    totalRegressions: number;
    scoreWeightedSum: number;
    passedWeightedCount: number;
    zeroRegressionRuns: number;
    zeroRegressionStreak: number;
    scoreFloor: number;
    scoreCeiling: number;
    verifiedRuns: number;
    killWeightedSum: number;
    minKill: number;
    creditWeightedSum: number;
    minCi: number;
    quarantineCount: number;
    manifoldWeeks: number;
    dmSum: number;
    maxDm: number;
}

/**
 * Creates the neutral accumulator for the weekly-summary fold.
 *
 * @returns Accumulator seeded with additive identities and inverted min/max bounds.
 */
function createWeeklyAccumulator(): WeeklySummaryAccumulator {
    return {
        startMs: Infinity,
        endMs: -Infinity,
        totalRuns: 0,
        processedTotal: 0,
        maxUnique: 0,
        changedTotal: 0,
        semanticTotal: 0,
        qedWeightedSum: 0,
        qedMin: Infinity,
        qedMax: -Infinity,
        totalAddedDebt: 0,
        totalResolvedDebt: 0,
        totalRegressions: 0,
        scoreWeightedSum: 0,
        passedWeightedCount: 0,
        zeroRegressionRuns: 0,
        zeroRegressionStreak: 0,
        scoreFloor: Infinity,
        scoreCeiling: -Infinity,
        verifiedRuns: 0,
        killWeightedSum: 0,
        minKill: Infinity,
        creditWeightedSum: 0,
        minCi: Infinity,
        quarantineCount: 0,
        manifoldWeeks: 0,
        dmSum: 0,
        maxDm: 0,
    };
}

/**
 * Folds stability, verification, and manifold sub-summaries into the accumulator.
 */
function absorbExtendedSummaryBlocks(
    acc: WeeklySummaryAccumulator,
    snapshot: WeeklyTrajectorySummary,
): void {
    const stab = snapshot.stability;
    const weekZeroRegRuns =
        stab?.zeroRegressionRuns ??
        (snapshot.debt.totalRegressions === 0 ? snapshot.totalRuns : 0);
    acc.zeroRegressionRuns += weekZeroRegRuns;
    if (weekZeroRegRuns === snapshot.totalRuns && snapshot.gatePassRate >= 100) {
        acc.zeroRegressionStreak += snapshot.totalRuns;
    } else {
        acc.zeroRegressionStreak = stab?.zeroRegressionStreak ?? 0;
    }
    acc.scoreFloor = Math.min(acc.scoreFloor, stab?.scoreFloor ?? snapshot.meanCompositeScore);
    acc.scoreCeiling = Math.max(
        acc.scoreCeiling,
        stab?.scoreCeiling ?? snapshot.meanCompositeScore,
    );

    if (snapshot.verification && snapshot.verification.verifiedRuns > 0) {
        const vrf = snapshot.verification;
        acc.verifiedRuns += vrf.verifiedRuns;
        acc.killWeightedSum += vrf.meanMutationKillRate * vrf.verifiedRuns;
        acc.minKill = Math.min(acc.minKill, vrf.minMutationKillRate);
        acc.creditWeightedSum += vrf.meanBayesianCredit * vrf.verifiedRuns;
        acc.minCi = Math.min(acc.minCi, vrf.minBayesianCiLower);
        acc.quarantineCount += vrf.quarantineCount;
    }

    if (snapshot.manifold) {
        acc.manifoldWeeks += 1;
        acc.dmSum += snapshot.manifold.meanMahalanobisDistance;
        acc.maxDm = Math.max(acc.maxDm, snapshot.manifold.maxMahalanobisDistance);
    }
}

/**
 * Folds one weekly summary into the accumulator.
 *
 * @param acc - Accumulator mutated in place.
 * @param snapshot - Weekly summary to absorb.
 * @returns Nothing; `acc` is updated.
 */
function absorbWeeklySummary(
    acc: WeeklySummaryAccumulator,
    snapshot: WeeklyTrajectorySummary,
): void {
    acc.startMs = Math.min(acc.startMs, snapshot.startMs);
    acc.endMs = Math.max(acc.endMs, snapshot.endMs);
    acc.totalRuns += snapshot.totalRuns;
    acc.processedTotal += snapshot.eloc.processedTotal;
    acc.maxUnique = Math.max(acc.maxUnique, snapshot.eloc.uniqueTotal);
    acc.changedTotal += snapshot.eloc.changedTotal;
    acc.semanticTotal += snapshot.eloc.semanticTotal;
    acc.qedWeightedSum += snapshot.qed.mean * snapshot.totalRuns;
    acc.qedMin = Math.min(acc.qedMin, snapshot.qed.min);
    acc.qedMax = Math.max(acc.qedMax, snapshot.qed.max);
    acc.totalAddedDebt += snapshot.debt.totalAdded;
    acc.totalResolvedDebt += snapshot.debt.totalResolved;
    acc.totalRegressions += snapshot.debt.totalRegressions;
    acc.scoreWeightedSum += snapshot.meanCompositeScore * snapshot.totalRuns;
    acc.passedWeightedCount += (snapshot.gatePassRate / 100) * snapshot.totalRuns;
    absorbExtendedSummaryBlocks(acc, snapshot);
}

function buildAggregatedStability(
    acc: WeeklySummaryAccumulator,
    meanScore: number,
    semanticPurityRatio: number,
    uniqueCoverageRatio: number,
): WeeklyStabilityMetrics {
    const scoreFloor = acc.scoreFloor === Infinity ? meanScore : acc.scoreFloor;
    const scoreCeiling = acc.scoreCeiling === -Infinity ? meanScore : acc.scoreCeiling;
    return {
        zeroRegressionRuns: acc.zeroRegressionRuns,
        zeroRegressionStreak: acc.zeroRegressionStreak,
        semanticPurityRatio,
        uniqueCoverageRatio,
        scoreFloor,
        scoreCeiling,
    };
}

function buildAggregatedVerification(
    acc: WeeklySummaryAccumulator,
): WeeklyVerificationSummary | undefined {
    if (acc.verifiedRuns <= 0) {
        return undefined;
    }
    const meanKill = Math.round((acc.killWeightedSum / acc.verifiedRuns) * 10000) / 10000;
    const minKill = acc.minKill === Infinity ? 1 : acc.minKill;
    const meanCredit = Math.round((acc.creditWeightedSum / acc.verifiedRuns) * 100) / 100;
    const minCi = acc.minCi === Infinity ? 1 : acc.minCi;
    return {
        verifiedRuns: acc.verifiedRuns,
        meanMutationKillRate: meanKill,
        minMutationKillRate: minKill,
        meanBayesianCredit: meanCredit,
        minBayesianCiLower: minCi,
        quarantineCount: acc.quarantineCount,
    };
}

function buildAggregatedManifold(
    acc: WeeklySummaryAccumulator,
): WeeklyManifoldSummary | undefined {
    if (acc.manifoldWeeks <= 0) {
        return undefined;
    }
    const meanDm = Math.round((acc.dmSum / acc.manifoldWeeks) * 10000) / 10000;
    const maxDm = Math.round(acc.maxDm * 10000) / 10000;
    return {
        meanMahalanobisDistance: meanDm,
        maxMahalanobisDistance: maxDm,
    };
}

/**
 * Aggregates multiple weekly summaries into a unified lifetime summary.
 *
 * @param summaries - Array of WeeklyTrajectorySummary.
 * @returns Unified WeeklyTrajectorySummary for lifetime tracking.
 */
export function aggregateWeeklySummaries(
    summaries: WeeklyTrajectorySummary[],
): WeeklyTrajectorySummary {
    if (summaries.length === 0) {
        return aggregateRecords([], 'LIFETIME');
    }

    const orderedSummaries = [...summaries].sort((a, b) => a.startMs - b.startMs);
    const acc = createWeeklyAccumulator();
    for (const snapshot of orderedSummaries) {
        absorbWeeklySummary(acc, snapshot);
    }

    const { totalRuns, processedTotal, maxUnique, changedTotal, semanticTotal } = acc;
    const meanQed =
        totalRuns > 0 ? Math.round((acc.qedWeightedSum / totalRuns) * 1000000) / 1000000 : 0;
    const kMean = Math.round(meanQed * 1000 * 100) / 100;
    const meanScore =
        totalRuns > 0 ? Math.round((acc.scoreWeightedSum / totalRuns) * 100) / 100 : 100;
    const gatePassRate =
        totalRuns > 0 ? Math.round((acc.passedWeightedCount / totalRuns) * 10000) / 100 : 100;

    const netDebt = acc.totalResolvedDebt - acc.totalAddedDebt;
    const semanticKilo =
        semanticTotal > 0 ? Math.max(0.1, semanticTotal / 1000) : Math.max(1, maxUnique / 1000);
    const netYield = Math.round((netDebt / semanticKilo) * 100) / 100;

    const baseKilo = Math.max(1, maxUnique / 1000);
    const densityYield = Math.round((netDebt / baseKilo) * 100) / 100;

    const semanticPurityRatio =
        changedTotal > 0 ? Math.round((semanticTotal / changedTotal) * 10000) / 10000 : 1;
    const uniqueCoverageRatio =
        processedTotal > 0
            ? Math.min(1, Math.round((maxUnique / processedTotal) * 10000) / 10000)
            : 1;

    const stability = buildAggregatedStability(
        acc,
        meanScore,
        semanticPurityRatio,
        uniqueCoverageRatio,
    );
    const verification = buildAggregatedVerification(acc);
    const manifold = buildAggregatedManifold(acc);

    return {
        weekId: 'LIFETIME',
        startMs: acc.startMs === Infinity ? Date.now() : acc.startMs,
        endMs: acc.endMs === -Infinity ? Date.now() : acc.endMs,
        totalRuns,
        eloc: {
            processedTotal,
            uniqueTotal: maxUnique,
            changedTotal,
            semanticTotal,
        },
        qed: {
            mean: meanQed,
            min: acc.qedMin === Infinity ? 0 : acc.qedMin,
            max: acc.qedMax === -Infinity ? 0 : acc.qedMax,
            kMean,
        },
        debt: {
            totalAdded: acc.totalAddedDebt,
            totalResolved: acc.totalResolvedDebt,
            totalRegressions: acc.totalRegressions,
            netYield,
            densityYield,
        },
        meanCompositeScore: meanScore,
        gatePassRate,
        stability,
        ...(verification ? { verification } : {}),
        ...(manifold ? { manifold } : {}),
    };
}

/**
 * Persists a weekly trajectory summary into its partition file, preserving
 * any existing summary with higher run count.
 */
async function saveWeeklyPartitionSummary(
    weeklyDir: string,
    weekId: string,
    summary: WeeklyTrajectorySummary,
): Promise<WeeklyTrajectorySummary> {
    const weekFilePath = path.join(weeklyDir, `${weekId}.summary.json`);
    if (fs.existsSync(weekFilePath)) {
        try {
            const raw = await fs.promises.readFile(weekFilePath, 'utf8');
            const existing = JSON.parse(raw) as WeeklyTrajectorySummary;
            if (
                existing &&
                typeof existing.totalRuns === 'number' &&
                existing.totalRuns > summary.totalRuns
            ) {
                normalizeLegacyWeeklySummary(existing);
                await fs.promises.writeFile(
                    weekFilePath,
                    JSON.stringify(existing, null, 2) + '\n',
                    'utf8',
                );
                return existing;
            }
        } catch {
            // Best-effort: ignore corrupt existing file and proceed to overwrite
        }
    }
    await fs.promises.writeFile(weekFilePath, JSON.stringify(summary, null, 2) + '\n', 'utf8');
    return summary;
}

function resolveLegacyBaseLines(eloc?: WeeklyTrajectorySummary['eloc'], totalRuns = 1): number {
    if (typeof eloc?.uniqueTotal === 'number' && eloc.uniqueTotal > 0) {
        return eloc.uniqueTotal;
    }
    if (typeof eloc?.processedTotal === 'number' && eloc.processedTotal > 0) {
        return Math.max(1, Math.round(eloc.processedTotal / Math.max(1, totalRuns)));
    }
    return 10000;
}

function normalizeLegacyDebtYield(
    debt?: WeeklyTrajectorySummary['debt'],
    totalLines = 10000,
): void {
    if (!debt || typeof debt.densityYield === 'number') {
        return;
    }
    const baseKilo = Math.max(1, totalLines / 1000);
    const resolved = debt.totalResolved ?? 0;
    const added = debt.totalAdded ?? 0;
    debt.densityYield = Math.round(((resolved - added) / baseKilo) * 100) / 100;
}

function normalizeLegacyQedMean(qed?: WeeklyTrajectorySummary['qed']): void {
    if (!qed || typeof qed.kMean === 'number') {
        return;
    }
    const mean = qed.mean ?? 0;
    qed.kMean = Math.round(mean * 1000 * 100) / 100;
}

function computeSafeRatio(numerator: number, denominator: number): number {
    if (denominator <= 0) return 1;
    return Math.round((numerator / denominator) * 10000) / 10000;
}

interface LegacyElocMetrics {
    chg: number;
    sem: number;
    proc: number;
    uniq: number;
}

function extractLegacyEloc(eloc?: WeeklyTrajectorySummary['eloc']): LegacyElocMetrics {
    if (!eloc) {
        return { chg: 0, sem: 0, proc: 0, uniq: 0 };
    }
    return {
        chg: eloc.changedTotal,
        sem: eloc.semanticTotal,
        proc: eloc.processedTotal,
        uniq: eloc.uniqueTotal,
    };
}

function normalizeLegacyStability(parsed: WeeklyTrajectorySummary): void {
    if (parsed.stability) {
        return;
    }

    const totalRuns = typeof parsed.totalRuns === 'number' ? parsed.totalRuns : 0;
    const isZeroReg = Boolean(parsed.debt && parsed.debt.totalRegressions === 0);
    const zeroReg = isZeroReg ? totalRuns : 0;
    const isPassing = typeof parsed.gatePassRate === 'number' && parsed.gatePassRate >= 100;
    const streak = isZeroReg && isPassing ? totalRuns : 0;
    const score = typeof parsed.meanCompositeScore === 'number' ? parsed.meanCompositeScore : 100;

    const { chg, sem, proc, uniq } = extractLegacyEloc(parsed.eloc);

    parsed.stability = {
        zeroRegressionRuns: zeroReg,
        zeroRegressionStreak: streak,
        semanticPurityRatio: computeSafeRatio(sem, chg),
        uniqueCoverageRatio: Math.min(1, computeSafeRatio(uniq, proc)),
        scoreFloor: score,
        scoreCeiling: score,
    };
}

function normalizeLegacyWeeklySummary(parsed: WeeklyTrajectorySummary): void {
    if (!parsed) {
        return;
    }
    const baseLines = resolveLegacyBaseLines(parsed.eloc, parsed.totalRuns);
    normalizeLegacyDebtYield(parsed.debt, baseLines);
    normalizeLegacyQedMean(parsed.qed);
    normalizeLegacyStability(parsed);
}

async function loadWeeklySummaryFile(filePath: string): Promise<WeeklyTrajectorySummary | null> {
    try {
        const raw = await fs.promises.readFile(filePath, 'utf8');
        const parsed = JSON.parse(raw) as WeeklyTrajectorySummary;
        const hadStability = Boolean(parsed.stability);
        normalizeLegacyWeeklySummary(parsed);
        if (!hadStability) {
            await fs.promises.writeFile(filePath, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
        }
        return parsed;
    } catch {
        return null;
    }
}

/**
 * Loads all valid weekly trajectory summaries from the partitions directory.
 */
async function readWeeklySummaries(weeklyDir: string): Promise<WeeklyTrajectorySummary[]> {
    const allFiles = await fs.promises.readdir(weeklyDir);
    const summaryFiles = allFiles.filter((fileName) => fileName.endsWith('.summary.json'));
    const summaries: WeeklyTrajectorySummary[] = [];

    for (const file of summaryFiles) {
        const summary = await loadWeeklySummaryFile(path.join(weeklyDir, file));
        if (summary) {
            summaries.push(summary);
        }
    }
    return summaries;
}

/**
 * Compacts the active ledger into weekly partition files and lifetime summary,
 * then prunes active-runs.ndjson to the maximum rolling window.
 * Idempotent compaction process; requires external synchronization to prevent
 * overlapping compactions.
 *
 * @param ledgerDir - Root trajectory ledger directory.
 * @param maxRollingRuns - Maximum number of active runs to keep in active-runs.ndjson.
 * @returns Array of generated weekly summaries.
 */
/**
 * Appends a trajectory record into its ISO-week group, allocating on first encounter.
 *
 * @param groups - Map of week IDs to trajectory records.
 * @param weekId - ISO week identifier.
 * @param record - Compact trajectory record.
 */
function appendWeekRecord(
    groups: Map<string, CompactTrajectoryRecord[]>,
    weekId: string,
    record: CompactTrajectoryRecord,
): void {
    const group = groups.get(weekId);
    if (group !== undefined) {
        group.push(record);
        return;
    }
    groups.set(weekId, [record]);
}

/**
 * Compacts trajectory execution records into weekly summarized checkpoints,
 * pruning older rolling runs beyond the retention limit.
 * Concurrency: Thread-safe across disjoint ledger targets; write operations perform atomic swaps.
 *
 * @param ledgerDir Directory path hosting execution ledger ndjson files
 * @param maxRollingRuns Maximum number of rolling runs retained in active ledger
 * @returns Array of weekly trajectory summary reports generated
 */
export async function compactLedger(
    ledgerDir: string,
    maxRollingRuns = DEFAULT_MAX_ROLLING_RUNS,
): Promise<WeeklyTrajectorySummary[]> {
    ensureLedgerDirectory(ledgerDir);
    const records = await readRecentRecords(ledgerDir, 10000);
    if (records.length === 0) {
        return [];
    }

    // Group records by ISO Week
    const weekGroups = new Map<string, CompactTrajectoryRecord[]>();
    for (const record of records) {
        appendWeekRecord(weekGroups, getIsoWeekId(record.t), record);
    }

    const summaries: WeeklyTrajectorySummary[] = [];
    const weeklyDir = path.join(ledgerDir, 'weekly-summaries');

    for (const [weekId, weekRecords] of weekGroups.entries()) {
        const summary = aggregateRecords(weekRecords, weekId);
        const resolved = await saveWeeklyPartitionSummary(weeklyDir, weekId, summary);
        summaries.push(resolved);
    }

    // Read all weekly summaries in weeklyDir to construct global lifetime summary
    const allWeeklySummaries = await readWeeklySummaries(weeklyDir);
    const lifetimeSummary =
        allWeeklySummaries.length > 0
            ? aggregateWeeklySummaries(allWeeklySummaries)
            : aggregateRecords(records, 'LIFETIME');

    await writeLifetimeSummary(ledgerDir, lifetimeSummary);

    // Prune active runs file if oversized to maintain bounded rolling retention
    const activeFile = path.join(ledgerDir, 'active-runs.ndjson');
    await pruneActiveRuns(activeFile, maxRollingRuns);

    return summaries;
}
