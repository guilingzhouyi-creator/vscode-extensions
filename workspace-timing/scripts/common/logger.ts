// @wt-script common/logger
// @purpose 统一日志：人类可读行输出到 stderr；--json 模式静默（stdout 保持机器可读纯 JSON）
// @origin native
// @usage import { createLogger } from './logger.js'
// @exit 不适用（库模块）

export interface Logger {
    debug(msg: string): void;
    info(msg: string): void;
    warn(msg: string): void;
    error(msg: string): void;
}

/**
 * 创建检查器级 logger。
 * 约定：stdout 只允许输出机器可读结果（run-review 依赖解析），
 *      一切人类可读诊断必须走 stderr —— 与 WebGames audit 引擎同规约。
 */
export function createLogger({ quiet = false, prefix = 'wt-review' }: { quiet?: boolean; prefix?: string } = {}): Logger {
    const line = (level: string, msg: string): void => {
        if (quiet) return;
        const stamp = new Date().toISOString().slice(11, 23);
        process.stderr.write(`[${prefix}][${level}][${stamp}] ${msg}\n`);
    };
    return {
        debug: (m) => line('DEBUG', m),
        info: (m) => line('INFO', m),
        warn: (m) => line('WARN', m),
        error: (m) => line('ERROR', m),
    };
}
