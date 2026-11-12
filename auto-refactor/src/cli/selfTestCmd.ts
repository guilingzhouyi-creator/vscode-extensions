/**
 * Module: CLI — Self-Test / Engine Quality Guard
 * File Path: src/cli/selfTestCmd.ts
 * Architecture Role: CLI verification command that exercises the real in-process scan pipeline
 *                     against a throwaway fixture project instead of repository code.
 * Dependencies & Triggers: Triggered by `auto-refactor self-test`; calls `scanAndRender` from
 *                     `../api`, reads `ScanReport` from `../core/types`, and uses fs/os/path to
 *                     build and delete the temporary fixture root.
 * Responsibilities: build fixture files/config covering constants, complexity, large-file,
 *                     governance, secrets, and dependency-graph analyzers plus a clean
 *                     negative-control module; run scanAndRender; assert every
 *                     `EXPECTED_PAIRS` analyzer:rule pair fires and that no
 *                     `CLEAN_RULE_ALLOWLIST` rule fires on the clean module; print
 *                     PASS/MISS/FP rows plus recall and precision summary; remove the temp
 *                     directory in all cases.
 * Exit Semantics & Design Rationale: Resolves to `{ code, text }` rather than calling
 *                     process.exit: 0 when every expected pair fired and the clean fixture
 *                     stayed silent, 1 on either a missing pair or a false positive, 2 on
 *                     fixture/setup failure; `finally` cleanup prevents temp-dir leaks. The two
 *                     assertions cover opposite failures: the recall direction catches analyzers
 *                     that silently stop firing, the precision direction catches rules that
 *                     silently start over-matching. Only the recall direction existed before,
 *                     which is why the oversized fixture could rot into a benign constant
 *                     catalog — legally exempt from `large-file` — while the gate stayed green.
 *
 * Builds a temporary fixture project containing KNOWN violations (one per built-in
 * analyzer family) plus one module that violates nothing, runs an in-process scan, and asserts
 * both directions. Guards against "analyzer silently broken but gate reports PASS" and against
 * "rule silently over-matching but every fixture still passes".
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'node:path';
import { scanAndRender } from '../api';
import type { ScanReport } from '../core/types';

const LINES_PER_OVERSIZED_FUNCTION = 5;
const FAIL_THRESHOLD_LARGE_FILE = 800;
const SYNTHETIC_SECRET_TOKEN_BODY = 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4';

const RULE_PAIR_MAGIC_NUMBER = 'constants:magic-number';
const RULE_PAIR_HIGH_COMPLEXITY = 'complexity:high-complexity';
const RULE_PAIR_LARGE_FILE = 'large-file:large-file';
const RULE_PAIR_GOV_EXC_001 = 'governance:GOV-EXC-001';
const RULE_PAIR_GOV_PRF_003 = 'governance:GOV-PRF-003';
const RULE_PAIR_GOV_PRF_004 = 'governance:GOV-PRF-004';
const RULE_PAIR_SECRET_DETECTED = 'secrets:secret-detected';
const RULE_PAIR_IMPORT_CYCLE = 'dependency-graph:import-cycle';
const RULE_PAIR_UNUSED_MODULE = 'dependency-graph:unused-module';

const SELFTEST_DIR_PREFIX = 'auto-refactor-selftest-';
const CONFIG_FILE_NAME = 'auto-refactor.config.json';
const REPORT_FILE_NAME = 'self-test-report.json';

/**
 * Number of synthetic `if` branches in the complexity fixture; exceeds the complexity-fail
 * threshold so the fixture must trip `complexity:high-complexity`.
 */
const FIXTURE_BRANCH_COUNT = 25;

/**
 * Number of generated functions in the large-file fixture.
 *
 * The module must cross the 800-line fail threshold through DENSE code rather than through a
 * long constant catalog: `large-file` exempts benign constant tables up to
 * `MAX_BENIGN_CONSTANT_LINES`, so a 820-line `export const codeLine_N = N;` block is legally
 * ignored and the fixture silently stops tripping the rule it exists to assert. Each function
 * below contributes branching control flow, which keeps the module outside that exemption.
 */
const FIXTURE_OVERSIZED_FUNCTIONS = 260;

/**
 * Branch-heavy body reused by every generated function in the oversized fixture. Three physical
 * lines per function, one of them a conditional, so the module is dense enough for the volume
 * rules and still cheap enough to parse inside the self-test budget.
 */
const FIXTURE_OVERSIZED_BODY = (index: number): string =>
    `export function task_${index}(value: number): number {\n` +
    `  if (value > ${index}) {\n    return value - 1;\n  }\n  return value + 1;\n}\n`;

/**
 * Column width used to pad the `analyzer:rule` pair label in the PASS/MISS report rows.
 */
const PAIR_LABEL_WIDTH = 36;

/**
 * Files that must stay silent.
 *
 * A fixture set that only proves "the rules we expected did fire" cannot detect the opposite and
 * more expensive failure: a rule firing on code that does not violate it. The clean fixture is
 * scanned by the same pipeline under the same config, and every rule in this allowlist must
 * produce zero findings on it.
 */
const CLEAN_RULE_ALLOWLIST: ReadonlySet<string> = new Set([
    'large-file',
    'VOL-ELOC-001',
    'VOL-LOC-001',
    'high-complexity',
    'magic-number',
    'secret-detected',
]);

/** Ordered view of `CLEAN_RULE_ALLOWLIST`, used for iteration and the summary line. */
const CLEAN_RULE_ALLOWLIST_ORDERED: readonly string[] = [...CLEAN_RULE_ALLOWLIST];

interface FixtureFile {
    rel: string;
    content: string;
    why: string;
}

/**
 * Build the negative-control source.
 *
 * It is deliberately dense (real branching, named constants, no filler) yet free of every
 * violation `CLEAN_RULE_ALLOWLIST` names. If a rule starts over-matching, this file is what
 * turns the over-match into a red self-test instead of a quiet false positive in real reviews.
 *
 * @returns TypeScript source small enough to stay far below every volume and complexity band.
 */
function buildCleanFixtureSource(): string {
    return [
        'export const RETRY_FLOOR = 0;',
        'export const RETRY_CEILING = 1;',
        '',
        'export function clampRetry(value: number): number {',
        '    if (value < RETRY_FLOOR) {',
        '        return RETRY_FLOOR;',
        '    }',
        '    return value > RETRY_CEILING ? RETRY_CEILING : value;',
        '}',
        '',
    ].join('\n');
}

/**
 * Creates the collection of fixture files containing deliberate rule violations.
 */
function createFixtureViolationFiles(ifs: string, oversized: string): FixtureFile[] {
    return [
        {
            rel: 'src/syncio.ts',
            content:
                "import * as fs from 'fs';\nexport function loadCfg(): string { return fs.readFileSync('cfg.json', 'utf8'); }\n",
            why: 'governance:GOV-PRF-004 (synchronous I/O blocks host)',
        },
        {
            rel: 'src/dead.ts',
            content: 'export function neverUsedGlobally(): void {}\n',
            why: 'dependency-graph:unused-module (no global importers)',
        },
        {
            rel: 'src/magic.ts',
            content: 'export function run(cb: () => void): void { setTimeout(cb, 999999); }\n',
            why: 'constants:magic-number (callsite literal)',
        },
        {
            rel: 'src/complex.ts',
            content: `export function tangled(x: number): number {\n${ifs}\n  return x;\n}\n`,
            why: 'complexity:high-complexity (25 branches >= fail threshold 20)',
        },
        {
            rel: 'src/toolarge.ts',
            content: `${oversized}export const end = 1;\n`,
            why: `large-file:large-file (${FIXTURE_OVERSIZED_FUNCTIONS * LINES_PER_OVERSIZED_FUNCTION} dense lines >= fail threshold ${FAIL_THRESHOLD_LARGE_FILE})`,
        },
        {
            rel: 'src/clean-compact.ts',
            content: buildCleanFixtureSource(),
            why: 'negative control: dense but small, so volume/complexity/literal rules stay silent',
        },
        {
            rel: 'src/swallow.ts',
            content: `export function risky(): void { try { JSON.parse("{"); } ${'catch'} { } }\n`,
            why: 'governance:GOV-EXC-001 (empty catch block)',
        },
        {
            rel: 'src/creds.ts',
            content: `export const token = "${['ghp', SYNTHETIC_SECRET_TOKEN_BODY].join('_')}";\n`,
            why: 'secrets:secret-detected (GitHub token signature)',
        },
        {
            rel: 'src/cyc/a.ts',
            content: "import { b } from './b';\nexport const a = 1;\n",
            why: 'dependency-graph:import-cycle (a->b->a)',
        },
        {
            rel: 'src/cyc/b.ts',
            content: "import { a } from './a';\nexport const b = 2;\n",
            why: 'dependency-graph:import-cycle (same as above, cycle closing edge)',
        },
    ];
}

/**
 * Creates scanner configuration tailored for executing self-test assertion suite.
 */
function createFixtureScanConfig(): Record<string, unknown> {
    return {
        include: ['src/**/*.ts'],
        analyzers: {
            constants: { enabled: true },
            complexity: { enabled: true },
            'large-file': {
                enabled: true,
                options: {
                    fileLinesFail: FAIL_THRESHOLD_LARGE_FILE,
                    effectiveLocFail: FAIL_THRESHOLD_LARGE_FILE,
                },
            },
            governance: { enabled: true },
            secrets: { enabled: true },
            'dependency-graph': {
                enabled: true,
                options: { detectCycles: true, detectUnusedExports: true },
            },
        },
    };
}

/**
 * Build the temporary fixture project files and the configuration enabling their analyzers.
 *
 * Each sample intentionally violates one analyzer contract, and the generated oversized module
 * crosses the volume envelope through dense branching code rather than a constant catalog.
 *
 * @returns Fixture files with the reason each exists, plus the configuration that enables
 *          the analyzers expected to fire on them.
 */
function buildFixtures(): { files: FixtureFile[]; config: Record<string, unknown> } {
    const ifs = Array.from(
        { length: FIXTURE_BRANCH_COUNT },
        (_, i) => `  if (x > ${i}) { x = x - 1; }`,
    ).join('\n');
    const oversized = Array.from({ length: FIXTURE_OVERSIZED_FUNCTIONS }, (_, i) =>
        FIXTURE_OVERSIZED_BODY(i),
    ).join('');
    return {
        files: createFixtureViolationFiles(ifs, oversized),
        config: createFixtureScanConfig(),
    };
}

/**
 * Stable `analyzer:rule` pairs every analyzer family must hit; a miss means the engine regressed.
 */
export const EXPECTED_PAIRS: Array<{ pair: string; why: string }> = [
    { pair: RULE_PAIR_MAGIC_NUMBER, why: 'Magic number detection' },
    { pair: RULE_PAIR_HIGH_COMPLEXITY, why: 'Cyclomatic complexity fail threshold' },
    { pair: RULE_PAIR_LARGE_FILE, why: 'Large file fail threshold' },
    { pair: RULE_PAIR_GOV_EXC_001, why: 'Empty catch block governance rule' },
    { pair: RULE_PAIR_GOV_PRF_003, why: 'Timer literal (unclamped)' },
    { pair: RULE_PAIR_GOV_PRF_004, why: 'Synchronous I/O blocks host' },
    { pair: RULE_PAIR_SECRET_DETECTED, why: 'Secret pattern detection' },
    { pair: RULE_PAIR_IMPORT_CYCLE, why: 'Circular dependency post-scan detection' },
    { pair: RULE_PAIR_UNUSED_MODULE, why: 'Unused module post-scan detection' },
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
const UTF8 = 'utf8';

function materializeFixtureFiles(
    fixtureRoot: string,
    fixtureFiles: ReadonlyArray<{ rel: string; content: string }>,
): void {
    const FIXTURE_ITEMS = fixtureFiles;
    for (const item of FIXTURE_ITEMS) {
        const abs = path.join(fixtureRoot, item.rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, item.content, UTF8);
    }
}

/**
 * Name of the negative-control fixture. Findings reported on this file are false positives by
 * construction, because the source deliberately satisfies every rule in the allowlist.
 */
const CLEAN_FIXTURE_BASENAME = 'clean-compact.ts';

/**
 * Collect the false-positive breaches on the negative-control fixture.
 *
 * Only rules present in the scan are considered, so a disabled rule is never counted as a
 * breach; the check is about over-matching, not about coverage.
 *
 * @param issues - Every finding the self-test scan produced.
 * @returns One human-readable row per (rule, line) false positive, plus the distinct rule count.
 */
function collectFalsePositives(issues: readonly ScanReport['issues'][number][]): {
    rows: string[];
    ruleCount: number;
} {
    const rows: string[] = [];
    const breachedRules = new Set<string>();
    for (const issue of issues) {
        const file = issue.location?.file ?? '';
        if (!file.endsWith(CLEAN_FIXTURE_BASENAME)) continue;
        if (!CLEAN_RULE_ALLOWLIST.has(issue.rule)) continue;
        if (breachedRules.has(issue.rule)) continue;
        breachedRules.add(issue.rule);
        rows.push(
            `  FP    ${issue.rule.padEnd(PAIR_LABEL_WIDTH)} clean fixture line ${issue.location?.start?.line ?? 0} -- False positive!`,
        );
    }
    return { rows, ruleCount: breachedRules.size };
}

/**
 * Executes built-in end-to-end self-test suite on synthetic fixtures.
 *
 * Two directions are asserted: every `EXPECTED_PAIRS` entry must fire (no silent analyzer
 * regression), and no rule in `CLEAN_RULE_ALLOWLIST` may fire on the negative-control fixture
 * (no silent over-matching). Only the first existed before, which is the blind spot that let
 * the fixture rot unnoticed while the gate stayed green.
 *
 * @param _args - Command-line arguments.
 * @returns Resulting exit code and text output report.
 * ASYNC-CONCURRENCY: self-contained; each run owns a fresh temp fixture root, so concurrent runs
 * cannot observe one another.
 */
export async function runSelfTestCommand(_args: string[]): Promise<{ code: number; text: string }> {
    const lines: string[] = [];
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), SELFTEST_DIR_PREFIX));
    try {
        const { files, config } = buildFixtures();
        materializeFixtureFiles(fixtureRoot, files);
        fs.writeFileSync(
            path.join(fixtureRoot, CONFIG_FILE_NAME),
            JSON.stringify(config, null, 2),
            UTF8,
        );

        // Use the real scanAndRender pipeline (exemption, dependency-graph and baseline phases);
        // assert on the report written to the temporary file.
        const reportPath = path.join(fixtureRoot, REPORT_FILE_NAME);
        await scanAndRender({ root: fixtureRoot, format: 'json', cache: false, out: reportPath });
        const report: ScanReport = JSON.parse(fs.readFileSync(reportPath, UTF8));
        const fired = new Set(report.issues.map((i) => `${i.analyzer}:${i.rule}`));

        let missedCount = 0;
        for (const { pair, why } of EXPECTED_PAIRS) {
            if (fired.has(pair)) {
                lines.push(`  PASS  ${pair.padEnd(PAIR_LABEL_WIDTH)} ${why}`);
            } else {
                missedCount++;
                lines.push(
                    `  MISS  ${pair.padEnd(PAIR_LABEL_WIDTH)} ${why} -- Analyzer regression!`,
                );
            }
        }

        const falsePositives = collectFalsePositives(report.issues);
        lines.push(...falsePositives.rows);

        const unexpectedFamilies = new Set(report.issues.map((i) => i.analyzer));
        lines.push(
            `  -- Fixture total ${report.summary.filesScanned} files / ${report.issues.length} findings, covering families: ${[...unexpectedFamilies].join(', ')}`,
        );
        lines.push(
            `  -- Recall ${EXPECTED_PAIRS.length - missedCount}/${EXPECTED_PAIRS.length} expected pairs fired, ` +
                `precision ${falsePositives.ruleCount === 0 ? 'clean (0' : `breached (${falsePositives.ruleCount}`} ` +
                `of ${CLEAN_RULE_ALLOWLIST_ORDERED.length} guarded rules on the clean fixture)`,
        );

        const allPassed = missedCount === 0 && falsePositives.ruleCount === 0;
        return {
            code: allPassed ? 0 : 1,
            text: [
                `auto-refactor self-test (known violation fixtures -> engine hit assertion)`,
                ...lines,
                allPassed
                    ? 'Conclusion: All expected engine rules fired, no false positive on the clean fixture ✔'
                    : 'Conclusion: Regressed analyzer or over-matching rule detected ✖ BLOCK',
            ].join('\n'),
        };
    } catch (err) {
        return { code: 2, text: `self-test setup failure: ${(err as Error).message}` };
    } finally {
        fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
}

/**
 * Backward compatibility alias for runSelfTestCommand.
 */
export const selfTestCommand = runSelfTestCommand;
