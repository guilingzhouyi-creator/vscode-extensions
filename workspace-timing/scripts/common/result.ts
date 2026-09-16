// @wt-script common/result
// @purpose 统一结果契约：Finding 结构、检查器结果信封、裁决与 stdout 输出（全库唯一事实源）
// @origin native（Finding 字段设计参考 WebGames audit_common.Finding，增加 module/evidence/location/source 溯源字段）
// @usage import { finding, envelope, printEnvelope, verdict, STATUS } from './result.js'
// @exit 不适用（库模块）

export type Severity = 'info' | 'warning' | 'error';
export type FindingSource = 'internal-checker' | 'auto-refactor' | 'build' | 'test' | 'benchmark';

/** 检查器状态词表（禁止把未执行写成 PASS —— 六种状态显式区分） */
export const STATUS = {
    PASS: 'PASS',
    FAIL: 'FAIL',
    SKIP: 'SKIP',                   // 按配置/参数有意跳过
    NOT_AVAILABLE: 'NOT_AVAILABLE', // 外部能力缺失（如 auto-refactor 未编译）
    CONFIG_ERROR: 'CONFIG_ERROR',   // 自身配置/入参损坏，无法形成结论
    TIMEOUT: 'TIMEOUT',             // 执行超时，未形成结论
} as const;
export type CheckerStatus = (typeof STATUS)[keyof typeof STATUS];

/** 统一 Finding 结构（对应审查总纲"结果统一结构"条）。
 *  source 取值：internal-checker | auto-refactor | build | test | benchmark；
 *  webgames-derived 的来源在 scripts/config/review-rules.json 的 origin 字段声明。 */
export interface Finding {
    ruleId: string;
    severity: Severity;
    module: string | null;
    file: string | null;
    location: { line: number; column?: number } | null;
    message: string;
    evidence: string | null;
    suggestedFix: string | null;
    source: FindingSource;
    /** 棘轮标记：超出基线的新增发现（由适配层标注） */
    isNew?: boolean;
}

export interface FindingInput {
    ruleId: string;
    severity: Severity;
    message: string;
    file?: string | null;
    line?: number | null;
    column?: number | null;
    module?: string | null;
    evidence?: string | null;
    suggestedFix?: string | null;
    source?: FindingSource;
}

export function finding(input: FindingInput): Finding {
    const { line = null, column = null } = input;
    return {
        ruleId: input.ruleId,
        severity: input.severity,
        module: input.module ?? null,
        file: input.file ?? null,
        location: line === null ? null : { line, column: column ?? undefined },
        message: input.message,
        evidence: input.evidence ?? null,
        suggestedFix: input.suggestedFix ?? null,
        source: input.source ?? 'internal-checker',
    };
}

/** 检查器结果信封（--json 模式 stdout 的唯一输出；extra 字段平铺在顶层） */
export interface CheckerEnvelope {
    schema: 'wt-checker/v1';
    checker: string;
    status: CheckerStatus;
    filesScanned: number;
    durationMs: number;
    counts: { findings: number; bySeverity: Record<Severity, number> };
    findings: Finding[];
    notes: string[];
    [key: string]: unknown;
}

export function envelope({ checker, status, findings = [], filesScanned = 0, durationMs = 0, notes = [], ...extra }: {
    checker: string;
    status: CheckerStatus;
    findings?: Finding[];
    filesScanned?: number;
    durationMs?: number;
    notes?: string[];
} & Record<string, unknown>): CheckerEnvelope {
    const bySeverity: Record<Severity, number> = { info: 0, warning: 0, error: 0 };
    for (const f of findings) bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;
    return {
        schema: 'wt-checker/v1',
        checker,
        status,
        filesScanned,
        durationMs,
        counts: { findings: findings.length, bySeverity },
        findings,
        notes,
        ...extra,
    };
}

const SEVERITY_RANK: Record<Severity, number> = { info: 0, warning: 1, error: 2 };

/** 按 gate 阈值裁决：存在 >= blockOn 级 finding → FAIL，否则 PASS */
export function verdict(findings: Finding[], { blockOn = 'error' }: { blockOn?: Severity } = {}): CheckerStatus {
    return findings.some((f) => SEVERITY_RANK[f.severity] >= SEVERITY_RANK[blockOn]) ? STATUS.FAIL : STATUS.PASS;
}

export function severityRank(s: Severity): number {
    return SEVERITY_RANK[s];
}

/** stdout 输出机器结果（保持纯 JSON，方便上游截取解析） */
export function printEnvelope(result: CheckerEnvelope): void {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
