/**
 * Module: Verification Harness — Composite Quality Gate Tests
 * File Path: scripts/validate-composite-gate.js
 * Architecture Role: Verifies multi-stage composite gate decisions, threshold escalations,
 *   regression blocks, and anti-gaming protections.
 * Dependencies & Triggers: Consumes dist/core praxis and trajectory modules;
 *   executed in test-parallel.js.
 * Responsibilities: Validate stage thresholds, regression limits, and anti-gaming verdicts.
 * Exit Semantics & Design Rationale: Exits 0 on assertions pass, throws AssertionError on failure.
 */

'use strict';

const assert = require('assert');
const COMPOSITE_GATE_MODULE_PATH = '../dist/core/praxis/composite-quality-gate';
const { evaluateCompositeGate } = require(COMPOSITE_GATE_MODULE_PATH);

const STAGE_PRE_COMMIT = 'pre-commit';
const STAGE_PRE_PUSH = 'pre-push';
const VERDICT_PASS = 'PASS';
const VERDICT_BLOCK_STATIC = 'BLOCK_STATIC_FAILURE';
const VERDICT_BLOCK_DYNAMIC = 'BLOCK_DYNAMIC_FAILURE';
const VERDICT_BLOCK_REGRESSION = 'BLOCK_REGRESSION';
const VERDICT_BLOCK_GAMING = 'BLOCK_GAMING_DETECTED';

const BASE_COUNTER_PROCESSED = 2000;
const BASE_COUNTER_UNIQUE = 1000;
const BASE_COUNTER_CHANGED = 40;
const BASE_COUNTER_SEMANTIC = 35;
const BASE_COUNTER_COSMETIC = 5;
const BASE_COUNTER_DELTA = 20;

const METRIC_QED = 0.1;
const METRIC_REVIEW_YIELD = 6.5;
const METRIC_DELTA_Q_SEMANTIC = 3.5;
const METRIC_BEFORE_SCORE = 82.0;
const METRIC_AFTER_SCORE = 85.5;
const METRIC_REGRESSION_DENSITY = 28.5;
const METRIC_DEBT_RESOLVED = 10;
const METRIC_SCORE_VECTOR_ELEM = 90;
const METRIC_GAMING_CHANGED = 100;

function runTests() {
  console.log('🧪 运行复合质量审查校验套件...');

  const baseCounters = {
    processed: BASE_COUNTER_PROCESSED,
    unique: BASE_COUNTER_UNIQUE,
    changed: BASE_COUNTER_CHANGED,
    semantic: BASE_COUNTER_SEMANTIC,
    relocated: 0,
    cosmetic: BASE_COUNTER_COSMETIC,
    boilerplate: 0,
    added: BASE_COUNTER_DELTA,
    deleted: BASE_COUNTER_DELTA,
    modified: BASE_COUNTER_DELTA,
  };

  const goodMetrics = {
    qed: METRIC_QED,
    reviewYield: METRIC_REVIEW_YIELD,
    regressionDensity: 0,
    deltaQSemantic: METRIC_DELTA_Q_SEMANTIC,
    beforeScore: METRIC_BEFORE_SCORE,
    afterScore: METRIC_AFTER_SCORE,
    scoreVector: [
      METRIC_SCORE_VECTOR_ELEM,
      METRIC_SCORE_VECTOR_ELEM,
      METRIC_SCORE_VECTOR_ELEM,
      METRIC_SCORE_VECTOR_ELEM,
      METRIC_SCORE_VECTOR_ELEM,
      METRIC_SCORE_VECTOR_ELEM,
      METRIC_SCORE_VECTOR_ELEM,
      METRIC_SCORE_VECTOR_ELEM,
      METRIC_SCORE_VECTOR_ELEM,
      METRIC_SCORE_VECTOR_ELEM,
    ],
    dimensionDeltas: {},
    debtDelta: {
      addedDebtPoints: 0,
      resolvedDebtPoints: METRIC_DEBT_RESOLVED,
      netDebtCleared: METRIC_DEBT_RESOLVED,
      regressionFindingsCount: 0,
      regressionFindingIds: [],
    },
    gamingPenalty: 0,
  };

  // --- Test 1: Standard Clean Pass ---
  console.log('  ▶ [Test 1] Testing standard clean pass across pre-commit and pre-push...');
  const resultCommit = evaluateCompositeGate({
    stage: STAGE_PRE_COMMIT,
    staticPass: true,
    dynamicPass: true,
    metrics: goodMetrics,
    counters: baseCounters,
  });
  assert.strictEqual(resultCommit.passed, true, 'Clean change should pass pre-commit gate');
  assert.strictEqual(resultCommit.verdictCode, VERDICT_PASS);

  const resultPush = evaluateCompositeGate({
    stage: STAGE_PRE_PUSH,
    staticPass: true,
    dynamicPass: true,
    metrics: goodMetrics,
    counters: baseCounters,
  });
  assert.strictEqual(resultPush.passed, true, 'Clean change should pass pre-push gate');
  console.log('    ✔ Standard clean pass verified');

  // --- Test 2: Static Verification Failure Block ---
  console.log('  ▶ [Test 2] Testing static verification failure blocking...');
  const resultStaticFail = evaluateCompositeGate({
    stage: STAGE_PRE_COMMIT,
    staticPass: false,
    dynamicPass: true,
    metrics: goodMetrics,
    counters: baseCounters,
  });
  assert.strictEqual(resultStaticFail.passed, false, 'Must fail when static pass is false');
  assert.strictEqual(resultStaticFail.verdictCode, VERDICT_BLOCK_STATIC);
  assert.ok(resultStaticFail.violations.some((v) => v.includes('Static')));
  console.log('    ✔ Static failure blocking verified');

  // --- Test 3: Dynamic Test Failure Block ---
  console.log('  ▶ [Test 3] Testing dynamic test failure blocking...');
  const resultDynFail = evaluateCompositeGate({
    stage: STAGE_PRE_COMMIT,
    staticPass: true,
    dynamicPass: false,
    metrics: goodMetrics,
    counters: baseCounters,
  });
  assert.strictEqual(resultDynFail.passed, false, 'Must fail when dynamic pass is false');
  assert.strictEqual(resultDynFail.verdictCode, VERDICT_BLOCK_DYNAMIC);
  console.log('    ✔ Dynamic failure blocking verified');

  // --- Test 4: Regression Density Block on Pre-Push ---
  console.log('  ▶ [Test 4] Testing regression density block on pre-push...');
  const regressedMetrics = {
    ...goodMetrics,
    regressionDensity: METRIC_REGRESSION_DENSITY,
    debtDelta: {
      ...goodMetrics.debtDelta,
      regressionFindingsCount: 1,
      regressionFindingIds: ['SEC-001'],
    },
  };

  const resultRegressPush = evaluateCompositeGate({
    stage: STAGE_PRE_PUSH,
    staticPass: true,
    dynamicPass: true,
    metrics: regressedMetrics,
    counters: baseCounters,
  });
  assert.strictEqual(
    resultRegressPush.passed,
    false,
    'Pre-push must strictly block on regressions',
  );
  assert.strictEqual(resultRegressPush.verdictCode, VERDICT_BLOCK_REGRESSION);
  console.log('    ✔ Regression density blocking verified');

  // --- Test 5: Anti-Gaming Block ---
  console.log('  ▶ [Test 5] Testing anti-gaming block on superficial churn...');
  const gamingMetrics = {
    ...goodMetrics,
    qed: 0,
    deltaQSemantic: 0,
    gamingPenalty: METRIC_REVIEW_YIELD,
  };
  const resultGaming = evaluateCompositeGate({
    stage: STAGE_PRE_PUSH,
    staticPass: true,
    dynamicPass: true,
    metrics: gamingMetrics,
    counters: { ...baseCounters, semantic: 0, changed: METRIC_GAMING_CHANGED },
  });
  assert.strictEqual(resultGaming.passed, false, 'Pre-push must block on gaming');
  assert.strictEqual(resultGaming.verdictCode, VERDICT_BLOCK_GAMING);
  console.log('    ✔ Anti-gaming blocking verified');

  console.log('\n🎉 ALL Composite Quality Gate Tests PASSED!\n');
}

runTests();
