/**
 * Module: Daemon — Immutable Snapshot Scan Handler
 * File Path: src/daemon/snapshot-handler.ts
 * Architecture Role: Daemon-side handler for immutable `SourceSnapshot` audit requests dispatched
 *   from Taxis or IDE clients via the NDJSON `scan_snapshot` frame.
 * Dependencies & Triggers: Node path, ../core/types, ../core/praxis/client/workspace-execution,
 *   ../core/reporting/aas-reporter, ../core/review/source-snapshot, ./protocol, and
 *   ./snapshot-validation. Triggered by ./server on incoming `scan_snapshot` frames.
 * Responsibilities: Bind validated configuration and entries into an immutable `SourceSnapshot`,
 *   run `executeWorkspaceReview`, and emit 10D, ADR-Q, SQALE, and AAS v1.0 telemetry.
 * Exit Semantics & Design Rationale: Rejects invalid configs/entries via `./snapshot-validation`
 *   before touching disk trees; propagates errors so `./server` returns `SCAN_FAILED`.
 */

import * as path from 'node:path';
import type { ScanReport } from '../core/types';
import { executeWorkspaceReview } from '../core/praxis/client/workspace-execution';
import { buildAasReport } from '../core/reporting/aas-reporter';
import { captureSourceSnapshot } from '../core/review/source-snapshot';
import type { SnapshotScanEntryInput } from './protocol';
import type { SnapshotScanOptions } from './snapshot-validation';
import {
    buildSnapshotCaptureEntry,
    deriveSnapshotTreeSha1,
    resolveValidatedSnapshotConfig,
    sanitizeRepositoryId,
} from './snapshot-validation';

const KIB_BYTES = 1024;
const MIB_BYTES = KIB_BYTES * KIB_BYTES;
const DEFAULT_BLOB_MIB = 4;
const DEFAULT_TOTAL_MIB = 64;
const ALGO_GIT_SHA1 = 'git-sha1' as const;
const DEFAULT_SNAPSHOT_MAX_ENTRIES = 50_000;
const DEFAULT_SNAPSHOT_MAX_BLOB_BYTES = DEFAULT_BLOB_MIB * MIB_BYTES;
const DEFAULT_SNAPSHOT_MAX_TOTAL_BYTES = DEFAULT_TOTAL_MIB * MIB_BYTES;

export type { SnapshotScanOptions };

/**
 * Execute an immutable SourceSnapshot scan returning 10D, ADR-Q, SQALE, and AAS v1.0 output.
 * Fails closed on invalid/missing archetype, malformed paths, or SHA-1/byte-length mismatches.
 * ASYNC-CONCURRENCY: Stateless per-request snapshot review safe for concurrent async dispatch.
 *
 * @param configJson - Raw scan configuration containing `root` and valid `archetype`.
 * @param entries - Snapshot entries captured by caller (`content` or `bytesBase64`).
 * @param options - Snapshot bounds, repository identity, tree SHA-1, and cancellation signal.
 * @returns Finalized ScanReport paired with snapshot identity, coverage, and AAS telemetry.
 */
export async function handleSnapshotScan(
    configJson: Record<string, unknown>,
    entries: SnapshotScanEntryInput[],
    options: SnapshotScanOptions = {},
): Promise<{ report: ScanReport; stats: Record<string, unknown> }> {
    const startTimeMs = Date.now();
    options.signal?.throwIfAborted();
    const resolvedConfig = resolveValidatedSnapshotConfig(configJson, options.signal);
    if (!Array.isArray(entries) || entries.length === 0) {
        throw new Error('SNAPSHOT_EMPTY: scan_snapshot requires at least one entry');
    }
    const captureEntries = entries.map(buildSnapshotCaptureEntry);
    const treeValue = options.treeSha1 ?? deriveSnapshotTreeSha1(captureEntries);
    const repositoryId = sanitizeRepositoryId(
        options.repositoryId ?? path.basename(path.resolve(resolvedConfig.root)),
    );
    const snapshot = captureSourceSnapshot(
        { repositoryId, tree: { algorithm: ALGO_GIT_SHA1, value: treeValue } },
        captureEntries,
        {
            maxEntries: Math.min(
                options.maxEntries ?? DEFAULT_SNAPSHOT_MAX_ENTRIES,
                DEFAULT_SNAPSHOT_MAX_ENTRIES,
            ),
            maxBlobBytes: Math.min(
                options.maxBlobBytes ?? DEFAULT_SNAPSHOT_MAX_BLOB_BYTES,
                DEFAULT_SNAPSHOT_MAX_BLOB_BYTES,
            ),
            maxTotalBytes: Math.min(
                options.maxTotalBytes ?? DEFAULT_SNAPSHOT_MAX_TOTAL_BYTES,
                DEFAULT_SNAPSHOT_MAX_TOTAL_BYTES,
            ),
        },
    );
    const workspace = await executeWorkspaceReview(resolvedConfig, snapshot);
    const aas = buildAasReport(workspace.report);
    return {
        report: workspace.report,
        stats: {
            daemonUsed: true,
            daemonMs: Date.now() - startTimeMs,
            snapshotEntries: snapshot.entries.length,
            treeSha1: snapshot.identity.tree.value,
            manifestDigest: snapshot.identity.manifestDigest.value,
            execution: workspace.execution,
            aas,
        },
    };
}
