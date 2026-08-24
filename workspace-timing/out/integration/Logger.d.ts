/**
 * Logger — 跨层日志工具
 *
 * 按等级分层输出，生产环境可关闭 Debug 级别。
 * 不依赖 VS Code API，可在 Domain/Persistence 等下层使用。
 */
export declare enum LogLevel {
    Debug = 0,
    Info = 1,
    Warn = 2,
    Error = 3,
    None = 4
}
/** 设置最低日志等级（低于该等级的不输出） */
export declare function setLogLevel(level: LogLevel): void;
/** 获取当前日志等级 */
export declare function getLogLevel(): LogLevel;
/**
 * 输出日志。
 * Debug 级别仅在非生产环境输出。
 */
export declare function log(level: LogLevel, message: string, ...args: unknown[]): void;
/** 便捷方法 */
export declare const logger: {
    debug: (msg: string, ...args: unknown[]) => void;
    info: (msg: string, ...args: unknown[]) => void;
    warn: (msg: string, ...args: unknown[]) => void;
    error: (msg: string, ...args: unknown[]) => void;
};
