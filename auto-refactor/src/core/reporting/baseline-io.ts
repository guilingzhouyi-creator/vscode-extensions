/**
 * Module: Baseline Reporting — Asynchronous File I/O Operations
 * File Path: src/core/reporting/baseline-io.ts
 * Architecture Role: Provides asynchronous file operations and error handlers for baseline files.
 * Dependencies & Triggers: fs, ../types, ../logger; consumed by baseline-ratchet.ts.
 * Responsibilities: Detect ENOENT errors, log non-ENOENT read errors, and asynchronously read
 *   and parse baseline JSON files without throwing unhandled exceptions.
 * Exit Semantics & Design Rationale: Pure asynchronous utility routines returning null on read
 *   failure, allowing the calling ratchet engine to handle missing or corrupt files safely.
 */

import * as fs from 'fs';
import type { Logger } from '../logger';
import type { BaselinePayload } from './baselineManager';

/** Typeof 'object' string comparison token. */
const TYPEOF_OBJECT = 'object';

/** Error object code property name token. */
const PROPERTY_CODE = 'code';

/** File not found error code for asynchronous baseline reading. */
const ERROR_CODE_ENOENT = 'ENOENT';

/**
 * Type guard for ENOENT filesystem errors.
 *
 * @param error - Caught error object to inspect.
 * @returns True when the error code matches ENOENT.
 */
export function isEnoentError(error: unknown): boolean {
    if (!error || typeof error !== TYPEOF_OBJECT) {
        return false;
    }
    return (error as Record<string, unknown>)[PROPERTY_CODE] === ERROR_CODE_ENOENT;
}

/**
 * Log read errors unless the file is cleanly absent.
 *
 * @param err - Caught file read error.
 * @param logger - Diagnostic logger instance.
 */
export function logBaselineReadError(err: unknown, logger: Logger): void {
    if (isEnoentError(err)) return;
    logger.warn(`Failed to read baseline file: ${err}`);
}

/**
 * Read baseline file asynchronously, ignoring missing files.
 *
 * @param baselinePath - Absolute or relative path to baseline file.
 * @param logger - Diagnostic logger instance.
 * @returns Baseline JSON text or null if unreadable.
 */
export function readBaselineFile(baselinePath: string, logger: Logger): Promise<string | null> {
    return fs.promises.readFile(baselinePath, 'utf8').catch((err: unknown) => {
        logBaselineReadError(err, logger);
        return null;
    });
}

/**
 * Asynchronously read and parse existing baseline if available.
 *
 * @param filePath - Path to existing baseline file.
 * @returns Parsed baseline payload or null on error.
 */
export async function tryReadExistingBaseline(filePath: string): Promise<BaselinePayload | null> {
    try {
        const raw = await fs.promises.readFile(filePath, 'utf8');
        return JSON.parse(raw) as BaselinePayload;
    } catch {
        return null;
    }
}
