// @wt-script build/compile
// @purpose L0 门禁：tsc 全量编译零错误，诊断结构化为 Finding（含文件/行号/证据）
// @origin native
// @usage node dist/build/compile.js [--json] [--root <dir>]
// @exit 0=PASS 1=编译错误 2=配置/环境错误

import path from 'node:path';
import { createRequire } from 'node:module';
import { parseArgs, helpFromHeader } from '../common/cli.js';
import { createLogger } from '../common/logger.js';
import { ROOT, toRel } from '../common/paths.js';
import { run } from '../common/proc.js';
import { finding, envelope, printEnvelope, STATUS } from '../common/result.js';

const args = parseArgs(process.argv.slice(2));
if (args.help) { await helpFromHeader(import.meta.url); process.exit(0); }
const log = createLogger({ quiet: args.json });
const root = args.root ? path.resolve(args.root) : ROOT;

const started = Date.now();
let tscBin: string;
try {
    const require = createRequire(import.meta.url);
    tscBin = require.resolve('typescript/bin/tsc');
} catch (err) {
    printEnvelope(envelope({
        checker: 'L0-COMPILE', status: STATUS.CONFIG_ERROR, durationMs: Date.now() - started,
        notes: [`找不到 typescript：${(err as Error).message}`],
    }));
    process.exit(2);
}

const result = await run([process.execPath, tscBin, '-p', path.join(root, 'tsconfig.json')], {
    cwd: root,
    timeoutMs: 180000,
});

const findings = [];
// 解析 tsc 诊断：`src/foo.ts(12,3): error TS2304: Cannot find name 'x'.`
for (const m of result.stdout.matchAll(/^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.+)$/gm)) {
    findings.push(finding({
        ruleId: 'L0-COMPILE',
        severity: m[4] === 'error' ? 'error' : 'warning',
        file: toRel(path.resolve(root, m[1])),
        line: Number(m[2]),
        column: Number(m[3]),
        message: `${m[5]}: ${m[6]}`,
        evidence: m[0],
        source: 'build',
    }));
}

const status = result.timedOut
    ? STATUS.TIMEOUT
    : (result.code === 0 ? STATUS.PASS : (result.code === null ? STATUS.CONFIG_ERROR : STATUS.FAIL));

if (status !== STATUS.PASS) {
    log.error(`tsc 退出码=${result.code}${result.timedOut ? '(超时)' : ''}，诊断 ${findings.length} 条`);
}

printEnvelope(envelope({
    checker: 'L0-COMPILE',
    status,
    findings,
    durationMs: Date.now() - started,
    notes: status === STATUS.PASS ? ['tsc 全量编译通过'] : [`tsc exit=${result.code}`],
}));
process.exit(status === STATUS.PASS ? 0 : (status === STATUS.CONFIG_ERROR ? 2 : 1));
