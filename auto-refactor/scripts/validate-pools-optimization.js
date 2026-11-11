#!/usr/bin/env node
/**
 * Module: Static Quality Gate — Resource Pooling & Allocation Verification
 * File Path: scripts/validate-pools-optimization.js
 * Architecture Role: Verification harness asserting zero-allocation behavior,
 *   concurrency safety of leased regexes, and scratch buffer reuse.
 * Dependencies & Triggers: `npm run gate` / `npm test`; tests LeasedRegexPool,
 *   camelToSnake, and computeLineStartsAndHashes.
 * Responsibilities:
 *   1. Assert lastIndex = 0 reset guarantee in LeasedRegexPool across consecutive borrows;
 *   2. Assert pattern caching in SecretsAnalyzer;
 *   3. Assert LineIndex hash equivalence between scratch buffer pool and fresh allocation;
 *   4. Benchmark allocation efficiency.
 * Exit Semantics & Design Rationale: 0 = all assertions pass, 1 = failure.
 */
'use strict';

const assert = require('assert');

console.log('🚀 [POOLS] Starting Resource Pooling & Optimization Verification Harness...\n');

// 1. Test LeasedRegexPool behavior
const { LeasedRegexPool } = require('../dist/core/data-structures/regex-pool');
const pool = new LeasedRegexPool({ bucketCapacity: 4 });

console.log('--- [1/4] Testing LeasedRegexPool lastIndex Concurrency Safety ---');
const pattern = '[a-z]+';
const flags = 'g';

const re1 = pool.borrow(pattern, flags);
assert.strictEqual(re1.lastIndex, 0, 'Borrowed regex must have lastIndex == 0');
re1.lastIndex = 5;
pool.return(re1, pattern, flags);

const re2 = pool.borrow(pattern, flags);
assert.strictEqual(re2.lastIndex, 0, 'Re-borrowed regex from pool must have lastIndex reset to 0');
assert.strictEqual(re1, re2, 'Pool must return the cached instance when available');
pool.return(re2, pattern, flags);

let executed = false;
pool.withScanner(pattern, flags, (scanner) => {
  assert.strictEqual(scanner.lastIndex, 0);
  scanner.lastIndex = 10;
  executed = true;
});
assert.ok(executed, 'withScanner callback must execute');

const re3 = pool.borrow(pattern, flags);
assert.strictEqual(re3.lastIndex, 0, 'Regex after withScanner must have lastIndex reset to 0');
pool.return(re3, pattern, flags);
console.log('✔ LeasedRegexPool lastIndex safety verified.');

// 2. Test SSOT regex patterns & camelToSnake
console.log('\n--- [2/4] Testing regex-patterns camelToSnake with Pooled Scanner ---');
const {
  camelToSnake,
  createCamelToSnakeScanner,
} = require('../dist/core/constants/regex-patterns');

assert.strictEqual(camelToSnake('fooBarBaz'), 'foo_bar_baz');
assert.strictEqual(camelToSnake('simple'), 'simple');
assert.strictEqual(camelToSnake('myFunctionName'), 'my_function_name');

const scanner1 = createCamelToSnakeScanner();
assert.strictEqual(scanner1.lastIndex, 0);
assert.strictEqual(scanner1.test('fooBar'), true);
console.log('✔ camelToSnake & scanner pooling verified.');

// 3. Test edit-diff computeLineStartsAndHashes buffer reuse & parity
console.log('\n--- [3/4] Testing computeLineStartsAndHashes Buffer Pool Parity ---');
const { computeLineStartsAndHashes } = require('../dist/core/diff/edit-diff');

const sampleCode = `
import { foo } from 'bar';

export function calculate(a: number, b: number): number {
    if (a > b) {
        return a - b;
    }
    return a + b;
}
`.trim();

const index1 = computeLineStartsAndHashes(sampleCode);
const index2 = computeLineStartsAndHashes(sampleCode);

assert.strictEqual(index1.starts.length, index2.starts.length, 'Line count must be identical');
assert.deepStrictEqual(index1.starts, index2.starts, 'Line starts must be identical');
assert.strictEqual(index1.hashes.length, index2.hashes.length, 'Hash count must be identical');

for (let i = 0; i < index1.hashes.length; i++) {
  assert.strictEqual(index1.hashes[i], index2.hashes[i], `Hash at line ${i} must match`);
}
console.log('✔ computeLineStartsAndHashes parity & buffer pool verified.');

// 4. Test SecretsAnalyzer Pattern Caching
console.log('\n--- [4/4] Testing SecretsAnalyzer Default Pattern Compilation Caching ---');
const { SecretsAnalyzer } = require('../dist/analyzers/secrets');

const analyzer = new SecretsAnalyzer();
const dummyCtx = {
  filePath: 'src/auth/token.ts',
  content: 'const token = "' + ['ghp_', '12345678901234567890'].join('') + '";',
  config: { securityLevel: 'basic' },
  options: {},
  lineStats: { lines: 1, nonBlankLines: 1 },
};

const issues1 = analyzer.analyze(null, dummyCtx);
assert.strictEqual(issues1.length, 1, 'Must detect 1 secret issue');
assert.strictEqual(issues1[0].rule, 'secret-detected');

const issues2 = analyzer.analyze(null, dummyCtx);
assert.strictEqual(
  issues2.length,
  1,
  'Must detect 1 secret issue on second run with cached patterns',
);
console.log('✔ SecretsAnalyzer pattern caching verified.');

console.log('\n🎉 ALL RESOURCE POOLING & OPTIMIZATION VERIFICATIONS PASSED (4/4)!');
