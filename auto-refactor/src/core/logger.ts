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

/** Number of bytes per kibibyte. */
const BYTES_PER_KIB = 1024;

/** Number of bytes per mebibyte. */
const BYTES_PER_MIB = BYTES_PER_KIB * BYTES_PER_KIB;

/** Default single log file capacity ceiling in mebibytes. */
const DEFAULT_MAX_LOG_MEGABYTES = 10;

/** Default single log file size limit (10MB) before rotation triggers. */
const DEFAULT_MAX_BYTES_PER_FILE = DEFAULT_MAX_LOG_MEGABYTES * BYTES_PER_MIB;

/** Default maximum number of rotated historical log file archives to retain. */
const DEFAULT_MAX_ROTATED_FILES = 3;

/** Relative repository path token replacing absolute file paths in logs. */
const WORKSPACE_PATH_TOKEN = '<workspace>/';

/** Stable class name for toolchain errors. */
const ERROR_NAME_AUTO_REFACTOR = 'AutoRefactorError';

/** Node process exit event identifier. */
const PROCESS_EVENT_EXIT = 'exit';

/** Node process beforeExit event identifier. */
const PROCESS_EVENT_BEFORE_EXIT = 'beforeExit';

/** Numeric radix for base-36 timestamp encoding. */
const RADIX_BASE_36 = 36;

/** Regular expression used to strip ANSI escape codes when writing to log files. */
const ANSI_ESCAPE_REGEX = /\u001b\[[0-9;]*m/g;

/** Sensitive key names to redact in context payloads. */
const SENSITIVE_KEY_REGEX = /^(?:authorization|token|secret|password|bearer|apikey|cookie)$/i;

/** File system absolute drive letter pattern across lines and messages */
const DRIVE_PATH_REGEX = /[a-zA-Z]:[\\/][^ \r\n\t"']+/g;

/**
 * Normalizes absolute local paths to repository-relative representation.
 */
export function sanitizePath(inputPathString: string): string {
    if (typeof inputPathString !== 'string') return inputPathString;
    return inputPathString.replace(DRIVE_PATH_REGEX, (matchSegment) => {
        const normalizedDrivePath = matchSegment.replace(/\\/g, '/');
        return normalizedDrivePath.replace(/^[a-zA-Z]:\/[^/]+\/[^/]+\//, WORKSPACE_PATH_TOKEN);
    });
}

/**
 * Safely serializes arbitrary objects to JSON, handling circular references, BigInt,
 * and redacting sensitive credentials and system paths.
 *
 * @param payloadData - The value or object graph to serialize.
 * @returns Serialized JSON string.
 */
export function safeSerializeJson(payloadData: unknown): string {
    const seenObjects = new WeakSet<object>();

    try {
        return JSON.stringify(payloadData, (entryKey, entryValue) => {
            if (entryKey && SENSITIVE_KEY_REGEX.test(entryKey)) {
                return '[REDACTED]';
            }
            if (typeof entryValue === 'bigint') {
                return `${entryValue.toString()}n`;
            }
            if (typeof entryValue === 'function') {
                return `[Function${entryValue.name ? ': ' + entryValue.name : ''}]`;
            }
            if (typeof entryValue === 'symbol') {
                return entryValue.toString();
            }
            if (typeof entryValue === 'string') {
                return sanitizePath(entryValue);
            }
            if (typeof entryValue === 'object' && entryValue !== null) {
                if (seenObjects.has(entryValue)) {
                    return '[Circular]';
                }
                seenObjects.add(entryValue);
            }
            return entryValue;
        });
    } catch {
        return '{"level":"error","message":"[safeSerializeJson: Serialization Failed]"}';
    }
}

/**
 * Severity-ordered log levels. Higher numeric value = more verbose.
 * `silent` suppresses all output.
 */
export type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug';

/** Output format for emitted log lines. */
export type LogFormat = 'text' | 'json';

/** Default text output format name. */
const LOG_FORMAT_DEFAULT_TEXT: LogFormat = 'text';

/** Warning level name identifier. */
const LOG_LEVEL_WARN_NAME: LogLevel = 'warn';

/** Error level name identifier. */
const LOG_LEVEL_ERROR_NAME: LogLevel = 'error';

/** Info level name identifier. */
const LOG_LEVEL_INFO_NAME: LogLevel = 'info';

/** Debug level name identifier. */
const LOG_LEVEL_DEBUG_NAME: LogLevel = 'debug';

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
        this.name = ERROR_NAME_AUTO_REFACTOR;
        Object.setPrototypeOf(this, AutoRefactorError.prototype);
    }
}

const syncFsAppendText = fs.appendFileSync.bind(fs);
const syncFsExists = fs.existsSync.bind(fs);
const syncFsUnlink = fs.unlinkSync.bind(fs);
const syncFsRename = fs.renameSync.bind(fs);
const syncFsOpen = fs.openSync.bind(fs);
const syncFsClose = fs.closeSync.bind(fs);
const syncFsStat = fs.statSync.bind(fs);
const syncFsMkdir = fs.mkdirSync.bind(fs);

/**
 * Synchronous log I/O barrier isolating synchronous disk writes for emergency exit semantics.
 */
export const LogIoBarrier = {
    appendSync: (filePath: string, data: string): void => {
        syncFsAppendText(filePath, data);
    },
    exists: (targetPath: string): boolean => syncFsExists(targetPath),
    unlink: (targetPath: string): void => {
        syncFsUnlink(targetPath);
    },
    rename: (srcPath: string, destPath: string): void => {
        syncFsRename(srcPath, destPath);
    },
    truncate: (targetPath: string): void => {
        const fileDescriptor = syncFsOpen(targetPath, 'w');
        syncFsClose(fileDescriptor);
    },
    statSize: (targetPath: string): number => syncFsStat(targetPath).size,
    ensureDir: (dirPath: string): void => {
        syncFsMkdir(dirPath, { recursive: true });
    },
};

const activeRingBuffers = new Set<LogRingBuffer>();
const exitBarrierState = { isRegistered: false };

/**
 * Ensures global synchronous flush barrier on process termination to avoid dangling logs.
 */
function ensureExitBarrierRegistered(): void {
    if (exitBarrierState.isRegistered) return;
    exitBarrierState.isRegistered = true;

    const flushAllActiveBuffers = () => {
        for (const ring of activeRingBuffers) {
            try {
                ring.flushSync();
            } catch {
                /* best-effort: suppress secondary exit exception during process termination */
            }
        }
    };

    if (typeof process !== 'undefined' && typeof process.on === 'function') {
        process.on(PROCESS_EVENT_EXIT, flushAllActiveBuffers);
        process.on(PROCESS_EVENT_BEFORE_EXIT, flushAllActiveBuffers);
    }
}

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
    constructor(
        filePath: string,
        options: number | LogRingBufferOptions = DEFAULT_BUFFER_CAPACITY,
    ) {
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
        activeRingBuffers.add(this);
        ensureExitBarrierRegistered();
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
        if (!LogIoBarrier.exists(src)) return;

        try {
            if (index === this.maxRotatedFiles - 1) {
                LogIoBarrier.unlink(src);
            } else {
                LogIoBarrier.rename(src, dest);
            }
        } catch {
            /* best-effort */
        }
    }

    private tryStandardRotation(targetPath: string): boolean {
        try {
            if (LogIoBarrier.exists(targetPath)) {
                LogIoBarrier.unlink(targetPath);
            }
            LogIoBarrier.rename(this.filePath, targetPath);
            return true;
        } catch {
            /* best-effort: standard rename failed under contention, proceed to fallbacks */
            return false;
        }
    }

    private tryTimestampedRename(): boolean {
        try {
            const timestamped = `${this.filePath}.${Date.now().toString(RADIX_BASE_36)}.locked.rot`;
            LogIoBarrier.rename(this.filePath, timestamped);
            return true;
        } catch {
            /* best-effort: timestamped rename contention, proceed to in-place truncation */
            return false;
        }
    }

    private tryInPlaceTruncate(): void {
        try {
            LogIoBarrier.truncate(this.filePath);
        } catch {
            /* best-effort: fail-soft fallback when file is held exclusively */
        }
    }

    private rotateActiveLogFile(): void {
        const firstRotated = `${this.filePath}.1`;
        if (this.tryStandardRotation(firstRotated)) {
            return;
        }
        if (this.tryTimestampedRename()) {
            return;
        }
        this.tryInPlaceTruncate();
    }

    /**
     * Release ring buffer resources and deregister from process exit barrier.
     */
    public dispose(): void {
        activeRingBuffers.delete(this);
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }

    /**
     * Check if appending additional bytes will exceed maxBytesPerFile, and rotate files if needed.
     * Sequence: file.2 -> unlinked, file.1 -> file.2, file -> file.1
     */
    private rotateIfNecessary(additionalBytes: number): void {
        try {
            if (!LogIoBarrier.exists(this.filePath)) return;
            const currentSize = LogIoBarrier.statSize(this.filePath);
            if (currentSize + additionalBytes <= this.maxBytesPerFile) return;

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
     * Drains all buffered log lines into an ANSI-stripped UTF-8 payload and triggers rotation.
     */
    private drainBufferPayload(): string {
        const linesToFlush: string[] = [];
        while (this.count > 0) {
            linesToFlush.push(this.buffer[this.tail]);
            this.tail = (this.tail + 1) % this.capacity;
            this.count--;
        }
        const payload = this.stripAnsi(linesToFlush.join('\n') + '\n');
        this.rotateIfNecessary(Buffer.byteLength(payload, 'utf8'));
        return payload;
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
            const payload = this.drainBufferPayload();
            try {
                LogIoBarrier.appendSync(this.filePath, payload);
            } catch (error) {
                process.stderr.write(
                    `[auto-refactor] WARN sync log flush failed: ${String(error)}\n`,
                );
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
        const payload = this.drainBufferPayload();
        try {
            await fs.promises.appendFile(this.filePath, payload);
        } catch (error) {
            process.stderr.write(
                `[auto-refactor] WARN async log append failed: ${String(error)}\n`,
            );
        } finally {
            this.isFlushing = false;
        }
    }
}

/**
 * Parameter object for diagnostic line formatting.
 */
interface FormatLogMessageParams {
    readonly timestamp: string;
    readonly level: LogLevel;
    readonly message: string;
    readonly errorObj?: Error;
    readonly contextObj?: LogContext;
}

/**
 * Format a text diagnostic line with timestamp, level, message, context, and error details.
 */
function formatTextMessage(params: FormatLogMessageParams): string {
    let line = `${params.timestamp} ${params.level.toUpperCase().padEnd(LOG_LEVEL_LABEL_WIDTH)} ${params.message}`;
    if (params.contextObj && Object.keys(params.contextObj).length > 0) {
        try {
            line += ` [context: ${JSON.stringify(params.contextObj)}]`;
        } catch {
            line += ` [context: [Circular]]`;
        }
    }
    if (params.errorObj) {
        line += ` [Error: ${params.errorObj.message}]`;
        if (params.errorObj.stack) {
            line += `\n${sanitizePath(params.errorObj.stack)}`;
        }
        if (params.errorObj.cause != null) {
            const cause = params.errorObj.cause;
            const causeStr = cause instanceof Error ? cause.stack || cause.message : String(cause);
            line += `\n[Caused by]: ${sanitizePath(causeStr)}`;
        }
    }
    return line;
}

/**
 * Format a structured JSON line containing timestamp, level, message, context, and error.
 */
function formatJsonMessage(params: FormatLogMessageParams): string {
    const record: Record<string, unknown> = {
        timestamp: params.timestamp,
        level: params.level,
        message: params.message,
    };
    if (params.contextObj && Object.keys(params.contextObj).length > 0) {
        record.context = params.contextObj;
    }
    if (params.errorObj) {
        record.error = {
            name: params.errorObj.name,
            message: params.errorObj.message,
            stack: params.errorObj.stack ? sanitizePath(params.errorObj.stack) : undefined,
            cause:
                params.errorObj.cause instanceof Error
                    ? params.errorObj.cause.message
                    : params.errorObj.cause,
        };
    }
    return safeSerializeJson(record);
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
        private level: LogLevel = LOG_LEVEL_INFO_NAME,
        private filePath?: string,
        options?: LoggerOptions,
    ) {
        this.format = options?.format ?? LOG_FORMAT_DEFAULT_TEXT;
        if (filePath) {
            try {
                LogIoBarrier.ensureDir(path.dirname(filePath));
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
        return this.isLevelEnabled(LOG_LEVEL_DEBUG_NAME);
    }

    /** Returns true if info messages are emitted under the current log level. */
    isInfoEnabled(): boolean {
        return this.isLevelEnabled(LOG_LEVEL_INFO_NAME);
    }

    /** Returns true if warning messages are emitted under the current log level. */
    isWarnEnabled(): boolean {
        return this.isLevelEnabled(LOG_LEVEL_WARN_NAME);
    }

    /** Returns true if error messages are emitted under the current log level. */
    isErrorEnabled(): boolean {
        return this.isLevelEnabled(LOG_LEVEL_ERROR_NAME);
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

        const timestamp = new Date().toISOString();
        const formatParams: FormatLogMessageParams = {
            timestamp,
            level,
            message: msg,
            errorObj,
            contextObj,
        };
        const line =
            this.format === 'json'
                ? formatJsonMessage(formatParams)
                : formatTextMessage(formatParams);

        process.stderr.write(line + '\n');
        if (this.ringBuffer) {
            this.ringBuffer.push(line);
        }
    }

    /**
     * Emit an error-level diagnostic when the configured threshold allows it.
     */
    error(msgOrSupplier: LogMessageSupplier, errorOrContext?: unknown, context?: LogContext): void {
        this.emit(LOG_LEVEL_ERROR_NAME, msgOrSupplier, errorOrContext, context);
    }

    /**
     * Emit a warning-level diagnostic when the configured threshold allows it.
     */
    warn(msgOrSupplier: LogMessageSupplier, errorOrContext?: unknown, context?: LogContext): void {
        this.emit(LOG_LEVEL_WARN_NAME, msgOrSupplier, errorOrContext, context);
    }

    /**
     * Emit an info-level diagnostic when the configured threshold allows it.
     */
    info(msgOrSupplier: LogMessageSupplier, context?: LogContext): void {
        this.emit(LOG_LEVEL_INFO_NAME, msgOrSupplier, context);
    }

    /**
     * Emit a debug-level diagnostic when the configured threshold allows it.
     */
    debug(msgOrSupplier: LogMessageSupplier, context?: LogContext): void {
        this.emit(LOG_LEVEL_DEBUG_NAME, msgOrSupplier, context);
    }

    /**
     * Synchronously flushes all pending logs to disk and releases file resources.
     */
    close(): void {
        if (this.ringBuffer) {
            this.ringBuffer.flushSync();
            this.ringBuffer.dispose();
        }
    }

    /**
     * Asynchronously flushes all pending logs to disk and releases file resources.
     */
    async closeAsync(): Promise<void> {
        if (this.ringBuffer) {
            await this.ringBuffer.flushAsync();
            this.ringBuffer.dispose();
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
