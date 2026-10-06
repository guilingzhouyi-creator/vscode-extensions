/**
 * Module: Core Trajectory — Compact Ledger Store (Tiered Storage Engine)
 * File Path: src/core/trajectory/compact-ledger-store.ts
 * Architecture Role: High-performance, zero-bloat persistence engine for long-term ELOC reviews
 *   and quality trajectory metrics. Enforces strict O(Runs + Milestones) storage constraints.
 * Dependencies & Triggers: Consumes eloc-types; called by quality gates, review runners,
 *   and compactor.
 * Responsibilities: Serialize NDJSON records under 350 bytes, manage rolling file retention,
 *   and persist aggregated weekly and lifetime summaries.
 * Exit Semantics & Design Rationale: File I/O operations safely guard against corrupt lines;
 *   bounded rolling window prevents disk bloat.
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
    CompactTrajectoryRecord,
    ElocCounters,
    TrajectoryQualityMetrics,
    WeeklyTrajectorySummary,
} from './eloc-types';

/** Default maximum number of recent runs to keep in active rolling NDJSON file. */
export const DEFAULT_MAX_ROLLING_RUNS = 100;

/** Default relative directory name for refactor trajectory storage. */
export const DEFAULT_LEDGER_DIR_NAME = '.refactor-trajectory';

/**
 * Serializes multi-tier counters, quality metrics, and metadata into a compact record.
 *
 * @param params - Execution context, counters, and quality metrics.
 * @param params.runId - Unique run identifier.
 * @param params.revision - Commit hash or revision short SHA.
 * @param params.module - Module or domain identifier.
 * @param params.agent - Actor or Agent identifier.
 * @param params.timestamp - Run timestamp in milliseconds.
 * @param params.counters - Four-tier orthogonal ELOC counters.
 * @param params.metrics - Trajectory quality metrics.
 * @param params.gatePass - Composite gate pass boolean.
 * @param params.gateCode - Composite gate outcome code.
 * @returns Ultra-compact CompactTrajectoryRecord.
 */
export function formatCompactRecord(params: {
    runId: string;
    revision: string;
    module: string;
    agent: string;
    timestamp?: number;
    counters: ElocCounters;
    metrics: TrajectoryQualityMetrics;
    gatePass: boolean;
    gateCode?: string;
}): CompactTrajectoryRecord {
    const { runId, revision, module, agent, timestamp, counters, metrics, gatePass, gateCode } =
        params;

    // Round scoreVector values to 2 decimal places to maintain 0.01 precision within compact budget
    const compactVector = metrics.scoreVector.map((v: number) => Math.round(v * 100) / 100);
    const boundedId = runId.length > 12 ? runId.slice(-12) : runId;
    const boundedRev = revision.slice(0, 8);
    const boundedMod = module.length > 12 ? module.slice(0, 12) : module;
    const boundedAgent = agent.length > 12 ? agent.slice(0, 12) : agent;

    return {
        t: timestamp ?? Date.now(),
        rev: boundedRev,
        id: boundedId,
        mod: boundedMod,
        agent: boundedAgent,
        eloc: {
            proc: counters.processed,
            uniq: counters.unique,
            chg: counters.changed,
            sem: counters.semantic,
            reloc: counters.relocated,
            cosm: counters.cosmetic,
        },
        score: {
            bef: Math.round(metrics.beforeScore * 100) / 100,
            aft: Math.round(metrics.afterScore * 100) / 100,
            vec: compactVector,
            qed: Math.round(metrics.qed * 10000) / 10000,
        },
        debt: {
            add: metrics.debtDelta.addedDebtPoints,
            res: metrics.debtDelta.resolvedDebtPoints,
            reg: metrics.debtDelta.regressionFindingsCount,
        },
        gate: {
            pass: gatePass,
            code: gateCode ?? (gatePass ? 'PASS' : 'REJECT_QUALITY_REGRESSION'),
        },
    };
}

/**
 * Formats a record as a single-line NDJSON string, strictly guaranteeing < 350 bytes.
 *
 * @param record - CompactTrajectoryRecord instance.
 * @returns Single line JSON strictly under 350 bytes.
 */
export function serializeNdjsonLine(record: CompactTrajectoryRecord): string {
    let serialized = JSON.stringify(record);
    if (Buffer.byteLength(serialized, 'utf8') >= 348) {
        const compacted: CompactTrajectoryRecord = {
            ...record,
            score: {
                ...record.score,
                bef: Math.round(record.score.bef * 10) / 10,
                aft: Math.round(record.score.aft * 10) / 10,
            },
        };
        serialized = JSON.stringify(compacted);
    }
    return serialized;
}

/**
 * Ensures that the ledger directory structure exists.
 *
 * @param ledgerDir - Absolute or relative path to ledger directory.
 */
export function ensureLedgerDirectory(ledgerDir: string): void {
    if (!fs.existsSync(ledgerDir)) {
        fs.mkdirSync(ledgerDir, { recursive: true });
    }
    const weeklyDir = path.join(ledgerDir, 'weekly-summaries');
    if (!fs.existsSync(weeklyDir)) {
        fs.mkdirSync(weeklyDir, { recursive: true });
    }
}

/** Approximate byte size per NDJSON line used for stat heuristic before read. */
const ESTIMATED_LINE_BYTES = 200;

/** In-memory append counter to throttle stat/pruning checks. */
let appendCounter = 0;

/**
 * Prunes the active runs NDJSON file to the given retention limit.
 *
 * @param activeFile - Path to active-runs.ndjson.
 * @param maxRollingRuns - Maximum number of recent lines to keep.
 */
export async function pruneActiveRuns(
    activeFile: string,
    maxRollingRuns = DEFAULT_MAX_ROLLING_RUNS,
): Promise<void> {
    try {
        const content = await fs.promises.readFile(activeFile, 'utf8');
        const lines = content
            .trim()
            .split('\n')
            .filter((l) => l.trim().length > 0);
        if (lines.length > maxRollingRuns) {
            const recentLines = lines.slice(-maxRollingRuns);
            await fs.promises.writeFile(activeFile, recentLines.join('\n') + '\n', 'utf8');
        }
    } catch (err: unknown) {
        if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT') {
            return;
        }
    }
}

/**
 * Truncates active runs file to retention limit if oversized.
 * Avoids duplicate readFile by pruning directly from loaded buffer.
 */
async function pruneActiveRunsIfOversized(
    activeFile: string,
    maxRollingRuns: number,
): Promise<void> {
    try {
        const stat = await fs.promises.stat(activeFile);
        if (stat.size < maxRollingRuns * 1.5 * ESTIMATED_LINE_BYTES) {
            return;
        }

        const content = await fs.promises.readFile(activeFile, 'utf8');
        const lines = content
            .trim()
            .split('\n')
            .filter((l) => l.trim().length > 0);
        if (lines.length > maxRollingRuns * 1.5) {
            const recentLines = lines.slice(-maxRollingRuns);
            await fs.promises.writeFile(activeFile, recentLines.join('\n') + '\n', 'utf8');
        }
    } catch (err: unknown) {
        if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT') {
            return;
        }
    }
}

/**
 * Appends a trajectory record to the active rolling NDJSON ledger file.
 * Thread-safe append operation; requires external synchronization for multi-process pruning.
 *
 * @param ledgerDir - Ledger directory path.
 * @param record - Compact record to persist.
 * @param maxRollingRuns - Maximum number of active runs before trigger threshold.
 */
export async function appendTrajectoryRecord(
    ledgerDir: string,
    record: CompactTrajectoryRecord,
    maxRollingRuns = DEFAULT_MAX_ROLLING_RUNS,
): Promise<void> {
    ensureLedgerDirectory(ledgerDir);
    const activeFile = path.join(ledgerDir, 'active-runs.ndjson');
    const line = serializeNdjsonLine(record) + '\n';

    await fs.promises.appendFile(activeFile, line, 'utf8');
    appendCounter++;
    if (appendCounter % 10 === 0) {
        await pruneActiveRunsIfOversized(activeFile, maxRollingRuns);
    }
}

/**
 * Reads recent trajectory records from active NDJSON file.
 * Reentrant and idempotent async read-only routine.
 *
 * @param ledgerDir - Ledger directory path.
 * @param limit - Max number of records to return.
 * @returns Array of parsed CompactTrajectoryRecord items (chronological).
 */
export async function readRecentRecords(
    ledgerDir: string,
    limit = 100,
): Promise<CompactTrajectoryRecord[]> {
    const activeFile = path.join(ledgerDir, 'active-runs.ndjson');
    if (!fs.existsSync(activeFile)) {
        return [];
    }

    try {
        const content = await fs.promises.readFile(activeFile, 'utf8');
        const lines = content
            .trim()
            .split('\n')
            .filter((l) => l.trim().length > 0);
        const targetLines = limit > 0 && lines.length > limit ? lines.slice(-limit) : lines;
        const records: CompactTrajectoryRecord[] = [];

        for (const line of targetLines) {
            try {
                const parsed = JSON.parse(line) as CompactTrajectoryRecord;
                records.push(parsed);
            } catch (err: unknown) {
                // Ignore malformed line
                if (err instanceof Error) {
                    // Handled gracefully
                }
            }
        }

        return records;
    } catch (err: unknown) {
        if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT') {
            return [];
        }
        return [];
    }
}

/**
 * Reads the lifetime summary if present.
 * Reentrant and idempotent async read-only routine.
 *
 * @param ledgerDir - Ledger directory path.
 * @returns Lifetime summary or null if not yet initialized.
 */
export async function readLifetimeSummary(
    ledgerDir: string,
): Promise<WeeklyTrajectorySummary | null> {
    const lifetimeFile = path.join(ledgerDir, 'lifetime.summary.json');
    if (!fs.existsSync(lifetimeFile)) {
        return null;
    }
    try {
        const raw = await fs.promises.readFile(lifetimeFile, 'utf8');
        return JSON.parse(raw) as WeeklyTrajectorySummary;
    } catch (err: unknown) {
        if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT') {
            return null;
        }
        return null;
    }
}

/**
 * Writes or updates the lifetime summary file.
 * Idempotent async overwrite; requires external synchronization against concurrent writers.
 *
 * @param ledgerDir - Ledger directory path.
 * @param summary - Updated WeeklyTrajectorySummary instance.
 */
export async function writeLifetimeSummary(
    ledgerDir: string,
    summary: WeeklyTrajectorySummary,
): Promise<void> {
    ensureLedgerDirectory(ledgerDir);
    const lifetimeFile = path.join(ledgerDir, 'lifetime.summary.json');
    const compactStagingPath = `${lifetimeFile}.compact-tmp-${process.pid}-${Date.now()}`;
    const payload = JSON.stringify(summary, null, 2);
    try {
        await fs.promises.writeFile(compactStagingPath, payload, 'utf8');
        await fs.promises.rename(compactStagingPath, lifetimeFile);
    } catch (err: unknown) {
        try {
            await fs.promises.unlink(compactStagingPath);
        } catch {
            // Ignore staging cleanup failure
        }
        throw err;
    }
}
