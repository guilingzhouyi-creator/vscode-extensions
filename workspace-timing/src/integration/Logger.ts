/**
 * Module: Logger — 跨层无依赖统一日志工具
 * File Path: src/integration/Logger.ts
 * Architecture Role: Integration layer foundational logging utility with zero external runtime dependencies
 * Dependencies & Triggers: domain/models.ts; used across all layers (Domain, Cache, Persistence, Application, Presentation)
 * Responsibilities: Filter and format structured log entries by LogLevel severity; extract Error object stack traces; provide immutable frozen logger facade
 * Exit Semantics & Design Rationale: Pure console wrapper with zero VS Code API imports, allowing safe execution within unit tests and deep domain services
 */

import { ISO_TIME_START, ISO_TIME_END } from '../domain/models';

export enum LogLevel {
  Debug = 0,
  Info = 1,
  Warn = 2,
  Error = 3,
  None = 4,
}

let _minLevel: LogLevel = LogLevel.Debug;

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

const levelLabels: Record<LogLevel, string> = {
  [LogLevel.Debug]: 'DEBUG',
  [LogLevel.Info]: 'INFO',
  [LogLevel.Warn]: 'WARN',
  [LogLevel.Error]: 'ERROR',
  [LogLevel.None]: 'NONE',
};

/**
 * 跨层日志输出函数。
 * 格式化输出带有时间戳与等级前缀的日志信息；
 * 若包含 Error 对象，将提取其消息与堆栈并路由至对应控制台输出通道。
 *
 * @param level - 日志级别
 * @param message - 日志消息主体
 * @param args - 附加参数或错误对象
 */
export function log(level: LogLevel, message: string, ...args: unknown[]): void {
  if (level < _minLevel) return;

  const label = levelLabels[level] ?? 'UNKNOWN';
  const timestamp = new Date().toISOString().slice(ISO_TIME_START, ISO_TIME_END);
  const prefix = `[WSTiming][${label}][${timestamp}]`;

  if (args.length > 0) {
    // 是否包含 Error 对象
    const errorArg = args.find(a => a instanceof Error);
    if (errorArg) {
      const err = errorArg as Error;
      if (level >= LogLevel.Warn) {
        console.warn(prefix, message, err.message, err.stack);
      } else {
        console.info(prefix, message, err.message);
      }
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
      console.info(prefix, message);
      break;
  }
}

/**
 * 便捷日志记录门面对象（只读冻结）
 */
export const logger = Object.freeze({
  debug: (msg: string, ...args: unknown[]) => log(LogLevel.Debug, msg, ...args),
  info: (msg: string, ...args: unknown[]) => log(LogLevel.Info, msg, ...args),
  warn: (msg: string, ...args: unknown[]) => log(LogLevel.Warn, msg, ...args),
  error: (msg: string, ...args: unknown[]) => log(LogLevel.Error, msg, ...args),
});
