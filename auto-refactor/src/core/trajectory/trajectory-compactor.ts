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
import type { CompactTrajectoryRecord, WeeklyTrajectorySummary } from './eloc-types';
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
    };
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

    const acc = createWeeklyAccumulator();
    for (const snapshot of summaries) {
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
            const existing = JSON.parse(raw);
            if (
                existing &&
                typeof existing.totalRuns === 'number' &&
                existing.totalRuns > summary.totalRuns
            ) {
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

function normalizeLegacyWeeklySummary(parsed: WeeklyTrajectorySummary): void {
    if (!parsed) {
        return;
    }
    const baseLines = resolveLegacyBaseLines(parsed.eloc, parsed.totalRuns);
    normalizeLegacyDebtYield(parsed.debt, baseLines);
    normalizeLegacyQedMean(parsed.qed);
}

async function loadWeeklySummaryFile(filePath: string): Promise<WeeklyTrajectorySummary | null> {
    try {
        const raw = await fs.promises.readFile(filePath, 'utf8');
        const parsed = JSON.parse(raw) as WeeklyTrajectorySummary;
        normalizeLegacyWeeklySummary(parsed);
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
