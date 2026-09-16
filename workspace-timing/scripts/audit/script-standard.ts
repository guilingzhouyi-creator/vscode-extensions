// @wt-script audit/script-standard
// @purpose L3 脚本库自规范：命名/头契约（@wt-script 系标签）/检查器注册表完备性（孤儿与悬空双向阻断）
// @origin webgames-derived（注册表完备性自检思想源自 WebGames audit_runner.check_registry_completeness）
// @usage node dist/audit/script-standard.js [--json] [--root <dir>]
// @exit 0=PASS 1=存在违规 2=配置错误

import path from 'node:path';
import { parseArgs, helpFromHeader } from '../common/cli.js';
import { createLogger } from '../common/logger.js';
import { SCRIPTS_DIR } from '../common/paths.js';
import { loadJson, ReviewRules } from '../common/config.js';
import { collectFiles, readFileSafe } from '../common/scan.js';
import { finding, envelope, printEnvelope, STATUS, verdict, Finding } from '../common/result.js';

const args = parseArgs(process.argv.slice(2));
if (args.help) { await helpFromHeader(import.meta.url); process.exit(0); }
const log = createLogger({ quiet: args.json });
const started = Date.now();

const rulesRes = await loadJson<ReviewRules>(path.join(SCRIPTS_DIR, 'config', 'review-rules.json'));
if (!rulesRes.ok) {
    printEnvelope(envelope({ checker: 'L3-SCRIPT-STANDARD', status: STATUS.CONFIG_ERROR, durationMs: Date.now() - started, notes: [rulesRes.error] }));
    process.exit(2);
}
const registered = new Set((rulesRes.data.checkers ?? []).map((c) => c.checker));

const findings: Finding[] = [];
// dist/ 为编译产物镜像，不入扫描面（源码才是契约主体）
const files = await collectFiles({ root: SCRIPTS_DIR, include: ['**/*.ts', '**/*.json', '**/*.md'], exclude: ['dist/**'] });
const CHECKER_DIRS = ['build/', 'test/', 'audit/', 'benchmark/', 'tooling/'];
const seenCheckerKeys = new Set<string>();

for (const rel of files) {
    const relPosix = rel.split(path.sep).join('/');
    const base = relPosix.split('/').pop() ?? relPosix;
    const inCommon = relPosix.startsWith('common/');
    const isCheckerCandidate = CHECKER_DIRS.some((d) => relPosix.startsWith(d)) && base.endsWith('.ts');

    // 1. 命名契约：全小写 kebab 分段（允许 .config.json 这类工具惯例多段名）；README.md 为文档惯例豁免
    const nameOk = base === 'README.md'
        || /^[a-z0-9][a-z0-9-]*(\.[a-z0-9-]+)*\.(ts|json|md)$/.test(base);
    if (!nameOk) {
        findings.push(finding({
            ruleId: 'SCR-NAMING', severity: 'error', module: 'scripts', file: `scripts/${relPosix}`,
            message: `脚本文件名不符合 kebab-case: ${base}`,
            suggestedFix: '重命名为 kebab-case 并全库更新引用',
        }));
    }

    if (!base.endsWith('.ts')) continue;
    const text = await readFileSafe(path.join(SCRIPTS_DIR, rel));
    if (text === null) continue;
    const head = text.split(/\r?\n/).slice(0, 20).join('\n');

    // 2. 头契约标签（公共库只要求身份+用途+来源；可执行脚本还要求用法/退出码）
    const requireTags = inCommon ? ['@wt-script', '@purpose', '@origin'] : ['@wt-script', '@purpose', '@usage', '@exit', '@origin'];
    for (const tag of requireTags) {
        if (!head.includes(tag)) {
            findings.push(finding({
                ruleId: 'SCR-HEADER', severity: 'error', module: 'scripts', file: `scripts/${relPosix}`,
                message: `脚本头契约缺少必需标签 ${tag}（头注释即文档，缺失即漂移）`,
                suggestedFix: '按 scripts/README.md 头模板补齐：@wt-script/@purpose/@usage/@exit/@origin',
            }));
        }
    }

    // 3. 注册表完备性：检查器目录下的可执行脚本必须注册（孤儿）；注册表项必须存在（悬空）
    if (isCheckerCandidate) {
        seenCheckerKeys.add(relPosix);
        if (!registered.has(relPosix)) {
            findings.push(finding({
                ruleId: 'SCR-ORPHAN', severity: 'error', module: 'scripts', file: `scripts/${relPosix}`,
                message: '孤儿检查器：存在于检查器目录但未注册进 review-rules.json（不会被审查系统执行——"加脚本忘了接入"静默漂移）',
                suggestedFix: '在 scripts/config/review-rules.json checkers 中注册，或移出检查器目录',
            }));
        }
    }
}
for (const key of registered) {
    if (!seenCheckerKeys.has(key)) {
        findings.push(finding({
            ruleId: 'SCR-DANGLING', severity: 'error', module: 'scripts', file: `scripts/${key}`,
            message: '悬空注册：review-rules.json 注册的检查器文件不存在（审查系统宣称执行实际缺失的能力）',
            suggestedFix: '补齐文件或从注册表移除',
        }));
    }
}

const status = verdict(findings, { blockOn: 'error' });
log.info(`脚本库自规范: ${files.length} 个文件, 注册检查器 ${registered.size}, 违规 ${findings.length}`);

printEnvelope(envelope({
    checker: 'L3-SCRIPT-STANDARD',
    status,
    findings,
    filesScanned: files.length,
    durationMs: Date.now() - started,
    notes: ['review/run-review.ts（编排器）不属于检查器目录，豁免注册要求；dist/ 为编译产物不入扫描面'],
}));
process.exit(status === STATUS.PASS ? 0 : 1);
