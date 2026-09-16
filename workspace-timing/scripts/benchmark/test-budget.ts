// @wt-script benchmark/test-budget
// @purpose L4 性能预算：单元测试套件时长回归门禁（基线棘轮：只阻断显著回退，不做复杂基准设施）
// @origin webgames-derived（promote/gate + 基线外置思想源自 WebGames report_aggregate.py；按"不引入无数据支撑的复杂设施"原则简化为单次运行+宽阈值）
// @usage node dist/benchmark/test-budget.js [--json] [--update-baseline] [--consume-duration <ms>] [--root <dir>]
// @exit 0=PASS（或已记录基线） 1=时长回退超预算 2=配置错误

import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { parseArgs, helpFromHeader } from '../common/cli.js';
import { createLogger } from '../common/logger.js';
import { SCRIPTS_DIR, ROOT } from '../common/paths.js';
import { run } from '../common/proc.js';
import { loadJson } from '../common/config.js';
import { finding, envelope, printEnvelope, STATUS, Finding } from '../common/result.js';

const args = parseArgs(process.argv.slice(2));
if (args.help) { await helpFromHeader(import.meta.url); process.exit(0); }
const log = createLogger({ quiet: args.json });
const root = args.root ? path.resolve(args.root) : ROOT;
const started = Date.now();

const BASELINE_PATH = path.join(SCRIPTS_DIR, 'config', 'test-budget-baseline.json');
const BUDGET_PERCENT = 50; // 宽阈值：单次运行噪声约 ±200ms，仅阻断"量级回退"（如意外同步 IO/全量重扫混入测试链路）

// 结果复用：编排器同轮已跑 L0-TEST 时，经 --consume-duration 复用其实测时长，避免套件重复执行
const consumeMs = Number(args.flags['consume-duration'] ?? 0);
const consuming = Number.isFinite(consumeMs) && consumeMs > 0;

interface TestBudgetBaseline {
    recordedAt: string;
    durationMs: number;
    budgetPercent?: number;
}

const findings: Finding[] = [];
let mochaBin: string = '';
if (!consuming) {
    try {
        const require = createRequire(import.meta.url);
        mochaBin = require.resolve('mocha/bin/mocha.js');
    } catch (err) {
        printEnvelope(envelope({ checker: 'L4-TEST-BUDGET', status: STATUS.CONFIG_ERROR, durationMs: Date.now() - started, notes: [(err as Error).message] }));
        process.exit(2);
    }
}

log.info(consuming ? `复用 L0-TEST 实测时长 ${consumeMs}ms（同轮去重执行）` : '运行测试套件计时（单次运行 + 宽阈值设计，见头注释）');
let durationMs: number;
if (consuming) {
    durationMs = consumeMs;
} else {
    const result = await run([process.execPath, mochaBin, '--reporter', 'dot', 'test/**/*.test.js'], {
        cwd: root,
        timeoutMs: 300000,
    });
    durationMs = result.durationMs;
}

const baseRes = await loadJson<TestBudgetBaseline>(BASELINE_PATH);

if (args.updateBaseline) {
    const baseline = {
        schema: 'wt-test-budget/v1',
        recordedAt: new Date().toISOString(),
        durationMs,
        budgetPercent: BUDGET_PERCENT,
        node: process.version,
    };
    await writeFile(BASELINE_PATH, JSON.stringify(baseline, null, 4) + '\n', 'utf8');
    log.info(`基线已记录: ${durationMs}ms → scripts/config/test-budget-baseline.json`);
    printEnvelope(envelope({
        checker: 'L4-TEST-BUDGET', status: STATUS.PASS, findings,
        durationMs, notes: [`基线已更新为 ${durationMs}ms（禁止用于消音：仅应在有意变更测试规模/机器后执行）`],
        baseline,
    }));
    process.exit(0);
}

if (!baseRes.ok) {
    findings.push(finding({
        ruleId: 'TB-NO-BASELINE', severity: 'warning', module: 'review-system',
        message: '无时长基线，无法判定回归（本次为 SKIP 而非 PASS）',
        suggestedFix: 'node dist/benchmark/test-budget.js --update-baseline 记录基线',
    }));
    printEnvelope(envelope({
        checker: 'L4-TEST-BUDGET', status: STATUS.SKIP, findings,
        durationMs, notes: [`本次实测 ${durationMs}ms，无基线`],
    }));
    process.exit(0);
}

const baseline = baseRes.data;
const limit = baseline.durationMs * (1 + (baseline.budgetPercent ?? BUDGET_PERCENT) / 100);
if (durationMs > limit) {
    findings.push(finding({
        ruleId: 'TB-REGRESSION', severity: 'error', module: 'review-system',
        message: `测试套件时长回退: ${durationMs}ms > 基线 ${baseline.durationMs}ms × (1+${baseline.budgetPercent}%) = ${Math.round(limit)}ms`,
        evidence: `baseline.recordedAt=${baseline.recordedAt}`,
        suggestedFix: '排查是否向测试链路引入同步 IO/全量重扫/无谓 sleep；确属合理增长则 --update-baseline 并在提交说明中给出理由',
    }));
}

const status = findings.length ? STATUS.FAIL : STATUS.PASS;
log.info(`时长 ${durationMs}ms vs 基线 ${baseline.durationMs}ms（预算 +${baseline.budgetPercent}%）`);
printEnvelope(envelope({
    checker: 'L4-TEST-BUDGET', status, findings, durationMs,
    notes: [`limit=${Math.round(limit)}ms`],
    baselineDurationMs: baseline.durationMs,
    currentDurationMs: durationMs,
}));
process.exit(status === STATUS.PASS ? 0 : 1);
