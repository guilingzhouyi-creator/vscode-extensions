/**
 * Module: Daemon — One-Shot Snapshot & Slice Client Wrappers
 * File Path: src/daemon/snapshot-client.ts
 * Architecture Role: Client convenience wrappers for immutable `scan_snapshot` and fine-grained
 *   `slice_audit` IPC requests routed over `DaemonClient` and `runOneShotDaemon`.
 * Dependencies & Triggers: ../core/types, ../core/logger, ./client, and ./protocol; re-exported
 *   through ./index for workspace tooling, tests, and Taxis bridge callers.
 * Responsibilities: Advertise `SnapshotScanParams` and `SliceAuditParams` bundles, verify server
 *   capability negotiation (`hasSnapshotCap` / `hasSliceCap`), dispatch extended IPC frames, and
 *   degrade cleanly to null when no warm daemon supports the requested capability.
 * Exit Semantics & Design Rationale: Owns one transient client connection per one-shot call and
 *   closes sockets on completion or fault, keeping transport framing decoupled from callers.
 */

import type { ScanReport } from '../core/types';
import type { Logger } from '../core/logger';
import { runOneShotDaemon } from './client';
import type { SnapshotScanEntryInput } from './protocol';

const FRAME_SCAN_SNAPSHOT = 'scan_snapshot' as const;
const FRAME_SLICE_AUDIT = 'slice_audit' as const;

/** Parameters for executing a one-shot immutable snapshot scan against the daemon. */
export interface SnapshotScanParams {
    readonly root: string;
    readonly config: Record<string, unknown>;
    readonly entries: SnapshotScanEntryInput[];
    readonly options?: {
        repositoryId?: string;
        treeSha1?: string;
        maxEntries?: number;
        maxBlobBytes?: number;
        maxTotalBytes?: number;
    };
    readonly logger?: Logger;
}

/**
 * One-shot snapshot scan: connect, verify `snapshot` capability, execute `scan_snapshot`, and
 * close. Returns null whenever the daemon is unavailable or lacks `snapshot` support.
 *
 * @param params - Root, config, immutable snapshot entries, bounds, and optional logger.
 * @returns Full finalized ScanReport paired with telemetry stats, or null when unusable.
 */
export function trySnapshotScan(
    params: SnapshotScanParams,
): Promise<{ report: ScanReport; stats: Record<string, unknown> } | null> {
    return runOneShotDaemon({
        root: params.root,
        logger: params.logger,
        label: 'snapshot scan',
        checkCap: (client) => client.hasSnapshotCap(),
        execute: (client) =>
            client.requestExtended((id, requestId) => ({
                v: 1,
                id,
                type: FRAME_SCAN_SNAPSHOT,
                params: {
                    requestId,
                    config: params.config,
                    entries: params.entries,
                    options: params.options ?? {},
                },
            })) as Promise<{ report: ScanReport; stats: Record<string, unknown> }>,
    });
}

/** Parameters for executing a one-shot fine-grained AST slice audit against the daemon. */
export interface SliceAuditParams {
    readonly root: string;
    readonly filePath: string;
    readonly oldContent: string;
    readonly newContent: string;
    readonly changedLines?: number[];
    readonly logger?: Logger;
}

/**
 * One-shot slice audit: connect, verify `slice` capability, run `slice_audit`, and close.
 * Returns null whenever the daemon is unavailable or lacks `slice` support.
 *
 * @param params - Root, filePath, before/after content, changedLines, and optional logger.
 * @returns Extracted AST slices paired with durationMs, or null when unusable.
 */
export function trySliceAudit(
    params: SliceAuditParams,
): Promise<{ slices: unknown[]; durationMs: number } | null> {
    return runOneShotDaemon({
        root: params.root,
        logger: params.logger,
        label: 'slice audit',
        checkCap: (client) => client.hasSliceCap(),
        execute: async (client) => {
            const { report, stats } = await client.requestExtended((id, requestId) => ({
                v: 1,
                id,
                type: FRAME_SLICE_AUDIT,
                params: {
                    requestId,
                    filePath: params.filePath,
                    oldContent: params.oldContent,
                    newContent: params.newContent,
                    changedLines: params.changedLines,
                },
            }));
            const slices = ((report as { slices?: unknown[] })?.slices ?? []) as unknown[];
            const durationMs = Number((stats as { durationMs?: number })?.durationMs ?? 0);
            return { slices, durationMs };
        },
    });
}
