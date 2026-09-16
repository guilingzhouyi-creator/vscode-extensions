// @wt-script common/cli
// @purpose 检查器通用参数解析：全库统一长选项词汇表（--json/--strict/--root/--update-baseline/--help）
// @origin native
// @usage import { parseArgs, helpFromHeader } from './cli.js'
// @exit 不适用（库模块）

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export interface ParsedArgs {
    flags: Record<string, string | boolean>;
    json: boolean;
    strict: boolean;
    updateBaseline: boolean;
    root?: string;
    help: boolean;
}

/**
 * 解析 `--key value` / `--flag` / `--key=value` 三种形态。
 */
export function parseArgs(argv: string[], _opts: { boolFlags?: string[] } = {}): ParsedArgs {
    const flags: Record<string, string | boolean> = {};
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (!a.startsWith('--')) continue;
        const eq = a.indexOf('=');
        if (eq > 0) {
            flags[a.slice(2, eq)] = a.slice(eq + 1);
            continue;
        }
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('--')) {
            flags[a.slice(2)] = next;
            i++;
        } else {
            flags[a.slice(2)] = true;
        }
    }
    return {
        flags,
        json: flags.json === true || flags.json === 'true',
        strict: flags.strict === true || flags.strict === 'true',
        updateBaseline: flags['update-baseline'] === true,
        root: typeof flags.root === 'string' ? flags.root : undefined,
        help: flags.help === true || flags.h === true,
    };
}

/** 头注释即帮助：打印脚本自身前 N 行注释（WebGames 同款自检式帮助——漂移立即可见） */
export async function helpFromHeader(moduleUrl: string, lineCount = 12): Promise<void> {
    const file = fileURLToPath(moduleUrl);
    const text = await readFile(file, 'utf8');
    const lines = text.split(/\r?\n/).slice(0, lineCount).filter((l) => l.startsWith('//'));
    process.stderr.write(lines.join('\n') + '\n');
}
