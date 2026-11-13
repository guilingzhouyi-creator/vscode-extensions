/**
 * Module: Daemon Subsystem — Barrel & Process Fault Resilience Facade
 * File Path: src/daemon/index.ts
 * Architecture Role: Central facade for the persistent daemon subsystem; re-exports client,
 *   server, protocol, scan handler, and registry utilities while installing process-level
 *   unhandled rejection resilience listeners to prevent daemon process crashes.
 * Dependencies & Triggers: Consumes ./server, ./client, ./protocol, ./registry, ./scanHandler;
 *   imported by external consumers, daemon CLI, and integration harnesses.
 * Responsibilities:
 *   1. Re-export daemon components and protocol contracts;
 *   2. Install process-wide unhandledRejection event listener;
 *   3. Provide lifecycle verification and assertion helpers.
 * Exit Semantics & Design Rationale: Process listener logs diagnostics to stderr without exiting,
 *   preserving daemon process availability during transient unhandled promise rejections.
 */

import { DaemonServer, daemonMain } from './server';
import { DaemonClient, tryWarmScan, tryWarmScanDiff } from './client';
import type { SnapshotScanParams, SliceAuditParams } from './snapshot-client';
import { trySnapshotScan, trySliceAudit } from './snapshot-client';
import { PROTOCOL_VERSION, PROTOCOL_SOFTWARE_VERSION, encodeMessage, decodeLine } from './protocol';
import type { DaemonMessage, HelloAckMessage, SnapshotScanEntryInput } from './protocol';
import {
    projectHashFor,
    pipeNameFor,
    writeRegistry,
    readRegistry,
    clearRegistry,
    logFilePath,
} from './registry';
import type { RegistryInfo } from './registry';
import {
    createDaemonContext,
    handleScan,
    handleScanDiff,
    handleAsymmetricScan,
    handleSliceAudit,
} from './scanHandler';
import type { DaemonScanContext } from './scanHandler';
import { handleSnapshotScan } from './snapshot-handler';
import type { SnapshotScanOptions } from './snapshot-handler';

export {
    DaemonServer,
    daemonMain,
    DaemonClient,
    tryWarmScan,
    tryWarmScanDiff,
    trySnapshotScan,
    trySliceAudit,
    PROTOCOL_VERSION,
    PROTOCOL_SOFTWARE_VERSION,
    encodeMessage,
    decodeLine,
    projectHashFor,
    pipeNameFor,
    writeRegistry,
    readRegistry,
    clearRegistry,
    logFilePath,
    createDaemonContext,
    handleScan,
    handleScanDiff,
    handleAsymmetricScan,
    handleSliceAudit,
    handleSnapshotScan,
};

export type {
    DaemonMessage,
    HelloAckMessage,
    SnapshotScanEntryInput,
    RegistryInfo,
    DaemonScanContext,
    SnapshotScanOptions,
    SnapshotScanParams,
    SliceAuditParams,
};

/**
 * Diagnostics descriptor for unhandled promise rejection occurrences in the daemon.
 */
export interface DaemonRejectionRecord {
    readonly timestamp: number;
    readonly message: string;
    readonly stack?: string;
}

/**
 * Installs the process-level `unhandledRejection` listener to guard the daemon runtime.
 * Ensures the process does not abruptly exit on unexpected asynchronous faults.
 *
 * @param onRejection - Optional telemetry callback for logging or recording rejection events.
 * @returns Cleanup function removing the installed listener.
 */
export function installDaemonRejectionGuard(
    onRejection?: (record: DaemonRejectionRecord) => void,
): () => void {
    const handler = (reason: unknown): void => {
        const error = reason instanceof Error ? reason : new Error(String(reason));
        const record: DaemonRejectionRecord = Object.freeze({
            timestamp: Date.now(),
            message: error.message,
            stack: error.stack,
        });
        const stackTrace = record.stack ? `\n${record.stack}` : '';
        process.stderr.write(
            `[auto-refactor daemon] unhandledRejection: ${record.message}${stackTrace}\n`,
        );
        if (typeof onRejection === 'function') {
            try {
                onRejection(record);
            } catch (callbackErr) {
                process.stderr.write(
                    `[auto-refactor daemon] rejection callback failure: ${callbackErr instanceof Error ? callbackErr.message : String(callbackErr)}\n`,
                );
            }
        }
    };

    process.on('unhandledRejection', handler);
    return () => {
        process.off('unhandledRejection', handler);
    };
}

// Auto-install unhandled rejection resilience upon module initialization
installDaemonRejectionGuard();
