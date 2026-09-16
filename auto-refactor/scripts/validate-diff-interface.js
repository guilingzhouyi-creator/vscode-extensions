/**
 * Module: Verification Harness — Diff/Incremental Interface Contract
 * File Path: scripts/validate-diff-interface.js
 * Architecture Role: Locks the incremental invocation contract: full scans and incremental
 *     scans share suppressions + baseline annotations, differ only in cross-file passes, and
 *     both declare what ran via `summary.postScanPasses`. Also locks the CLI `--diff`
 *     changed-set mode (git status) to exact repository-relative paths.
 * Dependencies & Triggers: `npm run validate-diff-interface` (part of `npm test`); imports
 *     ../dist/api (scan, scanDiff, scanDiffDelta, scanAndRender) and node child_process
 * Responsibilities: Assert full/diff/delta pass markers; assert incremental scans skip the
 *     dependency-graph pass and say so in warnings; assert delta is a strict filter of the full
 *     diff report; assert reasoned suppressions and baseline annotations reach diff reports;
 *     assert the CLI changed-set mode scans only the changed paths (no basename over-matching)
 * Exit Semantics & Design Rationale: Rejects on the first failed assertion and exits 1 so CI
 *     fails loudly. Incremental scopes are asserted on normalized tuples because the whole point
 *     of the contract is that a partial file set must not invent cross-file findings.
 */
'use strict';

const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { scan, scanDiff, scanDiffDelta, scanAndRender } = require('../dist/api');

/**
 * Write a set of fixture files into a directory tree.
 *
 * @param root - Absolute directory that receives the files.
 * @param files - Map of relative path to UTF-8 content.
 */
function writeFiles(root, files) {
  for (const [name, content] of Object.entries(files)) {
    const abs = path.join(root, name);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
}

/**
 * Reduce a report to comparable issue tuples.
 *
 * @param report - Scan/diff report.
 * @param fileFilter - Optional file path to keep.
 * @returns Normalized tuples sorted for stable comparison.
 */
function tuples(report, fileFilter) {
  return report.issues
    .filter((issue) => !fileFilter || issue.location.file.endsWith(fileFilter))
    .map((issue) => ({
      rule: issue.rule,
      file: issue.location.file.replace(/\\/g, '/'),
      line: issue.location.start.line,
      severity: issue.severity,
      suppression: issue.suppression ? issue.suppression.reason : null,
      isNew: Boolean(issue.isNew),
    }))
    .sort((a, b) => `${a.file}|${a.rule}|${a.line}`.localeCompare(`${b.file}|${b.rule}|${b.line}`));
}

const CONFIG = {
  include: ['src/**/*.ts'],
  analyzers: {
    'dependency-graph': { enabled: true, options: { detectCycles: true } },
    constants: { enabled: true, options: { magicNumberMin: 2 } },
    comments: { enabled: false },
    governance: { enabled: false },
  },
  suppressions: [
    {
      matchAnalyzer: 'constants',
      matchRule: 'magic-number',
      matchFile: 'src/a.ts',
      downgradeTo: 'info',
      reason: 'fixture policy: the sampling constant is deliberate',
    },
  ],
};

async function main() {
  // ── 1. Full scan: all passes, cross-file findings included ──
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-diffif-'));
  const configPath = path.join(root, 'auto-refactor.config.json');
  const baselinePath = path.join(root, 'baseline.json');
  const reportPath = path.join(root, 'report.json');
  const options = {
    root,
    configFile: configPath,
    logLevel: 'silent',
    cache: false,
    baseline: baselinePath,
    baselineGranularity: 'grouped',
  };
  const A_OLD = 'export const LIMIT = 42;\n';
  const A_NEW =
    "import { OTHER } from './b';\n" +
    'export const LIMIT = 42;\n' +
    'export function scale(x: number): number {\n' +
    '  return x * 42;\n' +
    '}\n' +
    'export const A = OTHER;\n';
  try {
    writeFiles(root, {
      'auto-refactor.config.json': JSON.stringify(CONFIG, null, 2),
      'src/a.ts': A_NEW,
      'src/b.ts': "import { A } from './a';\nexport const OTHER = A + 1;\n",
    });

    // Freeze a grouped baseline from the current state so both modes can be compared to it.
    await scan({ ...options, updateBaseline: baselinePath });
    assert.ok(fs.existsSync(baselinePath), 'baseline freeze must write the file');

    const full = await scan(options);
    assert.deepStrictEqual(
      full.summary.postScanPasses,
      ['dependency-graph', 'suppressions', 'baseline'],
      `full scan must run every pass, got ${JSON.stringify(full.summary.postScanPasses)}`,
    );
    assert.strictEqual(
      full.issues.filter((issue) => issue.rule === 'import-cycle').length,
      1,
      'full scan must report the import cycle',
    );
    assert.strictEqual(full.summary.ratchetBaselineUsed, true, 'full scan must apply the baseline');
    console.log('  [PASS] full scan runs dependency-graph + suppressions + baseline');

    // ── 2. Content-diff scan (full file set): same suppressions/baseline, no cross-file pass ──
    const diffs = [{ kind: 'full', filePath: 'src/a.ts', oldContent: A_OLD, newContent: A_NEW }];
    const diff = await scanDiff(diffs, options);
    assert.deepStrictEqual(
      diff.report.summary.postScanPasses,
      ['suppressions', 'baseline'],
      `diff scan must skip cross-file passes, got ${JSON.stringify(diff.report.summary.postScanPasses)}`,
    );
    assert.ok(
      (diff.report.summary.warnings || []).some((w) => w.includes('incremental scope')),
      'diff scan must declare that cross-file passes were skipped',
    );
    assert.strictEqual(
      diff.report.issues.filter((issue) => issue.rule === 'import-cycle').length,
      0,
      'a partial/ incremental scope must not invent cross-file findings',
    );
    const suppressed = diff.report.issues.filter(
      (issue) => issue.rule === 'magic-number' && issue.location.file.endsWith('src/a.ts'),
    );
    assert.ok(suppressed.length > 0, 'the changed file must still produce its own findings');
    assert.ok(suppressed[0].suppression, 'reasoned suppressions must reach diff reports');
    assert.strictEqual(suppressed[0].severity, 'info', 'suppression downgrade must survive');
    assert.strictEqual(diff.report.summary.ratchetBaselineUsed, true, 'baseline must reach diff');
    console.log('  [PASS] diff scan keeps suppressions/baseline, skips cross-file passes');

    // ── 3. Delta scan is a strict filter of the diff report ──
    const delta = await scanDiffDelta(diffs, options);
    assert.deepStrictEqual(
      tuples(delta.report, 'src/a.ts'),
      tuples(diff.report, 'src/a.ts'),
      'delta findings must be byte-identical to the corresponding diff findings',
    );
    assert.deepStrictEqual(
      delta.report.summary.postScanPasses,
      ['suppressions', 'baseline'],
      'delta shares the incremental scope',
    );
    console.log('  [PASS] delta report is a strict filter of the diff report');

    // ── 4. CLI changed-set mode: exact paths, incremental scope declared ──
    const gitRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-diffcli-'));
    // A fixture repository must not inherit the developer's global git identity, and must never
    // block: with `commit.gpgsign=true` globally and an unavailable keyring, `git commit` waits for
    // a passphrase forever and hangs the entire gate. The timeout turns any future hang into a loud
    // failure instead of a silent stall.
    const git = (...args) =>
      execFileSync('git', args, {
        cwd: gitRoot,
        stdio: 'pipe',
        encoding: 'utf8',
        timeout: 20000,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      });
    try {
      writeFiles(gitRoot, {
        'auto-refactor.config.json': JSON.stringify(CONFIG, null, 2),
        'src/a.ts': A_OLD,
        'src/new.ts': 'export const FRESH = 7;\n',
        'other/a.ts': 'export const SAME_NAME = 8;\n',
      });
      git('init', '-q', '.');
      git('add', '-A');
      git(
        '-c',
        'commit.gpgsign=false',
        '-c',
        'user.email=fixture@example.com',
        '-c',
        'user.name=fixture',
        'commit',
        '-qm',
        'init',
      );
      writeFiles(gitRoot, { 'src/new.ts': 'export const FRESH = 9;\n' });

      const code = await scanAndRender({
        root: gitRoot,
        configFile: path.join(gitRoot, 'auto-refactor.config.json'),
        format: 'json',
        out: reportPath,
        logLevel: 'silent',
        cache: false,
        diff: true,
      });
      assert.strictEqual(code, 0, `changed-set scan must succeed, exit=${code}`);
      const cli = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
      assert.strictEqual(
        cli.summary.filesScanned,
        1,
        `changed-set mode must scan exactly the changed file, got ${cli.summary.filesScanned}`,
      );
      assert.deepStrictEqual(
        cli.summary.postScanPasses,
        ['suppressions'],
        'changed-set mode must declare the incremental scope',
      );
      assert.ok(
        (cli.summary.warnings || []).some((w) => w.includes('incremental scope')),
        'changed-set mode must declare skipped cross-file passes',
      );
      console.log('  [PASS] CLI --diff scans only changed paths and declares incremental scope');
    } finally {
      fs.rmSync(gitRoot, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main()
  .then(() => {
    console.log('\n ALL DIFF INTERFACE CHECKS PASSED SUCCESSFULLY!');
  })
  .catch((error) => {
    console.error('\n[FAIL]', error && error.message ? error.message : error);
    process.exit(1);
  });
