#!/usr/bin/env node
/**
 * Module: Verification Harness — Regex Constant Catalogue Contract
 * File Path: scripts/validate-regex-constants.js
 * Architecture Role: Pins the behaviour of the shared regular-expression catalogue. These patterns
 *   are the only definition of what counts as an unsafe block, a safety comment, a shell assignment
 *   or a data query across the analyzers, yet nothing asserted that they match what their names
 *   promise. A pattern that silently stopped matching would degrade every downstream analyzer
 *   without failing any of them.
 * Dependencies & Triggers: consumes ../dist/core/constants/regex-rust, regex-shell and regex-data;
 *   registered in scripts/test-parallel.js.
 * Responsibilities:
 *   1. Assert the Rust patterns match the constructs they name and reject look-alikes.
 *   2. Assert the shell patterns match assignment and foreach forms, not plain words.
 *   3. Assert the data-query predicate accepts a query call and rejects unrelated text.
 * Exit Semantics & Design Rationale: Exits 0 only when every pattern behaves, 1 naming the first
 *   divergence. Each positive case is paired with a negative one, so a pattern widened to match
 *   everything fails the negative half rather than passing unnoticed.
 */

'use strict';

const assert = require('assert');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const rust = require(path.join(ROOT, 'dist/core/constants/regex-rust'));
const shell = require(path.join(ROOT, 'dist/core/constants/regex-shell'));
const data = require(path.join(ROOT, 'dist/core/constants/regex-data'));

/** Collected assertion verdicts, printed before exit. */
const results = [];

/**
 * Runs one named assertion.
 *
 * @param name - Assertion description.
 * @param body - Body that throws on violation.
 */
function check(name, body) {
  try {
    body();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, message: error.message });
  }
}

check('the Rust unsafe keyword pattern matches a block and rejects a safe function', () => {
  assert.strictEqual(rust.RUST_UNSAFE_KEYWORD_PATTERN.test('unsafe {'), true);
  assert.strictEqual(rust.RUST_UNSAFE_KEYWORD_PATTERN.test('fn safe_call()'), false);
});

check('the Rust safety comment pattern requires the SAFETY marker', () => {
  assert.strictEqual(
    rust.RUST_SAFETY_PROOF_COMMENT_PATTERN.test('// SAFETY: pointer is valid'),
    true,
  );
  assert.strictEqual(rust.RUST_SAFETY_PROOF_COMMENT_PATTERN.test('// just a note'), false);
});

check('the shell assignment pattern matches an assignment and rejects a bare word', () => {
  assert.strictEqual(shell.SHELL_ASSIGN_STATEMENT_PATTERN.test('NAME=value'), true);
  assert.strictEqual(shell.SHELL_ASSIGN_STATEMENT_PATTERN.test('just a comment'), false);
});

check('the shell foreach pattern matches a loop and rejects a plain call', () => {
  assert.strictEqual(shell.SHELL_FOREACH_STATEMENT_PATTERN.test('foreach ($item in $list)'), true);
  assert.strictEqual(shell.SHELL_FOREACH_STATEMENT_PATTERN.test('Get-Item $path'), false);
});

check('the data query predicate accepts a query call and rejects prose', () => {
  assert.strictEqual(data.isDataQueryCall('db.findMany({})'), true);
  assert.strictEqual(data.isDataQueryCall('const label = "hello"'), false);
});

const failed = results.filter((entry) => !entry.ok);
for (const entry of results) {
  console.log(
    `${entry.ok ? 'PASS' : 'FAIL'} ${entry.name}${entry.ok ? '' : ` — ${entry.message}`}`,
  );
}
if (failed.length > 0) {
  console.error(`\n${failed.length}/${results.length} regex assertions failed.`);
  process.exit(1);
}
console.log(`\n${results.length}/${results.length} regex assertions hold.`);
