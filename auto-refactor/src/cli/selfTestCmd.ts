/**
 * Module: CLI — Self-Test / Engine Quality Guard
 * File Path: src/cli/selfTestCmd.ts
 * Architecture Role: CLI verification command that exercises the real in-process scan pipeline
 *                     against a throwaway fixture project instead of repository code.
 * Dependencies & Triggers: Triggered by `auto-refactor self-test`; calls `scanAndRender` from
 *                     `../api`, reads `ScanReport` from `../core/types`, and uses fs/os/path to
 *                     build and delete the temporary fixture root.
 * Responsibilities: build fixture files/config covering constants, complexity, large-file,
 *                     governance, secrets, and dependency-graph analyzers; run scanAndRender;
 *                     assert every `EXPECTED_PAIRS` analyzer:rule pair fires; print PASS/MISS
 *                     rows plus a summary; remove the temp directory in all cases.
 * Exit Semantics & Design Rationale: Resolves to `{ code, text }` rather than calling
 *                     process.exit: 0 when all expected pairs fired, 1 when any pair is missing,
 *                     2 on fixture/setup failure; `finally` cleanup prevents temp-dir leaks, and
 *                     the live-pipeline assertion exists to catch analyzers that silently stop
 *                     firing while conventional gates still report PASS.
 *
 * Builds a temporary fixture project containing KNOWN violations (one per built-in
 * analyzer family), runs an in-process scan, and asserts each expected `analyzer:rule`
 * pair actually fires. Guards against "analyzer silently broken but gate reports PASS" —
 * the same methodology the workspace-timing review system proved out (it caught a real
 * three-color DFS defect there).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { scanAndRender } from '../api';
import type { ScanReport } from '../core/types';

/**
 * Number of synthetic `if` branches in the complexity fixture; exceeds the complexity-fail
 * threshold so the fixture must trip `complexity:high-complexity`.
 */
const FIXTURE_BRANCH_COUNT = 25;

/**
 * Number of filler comment lines in the large-file fixture; keeps the generated module above
 * the large-file fail threshold so `large-file:large-file` must fire.
 */
const FIXTURE_FILLER_LINES = 820;

/**
 * Column width used to pad the `analyzer:rule` pair label in the PASS/MISS report rows.
 */
const PAIR_LABEL_WIDTH = 36;

interface FixtureFile {
    rel: string;
    content: string;
    why: string;
}

/**
 * Build the temporary fixture project files and the configuration enabling their analyzers.
 *
 * Each sample intentionally violates one analyzer contract, and the generated filler module
 * pushes the large-file fixture past its line threshold.
 *
 * @returns Fixture files with the reason each exists, plus the configuration that enables
 *          the analyzers expected to fire on them.
 */
function buildFixtures(): { files: FixtureFile[]; config: Record<string, unknown> } {
    const ifs = Array.from(
        { length: FIXTURE_BRANCH_COUNT },
        (_, i) => `  if (x > ${i}) { x = x - 1; }`,
    ).join('\n');
    const filler = Array.from(
        { length: FIXTURE_FILLER_LINES },
        (_, i) => `// filler line ${i}\n`,
    ).join('');
    const files: FixtureFile[] = [
        {
            rel: 'src/syncio.ts',
            content:
                "import * as fs from 'fs';\nexport function loadCfg(): string { return fs.readFileSync('cfg.json', 'utf8'); }\n",
            why: 'governance:GOV-PRF-004（同步 IO 阻塞宿主）',
        },
        {
            rel: 'src/dead.ts',
            content: 'export function neverUsedGlobally(): void {}\n',
            why: 'dependency-graph:unused-module（全仓无导入方）',
        },
        {
            rel: 'src/magic.ts',
            content: 'export function run(cb: () => void): void { setTimeout(cb, 999999); }\n',
            why: 'constants:magic-number（调用点字面量）',
        },
        {
            rel: 'src/complex.ts',
            content: `export function tangled(x: number): number {\n${ifs}\n  return x;\n}\n`,
            why: 'complexity:high-complexity（25 分支 ≥ fail 阈值 20）',
        },
        {
            rel: 'src/toolarge.ts',
            content: `${filler}export const end = 1;\n`,
            why: 'large-file:large-file（820+ 行 ≥ fail 阈值 800）',
        },
        {
            rel: 'src/swallow.ts',
            content: 'export function risky(): void { try { JSON.parse("{"); } catch { } }\n',
            why: 'governance:GOV-EXC-001（空 catch）',
        },
        {
            rel: 'src/creds.ts',
            content: `export const token = "${['ghp', 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4'].join('_')}";\n`,
            why: 'secrets:secret-detected（GitHub token 特征）',
        },
        {
            rel: 'src/cyc/a.ts',
            content: "import { b } from './b';\nexport const a = 1;\n",
            why: 'dependency-graph:import-cycle（a→b→a）',
        },
        {
            rel: 'src/cyc/b.ts',
            content: "import { a } from './a';\nexport const b = 2;\n",
            why: 'dependency-graph:import-cycle（同上，闭环侧）',
        },
    ];
    const config = {
        include: ['src/**/*.ts'],
        analyzers: {
            constants: { enabled: true },
            complexity: { enabled: true },
            'large-file': { enabled: true },
            governance: { enabled: true },
            secrets: { enabled: true },
            'dependency-graph': {
                enabled: true,
                options: { detectCycles: true, detectUnusedExports: true },
            },
        },
    };
    return { files, config };
}

/**
 * Stable `analyzer:rule` pairs every analyzer family must hit; a miss means the engine regressed.
 */
export const EXPECTED_PAIRS: Array<{ pair: string; why: string }> = [
    { pair: 'constants:magic-number', why: '魔法数检测' },
    { pair: 'complexity:high-complexity', why: '圈复杂度 fail 阈值' },
    { pair: 'large-file:large-file', why: '超大文件 fail 阈值' },
    { pair: 'governance:GOV-EXC-001', why: '空 catch 治理规则' },
    { pair: 'governance:GOV-PRF-003', why: '定时器字面量（无钳制）' },
    { pair: 'governance:GOV-PRF-004', why: '同步 IO 阻塞宿主' },
    { pair: 'secrets:secret-detected', why: '密钥特征扫描' },
    { pair: 'dependency-graph:import-cycle', why: '循环依赖 post-scan 检测' },
    { pair: 'dependency-graph:unused-module', why: '未使用模块检测（post-scan）' },
];

/**
 * Run the self-test command: build a temporary fixture project containing one known violation
 * per analyzer family, execute the real async scan pipeline against it, and assert that every
 * `analyzer:rule` pair in `EXPECTED_PAIRS` fires.
 *
 * Each invocation creates a unique temp directory before the first await and removes it in
 * `finally`, so concurrent calls cannot share state and repeated runs cannot leak fixture files.
 * Setup or scan failures are converted into a code 2 result instead of rejected promises.
 *
 * @param _args - Unused CLI arguments, accepted to match the shared command-handler signature.
 * @returns Result with exit code 0 when every expected pair fired, 1 when any pair is missing,
 *          or 2 when fixture setup or the underlying scan fails, plus the rendered report text.
 */
export async function selfTestCommand(_args: string[]): Promise<{ code: number; text: string }> {
    const lines: string[] = [];
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-refactor-selftest-'));
    try {
        const { files, config } = buildFixtures();
        for (const f of files) {
            const abs = path.join(fixtureRoot, f.rel);
            fs.mkdirSync(path.dirname(abs), { recursive: true });
            fs.writeFileSync(abs, f.content, 'utf8');
        }
        fs.writeFileSync(
            path.join(fixtureRoot, 'auto-refactor.config.json'),
            JSON.stringify(config, null, 2),
            'utf8',
        );

        // Use the real scanAndRender pipeline (exemption, dependency-graph and baseline phases);
        // assert on the report written to the temporary file.
        const reportPath = path.join(fixtureRoot, 'self-test-report.json');
        await scanAndRender({ root: fixtureRoot, format: 'json', cache: false, out: reportPath });
        const report: ScanReport = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
        const fired = new Set(report.issues.map((i) => `${i.analyzer}:${i.rule}`));

        let ok = true;
        for (const { pair, why } of EXPECTED_PAIRS) {
            if (fired.has(pair)) {
                lines.push(`  PASS  ${pair.padEnd(PAIR_LABEL_WIDTH)} ${why}`);
            } else {
                ok = false;
                lines.push(`  MISS  ${pair.padEnd(PAIR_LABEL_WIDTH)} ${why} —— 分析器失效！`);
            }
        }
        const unexpectedFamilies = new Set(report.issues.map((i) => i.analyzer));
        lines.push(
            `  ── 夹具共 ${report.summary.filesScanned} 文件 / ${report.issues.length} 发现，覆盖家族: ${[...unexpectedFamilies].join(', ')}`,
        );
        return {
            code: ok ? 0 : 1,
            text: [
                `auto-refactor self-test（已知违规夹具 → 引擎命中断言）`,
                ...lines,
                ok ? '结论: 引擎全部命中 ✅' : '结论: 存在失效分析器 ❌',
            ].join('\n'),
        };
    } catch (err) {
        return { code: 2, text: `self-test setup failure: ${(err as Error).message}` };
    } finally {
        fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
}
