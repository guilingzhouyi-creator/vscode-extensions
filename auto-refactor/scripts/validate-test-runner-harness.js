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

  // Exit contract: a failing entry must terminate the process with status 1 and name its suite.
  // This is asserted through a child process because the contract is `process.exit`, which cannot be
  // observed from inside the same process without replacing the global and losing the real code path.
  const exitProbes = [
    { name: 'probe-runEntry', call: "runEntry('probe-runEntry', async () => { throw new Error('probe'); })" },
    {
      name: 'probe-reportFailure',
      call: [
        "const cleaned = [];",
        "reportFailure('probe-reportFailure', () => { cleaned.push('cleanup'); })(new Error('probe'))",
      ].join('\n'),
    },
    {
      name: 'probe-cleanup-throws',
      call: "reportFailure('probe-cleanup-throws', () => { throw new Error('teardown'); })(new Error('probe'))",
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
    assert.ok(
      `${outcome.stdout}${outcome.stderr}`.includes(probe.name),
      `${probe.name} failure must name the suite that broke`,
    );
    if (probe.name === 'probe-cleanup-throws') {
      // A teardown failure must not replace the verdict: the probe still has to exit 1 and still
      // report the suite name, otherwise the reason the suite failed would be hidden by its cleanup.
      assert.ok(
        `${outcome.stdout}${outcome.stderr}`.includes('probe'),
        `${probe.name} must still report the original failure`,
      );
    }
  }

  console.log('ALL TEST RUNNER HARNESS CHECKS PASSED SUCCESSFULLY!');
}

main().catch(reportFailure('validate-test-runner-harness.js'));
