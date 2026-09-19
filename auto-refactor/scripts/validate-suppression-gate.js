/**
 * Module: Verification Harness — Suppression Decides the Gate Verdict
 * File Path: scripts/validate-suppression-gate.js
 * Architecture Role: Contract lock for `--fail-on-severity` (and `failOnIssue`): a finding matched
 *     by a declarative suppression stays in the report for auditing but is excluded from gate
 *     counting, while the same finding without a suppression still fails the build
 * Dependencies & Triggers: `npm run validate-suppression-gate` (part of `npm test`); imports
 *     ../dist/api (scan, scanAndRender) and drives two synthetic projects that differ only in
 *     whether the config carries a suppression
 * Responsibilities: Freeze a baseline over a fixture with three magic numbers, grow the line to
 *     four, then assert the suppressed tree exits 0 with the finding still visible and marked new,
 *     and that the unsuppressed control tree exits 1 under the same severity threshold
 * Exit Semantics & Design Rationale: Rejects on the first failed assertion and exits 1 so CI fails
 *     loudly. The control tree keeps the case honest: without it, a gate that never fails anything
 *     would pass the suppression assertion. The ratchet-credit half of the same contract lives in
 *     validate-baseline-ratchet.js so neither file outgrows the large-file threshold.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { scan, scanAndRender } = require('../dist/api');

/** Config shared by both fixtures; only the suppression list differs between them. */
const BASE_CONFIG = {
  include: ['src/**/*.ts'],
  analyzers: { constants: { enabled: true, options: { magicNumberMin: 3 } } },
};

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
 * Build scan options for one fixture root.
 *
 * @param root - Synthetic project root.
 * @param extra - Additional `scan()` options (baseline knobs).
 * @returns Options object accepted by the library entry point.
 */
function optionsFor(root, extra) {
  return {
    root,
    configFile: path.join(root, 'auto-refactor.config.json'),
    cache: false,
    daemon: 'off',
    workers: 1,
    respectGitignore: false,
    logLevel: 'silent',
    ...extra,
  };
}

/**
 * Grow one same-line literal past a frozen baseline and read the gate verdict back.
 *
 * @param root - Fixture root holding the config and `src/a.ts`.
 * @param suppressed - Whether that root's config carries a matching suppression.
 * @returns Exit code reported by the gate wrapper.
 */
async function checkGateExit(root, suppressed) {
  const baseline = path.join(root, 'gate-baseline.json');
  const out = path.join(root, 'gate-report.json');
  writeFiles(root, { 'src/a.ts': 'export const table = [11, 7, 500];\n' });
  await scan(optionsFor(root, { updateBaseline: baseline, baselineGranularity: 'id' }));
  writeFiles(root, { 'src/a.ts': 'export const table = [11, 7, 500, 999];\n' });

  const ratchetOptions = { baseline, baselineGranularity: 'id' };
  const flagged = (await scan(optionsFor(root, ratchetOptions))).issues.filter(
    (issue) => issue.isNew === true,
  );
  assert.ok(flagged.length > 0, 'the fixture must produce a genuinely new finding');
  assert.strictEqual(
    flagged.every((issue) => Boolean(issue.suppression)),
    suppressed,
    'the suppression must match exactly the findings the config claims to cover',
  );
  return scanAndRender(
    Object.assign(optionsFor(root, ratchetOptions), {
      format: 'json',
      out,
      failOnSeverity: 'warning',
    }),
  );
}

async function main() {
  const suppressRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-suppress-gate-'));
  const controlRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-control-gate-'));
  try {
    writeFiles(suppressRoot, {
      'auto-refactor.config.json': JSON.stringify(
        {
          ...BASE_CONFIG,
          suppressions: [
            {
              matchRule: 'magic-number',
              reason: 'fixture: the review board accepted this literal set',
            },
          ],
        },
        null,
        2,
      ),
    });
    writeFiles(controlRoot, {
      'auto-refactor.config.json': JSON.stringify(BASE_CONFIG, null, 2),
    });

    assert.strictEqual(
      await checkGateExit(suppressRoot, true),
      0,
      'a suppressed new finding must not fail the severity gate',
    );
    console.log('  [PASS] a suppressed new finding keeps the gate green but stays in the report');
    assert.strictEqual(
      await checkGateExit(controlRoot, false),
      1,
      'the same growth without a suppression must still fail the severity gate',
    );
    console.log('  [PASS] the control tree still fails, so the suppression is what decides it');
  } finally {
    fs.rmSync(suppressRoot, { recursive: true, force: true });
    fs.rmSync(controlRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error('[validate-suppression-gate] FAILED:', error && error.message);
  process.exit(1);
});
