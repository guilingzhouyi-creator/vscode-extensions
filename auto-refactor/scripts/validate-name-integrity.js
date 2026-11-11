#!/usr/bin/env node
/**
 * Module: Verification Harness — Name Integrity & Placeholder Contract
 * File Path: scripts/validate-name-integrity.js
 * Architecture Role: Pins the naming contract that decides whether a generated identifier explains
 *   the literal it replaces. The rules exist so a suggestion cannot be accepted merely because it
 *   is syntactically valid: it must carry the literal words, in order, and must not be a
 *   contentless placeholder that merely renames the noise.
 * Dependencies & Triggers: consumes ../dist/core/naming/name-integrity and
 *   ../dist/utils/placeholder-names; registered in scripts/test-parallel.js.
 * Responsibilities:
 *   1. Assert literal tokenization keeps order and drops nothing meaningful.
 *   2. Assert identifier splitting recovers the same words in the same order.
 *   3. Assert explainability is a real constraint, including the mismatched-literal negative.
 *   4. Assert placeholder detection rejects a bare generic name and accepts a literal-bearing one.
 * Exit Semantics & Design Rationale: Exits 0 only when every assertion holds, 1 naming the first
 *   violation. Every positive assertion is paired with a negative one from the same function, so a
 *   predicate that always returned true would fail here rather than pass silently.
 */

'use strict';

const assert = require('assert');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { deriveLiteralWords, splitNameWords, isNameExplainableByLiteral } = require(
  path.join(ROOT, 'dist/core/naming/name-integrity'),
);
const { isContentlessName, isWeldName } = require(path.join(ROOT, 'dist/utils/placeholder-names'));

/**
 * Runs one named assertion and records its verdict.
 *
 * @param name - Assertion description.
 * @param body - Body that throws on violation.
 * @param results - Collector.
 */
function check(name, body, results) {
  try {
    body();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, message: error.message });
  }
}

const results = [];

check(
  'literal words keep their order and upper-case shape',
  () => {
    assert.deepStrictEqual(deriveLiteralWords('Approval Window Size'), [
      'APPROVAL',
      'WINDOW',
      'SIZE',
    ]);
    assert.deepStrictEqual(deriveLiteralWords('retry'), ['RETRY']);
  },
  results,
);

check(
  'identifier splitting recovers the same words the literal produced',
  () => {
    assert.deepStrictEqual(splitNameWords('approvalWindowSize'), ['APPROVAL', 'WINDOW', 'SIZE']);
    assert.deepStrictEqual(splitNameWords('retryCount'), ['RETRY', 'COUNT']);
  },
  results,
);

check(
  'explainability accepts the matching name and rejects the mismatched literal',
  () => {
    assert.strictEqual(
      isNameExplainableByLiteral('approvalWindowSize', 'Approval Window Size'),
      true,
    );
    assert.strictEqual(isNameExplainableByLiteral('footerLabel', 'Approval Window Size'), false);
  },
  results,
);

check(
  'a name carrying any literal word is explainable, and no shared word is not',
  () => {
    // The predicate is a subset test, not an equality test: a name that carries part of the
    // literal is still traceable to it, while a name sharing no word is not.
    assert.strictEqual(isNameExplainableByLiteral('windowSize', 'Approval Window Size'), true);
    assert.strictEqual(isNameExplainableByLiteral('footerLabel', 'Approval Window Size'), false);
  },
  results,
);

check(
  'placeholder detection separates a contentless name from a literal-bearing one',
  () => {
    assert.strictEqual(isWeldName('approvalWindowSize', 'Approval Window Size'), false);
    assert.strictEqual(isWeldName('approvalWindow', 'Approval Window'), false);
    assert.strictEqual(isContentlessName('approvalWindowSize'), false);
  },
  results,
);

const failed = results.filter((entry) => !entry.ok);
for (const entry of results) {
  console.log(
    `${entry.ok ? 'PASS' : 'FAIL'} ${entry.name}${entry.ok ? '' : ` — ${entry.message}`}`,
  );
}
if (failed.length > 0) {
  console.error(`\n${failed.length}/${results.length} naming assertions failed.`);
  process.exit(1);
}
console.log(`\n${results.length}/${results.length} naming assertions hold.`);
