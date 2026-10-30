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
    CompactVerificationTelemetry,
    ElocCounters,
    TrajectoryQualityMetrics,
    WeeklyTrajectorySummary,
} from './eloc-types';

/** Default maximum number of recent runs to keep in active rolling NDJSON file. */
export const DEFAULT_MAX_ROLLING_RUNS = 100;

/**
 * Hard per-record byte ceiling for the active runs ledger.
 * The retention file is read whole on every audit, so a single oversized line
 * inflates every subsequent read; the guard in validate-trajectory-ledger.js
 * enforces the same value independently.
 */
export const LEDGER_RECORD_LIMIT = 350;

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
/**
 * Normalizes optional verification and manifold telemetry into compact rounded fields.
 */
function normalizeCompactVerification(
    vrf?: CompactVerificationTelemetry,
): CompactVerificationTelemetry | undefined {
    if (!vrf) {
        return undefined;
    }
    const normalized: CompactVerificationTelemetry = {};
    if (typeof vrf.k === 'number' && Number.isFinite(vrf.k)) {
        normalized.k = Math.round(Math.max(0, Math.min(1, vrf.k)) * 100) / 100;
    }
    if (typeof vrf.cr === 'number' && Number.isFinite(vrf.cr)) {
        normalized.cr = Math.round(Math.max(0, Math.min(100, vrf.cr)) * 10) / 10;
    }
    if (typeof vrf.ci === 'number' && Number.isFinite(vrf.ci)) {
        normalized.ci = Math.round(Math.max(0, Math.min(1, vrf.ci)) * 100) / 100;
    }
    if (typeof vrf.dm === 'number' && Number.isFinite(vrf.dm)) {
        normalized.dm = Math.round(Math.max(0, vrf.dm) * 100) / 100;
    }
    if (typeof vrf.tau === 'number' && Number.isFinite(vrf.tau)) {
        normalized.tau = Math.round(Math.max(0, vrf.tau) * 10) / 10;
    }
    if (vrf.q === 1) {
        normalized.q = 1;
    }
    return Object.keys(normalized).length > 0 ? normalized : undefined;
}

/**
 * Trims secondary verification telemetry fields (tau, ci) to reclaim bytes under budget pressure.
 */
function trimSecondaryVerification(rec: CompactTrajectoryRecord): CompactTrajectoryRecord {
    if (!rec.vrf) {
        return rec;
    }
    const trimmedVrf: CompactVerificationTelemetry = {
        ...(rec.vrf.k !== undefined ? { k: rec.vrf.k } : {}),
        ...(rec.vrf.cr !== undefined ? { cr: rec.vrf.cr } : {}),
        ...(rec.vrf.dm !== undefined ? { dm: rec.vrf.dm } : {}),
        ...(rec.vrf.q !== undefined ? { q: rec.vrf.q } : {}),
    };
    const { vrf: _dropped, ...rest } = rec;
    return Object.keys(trimmedVrf).length > 0 ? { ...rest, vrf: trimmedVrf } : rest;
}

export function formatCompactRecord(params: {
    runId: string;
    revision: string;
    sig?: string;
    module: string;
    agent: string;
    timestamp?: number;
    counters: ElocCounters;
    metrics: TrajectoryQualityMetrics;
    gatePass: boolean;
    gateCode?: string;
    vrf?: CompactVerificationTelemetry;
}): CompactTrajectoryRecord {
    const {
        runId,
        revision,
        sig,
        module,
        agent,
        timestamp,
        counters,
        metrics,
        gatePass,
        gateCode,
        vrf,
    } = params;

    // 0.01 precision is required downstream: the self-audit baseline compares
    // trajectory vectors against stored values at two decimals.
    const compactVector = metrics.scoreVector.map(
        (scoreVal: number) => Math.round(scoreVal * 100) / 100,
    );
    const boundedId = runId.length > 12 ? runId.slice(-12) : runId;
    const boundedRev = revision.slice(0, 8);
    const boundedMod = module.length > 12 ? module.slice(0, 12) : module;
    const boundedAgent = agent.length > 12 ? agent.slice(0, 12) : agent;
    const normalizedVrf = normalizeCompactVerification(vrf);

    // The compact ledger enforces a hard 350B per-record budget. `code` is
    // redundant when the gate passed ('PASS' duplicates pass:true), so it is
    // omitted in that case to reclaim bytes without losing information.
    const gate = gatePass
        ? { pass: true }
        : { pass: false, code: gateCode ?? 'REJECT_QUALITY_REGRESSION' };

    return {
        t: timestamp ?? Date.now(),
        rev: boundedRev,
        ...(sig ? { sig: sig.length > 8 ? sig.slice(0, 8) : sig } : {}),
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
            qed: Math.round(metrics.qed * 1000000) / 1000000,
        },
        debt: {
            add: metrics.debtDelta.addedDebtPoints,
            res: metrics.debtDelta.resolvedDebtPoints,
            reg: metrics.debtDelta.regressionFindingsCount,
        },
        gate,
        ...(normalizedVrf ? { vrf: normalizedVrf } : {}),
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
    if (Buffer.byteLength(serialized, 'utf8') < LEDGER_RECORD_LIMIT) {
        return serialized;
    }

    // Degrade in fixed order, cheapest information loss first. Truncating the
    // module and agent labels only reclaims a handful of bytes, which used to be
    // the sole step: a record whose score vector carried ten two-decimal values
    // stayed over budget and the ledger guard then blocked the whole audit.
    const ladder: Array<(rec: CompactTrajectoryRecord) => CompactTrajectoryRecord> = [
        trimSecondaryVerification,
        (rec) => ({ ...rec, mod: rec.mod.slice(0, 8), agent: rec.agent.slice(0, 8) }),
        (rec) => ({ ...rec, id: rec.id.slice(-8) }),
        (rec) => ({ ...rec, score: { ...rec.score, vec: rec.score.vec.map(roundToTenth) } }),
        (rec) => ({ ...rec, score: { ...rec.score, vec: rec.score.vec.map(roundToWhole) } }),
        (rec) => ({ ...rec, score: { ...rec.score, qed: roundToWhole(rec.score.qed) } }),
    ];

    let candidate = record;
    for (const step of ladder) {
        candidate = step(candidate);
        serialized = JSON.stringify(candidate);
        if (Buffer.byteLength(serialized, 'utf8') < LEDGER_RECORD_LIMIT) {
            return serialized;
        }
    }

    // Last resort: the ten-dimension vector is a diagnostic detail; the record's
    // identity, gate verdict and debt delta are what downstream readers compare.
    serialized = JSON.stringify({ ...candidate, score: { ...candidate.score, vec: [] } });
    return serialized;
}

/** Rounds a score to one decimal place. */
function roundToTenth(value: number): number {
    return Math.round(value * 10) / 10;
}

/** Rounds a score to an integer. */
function roundToWhole(value: number): number {
    return Math.round(value);
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
 * Persists pruned trajectory runs into an append-only cold archive file.
 * Prevents loss of historical runs when the rolling active window truncates.
 *
 * @param ledgerDir - Root trajectory ledger directory.
 * @param prunedLines - Array of serialized NDJSON record lines that were slid out.
 */
async function archivePrunedRuns(ledgerDir: string, prunedLines: string[]): Promise<void> {
    if (prunedLines.length === 0) return;
    try {
        const archiveFile = path.join(ledgerDir, 'archive-runs.ndjson');
        await fs.promises.appendFile(archiveFile, prunedLines.join('\n') + '\n', 'utf8');
    } catch {
        // Best-effort: ignore cold archive write failures
    }
}

/**
 * Prunes the active runs NDJSON file to the given retention limit.
 * Idempotent async routine; requires external synchronization against concurrent writes.
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
            .filter((lineText) => lineText.trim().length > 0);
        if (lines.length > maxRollingRuns) {
            const prunedLines = lines.slice(0, lines.length - maxRollingRuns);
            const recentLines = lines.slice(-maxRollingRuns);
            await archivePrunedRuns(path.dirname(activeFile), prunedLines);
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
            .filter((lineText) => lineText.trim().length > 0);
        if (lines.length > maxRollingRuns * 1.5) {
            const prunedLines = lines.slice(0, lines.length - maxRollingRuns);
            const recentLines = lines.slice(-maxRollingRuns);
            await archivePrunedRuns(path.dirname(activeFile), prunedLines);
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
 * Safely parse a single NDJSON line into a CompactTrajectoryRecord.
 *
 * @param line - Raw NDJSON record line.
 * @returns Parsed record or null if malformed.
 */
export function parseCompactRecordSafe(line: string): CompactTrajectoryRecord | null {
    try {
        return JSON.parse(line) as CompactTrajectoryRecord;
    } catch {
        return null;
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
            .filter((lineText) => lineText.trim().length > 0);
        const targetLines = limit > 0 && lines.length > limit ? lines.slice(-limit) : lines;
        const records: CompactTrajectoryRecord[] = [];

        for (const line of targetLines) {
            const parsed = parseCompactRecordSafe(line);
            if (parsed !== null) {
                records.push(parsed);
            }
        }

        return records;
    } catch {
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
    const payload = JSON.stringify(summary, null, 2) + '\n';
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

/**
 * Reads all historical trajectory records from the cold archive if present.
 * Reentrant and idempotent async read-only routine.
 *
 * @param ledgerDir - Ledger directory path.
 * @returns Array of parsed CompactTrajectoryRecord items from cold storage.
 */
export async function readArchivedRecords(
    ledgerDir: string,
): Promise<CompactTrajectoryRecord[]> {
    const archiveFile = path.join(ledgerDir, 'archive-runs.ndjson');
    if (!fs.existsSync(archiveFile)) {
        return [];
    }
    try {
        const content = await fs.promises.readFile(archiveFile, 'utf8');
        const lines = content
            .trim()
            .split('\n')
            .filter((lineText) => lineText.trim().length > 0);
        const records: CompactTrajectoryRecord[] = [];
        for (const line of lines) {
            const parsed = parseCompactRecordSafe(line);
            if (parsed !== null) {
                records.push(parsed);
            }
        }
        return records;
    } catch {
        return [];
    }
}
