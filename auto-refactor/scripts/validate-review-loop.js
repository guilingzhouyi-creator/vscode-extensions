#!/usr/bin/env node
/**
 * Module: Verification Harness — Review Loop Closure
 * File Path: scripts/validate-review-loop.js
 * Architecture Role: Assembly point for the write-back arm end to end. The stages live in
 *   scripts/lib/review-loop-verifiers.js and the fixtures in scripts/lib/review-loop-fixtures.js;
 *   this file loads the production collaborators once and hands them to those stages.
 * Dependencies & Triggers: consumes ../dist/cli/review-cmd,
 *   ../dist/core/reporting/review-queue-intake,
 *   ../dist/core/scoring/review-verdict-ledger and ../dist/core/scoring/calibration-corpus;
 *   registered in scripts/test-parallel.js and run by `npm test`.
 * Responsibilities:
 *   1. Load the production CLI, intake, ledger, corpus and arbiter.
 *   2. Hand the stage module one runtime object, so every stage reads the same instances.
 *   3. Exit non-zero when a stage throws.
 * Exit Semantics & Design Rationale: Exits 0 when the loop closes, 1 naming the first violation.
 *   Loading the collaborators here rather than inside each stage means a stage cannot silently
 *   import another copy of the corpus schema and then assert against this one. The scratch
 *   directory lives under the OS temp root, so the assertions write real files without touching
 *   the repository.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { ROOT, queueLine, finding, scratch, run } = require('./lib/review-loop-fixtures');
const { runReviewLoopVerifications } = require('./lib/review-loop-verifiers');

const { reviewCommand } = require(path.join(ROOT, 'dist/cli/review-cmd'));
const intake = require(path.join(ROOT, 'dist/core/reporting/review-queue-intake'));
const ledger = require(path.join(ROOT, 'dist/core/scoring/review-verdict-ledger'));
const corpusModule = require(path.join(ROOT, 'dist/core/scoring/calibration-corpus'));
const { FindingConfidenceArbiter } = require(
  path.join(ROOT, 'dist/core/scoring/finding-confidence-arbiter'),
);

try {
  runReviewLoopVerifications({
    assert,
    fs,
    reviewCommand,
    intake,
    ledger,
    corpusModule,
    FindingConfidenceArbiter,
    queueLine,
    finding,
    scratch,
    run,
  });
  console.log('\n✔ review loop closed end to end.');
} catch (error) {
  console.error(`\n✖ review loop closure failed: ${error.message}`);
  process.exit(1);
}
