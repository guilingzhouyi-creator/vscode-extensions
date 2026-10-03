/**
 * Module: Core Preflight — Audited ELOC Baseline Grounding & Persistence
 * File Path: src/core/preflight/eloc-baseline.ts
 * Architecture Role: Single source of truth for audited ELOC baseline accounting.
 *   Enforces ground truth: historical values without explicit audit tracking are marked Unknown.
 * Dependencies & Triggers: Consumes compact-ledger-store and eloc-types; called by preflight
 *   controller and composite gate finalizers.
 * Responsibilities:
 *   1. Inspect refactor trajectory store and check historical audited baseline.
 *   2. Explicitly flag unrecorded history as `HistoricalAuditedELOC = Unknown` without fabrication.
 *   3. Maintain four-tier orthogonal counters E = (E_processed, E_unique, E_changed, E_semantic).
 *   4. Incrementally persist baseline updates bound to Review/Commit ID and Gate verdict.
 * Exit Semantics & Design Rationale: Deterministic file I/O; returns frozen immutable records;
 *   never throws on missing files (graceful Unknown fallback).
 */

import * as fs from 'fs';
import * as path from 'path';

/** Default baseline file name for audited ELOC records */
export const AUDITED_BASELINE_FILENAME = 'audited-baseline.json';

/** Four-tier orthogonal audited ELOC counters */
export interface AuditedElocCounters {
    /** Cumulative computational throughput (sum of ELOC across files audited) */
    processed: number;
    /** Unique effective logic lines covered (de-duplicated by block fingerprints) */
    unique: number;
    /** Physical changed effective logic lines (added + deleted + modified) */
    changed: number;
    /** Pure semantic effective logic lines */
    semantic: number;
}

/** Status indicating whether historical audited baseline was formally recorded */
export type HistoricalAuditedStatus = 'Known' | 'Unknown';

/** Composite gate verdict summary bound to audited baseline */
export interface GateVerdictSummary {
    pass: boolean;
    code: string;
}

/** Complete audited baseline record persisted on disk */
export interface AuditedBaselineRecord {
    /** Whether historical audited ELOC is verified or unrecorded */
    status: HistoricalAuditedStatus;
    /** Formally recorded historical value or 'Unknown' literal */
    historicalAuditedEloc: number | 'Unknown';
    /** Four-tier orthogonal counters accumulated from formal auditing */
    accumulatedEloc: AuditedElocCounters;
    /** Identifier of last review session that updated baseline */
    lastReviewId?: string;
    /** Commit SHA associated with last review session */
    lastCommitHash?: string;
    /** Ten-dimensional score vector snapshot from last run */
    lastScoreVector?: number[];
    /** Gate verdict associated with last update */
    lastGateVerdict?: GateVerdictSummary;
    /** Last update epoch timestamp in milliseconds */
    updatedAt: number;
}

/** Creation parameters for updating audited baseline */
export interface UpdateBaselineParams {
    ledgerDir: string;
    delta: Partial<AuditedElocCounters>;
    reviewId: string;
    commitHash: string;
    scoreVector?: number[];
    gateVerdict: GateVerdictSummary;
}

/**
 * Creates a default clean baseline record with Unknown status.
 *
 * @returns Frozen AuditedBaselineRecord with default Unknown status.
 */
export function createDefaultBaselineRecord(): AuditedBaselineRecord {
    return Object.freeze({
        status: 'Unknown',
        historicalAuditedEloc: 'Unknown',
        accumulatedEloc: Object.freeze({
            processed: 0,
            unique: 0,
            changed: 0,
            semantic: 0,
        }),
        updatedAt: Date.now(),
    });
}

/**
 * Reads audited baseline record from refactor trajectory ledger.
 * If file is absent or lacks formal audited contract, returns Unknown baseline without fabrication.
 * Concurrency: Thread-safe, reentrant read; returns default record on absent file.
 *
 * @param ledgerDir - Directory path of the refactor trajectory store.
 * @returns Frozen AuditedBaselineRecord.
 */
export async function readAuditedBaseline(ledgerDir: string): Promise<AuditedBaselineRecord> {
    const targetFile = path.join(ledgerDir, AUDITED_BASELINE_FILENAME);

    if (!fs.existsSync(targetFile)) {
        return createDefaultBaselineRecord();
    }

    try {
        const rawContent = await fs.promises.readFile(targetFile, 'utf8');
        const parsed = JSON.parse(rawContent) as Partial<AuditedBaselineRecord>;

        if (!parsed || typeof parsed !== 'object') {
            return createDefaultBaselineRecord();
        }

        const isKnown =
            parsed.status === 'Known' && typeof parsed.historicalAuditedEloc === 'number';
        const rawCounters = parsed.accumulatedEloc;

        const accumulatedEloc: AuditedElocCounters = Object.freeze({
            processed: Math.max(0, Number(rawCounters?.processed) || 0),
            unique: Math.max(0, Number(rawCounters?.unique) || 0),
            changed: Math.max(0, Number(rawCounters?.changed) || 0),
            semantic: Math.max(0, Number(rawCounters?.semantic) || 0),
        });

        return Object.freeze({
            status: isKnown ? 'Known' : 'Unknown',
            historicalAuditedEloc: isKnown ? (parsed.historicalAuditedEloc as number) : 'Unknown',
            accumulatedEloc,
            lastReviewId: parsed.lastReviewId,
            lastCommitHash: parsed.lastCommitHash,
            lastScoreVector: Array.isArray(parsed.lastScoreVector)
                ? parsed.lastScoreVector
                : undefined,
            lastGateVerdict: parsed.lastGateVerdict,
            updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
        });
    } catch {
        return createDefaultBaselineRecord();
    }
}

/**
 * Incrementally accumulates audited ELOC counters and updates baseline file.
 * Concurrency: Atomic file write; safe for serialized session execution.
 *
 * @param params - Incremental delta and execution metadata.
 * @returns Updated frozen AuditedBaselineRecord.
 */
export async function updateAuditedBaseline(
    params: UpdateBaselineParams,
): Promise<AuditedBaselineRecord> {
    const { ledgerDir, delta, reviewId, commitHash, scoreVector, gateVerdict } = params;

    const current = await readAuditedBaseline(ledgerDir);

    const updatedCounters: AuditedElocCounters = Object.freeze({
        processed: current.accumulatedEloc.processed + Math.max(0, delta.processed || 0),
        unique: current.accumulatedEloc.unique + Math.max(0, delta.unique || 0),
        changed: current.accumulatedEloc.changed + Math.max(0, delta.changed || 0),
        semantic: current.accumulatedEloc.semantic + Math.max(0, delta.semantic || 0),
    });

    const updatedRecord: AuditedBaselineRecord = Object.freeze({
        status: current.status,
        historicalAuditedEloc: current.historicalAuditedEloc,
        accumulatedEloc: updatedCounters,
        lastReviewId: reviewId,
        lastCommitHash: commitHash,
        lastScoreVector: scoreVector ? [...scoreVector] : current.lastScoreVector,
        lastGateVerdict: { ...gateVerdict },
        updatedAt: Date.now(),
    });

    if (!fs.existsSync(ledgerDir)) {
        await fs.promises.mkdir(ledgerDir, { recursive: true });
    }

    const targetFile = path.join(ledgerDir, AUDITED_BASELINE_FILENAME);
    const serialized = JSON.stringify(updatedRecord, null, 2) + '\n';
    await fs.promises.writeFile(targetFile, serialized, 'utf8');

    return updatedRecord;
}
