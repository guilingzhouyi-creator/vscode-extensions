#!/usr/bin/env node
/**
 * Module: Static Quality Gate — Elastic Technical Debt Budget Engine Verification
 * File Path: scripts/validate-elastic-debt-budget.js
 * Architecture Role: Comprehensive verification test asserting role-aware and scale-aware
 *   elastic technical debt envelopes, non-zero tolerance for Critical and High tiers,
 *   sub-linear scale factor scaling, health factor dampening, and circuit breaker triggering.
 * Dependencies & Triggers: Executed via test-parallel harness; tests `dist/api`.
 * Responsibilities:
 *   1. Assert zero-debt returns PERMITTED_ZERO_DEBT without false positives;
 *   2. Assert sub-linear square-root scale factor progression across repository sizes;
 *   3. Assert health elasticity dampening (widens on A+, tightens on degraded health);
 *   4. Assert non-one-vote-veto: Critical and High debts are permitted within elastic envelope;
 *   5. Assert circuit breaker: BLOCKED_EXCEEDED_BUDGET on threshold breach;
 *   6. Assert composite weighted growth constraint enforcement;
 *   7. Assert delta debt evaluation against pre-existing baselines.
 * Exit Semantics & Design Rationale: Exits 0 on success, non-zero on assertion failure.
 */
'use strict';

const assert = require('assert');

console.log('🚀 [ELASTIC-DEBT-BUDGET] Starting Dynamic Debt Budget Verification Harness...\n');

const { evaluateElasticDebtBudget, computeWeightedDebtPoints } = require('../dist/api');

// --- [1/7] Testing Zero Debt Permitted Status ---
console.log('--- [1/7] Testing Zero Debt Permitted Status ---');
const zeroEval = evaluateElasticDebtBudget(
  { critical: 0, high: 0, medium: 0, low: 0 },
  { totalFiles: 200, compositeScore: 95.0 },
);
assert.strictEqual(zeroEval.isWithinBudget, true, 'Zero debt must be within budget');
assert.strictEqual(
  zeroEval.verdict,
  'PERMITTED_ZERO_DEBT',
  'Zero debt verdict must be PERMITTED_ZERO_DEBT',
);
assert.strictEqual(zeroEval.violations.length, 0, 'Zero debt must produce 0 violations');
console.log('✔ Zero debt fully compliant (PERMITTED_ZERO_DEBT).');

// --- [2/7] Testing Scale Factor Sub-Linear Square-Root Scaling ---
console.log('\n--- [2/7] Testing Scale Factor Sub-Linear Scaling ---');
const smallProject = evaluateElasticDebtBudget({}, { totalFiles: 50 });
const refProject = evaluateElasticDebtBudget({}, { totalFiles: 200 });
const largeProject = evaluateElasticDebtBudget({}, { totalFiles: 800 });
const hugeProject = evaluateElasticDebtBudget({}, { totalFiles: 1800 });

assert.strictEqual(
  smallProject.scaleFactor,
  1.0,
  'Small project (<200 files) must clamp scale factor to 1.0',
);
assert.strictEqual(
  refProject.scaleFactor,
  1.0,
  'Reference project (200 files) scale factor must be 1.0',
);
assert.strictEqual(
  largeProject.scaleFactor,
  2.0,
  '800-file project scale factor must be sqrt(800/200) = 2.0',
);
assert.strictEqual(
  hugeProject.scaleFactor,
  3.0,
  '1800-file project scale factor must be sqrt(1800/200) = 3.0',
);

assert.ok(
  largeProject.dynamicLimits.critical > refProject.dynamicLimits.critical,
  'Large project must receive larger critical debt allowance than reference project',
);
assert.ok(
  largeProject.dynamicLimits.high > refProject.dynamicLimits.high,
  'Large project must receive larger high debt allowance than reference project',
);
console.log(
  `✔ Scale factor validated: 50 files -> ${smallProject.scaleFactor}, 200 files -> ${refProject.scaleFactor}, 800 files -> ${largeProject.scaleFactor}, 1800 files -> ${hugeProject.scaleFactor}.`,
);

// --- [3/7] Testing Health Elasticity Dampening Multipliers ---
console.log('\n--- [3/7] Testing Health Elasticity Dampening ---');
const aPlusEval = evaluateElasticDebtBudget({}, { totalFiles: 200, compositeScore: 99.0 });
const aEval = evaluateElasticDebtBudget({}, { totalFiles: 200, compositeScore: 96.0 });
const bEval = evaluateElasticDebtBudget({}, { totalFiles: 200, compositeScore: 91.0 });
const cEval = evaluateElasticDebtBudget({}, { totalFiles: 200, compositeScore: 82.0 });
const degradedEval = evaluateElasticDebtBudget({}, { totalFiles: 200, compositeScore: 70.0 });

assert.strictEqual(aPlusEval.healthElasticityFactor, 1.25, 'A+ quality (>=98) factor must be 1.25');
assert.strictEqual(aEval.healthElasticityFactor, 1.1, 'A quality (>=95) factor must be 1.10');
assert.strictEqual(bEval.healthElasticityFactor, 1.0, 'B quality (>=90) factor must be 1.00');
assert.strictEqual(cEval.healthElasticityFactor, 0.7, 'C quality (>=80) factor must be 0.70');
assert.strictEqual(
  degradedEval.healthElasticityFactor,
  0.4,
  'Degraded quality (<80) factor must be 0.40',
);

assert.ok(
  aPlusEval.dynamicLimits.high > degradedEval.dynamicLimits.high,
  'Healthy project must earn wider elastic envelope than degraded project',
);
console.log('✔ Health elasticity multipliers verified across all quality score tiers.');

// --- [4/7] Testing Elastic Non-Zero Allowance (No One-Vote Veto) ---
console.log('\n--- [4/7] Testing Elastic Non-Zero Allowance for Critical & High Tiers ---');
const elasticEval = evaluateElasticDebtBudget(
  { critical: 1, high: 2, medium: 5, low: 20 },
  { totalFiles: 800, compositeScore: 99.0 },
);

assert.strictEqual(
  elasticEval.isWithinBudget,
  true,
  'Critical=1 and High=2 must NOT be vetoed under healthy large codebase envelope',
);
assert.strictEqual(
  elasticEval.verdict,
  'PERMITTED_ELASTIC',
  'Verdict must be PERMITTED_ELASTIC rather than failure',
);
assert.strictEqual(elasticEval.violations.length, 0, 'No violations should occur within allowance');
console.log(
  `✔ Non-one-vote-veto verified: Critical=1/5, High=2/12 permitted under elastic envelope.`,
);

// --- [5/7] Testing Circuit Breaker on Exceeded Budget ---
console.log('\n--- [5/7] Testing Circuit Breaker on Exceeded Dynamic Budget ---');
const breachedEval = evaluateElasticDebtBudget(
  { critical: 10, high: 25 },
  { totalFiles: 800, compositeScore: 99.0 },
);

assert.strictEqual(breachedEval.isWithinBudget, false, 'Over-budget debt must be blocked');
assert.strictEqual(
  breachedEval.verdict,
  'BLOCKED_EXCEEDED_BUDGET',
  'Verdict must be BLOCKED_EXCEEDED_BUDGET',
);
assert.ok(breachedEval.violations.length >= 2, 'Must report violations for both critical and high');
const violationTiers = breachedEval.violations.map((v) => v.tier);
assert.ok(violationTiers.includes('critical'), 'Must include critical tier violation');
assert.ok(violationTiers.includes('high'), 'Must include high tier violation');
console.log(
  `✔ Circuit breaker successfully blocked over-budget debt: ${breachedEval.violations.length} violations reported.`,
);

// --- [6/7] Testing Composite Weighted Growth Enforcement ---
console.log('\n--- [6/7] Testing Composite Weighted Growth Enforcement ---');
const points = computeWeightedDebtPoints({ critical: 2, high: 5, medium: 20, low: 50 });
assert.strictEqual(
  points,
  2 * 10 + 5 * 3 + 20 * 1 + 50 * 0.2,
  'Weighted points formula must match contract',
);

const growthBreachEval = evaluateElasticDebtBudget(
  { critical: 2, high: 4, medium: 30, low: 50 },
  {
    totalFiles: 800,
    compositeScore: 99.0,
    maxWeightedGrowth: 40,
  },
);
assert.strictEqual(
  growthBreachEval.isWithinBudget,
  false,
  'Excessive composite growth must trigger breach',
);
const hasGrowthViolation = growthBreachEval.violations.some((v) =>
  v.message.includes('Composite weighted debt growth'),
);
assert.ok(hasGrowthViolation, 'Must record composite weighted debt growth violation');
console.log(
  '✔ Composite weighted growth limiter correctly protects against cumulative debt creep.',
);

// --- [7/7] Testing Delta Additions Against Baseline ---
console.log('\n--- [7/7] Testing Incremental Delta Evaluation Against Baseline ---');
const baseline = { critical: 1, high: 4, medium: 100, low: 500 };
const currentScan = { critical: 2, high: 6, medium: 105, low: 520 };

const deltaEval = evaluateElasticDebtBudget(currentScan, {
  baselineDebt: baseline,
  totalFiles: 800,
  compositeScore: 98.0,
});

assert.strictEqual(deltaEval.deltaDebt.critical, 1, 'Delta critical must be 2 - 1 = 1');
assert.strictEqual(deltaEval.deltaDebt.high, 2, 'Delta high must be 6 - 4 = 2');
assert.strictEqual(deltaEval.deltaDebt.medium, 5, 'Delta medium must be 105 - 100 = 5');
assert.strictEqual(deltaEval.deltaDebt.low, 20, 'Delta low must be 520 - 500 = 20');
assert.strictEqual(deltaEval.isWithinBudget, true, 'Delta within dynamic limits must pass');
assert.strictEqual(deltaEval.verdict, 'PERMITTED_ELASTIC', 'Verdict must be PERMITTED_ELASTIC');
console.log('✔ Baseline-aware delta debt evaluation successfully verified.');

console.log('\n================================================================');
console.log('🎉 ALL 7 ELASTIC TECHNICAL DEBT BUDGET VERIFICATIONS PASSED!');
console.log('================================================================\n');
