/**
 * Module: Core Engine — Logging & Toolchain Error Primitives
 * File Path: src/core/logger.ts
 * Architecture Role: Cross-cutting diagnostics layer shared by CLI entry points (api.ts), the
 *                    scan engine (analyzer.ts) and the daemon (server.ts / scanHandler.ts).
 * Dependencies & Triggers: Node fs/path only; Logger is constructed at scan/daemon start with a
 *                    level and an optional log-file path; AutoRefactorError is thrown by
 *                    configuration/validation paths and caught by the CLI.
 * Responsibilities: Define severity-ordered LogLevel and LOG_LEVELS numeric map; expose
 *                    AutoRefactorError with stable code; write timestamped level-prefixed lines
 *                    to stderr; optionally mirror to a rotating file using LogRingBuffer batching;
 *                    support structured Context, Error stack extraction, lazy supplier evaluation,
 *                    ANSI stripping, and JSON-lines format.
 * Exit Semantics & Design Rationale: Logging never throws — failed file appends degrade to stderr
 *                    warnings, ensuring diagnostics cannot break scans. stderr-only console output
 *                    keeps stdout pure for JSON/SARIF piping; LogIoBarrier isolates sync writes.
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

/** Default capacity in lines for the in-memory log ring buffer. */
const DEFAULT_BUFFER_CAPACITY = 2048;

/** Number of queued lines that immediately triggers an asynchronous flush. */
const DEFAULT_BATCH_THRESHOLD = 128;

/** Milliseconds of idle time before an unforced batch is asynchronously flushed. */
const DEFAULT_FLUSH_DEBOUNCE_MS = 50;

/** Default single log file size limit (10MB) before rotation triggers. */
const DEFAULT_MAX_BYTES_PER_FILE = 10 * 1024 * 1024;

/** Default maximum number of rotated historical log file archives to retain. */
const DEFAULT_MAX_ROTATED_FILES = 3;

/** Regular expression used to strip ANSI escape codes when writing to log files. */
const ANSI_ESCAPE_REGEX = /\u001b\[[0-9;]*m/g;

/**
 * Severity-ordered log levels. Higher numeric value = more verbose.
 * `silent` suppresses all output.
 */
export type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug';

/** Output format for emitted log lines. */
export type LogFormat = 'text' | 'json';

/** Arbitrary structured contextual key-value map. */
export type LogContext = Record<string, unknown>;

/** String message or lazy message supplier function to avoid eager evaluation in hot paths. */
export type LogMessageSupplier = string | (() => string);

/** Configuration options for logger initialization. */
export interface LoggerOptions {
    format?: LogFormat;
    maxBytesPerFile?: number;
    maxRotatedFiles?: number;
    capacity?: number;
}

/** Configuration options for the underlying LogRingBuffer. */
export interface LogRingBufferOptions {
    capacity?: number;
    maxBytesPerFile?: number;
    maxRotatedFiles?: number;
}

/**
 * Numeric verbosity ranking behind `LogLevel`: `silent` is 0 and `debug` is 4.
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

const syncFsAppendText = fs.appendFileSync.bind(fs);

/**
 * Synchronous log I/O barrier isolating synchronous disk writes for emergency exit semantics.
 */
export const LogIoBarrier = {
    appendSync: (filePath: string, data: string): void => {
        syncFsAppendText(filePath, data);
    },
};

/**
 * In-memory circular buffer for batching disk appends with size-capping and rotation.
 */
export class LogRingBuffer {
    private readonly buffer: string[];
    private head: number = 0;
    private tail: number = 0;
    private count: number = 0;
    private readonly capacity: number;
    private readonly filePath: string;
    private readonly maxBytesPerFile: number;
    private readonly maxRotatedFiles: number;
    private timer: NodeJS.Timeout | null = null;
    private isFlushing: boolean = false;
    private isSyncFlushing: boolean = false;

    /**
     * Create a ring buffer for batching log disk appends.
     *
     * @param filePath - Destination log file path.
     * @param options - Buffer capacity number or options object.
     */
    constructor(filePath: string, options: number | LogRingBufferOptions = DEFAULT_BUFFER_CAPACITY) {
        this.filePath = filePath;
        if (typeof options === 'number') {
            this.capacity = options;
            this.maxBytesPerFile = DEFAULT_MAX_BYTES_PER_FILE;
            this.maxRotatedFiles = DEFAULT_MAX_ROTATED_FILES;
        } else {
            this.capacity = options.capacity ?? DEFAULT_BUFFER_CAPACITY;
            this.maxBytesPerFile = options.maxBytesPerFile ?? DEFAULT_MAX_BYTES_PER_FILE;
            this.maxRotatedFiles = options.maxRotatedFiles ?? DEFAULT_MAX_ROTATED_FILES;
        }
        this.buffer = new Array<string>(this.capacity);
    }

    /**
     * Strip ANSI escape codes to ensure clean plain text in disk logs.
     */
    private stripAnsi(text: string): string {
        return text.replace(ANSI_ESCAPE_REGEX, '');
    }

    /**
     * Shift a rotated log file from .index to .index+1, or remove if exceeding maximum count.
     */
    private shiftLogRotation(index: number): void {
        const src = `${this.filePath}.${index}`;
        const dest = `${this.filePath}.${index + 1}`;
        if (!fs.existsSync(src)) return;

        try {
            if (index === this.maxRotatedFiles - 1) {
                fs.unlinkSync(src);
            } else {
                fs.renameSync(src, dest);
            }
        } catch {
            /* best-effort */
        }
    }

    private rotateActiveLogFile(): void {
        const firstRotated = `${this.filePath}.1`;
        try {
            if (fs.existsSync(firstRotated)) {
                fs.unlinkSync(firstRotated);
            }
            fs.renameSync(this.filePath, firstRotated);
        } catch {
            /* best-effort: fail-soft fallback */
        }
    }

    /**
     * Check if appending additional bytes will exceed maxBytesPerFile, and rotate files if needed.
     * Sequence: file.2 -> unlinked, file.1 -> file.2, file -> file.1
     */
    private rotateIfNecessary(additionalBytes: number): void {
        try {
            if (!fs.existsSync(this.filePath)) return;
            const stat = fs.statSync(this.filePath);
            if (stat.size + additionalBytes <= this.maxBytesPerFile) return;

            for (let i = this.maxRotatedFiles - 1; i >= 1; i--) {
                this.shiftLogRotation(i);
            }

            this.rotateActiveLogFile();
        } catch {
            /* best-effort; rotation failures never throw */
        }
    }

    /**
     * Push a formatted log line into the in-memory circular buffer.
     *
     * @param line - Fully formatted log line string.
     */
    public push(line: string): void {
        this.buffer[this.head] = line;
        this.head = (this.head + 1) % this.capacity;
        if (this.count < this.capacity) {
            this.count++;
        } else {
            this.tail = (this.tail + 1) % this.capacity;
        }

        if (this.isSyncFlushing) {
            return;
        }

        if (this.count >= DEFAULT_BATCH_THRESHOLD) {
            void this.flushAsync();
        } else if (!this.timer) {
            this.timer = setTimeout(() => {
                this.timer = null;
                void this.flushAsync();
            }, DEFAULT_FLUSH_DEBOUNCE_MS);
            if (this.timer.unref) {
                this.timer.unref();
            }
        }
    }

    /**
     * Synchronously flush all buffered log lines to disk immediately.
     */
    public flushSync(): void {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        this.isSyncFlushing = true;
        try {
            if (this.count === 0) return;
            const linesToFlush: string[] = [];
            while (this.count > 0) {
                linesToFlush.push(this.buffer[this.tail]);
                this.tail = (this.tail + 1) % this.capacity;
                this.count--;
            }
            const payload = this.stripAnsi(linesToFlush.join('\n') + '\n');
            this.rotateIfNecessary(Buffer.byteLength(payload, 'utf8'));
            try {
                LogIoBarrier.appendSync(this.filePath, payload);
            } catch (e) {
                process.stderr.write(`[auto-refactor] WARN sync log flush failed: ${String(e)}\n`);
            }
        } finally {
            this.isSyncFlushing = false;
        }
    }

    /**
     * Asynchronously flush buffered logs to disk.
     */
    public async flushAsync(): Promise<void> {
        if (this.count === 0 || this.isFlushing || this.isSyncFlushing) return;
        this.isFlushing = true;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        const linesToFlush: string[] = [];
        while (this.count > 0) {
            linesToFlush.push(this.buffer[this.tail]);
            this.tail = (this.tail + 1) % this.capacity;
            this.count--;
        }
        const payload = this.stripAnsi(linesToFlush.join('\n') + '\n');
        this.rotateIfNecessary(Buffer.byteLength(payload, 'utf8'));
        try {
            await fs.promises.appendFile(this.filePath, payload);
        } catch (e) {
            process.stderr.write(`[auto-refactor] WARN async log append failed: ${String(e)}\n`);
        } finally {
            this.isFlushing = false;
        }
    }
}

/**
 * Format a text diagnostic line with timestamp, level, message, context, and error details.
 */
function formatTextMessage(
    timestamp: string,
    level: LogLevel,
    message: string,
    errorObj?: Error,
    contextObj?: LogContext,
): string {
    let line = `${timestamp} ${level.toUpperCase().padEnd(LOG_LEVEL_LABEL_WIDTH)} ${message}`;
    if (contextObj && Object.keys(contextObj).length > 0) {
        try {
            line += ` [context: ${JSON.stringify(contextObj)}]`;
        } catch {
            line += ` [context: [Circular]]`;
        }
    }
    if (errorObj) {
        line += ` [Error: ${errorObj.message}]`;
        if (errorObj.stack) {
            line += `\n${errorObj.stack}`;
        }
        if (errorObj.cause != null) {
            const cause = errorObj.cause;
            const causeStr = cause instanceof Error ? cause.stack || cause.message : String(cause);
            line += `\n[Caused by]: ${causeStr}`;
        }
    }
    return line;
}

/**
 * Format a structured JSON line containing timestamp, level, message, context, and error.
 */
function formatJsonMessage(
    timestamp: string,
    level: LogLevel,
    message: string,
    errorObj?: Error,
    contextObj?: LogContext,
): string {
    const record: Record<string, unknown> = {
        timestamp,
        level,
        message,
    };
    if (contextObj && Object.keys(contextObj).length > 0) {
        record.context = contextObj;
    }
    if (errorObj) {
        record.error = {
            name: errorObj.name,
            message: errorObj.message,
            stack: errorObj.stack,
            cause: errorObj.cause instanceof Error ? errorObj.cause.message : errorObj.cause,
        };
    }
    return JSON.stringify(record);
}

/**
 * Minimal, dependency-free logger with in-memory ring buffer batching.
 */
export class Logger {
    private ringBuffer?: LogRingBuffer;
    private readonly format: LogFormat;

    /**
     * Create a logger bound to a maximum severity rank and an optional mirror file.
     *
     * @param level - Highest emitted severity rank; messages ranked above it are dropped.
     * @param filePath - Optional log-file path. When set, accepted lines are appended.
     * @param options - Additional formatting and ring buffer options.
     */
    constructor(
        private level: LogLevel = 'info',
        private filePath?: string,
        options?: LoggerOptions,
    ) {
        this.format = options?.format ?? 'text';
        if (filePath) {
            try {
                fs.mkdirSync(path.dirname(filePath), { recursive: true });
                this.ringBuffer = new LogRingBuffer(filePath, {
                    capacity: options?.capacity,
                    maxBytesPerFile: options?.maxBytesPerFile,
                    maxRotatedFiles: options?.maxRotatedFiles,
                });
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
     * Test whether messages at the given level are currently allowed to emit.
     */
    isLevelEnabled(level: LogLevel): boolean {
        return LOG_LEVELS[level] <= LOG_LEVELS[this.level];
    }

    /** Returns true if debug messages are emitted under the current log level. */
    isDebugEnabled(): boolean {
        return this.isLevelEnabled('debug');
    }

    /** Returns true if info messages are emitted under the current log level. */
    isInfoEnabled(): boolean {
        return this.isLevelEnabled('info');
    }

    /** Returns true if warning messages are emitted under the current log level. */
    isWarnEnabled(): boolean {
        return this.isLevelEnabled('warn');
    }

    /** Returns true if error messages are emitted under the current log level. */
    isErrorEnabled(): boolean {
        return this.isLevelEnabled('error');
    }

    /**
     * Internal emitter handling level filtration, lazy supplier resolution, and format dispatch.
     */
    private emit(
        level: LogLevel,
        msgOrSupplier: LogMessageSupplier,
        errorOrContext?: unknown,
        context?: LogContext,
    ): void {
        if (!this.isLevelEnabled(level)) return;

        const msg = typeof msgOrSupplier === 'function' ? msgOrSupplier() : msgOrSupplier;
        let errorObj: Error | undefined;
        let contextObj: LogContext | undefined = context;

        if (errorOrContext instanceof Error) {
            errorObj = errorOrContext;
        } else if (errorOrContext && typeof errorOrContext === 'object' && !contextObj) {
            contextObj = errorOrContext as LogContext;
        }

        const ts = new Date().toISOString();
        const line =
            this.format === 'json'
                ? formatJsonMessage(ts, level, msg, errorObj, contextObj)
                : formatTextMessage(ts, level, msg, errorObj, contextObj);

        process.stderr.write(line + '\n');
        if (this.ringBuffer) {
            this.ringBuffer.push(line);
        }
    }

    /**
     * Emit an error-level diagnostic when the configured threshold allows it.
     */
    error(msgOrSupplier: LogMessageSupplier, errorOrContext?: unknown, context?: LogContext): void {
        this.emit('error', msgOrSupplier, errorOrContext, context);
    }

    /**
     * Emit a warning-level diagnostic when the configured threshold allows it.
     */
    warn(msgOrSupplier: LogMessageSupplier, errorOrContext?: unknown, context?: LogContext): void {
        this.emit('warn', msgOrSupplier, errorOrContext, context);
    }

    /**
     * Emit an info-level diagnostic when the configured threshold allows it.
     */
    info(msgOrSupplier: LogMessageSupplier, context?: LogContext): void {
        this.emit('info', msgOrSupplier, context);
    }

    /**
     * Emit a debug-level diagnostic when the configured threshold allows it.
     */
    debug(msgOrSupplier: LogMessageSupplier, context?: LogContext): void {
        this.emit('debug', msgOrSupplier, context);
    }

    /**
     * Synchronously flushes all pending logs to disk and releases file resources.
     */
    close(): void {
        if (this.ringBuffer) {
            this.ringBuffer.flushSync();
        }
    }

    /**
     * Asynchronously flushes all pending logs to disk and releases file resources.
     */
    async closeAsync(): Promise<void> {
        if (this.ringBuffer) {
            await this.ringBuffer.flushAsync();
        }
    }

    /**
     * Asynchronously flushes any buffered log entries.
     */
    async flush(): Promise<void> {
        if (this.ringBuffer) {
            await this.ringBuffer.flushAsync();
        }
    }
}
