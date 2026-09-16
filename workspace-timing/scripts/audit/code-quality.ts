// @wt-script audit/code-quality
// @purpose L1 代码质量门禁：eslint 全量结构化审查（错误阻断/告警提示级），填补 L1 层使六层规则模型完整
// @origin native
// @usage node dist/audit/code-quality.js [--json] [--strict] [--root <dir>]
// @exit 0=PASS 1=存在 error 级 lint（--strict 时 warning 也阻断） 2=配置/环境错误

import path from 'node:path';
import { accessSync, mkdirSync } from 'node:fs';
import { parseArgs, helpFromHeader } from '../common/cli.js';
import { createLogger } from '../common/logger.js';
import { ROOT, toRel } from '../common/paths.js';
import { run } from '../common/proc.js';
import { extractJsonObject } from '../common/config.js';
import { finding, envelope, printEnvelope, STATUS, verdict } from '../common/result.js';

interface EslintMessage {
    ruleId?: string | null;
    severity: number;
    line: number;
    column: number;
    message: string;
}
interface EslintFileReport {
    filePath: string;
    messages: EslintMessage[];
}

const args = parseArgs(process.argv.slice(2));
if (args.help) { await helpFromHeader(import.meta.url); process.exit(0); }
const log = createLogger({ quiet: args.json });
const root = args.root ? path.resolve(args.root) : ROOT;
const started = Date.now();

// eslint 包 exports 未暴露 bin 子路径，按存在性解析（eslint 8 惯例布局）
const eslintBin = path.join(root, 'node_modules', 'eslint', 'bin', 'eslint.js');
try {
    accessSync(eslintBin);
} catch {
    printEnvelope(envelope({ checker: 'L1-LINT', status: STATUS.CONFIG_ERROR, durationMs: Date.now() - started, notes: [`未找到 eslint: ${eslintBin}`] }));
    process.exit(2);
}

// eslint 增量缓存：暖态仅重检变更文件（缓存条目含配置 hash，规则/配置变更自动失效）
const cacheDir = path.join(root, 'reports');
mkdirSync(cacheDir, { recursive: true });
const eslintCacheFile = path.join(cacheDir, '.eslintcache');

const result = await run([process.execPath, eslintBin, 'src', 'scripts', '--ext', 'ts', '-f', 'json', '--cache', '--cache-location', eslintCacheFile], {
    cwd: root,
    timeoutMs: 120000,
});

// eslint JSON: [{ filePath, messages: [{ruleId, severity(1=warn,2=error), line, column, message}], errorCount, warningCount }]
const reports = extractJsonObject(result.stdout) as EslintFileReport[] | null;
const findings = [];
let errorCount = 0;
let warningCount = 0;

for (const fileReport of Array.isArray(reports) ? reports : []) {
    for (const m of fileReport.messages ?? []) {
        const severity = m.severity === 2 ? 'error' as const : 'warning' as const;
        if (severity === 'error') errorCount++; else warningCount++;
        findings.push(finding({
            ruleId: `L1-${m.ruleId ?? 'parse-error'}`,
            severity,
            file: toRel(fileReport.filePath),
            line: m.line,
            column: m.column,
            message: m.message,
            evidence: `eslint ${m.ruleId ?? '(parsing error)'}`,
            suggestedFix: null,
        }));
    }
}

const status = result.timedOut
    ? STATUS.TIMEOUT
    : (result.code === 2 || !Array.isArray(reports) ? STATUS.CONFIG_ERROR : verdict(findings, { blockOn: args.strict ? 'warning' : 'error' }));

log.info(`lint: error=${errorCount} warning=${warningCount}（gate=${args.strict ? 'warning' : 'error'}）`);

printEnvelope(envelope({
    checker: 'L1-LINT',
    status,
    findings,
    filesScanned: Array.isArray(reports) ? reports.length : 0,
    durationMs: Date.now() - started,
    notes: [`error=${errorCount}`, `warning=${warningCount}`],
    errorCount,
    warningCount,
}));
process.exit(status === STATUS.PASS ? 0 : (status === STATUS.CONFIG_ERROR ? 2 : 1));
