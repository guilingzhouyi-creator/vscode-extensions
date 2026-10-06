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
import { DaemonClient } from './client';
import { PROTOCOL_VERSION, PROTOCOL_SOFTWARE_VERSION, encodeMessage, decodeLine } from './protocol';
import type { DaemonMessage, HelloAckMessage } from './protocol';
import {
    projectHashFor,
    pipeNameFor,
    writeRegistry,
    readRegistry,
    clearRegistry,
    logFilePath,
} from './registry';
import type { RegistryInfo } from './registry';
import { createDaemonContext, handleScan, handleScanDiff } from './scanHandler';
import type { DaemonScanContext } from './scanHandler';

export {
    DaemonServer,
    daemonMain,
    DaemonClient,
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
};

export type { DaemonMessage, HelloAckMessage, RegistryInfo, DaemonScanContext };

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
        process.stderr.write(`[auto-refactor daemon] unhandledRejection: ${record.message}\n`);
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
