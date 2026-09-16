/**
 * Module: Verification Harness — Consumer Runner Template Key Points
 * File Path: scripts/validate-consumer-runner.js
 * Architecture Role: End-to-end contract suite for templates/consumer/run.mjs, the ratchet
 *     wrapper every consuming project copies next to its own config
 * Dependencies & Triggers: `npm run validate-consumer-runner` (part of `npm test`); spawns the
 *     template runner against a synthetic project with the real dist build
 * Responsibilities: Assert the exit-code contract (0 = clean or no new findings, 1 = blocking
 *     finding, 2 = usage/engine/config error), assert baseline freeze + ratchet behavior, assert
 *     fail-closed handling of a missing engine with an explicit opt-in escape hatch, and assert
 *     the threshold-parity check catches a divergent double declaration
 * Exit Semantics & Design Rationale: Rejects on the first failed assertion and exits 1 so CI
 *     fails loudly. Running the shipped template instead of reimplementing its logic keeps this
 *     suite honest: the artifact every consumer copies is exactly the artifact under test.
 */
'use strict';

const assert = require('assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const RUNNER = path.join(ROOT, 'templates', 'consumer', 'run.mjs');

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
 * Run the template runner and capture its verdict.
 *
 * @param projectDir - Synthetic project root.
 * @param extraArgs - Additional CLI arguments for the runner.
 * @returns Spawn result with utf8 stdout/stderr and numeric status.
 */
function runRunner(projectDir, extraArgs = []) {
  const result = spawnSync(
    process.execPath,
    [RUNNER, '--engine', ROOT, '--root', projectDir, ...extraArgs],
    { encoding: 'utf8' },
  );
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}

const CONFIG = {
  include: ['**/*.py'],
  analyzers: {
    constants: { enabled: false },
    'large-file': { enabled: false },
    complexity: { enabled: false },
    hygiene: { enabled: true },
    simplify: { enabled: true },
    'python-modern': { enabled: true },
  },
};

function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-consumer-'));
  const configPath = path.join(root, '.auto-refactor', 'config.json');
  const baselinePath = path.join(root, '.auto-refactor', 'baseline.json');
  try {
    writeFiles(root, {
      '.auto-refactor/config.json': JSON.stringify(CONFIG, null, 2),
      'src/probe.py': 'def empty_impl():\n    pass\n',
    });

    // 1. Blocking findings without a baseline -> exit 1, report written.
    const first = runRunner(root, [
      '--fail-on-severity',
      'warning',
      '--out',
      path.join(root, 'report.json'),
    ]);
    assert.strictEqual(
      first.status,
      1,
      `expected blocking exit, got ${first.status}: ${first.stderr}`,
    );
    assert.ok(fs.existsSync(path.join(root, 'report.json')), 'report must be written');
    assert.ok(first.stdout.includes('ratchetNew='), 'summary must print ratchet counters');
    console.log('  [PASS] blocking findings exit 1 and the report is written');

    // 1b. `--report-only` hands the verdict to the consumer (exit 0 despite findings), and
    // `--engine-arg` reaches the engine verbatim (excluding src/ empties the report).
    const reportOnly = runRunner(root, ['--report-only', '--out', path.join(root, 'report.json')]);
    assert.strictEqual(reportOnly.status, 0, '--report-only must not gate on findings');
    const passThrough = runRunner(root, [
      '--report-only',
      '--engine-arg=--exclude',
      '--engine-arg=src',
      '--out',
      path.join(root, 'report.json'),
    ]);
    assert.strictEqual(passThrough.status, 0, `pass-through run failed: ${passThrough.stderr}`);
    const excluded = JSON.parse(fs.readFileSync(path.join(root, 'report.json'), 'utf8'));
    assert.strictEqual(
      excluded.summary.filesScanned,
      0,
      '--engine-arg must forward flags verbatim to the engine',
    );
    console.log('  [PASS] --report-only and --engine-arg behave as documented');

    // 2. Freeze the baseline, then the same tree must pass with zero new findings.
    const freeze = runRunner(root, ['--update-baseline', '--baseline', baselinePath]);
    assert.strictEqual(freeze.status, 0, `baseline freeze must succeed: ${freeze.stderr}`);
    assert.ok(fs.existsSync(baselinePath), 'baseline file must exist after freeze');
    const frozen = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
    assert.strictEqual(frozen.granularity, 'grouped', 'default freeze must be grouped');
    assert.ok((frozen.groups || []).length > 0, 'grouped baseline must carry group counts');
    const ratcheted = runRunner(root, ['--fail-on-severity', 'warning']);
    assert.strictEqual(ratcheted.status, 0, 'no new findings => exit 0');
    assert.ok(ratcheted.stdout.includes('ratchetNew=0'), 'ratchet must report zero new findings');
    console.log('  [PASS] baseline freeze + ratchet keeps an unchanged tree green');

    // 3. A new violation must break the ratchet.
    writeFiles(root, { 'src/regression.py': 'def other_empty():\n    pass\n' });
    const regression = runRunner(root, ['--fail-on-severity', 'warning']);
    assert.strictEqual(regression.status, 1, 'a new violation must fail the ratchet');
    console.log('  [PASS] a new violation breaks the ratchet');

    // 4. Missing engine is fail-closed, with an explicit opt-in escape hatch.
    const missing = spawnSync(
      process.execPath,
      [RUNNER, '--engine', path.join(root, 'no-such-engine'), '--root', root],
      { encoding: 'utf8' },
    );
    assert.strictEqual(missing.status, 2, 'missing engine must exit 2 by default');
    const allowed = spawnSync(
      process.execPath,
      [
        RUNNER,
        '--engine',
        path.join(root, 'no-such-engine'),
        '--root',
        root,
        '--allow-missing-engine',
      ],
      { encoding: 'utf8' },
    );
    assert.strictEqual(allowed.status, 0, '--allow-missing-engine opts into degradation');
    console.log('  [PASS] missing engine is fail-closed unless explicitly allowed');

    // 5. Threshold parity: divergent global vs analyzer option must be rejected before scanning.
    fs.writeFileSync(
      configPath,
      JSON.stringify(
        {
          ...CONFIG,
          thresholds: { magicNumberMin: 3 },
          analyzers: {
            ...CONFIG.analyzers,
            constants: { enabled: true, options: { magicNumberMin: 7 } },
          },
        },
        null,
        2,
      ),
    );
    const divergent = runRunner(root, ['--check-threshold-parity']);
    assert.strictEqual(divergent.status, 2, 'divergent thresholds must exit 2');
    assert.ok(divergent.stderr.includes('magicNumberMin'), 'divergence must name the key');
    console.log('  [PASS] threshold double-declaration divergence is caught before scanning');

    // 6. Missing config is a usage error, never a silent pass.
    const noConfig = spawnSync(
      process.execPath,
      [RUNNER, '--engine', ROOT, '--root', root, '--config', path.join(root, 'missing.json')],
      { encoding: 'utf8' },
    );
    assert.strictEqual(noConfig.status, 2, 'missing config must exit 2');
    console.log('  [PASS] missing config fails loudly');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

try {
  main();
  console.log('\n ALL CONSUMER RUNNER KEY POINTS PASSED SUCCESSFULLY!');
} catch (error) {
  console.error('\n[FAIL]', error && error.message ? error.message : error);
  process.exit(1);
}
