import * as fs from 'fs';
import * as path from 'path';

/**
 * Severity-ordered log levels. Higher numeric value = more verbose.
 * `silent` suppresses all output.
 */
export type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug';

export const LOG_LEVELS: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
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
  constructor(
    message: string,
    public readonly code: string = 'AUTO_REFACTOR_ERROR',
    public readonly cause?: unknown,
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
 *  - Optionally mirrors to a file when `file` is provided, using **synchronous appends**
 *    so logs survive `process.exit` without flush races.
 *  - Level filtering is done once at emit time.
 */
export class Logger {
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

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  private emit(level: LogLevel, msg: string): void {
    if (LOG_LEVELS[level] > LOG_LEVELS[this.level]) return;
    const ts = new Date().toISOString();
    const line = `${ts} ${level.toUpperCase().padEnd(5)} ${msg}`;
    process.stderr.write(line + '\n');
    if (this.filePath) {
      try {
        fs.appendFileSync(this.filePath, line + '\n');
      } catch (e) {
        process.stderr.write(`[auto-refactor] WARN failed to write log file: ${String(e)}\n`);
      }
    }
  }

  error(msg: string): void {
    this.emit('error', msg);
  }
  warn(msg: string): void {
    this.emit('warn', msg);
  }
  info(msg: string): void {
    this.emit('info', msg);
  }
  debug(msg: string): void {
    this.emit('debug', msg);
  }

  /** No-op kept for API symmetry; synchronous writes need no explicit close. */
  close(): void {}
}

