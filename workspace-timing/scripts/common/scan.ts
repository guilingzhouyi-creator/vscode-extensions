// @wt-script common/scan
// @purpose 文件扫描原子能力：glob→正则匹配 + 递归收集 + 统一忽略清单（无第三方依赖）
// @origin native
// @usage import { collectFiles, globToRegex, readFileSafe, stripComments } from './scan.js'
// @exit 不适用（库模块）

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

/** 内建忽略：任何扫描都不会进入这些目录（审查系统自身不产生扫描污染；dist 为脚本库自身编译产物） */
export const BUILTIN_IGNORES: ReadonlySet<string> = new Set([
    'node_modules', '.git', 'out', 'coverage', 'reports', 'dist', 'images',
]);

/**
 * 简易 glob → RegExp。支持：`**`（跨段）、`*`（单段内）、`?`（单字符）。
 * 仅覆盖本项目配置表达需求，不做完整 glob 语义。
 */
const GLOB_SENTINEL = '\u0000';
export function globToRegex(glob: string): RegExp {
    const escaped = glob
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, GLOB_SENTINEL)
        .replace(/\*/g, '[^/]*')
        .replace(new RegExp(GLOB_SENTINEL, "g"), '.*')
        .replace(/\?/g, '.');
    return new RegExp(`^${escaped}$`);
}

export interface CollectOptions {
    root: string;
    include: string[];
    exclude?: string[];
    builtinIgnore?: boolean;
}

/** 递归收集文件（POSIX 相对路径返回） */
export async function collectFiles({ root, include, exclude = [], builtinIgnore = true }: CollectOptions): Promise<string[]> {
    const incRes = (include ?? []).map(globToRegex);
    const excRes = (exclude ?? []).map(globToRegex);
    const out: string[] = [];

    async function walk(rel: string): Promise<void> {
        const abs = rel ? path.join(root, rel) : root;
        let entries;
        try {
            entries = await readdir(abs, { withFileTypes: true });
        } catch {
            return; // 目录不可读：跳过（扫描器不得因个别目录权限失败整体崩溃）
        }
        for (const e of entries) {
            const relPath = rel ? `${rel}/${e.name}` : e.name;
            if (e.isDirectory()) {
                if (builtinIgnore && BUILTIN_IGNORES.has(e.name)) continue;
                await walk(relPath);
            } else if (e.isFile()) {
                if (incRes.length && !incRes.some((re) => re.test(relPath))) continue;
                if (excRes.some((re) => re.test(relPath))) continue;
                out.push(relPath);
            }
        }
    }

    await walk('');
    out.sort();
    return out;
}

/** 读文本文件；失败返回 null（由调用方决定告警或跳过） */
export async function readFileSafe(absPath: string): Promise<string | null> {
    try {
        return await readFile(absPath, 'utf8');
    } catch {
        return null;
    }
}

/** 去除块注释与行注释（保守实现，供 CJK/魔法值匹配降噪；保留字符串内容） */
export function stripComments(text: string): string {
    return text
        .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
        .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}
