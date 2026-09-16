// @wt-script audit/review-config
// @purpose L3 元审查：审查体系自身配置的治理——schema 校验、依赖矩阵健康、规则声明↔实施双向核对、glob 有效性、工具配置健康
// @origin webgames-derived（"规则双检/防静默失效"思想源自 WebGames audit_gd.verify_rule_config_coverage；"规则永不触发检测"源自其对元审查的要求）
// @usage node dist/audit/review-config.js [--json] [--root <dir>]
// @exit 0=PASS 1=存在阻断级元违规 2=配置错误

import path from 'node:path';
import { parseArgs, helpFromHeader } from '../common/cli.js';
import { createLogger } from '../common/logger.js';
import { SCRIPTS_DIR, ROOT } from '../common/paths.js';
import { loadJson, ReviewRules, RefactorAdapterConfig } from '../common/config.js';
import { collectFiles, readFileSafe } from '../common/scan.js';
import { finding, envelope, printEnvelope, STATUS, verdict, Finding } from '../common/result.js';

const args = parseArgs(process.argv.slice(2));
if (args.help) { await helpFromHeader(import.meta.url); process.exit(0); }
const log = createLogger({ quiet: args.json });
const root = args.root ? path.resolve(args.root) : ROOT;
const started = Date.now();

const findings: Finding[] = [];
const push = (ruleId: string, severity: 'error' | 'warning', message: string, file: string, suggestedFix: string | null = null, evidence: string | null = null): void => {
    findings.push(finding({ ruleId, severity, module: 'review-system', file, message, suggestedFix, evidence }));
};

const CFG_DIR = path.join(SCRIPTS_DIR, 'config');

// ── 1. 三份配置加载与 schema 校验 ──
interface ToolToolConfig { include?: string[] }
const rulesRes = await loadJson<ReviewRules>(path.join(CFG_DIR, 'review-rules.json'));
const adapterRes = await loadJson<RefactorAdapterConfig>(path.join(CFG_DIR, 'refactor-adapter.json'));
const toolCfgRes = await loadJson<ToolToolConfig>(path.join(CFG_DIR, 'auto-refactor.config.json'));

for (const [name, res] of [['review-rules.json', rulesRes], ['refactor-adapter.json', adapterRes], ['auto-refactor.config.json', toolCfgRes]] as const) {
    if (!res.ok) push('RCFG-SCHEMA', 'error', `审查配置损坏：${res.error}`, `scripts/config/${name}`, '修复 JSON 语法或恢复文件——审查系统在配置损坏时必须 fail-closed');
}
if (!rulesRes.ok) {
    printEnvelope(envelope({ checker: 'L3-REVIEW-CONFIG', status: STATUS.CONFIG_ERROR, durationMs: Date.now() - started, notes: ['review-rules.json 不可用，元审查无法继续'] }));
    process.exit(2);
}
const rules = rulesRes.data;

// ── 2. 注册表结构：唯一 ID、必填字段、合法枚举 ──
const checkers = rules.checkers ?? [];
const ids = checkers.map((c) => c.id);
const LAYERS = ['L0', 'L1', 'L2', 'L3', 'L4', 'L5'];
for (const c of checkers) {
    const missing = ['id', 'layer', 'title', 'checker', 'stage', 'enabled', 'timeoutMs', 'origin', 'ruleIds'].filter((k) => (c as unknown as Record<string, unknown>)[k] === undefined);
    if (missing.length) push('RCFG-SCHEMA', 'error', `检查器注册项缺少字段: ${c.id ?? '?'} → ${missing.join(', ')}`, 'scripts/config/review-rules.json');
    if (c.layer && !LAYERS.includes(c.layer)) push('RCFG-SCHEMA', 'error', `非法审查层 ${c.layer}（应为 L0~L5）`, 'scripts/config/review-rules.json');
    if (c.timeoutMs !== undefined && !(Number(c.timeoutMs) > 0)) push('RCFG-SCHEMA', 'error', `timeoutMs 必须为正数: ${c.id}`, 'scripts/config/review-rules.json');
}
for (const [id, count] of [...ids.reduce((m, i) => m.set(i, (m.get(i) ?? 0) + 1), new Map<string, number>())]) {
    if (count > 1) push('RCFG-SCHEMA', 'error', `规则 ID 重复: ${id}（审查来源不可追踪）`, 'scripts/config/review-rules.json');
}
// 跨检查器静态规则 ID 重复检测（同一发现归属两个检查器 = 证据链断裂）
{
    const owner = new Map<string, string>();
    for (const c of checkers) {
        for (const rid of c.ruleIds ?? []) {
            if (rid.endsWith('*')) continue; // 动态命名空间不做精确重复判定
            if (!owner.has(rid)) owner.set(rid, c.id);
            else if (owner.get(rid) !== c.id) push('RCFG-SCHEMA', 'error', `规则 ${rid} 被多个检查器声明（${owner.get(rid)} 与 ${c.id}）——归属冲突`, 'scripts/config/review-rules.json');
        }
    }
    const ORIGINS = new Set(['native', 'webgames-derived']);
    for (const c of checkers) {
        if (c.origin && !ORIGINS.has(c.origin)) push('RCFG-SCHEMA', 'error', `非法 origin "${c.origin}"（应为 native | webgames-derived，规则来源必须可溯源）`, 'scripts/config/review-rules.json');
    }
}

// ── 3. 依赖矩阵健康：映射路径存在、规则键与层对齐、许可引用合法 ──
const layerOf = rules.layers?.layerOf ?? {};
const layerRules = rules.layers?.rules ?? {};
for (const [layer, rel] of Object.entries(layerOf)) {
    const direct = await readFileSafe(path.join(root, rel));
    const viaGlob = (await collectFiles({ root, include: [layer === 'entry' ? rel : rel + '**'], exclude: [] })).length > 0;
    if (direct === null && !viaGlob) push('RCFG-MATRIX', 'error', `依赖矩阵映射的路径不存在: ${layer} → ${rel}（规则绑定旧路径，永不触发）`, 'scripts/config/review-rules.json', '目录迁移后同步更新 layers.layerOf');
}
const knownLayers = new Set(Object.keys(layerOf));
for (const [layer, rule] of Object.entries(layerRules)) {
    if (!knownLayers.has(layer)) push('RCFG-MATRIX', 'error', `层规则引用未映射的层: ${layer}`, 'scripts/config/review-rules.json');
    for (const dep of rule.mayImportLayers ?? []) {
        if (dep !== '*' && !knownLayers.has(dep)) push('RCFG-MATRIX', 'error', `mayImportLayers 引用未知层: ${layer} → ${dep}`, 'scripts/config/review-rules.json');
    }
}

// ── 4. 规则声明↔实施双向核对（防"规则静默失效"） ──
for (const c of checkers) {
    const checkerPath = path.join(SCRIPTS_DIR, c.checker ?? '___');
    const src = await readFileSafe(checkerPath);
    if (src === null) continue; // 悬空注册由 L3-SCRIPT-STANDARD 负责阻断

    const declared = c.ruleIds ?? [];
    const hasNamespace = declared.some((r) => r.endsWith('*'));
    // 实施侧：扫描检查器源码中出现的规则 ID 字面量
    const implemented = new Set([...src.matchAll(/['"`]([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+)['"`]/g)].map((m) => m[1]));

    for (const rid of declared) {
        if (rid.endsWith('*')) continue; // 动态命名空间（如 ARF-*、L1-*）只做前缀核对
        if (!src.includes(rid)) {
            push('RCFG-RULE-DRIFT', 'warning',
                `规则 ${rid} 在 ${c.id} 源码中无消费点（声明未实施——承诺审查但代码不审）`,
                `scripts/${c.checker}`, '实现该规则，或从注册表移除声明');
        }
    }
    if (!hasNamespace) {
        for (const rid of implemented) {
            const declaredExact = declared.includes(rid);
            const belongsToOtherChecker = checkers.some((o) => o.id !== c.id && (o.ruleIds ?? []).includes(rid));
            if (!declaredExact && !belongsToOtherChecker && /^[A-Z]{2,}-/.test(rid) && rid !== c.id) {
                push('RCFG-RULE-DRIFT', 'error',
                    `悬空规则：${c.id} 产出 ${rid} 但未在注册表声明（结论无法归属到注册的规则条目）`,
                    `scripts/${c.checker}`, '在 review-rules.json 对应 checkers.ruleIds 中声明');
            }
        }
    }
}

// ── 5. 适配器配置健康 + 工具 glob 有效性（永不触发检测） ──
if (adapterRes.ok) {
    const ad = adapterRes.data;
    for (const cand of ad.tool?.resolve?.candidates ?? []) {
        if (/^[A-Za-z]:[\\/]|^file:\/\//.test(cand)) {
            push('RCFG-TOOL-PATH', 'error', `外部工具路径出现绝对盘符: ${cand}（禁止硬编码路径入库）`, 'scripts/config/refactor-adapter.json', '改用项目相对路径或环境变量覆盖');
        }
    }
    if (!(ad.scan?.timeoutMs !== undefined && ad.scan.timeoutMs > 0)) push('RCFG-TOOL-PATH', 'error', '适配器未配置正的 scan.timeoutMs（外部调用无超时 = 可能永久挂起）', 'scripts/config/refactor-adapter.json');
    if (!['skip', 'fail'].includes(ad.gate?.whenUnavailable ?? '')) push('RCFG-TOOL-PATH', 'error', 'gate.whenUnavailable 必须为 skip|fail', 'scripts/config/refactor-adapter.json');

    const include = toolCfgRes.ok ? (toolCfgRes.data.include ?? []) : [];
    for (const g of include) {
        const matched = await collectFiles({ root, include: [g] });
        if (matched.length === 0) {
            push('RCFG-GLOBS', 'warning', `工具扫描 glob "${g}" 命中 0 个文件（规则永不触发——是否目录迁移后未同步？）`, 'scripts/config/auto-refactor.config.json');
        } else {
            log.info(`glob ${g} → ${matched.length} files`);
        }
    }
}

const status = verdict(findings, { blockOn: 'error' });
log.info(`元审查: 检查器 ${checkers.length} 个, 元违规 ${findings.length} 条`);

printEnvelope(envelope({
    checker: 'L3-REVIEW-CONFIG',
    status,
    findings,
    filesScanned: checkers.length,
    durationMs: Date.now() - started,
    notes: ['error=审查系统自身失效（必须阻断）；warning=声明未实施/永不触发（人工确认）'],
}));
process.exit(status === STATUS.PASS ? 0 : 1);
