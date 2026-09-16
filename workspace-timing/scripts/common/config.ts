// @wt-script common/config
// @purpose JSON 配置加载与结构校验：配置损坏时 fail-closed（返回 CONFIG_ERROR 而非静默放行）；三类配置的 TypeScript 契约
// @origin native
// @usage import { loadJson, missingFields, extractJsonObject } from './config.js'
// @exit 不适用（库模块）

import { readFile } from 'node:fs/promises';

export type LoadResult<T> = { ok: true; data: T; error: null } | { ok: false; data: null; error: string };

/**
 * 读取 JSON 文件。损坏/缺失不抛异常，返回 LoadResult，
 * 由调用方决定降级或 fail-closed —— 禁止静默当 {} 用。
 */
export async function loadJson<T = unknown>(absPath: string): Promise<LoadResult<T>> {
    let text: string;
    try {
        text = await readFile(absPath, 'utf8');
    } catch (err) {
        return { ok: false, data: null, error: `无法读取 ${absPath}: ${(err as Error).message}` };
    }
    try {
        return { ok: true, data: JSON.parse(text) as T, error: null };
    } catch (err) {
        return { ok: false, data: null, error: `JSON 解析失败 ${absPath}: ${(err as Error).message}` };
    }
}

/** 必填字段校验；返回缺失字段名数组（空数组 = 通过） */
export function missingFields(obj: Record<string, unknown> | null | undefined, required: string[]): string[] {
    return (required ?? []).filter((k) => obj?.[k] === undefined);
}

/** 从 stdout 中截取首个完整 JSON 值（对象或数组；容错上游混入告警行；括号计数法，参考 WebGames audit_refactor_metrics 实践） */
export function extractJsonObject(text: string | null | undefined): unknown {
    if (!text) return null;
    const candidates = [text.indexOf('{'), text.indexOf('[')].filter((i) => i >= 0);
    if (candidates.length === 0) return null;
    const start = Math.min(...candidates);
    let depth = 0;
    let inStr = false;
    let quote = '';
    let esc = false;
    for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (inStr) {
            if (esc) esc = false;
            else if (ch === '\\') esc = true;
            else if (ch === quote) inStr = false;
            continue;
        }
        if (ch === '"' || ch === "'") { inStr = true; quote = ch; continue; }
        if (ch === '{' || ch === '[') depth++;
        else if (ch === '}' || ch === ']') {
            depth--;
            if (depth === 0) {
                try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; }
            }
        }
    }
    return null;
}

// ─────────────────────────────────────────────────────────────
// 配置契约：review-rules.json / refactor-adapter.json / ScanReport
// （JSON 边界处统一 narrow 到以下形状；未知字段宽容、已用字段强类型）
// ─────────────────────────────────────────────────────────────

/** 检查器注册项（review-rules.json checkers[]） */
export interface CheckerEntry {
    id: string;
    layer: string;
    title?: string;
    /** 源码相对路径（scripts/ 下，如 audit/hardcode.ts）；编排器执行 dist 镜像 .js */
    checker: string;
    stage?: number;
    enabled?: boolean;
    timeoutMs?: number;
    origin?: string;
    ruleIds?: string[];
    /** 结果复用：本检查器消费指定检查器的 durationMs（编排器自动注入 --consume-duration） */
    consumeFrom?: string;
    consumeNote?: string;
}

export interface LayerRule {
    mayImportLayers?: string[];
    mayImportExternal?: string[];
    externalModules?: string[];
}

export interface HardcodeRules {
    magicNumber?: { exemptPaths?: string[]; exemptValues?: number[] };
    uiString?: { scanPaths?: string[]; exemptPaths?: string[] };
    secretPatterns?: string[];
}

export interface PerfRules {
    timerLiteral?: { exemptPaths?: string[] };
}

export interface LayerRules {
    layerOf: Record<string, string>;
    rules: Record<string, LayerRule>;
    matchingSemantics?: string;
}

export interface ReviewRules {
    schema?: string;
    version?: number;
    gate?: { blockOnSeverity?: string };
    execution?: { maxConcurrency?: number; defaultTimeoutMs?: number };
    checkers: CheckerEntry[];
    layers?: LayerRules;
    hardcode?: HardcodeRules;
    perfPatterns?: PerfRules;
}

/** 适配层豁免条目：downgradeTo 降级留痕 / 无 downgradeTo 完全豁免进 suppressed 列表 */
export interface SuppressionEntry {
    matchFile?: string;
    matchAnalyzer?: string;
    matchRule?: string;
    matchSymbol?: string;
    downgradeTo?: 'info' | 'warning' | 'error';
    reason: string;
}

export interface RefactorAdapterConfig {
    schema?: string;
    tool?: {
        name?: string;
        minVersion?: string;
        failOnVersionMismatch?: boolean;
        resolve?: { envOverride?: string; candidates?: string[] };
    };
    scan?: {
        root?: string;
        toolConfig?: string;
        cacheDir?: string;
        timeoutMs?: number;
        extraArgs?: string[];
    };
    gate?: { blockOnSeverity?: string; whenUnavailable?: 'skip' | 'fail'; whenTimeout?: 'skip' | 'fail' };
    ratchet?: { baseline?: string; granularity?: 'id' | 'grouped'; blockOnNewSeverity?: 'info' | 'warning' | 'error' };
    mapping?: { ruleNamespace?: string; source?: string; suppressed?: SuppressionEntry[] };
}

/** auto-refactor ScanReport（稳定外部契约的最小子集，见其 report.schema.json；0.2.0 起含豁免/棘轮标注） */
export interface ScanReport {
    tool: string;
    version: string;
    summary: {
        filesScanned: number;
        issuesTotal: number;
        bySeverity: Record<string, number>;
        byAnalyzer: Record<string, number>;
        durationMs: number;
        /** 0.2.0+：命中声明式豁免的条数（豁免可见、不参与阻断计数） */
        suppressedCount?: number;
        /** 0.2.0+：配置元自检警告（如 include glob 命中 0 文件） */
        warnings?: string[];
    };
    issues: Array<{
        id?: string;
        analyzer: string;
        rule: string;
        severity: 'info' | 'warning' | 'error';
        message: string;
        location?: { file: string; start?: { line: number; column: number } };
        detail?: Record<string, unknown>;
        suggestion?: string;
        /** 0.2.0+：棘轮标注——超出基线的新增发现 */
        isNew?: boolean;
        /** 0.2.0+：命中声明式豁免（downgraded=true 时 severity 已被引擎下调） */
        suppression?: { reason: string; downgraded: boolean };
    }>;
}
