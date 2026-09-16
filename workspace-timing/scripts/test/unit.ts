// @wt-script test/unit
// @purpose L0 门禁：mocha 全量单元测试（须先完成 L0-COMPILE，运行对象为 out/ 编译产物）
// @origin native
// @usage node dist/test/unit.js [--json] [--root <dir>]
// @exit 0=PASS 1=存在失败用例 2=配置/环境错误

import path from 'node:path';
import { createRequire } from 'node:module';
import { parseArgs, helpFromHeader } from '../common/cli.js';
import { createLogger } from '../common/logger.js';
import { ROOT } from '../common/paths.js';
import { run } from '../common/proc.js';
import { finding, envelope, printEnvelope, STATUS, CheckerStatus } from '../common/result.js';

const args = parseArgs(process.argv.slice(2));
if (args.help) { await helpFromHeader(import.meta.url); process.exit(0); }
const log = createLogger({ quiet: args.json });
const root = args.root ? path.resolve(args.root) : ROOT;

const started = Date.now();
let mochaBin: string;
try {
    const require = createRequire(import.meta.url);
    mochaBin = require.resolve('mocha/bin/mocha.js');
} catch (err) {
    printEnvelope(envelope({
        checker: 'L0-TEST', status: STATUS.CONFIG_ERROR, durationMs: Date.now() - started,
        notes: [`找不到 mocha：${(err as Error).message}`],
    }));
    process.exit(2);
}

const result = await run([process.execPath, mochaBin, '--reporter', 'min', 'test/**/*.test.js'], {
    cwd: root,
    timeoutMs: 300000,
});

const findings = [];
const summary = { passing: 0, failing: 0, pending: 0 };

const passMatch = result.stdout.match(/(\d+) passing/);
const failMatch = result.stdout.match(/(\d+) failing/);
const pendMatch = result.stdout.match(/(\d+) pending/);
if (passMatch) summary.passing = Number(passMatch[1]);
if (failMatch) summary.failing = Number(failMatch[1]);
if (pendMatch) summary.pending = Number(pendMatch[1]);

// min 报告器：失败段以 `  N) <标题>` 枚举，逐条转为 Finding（标题即证据）
const failIdx = result.stdout.indexOf('failing');
const failBlock = failIdx >= 0 ? result.stdout.slice(failIdx) : '';
for (const m of failBlock.matchAll(/^\s*\d+\)\s+(.+)$/gm)) {
    findings.push(finding({
        ruleId: 'L0-TEST',
        severity: 'error',
        message: `单测失败: ${m[1].trim()}`,
        evidence: m[1].trim(),
        suggestedFix: '运行 npm run test:unit 查看完整堆栈',
        source: 'test',
    }));
}

let status: CheckerStatus = STATUS.PASS;
if (result.timedOut) status = STATUS.TIMEOUT;
else if (summary.failing > 0 || result.code === 1) status = STATUS.FAIL;
else if (result.code !== 0) status = STATUS.CONFIG_ERROR;

log.info(`单测: ${summary.passing} passing / ${summary.failing} failing (${result.durationMs}ms)`);

printEnvelope(envelope({
    checker: 'L0-TEST',
    status,
    findings,
    filesScanned: summary.passing + summary.failing,
    durationMs: Date.now() - started,
    notes: [`passing=${summary.passing}`, `failing=${summary.failing}`],
    summary,
}));
process.exit(status === STATUS.PASS ? 0 : (status === STATUS.CONFIG_ERROR ? 2 : 1));
