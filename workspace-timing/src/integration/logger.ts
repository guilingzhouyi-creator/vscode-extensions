/**
 * Module: Logger — 跨层无依赖统一日志与双轨事件汇流引擎
 * File Path: src/integration/logger.ts
 * Architecture Role: Integration layer foundational logging utility with zero external runtime dependencies
 * Dependencies & Triggers: domain/models.ts; used across all layers (Domain, Cache, Persistence, Application, Presentation)
 * Responsibilities: Filter and format structured log entries; support lazy evaluation; unroll recursive Error causes; dispatch to multiple LogSinks (VS Code OutputChannel, Console)
 * Exit Semantics & Design Rationale: Pure standalone utility with zero VS Code API imports, allowing safe headless execution within unit tests while enabling host OutputChannel injection
 */

import { ISO_TIME_START, ISO_TIME_END } from '../domain/models';

export enum LogLevel {
  Debug = 0,
  Info = 1,
  Warn = 2,
  Error = 3,
  None = 4,
}

/** Function or static string yielding a log message (lazy evaluation). */
export type LogMessageSupplier = string | (() => string);

/** Structured entry passed to registered LogSink callbacks. */
export interface LogEntry {
  level: LogLevel;
  label: string;
  timestamp: string;
  prefix: string;
  message: string;
  error?: Error;
  detail?: string;
}

/** Consumer callback receiving structured log entries. */
export type LogSink = (entry: LogEntry) => void;

let _minLevel: LogLevel = LogLevel.Debug;
const _sinks = new Set<LogSink>();

/**
 * 设置最低日志等级（低于该等级的不输出）。
 *
 * @param level - 目标日志等级
 */
export function setLogLevel(level: LogLevel): void {
  _minLevel = level;
}

/**
 * 获取当前全局最低日志等级。
 *
 * @returns 当前生效的最低日志等级
 */
export function getLogLevel(): LogLevel {
  return _minLevel;
}

/**
 * 检查指定日志等级当前是否激活（用于昂贵求值前的探测）。
 *
 * @param level - 待探测的日志等级
 * @returns 当且仅当等级达到阈值且非 None 时返回 true
 */
export function isLogLevelEnabled(level: LogLevel): boolean {
  return level >= _minLevel && _minLevel !== LogLevel.None;
}

/**
 * 探查 Debug 等级是否启用。
 */
export function isDebugEnabled(): boolean {
  return isLogLevelEnabled(LogLevel.Debug);
}

/**
 * 探查 Info 等级是否启用。
 */
export function isInfoEnabled(): boolean {
  return isLogLevelEnabled(LogLevel.Info);
}

/**
 * 注册一个日志接收器（例如 VS Code OutputChannel 或磁盘写入流）。
 *
 * @param sink - 接收器回调
 * @returns 取消订阅函数
 */
export function addLogSink(sink: LogSink): () => void {
  _sinks.add(sink);
  return () => {
    _sinks.delete(sink);
  };
}

/**
 * 注销指定的日志接收器。
 *
 * @param sink - 已注册的接收器回调
 */
export function removeLogSink(sink: LogSink): void {
  _sinks.delete(sink);
}

/**
 * 清空所有注册的日志接收器。
 */
export function clearLogSinks(): void {
  _sinks.clear();
}

/**
 * 获取当前注册的接收器总数。
 */
export function getLogSinksCount(): number {
  return _sinks.size;
}

const levelLabels: Record<LogLevel, string> = {
  [LogLevel.Debug]: 'DEBUG',
  [LogLevel.Info]: 'INFO',
  [LogLevel.Warn]: 'WARN',
  [LogLevel.Error]: 'ERROR',
  [LogLevel.None]: 'NONE',
};

const MAX_CAUSE_DEPTH = 5;

/**
 * 递归展开并提取 Error 的堆栈及其 cause 因果链。
 */
function extractErrorDetails(err: unknown): { message: string; stack?: string } {
  if (err instanceof Error) {
    let detail = err.stack || `${err.name}: ${err.message}`;
    let current = (err as Error & { cause?: unknown }).cause;
    let depth = 0;
    while (current && depth < MAX_CAUSE_DEPTH) {
      if (current instanceof Error) {
        detail += `\nCaused by: ${current.stack || `${current.name}: ${current.message}`}`;
        current = (current as Error & { cause?: unknown }).cause;
      } else {
        detail += `\nCaused by: ${String(current)}`;
        break;
      }
      depth++;
    }
    return { message: err.message, stack: detail };
  }
  return { message: String(err) };
}

/**
 * 原生控制台分发器，保留原有控制台直接输出语义。
 */
function dispatchToConsole(level: LogLevel, prefix: string, message: string, err?: Error): void {
  const nativeConsole = console;
  if (err) {
    if (level >= LogLevel.Warn) {
      nativeConsole.warn(prefix, message, err.message, err.stack);
    } else {
      nativeConsole.info(prefix, message, err.message);
    }
    return;
  }

  switch (level) {
    case LogLevel.Error:
      nativeConsole.error(prefix, message);
      break;
    case LogLevel.Warn:
      nativeConsole.warn(prefix, message);
      break;
    default:
      nativeConsole.info(prefix, message);
      break;
  }
}

/**
 * 遍历分发日志实体至已注册的接收器。
 */
function dispatchToSinks(entry: LogEntry): void {
  for (const sink of _sinks) {
    try {
      sink(entry);
    } catch (e) {
      // 容错处理：接收器内部异常静默隔离，避免波及主流程
      void e;
    }
  }
}

/**
 * 跨层日志输出函数。
 * 格式化输出带有时间戳与等级前缀的日志信息；
 * 支持惰性求值 supplier；提取 Error 对象 stack 与 cause；
 * 同时广播至注册的 LogSink 接收器。
 *
 * @param level - 日志级别
 * @param messageOrSupplier - 日志消息主体或惰性求值函数
 * @param args - 附加参数或错误对象
 */
export function log(level: LogLevel, messageOrSupplier: LogMessageSupplier, ...args: unknown[]): void {
  if (level < _minLevel || _minLevel === LogLevel.None) return;

  const message = typeof messageOrSupplier === 'function' ? messageOrSupplier() : messageOrSupplier;
  const label = levelLabels[level] ?? 'UNKNOWN';
  const timestamp = new Date().toISOString().slice(ISO_TIME_START, ISO_TIME_END);
  const prefix = `[WSTiming][${label}][${timestamp}]`;

  const foundError = args.find((a): a is Error => a instanceof Error);

  dispatchToConsole(level, prefix, message, foundError);

  if (_sinks.size === 0) return;

  const errDetails = foundError ? extractErrorDetails(foundError) : undefined;
  const entry: LogEntry = {
    level,
    label,
    timestamp,
    prefix,
    message,
    error: foundError,
    detail: errDetails?.stack,
  };
  dispatchToSinks(entry);
}

/**
 * 便捷日志记录门面对象（只读冻结）
 */
export const logger = Object.freeze({
  debug: (msg: LogMessageSupplier, ...args: unknown[]) => log(LogLevel.Debug, msg, ...args),
  info: (msg: LogMessageSupplier, ...args: unknown[]) => log(LogLevel.Info, msg, ...args),
  warn: (msg: LogMessageSupplier, ...args: unknown[]) => log(LogLevel.Warn, msg, ...args),
  error: (msg: LogMessageSupplier, ...args: unknown[]) => log(LogLevel.Error, msg, ...args),
  isLevelEnabled: (level: LogLevel) => isLogLevelEnabled(level),
  isDebugEnabled: () => isLogLevelEnabled(LogLevel.Debug),
  isInfoEnabled: () => isLogLevelEnabled(LogLevel.Info),
});
