// @wt-script tooling/refactor-adapter
// @purpose L5 重构审查适配层：以稳定 CLI 契约调用 auto-refactor，映射为统一 Finding；外部工具缺失/超时优雅降级，输出损坏 fail-closed
// @origin native（调用已收敛到引擎通用 runner templates/consumer/run.mjs；本层只保留版本核对、超时降级、信封映射与"引擎退出码不承载审查结论"语义）
// @usage node dist/tooling/refactor-adapter.js [--json] [--root <dir>] [--tool <cli路径>] [--update-baseline]
// @exit 0=PASS 或降级（NOT_AVAILABLE/TIMEOUT，报告显式标注） 1=阻断级发现/解析失败 2=配置错误
//
// 隔离边界声明：
//   - 本适配器只依赖 auto-refactor 的【稳定外部契约】——`scan` 子命令、--root/--config/--format json、
//     report.schema.json 描述的 ScanReport 结构、退出码 0/1/2；
//   - 不 import 其内部模块、不依赖其内部目录结构（仅按配置解析 dist/index.js 入口）、不修改其源码与配置；
//   - 外部工具是审查能力提供者，不是本项目架构的组成部分——缺失/超时/版本漂移均不摧毁审查系统。

import path from 'node:path';
import { access, readFile } from 'node:fs/promises';
import { parseArgs, helpFromHeader } from '../common/cli.js';
import { createLogger } from '../common/logger.js';
import { ROOT, SCRIPTS_DIR, toRel } from '../common/paths.js';
import { run } from '../common/proc.js';
import { loadJson, RefactorAdapterConfig, ScanReport } from '../common/config.js';
import { finding, envelope, printEnvelope, STATUS, CheckerStatus, Finding } from '../common/result.js';

const args = parseArgs(process.argv.slice(2));
if (args.help) { await helpFromHeader(import.meta.url); process.exit(0); }
const log = createLogger({ quiet: args.json });
const root = args.root ? path.resolve(args.root) : ROOT;
const started = Date.now();
const CHECKER = 'L5-REFACTOR';

// 函数声明形式 + 显式 never 返回：调用点可被 TS 识别为控制流终点（后续代码获得窄化）
function finish(status: CheckerStatus, findings: Finding[], opts: Record<string, unknown> = {}): never {
    printEnvelope(envelope({ checker: CHECKER, status, findings, filesScanned: 0, durationMs: Date.now() - started, ...opts }));
    process.exit(status === STATUS.PASS ? 0 : (status === STATUS.CONFIG_ERROR ? 2 : (status === STATUS.FAIL ? 1 : 0)));
}

// ── 1. 配置加载（损坏即 CONFIG_ERROR，fail-closed）──
const cfgRes = await loadJson<RefactorAdapterConfig>(path.join(SCRIPTS_DIR, 'config', 'refactor-adapter.json'));
if (!cfgRes.ok) {
    printEnvelope(envelope({ checker: CHECKER, status: STATUS.CONFIG_ERROR, findings: [], notes: [cfgRes.error] }));
    process.exit(2);
}
const cfg = cfgRes.data;
const gate: RefactorAdapterConfig['gate'] = cfg.gate ?? {};
const mapping: RefactorAdapterConfig['mapping'] = cfg.mapping ?? {};
const rankSev = (s: string): number => ({ info: 0, warning: 1, error: 2 })[s] ?? 1;

// ── 2. 工具解析：环境变量 > 配置候选（相对项目根），不做任何硬编码路径回退 ──
async function exists(p: string): Promise<boolean> {
    try { await access(p); return true; } catch { return false; }
}

let cliPath: string | null = null;
const envOverride = process.env[cfg.tool?.resolve?.envOverride ?? 'WT_REFACTOR_CLI'];
const candidates: string[] = [];
if (typeof args.flags.tool === 'string') candidates.push(path.resolve(args.flags.tool));
if (envOverride) candidates.push(path.resolve(envOverride));
for (const c of cfg.tool?.resolve?.candidates ?? []) candidates.push(path.resolve(ROOT, c));

for (const cand of candidates) {
    if (await exists(cand)) { cliPath = cand; break; }
}

if (!cliPath) {
    const status = gate.whenUnavailable === 'fail' ? STATUS.FAIL : STATUS.NOT_AVAILABLE;
    log.warn(`auto-refactor 不可用（候选均不存在：${candidates.join(', ')}）→ ${status}`);
    finish(status, [], {
        notes: [`外部审查能力缺失，按配置降级为 ${status}（gate.whenUnavailable=${gate.whenUnavailable}）`,
            '恢复方式：构建外部工具（npm run build）或设置环境变量 ' + (cfg.tool?.resolve?.envOverride ?? 'WT_REFACTOR_CLI')],
        tool: { resolved: null, candidates },
    });
}

const toolPkgRes = await loadJson<{ version?: string }>(path.resolve(cliPath, '../../package.json'));
const toolVersion = toolPkgRes.ok ? toolPkgRes.data?.version : null;
log.info(`工具解析成功: ${cliPath} (v${toolVersion ?? '?'})`);

// ── 3. 版本核对（mismatch 默认 warning 不阻断，failOnVersionMismatch 可收紧）──
if (cfg.tool?.minVersion && toolVersion) {
    const ge = (a: string, b: string): boolean => {
        const pa = a.split('.').map(Number);
        const pb = b.split('.').map(Number);
        for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
        return true;
    };
    if (!ge(toolVersion, cfg.tool.minVersion)) {
        const msg = `auto-refactor 版本 ${toolVersion} 低于声明下限 ${cfg.tool.minVersion}，报告结构可能不兼容`;
        if (cfg.tool.failOnVersionMismatch) {
            finish(STATUS.FAIL, [finding({
                ruleId: 'RCFG-TOOL-PATH', severity: 'error', module: 'review-system',
                message: msg, evidence: `resolved=${toRel(cliPath)}`,
                suggestedFix: '升级外部工具或经 config 明确接受当前版本',
            })]);
        }
        log.warn(msg);
    }
}

// ── 4. 组装调用：引擎退出码不承载审查结论（结论由本适配器依据结构化报告裁决）──
const scanRoot = path.resolve(root, cfg.scan?.root ?? '.');
const toolConfig = path.resolve(ROOT, cfg.scan?.toolConfig ?? 'scripts/config/auto-refactor.config.json');
const cacheDir = path.resolve(ROOT, cfg.scan?.cacheDir ?? 'reports/.refactor-cache');
// 棘轮经引擎原生能力透传（0.2.0+ grouped 粒度，对行漂移免疫）；基线文件由引擎写入
const ratchetCfg = cfg.ratchet ?? {};
const baselinePath = path.resolve(ROOT, ratchetCfg.baseline ?? 'scripts/config/refactor-baseline.json');
const baselineExists = await exists(baselinePath);
// 调用交给引擎自带的通用 runner（templates/consumer/run.mjs）：参数组装、基线粒度、
// 退出码映射都由引擎单一真源负责；本适配器只保留版本核对、超时降级与信封映射。
const engineDir = path.resolve(cliPath, '..', '..');
const runnerPath = path.join(engineDir, 'templates', 'consumer', 'run.mjs');
if (!(await exists(runnerPath))) {
    log.warn(`引擎缺少通用 runner（${toRel(runnerPath)}）→ 视为版本过旧，按外部故障降级`);
    finish(STATUS.NOT_AVAILABLE, [], {
        notes: [`引擎 ${toolVersion ?? '?'} 未提供 templates/consumer/run.mjs，无法执行审查`],
        tool: { resolved: toRel(cliPath), version: toolVersion },
    });
}
const reportPath = path.join(cacheDir, 'report.json');
const argv = [
    process.execPath, runnerPath,
    '--engine', engineDir,
    '--root', scanRoot,
    '--config', toolConfig,
    '--format', 'json',
    '--out', reportPath,
    '--report-only',   // 裁决由本适配器依据结构化报告做出，引擎退出码不承载结论
    '--quiet',
    '--engine-arg', '--cache-dir', '--engine-arg', cacheDir,
    ...(baselineExists && !args.updateBaseline
        ? ['--baseline', baselinePath, '--baseline-granularity', ratchetCfg.granularity ?? 'grouped']
        : []),
    ...(args.updateBaseline
        ? ['--update-baseline', baselinePath, '--baseline-granularity', ratchetCfg.granularity ?? 'grouped']
        : []),
    ...(cfg.scan?.extraArgs ?? []).flatMap((extra) => ['--engine-arg', extra]),
];
log.info(`runner argv: ${argv.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`);

const result = await run(argv, { cwd: ROOT, timeoutMs: cfg.scan?.timeoutMs ?? 600000 });

if (result.timedOut) {
    const status = gate.whenTimeout === 'fail' ? STATUS.FAIL : STATUS.TIMEOUT;
    log.warn(`外部扫描超时（>${cfg.scan?.timeoutMs}ms）→ ${status}`);
    finish(status, [], {
        notes: [`外部工具超时，按配置降级为 ${status}；不影响本项目其他审查能力`],
        tool: { resolved: toRel(cliPath), version: toolVersion },
    });
}
if (result.error || (result.code !== 0 && result.code !== 1)) {
    // 引擎崩溃（usage/fatal）：属外部能力故障 → 降级留痕，不阻断本项目
    log.warn(`引擎异常退出 code=${result.code}: ${(result.stderr || '').slice(0, 400)}`);
    finish(STATUS.NOT_AVAILABLE, [], {
        notes: [`引擎异常退出（code=${result.code}），按外部故障降级`, `stderr 摘要: ${(result.stderr || '').slice(0, 200)}`],
        tool: { resolved: toRel(cliPath), version: toolVersion, exitCode: result.code },
    });
}

// ── 5. 解析报告（fail-closed：报告缺失/损坏 = 审查结论不可信，必须阻断）──
let report: ScanReport | null = null;
try {
    report = JSON.parse(await readFile(reportPath, 'utf8')) as ScanReport;
} catch (error) {
    report = null;
}
if (!report || report.tool !== 'auto-refactor' || !report.summary) {
    log.error('runner 未产出合法 ScanReport —— fail-closed');
    finish(STATUS.FAIL, [finding({
        ruleId: 'RCFG-TOOL-PATH', severity: 'error', module: 'review-system',
        message: 'auto-refactor 输出无法解析为 ScanReport（损坏输出比无输出更危险：静默放行会让门禁形同虚设）',
        evidence: `报告路径 ${toRel(reportPath)}；stdout 前 300 字符: ${String(result.stdout).slice(0, 300)}`,
        suggestedFix: '核对工具版本与本适配器契约；必要时用 --tool 指定正确入口',
    })], { tool: { resolved: toRel(cliPath), version: toolVersion } });
}

// ── 6. 映射为统一 Finding（0.2.0 起：豁免与棘轮由引擎原生承载，适配器只消费标注）──
//    issue.suppression = { reason, downgraded } → 降级项留在 findings（理由随行），完全豁免进 suppressed 列表
//    issue.isNew = true → 超出基线的新增发现（ratchet.blockOnNewSeverity 裁决阻断）
const suppressed: Array<{ finding: Finding; reason: string }> = [];
const findings: Finding[] = [];
for (const issue of report.issues ?? []) {
    const file = issue.location?.file ? toRel(path.resolve(scanRoot, issue.location.file)) : null;
    const sev = issue.severity ?? 'warning';
    const ruleId = `${mapping.ruleNamespace ?? 'ARF'}-${issue.analyzer}-${issue.rule}`;
    const f = finding({
        ruleId,
        severity: sev,
        module: file?.startsWith('src/') ? file.split('/')[1] : null,
        file,
        line: issue.location?.start?.line ?? null,
        column: issue.location?.start?.column ?? null,
        message: `[auto-refactor v${report.version}] ${issue.message}`,
        evidence: issue.detail ? JSON.stringify(issue.detail).slice(0, 200) : null,
        suggestedFix: issue.suggestion ?? null,
        source: 'auto-refactor',
    });
    const sup = issue.suppression;
    if (sup && !sup.downgraded) {
        suppressed.push({ finding: f, reason: sup.reason });
    } else if (sup) {
        findings.push({ ...f, evidence: `${f.evidence ?? ''} | 豁免降级理由: ${sup.reason}` });
    } else if (issue.isNew) {
        findings.push({ ...f, isNew: true, evidence: `${f.evidence ?? ''} | [NEW] 超出基线` });
    } else {
        findings.push(f);
    }
}

// ── 7. 裁决：阻断级严重度（引擎已按 suppressions 调整）+ 棘轮新增（blockOnNewSeverity）──
const newFindings = findings.filter((f) => f.isNew === true);
const newBlocking = newFindings.filter((f) => rankSev(f.severity) >= rankSev(ratchetCfg.blockOnNewSeverity ?? 'warning'));
const blockOn = gate.blockOnSeverity ?? 'error';
const blocking = findings.filter((f) => rankSev(f.severity) >= rankSev(blockOn));
const status = (blocking.length > 0 || newBlocking.length > 0) ? STATUS.FAIL : STATUS.PASS;

const s = report.summary ?? {};
log.info(`扫描 ${s.filesScanned ?? '?'} 文件 / ${s.issuesTotal ?? '?'} 发现（映射后 ${findings.length}，带理由豁免 ${suppressed.length}，新增阻断 ${newBlocking.length}）`);

finish(status, findings, {
    filesScanned: s.filesScanned ?? 0,
    notes: [
        `bySeverity=${JSON.stringify(s.bySeverity ?? {})}`,
        suppressed.length ? `${suppressed.length} 条命中豁免清单（理由见 suppressed，可审计）` : '无豁免命中',
        args.updateBaseline
            ? `基线已由引擎记录至 ${toRel(baselinePath)}（禁止用于消音：仅应有理由时执行）`
            : baselineExists
                ? `棘轮比对（grouped）：新增 ${newFindings.length} 条`
                : '无棘轮基线：新增判定本轮跳过（--update-baseline 记录）',
        ...(s.warnings ?? []),
    ],
    tool: { resolved: toRel(cliPath), version: toolVersion, durationMs: s.durationMs },
    engineSummary: s,
    suppressed,
    ratchet: { newCount: newFindings.length, blockOnNewSeverity: ratchetCfg.blockOnNewSeverity ?? 'warning', baseline: toRel(baselinePath) },
});
