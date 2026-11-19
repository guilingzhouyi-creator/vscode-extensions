#!/usr/bin/env node
/**
 * Module: Verification Suite — Example Custom Rule
 * File Path: .agents/skills/auto-refactor-dev/templates/validate-suite-boilerplate.js
 * Architecture Role: Regression test suite boilerplate for custom analyzer rules.
 * Dependencies & Triggers: Invoked via test-parallel.js; depends on Node.js assert.
 * Responsibilities: Verify positive rule detection on anti-patterns and zero false positives on clean fixtures.
 * Exit Semantics & Design Rationale: 0 = PASS, non-zero = FAIL; registered in test-parallel.js to prevent orphan suites.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
// Resolved when this template is copied into auto-refactor/scripts/validate-*.js:
const { rmSyncWithRetry } = require('./lib/resilient-fs-cleanup');

function runTests() {
  console.log('=== Running Example Custom Rule Validation Suite ===');

  // Test 1: Positive match
  {
    const result = { matched: true, count: 1 };
    assert.strictEqual(result.matched, true, 'Rule must match target pattern');
    console.log('  [PASS] Test 1: Positive match detected');
  }

  // Test 2: Negative match
  {
    const cleanResult = { matched: false, count: 0 };
    assert.strictEqual(cleanResult.matched, false, 'Rule must not flag clean pattern');
    console.log('  [PASS] Test 2: Clean code stays silent');
  }

  // Test 3: Isolated temp sandbox with Windows-resilient cleanup
  {
    const sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-validate-example-'));
    try {
      const fixturePath = path.join(sandboxDir, 'sample.ts');
      fs.writeFileSync(fixturePath, 'export const sample = 1;\n', 'utf8');
      assert.strictEqual(fs.existsSync(fixturePath), true, 'Sandbox fixture must exist');
      console.log('  [PASS] Test 3: Sandbox fixture verified');
    } finally {
      rmSyncWithRetry(sandboxDir, { recursive: true, force: true });
    }
  }

  console.log('✅ All tests in suite passed successfully.');
}

runTests();
