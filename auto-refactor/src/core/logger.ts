/**
 * Module: Core Engine — Logging & Toolchain Error Primitives
 * File Path: src/core/logger.ts
 * Architecture Role: Cross-cutting diagnostics layer shared by CLI entry points (api.ts), the
 *                    scan engine (analyzer.ts) and the daemon (server.ts / scanHandler.ts).
 * Dependencies & Triggers: Node fs/path only; Logger is constructed at scan/daemon start with a
 *                    level and an optional log-file path; AutoRefactorError is thrown by
 *                    configuration/validation paths and caught by the CLI.
 * Responsibilities: Define the severity-ordered LogLevel union and LOG_LEVELS numeric map; expose
 *                    AutoRefactorError with a stable machine-readable code; write timestamped,
 *                    level-prefixed lines to stderr with filtering at emit time; optionally mirror
 *                    to a file using synchronous appends; best-effort mkdir of the log directory;
 *                    setLevel() and the flush-free close() API.
 * Exit Semantics & Design Rationale: Logging never throws — a failed file append degrades to a
 *                    stderr warning, so diagnostics cannot fail a scan. stderr-only output keeps
 *                    stdout clean for JSON/SARIF piping, and synchronous appends survive
 *                    process.exit without flush races; close() is a no-op for API symmetry.
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Numeric verbosity rank of the `info` level: one step above `warn` (2) and one below `debug`.
 */
const LOG_LEVEL_INFO_RANK = 3;

/**
 * Numeric verbosity rank of the `debug` level, the most verbose level (`silent` is 0).
 */
const LOG_LEVEL_DEBUG_RANK = 4;

/**
 * Minimum column width used to pad the level label in each emitted log line (e.g. `INFO `).
 */
const LOG_LEVEL_LABEL_WIDTH = 5;

/**
 * Severity-ordered log levels. Higher numeric value = more verbose.
 * `silent` suppresses all output.
 */
export type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug';

/**
 * Numeric verbosity ranking behind `LogLevel`: `silent` is 0 and `debug` is 4.
 *
 * A message is emitted when its rank is less than or equal to the logger's configured rank, so
 * higher numbers mean more verbose output and `silent` suppresses everything. The map is shared
 * configuration consumed by `Logger.emit`; treat it as read-only and do not mutate it.
 */
export const LOG_LEVELS: Record<LogLevel, number> = {
    silent: 0,
    error: 1,
    warn: 2,
    info: LOG_LEVEL_INFO_RANK,
    debug: LOG_LEVEL_DEBUG_RANK,
};

/**
 * Unified error type for the whole toolchain.
 * - Configuration / validation failures throw `AutoRefactorError(code)` and are surfaced
 *   to the CLI with a non-zero exit (distinct from analyzer runtime faults, which are
 *   caught per-file and turned into `core/analyzer-error` Issues instead).
 * - `code` is a stable machine-readable token (e.g. 'CONFIG_INVALID', 'MODULE_NOT_FOUND')
 *   so callers / CI can branch on it.
 */
export class AutoRefactorError extends Error {
    /**
     * Create a toolchain error carrying a stable machine-readable code.
     *
     * @param message - Human-readable failure description stored on `Error.message`.
     * @param code - Stable machine token such as 'CONFIG_INVALID' or 'MODULE_NOT_FOUND';
     *               defaults to 'AUTO_REFACTOR_ERROR' when omitted.
     * @param cause - Optional underlying cause for diagnostic chaining; exposed as the public
     *                readonly `cause` property.
     */
    constructor(
        message: string,
        public readonly code: string = 'AUTO_REFACTOR_ERROR',
        public override readonly cause?: unknown,
    ) {
        super(message);
        this.name = 'AutoRefactorError';
        Object.setPrototypeOf(this, AutoRefactorError.prototype);
    }
}

/**
 * Minimal, dependency-free logger.
 *
 * Design rules:
 *  - All logs go to **stderr** so stdout stays clean for machine-readable output
 *    (JSON / SARIF piping). This is critical for `auto-refactor ... > report.json`.
 *  - Optionally mirrors to a file when `filePath` is provided, using **synchronous appends**
 *    so logs survive `process.exit` without flush races.
 *  - Level filtering is done once at emit time.
 */
export class Logger {
    /**
     * Create a logger bound to a maximum severity rank and an optional mirror file.
     *
     * Construction is synchronous and fail-soft: a failed mkdir for the log directory is
     * swallowed, and later append failures degrade to a stderr warning.
     *
     * @param level - Highest emitted severity rank; messages ranked above it are dropped.
     * @param filePath - Optional log-file path. When set, accepted lines are appended
     *                   synchronously and still mirrored to stderr.
     */
    constructor(
        private level: LogLevel = 'info',
        private filePath?: string,
    ) {
        if (filePath) {
            try {
                fs.mkdirSync(path.dirname(filePath), { recursive: true });
            } catch {
                /* best-effort; append attempts below will surface failures */
            }
        }
    }

    /**
     * Raise or lower the emit threshold for subsequent messages.
     *
     * @param level - New highest emitted severity rank; applies to later emits only.
     */
    setLevel(level: LogLevel): void {
        this.level = level;
    }

    /**
     * Write one diagnostic line to stderr and mirror it to the log file when configured.
     *
     * Filtering happens here so every public level method shares one timestamp format and
     * append path; file failures degrade to a stderr warning instead of propagating.
     *
     * @param level - Severity of the message being emitted.
     * @param msg - Message body without timestamp or level prefix.
     */
    private emit(level: LogLevel, msg: string): void {
        if (LOG_LEVELS[level] > LOG_LEVELS[this.level]) return;
        const ts = new Date().toISOString();
        const line = `${ts} ${level.toUpperCase().padEnd(LOG_LEVEL_LABEL_WIDTH)} ${msg}`;
        process.stderr.write(line + '\n');
        if (this.filePath) {
            try {
                fs.appendFileSync(this.filePath, line + '\n');
            } catch (e) {
                process.stderr.write(
                    `[auto-refactor] WARN failed to write log file: ${String(e)}\n`,
                );
            }
        }
    }

    /**
     * Emit an error-level diagnostic when the configured threshold allows it.
     *
     * @param msg - Message body prefixed with the ISO timestamp and level label.
     */
    error(msg: string): void {
        this.emit('error', msg);
    }
    /**
     * Emit a warning-level diagnostic when the configured threshold allows it.
     *
     * @param msg - Message body prefixed with the ISO timestamp and level label.
     */
    warn(msg: string): void {
        this.emit('warn', msg);
    }
    /**
     * Emit an info-level diagnostic when the configured threshold allows it.
     *
     * @param msg - Message body prefixed with the ISO timestamp and level label.
     */
    info(msg: string): void {
        this.emit('info', msg);
    }
    /**
     * Emit a debug-level diagnostic when the configured threshold allows it.
     *
     * @param msg - Message body prefixed with the ISO timestamp and level label.
     */
    debug(msg: string): void {
        this.emit('debug', msg);
    }

    /** No-op kept for API symmetry; synchronous writes need no explicit close. */
    close(): void {}
}
