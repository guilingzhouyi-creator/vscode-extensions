/**
 * Module: Verification Harness — Staged Differential Exemption Contract
 * File Path: auto-refactor/scripts/validate-diff-exemption.js
 * Architecture Role: Runner for the exemption contract. The clause bodies live in
 *   scripts/lib/exemption-clause-cases.js; this file supplies the harness they register against
 *   and reports their verdicts.
 * Dependencies & Triggers: lib/exemption-clause-cases.js plus the ledger library the harness
 *   builds on; invoked by `npm test` through the SELF_AUDIT_SUITES lane and directly.
 * Responsibilities:
 *   1. Provide the case runner, isolated-ledger factory, request builder and streak seeder.
 *   2. Register every clause from the cases module.
 *   3. Print one line per clause and exit non-zero when any clause fails.
 * Exit Semantics & Design Rationale: Exits 0 when every clause holds, 1 when any clause fails.
 *   Every case runs against a temporary ledger pair, so the harness never reads or writes the
 *   repository's own grants. Splitting the clause bodies out keeps this runner small enough that a
 *   reviewer can see the whole orchestration at once, and keeps each clause in a file that does
 *   nothing but state policy.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { EXEMPTION_POLICY } = require('../../scripts/common/lib/diff-bounds-policy');
const { createLedger } = require('../../scripts/common/lib/diff-exemption-ledger');
const { registerExemptionCases } = require('./lib/exemption-clause-cases');

const TARGET_DEFICIT = 'SUBSTANTIVE_TARGET_DEFICIT';
const TEST_FILE = 'src/example-short-module.ts';
const TEST_RULE = 'GAT-DENS-001';

/** Collected case results, printed before exit so a failure names its clause. */
const results = [];

/**
 * Runs one named case and records its verdict.
 *
 * @param name - Case description.
 * @param body - Case body; throws to fail.
 */
function check(name, body) {
  try {
    body();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, message: error.message });
  }
}

/**
 * Creates an isolated ledger pair under a fresh temporary directory.
 *
 * @returns Ledger bound to the temporary paths, plus those paths so a case can reopen them.
 */
function freshLedger() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diff-exemption-'));
  const paths = {
    streakFile: path.join(dir, 'streaks.json'),
    exemptionFile: path.join(dir, 'exemptions.json'),
  };
  return { ...createLedger(paths), ledgerPaths: paths };
}

/**
 * Builds a request that every clause accepts.
 *
 * @param overrides - Fields to replace.
 * @returns Exemption request.
 */
function eligibleRequest(overrides = {}) {
  return {
    file: TEST_FILE,
    violationType: TARGET_DEFICIT,
    ruleId: TEST_RULE,
    isNew: true,
    physAdd: 42,
    measured: 0.55,
    eligibilityValue: 0.55,
    streak: EXEMPTION_POLICY.minStreak,
    batchGrantedCount: 0,
    ...overrides,
  };
}

/** Pushes a streak to a fresh ledger so a following request sees it. */
function seedStreak(ledger, count, request = eligibleRequest()) {
  for (let i = 0; i < count; i += 1) {
    ledger.recordRunStreaks([{ file: request.file, type: request.violationType }]);
  }
}

registerExemptionCases({ check, freshLedger, eligibleRequest, seedStreak });

const failed = results.filter((entry) => !entry.ok);
for (const entry of results) {
  const mark = entry.ok ? 'PASS' : 'FAIL';
  console.log(`${mark} ${entry.name}${entry.ok ? '' : ` — ${entry.message}`}`);
}
if (failed.length > 0) {
  console.error(`\n${failed.length}/${results.length} exemption clauses failed.`);
  process.exit(1);
}
console.log(`\n${results.length}/${results.length} exemption clauses hold.`);
