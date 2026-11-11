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
const { runValidationSuite, reportFailure } = require('./common/test-runner-harness');

function assertProbeOutput(seen, probe) {
  assert.strictEqual(
    seen.includes(probe.name),
    true,
    `${probe.name} failure must name the suite that broke`,
  );
  if (probe.expectToken) {
    assert.strictEqual(
      seen.includes(probe.expectToken),
      true,
      `${probe.name} must report ${probe.expectToken}`,
    );
  }
  if (probe.rejectToken) {
    assert.strictEqual(
      seen.includes(probe.rejectToken),
      false,
      `${probe.name} must not report ${probe.rejectToken} instead of the failure`,
    );
  }
}

function verifyExitProbes() {
  const exitProbes = [
    {
      name: 'probe-runEntry',
      call: "runEntry('probe-runEntry', async () => { throw new Error('probe'); })",
    },
    {
      name: 'probe-reportFailure',
      call: "reportFailure('probe-reportFailure', () => console.log('cleanup-ran'))(new Error('probe'))",
      expectToken: 'cleanup-ran',
    },
    {
      name: 'probe-cleanup-throws',
      call: "reportFailure('probe-cleanup-throws', () => { throw new Error('teardown'); })(new Error('probe'))",
      // The original failure must survive a broken teardown: reporting `teardown` instead would
      // hide why the suite actually failed.
      expectToken: 'probe',
      rejectToken: 'teardown',
    },
  ];

  const harnessPath = path
    .join(__dirname, 'common', 'test-runner-harness.js')
    .replace(/\\/g, '\\\\');
  for (const probe of exitProbes) {
    const probePath = path.join(os.tmpdir(), `${probe.name}-${process.pid}.cjs`);
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
    assertProbeOutput(seen, probe);
  }
}

async function main() {
  let recordedSandboxDir = '';

  await runValidationSuite({
    name: 'test-runner-harness-isolation',
    fixtures: {
      'test-file.txt': 'hello sandbox',
      'nested/file.txt': ['line 1', 'line 2'],
    },
    run: async ({ tempDir }) => {
      recordedSandboxDir = tempDir;
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
    fs.existsSync(recordedSandboxDir),
    false,
    'Sandbox directory must be cleaned up after execution',
  );

  // Exit contract: a failing entry must terminate the process with status 1 and suite name.
  // Asserted via child process because `process.exit` cannot be observed in-process without
  // mocking the global and bypassing the real exit path.
  verifyExitProbes();

  console.log('ALL TEST RUNNER HARNESS CHECKS PASSED SUCCESSFULLY!');
}

main().catch(reportFailure('validate-test-runner-harness.js'));
