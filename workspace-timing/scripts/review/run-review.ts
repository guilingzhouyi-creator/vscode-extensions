// @wt-script review/run-review
// @purpose 自动化审查编排器 + Quality Gate：按注册表两波调度全部检查器，聚合统一结果，产出 JSON/MD 报告并裁决阻断
// @origin native（两波 DAG 调度与注册表驱动思想参考 WebGames audit_runner.py，按本项目规模简化为 stage 1/2）
// @usage node dist/review/run-review.js [--gate] [--strict] [--json] [--no-report] [--only <id,id>] [--changed] [--self-test] [--update-baseline]
// @exit 0=PASS（含降级，见报告状态标注） 1=审查未通过（阻断） 2=编排配置损坏
// @exit 说明：--gate 下 FAIL/CONFIG_ERROR/TIMEOUT → 1；--strict 额外把 SKIP/NOT_AVAILABLE 也判为未通过（CI 推荐）

import path from 'node:path';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { accessSync } from 'node:fs';
import { parseArgs, helpFromHeader } from '../common/cli.js';
import { createLogger } from '../common/logger.js';
import { ROOT, SCRIPTS_DIR, SCRIPTS_DIST, REVIEW_REPORT_DIR, toRel } from '../common/paths.js';
import { loadJson, extractJsonObject, ReviewRules, CheckerEntry } from '../common/config.js';
import { run } from '../common/proc.js';
import { STATUS, Severity, CheckerStatus, CheckerEnvelope } from '../common/result.js';

const args = parseArgs(process.argv.slice(2));
if (args.help) { await helpFromHeader(import.meta.url, 14); process.exit(0); }
const log = createLogger({ quiet: args.json });
const started = Date.now();

const cfgRes = await loadJson<ReviewRules>(path.join(SCRIPTS_DIR, 'config', 'review-rules.json'));
if (!cfgRes.ok) {
    process.stderr.write(`[run-review] 编排配置不可用: ${cfgRes.error}\n`);
    process.exit(2);
}
const registry = cfgRes.data;
const gateCfg = registry.gate ?? {};
const execCfg = registry.execution ?? {};

const onlyIds = typeof args.flags.only === 'string' ? args.flags.only.split(',').map((s) => s.trim()).filter(Boolean) : [];
let selected = (registry.checkers ?? []).filter((c) => c.enabled !== false);
if (args.flags.changed) selected = await filterChanged(selected);
if (onlyIds.length) selected = selected.filter((c) => onlyIds.includes(c.id) || onlyIds.includes(c.layer));
if (selected.length === 0) {
    // 未实际执行任何检查时禁止输出 PASS（审查不可静默空转）
    process.stderr.write(`[run-review] 选择器未命中任何检查器（--only=${onlyIds.join(',') || '(空)'}；--changed 无匹配变更？），拒绝空跑\n`);
    process.exit(2);
}

/** --changed 定向扫描：git 变更路径 → 保守映射受影响检查器（未知路径回退全量） */
async function filterChanged(list: CheckerEntry[]): Promise<CheckerEntry[]> {
    const prefixRes = await run(['git', 'rev-parse', '--show-prefix'], { cwd: ROOT, timeoutMs: 15000 });
    const statusRes = await run(['git', 'status', '--porcelain'], { cwd: ROOT, timeoutMs: 15000 });
    if (prefixRes.code !== 0 || statusRes.code !== 0) {
        log.warn('git 不可用或非仓库，--changed 回退全量');
        return list;
    }
    const prefix = prefixRes.stdout.trim();
    const ALL = list.map((c) => c.id);
    const MAP: Array<[string, string[]]> = [
        ['src/', ['L0-COMPILE', 'L1-LINT', 'L2-LAYERS', 'L3-HARDCODE', 'L5-REFACTOR', 'L0-TEST', 'L4-TEST-BUDGET']],
        ['test/', ['L0-COMPILE', 'L0-TEST', 'L4-TEST-BUDGET']],
        ['scripts/', ['L3-SCRIPT-STANDARD', 'L3-REVIEW-CONFIG']],
        ['.eslintrc.json', ['L1-LINT']],
    ];
    const ids = new Set<string>();
    for (const line of statusRes.stdout.split('\n')) {
        if (!line.trim()) continue;
        let p = line.slice(3).trim().replace(/^"|"$/g, '');
        if (p.includes(' -> ')) p = p.split(' -> ')[1];
        if (prefix && p.startsWith(prefix)) p = p.slice(prefix.length);
        if (!p) continue;
        let hit = false;
        for (const [pre, idsFor] of MAP) {
            if (p === pre || p.startsWith(pre)) { idsFor.forEach((i) => ids.add(i)); hit = true; }
        }
        if (!hit) { ALL.forEach((i) => ids.add(i)); break; } // 未知路径：保守全量
    }
    log.info(`--changed: 命中检查器 ${[...ids].join(', ') || '(无)'}`);
    return list.filter((c) => ids.has(c.id));
}

/** 自检模式：对含已知违规的夹具项目运行确定性检查器，断言全部命中（审查系统自身可验证） */
async function selfTest(): Promise<never> {
    const fixtureRoot = path.join(REVIEW_REPORT_DIR, '.self-test-fixture');
    await rm(fixtureRoot, { recursive: true, force: true });
    const files: Record<string, string> = {
        'tsconfig.json': '{}',
        // 违规夹具 5：版本头缺日期（文本布局契约）
        'CHANGELOG.md': '## [0.1.0]\n### Fixed（缺陷修复）\n- x\n',
        // 违规夹具 6：README 缺必需节（只有标题，无功能亮点/路线图等）
        'README.md': '# x\n',
        'src/domain/models.ts': 'export const OK = 1;\n',
        // 违规夹具 1：application 层 import vscode（越层）
        'src/application/bad.ts': "import * as vscode from 'vscode';\nexport const x = vscode.window;\n",
        // 违规夹具 2：定时器字面量
        'src/domain/badtimer.ts': 'setInterval(() => {}, 500);\n',
        // 违规夹具 3：宿主 UI 串硬编码（showInformationMessage + 中文字面量）
        'src/presentation/badui.ts': "export const bad = (vscode: { window: { showInformationMessage: (s: string) => void } }) => vscode.window.showInformationMessage('你好世界');\n",
        // 违规夹具 4：循环依赖（无层目录——验证建边与层检查解耦后的环检测）
        'src/cyc/a.ts': "import { b } from './b';\nexport const a = 1;\n",
        'src/cyc/b.ts': "import { a } from './a';\nexport const b = 2;\n",
    };
    for (const [rel, content] of Object.entries(files)) {
        const abs = path.join(fixtureRoot, rel);
        await mkdir(path.dirname(abs), { recursive: true });
        await writeFile(abs, content, 'utf8');
    }
    const cases: Array<{ checker: string; expectRule: string }> = [
        { checker: 'audit/layer-boundary.js', expectRule: 'LAY-IMPORT' },
        { checker: 'audit/layer-boundary.js', expectRule: 'LAY-CYCLE' },
        { checker: 'audit/hardcode.js', expectRule: 'HC-UI-STRING' },
        { checker: 'audit/text-layout.js', expectRule: 'DOC-CL-002' },
        { checker: 'audit/text-layout.js', expectRule: 'DOC-RD-001' },
    ];
    let ok = true;
    for (const c of cases) {
        const r = await run([process.execPath, path.join(SCRIPTS_DIST, c.checker), '--json', '--root', fixtureRoot], { cwd: ROOT, timeoutMs: 60000 });
        const parsed = extractJsonObject(r.stdout) as CheckerEnvelope | null;
        const hit = parsed?.findings?.some((f) => f.ruleId === c.expectRule) ?? false;
        if (!parsed || !hit || parsed.status !== 'FAIL') {
            ok = false;
            log.error(`自检失败: ${c.checker} 期望命中 ${c.expectRule}，实际 status=${parsed?.status} findings=${JSON.stringify(parsed?.findings?.map((f) => f.ruleId))}`);
        } else {
            log.info(`自检通过: ${c.checker} 命中 ${c.expectRule}`);
        }
    }
    await rm(fixtureRoot, { recursive: true, force: true });
    process.stderr.write(ok ? '[run-review] 自检结论：审查引擎全部命中已知违规夹具 ✅\n' : '[run-review] 自检结论：存在未命中夹具的检查器 ❌\n');
    process.exit(ok ? 0 : 1);
}
if (args.flags['self-test']) await selfTest();

// ── 两波调度：stage1（编译 + 静态审查互不依赖，并行）→ stage2（依赖编译产物的测试与预算，链式复用结果）──
const BASELINE_ACCEPTORS = new Set(['L4-TEST-BUDGET', 'L5-REFACTOR']);
const VALID_SEVERITIES = new Set<Severity>(['info', 'warning', 'error']);

interface CheckResult {
    id: string;
    checker: string;
    layer: string;
    origin?: string;
    status: CheckerStatus;
    findings: import('../common/result.js').Finding[];
    durationMs: number;
    notes?: string[];
    counts?: { findings: number; bySeverity: Record<string, number> };
    filesScanned?: number;
    [key: string]: unknown;
}

async function runChecker(c: CheckerEntry, deps: Map<string, number>): Promise<CheckResult> {
    const t0 = Date.now();
    const timeoutMs = c.timeoutMs ?? execCfg.defaultTimeoutMs ?? 180000;
    // 注册表指向源码路径（.ts），执行 dist 编译镜像（.js）
    const srcPath = path.join(SCRIPTS_DIR, c.checker);
    try {
        accessSync(srcPath);
    } catch {
        // 悬空注册：源文件已删除而注册表仍在（增量构建不清 dist 残留，须以源存在性为准）
        return { id: c.id, checker: c.checker, layer: c.layer, status: STATUS.CONFIG_ERROR, findings: [], durationMs: Date.now() - t0, notes: [`悬空注册：源文件缺失 ${c.checker}（审查系统宣称执行实际缺失的能力）`] };
    }
    const exe = path.join(SCRIPTS_DIST, c.checker.replace(/\.ts$/, '.js'));
    const argv = [process.execPath, exe, '--json'];
    if (args.flags['update-baseline'] && BASELINE_ACCEPTORS.has(c.id)) argv.push('--update-baseline');
    if (c.consumeFrom && deps.has(c.consumeFrom)) {
        argv.push('--consume-duration', String(deps.get(c.consumeFrom)));
    }
    const r = await run(argv, { cwd: ROOT, timeoutMs });

    const parsed = extractJsonObject(r.stdout) as CheckerEnvelope | null;
    if (r.timedOut) {
        return { id: c.id, checker: c.checker, layer: c.layer, status: STATUS.TIMEOUT, findings: [], durationMs: r.durationMs, notes: [`超过 ${timeoutMs}ms 已强杀`] };
    }
    if (!parsed || parsed.schema !== 'wt-checker/v1') {
        // 检查器崩溃或输出损坏 → fail-closed（门禁不得对"无法形成结论"输出 PASS）
        return {
            id: c.id, checker: c.checker, layer: c.layer, status: STATUS.CONFIG_ERROR, findings: [],
            durationMs: Date.now() - t0,
            notes: [`stdout 无法解析为 wt-checker/v1 信封（exit=${r.code}）`, `stderr 摘要: ${(r.stderr || '').slice(0, 300)}`],
        };
    }
    // 信封身份与发现结构校验：检查器不得伪装他人身份或输出不合契约的发现
    if (parsed.checker !== c.id) {
        return { id: c.id, checker: c.checker, layer: c.layer, status: STATUS.CONFIG_ERROR, findings: [], durationMs: parsed.durationMs ?? Date.now() - t0, notes: [`信封 checker="${parsed.checker}" 与注册表 id="${c.id}" 不符（漂移或伪装）`] };
    }
    const bad = (parsed.findings ?? []).filter((f) => !f.ruleId || !f.message || !VALID_SEVERITIES.has(f.severity));
    if (bad.length) {
        return { id: c.id, checker: c.checker, layer: c.layer, status: STATUS.CONFIG_ERROR, findings: [], durationMs: parsed.durationMs ?? Date.now() - t0, notes: [`${bad.length} 条发现不合契约（缺 ruleId/message 或 severity 非法）`] };
    }
    // spread 在前、显式字段在后：checker/durationMs 以本编排器登记为准（防信封字段覆盖注册事实）
    return { ...parsed, id: c.id, checker: c.checker, layer: c.layer, origin: c.origin, durationMs: parsed.durationMs ?? Date.now() - t0 };
}

async function runWave(list: CheckerEntry[], deps = new Map<string, number>()): Promise<CheckResult[]> {
    // 存在结果复用依赖时退化为串行链（消费者须在提供者之后执行）
    const chained = list.some((c) => c.consumeFrom);
    const ordered = chained
        ? [...list].sort((a, b) => (a.consumeFrom ? 1 : 0) - (b.consumeFrom ? 1 : 0))
        : list;
    const conc = chained ? 1 : Math.max(1, execCfg.maxConcurrency ?? 4);
    const results: CheckResult[] = [];
    let idx = 0;
    async function worker(): Promise<void> {
        while (idx < ordered.length) {
            const c = ordered[idx++];
            log.info(`▶ ${c.id} (${c.checker})`);
            const res = await runChecker(c, deps);
            if (res.status === STATUS.PASS || res.status === STATUS.FAIL) deps.set(c.id, res.durationMs);
            log.info(`■ ${c.id} → ${res.status} (${res.durationMs}ms, findings=${res.findings.length})`);
            results.push(res);
        }
    }
    await Promise.all(Array.from({ length: Math.min(conc, ordered.length) }, worker));
    return results;
}

const stage1 = selected.filter((c) => (c.stage ?? 1) === 1);
const stage2 = selected.filter((c) => (c.stage ?? 1) === 2);
const wave1 = await runWave(stage1);
const wave2 = await runWave(stage2);
const results = [...wave1, ...wave2];

// ── Gate 裁决 ──
// gate 模式：FAIL/CONFIG_ERROR/TIMEOUT → 阻断；--strict：SKIP/NOT_AVAILABLE 一并阻断（CI 推荐）
const isGate = args.flags.gate === true;
const isStrict = args.strict;
const blockingStatuses: CheckerStatus[] = [STATUS.FAIL, STATUS.CONFIG_ERROR, STATUS.TIMEOUT];
const allFindings = results.flatMap((r) => (r.findings ?? []).map((f) => ({ ...f, checker: r.id })));
const blockOn = gateCfg.blockOnSeverity ?? 'error';
const rank = (s: Severity): number => ({ info: 0, warning: 1, error: 2 })[s] ?? 1;

const gateFailures: string[] = [];
for (const r of results) {
    const sevFail = (r.findings ?? []).some((f) => rank(f.severity) >= rank(blockOn as Severity));
    const statusFail = blockingStatuses.includes(r.status);
    if (sevFail || statusFail) gateFailures.push(r.id);
    else if (isStrict && r.status !== STATUS.PASS) gateFailures.push(`${r.id}(${r.status})`);
}
const verdictStr = gateFailures.length ? 'BLOCK' : 'PASS';
const gateExit = verdictStr === 'BLOCK' ? 1 : 0;
// 报告模式与 gate 模式退出码一致（0/1），便于本地与 CI 用同一信号判别；--no-report 只是不写报告文件
const exitCode = gateExit;

// ── 报告落盘（JSON + Markdown）──
const report = {
    schema: 'wt-review-report/v1',
    project: 'workspace-timing',
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    mode: { gate: isGate, strict: isStrict, only: onlyIds, changed: args.flags.changed === true },
    registry: { schema: registry.schema, version: registry.version },
    verdict: verdictStr,
    gateFailures,
    summary: {
        checks: results.length,
        byStatus: results.reduce<Record<string, number>>((m, r) => { m[r.status] = (m[r.status] ?? 0) + 1; return m; }, {}),
        findings: allFindings.length,
        bySeverity: allFindings.reduce<Record<string, number>>((m, f) => { m[f.severity] = (m[f.severity] ?? 0) + 1; return m; }, {}),
        bySource: allFindings.reduce<Record<string, number>>((m, f) => { m[f.source] = (m[f.source] ?? 0) + 1; return m; }, {}),
    },
    results,
};
if (!args.flags['no-report']) {
    await mkdir(REVIEW_REPORT_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    await writeFile(path.join(REVIEW_REPORT_DIR, `report-${stamp}.json`), JSON.stringify(report, null, 2), 'utf8');
    await writeFile(path.join(REVIEW_REPORT_DIR, 'report-latest.json'), JSON.stringify(report, null, 2), 'utf8');

    const md = [
        `# 审查报告 ${report.generatedAt}`,
        ``,
        `**结论: ${verdictStr}** （mode: gate=${isGate}, strict=${isStrict}; 耗时 ${report.durationMs}ms）`,
        ``,
        `| 检查器 | 层 | 来源 | 状态 | 发现数 | 耗时 |`,
        `|---|---|---|---|---:|---:|`,
        ...results.map((r) => `| ${r.id} | ${r.layer} | ${r.origin ?? '-'} | ${r.status} | ${r.findings.length} | ${r.durationMs}ms |`),
        ``,
        `## 发现明细（ruleId / severity / 位置 / 消息）`,
        ...(allFindings.length
            ? allFindings.map((f) => `- \`${f.ruleId}\` [${f.severity}] ${f.file ?? ''}${f.location ? ':' + f.location.line : ''} — ${f.message}${f.suggestedFix ? `（建议: ${f.suggestedFix}）` : ''}`)
            : ['（无发现）']),
    ].join('\n');
    await writeFile(path.join(REVIEW_REPORT_DIR, 'report-latest.md'), md, 'utf8');
    log.info(`报告已写入 ${toRel(REVIEW_REPORT_DIR)}/report-latest.{json,md}`);
}

if (!args.json) {
    process.stderr.write('\n===== 审查摘要 =====\n');
    for (const r of results) process.stderr.write(`${r.status === STATUS.PASS ? '✅' : (r.status === STATUS.FAIL ? '❌' : '⚠️ ')} ${r.id.padEnd(20)} ${r.status.padEnd(14)} findings=${r.findings.length}\n`);
    process.stderr.write(`-----\n【门禁结论】${verdictStr}${gateFailures.length ? `（阻断来源: ${gateFailures.join(', ')}）` : ''}\n`);
}

process.exit(exitCode);
