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
const path = require('path');
const { runValidationSuite, createTempTestDir, cleanupTempDir } = require('./common/test-runner-harness');

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

    console.log('ALL TEST RUNNER HARNESS CHECKS PASSED SUCCESSFULLY!');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
