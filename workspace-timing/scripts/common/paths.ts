// @wt-script common/paths
// @purpose 项目根锚定的路径解析：所有脚本以本文件位置反推项目根，禁止任何绝对盘符路径
// @origin native
// @usage import { ROOT, SCRIPTS_DIR, toRel, resolveFromRoot } from './paths.js'
// @exit 不适用（库模块）

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// 锚定规则：
//   源码态 scripts/common/  → 上 1 级 = scripts/
//   产物态 scripts/dist/common/ → 上 2 级 = scripts/（dist 镜像保持相同相对布局）
const inDist = path.basename(path.dirname(here)) === 'dist';
export const SCRIPTS_DIR = inDist ? path.resolve(here, '..', '..') : path.resolve(here, '..');
/** 脚本库 TS 编译产物目录（编排器执行镜像：dist/<checker 路径 .js>） */
export const SCRIPTS_DIST = path.join(SCRIPTS_DIR, 'dist');
export const ROOT = path.resolve(SCRIPTS_DIR, '..');
export const REPORTS_DIR = path.join(ROOT, 'reports');
export const REVIEW_REPORT_DIR = path.join(REPORTS_DIR, 'review');

/** 绝对路径 → 项目相对 POSIX 风格路径（报告与证据统一使用） */
export function toRel(absolutePath: string): string {
    return path.relative(ROOT, absolutePath).split(path.sep).join('/');
}

/** 项目相对路径 → 绝对路径（配置中的所有路径均按此解析，实现"配置无绝对路径"约束） */
export function resolveFromRoot(relPath: string): string {
    return path.resolve(ROOT, relPath);
}
