/**
 * Logger — 跨层日志工具
 *
 * 按等级分层输出，生产环境可关闭 Debug 级别。
 * 内置环形缓冲区保留最近 N 条日志，供崩溃诊断导出。
 * 不依赖 VS Code API，可在 Domain/Persistence 等下层使用。
 */

export enum LogLevel {
    Debug = 0,
    Info = 1,
    Warn = 2,
    Error = 3,
    None = 4,
}

let _minLevel: LogLevel = LogLevel.Debug;

/** 设置最低日志等级（低于该等级的不输出） */
export function setLogLevel(level: LogLevel): void {
    _minLevel = level;
}

/** 获取当前日志等级 */
export function getLogLevel(): LogLevel {
    return _minLevel;
}

const levelLabels: Record<LogLevel, string> = {
    [LogLevel.Debug]: 'DEBUG',
    [LogLevel.Info]: 'INFO',
    [LogLevel.Warn]: 'WARN',
    [LogLevel.Error]: 'ERROR',
    [LogLevel.None]: 'NONE',
};

// ─── 内存环形缓冲区 — 崩溃诊断用 ──────────────────────
const DIAG_BUFFER_CAP = 200;

export interface LogEntry {
    level: LogLevel;
    message: string;
    timestamp: number;
    stack?: string;
}

const diagBuffer: LogEntry[] = [];
let diagWriteIdx = 0;

function pushDiag(level: LogLevel, message: string, stack?: string): void {
    const entry: LogEntry = { level, message, timestamp: Date.now(), stack };
    if (diagBuffer.length < DIAG_BUFFER_CAP) {
        diagBuffer.push(entry);
    } else {
        diagBuffer[diagWriteIdx % DIAG_BUFFER_CAP] = entry;
        diagWriteIdx++;
    }
}

/** 导出诊断日志（最近 200 条，用于生成诊断报告）*/
export function exportDiagnostics(): LogEntry[] {
    if (diagBuffer.length < DIAG_BUFFER_CAP) {
        return [...diagBuffer];
    }
    // 环形缓冲区重组为时间顺序
    const start = diagWriteIdx % DIAG_BUFFER_CAP;
    return [...diagBuffer.slice(start), ...diagBuffer.slice(0, start)];
}

/**
 * 输出日志。
 * Debug 级别仅在非生产环境输出。
 */
export function log(level: LogLevel, message: string, ...args: unknown[]): void {
    if (level < _minLevel) return;

    const label = levelLabels[level] ?? 'UNKNOWN';
    const timestamp = new Date().toISOString().slice(11, 23);
    const prefix = `[WSTiming][${label}][${timestamp}]`;

    let errorStack: string | undefined;

    if (args.length > 0) {
        const errorArg = args.find(a => a instanceof Error);
        if (errorArg) {
            const err = errorArg as Error;
            errorStack = err.stack;
            if (level >= LogLevel.Warn) {
                console.warn(prefix, message, err.message, err.stack);
            } else {
                console.log(prefix, message, err.message);
            }
            pushDiag(level, `${message} | ${err.message}`, errorStack);
            return;
        }
    }

    switch (level) {
        case LogLevel.Error:
            console.error(prefix, message);
            break;
        case LogLevel.Warn:
            console.warn(prefix, message);
            break;
        default:
            console.log(prefix, message);
            break;
    }

    pushDiag(level, message, errorStack);
}

/** 便捷方法 */
export const logger = {
    debug: (msg: string, ...args: unknown[]) => log(LogLevel.Debug, msg, ...args),
    info: (msg: string, ...args: unknown[]) => log(LogLevel.Info, msg, ...args),
    warn: (msg: string, ...args: unknown[]) => log(LogLevel.Warn, msg, ...args),
    error: (msg: string, ...args: unknown[]) => log(LogLevel.Error, msg, ...args),
};
