/**
 * Module: Core Trajectory — ELOC Review Trajectory Accumulator & Baseline Engine
 * File Path: src/core/trajectory/trajectory-accumulator.ts
 * Architecture Role: Central accumulator for continuous code review accounting
 *   and quality trajectory tracking. Accumulates scanned effective logic lines (ELOC),
 *   tracks deduplicated unique coverage across revisions, computes long-term trajectories,
 *   and initializes/maintains the baseline ledger across the workspace.
 * Dependencies & Triggers: Consumes eloc-types, block-fingerprint-cache,
 *   quality-efficiency-engine, compact-ledger-store, and trajectory-compactor.
 * Responsibilities: Accumulate multi-run ELOC metrics, record review events,
 *   and provide unified API for query and compaction.
 * Exit Semantics & Design Rationale: Deterministic, crash-resilient file persistence;
 *   guarantees strict O(Runs + Milestones) storage bounds without memory leakage.
 */

import * as path from 'path';
import type {
    CompactTrajectoryRecord,
    ElocCounters,
    TrajectoryQualityMetrics,
    WeeklyTrajectorySummary,
} from './eloc-types';
import {
    extractBlockFingerprints,
    BlockFingerprintCache,
    countBlockEloc,
} from './block-fingerprint-cache';
import { computeTrajectoryQualityMetrics } from './quality-efficiency-engine';
import {
    appendTrajectoryRecord,
    readRecentRecords,
    readLifetimeSummary,
    writeLifetimeSummary,
    formatCompactRecord,
    DEFAULT_LEDGER_DIR_NAME,
} from './compact-ledger-store';
import { compactLedger } from './trajectory-compactor';

/**
 * Options for recording a review audit run.
 */
export interface AuditRunOptions {
    /** Unique run identifier (e.g. 'run-20261002-140000'). */
    runId: string;
    /** Commit hash or revision short SHA. */
    revision: string;
    /** Module or scope identifier (e.g. 'workspace-unified', 'auto-refactor'). */
    module: string;
    /** Actor/Agent name (e.g. 'antigravity-agent', 'self-audit', 'human-dev'). */
    agent?: string;
    /** Timestamp in milliseconds. Defaults to Date.now(). */
    timestamp?: number;
    /** List of scanned files with their paths and source text contents. */
    scannedFiles: { filePath: string; content: string }[];
    /** Before composite score (or baseline score). */
    beforeScore: number;
    /** After composite score. */
    afterScore: number;
    /** 10-dimensional quality index score vector after run. */
    scoreVector?: number[];
    /** Added technical debt points. */
    addedDebtPoints?: number;
    /** Resolved technical debt points. */
    resolvedDebtPoints?: number;
    /** Regression findings count. */
    regressionFindingsCount?: number;
    /** Custom ledger directory. Defaults to `.refactor-trajectory`. */
    ledgerDir?: string;
    /** Composite gate pass boolean. */
    gatePass?: boolean;
    /** Composite gate code. */
    gateCode?: string;
    /** Explicit or incremental diff ELOC counters (if available from baseline or git diff). */
    diffCounters?: Partial<ElocCounters>;
}

/**
 * Result returned after recording an audit run into the trajectory ledger.
 */
export interface AuditRunResult {
    /** Formatted compact trajectory record. */
    record: CompactTrajectoryRecord;
    /** Updated global lifetime trajectory summary. */
    lifetimeSummary: WeeklyTrajectorySummary;
    /** Incremental ELOC counters for this specific run. */
    runEloc: ElocCounters;
    /** Trajectory quality metrics for this specific run. */
    qualityMetrics: TrajectoryQualityMetrics;
    /** Whether this run was initialized as the first baseline run. */
    isFirstBaseline: boolean;
}

/**
 * Computes aggregate processed ELOC and unique block ELOC across a batch of files.
 */
function evaluateFileBatchEloc(
    files: { filePath: string; content: string }[],
    cache: BlockFingerprintCache,
): { processedEloc: number; uniqueIncrement: number } {
    let processedEloc = 0;
    for (const f of files) {
        const fileEloc = countBlockEloc(f.content);
        processedEloc += fileEloc;
        const blocks = extractBlockFingerprints(f.filePath, f.content);
        cache.recordAndDeduplicate(blocks);
    }
    return {
        processedEloc,
        uniqueIncrement: cache.getTotalUniqueEloc(),
    };
}

/**
 * Creates default 10-dimensional score vector if not provided.
 */
function resolveScoreVector(scoreVector?: number[], fallbackScore = 100): number[] {
    if (scoreVector && scoreVector.length === 10) {
        return scoreVector;
    }
    return [
        fallbackScore,
        fallbackScore,
        fallbackScore,
        fallbackScore,
        fallbackScore,
        fallbackScore,
        fallbackScore,
        fallbackScore,
        fallbackScore,
        fallbackScore,
    ];
}

/**
 * Constructs cumulative lifetime summary from initial record.
 */
function createInitialLifetimeSummary(record: CompactTrajectoryRecord): WeeklyTrajectorySummary {
    const netDebt = record.debt.res - record.debt.add;
    const processedKiloEloc = Math.max(1, record.eloc.proc / 1000);
    const netYield = Math.round((netDebt / processedKiloEloc) * 100) / 100;

    return {
        weekId: 'LIFETIME',
        startMs: record.t,
        endMs: record.t,
        totalRuns: 1,
        eloc: {
            processedTotal: record.eloc.proc,
            uniqueTotal: record.eloc.uniq,
            changedTotal: record.eloc.chg,
            semanticTotal: record.eloc.sem,
        },
        qed: {
            mean: record.score.qed,
            min: record.score.qed,
            max: record.score.qed,
        },
        debt: {
            totalAdded: record.debt.add,
            totalResolved: record.debt.res,
            totalRegressions: record.debt.reg,
            netYield,
        },
        meanCompositeScore: record.score.aft,
        gatePassRate: record.gate.pass ? 100.0 : 0.0,
    };
}

/**
 * Updates an existing lifetime summary with a new run record.
 */
function updateLifetimeSummary(
    prev: WeeklyTrajectorySummary,
    record: CompactTrajectoryRecord,
): WeeklyTrajectorySummary {
    const totalRuns = prev.totalRuns + 1;
    const processedTotal = prev.eloc.processedTotal + record.eloc.proc;
    const uniqueTotal = Math.max(prev.eloc.uniqueTotal, record.eloc.uniq);
    const changedTotal = prev.eloc.changedTotal + record.eloc.chg;
    const semanticTotal = prev.eloc.semanticTotal + record.eloc.sem;

    const qedMin = Math.min(prev.qed.min, record.score.qed);
    const qedMax = Math.max(prev.qed.max, record.score.qed);
    const qedMean =
        Math.round(((prev.qed.mean * prev.totalRuns + record.score.qed) / totalRuns) * 10000) /
        10000;

    const totalAdded = prev.debt.totalAdded + record.debt.add;
    const totalResolved = prev.debt.totalResolved + record.debt.res;
    const totalRegressions = prev.debt.totalRegressions + record.debt.reg;

    const netDebt = totalResolved - totalAdded;
    const processedKiloEloc = Math.max(1, processedTotal / 1000);
    const netYield = Math.round((netDebt / processedKiloEloc) * 100) / 100;

    const meanCompositeScore =
        Math.round(
            ((prev.meanCompositeScore * prev.totalRuns + record.score.aft) / totalRuns) * 100,
        ) / 100;

    const prevPassedCount = (prev.gatePassRate / 100.0) * prev.totalRuns;
    const newPassedCount = prevPassedCount + (record.gate.pass ? 1 : 0);
    const gatePassRate = Math.round((newPassedCount / totalRuns) * 10000) / 100;

    return {
        weekId: 'LIFETIME',
        startMs: Math.min(prev.startMs, record.t),
        endMs: Math.max(prev.endMs, record.t),
        totalRuns,
        eloc: {
            processedTotal,
            uniqueTotal,
            changedTotal,
            semanticTotal,
        },
        qed: {
            mean: qedMean,
            min: qedMin,
            max: qedMax,
        },
        debt: {
            totalAdded,
            totalResolved,
            totalRegressions,
            netYield,
        },
        meanCompositeScore,
        gatePassRate,
    };
}

/**
 * Resolves four-tier orthogonal ELOC counters.
 */
function deriveElocCounters(
    processedEloc: number,
    uniqueIncrement: number,
    isFirstBaseline: boolean,
    existingLifetime: WeeklyTrajectorySummary | null,
    diffCounters?: Partial<ElocCounters>,
): ElocCounters {
    let uniqueCount = uniqueIncrement;
    if (!isFirstBaseline && existingLifetime) {
        uniqueCount = Math.max(existingLifetime.eloc.uniqueTotal, uniqueIncrement);
    }
    const defaultChanged = isFirstBaseline ? processedEloc : 0;
    const defaultSemantic = isFirstBaseline ? processedEloc : 0;

    return {
        processed: processedEloc,
        unique: uniqueCount,
        changed: diffCounters?.changed ?? defaultChanged,
        semantic: diffCounters?.semantic ?? defaultSemantic,
        relocated: diffCounters?.relocated ?? 0,
        cosmetic: diffCounters?.cosmetic ?? 0,
        boilerplate: diffCounters?.boilerplate ?? 0,
        added: diffCounters?.added ?? defaultChanged,
        deleted: diffCounters?.deleted ?? 0,
        modified: diffCounters?.modified ?? 0,
    };
}

/**
 * Derives technical debt delta object from run options.
 */
function deriveDebtDelta(options: AuditRunOptions) {
    const add = options.addedDebtPoints || 0;
    const res = options.resolvedDebtPoints || 0;
    const reg = options.regressionFindingsCount || 0;
    return {
        addedDebtPoints: add,
        resolvedDebtPoints: res,
        netDebtCleared: res - add,
        regressionFindingsCount: reg,
        regressionFindingIds: [] as string[],
    };
}

/**
 * Derives composite gate pass and status code.
 */
function deriveGateDecision(
    options: AuditRunOptions,
    regressionCount: number,
): {
    gatePass: boolean;
    gateCode: string;
} {
    if (typeof options.gatePass === 'boolean') {
        const pass = options.gatePass;
        const code = options.gateCode || (pass ? 'PASS' : 'GATE_REJECTED');
        return { gatePass: pass, gateCode: code };
    }
    const pass = options.afterScore >= 95.0 && regressionCount === 0;
    const code = pass ? 'PASS' : 'GATE_REJECTED';
    return { gatePass: pass, gateCode: code };
}

/**
 * Trajectory Accumulator Service: manages progressive ELOC tracking and review history.
 */
export class TrajectoryAccumulator {
    private readonly ledgerDir: string;
    private readonly fingerprintCache: BlockFingerprintCache;

    constructor(customLedgerDir?: string) {
        this.ledgerDir = customLedgerDir ?? path.join(process.cwd(), DEFAULT_LEDGER_DIR_NAME);
        this.fingerprintCache = new BlockFingerprintCache();
    }

    /**
     * Records an audit run into the persistent trajectory ledger,
     * calculating incremental and cumulative ELOC.
     */
    public async recordAuditRun(options: AuditRunOptions): Promise<AuditRunResult> {
        const targetLedgerDir = options.ledgerDir ?? this.ledgerDir;
        const existingLifetime = await readLifetimeSummary(targetLedgerDir);
        const isFirstBaseline = existingLifetime === null;

        // 1. Compute Scanned File ELOC and AST Unique Block Fingerprints
        const { processedEloc, uniqueIncrement } = evaluateFileBatchEloc(
            options.scannedFiles,
            this.fingerprintCache,
        );

        // 2. Derive Four-tier Orthogonal Counters
        const counters = deriveElocCounters(
            processedEloc,
            uniqueIncrement,
            isFirstBaseline,
            existingLifetime,
            options.diffCounters,
        );

        // 3. Compute Quality Efficiency & Technical Debt Delta
        const scoreVector = resolveScoreVector(options.scoreVector, options.afterScore);
        const debtDelta = deriveDebtDelta(options);

        const qualityMetrics = computeTrajectoryQualityMetrics({
            beforeScore: options.beforeScore,
            afterScore: options.afterScore,
            scoreVector,
            counters,
            debtDelta,
        });

        const { gatePass, gateCode } = deriveGateDecision(
            options,
            debtDelta.regressionFindingsCount,
        );

        // 4. Format Compact Record (< 350 bytes)
        const record = formatCompactRecord({
            runId: options.runId,
            revision: options.revision,
            module: options.module,
            agent: options.agent || 'auto-refactor-audit',
            timestamp: options.timestamp || Date.now(),
            counters,
            metrics: qualityMetrics,
            gatePass,
            gateCode,
        });

        // 5. Append to Active NDJSON Ledger
        await appendTrajectoryRecord(targetLedgerDir, record);

        // 6. Update Lifetime Trajectory Summary
        const updatedLifetime = existingLifetime
            ? updateLifetimeSummary(existingLifetime, record)
            : createInitialLifetimeSummary(record);

        await writeLifetimeSummary(targetLedgerDir, updatedLifetime);

        // 7. Auto-compact weekly if active runs accumulate
        await compactLedger(targetLedgerDir);

        return {
            record,
            lifetimeSummary: updatedLifetime,
            runEloc: counters,
            qualityMetrics,
            isFirstBaseline,
        };
    }

    /**
     * Reads current lifetime trajectory summary.
     */
    public async getLifetimeSummary(): Promise<WeeklyTrajectorySummary | null> {
        return readLifetimeSummary(this.ledgerDir);
    }

    /**
     * Reads recent active audit run records.
     */
    public async getRecentRuns(limit = 20): Promise<CompactTrajectoryRecord[]> {
        return readRecentRecords(this.ledgerDir, limit);
    }
}
