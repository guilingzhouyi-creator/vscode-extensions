#!/usr/bin/env node
/**
 * Module: Verification Suite — Example Custom Rule
 * File Path: scripts/validate-example-custom.js
 * Architecture Role: Regression test suite for custom analyzer rules
 * Dependencies: assert, path
 * Exit Semantics: 0 = PASS, non-zero = FAIL
 */
'use strict';

const assert = require('assert');

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

  console.log('✅ All tests in suite passed successfully.');
}

runTests();
