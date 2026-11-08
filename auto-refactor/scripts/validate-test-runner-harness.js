/**
 * Module: Verification Harness — Test Runner Harness Verification
 * File Path: scripts/validate-test-runner-harness.js
 * Architecture Role: Self-test suite verifying that test-runner-harness.js properly
 *     creates sandboxes, writes fixtures, executes assertions, and handles teardown.
 * Dependencies & Triggers: `node scripts/validate-test-runner-harness.js`; imports
 *     scripts/common/test-runner-harness.js.
 * Responsibilities: Assert tempDir isolation; assert file fixture persistence; assert
 *     cleanup on completion.
 * Exit Semantics & Design Rationale: Exits with 0 on full success, 1 on assertion failure.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { runValidationSuite, reportFailure, runEntry } = require('./common/test-runner-harness');

async function main() {
  let observedTempDir = '';

  await runValidationSuite({
    name: 'test-runner-harness-isolation',
    fixtures: {
      'test-file.txt': 'hello sandbox',
      'nested/file.txt': ['line 1', 'line 2'],
    },
    run: async ({ tempDir }) => {
      observedTempDir = tempDir;
      assert.strictEqual(fs.existsSync(path.join(tempDir, 'test-file.txt')), true);
      assert.strictEqual(
        fs.readFileSync(path.join(tempDir, 'test-file.txt'), 'utf8'),
        'hello sandbox',
      );
      assert.strictEqual(
        fs.readFileSync(path.join(tempDir, 'nested/file.txt'), 'utf8'),
        'line 1\nline 2',
      );
    },
  });

  // Teardown assertion: tempDir must be cleaned up
  assert.strictEqual(
    fs.existsSync(observedTempDir),
    false,
    'Sandbox directory must be cleaned up after execution',
  );

  // Exit contract: a failing entry must terminate the process with status 1 and suite name.
  // Asserted via child process because `process.exit` cannot be observed in-process without
  // mocking the global and bypassing the real exit path.
  const exitProbes = [
    { name: 'probe-runEntry', call: "runEntry('probe-runEntry', async () => { throw new Error('probe'); })" },
    {
      name: 'probe-reportFailure',
      call: [
        "reportFailure('probe-reportFailure', () => console.log('cleanup-ran'))(new Error('probe'))",
      ].join('\n'),
      expects: ['cleanup-ran'],
    },
    {
      name: 'probe-cleanup-throws',
      call: "reportFailure('probe-cleanup-throws', () => { throw new Error('teardown'); })(new Error('probe'))",
      // The original failure must survive a broken teardown: reporting `teardown` instead would
      // hide why the suite actually failed.
      expects: ['probe'],
      rejects: ['teardown'],
    },
  ];
  for (const probe of exitProbes) {
    const probePath = path.join(os.tmpdir(), `${probe.name}-${process.pid}.cjs`);
    const harnessPath = path.join(__dirname, 'common', 'test-runner-harness.js').replace(/\\/g, '\\\\');
    fs.writeFileSync(
      probePath,
      [
        "'use strict';",
        `const { runEntry, reportFailure } = require('${harnessPath}');`,
        probe.call + ';',
      ].join('\n'),
    );
    const outcome = spawnSync(process.execPath, [probePath], { encoding: 'utf8' });
    fs.rmSync(probePath, { force: true });
    assert.strictEqual(outcome.status, 1, `${probe.name} must exit 1 on failure`);
    const seen = `${outcome.stdout}${outcome.stderr}`;
    assert.ok(seen.includes(probe.name), `${probe.name} failure must name the suite that broke`);
    for (const token of probe.expects ?? []) {
      assert.ok(seen.includes(token), `${probe.name} must report ${token}`);
    }
    for (const token of probe.rejects ?? []) {
      assert.ok(!seen.includes(token), `${probe.name} must not report ${token} instead of the failure`);
    }
  }

  console.log('ALL TEST RUNNER HARNESS CHECKS PASSED SUCCESSFULLY!');
}

main().catch(reportFailure('validate-test-runner-harness.js'));
