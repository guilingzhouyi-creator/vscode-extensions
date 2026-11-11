/**
 * Module: Verification Harness — Review Loop Fixtures
 * File Path: scripts/lib/review-loop-fixtures.js
 * Architecture Role: Builds the queue lines, findings and scratch directory the review-loop
 *   assertions share. Kept apart from the assertions so a reader can see every input the suite
 *   can produce in one place, and so a fixture change is reviewed as a fixture change rather than
 *   buried in an assertion diff.
 * Dependencies & Triggers: Node.js built-ins only; consumed by scripts/validate-review-loop.js.
 * Responsibilities:
 *   1. Build one NDJSON queue line with overridable fields.
 *   2. Build a minimal issue record for the arbiter.
 *   3. Create a scratch directory holding the queue, corpus and ledger paths.
 *   4. Invoke the review command against a scratch directory.
 * Exit Semantics & Design Rationale: Pure builders and one thin invocation; this module never
 *   exits and never asserts. The scratch root sits under the OS temp root so the assertions can
 *   write real files without touching the repository.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

/**
 * Builds one NDJSON queue line.
 *
 * @param overrides - Fields to override.
 * @returns Single-line JSON string.
 */
function queueLine(overrides = {}) {
  return JSON.stringify({
    category: 'needs-human',
    rule: 'hardcoded-string',
    analyzer: 'constants',
    file: 'src/a.ts',
    line: 10,
    severity: 'warning',
    tier: 'advisory',
    conf: 0.9,
    calibrationSampleSize: 0,
    requiresRuntime: true,
    rationale: 'no automated tier could settle it',
    ...overrides,
  });
}

/**
 * Builds a minimal finding for the arbiter.
 *
 * @param overrides - Fields to override.
 * @returns Issue record.
 */
function finding(overrides = {}) {
  return {
    id: 'constants:hardcoded-string:src/a.ts:10',
    analyzer: 'constants',
    rule: 'hardcoded-string',
    severity: 'warning',
    message: 'Hardcoded string',
    location: { file: 'src/a.ts', start: { line: 10, column: 1 }, end: { line: 10, column: 9 } },
    detail: {},
    evidence: { confidence: 0.9 },
    ...overrides,
  };
}

/**
 * Creates a scratch directory and returns the paths the stages share.
 *
 * @returns Absolute paths plus a cleanup function.
 */
function scratch() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-refactor-review-'));
  return {
    root,
    queue: path.join(root, 'queue.ndjson'),
    corpus: path.join(root, 'corpus.json'),
    ledger: path.join(root, 'review-verdicts.json'),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

/**
 * Runs the review command against a scratch directory.
 *
 * @param dir - Scratch paths.
 * @param verdict - Verdict token.
 * @param extra - Additional arguments.
 * @returns Command result.
 */
function run(dir, verdict, extra = []) {
  const { reviewCommand } = require(path.join(ROOT, 'dist/cli/review-cmd'));
  return reviewCommand([
    '--queue',
    dir.queue,
    '--corpus',
    dir.corpus,
    '--ledger',
    dir.ledger,
    '--verdict',
    verdict,
    ...extra,
  ]);
}

module.exports = { ROOT, queueLine, finding, scratch, run };
