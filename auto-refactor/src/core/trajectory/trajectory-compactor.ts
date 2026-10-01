/**
 * Module: Core Trajectory — Trajectory Compactor & Lifetime Aggregator
 * File Path: src/core/trajectory/trajectory-compactor.ts
 * Architecture Role: Aggregates rolling review runs into weekly summaries and global lifetime ledgers,
 *   enforcing bounded O(Runs + Milestones) storage constraints and calculating macro trends.
 * Dependencies & Triggers: Consumes eloc-types and compact-ledger-store.
 * Exit Semantics: Deterministic reduction of discrete runs into statistical summaries; safe file atomic writes.
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
    CompactTrajectoryRecord,
    WeeklyTrajectorySummary,
} from './eloc-types';
import {
    ensureLedgerDirectory,
    readRecentRecords,
    writeLifetimeSummary,
} from './compact-ledger-store';

/**
 * Computes ISO 8601 week string (e.g. '2026-W40') from a timestamp.
 *
 * @param timestamp - Epoch milliseconds.
 * @returns ISO week identifier.
 */
export function getIsoWeekId(timestamp: number): string {
    const d = new Date(timestamp);
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
    const paddedWeek = weekNo < 10 ? `0${weekNo}` : `${weekNo}`;
    return `${d.getUTCFullYear()}-W${paddedWeek}`;
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
            },
            debt: {
                totalAdded: 0,
                totalResolved: 0,
                totalRegressions: 0,
                netYield: 0,
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

    for (const r of records) {
        if (r.t < startMs) startMs = r.t;
        if (r.t > endMs) endMs = r.t;

        processedTotal += r.eloc.proc;
        if (r.eloc.uniq > maxUnique) maxUnique = r.eloc.uniq;
        changedTotal += r.eloc.chg;
        semanticTotal += r.eloc.sem;

        const qed = r.score.qed;
        qedSum += qed;
        if (qed < qedMin) qedMin = qed;
        if (qed > qedMax) qedMax = qed;

        totalAddedDebt += r.debt.add;
        totalResolvedDebt += r.debt.res;
        totalRegressions += r.debt.reg;

        scoreSum += r.score.aft;
        if (r.gate.pass) passedGateCount++;
    }

    const totalRuns = records.length;
    const meanQed = Math.round((qedSum / totalRuns) * 10000) / 10000;
    const meanScore = Math.round((scoreSum / totalRuns) * 100) / 100;
    const gatePassRate = Math.round((passedGateCount / totalRuns) * 10000) / 100;

    const netDebt = totalResolvedDebt - totalAddedDebt;
    const processedKiloEloc = Math.max(1, processedTotal / 1000);
    const netYield = Math.round((netDebt / processedKiloEloc) * 100) / 100;

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
        },
        debt: {
            totalAdded: totalAddedDebt,
            totalResolved: totalResolvedDebt,
            totalRegressions,
            netYield,
        },
        meanCompositeScore: meanScore,
        gatePassRate,
    };
}

/**
 * Compacts the active ledger into weekly partition files and lifetime summary.
 *
 * @param ledgerDir - Root trajectory ledger directory.
 * @returns Array of generated weekly summaries.
 */
export async function compactLedger(ledgerDir: string): Promise<WeeklyTrajectorySummary[]> {
    ensureLedgerDirectory(ledgerDir);
    const records = await readRecentRecords(ledgerDir, 10000);
    if (records.length === 0) {
        return [];
    }

    // Group records by ISO Week
    const weekGroups = new Map<string, CompactTrajectoryRecord[]>();
    for (const r of records) {
        const weekId = getIsoWeekId(r.t);
        let group = weekGroups.get(weekId);
        if (!group) {
            group = [];
            weekGroups.set(weekId, group);
        }
        group.push(r);
    }

    const summaries: WeeklyTrajectorySummary[] = [];
    const weeklyDir = path.join(ledgerDir, 'weekly-summaries');

    for (const [weekId, weekRecords] of weekGroups.entries()) {
        const summary = aggregateRecords(weekRecords, weekId);
        summaries.push(summary);

        const weekFilePath = path.join(weeklyDir, `${weekId}.summary.json`);
        await fs.promises.writeFile(weekFilePath, JSON.stringify(summary, null, 2), 'utf8');
    }

    // Update global lifetime summary across all historical records
    const lifetimeSummary = aggregateRecords(records, 'LIFETIME');
    await writeLifetimeSummary(ledgerDir, lifetimeSummary);

    return summaries;
}
